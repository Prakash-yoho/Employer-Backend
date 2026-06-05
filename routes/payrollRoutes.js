import express from "express";
import { authenticate, authenticateEmployee, authorize } from "../middleware/authMiddleware.js";
import { authenticateHRorEmployee } from "../middleware/authHRorEmployee.js";
import {
  getPayroll,
  updateSkippedViolations,
  skipAllViolations,
  releasePayroll,
  unreleasePayroll,
  setManualWorkedDays,
  downloadPayslip,
  getMySlip,
  getMyReleasedMonths,
  downloadMonthViolationReport,
} from "../controllers/payrollController.js";

const router = express.Router();

// ── HR / ADMIN ────────────────────────────────────────────────────────────────
router.get("/payroll",            authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), getPayroll);
router.put("/payroll/skip",       authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), updateSkippedViolations);
router.put("/payroll/skip-all",   authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), skipAllViolations);
router.post("/payroll/release",   authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), releasePayroll);
router.post("/payroll/unrelease", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), unreleasePayroll);
router.put("/payroll/manual-days", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), setManualWorkedDays);

// ── Payslip + violation PDF (HR for anyone; employee for own) ──────────────────
// Combined guard accepts BOTH HR and employee tokens; controller enforces
// isHR || isOwner so employees can only fetch their own slip.
router.get("/payroll/slip/:employeeId",             authenticateHRorEmployee, downloadPayslip);
router.get("/payroll/violation-report/:employeeId", authenticateHRorEmployee, downloadMonthViolationReport);

// ── EMPLOYEE self-service ───────────────────────────────────────────────────────
router.get("/payroll/my-slip",  authenticateEmployee, getMySlip);
router.get("/payroll/my-slips", authenticateEmployee, getMyReleasedMonths);

export default router;