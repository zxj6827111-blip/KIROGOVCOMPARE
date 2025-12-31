import express from 'express';
import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';

const router = express.Router();

/**
 * GET /api/notifications
 * List notifications
 * Query params: unread_only (0|1)
 */
router.get('/notifications', (req, res) => {
    try {
        ensureSqliteMigrations();

        const { unread_only } = req.query;

        let whereClause = '';
        if (unread_only === '1' || unread_only === 'true') {
            whereClause = 'WHERE read_at IS NULL';
        }

        const notifications = querySqlite(`
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
      FROM notifications
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
            try {
                content = JSON.parse(n.content_json);
            } catch (error) {
                console.error(`Failed to parse notification ${n.id} content_json:`, error);
            }

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
router.post('/notifications/:id/read', (req, res) => {
    try {
        ensureSqliteMigrations();

        const notificationId = Number(req.params.id);
        if (Number.isNaN(notificationId)) {
            return res.status(400).json({ error: 'Invalid notification ID' });
        }

        // Check if notification exists
        const notification = querySqlite(`
      SELECT id, read_at FROM notifications WHERE id = ${sqlValue(notificationId)} LIMIT 1;
    `)[0] as { id: number; read_at?: string } | undefined;

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        if (notification.read_at) {
            return res.json({ message: 'Notification already marked as read', read_at: notification.read_at });
        }

        // Mark as read
        querySqlite(`
      UPDATE notifications
      SET read_at = datetime('now')
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
router.post('/notifications/read-all', (req, res) => {
    try {
        ensureSqliteMigrations();

        const result = querySqlite(`
      UPDATE notifications
      SET read_at = datetime('now')
      WHERE read_at IS NULL;
    `);

        return res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
