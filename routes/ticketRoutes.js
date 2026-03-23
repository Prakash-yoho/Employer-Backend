import express from 'express';
import {
    createTicket,
    getMyTickets,
    getAllTickets,
    getTicketById,
    updateTicket,
    forwardToITSupport,
    resolveTicketAsIT,
    getTicketStatistics
} from '../controllers/ticketController.js';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// EMPLOYEE ROUTES
router.post(
    '/',
    authenticateEmployee,
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