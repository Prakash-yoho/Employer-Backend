import express from 'express';
import {
    getEmployeesForIdCard,
    previewIdCard,
    generateIdCard,
    revokeIdCard,
    getMyIdCard,
    getIdCardReport,
    exportIdCardReport,
    exportIdCardsPdf,
    verifyIdCardByToken
} from '../controllers/identityCardController.js';
import { authenticate, authorize, authenticateEmployee } from '../middleware/authMiddleware.js';

const router = express.Router();

// PUBLIC — scanned via QR, no auth required
router.get('/verify/:token', verifyIdCardByToken);

router.get('/me', authenticateEmployee, getMyIdCard);

router.get('/report', authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getIdCardReport);
router.get('/report/export', authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), exportIdCardReport);

router.get('/report/export-pdf', authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), exportIdCardsPdf);

router.get('/', authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getEmployeesForIdCard);
router.get('/:id/preview', authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), previewIdCard);
router.post('/:id/generate', authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), generateIdCard);
router.post('/:id/revoke', authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), revokeIdCard);

export default router;