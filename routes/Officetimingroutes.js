import express from "express";
import {
  getOfficeTiming,
  updateOfficeTiming,
  getViolationsReport,
} from "../controllers/officeTimingController.js";
import { authenticate, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Anyone authenticated can read the timing (needed by employee clock-in UI)
router.get("/", authenticate, getOfficeTiming);

// Only HR/Admin can update
router.put(
  "/",
  authenticate,
  authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]),
  updateOfficeTiming
);

// Violations report — HR/Admin only
router.get(
  "/violations",
  authenticate,
  authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]),
  getViolationsReport
);

export default router;