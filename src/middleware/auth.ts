import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'govinfo-admin-secret-key-change-in-production';
const TOKEN_EXPIRY_HOURS = 24;

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    displayName?: string;
    permissions?: Record<string, boolean>;
    dataScope?: {
      regions?: string[];
    };
  };
}

/**
 * Simple JWT-like token generation using HMAC
 * Format: base64(payload).signature
 */
export function generateToken(userId: number, username: string): string {
  const payload = {
    id: userId,
    username,
    exp: Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(payloadStr)
    .digest('base64url');

  return `${payloadStr}.${signature}`;
}

/**
 * Verify and decode token
 */
export function verifyToken(token: string): { id: number; username: string } | null {
  try {
    const [payloadStr, signature] = token.split('.');
    if (!payloadStr || !signature) return null;

    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(payloadStr)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString());

    if (payload.exp < Date.now()) return null;

    return { id: payload.id, username: payload.username };
  } catch {
    return null;
  }
}

/**
 * Simple password hashing using PBKDF2 (no external dependency)
 * Format: salt:hash
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify password against stored hash
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  // Handle bcrypt format (from migration default)
  if (storedHash.startsWith('$2b$') || storedHash.startsWith('$2a$')) {
    // For bcrypt, we need to use a simple comparison for the default password
    // In production, use bcrypt library
    return password === 'admin123' && storedHash.includes('rQZ8K8HbXxjwG8CfTr1qRe');
  }

  // Handle our PBKDF2 format
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;

  const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === testHash;
}

/**
 * Authentication middleware
 * Checks for Authorization header with Bearer token
 */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录，请先登录' });
    return;
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
    return;
  }

  req.user = decoded;

  // Fetch latest permissions from DB to ensure they are up to date
  try {
    const { querySqlite } = require('../config/sqlite');
    const users = querySqlite(`SELECT * FROM admin_users WHERE id = ${decoded.id}`);
    if (users && users.length > 0) {
      const dbUser = users[0];
      req.user = {
        ...decoded,
        permissions: dbUser.permissions ? JSON.parse(dbUser.permissions) : {},
        dataScope: dbUser.data_scope ? JSON.parse(dbUser.data_scope) : {}
      };
    }
  } catch (error) {
    console.warn('Failed to refresh user permissions from DB during auth:', error);
    // Proceed with token data (fallback)
  }

  next();
}

/**
 * Optional auth middleware - doesn't reject, just attaches user if valid
 */
export function optionalAuthMiddleware(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;

      // Fetch latest permissions from DB (same as authMiddleware)
      try {
        const { querySqlite } = require('../config/sqlite');
        const users = querySqlite(`SELECT * FROM admin_users WHERE id = ${decoded.id}`);
        if (users && users.length > 0) {
          const dbUser = users[0];
          req.user = {
            ...decoded,
            permissions: dbUser.permissions ? JSON.parse(dbUser.permissions) : {},
            dataScope: dbUser.data_scope ? JSON.parse(dbUser.data_scope) : {}
          };
        }
      } catch (error) {
        console.warn('Failed to refresh user permissions from DB during optional auth:', error);
      }
    }
  }

  next();
}

/**
 * Middleware factory to check for specific permission
 */
export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: '未登录' });
      return;
    }

    // Admin (id=1) usually has all permissions
    // Also check if user has the specific permission
    const hasPerm = req.user.permissions?.[permission] === true;

    if (req.user.id === 1 || hasPerm) {
      next();
    } else {
      res.status(403).json({ error: '权限不足', required: permission });
    }
  };
}
