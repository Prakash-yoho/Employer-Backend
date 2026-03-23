import express from 'express';
import { authenticate } from '../../middleware/Employer/authMiddleware.js';
import { authorize } from '../../middleware/Employer/authMiddleware.js';
import { createAdminEmployerUser, createEmployerUser, employerAdminLogin, employerUserLogin, employerUserLogout, getAllEmployerUsers, getEmployerUserById, getMyProfile, hardDeleteEmployerUser, projectManagerLogin, reactivateEmployerUser, softDeleteEmployerUser, updateEmployerUser, updateMyProfile } from '../../controllers/Employer/employerUserController.js';

const router = express.Router();
// Public route to initialize admin user
router.post('/init-admin', createAdminEmployerUser);

// Login routes
router.post('/admin/login', employerAdminLogin);
router.post('/employer/login', employerUserLogin);
router.post('/projectmanager/login', projectManagerLogin)

// All routes below require authentication
router.use(authenticate);

// Logout route
router.post('/logout', employerUserLogout)

// Profile routes (accessible by all authenticated users)
router.get('/', getAllEmployerUsers);
router.get('/:id', getEmployerUserById);
router.get('/profile/me', getMyProfile);
router.put('/profile/me', updateMyProfile);

// Admin-only management routes
router.post('/', authorize(['EMPLOYER_ADMIN']), createEmployerUser);
router.put('/:id', authorize(['EMPLOYER_ADMIN']), updateEmployerUser);
router.delete('/:id', authorize(['EMPLOYER_ADMIN']), softDeleteEmployerUser);
router.delete('/:id/hard', authorize(['EMPLOYER_ADMIN']), hardDeleteEmployerUser);
router.patch('/:id/reactivate', authorize(['EMPLOYER_ADMIN']), reactivateEmployerUser);

export default router;