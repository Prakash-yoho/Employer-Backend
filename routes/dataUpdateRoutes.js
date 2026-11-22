import express from 'express';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';
import {
    getEditableFields, getEmployeeOptions, createDataUpdateAccess, getBatches, getBatchDetail,
    cancelDataUpdateAccess, getMyDataUpdates, submitMyDataUpdate,
} from '../controllers/dataUpdateController.js';

const router = express.Router();
const hr = [authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN'])];

// ── Employee ──────────────────────────────────────────────────────────────
router.get('/me', authenticateEmployee, getMyDataUpdates);
router.post('/me/:grantId/submit', authenticateEmployee, submitMyDataUpdate);

// ── HR / Admin ────────────────────────────────────────────────────────────
router.get('/fields', ...hr, getEditableFields);
router.get('/employees', ...hr, getEmployeeOptions);
router.get('/batches', ...hr, getBatches);
router.get('/batches/:batchId', ...hr, getBatchDetail);
router.patch('/batches/:batchId/cancel', ...hr, cancelDataUpdateAccess);
router.post('/', ...hr, createDataUpdateAccess);

export default router;
