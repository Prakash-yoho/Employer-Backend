import Employee from "../model/Employee.js";
import Leave from "../model/Leave.js";
import PayrollRelease from "../model/PayrollRelease.js";
import { computeSalaryViolations } from "./ViolationGracePolicyController.js";
import { calculateSalaryFromCTC, computeWorkedDaysAndPay } from "../utils/salaryCalc.js";
import { generatePayslip } from "../services/payslipService.js";
import { generateSalaryViolationReport } from "../services/salaryViolationReportService.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);

const STANDARD_DAYS = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getRelease(month) {
  let doc = await PayrollRelease.findOne({ month });
  if (!doc) doc = await PayrollRelease.create({ month });
  return doc;
}

/** Each violation day-record gets a stable id usable for skipping. */
function violationId(v) {
  // Synthetic records (not-marked) already have string ids; real ones use _id.
  return String(v._id);
}

/** Sum LOP days from APPROVED LOP leaves overlapping the cycle window. */
async function getLopDaysForWindow(employeeId, windowStart, windowEnd) {
  const leaves = await Leave.find({
    employeeId,
    leaveType: "LOP",
    status: "APPROVED",
    startDate: { $lte: dayjs.utc(windowEnd).endOf("day").toDate() },
    endDate:   { $gte: dayjs.utc(windowStart).startOf("day").toDate() },
  }).select("startDate endDate totalDays lopDays").lean();

  // Also count partial-LOP (split CL+LOP) via lopDays field on CASUAL leaves
  const splitLeaves = await Leave.find({
    employeeId,
    leaveType: "CASUAL",
    status: "APPROVED",
    lopDays: { $gt: 0 },
    startDate: { $lte: dayjs.utc(windowEnd).endOf("day").toDate() },
    endDate:   { $gte: dayjs.utc(windowStart).startOf("day").toDate() },
  }).select("lopDays").lean();

  const fullLop  = leaves.reduce((s, l) => s + (l.lopDays ?? l.totalDays ?? 0), 0);
  const splitLop = splitLeaves.reduce((s, l) => s + (l.lopDays ?? 0), 0);
  return fullLop + splitLop;
}

/**
 * Build the full payroll dataset for a month (cycle window).
 * Returns { month, window, employees: [...] } where each employee has
 * salary breakdown, violation list, lop, worked days, net — with skips applied.
 */
async function buildPayroll(month, { employeeId } = {}) {
  // Resolve cycle window from the violations engine (it knows the salary cycle).
  // We pass month=YYYY-MM so the window is that calendar month's cycle.
  const v = await computeSalaryViolations({ month, employeeId });

  const windowStart = v.windowInfo?.startDate ?? `${month}-01`;
  const windowEnd   = v.windowInfo?.endDate   ?? dayjs.utc(`${month}-01`).endOf("month").format("YYYY-MM-DD");

  const release = await getRelease(month);
  const skipMap = {};
  for (const s of (release.skipped ?? [])) {
    skipMap[s.employeeId] = new Set(s.violationIds ?? []);
  }
  const skipAll = release.skipAllForEveryone;

  // Per-employee state: manual worked-days override + selective release
  const stateMap = {};
  for (const st of (release.empState ?? [])) {
    stateMap[st.employeeId] = st;
  }

  // Group violations by employee (computeSalaryViolations gives byEmployee)
  const byEmp = {};
  for (const e of v.byEmployee) byEmp[e.employeeId] = e;

  // Which employees to include
  let employees;
  if (employeeId) {
    const emp = await Employee.findOne({ employeeId })
      .select("employeeId firstName lastName fatherName designation department annualSalary officialEmail doj panNumber bankDetails address")
      .lean();
    employees = emp ? [emp] : [];
  } else {
    employees = await Employee.find({ isActive: true })
      .select("employeeId firstName lastName fatherName designation department annualSalary officialEmail doj panNumber bankDetails address")
      .lean();
  }

  const result = [];

  for (const emp of employees) {
    const ctcMonthly = (emp.annualSalary ?? 0) / 12;
    const breakdown  = calculateSalaryFromCTC(ctcMonthly);

    const empViol = byEmp[emp.employeeId];
    const allDays = empViol?.days ?? [];

    // Apply skips
    const empSkips = skipMap[emp.employeeId] ?? new Set();
    const activeDays = allDays.filter((d) => {
      if (skipAll) return false;
      return !empSkips.has(violationId(d));
    });

    // Recount from active (non-skipped) violations
    let notMarkedDays = 0;
    let otherViolationCount = 0;
    for (const d of activeDays) {
      if (d.isNotMarked) {
        notMarkedDays += 1;
      } else {
        // Each non-not-marked violation TYPE on the day counts 0.5
        if (d.isLate) otherViolationCount += 1;
        if (d.isEarlyLogout) otherViolationCount += 1;
        if (d.hasBreakViolation) otherViolationCount += d.breakViolations.length;
        if (d.isMissedClockOut) otherViolationCount += 1;
      }
    }

    const lopDays = await getLopDaysForWindow(emp.employeeId, windowStart, windowEnd);

    const empSt = stateMap[emp.employeeId] ?? {};
    const manualWorkedDays = empSt.manualWorkedDays;

    let pay;
    if (manualWorkedDays != null) {
      // Manual override — use the entered number directly, ignore auto math.
      pay = computeWorkedDaysAndPay({
        breakdown,
        lopDays: 0,
        notMarkedDays: 0,
        otherViolationCount: 0,
        standardDays: STANDARD_DAYS,
        manualWorkedDays,
      });
    } else {
      pay = computeWorkedDaysAndPay({
        breakdown,
        lopDays,
        notMarkedDays,
        otherViolationCount,
        standardDays: STANDARD_DAYS,
      });
    }

    result.push({
      employeeId:  emp.employeeId,
      name:        `${emp.firstName} ${emp.lastName}`,
      designation: emp.designation ?? "",
      department:  emp.department ?? "",
      email:       emp.officialEmail ?? "",
      annualSalary: emp.annualSalary ?? 0,
      ctcMonthly:  Math.round(ctcMonthly * 100) / 100,

      // Slip meta (exact template fields)
      joiningDate:   emp.doj ? new Date(emp.doj).toISOString().split("T")[0] : "",
      bankName:      emp.bankDetails?.bankName ?? "",
      accountNumber: emp.bankDetails?.accountNumber ?? "",
      uanNo:         emp.bankDetails?.uanNumber ?? "",
      pan:           emp.panNumber ?? "",
      location:      emp.address?.city ?? "Chennai",

      breakdown,         // full (un-prorated) component amounts
      pay,               // prorated earnings, deductions, worked days, net

      // Violations (with skip status so the UI can show/toggle)
      violations: allDays.map((d) => ({
        id:        violationId(d),
        date:      d.date,
        isLate:    d.isLate,
        lateByMinutes: d.lateByMinutes,
        isEarlyLogout: d.isEarlyLogout,
        earlyByMinutes: d.earlyByMinutes,
        hasBreakViolation: d.hasBreakViolation,
        breakViolations: d.breakViolations,
        isMissedClockOut: d.isMissedClockOut,
        isNotMarked: d.isNotMarked,
        skipped: skipAll ? true : empSkips.has(violationId(d)),
      })),
      activeViolationCount: activeDays.length,
      totalViolationCount: allDays.length,
      hasViolations: allDays.length > 0,

      // Per-employee release + manual override state
      released:         !!empSt.released,
      releasedAt:       empSt.releasedAt ?? null,
      manualWorkedDays: manualWorkedDays ?? null,
      isManual:         manualWorkedDays != null,
    });
  }

  return {
    month,
    window: { startDate: windowStart, endDate: windowEnd, label: v.windowInfo?.label ?? month },
    released: release.released,
    releasedAt: release.releasedAt,
    skipAllForEveryone: skipAll,
    officeTiming: v.officeTiming,
    gracePolicy: v.gracePolicy,
    employees: result,
  };
}

// ─── GET /api/payroll?month=YYYY-MM ───────────────────────────────────────────
// HR/Admin — full payroll preview for all employees (live computed).
export const getPayroll = async (req, res) => {
  try {
    const month = req.query.month || dayjs.utc().format("YYYY-MM");
    const data = await buildPayroll(month);
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    console.error("getPayroll Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/payroll/skip ────────────────────────────────────────────────────
// Body: { month, employeeId, violationIds: [] }  → set skipped list for one emp
export const updateSkippedViolations = async (req, res) => {
  try {
    const { month, employeeId, violationIds = [] } = req.body;
    if (!month || !employeeId)
      return res.status(400).json({ success: false, message: "month and employeeId required" });

    const release = await getRelease(month);
    const idx = release.skipped.findIndex((s) => s.employeeId === employeeId);
    if (idx >= 0) release.skipped[idx].violationIds = violationIds;
    else release.skipped.push({ employeeId, violationIds });

    release.updatedBy = req.user?.employeeId ?? null;
    release.markModified("skipped");
    await release.save();

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("updateSkippedViolations Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/payroll/skip-all ────────────────────────────────────────────────
// Body: { month, skipAll: true|false }  → skip every violation for everyone
export const skipAllViolations = async (req, res) => {
  try {
    const { month, skipAll = true } = req.body;
    if (!month) return res.status(400).json({ success: false, message: "month required" });

    const release = await getRelease(month);
    release.skipAllForEveryone = !!skipAll;
    release.updatedBy = req.user?.employeeId ?? null;
    await release.save();

    return res.status(200).json({ success: true, skipAllForEveryone: release.skipAllForEveryone });
  } catch (err) {
    console.error("skipAllViolations Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/payroll/release ────────────────────────────────────────────────
// Body: { month, employeeIds?: string[] }
//   - employeeIds omitted/empty → release ALL employees (global flag too)
//   - employeeIds present       → release only those employees (selective)
export const releasePayroll = async (req, res) => {
  try {
    const { month, employeeIds } = req.body;
    if (!month) return res.status(400).json({ success: false, message: "month required" });

    const release = await getRelease(month);
    const now = new Date();
    const by = req.user?.employeeId ?? null;

    const upsertEmpState = (empId, patch) => {
      const idx = release.empState.findIndex((s) => s.employeeId === empId);
      if (idx >= 0) Object.assign(release.empState[idx], patch);
      else release.empState.push({ employeeId: empId, ...patch });
    };

    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      // Selective release
      for (const empId of employeeIds) {
        upsertEmpState(empId, { released: true, releasedAt: now, releasedBy: by });
      }
      release.markModified("empState");
      await release.save();
      return res.status(200).json({ success: true, month, releasedCount: employeeIds.length, releasedAt: now });
    }

    // Release everyone — set global flag AND every active employee's state
    release.released   = true;
    release.releasedAt = now;
    release.releasedBy = by;

    const allEmps = await Employee.find({ isActive: true }).select("employeeId").lean();
    for (const e of allEmps) {
      upsertEmpState(e.employeeId, { released: true, releasedAt: now, releasedBy: by });
    }
    release.markModified("empState");
    await release.save();

    return res.status(200).json({ success: true, month, releasedCount: allEmps.length, releasedAt: now });
  } catch (err) {
    console.error("releasePayroll Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/payroll/manual-days ─────────────────────────────────────────────
// Body: { month, employeeId, workedDays: number|null }
//   workedDays = null  → clear override (back to auto math)
export const setManualWorkedDays = async (req, res) => {
  try {
    const { month, employeeId, workedDays } = req.body;
    if (!month || !employeeId)
      return res.status(400).json({ success: false, message: "month and employeeId required" });

    // Coerce: null/""/undefined → clear override; otherwise a finite number.
    let value = null;
    if (workedDays !== null && workedDays !== "" && workedDays !== undefined) {
      value = Number(workedDays);
      if (!Number.isFinite(value) || value < 0)
        return res.status(400).json({ success: false, message: "workedDays must be a non-negative number" });
      // Clamp to the standard cycle length
      if (value > 30) value = 30;
    }

    const release = await getRelease(month);
    const idx = release.empState.findIndex((s) => s.employeeId === employeeId);
    if (idx >= 0) {
      release.empState[idx].manualWorkedDays = value;
    } else {
      release.empState.push({ employeeId, manualWorkedDays: value });
    }
    // Force Mongoose to persist the nested-array change.
    release.markModified("empState");
    await release.save();

    return res.status(200).json({ success: true, employeeId, manualWorkedDays: value });
  } catch (err) {
    console.error("setManualWorkedDays Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/payroll/unrelease ──────────────────────────────────────────────
export const unreleasePayroll = async (req, res) => {
  try {
    const { month, employeeIds } = req.body;
    if (!month) return res.status(400).json({ success: false, message: "month required" });
    const release = await getRelease(month);

    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      for (const empId of employeeIds) {
        const idx = release.empState.findIndex((s) => s.employeeId === empId);
        if (idx >= 0) { release.empState[idx].released = false; release.empState[idx].releasedAt = null; }
      }
      release.markModified("empState");
    } else {
      release.released = false;
      release.empState.forEach((s) => { s.released = false; s.releasedAt = null; });
      release.markModified("empState");
    }
    await release.save();
    return res.status(200).json({ success: true, month });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payroll/slip/:employeeId?month=YYYY-MM ──────────────────────────
// Streams the payslip PDF (download/view). HR always; employee only if released
// and only their own slip.
export const downloadPayslip = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const month = req.query.month || dayjs.utc().format("YYYY-MM");

    const isHR = ["EMPLOYER_HR", "EMPLOYER_ADMIN"].includes(req.user?.role);
    const isOwner = req.user?.employeeId === employeeId;

    if (!isHR && !isOwner)
      return res.status(403).json({ success: false, message: "Access denied" });

    const data = await buildPayroll(month, { employeeId });
    const emp = data.employees[0];
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    // Employees can only download AFTER their slip is released
    if (!isHR && !emp.released)
      return res.status(403).json({ success: false, message: "Payslip not released yet" });

    const pdfBuffer = await generatePayslip({ employee: emp, month, window: data.window });

    const safeName = emp.name.replace(/\s+/g, "_");
    const fileName = `${safeName}_${employeeId}_${month}_payslip.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("downloadPayslip Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payroll/my-slip?month=YYYY-MM ───────────────────────────────────
// Employee — view their own released slip data (not PDF)
export const getMySlip = async (req, res) => {
  try {
    const month = req.query.month || dayjs.utc().format("YYYY-MM");
    const employeeId = req.user?.employeeId;
    if (!employeeId) return res.status(400).json({ success: false, message: "No employee context" });

    const data = await buildPayroll(month, { employeeId });
    const slip = data.employees[0] ?? null;
    if (!slip || !slip.released)
      return res.status(403).json({ success: false, message: "Payslip not released yet" });

    return res.status(200).json({
      success: true,
      month,
      window: data.window,
      released: slip.released,
      slip,
    });
  } catch (err) {
    console.error("getMySlip Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payroll/my-slips ────────────────────────────────────────────────
// Employee — list months where THIS employee's slip has been released
export const getMyReleasedMonths = async (req, res) => {
  try {
    const employeeId = req.user?.employeeId;
    if (!employeeId) return res.status(400).json({ success: false, message: "No employee context" });

    // A month is available if the employee's per-employee state is released,
    // OR the legacy global flag is set (covers release-everyone before empState).
    const releases = await PayrollRelease.find({
      $or: [
        { released: true },
        { empState: { $elemMatch: { employeeId, released: true } } },
      ],
    }).select("month releasedAt released empState").sort({ month: -1 }).lean();

    const months = releases
      .filter((r) => {
        const st = (r.empState ?? []).find((s) => s.employeeId === employeeId);
        return st?.released || r.released;
      })
      .map((r) => {
        const st = (r.empState ?? []).find((s) => s.employeeId === employeeId);
        return { month: r.month, releasedAt: st?.releasedAt ?? r.releasedAt };
      });

    return res.status(200).json({ success: true, months });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payroll/violation-report/:employeeId?month=YYYY-MM ──────────────
// Employee can download their own violation report for a released month;
// HR can download anyone's.
export const downloadMonthViolationReport = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const month = req.query.month || dayjs.utc().format("YYYY-MM");

    const isHR = ["EMPLOYER_HR", "EMPLOYER_ADMIN"].includes(req.user?.role);
    const isOwner = req.user?.employeeId === employeeId;
    if (!isHR && !isOwner)
      return res.status(403).json({ success: false, message: "Access denied" });

    const release = await getRelease(month);
    const empSt = (release.empState ?? []).find((s) => s.employeeId === employeeId);
    const empReleased = empSt?.released || release.released;
    if (!isHR && !empReleased)
      return res.status(403).json({ success: false, message: "Not released yet" });

    const v = await computeSalaryViolations({ month, employeeId });
    const employee = v.byEmployee.find((e) => e.employeeId === employeeId) ?? {
      employeeId, name: employeeId, designation: "", department: "",
      lateCount: 0, earlyLogoutCount: 0, breakViolationCount: 0,
      missedClockOutCount: 0, notMarkedCount: 0, totalViolationDays: 0, totalViolations: 0,
      days: [],
    };

    const pdfBuffer = await generateSalaryViolationReport({
      employee,
      cycle: { label: v.windowInfo?.label ?? month, startDate: v.windowInfo?.startDate, endDate: v.windowInfo?.endDate, startDay: v.startDay },
      officeTiming: v.officeTiming,
      gracePolicy: v.gracePolicy,
      meta: {},
    });

    const fileName = `${(employee.name || employeeId).replace(/\s+/g, "_")}_${month}_violations.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("downloadMonthViolationReport Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/payroll/report ─────────────────────────────────────────────────
// HR/Admin — generate Excel or PDF report for RELEASED slips only.
// Body: { month, format: "excel"|"pdf", fields: string[], employeeIds?: string[] }
//   - employeeIds omitted/empty → all released employees
//   - only employees whose slip is released for the month are included
export const generatePayrollReport = async (req, res) => {
  try {
    const { month, format = "excel", fields = [], employeeIds } = req.body;
    if (!month) return res.status(400).json({ success: false, message: "month required" });
    if (!Array.isArray(fields) || fields.length === 0)
      return res.status(400).json({ success: false, message: "Select at least one field" });

    const { generatePayrollExcel, generatePayrollPDF } = await import("../services/payrollReportService.js");

    const data = await buildPayroll(month);
    let employees = data.employees.filter((e) => e.released); // RELEASED ONLY

    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      const set = new Set(employeeIds);
      employees = employees.filter((e) => set.has(e.employeeId));
    }

    if (employees.length === 0)
      return res.status(404).json({ success: false, message: "No released slips found for this selection" });

    const safeMonth = month;
    if (format === "pdf") {
      const buf = await generatePayrollPDF({ employees, fieldKeys: fields, month });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="payroll_report_${safeMonth}.pdf"`);
      res.setHeader("Content-Length", buf.length);
      return res.send(buf);
    }

    // default excel
    const buf = await generatePayrollExcel({ employees, fieldKeys: fields, month });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="payroll_report_${safeMonth}.xlsx"`);
    res.setHeader("Content-Length", buf.length);
    return res.send(buf);
  } catch (err) {
    console.error("generatePayrollReport Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payroll/report-employees?month=YYYY-MM ──────────────────────────
// HR/Admin — list employees with released slips for the picker (id + name only)
export const getReportEmployees = async (req, res) => {
  try {
    const month = req.query.month || dayjs.utc().format("YYYY-MM");
    const data = await buildPayroll(month);
    const released = data.employees
      .filter((e) => e.released)
      .map((e) => ({ employeeId: e.employeeId, name: e.name, designation: e.designation }));
    return res.status(200).json({ success: true, month, employees: released, total: released.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};