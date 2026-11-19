import express from "express";
import { authenticate, authorize } from "../middleware/authMiddleware.js";
import {
  getViolationGracePolicy,
  updateViolationGracePolicy,
  getSalaryViolations,
  downloadSalaryViolationReport,
} from "../controllers/Violationgracepolicycontroller.js";

const router = express.Router();

// ── Violation Grace Policy (HR / Admin only) ──────────────────────────────────
router.get(
  "/violation-grace-policy",
  authenticate,
  authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]),
  getViolationGracePolicy
);

router.put(
  "/violation-grace-policy",
  authenticate,
  authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]),
  updateViolationGracePolicy
);

// ── Salary Violations (HR / Admin only) ───────────────────────────────────────

// GET /api/violations/salary?cycleOffset=0   (also accepts month|year|date)
router.get(
  "/violations/salary",
  authenticate,
  authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]),
  getSalaryViolations
);

// GET /api/violations/salary/:employeeId/report?cycleOffset=0
// Streams a per-employee salary violation PDF (download)
router.get(
  "/violations/salary/:employeeId/report",
  authenticate,
  authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]),
  downloadSalaryViolationReport
);

export default router;