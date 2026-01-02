import React, { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import './NotificationCenter.css';
import { apiClient } from '../apiClient';

function NotificationCenter() {
    const [notifications, setNotifications] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        loadNotifications();
        // Reload every 30 seconds
        const interval = setInterval(loadNotifications, 30000);
        return () => clearInterval(interval);
    }, []);

    const loadNotifications = async () => {
        try {
            const resp = await apiClient.get('/notifications');
            const notifs = resp.data?.notifications ?? [];
            setNotifications(notifs);
            setUnreadCount(notifs.filter((n) => !n.is_read).length);
        } catch (error) {
            console.error('Failed to load notifications:', error);
        }
    };

    const handleMarkAsRead = async (notificationId) => {
        try {
            await apiClient.post(`/notifications/${notificationId}/read`);
            loadNotifications();
        } catch (error) {
            console.error('Failed to mark notification as read:', error);
        }
    };

    const handleMarkAllAsRead = async () => {
        try {
            await apiClient.post('/notifications/read-all');
            loadNotifications();
        } catch (error) {
            console.error('Failed to mark all as read:', error);
        }
    };

    const handleNotificationClick = (notification) => {
        // Mark as read
        if (!notification.is_read) {
            handleMarkAsRead(notification.id);
        }

        // Navigate to task link if available
        if (notification.content?.task_link) {
            window.location.href = notification.content.task_link;
        }

        setIsOpen(false);
    };

    const renderNotificationContent = (notification) => {
        const content = notification.content || {};
        const uploadedCount = content.uploaded_count || 0;
        const successCount = content.success_count || 0;
        const failList = content.fail_list || [];

        return (
            <div className="notification-content">
                <div className="notification-summary">
                    上传了 <strong>{uploadedCount}</strong> 份报告，成功 <strong>{successCount}</strong> 份
                    {failList.length > 0 && (
                        <>
                            ，失败 <strong>{failList.length}</strong> 份
                        </>
                    )}
                </div>
                {failList.length > 0 && (
                    <div className="notification-failures">
                        <strong>失败清单：</strong>
                        <ul>
                            {failList.map((fail, idx) => (
                                <li key={idx}>
                                    {fail.region_id} / {fail.year} / {fail.unit_name}: {fail.reason}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="notification-center">
            <button className="notification-bell" onClick={() => setIsOpen(!isOpen)}>
                <Bell size={18} /> 消息
                {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
            </button>

            {isOpen && (
                <div className="notification-dropdown">
                    <div className="notification-header">
                        <h3>消息中心</h3>
                        {unreadCount > 0 && (
                            <button className="btn-mark-all-read" onClick={handleMarkAllAsRead}>
                                全部已读
                            </button>
                        )}
                    </div>

                    <div className="notification-list">
                        {notifications.length === 0 ? (
                            <div className="notification-empty">暂无消息</div>
                        ) : (
                            notifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    className={`notification-item ${notification.is_read ? 'read' : 'unread'}`}
                                    onClick={() => handleNotificationClick(notification)}
                                >
                                    <div className="notification-title">{notification.title}</div>
                                    {renderNotificationContent(notification)}
                                    <div className="notification-time">
                                        {new Date(notification.created_at).toLocaleString('zh-CN')}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default NotificationCenter;
