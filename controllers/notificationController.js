import Notification from '../model/Notification.js';
import NotificationService from '../services/notificationService.js';

// Get notifications for current user
export const getMyNotifications = async (req, res) => {
    try {
        const { limit = 20, skip = 0, status, type } = req.query;
        const user = req.user;

        let userType;
        if (user.role === 'Employee' || user.role === 'EMPLOYEE') {
            userType = 'EMPLOYEE';
        } else if (user.role && user.role.startsWith('EMPLOYER_')) {
            userType = user.role;
        } else {
            userType = 'EMPLOYEE';
        }

        const notifications = await NotificationService.getUserNotifications(
            user._id,
            userType,
            {
                limit: parseInt(limit),
                skip: parseInt(skip),
                status,
                type
            }
        );

        res.json({
            success: true,
            count: notifications.length,
            notifications
        });
    } catch (error) {
        console.error('Error getting notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching notifications',
            error: error.message
        });
    }
};

// Get unread notification count
export const getUnreadCount = async (req, res) => {
    try {
        const user = req.user;

        let userType;
        if (user.role === 'Employee' || user.role === 'EMPLOYEE') {
            userType = 'EMPLOYEE';
        } else if (user.role && user.role.startsWith('EMPLOYER_')) {
            userType = user.role;
        } else {
            userType = 'EMPLOYEE';
        }

        const count = await NotificationService.getUnreadCount(user._id, userType);

        res.json({
            success: true,
            count
        });
    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting unread count',
            error: error.message
        });
    }
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const user = req.user;
        // Verify notification belongs to user
        const notification = await Notification.findById(notificationId);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        // Check if user is recipient
        const isRecipient =
            (notification.recipientId && notification.recipientId.equals(user._id)) ||
            notification.recipientType === 'ALL';

        if (!isRecipient) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to mark this notification as read'
            });
        }

        await NotificationService.markAsRead(notificationId);

        res.json({
            success: true,
            message: 'Notification marked as read'
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({
            success: false,
            message: 'Error marking notification as read',
            error: error.message
        });
    }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
    try {
        const user = req.user;
        let userType;

        if (user.role === 'Employee' || user.role === 'EMPLOYEE') {
            userType = 'EMPLOYEE';
        } else if (user.role && user.role.startsWith('EMPLOYER_')) {
            userType = user.role;
        } else {
            userType = 'EMPLOYEE';
        }

        const result = await NotificationService.markAllAsRead(
            user._id,
            userType
        );

        res.json({
            success: true,
            message: 'All notifications marked as read',
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({
            success: false,
            message: 'Error marking all notifications as read',
            error: error.message
        });
    }
};

// Delete notification
export const deleteNotification = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const user = req.user;

        // Verify notification belongs to user
        const notification = await Notification.findById(notificationId);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        // Check if user is recipient
        const isRecipient =
            (notification.recipientId && notification.recipientId.equals(user._id)) ||
            notification.recipientType === 'ALL';

        if (!isRecipient) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete this notification'
            });
        }

        await notification.deleteOne();

        res.json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting notification',
            error: error.message
        });
    }
};

// Get notification statistics (Admin only)
export const getNotificationStatistics = async (req, res) => {
    try {
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const startOfWeek = new Date(today.setDate(today.getDate() - 7));
        const startOfMonth = new Date(today.setDate(today.getDate() - 30));

        // Total notifications
        const total = await Notification.countDocuments();

        // Unread notifications
        const unread = await Notification.countDocuments({ status: 'unread' });

        // Today's notifications
        const todayCount = await Notification.countDocuments({
            createdAt: { $gte: startOfDay }
        });

        // This week's notifications
        const weekCount = await Notification.countDocuments({
            createdAt: { $gte: startOfWeek }
        });

        // This month's notifications
        const monthCount = await Notification.countDocuments({
            createdAt: { $gte: startOfMonth }
        });

        // By type
        const byType = await Notification.aggregate([
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);

        // By recipient type
        const byRecipient = await Notification.aggregate([
            {
                $group: {
                    _id: '$recipientType',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);

        res.json({
            success: true,
            statistics: {
                total,
                unread,
                today: todayCount,
                week: weekCount,
                month: monthCount,
                byType,
                byRecipient
            }
        });
    } catch (error) {
        console.error('Error getting notification statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting notification statistics',
            error: error.message
        });
    }
};

