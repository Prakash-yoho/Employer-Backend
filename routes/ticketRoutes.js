import express from 'express';
import {
    createTicket,
    getMyTickets,
    getAllTickets,
    getTicketById,
    updateTicket,
    forwardToITSupport,
    resolveTicketAsIT,
    getTicketStatistics,
    addQuestionToTicket,
    answerQuestionOnTicket,
    getTicketAttachmentUrl
} from '../controllers/ticketController.js';
import { authenticate, authenticateEmployee, authenticateAny, authorize } from '../middleware/authMiddleware.js';
import { handleTicketAttachmentUpload } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// STATIC ROUTES FIRST (both employee + HR/Admin/IT can hit this)
router.get(
    '/attachments/url',
    authenticateAny,
    getTicketAttachmentUrl
);

// EMPLOYEE ROUTES
router.post(
    '/',
    authenticateEmployee,
    handleTicketAttachmentUpload, // NEW: parses multipart "attachments" files
    createTicket
);

router.get(
    '/me',
    authenticateEmployee,
    getMyTickets
);

router.get(
    '/me/statistics',
    authenticateEmployee,
    getTicketStatistics
);

// NEW: employee answers a question raised on their own ticket
router.post(
    '/:ticketId/answer',
    authenticateEmployee,
    answerQuestionOnTicket
);

router.get(
    '/:ticketId',
    authenticateEmployee,
    getTicketById
);

// HR/ADMIN ROUTES
router.get(
    '/',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    getAllTickets
);

router.put(
    '/:ticketId',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']),
    updateTicket
);

router.post(
    '/:ticketId/forward',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']),
    forwardToITSupport
);

// NEW: HR/Admin/IT asks a question on a ticket (repeatable)
router.post(
    '/:ticketId/question',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    addQuestionToTicket
);

// IT SUPPORT ROUTES
router.post(
    '/:ticketId/resolve',
    authenticate,
    authorize(['EMPLOYER_IT']),
    resolveTicketAsIT
);

router.get(
    '/statistics/overall',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT']),
    getTicketStatistics
);

export default router;