import express, { Response } from 'express';
import { dbExecute, dbNowExpression, dbQuery, ensureDbMigrations, parseDbJson } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';
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
        ensureDbMigrations();
        const users = await dbQuery(`
      SELECT id, username, display_name, created_at, last_login_at, permissions, data_scope
      FROM admin_users
      ORDER BY created_at DESC
    `);

        // Parse JSON fields
        const parsedUsers = users.map(user => ({
            ...user,
            permissions: parseDbJson(user.permissions) || {},
            dataScope: parseDbJson(user.data_scope) || {}
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
            return res.status(400).json({ error: '鐢ㄦ埛鍚嶅拰瀵嗙爜蹇呭～' });
        }

        // Check existing
        ensureDbMigrations();
        const existing = await dbQuery(`SELECT id FROM admin_users WHERE username = ${sqlValue(username)}`);
        if (existing && existing.length > 0) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        const hash = hashPassword(password);
        const permJson = JSON.stringify(permissions || {});
        const scopeJson = JSON.stringify(dataScope || {});

        await dbExecute(`
      INSERT INTO admin_users (username, password_hash, display_name, permissions, data_scope, created_at)
      VALUES (
        ${sqlValue(username)}, 
        ${sqlValue(hash)}, 
        ${sqlValue(displayName || username)}, 
        ${sqlValue(permJson)}, 
        ${sqlValue(scopeJson)}, 
        ${dbNowExpression()}
      )
    `);

        res.json({ message: '鐢ㄦ埛鍒涘缓鎴愬姛' });
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

        // Prevent modifying super admin (id=1) casually, or at least be careful
        // For now, allow it but maybe warn? 
        // Usually ID 1 is protected.
        if (Number(userId) === 1 && req.user?.id !== 1) {
            return res.status(403).json({ error: 'cannot modify super admin' });
        }

        let updates: string[] = [];

        if (displayName) updates.push(`display_name = ${sqlValue(displayName)}`);
        if (permissions) updates.push(`permissions = ${sqlValue(JSON.stringify(permissions))}`);
        if (dataScope) updates.push(`data_scope = ${sqlValue(JSON.stringify(dataScope))}`);
        if (password && password.length >= 6) {
            updates.push(`password_hash = ${sqlValue(hashPassword(password))}`);
        }

        updates.push(`updated_at = ${dbNowExpression()}`);

        if (updates.length === 0) {
            return res.json({ message: 'no fields to update' });
        }

        ensureDbMigrations();
        await dbExecute(`
      UPDATE admin_users 
      SET ${updates.join(', ')}
      WHERE id = ${sqlValue(userId)}
    `);

        res.json({ message: '鐢ㄦ埛鏇存柊鎴愬姛' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: '鏇存柊鐢ㄦ埛澶辫触' });
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

        ensureDbMigrations();
        await dbExecute(`DELETE FROM admin_users WHERE id = ${sqlValue(userId)}`);

        res.json({ message: '鐢ㄦ埛删除成功' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: '删除用户失败' });
    }
});

export default router;

