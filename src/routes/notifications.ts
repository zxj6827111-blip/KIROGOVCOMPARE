import express from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

const router = express.Router();
router.use(authMiddleware);

// Helper to safely parse JSON from DB
function parseDbJson(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function isNotificationAllowed(
  notification: { related_version_id?: number; related_job_id?: number; created_by?: number },
  allowedRegionIds: number[] | null,
  userId: number
): Promise<boolean> {
  if (!allowedRegionIds) return true;
  if (allowedRegionIds.length === 0) return false;

  if (notification.created_by && notification.created_by === userId) {
    return true;
  }

  if (notification.related_version_id) {
    const res = await pool.query(`
          SELECT 1
          FROM report_versions rv
          JOIN reports r ON rv.report_id = r.id
          WHERE rv.id = $1
            AND r.region_id = ANY($2::int[])
          LIMIT 1;
        `, [notification.related_version_id, allowedRegionIds]);
    return res.rows.length > 0;
  }

  if (notification.related_job_id) {
    const res = await pool.query(`
          SELECT 1
          FROM jobs j
          JOIN report_versions rv ON j.version_id = rv.id
          JOIN reports r ON rv.report_id = r.id
          WHERE j.id = $1
            AND r.region_id = ANY($2::int[])
          LIMIT 1;
        `, [notification.related_job_id, allowedRegionIds]);
    return res.rows.length > 0;
  }

  return false;
}

/**
 * GET /api/notifications
 * List notifications
 * Query params: unread_only (0|1)
 */
router.get('/notifications', async (req, res) => {
  try {
    const { unread_only } = req.query;
    const authReq = req as AuthRequest;
    const user = authReq.user;
    const allowedRegionIds = await getAllowedRegionIdsAsync(user);
    if (allowedRegionIds && allowedRegionIds.length === 0) {
      return res.json({ notifications: [] });
    }

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (unread_only === '1' || unread_only === 'true') {
      conditions.push('n.read_at IS NULL');
    }

    if (allowedRegionIds && user) {
      // Complex condition - handled by checking if related items are in scope OR created by user
      // We can pass allowedRegionIds as a parameter

      // This big condition needs careful parameterization
      // $1 = allowedRegionIds, $2 = userId
      // But wait, we might have previous params.
      // Let's construct it.

      conditions.push(`(
        (n.related_version_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM report_versions rv
          JOIN reports r ON rv.report_id = r.id
          WHERE rv.id = n.related_version_id AND r.region_id = ANY($${paramIndex}::int[])
        ))
        OR (n.related_job_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM jobs j
          JOIN report_versions rv ON j.version_id = rv.id
          JOIN reports r ON rv.report_id = r.id
          WHERE j.id = n.related_job_id AND r.region_id = ANY($${paramIndex}::int[])
        ))
        OR (n.created_by IS NOT NULL AND n.created_by = $${paramIndex + 1})
      )`);
      params.push(allowedRegionIds);
      params.push(user.id);
      paramIndex += 2;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
          SELECT 
            id,
            type,
            title,
            content_json,
            created_at,
            read_at,
            related_job_id,
            related_version_id,
            created_by
          FROM notifications n
          ${whereClause}
          ORDER BY created_at DESC;
        `;

    const result = await pool.query(query, params);
    const notifications = result.rows;

    // Parse content_json for easier frontend consumption
    const parsedNotifications = notifications.map((n: any) => {
      let content = {};
      content = parseDbJson(n.content_json) || {};

      return {
        id: n.id,
        type: n.type,
        title: n.title,
        content,
        content_json: n.content_json,
        created_at: n.created_at,
        read_at: n.read_at,
        is_read: !!n.read_at,
        related_job_id: n.related_job_id,
        related_version_id: n.related_version_id,
        created_by: n.created_by,
      };
    });

    return res.json({ notifications: parsedNotifications });
  } catch (error) {
    console.error('Error listing notifications:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark a notification as read
 */
router.post('/notifications/:id/read', async (req, res) => {
  try {
    const notificationId = Number(req.params.id);
    if (Number.isNaN(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }
    const authReq = req as AuthRequest;
    const user = authReq.user;
    const allowedRegionIds = await getAllowedRegionIdsAsync(user);
    if (allowedRegionIds && allowedRegionIds.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Check if notification exists
    const notifRes = await pool.query(`
          SELECT id, read_at, related_job_id, related_version_id, created_by
          FROM notifications
          WHERE id = $1 LIMIT 1;
        `, [notificationId]);

    const notification = notifRes.rows[0];

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (user && !(await isNotificationAllowed(notification, allowedRegionIds, user.id))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    if (notification.read_at) {
      return res.json({ message: 'Notification already marked as read', read_at: notification.read_at });
    }

    // Mark as read
    await pool.query(`
          UPDATE notifications
          SET read_at = NOW()
          WHERE id = $1;
        `, [notificationId]);

    return res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 */
router.post('/notifications/read-all', async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    const allowedRegionIds = await getAllowedRegionIdsAsync(user);
    if (allowedRegionIds && allowedRegionIds.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }

    let scopeClause = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (allowedRegionIds && user) {
      // WHERE read_at IS NULL AND (...)
      scopeClause = `
        AND (
          (related_version_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM report_versions rv
            JOIN reports r ON rv.report_id = r.id
            WHERE rv.id = notifications.related_version_id AND r.region_id = ANY($${paramIndex}::int[])
          ))
          OR (related_job_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM jobs j
            JOIN report_versions rv ON j.version_id = rv.id
            JOIN reports r ON rv.report_id = r.id
            WHERE j.id = notifications.related_job_id AND r.region_id = ANY($${paramIndex}::int[])
          ))
          OR (created_by IS NOT NULL AND created_by = $${paramIndex + 1})
        )
      `;
      params.push(allowedRegionIds);
      params.push(user.id);
    }

    await pool.query(`
          UPDATE notifications
          SET read_at = NOW()
          WHERE read_at IS NULL
          ${scopeClause};
        `, params);

    return res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
