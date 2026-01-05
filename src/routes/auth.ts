import express, { Request, Response } from 'express';
import { querySqlite, sqlValue, ensureSqliteMigrations } from '../config/sqlite';
import { generateToken, verifyPassword, hashPassword, authMiddleware, AuthRequest } from '../middleware/auth';

const router = express.Router();

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post('/login', (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }

    ensureSqliteMigrations();

    // Find user by username
    const users = querySqlite(`
      SELECT id, username, password_hash, display_name, permissions, data_scope
      FROM admin_users 
      WHERE username = ${sqlValue(username)}
    `);

    if (!users || users.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = users[0];

    // Verify password
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // Generate token
    const token = generateToken(user.id, user.username);

    // Update last login time
    querySqlite(`
      UPDATE admin_users 
      SET last_login_at = datetime('now') 
      WHERE id = ${sqlValue(user.id)}
    `);

    // Parse permissions and scope
    const permissions = user.permissions ? JSON.parse(user.permissions) : {};
    const dataScope = user.data_scope ? JSON.parse(user.data_scope) : {};

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name || user.username,
        permissions,
        dataScope
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

/**
 * POST /api/auth/reset-default-password
 * Reset password for users with the default bcrypt hash
 * This is a special endpoint to migrate from the insecure default password
 */
router.post('/reset-default-password', (req: Request, res: Response) => {
  try {
    const { username, currentPassword, newPassword, bootstrapToken } = req.body;

    if (!username || !currentPassword || !newPassword) {
      return res.status(400).json({ error: '请提供用户名、当前密码和新密码' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: '新密码长度至少8位' });
    }
    const expectedBootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (!expectedBootstrapToken || expectedBootstrapToken.length < 16) {
      return res.status(403).json({ error: 'ADMIN_BOOTSTRAP_TOKEN is missing or too short' });
    }

    if (bootstrapToken !== expectedBootstrapToken) {
      return res.status(403).json({ error: 'invalid_bootstrap_token' });
    }

    if (username !== 'admin') {
      return res.status(403).json({ error: 'reset_only_allowed_for_admin' });
    }


    ensureSqliteMigrations();

    const users = querySqlite(`
      SELECT id, username, password_hash
      FROM admin_users 
      WHERE username = ${sqlValue(username)}
    `);

    if (!users || users.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }

    const user = users[0];

    // Only allow this endpoint for bcrypt hashes (default password)
    if (!user.password_hash.startsWith('$2b$') && !user.password_hash.startsWith('$2a$')) {
      return res.status(400).json({ error: '密码格式不支持，请使用普通密码修改接口' });
    }

    // Verify the default password
    if (currentPassword !== 'admin123') {
      return res.status(401).json({ error: '当前密码错误' });
    }

    // Hash the new password with PBKDF2
    const newHash = hashPassword(newPassword);
    querySqlite(`
      UPDATE admin_users 
      SET password_hash = ${sqlValue(newHash)}, updated_at = datetime('now') 
      WHERE id = ${sqlValue(user.id)}
    `);

    res.json({ message: '密码重置成功，请使用新密码登录' });
  } catch (error) {
    console.error('Reset default password error:', error);
    res.status(500).json({ error: '密码重置失败' });
  }
});

/**
 * GET /api/auth/me
 * Get current user info (requires auth)
 */
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }

    const users = querySqlite(`
      SELECT id, username, display_name, created_at, last_login_at 
      FROM admin_users 
      WHERE id = ${sqlValue(req.user.id)}
    `);

    if (!users || users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const user = users[0];

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

/**
 * POST /api/auth/change-password
 * Change current user's password (requires auth)
 */
router.post('/change-password', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '请输入当前密码和新密码' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码长度至少6位' });
    }

    // Get current password hash
    const users = querySqlite(`
      SELECT password_hash 
      FROM admin_users 
      WHERE id = ${sqlValue(req.user.id)}
    `);

    if (!users || users.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // Verify current password
    if (!verifyPassword(currentPassword, users[0].password_hash)) {
      return res.status(401).json({ error: '当前密码错误' });
    }

    // Hash new password and update
    const newHash = hashPassword(newPassword);
    querySqlite(`
      UPDATE admin_users 
      SET password_hash = ${sqlValue(newHash)}, updated_at = datetime('now') 
      WHERE id = ${sqlValue(req.user.id)}
    `);

    res.json({ message: '密码修改成功' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: '密码修改失败' });
  }
});

/**
 * POST /api/auth/logout
 * Logout (client should discard token)
 */
router.post('/logout', (_req: Request, res: Response) => {
  // With stateless JWT-like tokens, logout is handled client-side
  // This endpoint exists for API completeness
  res.json({ message: '已退出登录' });
});

export default router;
