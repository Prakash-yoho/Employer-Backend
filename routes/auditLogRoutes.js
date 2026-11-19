import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import {
    getAuditLogs,
    getAuditLogById,
    getAuditLogStats,
    getAuditLogFilters,
    exportAuditLogs,
} from '../controllers/auditLogController.js';

const router = express.Router();

// Audit logs are visible to the ADMIN only — and are strictly read-only.
// (There is deliberately no create / update / delete endpoint.)
router.use(authenticate, authorize(['EMPLOYER_ADMIN']));

// Static routes first so they are not captured by "/:id"
router.get('/filters', getAuditLogFilters);
router.get('/stats', getAuditLogStats);
router.get('/export', exportAuditLogs);
router.get('/', getAuditLogs);
router.get('/:id', getAuditLogById);

export default router;
