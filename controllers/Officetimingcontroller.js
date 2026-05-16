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
 * Convert a locale time string like "9:36:00 AM" / "07:05:00 PM" to minutes
 * since midnight. Handles both 12-h and 24-h formats.
 */
export function timeStrToMinutes(t) {
  if (!t) return null;
  const parts = t.trim().split(" ");
  const [h, m, s] = parts[0].split(":").map(Number);
  const period = (parts[1] ?? "").toUpperCase();

  let hours = h;
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  return hours * 60 + m + (s ?? 0) / 60;
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
// Returns employees with late logins or early logouts in the period.
export const getViolationsReport = async (req, res) => {
  try {
    const { month, year, date } = req.query;

    const timing = await getTiming();
    const cutoffMins   = hhmmToMinutes(timing.startTime) + timing.graceMinutes;
    const endTimeMins  = hhmmToMinutes(timing.endTime);

    // Build date filter
    const filter = {};
    if (date)       filter.date = date;
    else if (month) filter.date = { $regex: `^${month}` };
    else if (year)  filter.date = { $regex: `^${year}` };
    else {
      // Default: current month
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      filter.date = { $regex: `^${d.getFullYear()}-${m}` };
    }

    const logs = await Attendance.find(filter).lean();

    // Annotate each log
    const violations = [];
    for (const log of logs) {
      const clockInMins  = timeStrToMinutes(log.clockIn);
      const clockOutMins = timeStrToMinutes(log.clockOut);

      const isLate        = clockInMins  != null && clockInMins  > cutoffMins;
      const isEarlyLogout = clockOutMins != null && clockOutMins < endTimeMins;

      if (!isLate && !isEarlyLogout) continue;

      // Fetch employee name (lightweight)
      const emp = await Employee.findOne({ employeeId: log.employeeId })
        .select("firstName lastName designation department avatar")
        .lean();

      violations.push({
        _id:          log._id,
        employeeId:   log.employeeId,
        name:         emp ? `${emp.firstName} ${emp.lastName}` : log.employeeId,
        designation:  emp?.designation ?? "",
        department:   emp?.department  ?? "",
        avatar:       emp?.avatar      ?? null,
        date:         log.date,
        clockIn:      log.clockIn  ?? null,
        clockOut:     log.clockOut ?? null,
        isLate,
        isEarlyLogout,
        lateByMinutes: isLate
          ? Math.round(clockInMins - cutoffMins)
          : null,
        earlyByMinutes: isEarlyLogout
          ? Math.round(endTimeMins - clockOutMins)
          : null,
      });
    }

    // Sort: most recent date first, then employeeId
    violations.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.employeeId.localeCompare(b.employeeId)));

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