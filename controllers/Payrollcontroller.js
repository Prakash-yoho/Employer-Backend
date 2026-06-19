import Employee from "../model/Employee.js";
import Leave from "../model/Leave.js";
import PayrollRelease from "../model/Payrollrelease.js";
import PayslipHistory from "../model/Paysliphistory.js";
import { computeSalaryViolations } from "./Violationgracepolicycontroller.js";
import { calculateSalaryFromCTC, computeWorkedDaysAndPay } from "../utils/Salarycalc.js";
import { generatePayslip } from "../services/Payslipservice.js";
import { generateSalaryViolationReport } from "../services/Salaryviolationreportservice.js";
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
async function buildPayroll(month, { employeeId, skipSnapshot = false } = {}) {
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
    const hasEmpState = Object.prototype.hasOwnProperty.call(stateMap, emp.employeeId);
    const manualWorkedDays = empSt.manualWorkedDays;
    const manualViolations = empSt.manualViolations ?? [];

    // Manual violations add their dayCost on top of auto violation days.
    // Expressed as "otherViolationCount equivalents" so it flows through the
    // same 0.5-per-count math: a 1-day manual violation = 2 counts of 0.5.
    const manualViolationDayCost = manualViolations.reduce((s, mv) => s + (Number(mv.dayCost) || 0), 0);

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
        extraViolationDayCost: manualViolationDayCost, // manual violations add here
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
      hasViolations: allDays.length > 0 || manualViolations.length > 0,

      // Stage 1 (released): HR-verified, in reports. Per-employee authoritative.
      released:         hasEmpState ? !!empSt.released : !!release.released,
      releasedAt:       empSt.releasedAt ?? release.releasedAt ?? null,
      // Stage 2 (published): employee can see their slip.
      published:        !!empSt.published,
      publishedAt:      empSt.publishedAt ?? null,
      manualWorkedDays: manualWorkedDays ?? null,
      isManual:         manualWorkedDays != null,

      // HR-added manual violations
      manualViolations: manualViolations.map((mv) => ({
        id: mv.id, message: mv.message, date: mv.date, dayCost: mv.dayCost,
      })),
      manualViolationDayCost,
    });
  }

  // ── Freeze: overlay frozen snapshots for released employees ──
  // A released slip must never change due to later policy/timing edits. For any
  // employee with a CURRENT history snapshot, serve the frozen pay/violation
  // data instead of the freshly computed values. Live flags (released/published)
  // still come from PayrollRelease so revert/publish work normally.
  // skipSnapshot=true returns purely LIVE data (used when creating a snapshot).
  if (!skipSnapshot) {
    const snapQuery = { month, isCurrent: true };
    if (employeeId) snapQuery.employeeId = employeeId;
    const snapshots = await PayslipHistory.find(snapQuery).lean();
    const snapMap = {};
    for (const s of snapshots) snapMap[s.employeeId] = s;

    for (const r of result) {
      const snap = snapMap[r.employeeId];
      if (snap && r.released && snap.snapshot) {
        const f = snap.snapshot;
        r.breakdown            = f.breakdown ?? r.breakdown;
        r.pay                  = f.pay ?? r.pay;
        r.violations           = f.violations ?? r.violations;
        r.activeViolationCount = f.activeViolationCount ?? r.activeViolationCount;
        r.totalViolationCount  = f.totalViolationCount ?? r.totalViolationCount;
        r.manualViolations     = f.manualViolations ?? r.manualViolations;
        r.manualViolationDayCost = f.manualViolationDayCost ?? r.manualViolationDayCost;
        r.ctcMonthly           = f.ctcMonthly ?? r.ctcMonthly;
        r.frozen               = true;
        r.version              = snap.version;
      }
    }
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
/** Throws-style guard: returns true if employee's slip is released (locked). */
async function isEmployeeReleased(month, employeeId) {
  const release = await PayrollRelease.findOne({ month }).lean();
  if (!release) return false;
  const st = (release.empState ?? []).find((s) => s.employeeId === employeeId);
  if (st) return !!st.released;
  return !!release.released;
}

export const updateSkippedViolations = async (req, res) => {
  try {
    const { month, employeeId, violationIds = [] } = req.body;
    if (!month || !employeeId)
      return res.status(400).json({ success: false, message: "month and employeeId required" });

    if (await isEmployeeReleased(month, employeeId))
      return res.status(409).json({ success: false, message: "Slip is released. Revert it first to make changes." });

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
// Freeze one employee's current live slip into a new PayslipHistory version.
// Marks any previous current version as not-current. Returns the new version #.
async function snapshotEmployee(month, employeeId, by) {
  // Compute LIVE (bypass any existing snapshot overlay)
  const live = await buildPayroll(month, { employeeId, skipSnapshot: true });
  const emp = live.employees[0];
  if (!emp) return null;

  // Build frozen violation report data (same shape generateSalaryViolationReport wants)
  let violationSnapshot = null;
  try {
    const vr = await computeSalaryViolations({ month, employeeId });
    const ve = vr.byEmployee.find((x) => x.employeeId === employeeId) ?? null;
    violationSnapshot = {
      employee: ve,
      manualViolations: emp.manualViolations ?? [],
      cycle: { label: vr.windowInfo?.label ?? month, startDate: vr.windowInfo?.startDate, endDate: vr.windowInfo?.endDate, startDay: vr.startDay },
      officeTiming: vr.officeTiming,
      gracePolicy: vr.gracePolicy,
    };
  } catch (e) {
    violationSnapshot = { manualViolations: emp.manualViolations ?? [] };
  }

  // Determine next version
  const last = await PayslipHistory.findOne({ month, employeeId }).sort({ version: -1 }).lean();
  const nextVersion = (last?.version ?? 0) + 1;

  // Retire previous current snapshot(s)
  await PayslipHistory.updateMany({ month, employeeId, isCurrent: true }, { $set: { isCurrent: false } });

  await PayslipHistory.create({
    month, employeeId, version: nextVersion,
    releasedAt: new Date(), releasedBy: by, isCurrent: true,
    snapshot: emp,
    violationSnapshot,
    cycleLabel: live.window?.label ?? month,
  });
  return nextVersion;
}

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

    // Resolve the target employee list
    let targetIds;
    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      targetIds = employeeIds;
    } else {
      const allEmps = await Employee.find({ isActive: true }).select("employeeId").lean();
      targetIds = allEmps.map((e) => e.employeeId);
      release.released   = true;
      release.releasedAt = now;
      release.releasedBy = by;
    }

    // Snapshot each target FIRST (freeze current live numbers), then mark released
    for (const empId of targetIds) {
      await snapshotEmployee(month, empId, by);
      upsertEmpState(empId, { released: true, releasedAt: now, releasedBy: by });
    }

    release.markModified("empState");
    await release.save();

    return res.status(200).json({ success: true, month, releasedCount: targetIds.length, releasedAt: now });
  } catch (err) {
    console.error("releasePayroll Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/payroll/publish ────────────────────────────────────────────────
// Stage 2 — make slips visible to employees. Body: { month, employeeIds? }
//   - Only employees who are RELEASED (stage 1) can be published.
//   - employeeIds omitted/empty → publish ALL released employees.
export const publishPayroll = async (req, res) => {
  try {
    const { month, employeeIds } = req.body;
    if (!month) return res.status(400).json({ success: false, message: "month required" });

    const release = await getRelease(month);
    const now = new Date();
    const by = req.user?.employeeId ?? null;

    // Determine which empState entries are eligible (released = true)
    const releasedEntries = release.empState.filter((s) => s.released);
    if (releasedEntries.length === 0)
      return res.status(400).json({ success: false, message: "No released slips to publish. Release (verify) first." });

    let targets;
    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      const set = new Set(employeeIds);
      targets = releasedEntries.filter((s) => set.has(s.employeeId));
      // Block any requested id that isn't released yet
      const notReleased = employeeIds.filter((id) => !releasedEntries.some((s) => s.employeeId === id));
      if (notReleased.length > 0)
        return res.status(400).json({ success: false, message: `Release first for: ${notReleased.join(", ")}` });
    } else {
      targets = releasedEntries;
    }

    targets.forEach((s) => { s.published = true; s.publishedAt = now; s.publishedBy = by; });
    release.markModified("empState");
    await release.save();

    return res.status(200).json({ success: true, month, publishedCount: targets.length, publishedAt: now });
  } catch (err) {
    console.error("publishPayroll Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/payroll/unpublish ──────────────────────────────────────────────
// Revoke employee visibility (keeps stage-1 released). Body: { month, employeeIds? }
export const unpublishPayroll = async (req, res) => {
  try {
    const { month, employeeIds } = req.body;
    if (!month) return res.status(400).json({ success: false, message: "month required" });
    const release = await getRelease(month);

    if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      const set = new Set(employeeIds);
      release.empState.forEach((s) => {
        if (set.has(s.employeeId)) { s.published = false; s.publishedAt = null; }
      });
    } else {
      release.empState.forEach((s) => { s.published = false; s.publishedAt = null; });
    }
    release.markModified("empState");
    await release.save();
    return res.status(200).json({ success: true, month });
  } catch (err) {
    console.error("unpublishPayroll Error:", err);
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

    if (await isEmployeeReleased(month, employeeId))
      return res.status(409).json({ success: false, message: "Slip is released. Revert it first to make changes." });

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

// ─── POST /api/payroll/manual-violation ───────────────────────────────────────
// Body: { month, employeeId, message, date, dayCost }
export const addManualViolation = async (req, res) => {
  try {
    const { month, employeeId, message, date, dayCost } = req.body;
    if (!month || !employeeId || !message || !date)
      return res.status(400).json({ success: false, message: "month, employeeId, message and date are required" });

    const cost = Number(dayCost);
    if (!Number.isFinite(cost) || cost <= 0)
      return res.status(400).json({ success: false, message: "dayCost must be a positive number" });

    if (await isEmployeeReleased(month, employeeId))
      return res.status(409).json({ success: false, message: "Slip is released. Revert it first to make changes." });

    const release = await getRelease(month);
    let idx = release.empState.findIndex((s) => s.employeeId === employeeId);
    if (idx < 0) { release.empState.push({ employeeId, manualViolations: [] }); idx = release.empState.length - 1; }
    if (!release.empState[idx].manualViolations) release.empState[idx].manualViolations = [];

    const entry = {
      id: `mv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message: String(message).trim(),
      date: String(date),
      dayCost: cost,
    };
    release.empState[idx].manualViolations.push(entry);
    release.markModified("empState");
    await release.save();

    return res.status(200).json({ success: true, violation: entry });
  } catch (err) {
    console.error("addManualViolation Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/payroll/manual-violation?month=&employeeId=&violationId= ──────
// Reads from query params (DELETE bodies are unreliable across HTTP clients).
export const removeManualViolation = async (req, res) => {
  try {
    const month = req.query.month || req.body?.month;
    const employeeId = req.query.employeeId || req.body?.employeeId;
    const violationId = req.query.violationId || req.body?.violationId;
    if (!month || !employeeId || !violationId)
      return res.status(400).json({ success: false, message: "month, employeeId and violationId required" });

    if (await isEmployeeReleased(month, employeeId))
      return res.status(409).json({ success: false, message: "Slip is released. Revert it first to make changes." });

    const release = await getRelease(month);
    const idx = release.empState.findIndex((s) => s.employeeId === employeeId);
    if (idx >= 0 && release.empState[idx].manualViolations) {
      release.empState[idx].manualViolations =
        release.empState[idx].manualViolations.filter((mv) => mv.id !== violationId);
      release.markModified("empState");
      await release.save();
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("removeManualViolation Error:", err);
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
      // If a global release was in effect, materialize it into per-employee
      // entries for ALL active employees first, so clearing a few doesn't leave
      // the global flag contradicting per-employee state.
      if (release.released) {
        const allEmps = await Employee.find({ isActive: true }).select("employeeId").lean();
        for (const e of allEmps) {
          const i = release.empState.findIndex((s) => s.employeeId === e.employeeId);
          if (i < 0) release.empState.push({ employeeId: e.employeeId, released: true, releasedAt: release.releasedAt });
          else if (release.empState[i].released !== false) release.empState[i].released = true;
        }
        release.released = false; // global flag retired; per-employee is now source of truth
      }
      for (const empId of employeeIds) {
        const idx = release.empState.findIndex((s) => s.employeeId === empId);
        if (idx >= 0) {
          release.empState[idx].released = false; release.empState[idx].releasedAt = null;
          // Reverting stage 1 must also revoke stage 2 (can't be visible if not released)
          release.empState[idx].published = false; release.empState[idx].publishedAt = null;
        } else {
          release.empState.push({ employeeId: empId, released: false });
        }
      }
      release.markModified("empState");
      // Mark each reverted employee's current snapshot as reverted (keep history)
      const by = req.user?.employeeId ?? null;
      await PayslipHistory.updateMany(
        { month, employeeId: { $in: employeeIds }, isCurrent: true },
        { $set: { isCurrent: false, revertedAt: new Date(), revertedBy: by } }
      );
    } else {
      release.released = false;
      release.empState.forEach((s) => {
        s.released = false; s.releasedAt = null;
        s.published = false; s.publishedAt = null;
      });
      release.markModified("empState");
      // Revert ALL current snapshots for the month (keep history)
      const by = req.user?.employeeId ?? null;
      await PayslipHistory.updateMany(
        { month, isCurrent: true },
        { $set: { isCurrent: false, revertedAt: new Date(), revertedBy: by } }
      );
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

    // Employees can only download AFTER their slip is PUBLISHED (stage 2).
    // HR can download anytime. (Released alone = HR-verified, not yet visible.)
    if (!isHR && !emp.published)
      return res.status(403).json({ success: false, message: "Payslip not available yet" });

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
    if (!slip || !slip.published)
      return res.status(403).json({ success: false, message: "Payslip not available yet" });

    return res.status(200).json({
      success: true,
      month,
      window: data.window,
      released: slip.published,
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

    // A month is available to this employee only if their slip is PUBLISHED
    // (stage 2). Released-but-not-published slips stay hidden from employees.
    const releases = await PayrollRelease.find({
      empState: { $elemMatch: { employeeId, published: true } },
    }).select("month releasedAt empState").sort({ month: -1 }).lean();

    const months = releases
      .filter((r) => {
        const st = (r.empState ?? []).find((s) => s.employeeId === employeeId);
        return !!st?.published;
      })
      .map((r) => {
        const st = (r.empState ?? []).find((s) => s.employeeId === employeeId);
        return { month: r.month, releasedAt: st?.publishedAt ?? st?.releasedAt ?? r.releasedAt };
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
    const empPublished = !!empSt?.published;
    if (!isHR && !empPublished)
      return res.status(403).json({ success: false, message: "Not available yet" });

    // If a current frozen snapshot exists, serve the FROZEN violation data so
    // the report stays identical to release time. Otherwise compute live.
    const snap = await PayslipHistory.findOne({ month, employeeId, isCurrent: true }).lean();
    let reportPayload;
    if (snap?.violationSnapshot?.employee) {
      const vs = snap.violationSnapshot;
      reportPayload = {
        employee: vs.employee,
        manualViolations: vs.manualViolations ?? [],
        cycle: vs.cycle ?? { label: snap.cycleLabel ?? month },
        officeTiming: vs.officeTiming ?? {},
        gracePolicy: vs.gracePolicy ?? {},
        meta: {},
      };
    } else {
      const v = await computeSalaryViolations({ month, employeeId });
      const employee = v.byEmployee.find((e) => e.employeeId === employeeId) ?? {
        employeeId, name: employeeId, designation: "", department: "",
        lateCount: 0, earlyLogoutCount: 0, breakViolationCount: 0,
        missedClockOutCount: 0, notMarkedCount: 0, totalViolationDays: 0, totalViolations: 0,
        days: [],
      };
      const manualViolations = (empSt?.manualViolations ?? []).map((mv) => ({
        message: mv.message, date: mv.date, dayCost: mv.dayCost,
      }));
      reportPayload = {
        employee, manualViolations,
        cycle: { label: v.windowInfo?.label ?? month, startDate: v.windowInfo?.startDate, endDate: v.windowInfo?.endDate, startDay: v.startDay },
        officeTiming: v.officeTiming,
        gracePolicy: v.gracePolicy,
        meta: {},
      };
    }

    const employee = reportPayload.employee;
    const pdfBuffer = await generateSalaryViolationReport(reportPayload);

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

// ─── GET /api/payroll/history?month=&employeeId= ──────────────────────────────
// HR/Admin — per-employee version history (all snapshots, newest first).
export const getEmployeePayslipHistory = async (req, res) => {
  try {
    const { month, employeeId } = req.query;
    if (!employeeId) return res.status(400).json({ success: false, message: "employeeId required" });
    const q = { employeeId };
    if (month) q.month = month;
    const history = await PayslipHistory.find(q).sort({ month: -1, version: -1 }).lean();
    const versions = history.map((h) => ({
      id: String(h._id),
      month: h.month,
      version: h.version,
      isCurrent: h.isCurrent,
      releasedAt: h.releasedAt,
      releasedBy: h.releasedBy,
      revertedAt: h.revertedAt,
      revertedBy: h.revertedBy,
      cycleLabel: h.cycleLabel,
      netSalary: h.snapshot?.pay?.netSalary ?? null,
      workedDays: h.snapshot?.pay?.workedDays ?? null,
      violationDayCost: h.snapshot?.pay?.violationDayCost ?? null,
    }));
    return res.status(200).json({ success: true, employeeId, versions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payroll/history/month?month=YYYY-MM ─────────────────────────────
// HR/Admin — overall month-level history: latest version per employee + counts.
export const getMonthPayslipHistory = async (req, res) => {
  try {
    const month = req.query.month;
    if (!month) return res.status(400).json({ success: false, message: "month required" });
    const all = await PayslipHistory.find({ month }).sort({ employeeId: 1, version: -1 }).lean();

    // Group by employee
    const byEmp = {};
    for (const h of all) {
      if (!byEmp[h.employeeId]) byEmp[h.employeeId] = [];
      byEmp[h.employeeId].push(h);
    }
    const employees = Object.entries(byEmp).map(([employeeId, versions]) => {
      const current = versions.find((v) => v.isCurrent) ?? null;
      const latest = versions[0];
      return {
        employeeId,
        name: latest.snapshot?.name ?? employeeId,
        totalVersions: versions.length,
        currentVersion: current?.version ?? null,
        isReleased: !!current,
        latestNet: latest.snapshot?.pay?.netSalary ?? null,
        lastReleasedAt: latest.releasedAt,
        lastRevertedAt: latest.revertedAt,
      };
    });

    return res.status(200).json({
      success: true, month,
      totalEmployees: employees.length,
      totalSnapshots: all.length,
      employees,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payroll/history/:historyId/slip ─────────────────────────────────
// HR/Admin — download the payslip PDF of a specific historical version.
export const downloadHistoricalPayslip = async (req, res) => {
  try {
    const { historyId } = req.params;
    const h = await PayslipHistory.findById(historyId).lean();
    if (!h) return res.status(404).json({ success: false, message: "Version not found" });

    const pdfBuffer = await generatePayslip({ employee: h.snapshot, month: h.month });
    const safeName = (h.snapshot?.name ?? h.employeeId).replace(/\s+/g, "_");
    const fileName = `${safeName}_${h.employeeId}_${h.month}_v${h.version}_payslip.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("downloadHistoricalPayslip Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/payroll/history/:historyId/violation-report ─────────────────────
// HR/Admin — download the FROZEN violation report PDF for a specific version.
export const downloadHistoricalViolationReport = async (req, res) => {
  try {
    const { historyId } = req.params;
    const h = await PayslipHistory.findById(historyId).lean();
    if (!h) return res.status(404).json({ success: false, message: "Version not found" });

    const vs = h.violationSnapshot;
    if (!vs || !vs.employee)
      return res.status(404).json({ success: false, message: "No violation data for this version" });

    const pdfBuffer = await generateSalaryViolationReport({
      employee: vs.employee,
      manualViolations: vs.manualViolations ?? [],
      cycle: vs.cycle ?? { label: h.cycleLabel ?? h.month },
      officeTiming: vs.officeTiming ?? {},
      gracePolicy: vs.gracePolicy ?? {},
      meta: {},
    });

    const safeName = (h.snapshot?.name ?? h.employeeId).replace(/\s+/g, "_");
    const fileName = `${safeName}_${h.employeeId}_${h.month}_v${h.version}_violations.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("downloadHistoricalViolationReport Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};