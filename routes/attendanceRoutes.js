import express from 'express';
import { clockIn, clockOut, endBreak, getAttendanceImageUrl, getAttendanceLogImages, getLogs, startBreak } from '../controllers/attendanceController.js';
import {
  getAllEmployeesAttendance,
  getEmployeeAttendanceLogs,
  getEmployeeLogDetail,
  getAttendanceSummary,
} from "../controllers/attendanceController.js";
import { authenticate, authorize } from "../middleware/authMiddleware.js"; // ← fix import names

const router = express.Router();

// Public routes (no auth)
router.post("/clock-in", clockIn);
router.post("/start-break", startBreak);
router.post("/end-break", endBreak);
router.post("/clock-out", clockOut);
router.get("/logs", getLogs);
router.get("/image", getAttendanceImageUrl);
router.get("/log/:logId/images", getAttendanceLogImages);

// Protected admin routes — middleware applied BEFORE the route handlers
router.get("/summary", authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getAttendanceSummary);
router.get("/", authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getAllEmployeesAttendance);
router.get("/:employeeId", authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getEmployeeAttendanceLogs);
router.get("/:employeeId/log/:logId", authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getEmployeeLogDetail);

export default router;