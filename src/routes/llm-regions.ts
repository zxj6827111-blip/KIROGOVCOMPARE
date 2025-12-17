import express, { Request, Response } from 'express';
import pool, { dbType } from '../config/database-llm';

const router = express.Router();

// POST /api/regions - 创建城市
router.post('/', async (req: Request, res: Response) => {
  try {
    const { code, name, province } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }

    if (dbType === 'sqlite') {
      const result = await new Promise<any>((resolve, reject) => {
        pool.run(
          'INSERT INTO regions (code, name, province) VALUES (?, ?, ?)',
          [code, name, province || null],
          function(this: any, err: any) {
            if (err) reject(err);
            else resolve({ id: this.lastID });
          }
        );
      });

      res.status(201).json({
        id: result.id,
        code,
        name,
        province: province || null
      });
    } else {
      const result = await pool.query(
        'INSERT INTO regions (code, name, province) VALUES ($1, $2, $3) RETURNING id, code, name, province',
        [code, name, province || null]
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

// GET /api/regions - 获取城市列表
router.get('/', async (_req: Request, res: Response) => {
  try {
    if (dbType === 'sqlite') {
      const rows = await new Promise<any[]>((resolve, reject) => {
        pool.all('SELECT id, code, name, province FROM regions ORDER BY id', (err: any, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      res.json({ data: rows });
    } else {
      const result = await pool.query('SELECT id, code, name, province FROM regions ORDER BY id');
      res.json({ data: result.rows });
    }
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/regions/:id - 获取城市详情
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (dbType === 'sqlite') {
      const row = await new Promise<any>((resolve, reject) => {
        pool.get('SELECT id, code, name, province FROM regions WHERE id = ?', [id], (err: any, row: any) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!row) {
        return res.status(404).json({ error: 'Region not found' });
      }

      res.json(row);
    } else {
      const result = await pool.query('SELECT id, code, name, province FROM regions WHERE id = $1', [id]);

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

export default router;
