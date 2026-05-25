import pool from '../config/database-llm';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// SECURITY: JWT_SECRET must be set via environment variable
const JWT_SECRET_ENV = process.env.JWT_SECRET;
if (!JWT_SECRET_ENV || JWT_SECRET_ENV.length < 32) {
  console.error('FATAL: JWT_SECRET environment variable must be set with at least 32 characters');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}
// Use a safe fallback for dev/test only - production exits above
const JWT_SECRET: string = JWT_SECRET_ENV || 'dev-only-insecure-key-min-32-chars!!';
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

export const REGION_MANAGEMENT_PERMISSION = 'manage_regions';

// Default admin permissions - used by bootstrap scripts, not as a runtime bypass.
export const ADMIN_DEFAULT_PERMISSIONS: Record<string, boolean> = {
  upload_reports: true,
  view_reports: true,
  manage_users: true,
  [REGION_MANAGEMENT_PERMISSION]: true,
  manage_jobs: true,
  delete_reports: true,
  system_admin: true,
};

/**
 * Normalize legacy permission keys before permission checks.
 * We keep backward compatibility for stored JSON, but only expose one canonical key.
 */
export function normalizePermissions(permissions: Record<string, boolean> | null | undefined): Record<string, boolean> {
  const normalized = permissions && typeof permissions === 'object' ? { ...permissions } : {};

  if (normalized.manage_cities === true && normalized[REGION_MANAGEMENT_PERMISSION] !== true) {
    normalized[REGION_MANAGEMENT_PERMISSION] = true;
  }
  delete normalized.manage_cities;

  return normalized;
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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

export function generateExpiringToken(userId: number, username: string, ttlMs: number): string {
  const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;
  const payload = {
    id: userId,
    username,
    exp: Date.now() + safeTtl,
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

    if (!timingSafeEqualString(signature, expectedSig)) return null;

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
 * SECURITY: Removed hardcoded password bypass - users must change default password
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  // Handle bcrypt format (from migration default)
  if (storedHash.startsWith('$2b$') || storedHash.startsWith('$2a$')) {
    // SECURITY FIX: Do not allow default bcrypt password
    // Users MUST change their password using the change-password endpoint first
    // The migration inserts a bcrypt hash, but we only support PBKDF2 for verification
    console.warn('SECURITY: Bcrypt password detected. User must change password via /api/auth/reset-default-password');
    return false;
  }

  // Handle our PBKDF2 format
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;

  const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return timingSafeEqualString(hash, testHash);
}

/**
 * Authentication middleware
 * Checks for Authorization header with Bearer token
 */
export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // Allow CI/test mode to bypass authentication ONLY when explicitly enabled
  // SECURITY: NODE_ENV=test alone is not sufficient; ALLOW_TEST_AUTH must also be set
  if (process.env.NODE_ENV === 'test' && process.env.ALLOW_TEST_AUTH === '1') {
    req.user = {
      id: 1,
      username: 'ci-test-user',
      permissions: {
        upload_reports: true,
        view_reports: true,
        manage_users: true,
        manage_regions: true,
        manage_jobs: true,
        delete_reports: true,
      },
      dataScope: {}
    };
    next();
    return;
  }

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

  // Fetch latest user info/permissions from DB
  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE id = $1', [decoded.id]);
    const users: any[] = result.rows;
    if (users && users.length > 0) {
      const dbUser = users[0];
      // PostgreSQL jsonb returns objects directly.
      const parseJsonField = (val: any) => {
        if (!val) return {};
        if (typeof val === 'object') return val;
        try { return JSON.parse(val); } catch { return {}; }
      };
      const rawPermissions = parseJsonField(dbUser.permissions);
      req.user = {
        ...decoded,
        displayName: dbUser.display_name,
        permissions: normalizePermissions(rawPermissions),
        dataScope: parseJsonField(dbUser.data_scope)
      };
    }
  } catch (error) {
    console.warn('Failed to refresh user permissions from DB during auth:', error);
  }

  next();
}

/**
 * Optional auth middleware - doesn't reject, just attaches user if valid
 */
export async function optionalAuthMiddleware(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;

      // Fetch latest user info/permissions from DB
      try {
        const result = await pool.query('SELECT * FROM admin_users WHERE id = $1', [decoded.id]);
        const users: any[] = result.rows;
        if (users && users.length > 0) {
          const dbUser = users[0];
          // PostgreSQL jsonb returns objects directly.
          const parseJsonField = (val: any) => {
            if (!val) return {};
            if (typeof val === 'object') return val;
            try { return JSON.parse(val); } catch { return {}; }
          };
          const rawPermissions = parseJsonField(dbUser.permissions);
          req.user = {
            ...decoded,
            displayName: dbUser.display_name,
            permissions: normalizePermissions(rawPermissions),
            dataScope: parseJsonField(dbUser.data_scope)
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

    // Check if user has the specific permission
    const hasPerm = req.user.permissions?.[permission] === true;

    if (hasPerm) {
      next();
    } else {
      res.status(403).json({ error: '权限不足', required: permission });
    }
  };
}
