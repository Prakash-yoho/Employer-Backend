import express from 'express';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';
import {
    createLeaveRequest,
    getMyLeaveRequests,
    getLeaveRequestById,
    getAllLeaveRequests,
    updateLeaveStatus,
    getLeaveStatistics,
    getLeaveBalance,
    cancelLeaveRequest,
    getUpcomingLeaves
} from '../controllers/leaveController.js';

const router = express.Router();

// EMPLOYEE ROUTES
router.post(
    '/',
    authenticateEmployee,
    createLeaveRequest
);

router.get(
    '/me',
    authenticateEmployee,
    getMyLeaveRequests
);

router.get(
    '/me/balance',
    authenticateEmployee,
    getLeaveBalance
);

router.get(
    '/upcoming',
    authenticateEmployee,
    getUpcomingLeaves
);

router.get(
    '/me/:leaveRequestId',
    authenticateEmployee,
    getLeaveRequestById
);

router.delete(
    '/me/:leaveRequestId/cancel',
    authenticateEmployee,
    cancelLeaveRequest
);

// HR/ADMIN ROUTES
router.get(
    '/',
    authenticate,
    authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']),
    getAllLeaveRequests
);

router.get(
    '/:leaveRequestId',
    authenticate,
    authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']),
    getLeaveRequestById
);

router.patch(
    '/:leaveRequestId/status',
    authenticate,
    authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']),
    updateLeaveStatus
);

// STATISTICS ROUTES
router.get(
    '/statistics/overview',
    authenticate,
    getLeaveStatistics
);

export default router;