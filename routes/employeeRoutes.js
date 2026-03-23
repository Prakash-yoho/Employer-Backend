import express from 'express';
import { cancelUpdateRequest, changeEmployeePassword, createEmployee, deleteEmployeeImage, deleteEmployeeImageByAdmin, employeeLogin, employeeLogout, getAllEmployees, getEmployeeById, getEmployeeProfile, getEmployeesWithUpdateRequests, requestProfileUpdate, resetEmployeeUpdateStatus, updateEmployeeByAdmin, updateEmployeeImageByAdmin, updateEmployeeProfile, updateEmployeeStatus, uploadEmployeeImage } from '../controllers/Employer/employeeController.js';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';
import upload, { handleMulterError } from '../config/imageMulter.js'

const router = express.Router();

// Employee Public routes
router.post('/login', employeeLogin);

// Employee protected routes (require employee authentication)
router.use('/profile', authenticateEmployee);

router.get('/profile/me', getEmployeeProfile);
router.put('/profile/me', updateEmployeeProfile);
router.post('/profile/update-request', requestProfileUpdate);
router.post('/profile/cancel-update-request', cancelUpdateRequest);
// Upload/Update profile image
router.post('/profile/image', upload.single('profileImage'), handleMulterError, uploadEmployeeImage);
// Delete profile image
router.delete('/profile/image', deleteEmployeeImage);
router.post('/change-password', changeEmployeePassword);
router.post('/logout', employeeLogout);


// Admin/HR protected routes (require employer authentication)
router.use(authenticate);

// Create employee (ADMIN/HR only)
router.post('/', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), createEmployee);

// Get all employees (ADMIN/HR only)
router.get('/', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', "PROJECT_MANAGER"]), getAllEmployees);

// Get employees with update requests (ADMIN/HR only)
router.get('/update-requests', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getEmployeesWithUpdateRequests);

// Get employee by ID (ADMIN/HR only)
router.get('/:id', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getEmployeeById);

// Update employee status (ADMIN/HR only)
router.patch('/:id/status', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), updateEmployeeStatus);

// Update employee by HR/Admin (ADMIN/HR only)
router.put('/:id/admin-update', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), updateEmployeeByAdmin);

// Reset employee update status (ADMIN/HR only)
router.post('/:id/reset-update', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), resetEmployeeUpdateStatus);

// Update employee profile image (HR/Admin)
router.put('/:id/profile-image', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), upload.single('profileImage'), handleMulterError, updateEmployeeImageByAdmin);

// Delete employee profile image (HR/Admin)
router.delete('/:id/profile-image', authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), deleteEmployeeImageByAdmin);

export default router;