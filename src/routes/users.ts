import express, { Response } from 'express';
import { querySqlite, sqlValue } from '../config/sqlite';
import { authMiddleware, requirePermission, AuthRequest, hashPassword } from '../middleware/auth';

const router = express.Router();

// Middleware to ensure user is logged in
router.use(authMiddleware);

/**
 * GET /api/users
 * List all users
 * Requires 'manage_users' permission
 */
router.get('/', requirePermission('manage_users'), (req: AuthRequest, res: Response) => {
    try {
        const users = querySqlite(`
      SELECT id, username, display_name, created_at, last_login_at, permissions, data_scope
      FROM admin_users
      ORDER BY created_at DESC
    `);

        // Parse JSON fields
        const parsedUsers = users.map(user => ({
            ...user,
            permissions: user.permissions ? JSON.parse(user.permissions) : {},
            dataScope: user.data_scope ? JSON.parse(user.data_scope) : {}
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
router.post('/', requirePermission('manage_users'), (req: AuthRequest, res: Response) => {
    try {
        const { username, password, displayName, permissions, dataScope } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码必填' });
        }

        // Check existing
        const existing = querySqlite(`SELECT id FROM admin_users WHERE username = ${sqlValue(username)}`);
        if (existing && existing.length > 0) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        const hash = hashPassword(password);
        const permJson = JSON.stringify(permissions || {});
        const scopeJson = JSON.stringify(dataScope || {});

        querySqlite(`
      INSERT INTO admin_users (username, password_hash, display_name, permissions, data_scope, created_at)
      VALUES (
        ${sqlValue(username)}, 
        ${sqlValue(hash)}, 
        ${sqlValue(displayName || username)}, 
        ${sqlValue(permJson)}, 
        ${sqlValue(scopeJson)}, 
        datetime('now')
      )
    `);

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
router.put('/:id', requirePermission('manage_users'), (req: AuthRequest, res: Response) => {
    try {
        const userId = req.params.id;
        const { password, displayName, permissions, dataScope } = req.body;

        // Prevent modifying super admin (id=1) casually, or at least be careful
        // For now, allow it but maybe warn? 
        // Usually ID 1 is protected.
        if (Number(userId) === 1 && req.user?.id !== 1) {
            return res.status(403).json({ error: '无法修改超级管理员' });
        }

        let updates: string[] = [];

        if (displayName) updates.push(`display_name = ${sqlValue(displayName)}`);
        if (permissions) updates.push(`permissions = ${sqlValue(JSON.stringify(permissions))}`);
        if (dataScope) updates.push(`data_scope = ${sqlValue(JSON.stringify(dataScope))}`);
        if (password && password.length >= 6) {
            updates.push(`password_hash = ${sqlValue(hashPassword(password))}`);
        }

        updates.push(`updated_at = datetime('now')`);

        if (updates.length === 0) {
            return res.json({ message: '无变更' });
        }

        querySqlite(`
      UPDATE admin_users 
      SET ${updates.join(', ')}
      WHERE id = ${sqlValue(userId)}
    `);

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
router.delete('/:id', requirePermission('manage_users'), (req: AuthRequest, res: Response) => {
    try {
        const userId = req.params.id;

        if (Number(userId) === 1) {
            return res.status(400).json({ error: '不能删除超级管理员' });
        }

        if (Number(userId) === req.user?.id) {
            return res.status(400).json({ error: '不能删除自己' });
        }

        querySqlite(`DELETE FROM admin_users WHERE id = ${sqlValue(userId)}`);

        res.json({ message: '用户删除成功' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: '删除用户失败' });
    }
});

export default router;
