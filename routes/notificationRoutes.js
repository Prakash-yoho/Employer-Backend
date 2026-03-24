import express from 'express';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';
import {
    getMyNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    getUnreadCount,
    getNotificationStatistics
} from '../controllers/notificationController.js';

const router = express.Router();

// EMPLOYEE ROUTES
router.get(
    '/me',
    authenticateEmployee,
    getMyNotifications
);

router.get(
    '/me/unread-count',
    authenticateEmployee,
    getUnreadCount
);

router.patch(
    '/:notificationId/read',
    authenticateEmployee,
    markNotificationAsRead
);

router.patch(
    '/me/read-all',
    authenticateEmployee,
    markAllNotificationsAsRead
);

router.delete(
    '/:notificationId',
    authenticateEmployee,
    deleteNotification
);

// EMPLOYER ROUTES (Admin, HR, IT)
router.get(
    '/',
    authenticate,
   authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER']),
    getMyNotifications
);

router.get(
    '/unread-count',
    authenticate,
   authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER']),
    getUnreadCount
);

router.patch(
    '/employer/:notificationId/read',
    authenticate,
   authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER']),
    markNotificationAsRead
);

router.patch(
    '/employer/read-all',
    authenticate,
   authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER']),
    markAllNotificationsAsRead
);

router.delete(
    '/employer/:notificationId',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT,"PROJECT_MANAGER"']),
    deleteNotification
);

// ADMIN ONLY
router.get(
    '/statistics',
    authenticate,
    authorize(['EMPLOYER_ADMIN']),
    getNotificationStatistics
);

export default router;
