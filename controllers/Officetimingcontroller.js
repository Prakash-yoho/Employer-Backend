import OfficeTiming from "../model/OfficeTiming.js";
import Attendance from "../model/Attendance.js";
import Employee from "../model/Employee.js";

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
    if (startTime    !== undefined) update.startTime    = startTime;
    if (endTime      !== undefined) update.endTime      = endTime;
    if (graceMinutes !== undefined) update.graceMinutes = Number(graceMinutes);
    if (updatedBy)                  update.updatedBy    = updatedBy;

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

// ─── GET /api/office-timing/violations ────────────────────────────────────────
// Query: month (YYYY-MM) | year (YYYY) | date (YYYY-MM-DD)
//
// Violation types returned per record:
//   isLate          – clocked in after startTime + graceMinutes
//   isEarlyLogout   – clocked out before endTime
//   isMissedClockOut– had a clock-in on a past date but never clocked out
//
// "Past date" = date < today (today's active sessions are excluded).
export const getViolationsReport = async (req, res) => {
  try {
    const { month, year, date } = req.query;

    const timing      = await getTiming();
    const cutoffMins  = hhmmToMinutes(timing.startTime) + timing.graceMinutes;
    const endTimeMins = hhmmToMinutes(timing.endTime);

    // Today's date string – used to exclude still-active sessions
    const todayStr = new Date().toISOString().split("T")[0];

    // ── Build date filter ─────────────────────────────────────────────────────
    const filter = {};
    if (date)       filter.date = date;
    else if (month) filter.date = { $regex: `^${month}` };
    else if (year)  filter.date = { $regex: `^${year}` };
    else {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      filter.date = { $regex: `^${d.getFullYear()}-${m}` };
    }

    const logs = await Attendance.find(filter).lean();

    // Cache employee lookups to avoid N+1 queries
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
      // timeStrToMinutes now returns whole minutes (seconds dropped)
      const clockInMins  = timeStrToMinutes(log.clockIn);
      const clockOutMins = timeStrToMinutes(log.clockOut);

      // ── Violation flags ───────────────────────────────────────────────────
      // Late login: clock-in minute strictly after cutoff
      //   e.g. cutoff=575 (9:35), clockIn=575 (9:35:xx) → NOT late ✓
      //                           clockIn=576 (9:36:xx) → late      ✓
      const isLate = clockInMins != null && clockInMins > cutoffMins;

      // Early logout: clock-out minute strictly before end time
      const isEarlyLogout = clockOutMins != null && clockOutMins < endTimeMins;

      // Missed clock-out: had a clock-in, never clocked out, day is over
      //   Today's records are skipped — employee may still be working.
      const isMissedClockOut =
        log.clockIn  != null &&
        !log.clockOut        &&
        log.date < todayStr;  // strictly past dates only

      // Skip records with no violations at all
      if (!isLate && !isEarlyLogout && !isMissedClockOut) continue;

      const emp = await getEmp(log.employeeId);

      violations.push({
        _id:        log._id,
        employeeId: log.employeeId,
        name:       emp ? `${emp.firstName} ${emp.lastName}` : log.employeeId,
        designation: emp?.designation ?? "",
        department:  emp?.department  ?? "",
        avatar:      emp?.avatar      ?? null,
        date:        log.date,
        clockIn:     log.clockIn  ?? null,
        clockOut:    log.clockOut ?? null,

        // Late login
        isLate,
        lateByMinutes: isLate
          ? Math.round(clockInMins - cutoffMins)
          : null,

        // Early logout
        isEarlyLogout,
        earlyByMinutes: isEarlyLogout
          ? Math.round(endTimeMins - clockOutMins)
          : null,

        // Missed clock-out
        isMissedClockOut,
      });
    }

    // Sort: most recent date first, then employeeId
    violations.sort((a, b) =>
      a.date > b.date ? -1
        : a.date < b.date ? 1
          : a.employeeId.localeCompare(b.employeeId)
    );

    return res.status(200).json({
      success: true,
      count: violations.length,
      officeTiming: {
        startTime:    timing.startTime,
        endTime:      timing.endTime,
        graceMinutes: timing.graceMinutes,
      },
      data: violations,
    });
  } catch (err) {
    console.error("getViolationsReport Error:", err);
    return res.status(500).json({ error: err.message });
  }
};