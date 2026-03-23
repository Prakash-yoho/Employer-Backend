import express from "express";
import {
    createApplication,
    getMyApplications,
    getApplicationById,
    updateApplication,
    updateApplicationStatus,
    getJobApplications,
    getAllApplications,
    deleteApplication,
    getApplicationStats,
    scheduleInterview,
    rescheduleInterview,
    getInterviewRescheduleHistory,
    sendOffer,
    updateOfferStatus,
    uploadDocuments,
    updateDocument,
    verifyDocument,
    onboardCandidate,
    getApplicationTimeline,
    getInterviewScheduledApplications,
    getOfferLetterInfo,
    downloadOfferLetter,
    previewOfferLetter
} from "../controllers/applicationController.js";
import { authMiddleware, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Candidate routes
router.post("/", createApplication);
router.get("/my-applications", getMyApplications);
router.get("/stats", getApplicationStats);
router.get("/:id", getApplicationById);
router.put("/:id", updateApplication);
router.delete("/:id", deleteApplication);
router.put("/:id/offer-status", updateOfferStatus);
router.put("/:id/upload-documents", uploadDocuments);
router.put("/:id/update-document", updateDocument);
router.get("/:id/reschedule-history", getInterviewRescheduleHistory);
router.get("/:id/timeline", getApplicationTimeline);

// HR only routes
router.get("/", authorizeRoles("hr"), getAllApplications);
router.get("/job/:jobId", authorizeRoles("hr"), getJobApplications);
router.put("/:id/status", authorizeRoles("hr"), updateApplicationStatus);
router.put("/:id/schedule-interview", authorizeRoles("hr"), scheduleInterview);
router.put("/:id/reschedule-interview", authorizeRoles("hr"), rescheduleInterview);
router.get("/interviews/scheduled", authorizeRoles("hr"), getInterviewScheduledApplications);
router.put("/:id/send-offer", authorizeRoles("hr"), sendOffer);
router.put("/:id/verify-document", authorizeRoles("hr"), verifyDocument);
router.put("/:id/onboard", authorizeRoles("hr"), onboardCandidate);

// Offer Letter Routes (HR, Admin, and Candidate for their own applications)
router.get("/:id/offer-letter/info", getOfferLetterInfo); // Both HR and candidate (own)
router.get("/:id/offer-letter", downloadOfferLetter); // Download offer letter
router.get("/:id/offer-letter/preview", previewOfferLetter); // Preview in browser

export default router;