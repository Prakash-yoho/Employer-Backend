// routes/announcementRoutes.js
import express from "express";
import multer  from "multer";
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAllAnnouncements,
  getAnnouncementById,
  getEmployeesByDepartment,
  getDepartments,
  getAllEmployeesForAnnouncement,
  getAnnouncementsForEmployee,
  getAttachmentPreviewUrl,
  getAttachmentDownloadUrl,
  getAnnouncementCountForEmployee,
} from "../controllers/announcementController.js";

const router = express.Router();

// multer — memory storage so we can pipe buffer straight to S3
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
});

router.post(   "/createAnnouncement",       upload.array("attachments", 5), createAnnouncement);
router.get(    "/getAnnouncements",          getAllAnnouncements);
router.get(    "/getAnnouncement/:id",       getAnnouncementById);
router.put(    "/updateAnnouncement/:id",    upload.array("attachments", 5), updateAnnouncement);
router.delete( "/deleteAnnouncement/:id",    deleteAnnouncement);

router.get("/departments",                            getDepartments);
router.get("/departments/:department/employees",      getEmployeesByDepartment);
router.get("/employees",                              getAllEmployeesForAnnouncement);
router.get("/employee/:employeeId",                   getAnnouncementsForEmployee);

router.get("/employee/:employeeId/count", getAnnouncementCountForEmployee);

router.get("/attachment/preview",  getAttachmentPreviewUrl);
router.get("/attachment/download", getAttachmentDownloadUrl);

export default router;