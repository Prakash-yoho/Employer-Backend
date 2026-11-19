import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import {
    getLoginActivityUsers,
    getUserLoginHistory,
    getAllLoginHistory,
} from '../controllers/loginActivityController.js';

const router = express.Router();

// Admin-only: only EMPLOYER_ADMIN can view who is logged in and login history
router.use(authenticate, authorize(['EMPLOYER_ADMIN']));

// List of all users (employees + employer users) with their current login status
router.get('/users', getLoginActivityUsers);

// Flat feed of every login/logout session across all users
router.get('/history', getAllLoginHistory);

// Full login/logout history for one specific user
router.get('/users/:userModel/:userId/history', getUserLoginHistory);

export default router;
