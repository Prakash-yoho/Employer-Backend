import express from 'express';
import { clockIn, clockOut, endBreak, getAttendanceImageUrl, getAttendanceLogImages, getLogs, startBreak, getTodayPermissions, startPermission, endPermission } from '../controllers/attendanceController.js';
import {
  getAllEmployeesAttendance,
  getEmployeeAttendanceLogs,
  getEmployeeLogDetail,
  getAttendanceSummary,
} from "../controllers/attendanceController.js";
import { authenticate, authenticateEmployee, authorize } from "../middleware/authMiddleware.js"; // ← fix import names

const router = express.Router();

// Public routes (no auth)
router.post("/clock-in", clockIn);
router.post("/start-break", startBreak);
router.post("/end-break", endBreak);
router.post("/clock-out", clockOut);
router.get("/logs", getLogs);

// Approved-permission Out / In (employee token required)
router.get("/permission/today", authenticateEmployee, getTodayPermissions);
router.post("/permission/start", authenticateEmployee, startPermission);
router.post("/permission/end", authenticateEmployee, endPermission);
router.get("/image", getAttendanceImageUrl);
router.get("/log/:logId/images", getAttendanceLogImages);

// Protected admin routes — middleware applied BEFORE the route handlers
router.get("/summary", authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getAttendanceSummary);
router.get("/", authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getAllEmployeesAttendance);
router.get("/:employeeId", authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getEmployeeAttendanceLogs);
router.get("/:employeeId/log/:logId", authenticate, authorize(['EMPLOYER_ADMIN', 'EMPLOYER_HR']), getEmployeeLogDetail);

export default router;