import express from 'express';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';


import {
    createLeavePolicy,
    getLeavePolicy,
    updateLeavePolicy,
    deleteLeavePolicy,
} from '../controllers/Leavepolicycontroller.js';



const router = express.Router();


// ─── Leave Policy (HR/Admin only) ─────────────────────────────────────────────
router.get('/getpolicy', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), getLeavePolicy);
router.post('/createpolicy', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), createLeavePolicy);
router.patch('/update/:id', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), updateLeavePolicy);
router.delete('/delete/:id', authenticate, authorize(['EMPLOYER_HR', 'EMPLOYER_ADMIN']), deleteLeavePolicy);


export default router;