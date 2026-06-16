import OfficeTiming from "../model/Officetiming.js";
import Attendance from "../model/Attendance.js";
import Employee from "../model/Employee.js";
import { getNow } from "../utils/trueTime.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert "HH:MM" (24h) to total minutes since midnight.
 */
export function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Convert a locale time string like "9:36:00 AM" / "07:05:00 PM" to total
 * WHOLE minutes since midnight — seconds are intentionally ignored.
 *
 * ⚠️  FIX: The previous version included seconds as a fraction ( + s/60 ).
 *     That caused clock-ins at e.g. 9:35:30 AM to be treated as > 575 min
 *     and incorrectly flagged as late even though the minute is still 9:35.
 *     Dropping seconds ensures that ANY clock-in during the 9:35 minute
 *     (9:35:00 – 9:35:59) is treated as exactly 575 min and is NOT late.
 *     Only 9:36:00 and beyond (≥ 576 min) will be flagged.
 */
export function timeStrToMinutes(t) {
  if (!t) return null;
  const parts = t.trim().split(" ");
  const [h, m] = parts[0].split(":").map(Number); // ← seconds deliberately ignored
  const period = (parts[1] ?? "").toUpperCase();

  let hours = h;
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  return hours * 60 + m; // ← whole minutes only, no fractional seconds
}

/**
 * Fetch (or lazily create) the singleton office-timing document.
 */
async function getTiming() {
  let doc = await OfficeTiming.findOne({ key: "default" });
  if (!doc) doc = await OfficeTiming.create({ key: "default" });
  return doc;
}

// ─── GET /api/office-timing ────────────────────────────────────────────────────
export const getOfficeTiming = async (req, res) => {
  try {
    const timing = await getTiming();
    return res.status(200).json({ success: true, data: timing });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── PUT /api/office-timing ────────────────────────────────────────────────────
// Body: { startTime, endTime, graceMinutes }
export const updateOfficeTiming = async (req, res) => {
  try {
    const { startTime, endTime, graceMinutes } = req.body;
    const updatedBy = req.user?.employeeId ?? null;

    const update = {};
    if (startTime !== undefined) update.startTime = startTime;
    if (endTime !== undefined) update.endTime = endTime;
    if (graceMinutes !== undefined) update.graceMinutes = Number(graceMinutes);
    if (updatedBy) update.updatedBy = updatedBy;

    const timing = await OfficeTiming.findOneAndUpdate(
      { key: "default" },
      { $set: update },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, data: timing });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Helper: format raw minutes → "Xhr Ym" ────────────────────────────────────
// 45 → "45m"  |  60 → "1hr"  |  90 → "1hr 30m"  |  125 → "2hr 5m"
function fmtMins(mins) {
  if (mins == null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}hr`;
  return `${h}hr ${m}m`;
}

export const getViolationsReport = async (req, res) => {
  try {
    const { month, year, date, startDate, endDate } = req.query;  // ← added startDate/endDate

    const timing = await getTiming();

    const todayStr = getNow().date;

    // ── Build date filter ─────────────────────────────────────────────────────
    const filter = {};
    if (date) {
      filter.date = date;
    } else if (startDate && endDate) {
      // ← salary-cycle range  e.g. 2026-04-21 → 2026-05-20
      filter.date = { $gte: startDate, $lte: endDate };
    } else if (month) {
      filter.date = { $regex: `^${month}` };
    } else if (year) {
      filter.date = { $regex: `^${year}` };
    } else {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      filter.date = { $regex: `^${d.getFullYear()}-${m}` };
    }

    const logs = await Attendance.find(filter).lean();

    const empCache = {};
    const getEmp = async (empId) => {
      if (empCache[empId] !== undefined) return empCache[empId];
      const emp = await Employee.findOne({ employeeId: empId })
        .select("firstName lastName designation department avatar")
        .lean();
      empCache[empId] = emp ?? null;
      return empCache[empId];
    };

    const violations = [];

    for (const log of logs) {

      // ── Use values STORED at clock-in/out time ────────────────────────────────
      // Never re-compute from current timing — the office times may have changed
      // since the employee clocked in, giving wrong late/early figures.
      const isLate = log.lateLogin ?? false;
      const isEarlyLogout = log.earlyLogout ?? false;
      const lateByMinutes = log.lateByMinutes ?? null;   // saved by clockIn controller
      const earlyByMinutes = log.earlyByMinutes ?? null;   // saved by clockOut controller

      // isMissedClockOut has no stored field — safe to derive at query time
      const isMissedClockOut =
        log.clockIn != null && !log.clockOut && log.date < todayStr;

      // Break violations are already stored on the break sub-document
      const breakViolations = (log.breaks ?? [])
        .filter((b) => b.isBreakViolation && b.overByMinutes > 0)
        .map((b) => {
          const taken = (b.allowedMinutes ?? 0) + b.overByMinutes;
          return {
            breakType: b.breakType,
            takenMinutes: taken,
            takenFormatted: fmtMins(taken),
            allowedMinutes: b.allowedMinutes,
            allowedFormatted: fmtMins(b.allowedMinutes),
            overByMinutes: b.overByMinutes,
            overFormatted: fmtMins(b.overByMinutes),
          };
        });

      const hasBreakViolation = breakViolations.length > 0;

      if (!isLate && !isEarlyLogout && !isMissedClockOut && !hasBreakViolation)
        continue;

      const emp = await getEmp(log.employeeId);

      violations.push({
        _id: log._id,
        employeeId: log.employeeId,
        name: emp ? `${emp.firstName} ${emp.lastName}` : log.employeeId,
        designation: emp?.designation ?? "",
        department: emp?.department ?? "",
        avatar: emp?.avatar ?? null,
        date: log.date,
        clockIn: log.clockIn ?? null,
        clockOut: log.clockOut ?? null,

        isLate,
        lateByMinutes,
        lateFormatted: fmtMins(lateByMinutes),    // "3hr 16m"

        isEarlyLogout,
        earlyByMinutes,
        earlyFormatted: fmtMins(earlyByMinutes),

        isMissedClockOut,

        breakViolations,
        hasBreakViolation,
      });
    }

    violations.sort((a, b) =>
      a.date > b.date ? -1 : a.date < b.date ? 1
        : a.employeeId.localeCompare(b.employeeId)
    );

    return res.status(200).json({
      success: true,
      count: violations.length,
      officeTiming: {
        startTime: timing.startTime,
        endTime: timing.endTime,
        graceMinutes: timing.graceMinutes,
      },
      data: violations,
    });
  } catch (err) {
    console.error("getViolationsReport Error:", err);
    return res.status(500).json({ error: err.message });
  }
};