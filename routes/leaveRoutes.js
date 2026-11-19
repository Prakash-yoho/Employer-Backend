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
    getUpcomingLeaves,
    getAllLeavesForCalc,
    getCLAllocationDetailController,
    getBlockedDates,
} from '../controllers/leaveController.js';


const router = express.Router();

// ─── EMPLOYEE: Leave ──────────────────────────────────────────────────────────
router.post('/', authenticateEmployee, createLeaveRequest);
router.get('/me/cl-detail', authenticateEmployee, getCLAllocationDetailController);
router.get('/me/all-for-calc', authenticateEmployee, getAllLeavesForCalc);
router.get('/me/balance', authenticateEmployee, getLeaveBalance);
router.get('/me', authenticateEmployee, getMyLeaveRequests);
router.get('/me/:leaveRequestId', authenticateEmployee, getLeaveRequestById);
router.put('/me/:leaveRequestId/cancel', authenticateEmployee, cancelLeaveRequest);
router.get('/upcoming', authenticateEmployee, getUpcomingLeaves);
router.get('/blocked-dates', authenticateEmployee, getBlockedDates);

// ─── HR/ADMIN: Leave ──────────────────────────────────────────────────────────
router.get('/', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), getAllLeaveRequests);
router.get('/statistics/overview', authenticate, getLeaveStatistics);
router.get('/:leaveRequestId', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), getLeaveRequestById);
router.patch('/:leaveRequestId/status', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), updateLeaveStatus);



export default router;