import crypto from 'crypto';

// Mock the pool module before importing auth
jest.mock('../config/database-llm', () => ({
  query: jest.fn(),
}));

import {
  authMiddleware,
  generateToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  requirePermission,
  normalizePermissions,
} from '../middleware/auth';
import pool from '../config/database-llm';

const mockedQuery = pool.query as jest.Mock;

describe('Auth Permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ALLOW_TEST_AUTH;
  });

  describe('requirePermission', () => {
    const mockResponse = () => {
      const res: any = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      return res;
    };

    it('should return 401 if no user attached', () => {
      const req: any = {};
      const res = mockResponse();
      const next = jest.fn();

      const middleware = requirePermission('upload_reports');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() if user has the required permission', () => {
      const req: any = {
        user: {
          id: 2,
          username: 'testuser',
          permissions: { upload_reports: true },
        },
      };
      const res = mockResponse();
      const next = jest.fn();

      const middleware = requirePermission('upload_reports');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 if user lacks the required permission', () => {
      const req: any = {
        user: {
          id: 2,
          username: 'testuser',
          permissions: { view_reports: true },
        },
      };
      const res = mockResponse();
      const next = jest.fn();

      const middleware = requirePermission('upload_reports');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 if user has empty permissions object', () => {
      const req: any = {
        user: {
          id: 99,
          username: 'limiteduser',
          permissions: {},
        },
      };
      const res = mockResponse();
      const next = jest.fn();

      const middleware = requirePermission('manage_users');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should NOT bypass permission check for id=1 without explicit permission', () => {
      const req: any = {
        user: {
          id: 1,
          username: 'admin',
          permissions: {},
        },
      };
      const res = mockResponse();
      const next = jest.fn();

      const middleware = requirePermission('manage_users');
      middleware(req, res, next);

      // After our fix, id=1 without explicit permission should be denied
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow admin with explicit system_admin permission', () => {
      const req: any = {
        user: {
          id: 1,
          username: 'admin',
          permissions: {
            system_admin: true,
            manage_users: true,
            upload_reports: true,
          },
        },
      };
      const res = mockResponse();
      const next = jest.fn();

      const middleware = requirePermission('manage_users');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('authMiddleware permission normalization', () => {
    const mockResponse = () => {
      const res: any = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      return res;
    };

    it('should not grant implicit permissions to legacy admin with empty permissions', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 1,
          username: 'admin',
          display_name: 'System Admin',
          permissions: {},
          data_scope: {},
        }],
      } as any);

      const token = generateToken(1, 'admin');
      const req: any = { headers: { authorization: `Bearer ${token}` } };
      const res = mockResponse();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.permissions).toEqual({});
    });

    it('should preserve empty permissions for non-admin users', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 7,
          username: 'auditor',
          display_name: 'Auditor',
          permissions: {},
          data_scope: {},
        }],
      } as any);

      const token = generateToken(7, 'auditor');
      const req: any = { headers: { authorization: `Bearer ${token}` } };
      const res = mockResponse();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.permissions).toEqual({});
    });

    it('should normalize legacy manage_cities into manage_regions', async () => {
      mockedQuery.mockResolvedValueOnce({
        rows: [{
          id: 8,
          username: 'legacy-user',
          display_name: 'Legacy User',
          permissions: { manage_cities: true },
          data_scope: {},
        }],
      } as any);

      const token = generateToken(8, 'legacy-user');
      const req: any = { headers: { authorization: `Bearer ${token}` } };
      const res = mockResponse();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user.permissions.manage_regions).toBe(true);
      expect(req.user.permissions.manage_cities).toBeUndefined();
    });

    it('should apply the same normalization for login-time permission payloads', () => {
      expect(normalizePermissions({})).toEqual({});

      expect(normalizePermissions({ manage_cities: true })).toEqual({
        manage_regions: true,
      });
    });
  });

  describe('Token operations', () => {
    it('should generate and verify a valid token', () => {
      const token = generateToken(1, 'admin');
      const decoded = verifyToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe(1);
      expect(decoded!.username).toBe('admin');
    });

    it('should reject an expired token', () => {
      // Generate a token with past expiry
      const payload = {
        id: 1,
        username: 'admin',
        exp: Date.now() - 1000, // expired 1 second ago
      };
      const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = crypto
        .createHmac('sha256', 'dev-only-insecure-key-min-32-chars!!')
        .update(payloadStr)
        .digest('base64url');
      const expiredToken = `${payloadStr}.${signature}`;

      const decoded = verifyToken(expiredToken);
      expect(decoded).toBeNull();
    });
  });

  describe('Password operations', () => {
    it('should hash and verify password correctly', () => {
      const password = 'testpassword123';
      const hash = hashPassword(password);

      expect(verifyPassword(password, hash)).toBe(true);
      expect(verifyPassword('wrongpassword', hash)).toBe(false);
    });

    it('should reject bcrypt format passwords', () => {
      const bcryptHash = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ12';
      expect(verifyPassword('anypassword', bcryptHash)).toBe(false);
    });
  });

});
