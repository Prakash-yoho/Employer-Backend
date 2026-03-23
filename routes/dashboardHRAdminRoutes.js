import express from 'express';
import {
    getDashboardStats,
    getOnboardingProgress,
    getRecentActivity
} from '../controllers/Employer/dashboardHRAdminController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require HR/Admin access
router.use(authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']));

// Get dashboard statistics
router.get('/stats', getDashboardStats);

// Get onboarding progress for all employees
router.get('/onboarding-progress', getOnboardingProgress);

// Get recent activity
router.get('/recent-activity', getRecentActivity);

export default router;