import express from 'express';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';

import {
    createPermissionRequest,
    getMyPermissions,
    getAllPermissions,
    updatePermissionStatus,
    cancelPermissionRequest,
    hrCancelPermission,
} from '../controllers/Permissioncontroller.js';

const router = express.Router();

// ─── EMPLOYEE: Permission ─────────────────────────────────────────────────────
router.post('/createpermission', authenticateEmployee, createPermissionRequest);
router.get('/getmypermission', authenticateEmployee, getMyPermissions);
router.put('/cancel/:requestId', authenticateEmployee, cancelPermissionRequest);

// ─── HR/ADMIN: Permission ─────────────────────────────────────────────────────
router.get('/getall', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), getAllPermissions);
router.patch('/hr-cancel/:requestId', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), hrCancelPermission);
router.patch('/updatestatus/:requestId', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), updatePermissionStatus);

export default router;