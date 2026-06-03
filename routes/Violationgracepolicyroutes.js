import express from "express";
import { authenticate, authorize } from "../middleware/authMiddleware.js";
import {
  getViolationGracePolicy,
  updateViolationGracePolicy,
  getSalaryViolations,
} from "../controllers/Violationgracepolicycontroller.js";

const router = express.Router();

// ── Violation Grace Policy (HR / Admin only) ──────────────────────────────────

// GET  /api/violation-grace-policy
// Returns saved grace config + OfficeTiming as read-only reference
router.get(
  "/violation-grace-policy",
  authenticate,
  authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]),
  getViolationGracePolicy
);

// PUT  /api/violation-grace-policy
// { loginGraceMinutes, logoutGraceMinutes, breakGraceMinutes }
router.put(
  "/violation-grace-policy",
  authenticate,
  authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]),
  updateViolationGracePolicy
);

// ── Salary Violations (HR / Admin only) ───────────────────────────────────────

// GET  /api/violations/salary                → all time
// GET  /api/violations/salary?month=2025-06  → June 2025
// GET  /api/violations/salary?year=2025      → full year
// GET  /api/violations/salary?date=2025-06-01
router.get(
  "/violations/salary",
  authenticate,
  authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]),
  getSalaryViolations
);

export default router;