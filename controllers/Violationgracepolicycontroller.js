import ViolationGracePolicy from "../model/ViolationGracePolicy.js";
import Attendance from "../model/Attendance.js";
import Employee from "../model/Employee.js";
import OfficeTiming from "../model/Officetiming.js";
import Holiday from "../model/Holiday.js";
import Leave from "../model/Leave.js";
import { computeCycleWindow, getSalaryCycleStartDay } from "../utils/Salarycyclehelper.js";
import { hhmmToMinutes, timeStrToMinutes } from "./Officetimingcontroller.js";
import { generateSalaryViolationReport } from "../services/salaryViolationReportService.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getGracePolicy() {
  let doc = await ViolationGracePolicy.findOne({ key: "default" });
  if (!doc) doc = await ViolationGracePolicy.create({ key: "default" });
  return doc;
}

async function getOfficeTiming() {
  let doc = await OfficeTiming.findOne({ key: "default" });
  if (!doc) doc = await OfficeTiming.create({ key: "default" });
  return doc;
}

/**
 * Detects "not marked attendance" days and appends them to dayRecords.
 *
 * A NOT_MARKED violation is a day that is:
 *   - within [windowStart, windowEnd]
 *   - Monday–Friday (no weekends)
 *   - not a public holiday
 *   - on or before today (no future days)
 *   - has NO attendance record for that employee
 *   - is NOT covered by an APPROVED leave
 *
 * Mutates `dayRecords` in place.
 */
async function detectNotMarkedDays({ dayRecords, windowStart, windowEnd, employeeId, logs }) {
  if (!windowStart || !windowEnd) return;

  const todayStr = new Date().toISOString().split("T")[0];

  // Cap the scan at today — never flag future days
  const scanEnd = windowEnd > todayStr ? todayStr : windowEnd;
  if (windowStart > scanEnd) return;

  // ── Which employees do we scan? ──
  // If scoped to one employee (PDF report), just that one.
  // Otherwise, every active employee — because an employee with ZERO attendance
  // in the window won't appear in `logs` at all, yet may still owe "not marked" days.
  let employees;
  if (employeeId) {
    const emp = await Employee.findOne({ employeeId })
      .select("employeeId firstName lastName designation department avatar")
      .lean();
    employees = emp ? [emp] : [];
  } else {
    employees = await Employee.find({ isActive: true })
      .select("employeeId firstName lastName designation department avatar")
      .lean();
  }
  if (employees.length === 0) return;

  const empIds = employees.map((e) => e.employeeId);

  // ── Holidays in the scan range ──
  const years = new Set();
  years.add(Number(windowStart.slice(0, 4)));
  years.add(Number(scanEnd.slice(0, 4)));
  const holidayDocs = await Holiday.find({ year: { $in: [...years] } }).lean();
  const holidaySet = new Set(holidayDocs.map((h) => dayjs.utc(h.date).format("YYYY-MM-DD")));

  // ── Attendance dates already present, keyed by employee ──
  // (logs only contains the scoped set already; build a set of "emp|date")
  const attendanceSet = new Set(logs.map((l) => `${l.employeeId}|${l.date}`));

  // ── Approved leaves overlapping the window, keyed by employee ──
  // Leave stores Mongo _id of employee in `employee`, plus employeeId string.
  const leaves = await Leave.find({
    employeeId: { $in: empIds },
    status: "APPROVED",
    startDate: { $lte: dayjs.utc(scanEnd).endOf("day").toDate() },
    endDate:   { $gte: dayjs.utc(windowStart).startOf("day").toDate() },
  }).select("employeeId startDate endDate").lean();

  // Build a set of "emp|date" covered by leave
  const leaveSet = new Set();
  for (const lv of leaves) {
    let cur = dayjs.utc(lv.startDate).startOf("day");
    const end = dayjs.utc(lv.endDate).startOf("day");
    while (cur.isSame(end) || cur.isBefore(end)) {
      leaveSet.add(`${lv.employeeId}|${cur.format("YYYY-MM-DD")}`);
      cur = cur.add(1, "day");
    }
  }

  // ── Walk each working day in the window for each employee ──
  for (const emp of employees) {
    let cursor = new Date(windowStart + "T00:00:00Z");
    const end  = new Date(scanEnd + "T00:00:00Z");

    while (cursor <= end) {
      const dateStr = cursor.toISOString().split("T")[0];
      const dow = cursor.getUTCDay(); // 0=Sun, 6=Sat

      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = holidaySet.has(dateStr);
      const key = `${emp.employeeId}|${dateStr}`;

      if (
        !isWeekend &&
        !isHoliday &&
        !attendanceSet.has(key) &&
        !leaveSet.has(key)
      ) {
        dayRecords.push({
          _id:        `notmarked-${emp.employeeId}-${dateStr}`,
          employeeId: emp.employeeId,
          name:       `${emp.firstName} ${emp.lastName}`,
          designation: emp.designation ?? "",
          department:  emp.department  ?? "",
          avatar:      emp.avatar      ?? null,
          date:        dateStr,
          clockIn:     null,
          clockOut:    null,
          isLate: false, lateByMinutes: null,
          isEarlyLogout: false, earlyByMinutes: null,
          hasBreakViolation: false, breakViolations: [],
          isMissedClockOut: false,
          isNotMarked: true,
        });
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
}


export async function computeSalaryViolations(opts = {}) {
  const { cycleOffset, month, year, date, employeeId } = opts;

  const [gracePolicy, officeTiming, startDay] = await Promise.all([
    getGracePolicy(),
    getOfficeTiming(),
    getSalaryCycleStartDay(),
  ]);

  const { loginGraceMinutes, logoutGraceMinutes, breakGrace } = gracePolicy;
  const bg = {
    MORNING: breakGrace?.MORNING ?? 0,
    LUNCH:   breakGrace?.LUNCH   ?? 0,
    EVENING: breakGrace?.EVENING ?? 0,
  };

  const officeStartMins = hhmmToMinutes(officeTiming.startTime);
  const officeEndMins   = hhmmToMinutes(officeTiming.endTime);

  // ── Resolve date window ──
  let attFilter = {};
  let windowInfo = null;
  let windowStart = null; // "YYYY-MM-DD" inclusive — for NOT_MARKED walking
  let windowEnd   = null; // "YYYY-MM-DD" inclusive

  if (date) {
    attFilter.date = date;
    windowStart = date;
    windowEnd   = date;
  } else if (month) {
    // Resolve the SALARY CYCLE whose END falls in this calendar month.
    // E.g. month=2026-05, startDay=21 → cycle 2026-04-21 .. 2026-05-20.
    //
    // Trick: use a reference date of (startDay - 1) within the selected month.
    // That day is < startDay, so computeCycleWindow rolls back to the cycle
    // that started the PREVIOUS month and ends on (startDay-1) of THIS month.
    const [y, m] = month.split("-").map(Number);
    const refDay = Math.max(1, startDay - 1);
    const ref = new Date(y, m - 1, refDay);
    const win = computeCycleWindow(startDay, 0, ref);
    windowInfo = win;
    attFilter.date = { $gte: win.startDate, $lte: win.endDate };
    windowStart = win.startDate;
    windowEnd   = win.endDate;
  } else if (year) {
    attFilter.date = { $regex: `^${year}` };
    windowStart = `${year}-01-01`;
    windowEnd   = `${year}-12-31`;
  } else {
    const offset = parseInt(cycleOffset ?? "0", 10) || 0;
    const win = computeCycleWindow(startDay, offset);
    windowInfo = win;
    attFilter.date = { $gte: win.startDate, $lte: win.endDate };
    windowStart = win.startDate;
    windowEnd   = win.endDate;
  }

  // Optionally scope to one employee (used by the per-employee PDF report)
  if (employeeId) attFilter.employeeId = employeeId;

  const todayStr = new Date().toISOString().split("T")[0];

  // ── Cap the window at today ──
  // For an in-progress cycle we must NOT count upcoming days. Trim both the
  // NOT_MARKED walking range and the attendance query so future days never
  // enter any calculation.
  let effectiveEnd = windowEnd;
  if (effectiveEnd && effectiveEnd > todayStr) {
    effectiveEnd = todayStr;
    windowEnd = todayStr;
    // Re-apply the capped upper bound to the attendance date filter.
    if (attFilter.date && typeof attFilter.date === "object" && attFilter.date.$lte) {
      attFilter.date.$lte = todayStr;
    } else if (typeof attFilter.date === "object" && attFilter.date.$regex) {
      // month/year regex form → convert to a range capped at today
      attFilter.date = { $gte: windowStart, $lte: todayStr };
    }
  }

  const logs = await Attendance.find(attFilter).lean();

  const empCache = {};
  const getEmp = async (empId) => {
    if (empCache[empId] !== undefined) return empCache[empId];
    const emp = await Employee.findOne({ employeeId: empId })
      .select("firstName lastName designation department avatar")
      .lean();
    empCache[empId] = emp ?? null;
    return empCache[empId];
  };

  const dayRecords = [];

  for (const log of logs) {
    // ── Late by / Early by ──────────────────────────────────────────────────
    // Prefer the value STORED on the attendance record at clock-in / clock-out
    // time. That value was computed against the office hours IN EFFECT on that
    // day, so it stays correct even if office hours change later.
    //
    // Only fall back to recomputing from current office hours when the stored
    // value is missing (e.g. legacy records saved before the field existed).
    const clockInMins  = timeStrToMinutes(log.clockIn);
    const clockOutMins = timeStrToMinutes(log.clockOut);

    const lateByFromStart =
      log.lateByMinutes != null
        ? log.lateByMinutes // frozen value from that day's office start
        : (clockInMins != null && clockInMins > officeStartMins
            ? Math.round(clockInMins - officeStartMins)
            : 0);
    const isLate = lateByFromStart > loginGraceMinutes;

    const earlyByFromEnd =
      log.earlyByMinutes != null
        ? log.earlyByMinutes // frozen value from that day's office end
        : (clockOutMins != null && clockOutMins < officeEndMins
            ? Math.round(officeEndMins - clockOutMins)
            : 0);
    const isEarlyLogout = earlyByFromEnd > logoutGraceMinutes;

    const salaryBreakViolations = (log.breaks ?? [])
      .filter((b) => b.isBreakViolation && b.overByMinutes > 0)
      .map((b) => {
        const grace = bg[b.breakType] ?? 0;
        return {
          breakType:       b.breakType,
          allowedMinutes:  b.allowedMinutes,
          overByMinutes:   b.overByMinutes,
          takenMinutes:    (b.allowedMinutes ?? 0) + b.overByMinutes,
          graceMinutes:    grace,
        };
      })
      // Violation only counts when the overrun exceeds this break's grace
      .filter((b) => b.overByMinutes > (b.graceMinutes ?? 0));

    const hasBreakViolation = salaryBreakViolations.length > 0;

    const isMissedClockOut =
      log.clockIn != null && !log.clockOut && log.date < todayStr;

    if (!isLate && !isEarlyLogout && !hasBreakViolation && !isMissedClockOut) continue;

    const emp = await getEmp(log.employeeId);

    dayRecords.push({
      _id:        log._id,
      employeeId: log.employeeId,
      name:       emp ? `${emp.firstName} ${emp.lastName}` : log.employeeId,
      designation: emp?.designation ?? "",
      department:  emp?.department  ?? "",
      avatar:      emp?.avatar      ?? null,
      date:        log.date,
      clockIn:     log.clockIn  ?? null,
      clockOut:    log.clockOut ?? null,

      isLate,
      lateByMinutes:  isLate ? lateByFromStart : null,

      isEarlyLogout,
      earlyByMinutes: isEarlyLogout ? earlyByFromEnd : null,

      hasBreakViolation,
      breakViolations: salaryBreakViolations,

      isMissedClockOut,
      isNotMarked: false, // real attendance exists, so never "not marked"
    });
  }

  // ── NOT MARKED: working days with no attendance AND no leave ────────────────
  // Eligible day = Mon–Fri, not a holiday, on or before today, within window.
  // Excused if covered by an APPROVED leave.
  await detectNotMarkedDays({
    dayRecords,
    windowStart,
    windowEnd,
    employeeId,
    logs,
  });

  dayRecords.sort((a, b) =>
    a.date > b.date ? -1 : a.date < b.date ? 1 : a.employeeId.localeCompare(b.employeeId)
  );

  // ── Aggregate per employee ──
  const byEmpMap = {};
  for (const r of dayRecords) {
    if (!byEmpMap[r.employeeId]) {
      byEmpMap[r.employeeId] = {
        employeeId:  r.employeeId,
        name:        r.name,
        designation: r.designation,
        department:  r.department,
        avatar:      r.avatar,
        lateCount: 0, earlyLogoutCount: 0, breakViolationCount: 0,
        breakViolationDays: 0, missedClockOutCount: 0, notMarkedCount: 0,
        totalViolationDays: 0,
        totalViolations: 0, // grand total across all violation types
        days: [],
      };
    }
    const agg = byEmpMap[r.employeeId];
    if (r.isLate) agg.lateCount += 1;
    if (r.isEarlyLogout) agg.earlyLogoutCount += 1;
    if (r.hasBreakViolation) {
      agg.breakViolationDays += 1;
      agg.breakViolationCount += r.breakViolations.length;
    }
    if (r.isMissedClockOut) agg.missedClockOutCount += 1;
    if (r.isNotMarked) agg.notMarkedCount += 1;
    agg.totalViolationDays += 1;
    agg.days.push(r);
  }

  const byEmployee = Object.values(byEmpMap).map((e) => {
    e.totalViolations =
      e.lateCount + e.earlyLogoutCount + e.breakViolationCount +
      e.missedClockOutCount + e.notMarkedCount;
    return e;
  });
  // Most violations first
  byEmployee.sort((a, b) => b.totalViolations - a.totalViolations);

  return {
    dayRecords,
    byEmployee,
    windowInfo,
    officeTiming: {
      startTime:    officeTiming.startTime,
      endTime:      officeTiming.endTime,
      graceMinutes: officeTiming.graceMinutes,
    },
    gracePolicy: { loginGraceMinutes, logoutGraceMinutes, breakGrace: bg },
    startDay,
  };
}

// ─── GET /api/violation-grace-policy ─────────────────────────────────────────
export const getViolationGracePolicy = async (req, res) => {
  try {
    const [gracePolicy, officeTiming, startDay] = await Promise.all([
      getGracePolicy(),
      getOfficeTiming(),
      getSalaryCycleStartDay(),
    ]);

    return res.status(200).json({
      success: true,
      data: gracePolicy,
      officeTiming: {
        startTime:    officeTiming.startTime,
        endTime:      officeTiming.endTime,
        graceMinutes: officeTiming.graceMinutes,
      },
      salaryCycle: { startDay },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── PUT /api/violation-grace-policy ─────────────────────────────────────────
// Body: { loginGraceMinutes, logoutGraceMinutes, breakGrace: { MORNING, LUNCH, EVENING } }
export const updateViolationGracePolicy = async (req, res) => {
  try {
    const { loginGraceMinutes, logoutGraceMinutes, breakGrace } = req.body;
    const updatedBy = req.user?.employeeId ?? null;

    const update = {};
    if (loginGraceMinutes  !== undefined) update.loginGraceMinutes  = Number(loginGraceMinutes);
    if (logoutGraceMinutes !== undefined) update.logoutGraceMinutes = Number(logoutGraceMinutes);

    if (breakGrace !== undefined) {
      update.breakGrace = {
        MORNING: Number(breakGrace.MORNING ?? 0),
        LUNCH:   Number(breakGrace.LUNCH   ?? 0),
        EVENING: Number(breakGrace.EVENING ?? 0),
      };
    }
    if (updatedBy) update.updatedBy = updatedBy;

    const doc = await ViolationGracePolicy.findOneAndUpdate(
      { key: "default" },
      { $set: update },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/violations/salary ───────────────────────────────────────────────
// Query:
//   cycleOffset (int, default 0)  → 0 current cycle, -1 prev, +1 next
//   OR explicit month / year / date (overrides cycle)
//
// Returns BOTH:
//   data       → per-day violation records
//   byEmployee → aggregated totals per employee for the window
export const getSalaryViolations = async (req, res) => {
  try {
    const { cycleOffset, month, year, date } = req.query;

    const result = await computeSalaryViolations({ cycleOffset, month, year, date });

    return res.status(200).json({
      success: true,
      count: result.dayRecords.length,
      employeeCount: result.byEmployee.length,
      gracePolicy: result.gracePolicy,
      officeTiming: result.officeTiming,
      salaryCycle: {
        startDay: result.startDay,
        window: result.windowInfo,
      },
      data: result.dayRecords,
      byEmployee: result.byEmployee,
    });
  } catch (err) {
    console.error("getSalaryViolations Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/violations/salary/:employeeId/report ────────────────────────────
// Generates a Salary Violation Report PDF for ONE employee for the selected
// salary cycle (or explicit month/year/date) and streams it back as a download.
// No email, no S3 — generated on the fly.
//
// Query: cycleOffset (default 0) | month | year | date
//        refNo, letterDate (optional, for the letter header)
export const downloadSalaryViolationReport = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { cycleOffset, month, year, date, refNo, letterDate } = req.query;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    // Scope the computation to just this employee + window
    const result = await computeSalaryViolations({
      cycleOffset, month, year, date, employeeId,
    });

    // Find this employee's aggregated record
    const employee = result.byEmployee.find((e) => e.employeeId === employeeId);

    // No violations → still produce a clean report saying so
    const employeeData = employee ?? {
      employeeId,
      name: employeeId,
      designation: "",
      department: "",
      lateCount: 0, earlyLogoutCount: 0, breakViolationCount: 0,
      missedClockOutCount: 0, notMarkedCount: 0, totalViolationDays: 0, totalViolations: 0,
      days: [],
    };

    const cycleLabel = result.windowInfo?.label
      ?? (month || year || date || "Selected period");

    const pdfBuffer = await generateSalaryViolationReport({
      employee: employeeData,
      cycle: {
        label:     cycleLabel,
        startDate: result.windowInfo?.startDate,
        endDate:   result.windowInfo?.endDate,
        startDay:  result.startDay,
      },
      officeTiming: result.officeTiming,
      gracePolicy:  result.gracePolicy,
      meta: {
        refNo,
        letterDate,
        hrName:  req.body?.hrName  || process.env.HR_NAME  || "Hazeena Begum A",
        hrTitle: req.body?.hrTitle || process.env.HR_TITLE || "SR Executive - Human Resource",
      },
    });

    const safeName = (employeeData.name || employeeId).replace(/\s+/g, "");
    const fileName = `${safeName}_SalaryViolations.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("downloadSalaryViolationReport Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};