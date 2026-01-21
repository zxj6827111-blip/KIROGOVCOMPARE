import express, { Response } from 'express';
import pool from '../config/database-llm';
import { authMiddleware, requirePermission, AuthRequest, hashPassword } from '../middleware/auth';

const router = express.Router();

// Middleware to ensure user is logged in
router.use(authMiddleware);

/**
 * GET /api/users
 * List all users
 * Requires 'manage_users' permission
 */
router.get('/', requirePermission('manage_users'), async (req: AuthRequest, res: Response) => {
    try {
        const result = await pool.query(`
      SELECT id, username, display_name, created_at, last_login_at, permissions, data_scope
      FROM admin_users
      ORDER BY created_at DESC
    `);
        const users = result.rows;

        // Parse JSON fields if they are strings (Postgres jsonb might return objects already)
        const parsedUsers = users.map(user => ({
            ...user,
            permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions) : (user.permissions || {}),
            dataScope: typeof user.data_scope === 'string' ? JSON.parse(user.data_scope) : (user.data_scope || {})
        }));

        res.json(parsedUsers);
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

/**
 * POST /api/users
 * Create new user
 * Requires 'manage_users' permission
 */
router.post('/', requirePermission('manage_users'), async (req: AuthRequest, res: Response) => {
    try {
        const { username, password, displayName, permissions, dataScope } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码必填' });
        }

        // Check existing
        const existingRes = await pool.query('SELECT id FROM admin_users WHERE username = $1', [username]);
        if (existingRes.rows.length > 0) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        const hash = hashPassword(password);
        const permJson = JSON.stringify(permissions || {});
        const scopeJson = JSON.stringify(dataScope || {});

        await pool.query(`
      INSERT INTO admin_users (username, password_hash, display_name, permissions, data_scope, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [username, hash, displayName || username, permJson, scopeJson]);

        res.json({ message: '用户创建成功' });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: '创建用户失败' });
    }
});

/**
 * PUT /api/users/:id
 * Update user (permissions, scope, password, display name)
 * Requires 'manage_users' permission
 */
router.put('/:id', requirePermission('manage_users'), async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.params.id;
        const { password, displayName, permissions, dataScope } = req.body;

        if (Number(userId) === 1 && req.user?.id !== 1) {
            return res.status(403).json({ error: 'cannot modify super admin' });
        }

        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (displayName) {
            updates.push(`display_name = $${paramIndex++}`);
            values.push(displayName);
        }
        if (permissions) {
            updates.push(`permissions = $${paramIndex++}`);
            values.push(JSON.stringify(permissions));
        }
        if (dataScope) {
            updates.push(`data_scope = $${paramIndex++}`);
            values.push(JSON.stringify(dataScope));
        }
        if (password && password.length >= 6) {
            updates.push(`password_hash = $${paramIndex++}`);
            values.push(hashPassword(password));
        }

        updates.push(`updated_at = NOW()`);

        if (updates.length <= 1) { // Only updated_at
            return res.json({ message: 'no fields to update' });
        }

        values.push(userId);
        await pool.query(`
      UPDATE admin_users 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
    `, values);

        res.json({ message: '用户更新成功' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: '更新用户失败' });
    }
});

/**
 * DELETE /api/users/:id
 * Delete user
 * Requires 'manage_users' permission
 */
router.delete('/:id', requirePermission('manage_users'), async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.params.id;

        if (Number(userId) === 1) {
            return res.status(400).json({ error: 'cannot delete super admin' });
        }

        if (Number(userId) === req.user?.id) {
            return res.status(400).json({ error: '不能删除自己' });
        }

        await pool.query('DELETE FROM admin_users WHERE id = $1', [userId]);

        res.json({ message: '用户删除成功' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: '删除用户失败' });
    }
});

export default router;
