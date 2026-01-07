import express from 'express';
import { dbNowExpression, dbQuery, ensureDbMigrations, parseDbJson } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIds, getAllowedRegionIdsAsync } from '../utils/dataScope';

const router = express.Router();
router.use(authMiddleware);

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
        const row = (await dbQuery(`
      SELECT 1
      FROM report_versions rv
      JOIN reports r ON rv.report_id = r.id
      WHERE rv.id = ${sqlValue(notification.related_version_id)}
        AND r.region_id IN (${allowedRegionIds.join(',')})
      LIMIT 1;
    `))[0];
        return !!row;
    }

    if (notification.related_job_id) {
        const row = (await dbQuery(`
      SELECT 1
      FROM jobs j
      JOIN report_versions rv ON j.version_id = rv.id
      JOIN reports r ON rv.report_id = r.id
      WHERE j.id = ${sqlValue(notification.related_job_id)}
        AND r.region_id IN (${allowedRegionIds.join(',')})
      LIMIT 1;
    `))[0];
        return !!row;
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
        ensureDbMigrations();

        const { unread_only } = req.query;
        const authReq = req as AuthRequest;
        const user = authReq.user;
        const allowedRegionIds = await getAllowedRegionIdsAsync(user);
        if (allowedRegionIds && allowedRegionIds.length === 0) {
            return res.json({ notifications: [] });
        }

        const conditions: string[] = [];
        if (unread_only === '1' || unread_only === 'true') {
            conditions.push('n.read_at IS NULL');
        }
        if (allowedRegionIds && user) {
            const allowed = allowedRegionIds.join(',');
            conditions.push(`(
        (n.related_version_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM report_versions rv
          JOIN reports r ON rv.report_id = r.id
          WHERE rv.id = n.related_version_id AND r.region_id IN (${allowed})
        ))
        OR (n.related_job_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM jobs j
          JOIN report_versions rv ON j.version_id = rv.id
          JOIN reports r ON rv.report_id = r.id
          WHERE j.id = n.related_job_id AND r.region_id IN (${allowed})
        ))
        OR (n.created_by IS NOT NULL AND n.created_by = ${sqlValue(user.id)})
      )`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const notifications = await dbQuery(`
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
    `) as Array<{
            id: number;
            type: string;
            title: string;
            content_json: string;
            created_at: string;
            read_at?: string;
            related_job_id?: number;
            related_version_id?: number;
            created_by?: number;
        }>;

        // Parse content_json for easier frontend consumption
        const parsedNotifications = notifications.map((n) => {
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
        ensureDbMigrations();

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
        const notification = (await dbQuery(`
      SELECT id, read_at, related_job_id, related_version_id, created_by
      FROM notifications
      WHERE id = ${sqlValue(notificationId)} LIMIT 1;
    `))[0] as { id: number; read_at?: string; related_job_id?: number; related_version_id?: number; created_by?: number } | undefined;

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
        await dbQuery(`
      UPDATE notifications
      SET read_at = ${dbNowExpression()}
      WHERE id = ${sqlValue(notificationId)};
    `);

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
        ensureDbMigrations();

        const authReq = req as AuthRequest;
        const user = authReq.user;
        const allowedRegionIds = await getAllowedRegionIdsAsync(user);
        if (allowedRegionIds && allowedRegionIds.length === 0) {
            return res.status(403).json({ error: 'forbidden' });
        }

        let scopeClause = '';
        if (allowedRegionIds && user) {
            const allowed = allowedRegionIds.join(',');
            scopeClause = `
        AND (
          (related_version_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM report_versions rv
            JOIN reports r ON rv.report_id = r.id
            WHERE rv.id = notifications.related_version_id AND r.region_id IN (${allowed})
          ))
          OR (related_job_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM jobs j
            JOIN report_versions rv ON j.version_id = rv.id
            JOIN reports r ON rv.report_id = r.id
            WHERE j.id = notifications.related_job_id AND r.region_id IN (${allowed})
          ))
          OR (created_by IS NOT NULL AND created_by = ${sqlValue(user.id)})
        )
      `;
        }

        await dbQuery(`
      UPDATE notifications
      SET read_at = ${dbNowExpression()}
      WHERE read_at IS NULL
      ${scopeClause};
    `);

        return res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;


