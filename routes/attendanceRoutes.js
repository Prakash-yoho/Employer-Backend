import express from 'express';
import { clockIn, clockOut, endBreak, getAttendanceImageUrl, getAttendanceLogImages, getLogs, startBreak } from '../controllers/attendanceController.js';
const router = express.Router();


// Routes
router.post("/clock-in", clockIn);
router.post("/start-break", startBreak);
router.post("/end-break", endBreak);
router.post("/clock-out", clockOut);
router.get("/logs", getLogs);

// ── Image preview routes ──
router.get("/image",         getAttendanceImageUrl);   // imageUrl=https://...
router.get("/log/:logId/images", getAttendanceLogImages); // all images for one log

export default router;