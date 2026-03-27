import express from 'express';
import upload, { handleDocumentUploadError } from '../config/documentMulter.js'
import { addExperienceCompany, deleteDocument, deleteExperience, downloadAppointmentLetter, downloadDocument, getAllDocuments, getDocumentsByEmployeeId, getMyDocuments, initEmployeeDocument, previewAppointmentLetter, previewDocument, uploadDocument, verifyDocument } from '../controllers/documentController.js';
import { authenticate, authenticateEmployee, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// EMPLOYEE ROUTES

router.get('/init', authenticateEmployee, initEmployeeDocument);

router.get('/me', authenticateEmployee, getMyDocuments);

router.post(
    '/upload',
    authenticateEmployee,
    upload.single('document'),
    handleDocumentUploadError,
    uploadDocument
);

router.post(
    '/experience/company',
    authenticateEmployee,
    addExperienceCompany
);

router.delete(
    '/experience/:experienceIndex',
    authenticateEmployee,
    deleteExperience
);

router.delete(
    '/:documentType',
    authenticateEmployee,
    deleteDocument
);

router.get(
    '/preview/:documentType',
    authenticateEmployee,
    previewDocument
);

router.get(
    '/download/:documentType',
    authenticateEmployee,
    downloadDocument
);

// HR / ADMIN ROUTES
router.get(
    '/',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']),
    getAllDocuments
);

router.get(
    '/employee/:employeeId',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']),
    getDocumentsByEmployeeId
);

router.put(
    '/verify/:employeeId',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']),
    verifyDocument
);

router.get(
    '/employee/:employeeId/preview/:documentType',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']),
    previewDocument
);

router.get(
    '/employee/:employeeId/download/:documentType',
    authenticate,
    authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']),
    downloadDocument
);



router.get("/preview-appointment-letter", authenticateEmployee, previewAppointmentLetter);
router.get("/download-appointment-letter", authenticateEmployee, downloadAppointmentLetter);


export default router;