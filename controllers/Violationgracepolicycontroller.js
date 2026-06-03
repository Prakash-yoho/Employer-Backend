import ViolationGracePolicy from "../model/ViolationGracePolicy.js";
import Attendance from "../model/Attendance.js";
import Employee from "../model/Employee.js";
import OfficeTiming from "../model/Officetiming.js";
import { computeCycleWindow, getSalaryCycleStartDay } from "../utils/Salarycyclehelper.js";
import { hhmmToMinutes, timeStrToMinutes } from "./Officetimingcontroller.js";

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

    // Office start/end in minutes — used to recompute lateBy/earlyBy from the
    // raw clock times, measured from START (and END), NOT from the grace cutoff.
    const officeStartMins = hhmmToMinutes(officeTiming.startTime);
    const officeEndMins   = hhmmToMinutes(officeTiming.endTime);

    // ── Resolve the date window ───────────────────────────────────────────────
    // Priority: explicit date/month/year → else salary cycle (default current)
    let attFilter = {};
    let windowInfo = null;

    if (date) {
      attFilter.date = date;
    } else if (month) {
      attFilter.date = { $regex: `^${month}` };
    } else if (year) {
      attFilter.date = { $regex: `^${year}` };
    } else {
      // Default → salary cycle
      const offset = parseInt(cycleOffset ?? "0", 10) || 0;
      const win = computeCycleWindow(startDay, offset);
      windowInfo = win;
      attFilter.date = { $gte: win.startDate, $lte: win.endDate };
    }

    const logs = await Attendance.find(attFilter).lean();

    // Used to detect missed clock-out — only past days count (today still active)
    const todayStr = new Date().toISOString().split("T")[0];

    // ── Employee cache ────────────────────────────────────────────────────────
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
      // Recompute from the raw clock-in/out times so the value is measured
      // from office START / END — independent of any stored (possibly stale)
      // lateByMinutes that may have been saved relative to the grace cutoff.
      const clockInMins  = timeStrToMinutes(log.clockIn);
      const clockOutMins = timeStrToMinutes(log.clockOut);

      // ── Late login ──────────────────────────────────────────────────────────
      // lateBy = clockIn − officeStart (true lateness, no grace baked in)
      // Violation only when that lateness exceeds the salary login grace.
      const lateByFromStart =
        clockInMins != null && clockInMins > officeStartMins
          ? Math.round(clockInMins - officeStartMins)
          : 0;
      const isLate = lateByFromStart > loginGraceMinutes;

      // ── Early logout ────────────────────────────────────────────────────────
      // earlyBy = officeEnd − clockOut (true earliness, no grace baked in)
      const earlyByFromEnd =
        clockOutMins != null && clockOutMins < officeEndMins
          ? Math.round(officeEndMins - clockOutMins)
          : 0;
      const isEarlyLogout = earlyByFromEnd > logoutGraceMinutes;

      // ── Break violations — per-break-type grace ───────────────────────────────
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
            billableMinutes: Math.max(0, b.overByMinutes - grace),
          };
        })
        .filter((b) => b.billableMinutes > 0);

      const hasBreakViolation = salaryBreakViolations.length > 0;

      // ── Missed clock-out ──────────────────────────────────────────────────────
      // Had a clock-in, never clocked out, and the day is already over.
      // No grace concept here — it's binary.
      const isMissedClockOut =
        log.clockIn != null &&
        !log.clockOut &&
        log.date < todayStr;

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
        lateByMinutes:       isLate ? lateByFromStart : null,
        lateBillableMinutes: isLate ? Math.max(0, lateByFromStart - loginGraceMinutes) : null,

        isEarlyLogout,
        earlyByMinutes:       isEarlyLogout ? earlyByFromEnd : null,
        earlyBillableMinutes: isEarlyLogout ? Math.max(0, earlyByFromEnd - logoutGraceMinutes) : null,

        hasBreakViolation,
        breakViolations: salaryBreakViolations,

        isMissedClockOut,
      });
    }

    // Sort per-day records: recent first, then employee
    dayRecords.sort((a, b) =>
      a.date > b.date ? -1
      : a.date < b.date ? 1
      : a.employeeId.localeCompare(b.employeeId)
    );

    // ── Aggregate per employee ────────────────────────────────────────────────
    const byEmpMap = {};
    for (const r of dayRecords) {
      if (!byEmpMap[r.employeeId]) {
        byEmpMap[r.employeeId] = {
          employeeId:  r.employeeId,
          name:        r.name,
          designation: r.designation,
          department:  r.department,
          avatar:      r.avatar,

          lateCount:           0,
          earlyLogoutCount:    0,
          breakViolationCount: 0, // counts violating break slots
          breakViolationDays:  0, // counts days with at least one break violation
          missedClockOutCount: 0, // counts days with a missed clock-out
          totalViolationDays:  0, // distinct days with any violation

          lateBillableMinutes:  0,
          earlyBillableMinutes: 0,
          breakBillableMinutes: 0,
          totalBillableMinutes: 0,

          days: [], // the per-day records for this employee
        };
      }
      const agg = byEmpMap[r.employeeId];

      if (r.isLate) {
        agg.lateCount += 1;
        agg.lateBillableMinutes += r.lateBillableMinutes ?? 0;
      }
      if (r.isEarlyLogout) {
        agg.earlyLogoutCount += 1;
        agg.earlyBillableMinutes += r.earlyBillableMinutes ?? 0;
      }
      if (r.hasBreakViolation) {
        agg.breakViolationDays += 1;
        agg.breakViolationCount += r.breakViolations.length;
        agg.breakBillableMinutes += r.breakViolations.reduce(
          (s, b) => s + b.billableMinutes, 0
        );
      }
      if (r.isMissedClockOut) {
        agg.missedClockOutCount += 1;
      }
      agg.totalViolationDays += 1;
      agg.days.push(r);
    }

    const byEmployee = Object.values(byEmpMap).map((e) => {
      e.totalBillableMinutes =
        e.lateBillableMinutes + e.earlyBillableMinutes + e.breakBillableMinutes;
      return e;
    });

    // Sort employees by total billable minutes desc (most violations first)
    byEmployee.sort((a, b) => b.totalBillableMinutes - a.totalBillableMinutes);

    return res.status(200).json({
      success: true,
      count: dayRecords.length,
      employeeCount: byEmployee.length,
      gracePolicy: {
        loginGraceMinutes,
        logoutGraceMinutes,
        breakGrace: bg,
      },
      officeTiming: {
        startTime:    officeTiming.startTime,
        endTime:      officeTiming.endTime,
        graceMinutes: officeTiming.graceMinutes,
      },
      salaryCycle: {
        startDay,
        window: windowInfo, // null when explicit month/year/date used
      },
      data:       dayRecords, // per-day view
      byEmployee,             // grouped view
    });
  } catch (err) {
    console.error("getSalaryViolations Error:", err);
    return res.status(500).json({ error: err.message });
  }
};