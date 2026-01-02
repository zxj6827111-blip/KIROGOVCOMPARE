import express, { Request, Response } from 'express';
import pool, { dbType } from '../config/database-llm';

const router = express.Router();

// POST /api/regions - 创建区域（支持层级）
router.post('/', async (req: Request, res: Response) => {
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

    // 统一使用 $n 占位符，sqlite 也会被格式化函数替换
    const insertSql = 'INSERT INTO regions (code, name, province, parent_id, level) VALUES ($1, $2, $3, $4, $5)';
    const params = [code, name, province || null, parent_id ? Number(parent_id) : null, levelValue];

    if (dbType === 'sqlite') {
      await new Promise<void>((resolve, reject) => {
        pool.run(insertSql, params, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const inserted = await pool.query('SELECT id, code, name, province, parent_id, level FROM regions WHERE code = $1', [code]);
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
        `${insertSql} RETURNING id, code, name, province, parent_id, level`,
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
router.get('/', async (_req: Request, res: Response) => {
  try {
    if (dbType === 'sqlite') {
      const rows = await new Promise<any[]>((resolve, reject) => {
        pool.all('SELECT id, code, name, province, parent_id, level FROM regions ORDER BY level, id', (err: any, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      res.json({ data: rows });
    } else {
      const result = await pool.query('SELECT id, code, name, province, parent_id, level FROM regions ORDER BY level, id');
      res.json({ data: result.rows });
    }
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/regions/:id - 获取区域详情
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (dbType === 'sqlite') {
      const row = await new Promise<any>((resolve, reject) => {
        pool.get('SELECT id, code, name, province, parent_id, level FROM regions WHERE id = ?', [id], (err: any, row: any) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!row) {
        return res.status(404).json({ error: 'Region not found' });
      }

      res.json(row);
    } else {
      const result = await pool.query('SELECT id, code, name, province, parent_id, level FROM regions WHERE id = $1', [id]);

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

// DELETE /api/regions/:id - 删除区域
router.delete('/:id', async (req: Request, res: Response) => {
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
