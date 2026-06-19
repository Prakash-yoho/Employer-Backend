import express from "express";
import { authenticate, authenticateEmployee, authorize } from "../middleware/authMiddleware.js";
import { authenticateHRorEmployee } from "../middleware/authHRorEmployee.js";
import {
  getPayroll,
  updateSkippedViolations,
  skipAllViolations,
  releasePayroll,
  unreleasePayroll,
  publishPayroll,
  unpublishPayroll,
  setManualWorkedDays,
  addManualViolation,
  removeManualViolation,
  downloadPayslip,
  getMySlip,
  getMyReleasedMonths,
  downloadMonthViolationReport,
  generatePayrollReport,
  getReportEmployees,
  getEmployeePayslipHistory,
  getMonthPayslipHistory,
  downloadHistoricalPayslip,
  downloadHistoricalViolationReport,
} from "../controllers/Payrollcontroller.js";

const router = express.Router();

// ── HR / ADMIN ────────────────────────────────────────────────────────────────
router.get("/payroll",            authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), getPayroll);
router.put("/payroll/skip",       authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), updateSkippedViolations);
router.put("/payroll/skip-all",   authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), skipAllViolations);
router.post("/payroll/release",   authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), releasePayroll);
router.post("/payroll/unrelease", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), unreleasePayroll);
router.post("/payroll/publish",   authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), publishPayroll);
router.post("/payroll/unpublish", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), unpublishPayroll);
router.put("/payroll/manual-days", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), setManualWorkedDays);
router.post("/payroll/manual-violation",   authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), addManualViolation);
router.delete("/payroll/manual-violation", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), removeManualViolation);
// POST alias for remove (use when your HTTP client can't send a DELETE body/query reliably)
router.post("/payroll/manual-violation/remove", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), removeManualViolation);

// ── Reports (HR/Admin) ──
router.get("/payroll/report-employees", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), getReportEmployees);
router.post("/payroll/report",          authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), generatePayrollReport);

// ── Payslip history (HR/Admin) ──
router.get("/payroll/history",        authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), getEmployeePayslipHistory);
router.get("/payroll/history/month",  authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), getMonthPayslipHistory);
router.get("/payroll/history/:historyId/slip", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), downloadHistoricalPayslip);
router.get("/payroll/history/:historyId/violation-report", authenticate, authorize(["EMPLOYER_HR", "EMPLOYER_ADMIN"]), downloadHistoricalViolationReport);

// ── Payslip + violation PDF (HR for anyone; employee for own) ──────────────────
// Combined guard accepts BOTH HR and employee tokens; controller enforces
// isHR || isOwner so employees can only fetch their own slip.
router.get("/payroll/slip/:employeeId",             authenticateHRorEmployee, downloadPayslip);
router.get("/payroll/violation-report/:employeeId", authenticateHRorEmployee, downloadMonthViolationReport);

// ── EMPLOYEE self-service ───────────────────────────────────────────────────────
router.get("/payroll/my-slip",  authenticateEmployee, getMySlip);
router.get("/payroll/my-slips", authenticateEmployee, getMyReleasedMonths);

export default router;