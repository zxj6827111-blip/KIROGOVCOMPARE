import express, { Request, Response } from 'express';
import pool, { dbType } from '../config/database-llm';
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/auth';

const router = express.Router();

// POST /api/regions - 创建区域（支持层级）
router.post('/', authMiddleware, requirePermission('manage_cities'), async (req: Request, res: Response) => {
  try {
    const { code, name, province } = req.body;
    // 兼容前端 parentId / parent_id 传参
    const parent_id = req.body.parent_id ?? req.body.parentId ?? null;

    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }

    // 计算 level：若 parent_id 存在则查询父级 level，否则为 1
    let level = 1;
    if (parent_id) {
      const parentIdNumber = Number(parent_id);
      if (!Number.isFinite(parentIdNumber)) {
        return res.status(400).json({ error: 'parent_id must be a number' });
      }
      if (dbType === 'sqlite') {
        const parent = await new Promise<any>((resolve, reject) => {
          pool.get('SELECT level FROM regions WHERE id = ?', [parentIdNumber], (err: any, row: any) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        if (!parent) {
          return res.status(404).json({ error: 'Parent region not found' });
        }
        const parentLevel = Number(parent.level);
        const normalizedParentLevel = Number.isFinite(parentLevel) && parentLevel >= 1 ? parentLevel : 1;
        level = normalizedParentLevel + 1;
      } else {
        const parentResult = await pool.query('SELECT level FROM regions WHERE id = $1', [parentIdNumber]);
        if (parentResult.rows.length === 0) {
          return res.status(404).json({ error: 'Parent region not found' });
        }
        const parentLevel = Number(parentResult.rows[0].level);
        const normalizedParentLevel = Number.isFinite(parentLevel) && parentLevel >= 1 ? parentLevel : 1;
        level = normalizedParentLevel + 1;
      }
    }

    if (!Number.isFinite(level)) {
      return res.status(400).json({ error: 'Level calculation failed' });
    }
    if (level < 1 || level > 4) {
      return res.status(400).json({ error: 'Region level must be between 1 and 4' });
    }

    const levelValue = level;

    // Get max sort_order for new region
    let maxSortOrder = 0;
    if (dbType === 'sqlite') {
      const maxResult = await new Promise<any>((resolve, reject) => {
        pool.get('SELECT MAX(sort_order) as max_order FROM regions', [], (err: any, row: any) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      maxSortOrder = maxResult?.max_order || 0;
    } else {
      const maxResult = await pool.query('SELECT MAX(sort_order) as max_order FROM regions');
      maxSortOrder = maxResult.rows[0]?.max_order || 0;
    }
    const newSortOrder = maxSortOrder + 1;

    // 统一使用 $n 占位符，sqlite 也会被格式化函数替换
    const insertSql = 'INSERT INTO regions (code, name, province, parent_id, level, sort_order) VALUES ($1, $2, $3, $4, $5, $6)';
    const params = [code, name, province || null, parent_id ? Number(parent_id) : null, levelValue, newSortOrder];

    if (dbType === 'sqlite') {
      await new Promise<void>((resolve, reject) => {
        pool.run(insertSql, params, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const inserted = await pool.query('SELECT id, code, name, province, parent_id, level, sort_order FROM regions WHERE code = $1', [code]);
      const region = inserted.rows?.[0];

      res.status(201).json(
        region || {
          id: null,
          code,
          name,
          province: province || null,
          parent_id: parent_id || null,
          level: levelValue,
        }
      );
    } else {
      const result = await pool.query(
        `${insertSql} RETURNING id, code, name, province, parent_id, level, sort_order`,
        params
      );

      res.status(201).json(result.rows[0]);
    }
  } catch (error: any) {
    console.error('Error creating region:', error);
    if (error.message?.includes('UNIQUE constraint failed') || error.code === '23505') {
      return res.status(409).json({ error: 'Region code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/regions - 获取区域列表（带层级）
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    // Logic: If user has dataScope.regions, filter the query
    let filterNames: string[] = [];
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      filterNames = user.dataScope.regions;
    }

    if (dbType === 'sqlite') {
      const rows = await new Promise<any[]>((resolve, reject) => {
        if (filterNames.length > 0) {
          // Recursive query for filtered scope
          // Construct 'IN' clause placeholders manually because sqlite3 array binding is limited
          const placeholders = filterNames.map(() => '?').join(',');
          const sql = `
              WITH RECURSIVE allowed_tree AS (
                SELECT id, code, name, province, parent_id, level 
                FROM regions 
                WHERE name IN (${placeholders})
                UNION ALL
                SELECT r.id, r.code, r.name, r.province, r.parent_id, r.level 
                FROM regions r 
                JOIN allowed_tree d ON r.parent_id = d.id
              )
              SELECT DISTINCT id, code, name, province, parent_id, level, sort_order FROM allowed_tree ORDER BY level, sort_order, id
            `;
          pool.all(sql, filterNames, (err: any, rows: any[]) => {
            if (err) reject(err);
            else {
              // Fix Orphaned Nodes:
              // If a node's parent is NOT in the result set, set parent_id to null
              // This ensures frontend treats them as "roots" and displays them
              const validIds = new Set(rows?.map(r => r.id));
              const safeRows = rows?.map(r => ({
                ...r,
                parent_id: (r.parent_id && validIds.has(r.parent_id)) ? r.parent_id : null
              })) || [];
              resolve(safeRows);
            }
          });
        } else {
          pool.all('SELECT id, code, name, province, parent_id, level, sort_order FROM regions ORDER BY level, sort_order, id', (err: any, rows: any[]) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        }
      });

      res.json({ data: rows });
    } else {
      // Postgres implementation (simplified, assuming we might not need it for this user or using similar CTE)
      if (filterNames.length > 0) {
        // Note: pg usually uses $1, $2... and ANY($1) for arrays
        const sql = `
              WITH RECURSIVE allowed_tree AS (
                SELECT id, code, name, province, parent_id, level 
                FROM regions 
                WHERE name = ANY($1)
                UNION ALL
                SELECT r.id, r.code, r.name, r.province, r.parent_id, r.level 
                FROM regions r 
                JOIN allowed_tree d ON r.parent_id = d.id
              )
              SELECT DISTINCT id, code, name, province, parent_id, level, sort_order FROM allowed_tree ORDER BY level, sort_order, id
            `;
        const result = await pool.query(sql, [filterNames]);
        // Fix Orphaned Nodes (same as SQLite):
        // If a node's parent is NOT in the result set, set parent_id to null
        // This ensures frontend treats them as "roots" and displays them
        const validIds = new Set(result.rows?.map((r: any) => r.id));
        const safeRows = result.rows?.map((r: any) => ({
          ...r,
          parent_id: (r.parent_id && validIds.has(r.parent_id)) ? r.parent_id : null
        })) || [];
        res.json({ data: safeRows });
      } else {
        const result = await pool.query('SELECT id, code, name, province, parent_id, level, sort_order FROM regions ORDER BY level, sort_order, id');
        res.json({ data: result.rows });
      }
    }
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/regions/:id - 获取区域详情
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (dbType === 'sqlite') {
      const row = await new Promise<any>((resolve, reject) => {
        pool.get('SELECT id, code, name, province, parent_id, level, sort_order FROM regions WHERE id = ?', [id], (err: any, row: any) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!row) {
        return res.status(404).json({ error: 'Region not found' });
      }

      res.json(row);
    } else {
      const result = await pool.query('SELECT id, code, name, province, parent_id, level, sort_order FROM regions WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Region not found' });
      }

      res.json(result.rows[0]);
    }
  } catch (error) {
    console.error('Error fetching region:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/regions/:id - 修改区域（名称、排序、分类等级等）
router.put('/:id', authMiddleware, requirePermission('manage_cities'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, sort_order, level } = req.body;

    if (!name && sort_order === undefined && level === undefined) {
      return res.status(400).json({ error: 'At least one field (name, sort_order, or level) is required' });
    }

    // Validate level if provided
    if (level !== undefined) {
      const levelNum = Number(level);
      if (!Number.isFinite(levelNum) || levelNum < 1 || levelNum > 4) {
        return res.status(400).json({ error: 'Level must be between 1 and 4' });
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (name) {
      updates.push(`name = ${dbType === 'sqlite' ? '?' : `$${paramIndex++}`}`);
      params.push(name);
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = ${dbType === 'sqlite' ? '?' : `$${paramIndex++}`}`);
      params.push(sort_order);
    }
    if (level !== undefined) {
      updates.push(`level = ${dbType === 'sqlite' ? '?' : `$${paramIndex++}`}`);
      params.push(Number(level));
    }
    updates.push(`updated_at = ${dbType === 'sqlite' ? "datetime('now')" : 'NOW()'}`);

    const updateSql = `UPDATE regions SET ${updates.join(', ')} WHERE id = ${dbType === 'sqlite' ? '?' : `$${paramIndex}`}`;
    params.push(id);

    if (dbType === 'sqlite') {
      await new Promise<void>((resolve, reject) => {
        pool.run(updateSql, params, function (this: any, err: any) {
          if (err) reject(err);
          else if (this.changes === 0) reject(new Error('Region not found'));
          else resolve();
        });
      });

      const updated = await new Promise<any>((resolve, reject) => {
        pool.get('SELECT id, code, name, province, parent_id, level, sort_order FROM regions WHERE id = ?', [id], (err: any, row: any) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      res.json(updated);
    } else {
      const result = await pool.query(
        `${updateSql} RETURNING id, code, name, province, parent_id, level, sort_order`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Region not found' });
      }

      res.json(result.rows[0]);
    }
  } catch (error: any) {
    console.error('Error updating region:', error);
    if (error.message === 'Region not found') {
      return res.status(404).json({ error: 'Region not found' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/regions/reorder - 批量更新排序
router.post('/reorder', authMiddleware, requirePermission('manage_cities'), async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    // orders: [{ id: number, sort_order: number }, ...]

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'orders array is required' });
    }

    if (dbType === 'sqlite') {
      // Simple sequential updates for SQLite
      for (const item of orders) {
        await new Promise<void>((resolve, reject) => {
          pool.run('UPDATE regions SET sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?',
            [item.sort_order, item.id], (err: any) => {
              if (err) reject(err);
              else resolve();
            });
        });
      }
    } else {
      // PostgreSQL: Simple sequential updates (no transaction needed for idempotent updates)
      for (const item of orders) {
        await pool.query('UPDATE regions SET sort_order = $1, updated_at = NOW() WHERE id = $2',
          [item.sort_order, item.id]);
      }
    }

    res.json({ success: true, updated: orders.length });
  } catch (error) {
    console.error('Error reordering regions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/regions/:id - 删除区域
router.delete('/:id', authMiddleware, requirePermission('manage_cities'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Use Recursive CTE to identify all descendant IDs and the ID itself
    const recursiveQuery = `
      WITH RECURSIVE descendants AS (
        SELECT id FROM regions WHERE id = ${dbType === 'sqlite' ? '?' : '$1'}
        UNION ALL
        SELECT r.id FROM regions r JOIN descendants d ON r.parent_id = d.id
      )
      SELECT id FROM descendants
    `;

    let idsToDelete: any[] = [];
    if (dbType === 'sqlite') {
      const rows = await new Promise<any[]>((resolve, reject) => {
        pool.all(recursiveQuery, [id], (err: any, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      idsToDelete = rows.map(r => r.id);
    } else {
      const result = await pool.query(recursiveQuery, [id]);
      idsToDelete = result.rows.map((r: any) => r.id);
    }

    if (idsToDelete.length === 0) {
      return res.status(404).json({ error: 'Region not found' });
    }

    // Delete in reverse order (bottom-up) or just all at once if FK checks are deferred/cascaded
    // But since we want to be robust:
    // DELETE FROM regions WHERE id IN (...)

    // Note: SQLite limit on variables is usually 999. Assuming regions count isn't huge.
    // If it is huge, we should rely on FK cascade. 
    // Given user scenario (garbled file), it might produce a lot of regions.
    // Let's try simple deletion first. If FK Cascade works, the root delete works.

    // Actually, if we use the CTE IDs list, we can just delete them.
    // However, the best way for robust SQLite without relying on FK config:
    // Delete leaf nodes first? 
    // Simplest: `DELETE FROM regions WHERE id IN (...)`

    const placeholders = idsToDelete.map((_, i) => dbType === 'sqlite' ? '?' : `$${i + 1}`).join(',');
    const deleteSql = `DELETE FROM regions WHERE id IN (${placeholders})`;

    if (dbType === 'sqlite') {
      await new Promise<void>((resolve, reject) => {
        pool.run(deleteSql, idsToDelete, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      await pool.query(deleteSql, idsToDelete);
    }

    res.json({ message: `Successfully deleted ${idsToDelete.length} regions` });

  } catch (error) {
    console.error('Error deleting region:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
