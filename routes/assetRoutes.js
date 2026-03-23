import express from 'express';
import {
    createAsset,
    updateAsset,
    getAllAssets,
    getAssetById,
    assignAssetToEmployee,
    removeAssetAssignment,
    getMyAssets,
    getAssetStatistics,
    HardDeleteAsset
} from '../controllers/Employer/assetController.js';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// EMPLOYEE ROUTES
router.get(
    '/me',
    authenticateEmployee,
    getMyAssets
);

// ADMIN/HR/IT ROUTES
router.get(
    '/',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    getAllAssets
);

router.get(
    '/statistics',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    getAssetStatistics
);

router.get(
    '/:assetId',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    getAssetById
);

// IT ONLY ROUTES
router.post(
    '/',
    authenticate,
    authorize(['EMPLOYER_IT']),
    createAsset
);

router.put(
    '/:assetId',
    authenticate,
    authorize(['EMPLOYER_IT']),
    updateAsset
);

// ASSIGNMENT ROUTES (Admin, HR, IT)
router.post(
    '/:assetId/assign',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    assignAssetToEmployee
);

router.post(
    '/:assetId/unassign',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    removeAssetAssignment
);

router.delete(
    '/:assetId/delete',
    authenticate,
    authorize([ 'EMPLOYER_IT']),
    HardDeleteAsset
)

export default router;