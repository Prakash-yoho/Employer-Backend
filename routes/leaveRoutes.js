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
    createPermissionRequest,
    getMyPermissions,
    getAllPermissions,
    updatePermissionStatus,
    cancelPermissionRequest,
    createLeavePolicy,
    getLeavePolicy,
    updateLeavePolicy,
    deleteLeavePolicy,
    createHoliday,
    getHolidays,
    updateHoliday,
    deleteHoliday
} from '../controllers/leaveController.js';

const router = express.Router();

// ─── EMPLOYEE: Leave ──────────────────────────────────────────────────────────
router.post('/', authenticateEmployee, createLeaveRequest);
router.get('/holidays', getHolidays);
router.get('/policy', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), getLeavePolicy);
router.get('/me', authenticateEmployee, getMyLeaveRequests);
router.get('/me/balance', authenticateEmployee, getLeaveBalance);
router.get('/upcoming', authenticateEmployee, getUpcomingLeaves);
router.get('/me/:leaveRequestId', authenticateEmployee, getLeaveRequestById);
router.delete('/me/:leaveRequestId/cancel', authenticateEmployee, cancelLeaveRequest);

// ─── EMPLOYEE: Permission ─────────────────────────────────────────────────────
router.post('/permission', authenticateEmployee, createPermissionRequest);
router.get('/permission/me', authenticateEmployee, getMyPermissions);
router.delete('/permission/me/:requestId/cancel', authenticateEmployee, cancelPermissionRequest);

// ─── HR/ADMIN: Permission ─────────────────────────────────────────────────────
router.get('/permission', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), getAllPermissions);
router.patch('/permission/:requestId/status', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), updatePermissionStatus);

// ─── HR/ADMIN: Leave ──────────────────────────────────────────────────────────
router.get('/', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), getAllLeaveRequests);
router.get('/:leaveRequestId', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), getLeaveRequestById);
router.patch('/:leaveRequestId/status', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), updateLeaveStatus);

// ─── Leave Policy CRUD (HR/Admin only) ───────────────────────────────────────
router.post('/policy', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), createLeavePolicy);
router.patch('/policy/:id', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), updateLeavePolicy);
router.delete('/policy/:id', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), deleteLeavePolicy);

// ─── Holidays (HR/Admin: CRUD, Employees: read) ───────────────────────────────
router.post('/holidays', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), createHoliday);
router.put('/holidays/:id', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), updateHoliday);
router.delete('/holidays/:id', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), deleteHoliday);

// ─── Statistics ───────────────────────────────────────────────────────────────
router.get('/statistics/overview', authenticate, getLeaveStatistics);

export default router;