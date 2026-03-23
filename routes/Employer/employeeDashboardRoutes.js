import express from 'express';
import {
    getEmployeeDashboard,
    getEmployerDashboard,
    getAdminOverview
} from '../../controllers/Employer/employeeDashboardController.js';
import { authenticate, authenticateEmployee, authorize } from '../../middleware/Employer/authMiddleware.js';

const router = express.Router();

// Employee dashboard (authenticated employees only)
router.get(
    '/',
    authenticateEmployee,
    getEmployeeDashboard
);

// Employer dashboard (authenticated HR/Admin/IT users)
router.get(
    '/employer',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    getEmployerDashboard
);

// Admin overview statistics (Admin only)
router.get(
    '/admin/overview',
    authenticate,
    authorize(['EMPLOYER_ADMIN']),
    getAdminOverview
);

export default router;