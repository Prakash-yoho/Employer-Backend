import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import { getComprehensiveITDashboard } from '../controllers/itDashboardController.js'

const router = express.Router();

// All routes require IT Support access
router.use(authenticate, authorize(['EMPLOYER_IT']));

// Get comprehensive IT dashboard (all data in one call)
router.get('/', getComprehensiveITDashboard);

export default router;