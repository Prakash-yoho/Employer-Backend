import express from 'express';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';

// ─── Controllers ──────────────────────────────────────────────────────────────

import {
    createHoliday,
    getHolidays,
    updateHoliday,
    deleteHoliday,
} from '../controllers/Holidaycontroller.js';

const router = express.Router();


// ─── Holidays (read: all employees · write: HR/Admin) ─────────────────────────
router.get('/getallholidays', getHolidays);
router.post('/createholidays', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), createHoliday);
router.put('/updateholidays/:id', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), updateHoliday);
router.delete('/deleteholidays/:id', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), deleteHoliday);

export default router;