/**
 * permissionAttendance.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Connects APPROVED permissions with attendance.
 *
 *  START-of-shift permission  (e.g. 09:30-10:30, shift starts 09:30)
 *      → no late warning until the permission END (+ login grace).
 *        A late login inside the window counts as "permission taken".
 *  END-of-shift permission    (e.g. 17:30-18:30, shift ends 18:30)
 *      → employee may clock out at the permission START, no early-logout warning.
 *        Clocking out before the shift end counts as "permission taken".
 *  MID-shift permission       (e.g. 10:30-11:30)
 *      → employee records Permission Out / Permission In on the clock page.
 *        Returning after the permission end (+ permission grace) is a warning.
 *
 * Only APPROVED permissions are ever considered, so a cancelled / rejected
 * permission automatically falls back to the normal late / early rules.
 */
import Permission from "../model/Permission.js";
import Attendance from "../model/Attendance.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);

export const hhmm = (s) => {
  if (!s) return null;
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + m;
};

/** "h:mm:ss A" → whole minutes since midnight (seconds ignored, like attendance) */
export const clockMins = (t) => {
  if (!t) return null;
  const parts = t.trim().split(" ");
  const [h, m] = parts[0].split(":").map(Number);
  const p = (parts[1] ?? "").toUpperCase();
  let hours = h;
  if (p === "PM" && hours !== 12) hours += 12;
  if (p === "AM" && hours === 12) hours = 0;
  return hours * 60 + m;
};

export const fmtHHMM12 = (mins) => {
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  const ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
};

const dayStr = (d) => dayjs.utc(d).format("YYYY-MM-DD");

/** Approved permissions for one employee on one date (YYYY-MM-DD) */
export async function getApprovedPermissions(employeeId, date) {
  const start = dayjs.utc(date).startOf("day").toDate();
  const end = dayjs.utc(date).endOf("day").toDate();
  return Permission.find({
    employeeId,
    status: "APPROVED",
    date: { $gte: start, $lte: end },
  }).sort({ fromTime: 1 }).lean();
}

/** Approved permissions for many employees over a date range → Map("emp|date" → perms[]) */
export async function getApprovedPermissionMap(employeeIds, dateFrom, dateTo) {
  const q = {
    status: "APPROVED",
    date: { $gte: dayjs.utc(dateFrom).startOf("day").toDate(), $lte: dayjs.utc(dateTo).endOf("day").toDate() },
  };
  if (employeeIds?.length) q.employeeId = { $in: employeeIds };
  const perms = await Permission.find(q).sort({ fromTime: 1 }).lean();
  const map = new Map();
  for (const p of perms) {
    const k = `${p.employeeId}|${dayStr(p.date)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return map;
}

/**
 * Classify the day's approved permissions against the shift and work out the
 * effective shift start / end.  Chained permissions (09:30-10:00 + 10:00-10:30)
 * extend the cover.
 */
export function classifyPermissions(perms, startMins, endMins) {
  const list = (perms ?? []).map((p) => ({ p, pf: hhmm(p.fromTime), pt: hhmm(p.toTime), kind: "MID" }));
  let effStart = startMins;
  let changed = true;
  while (changed) {
    changed = false;
    for (const x of list) {
      if (x.kind === "MID" && x.pf <= effStart && x.pt > effStart) {
        x.kind = "START"; effStart = x.pt; changed = true;
      }
    }
  }
  let effEnd = endMins;
  changed = true;
  while (changed) {
    changed = false;
    for (const x of list) {
      if (x.kind === "MID" && x.pt >= effEnd && x.pf < effEnd) {
        x.kind = "END"; effEnd = x.pf; changed = true;
      }
    }
  }
  return { list, effStart, effEnd };
}

/**
 * Late / early values for a clock-in / clock-out, permission aware.
 * Returns the same shape the clock controllers already store.
 */
export function evalLogin({ clockInMins, startMins, endMins, graceMinutes, perms }) {
  const { effStart } = classifyPermissions(perms, startMins, endMins);
  const late = clockInMins != null && clockInMins > effStart + graceMinutes;
  return {
    lateLogin: late,
    lateByMinutes: late ? Math.round(clockInMins - effStart) : null,
    effStart,
  };
}

export function evalLogout({ clockOutMins, startMins, endMins, perms }) {
  const { effEnd } = classifyPermissions(perms, startMins, endMins);
  const early = clockOutMins != null && clockOutMins < effEnd;
  return {
    earlyLogout: early,
    earlyByMinutes: early ? Math.round(effEnd - clockOutMins) : null,
    effEnd,
  };
}

/** Has this (approved) permission already started? date/time are IST strings */
export function permissionStarted(p, nowDate, nowMins, att) {
  const d = dayStr(p.date);
  if (d < nowDate) return true;
  if (d > nowDate) return false;
  if (att?.permissionEntries?.some((e) => e.requestId === p.requestId)) return true;
  return nowMins >= hhmm(p.fromTime);
}

/**
 * Re-derive late / early flags (and drop orphaned mid-shift entries) for one
 * employee/day after a permission was approved or cancelled.
 */
export async function reconcileAttendance(employeeId, date, timing) {
  const att = await Attendance.findOne({ employeeId, date });
  if (!att) return null;
  const perms = await getApprovedPermissions(employeeId, date);
  const startMins = hhmm(timing.startTime);
  const endMins = hhmm(timing.endTime);

  if (att.clockIn) {
    const r = evalLogin({
      clockInMins: clockMins(att.clockIn), startMins, endMins,
      graceMinutes: timing.graceMinutes ?? 0, perms,
    });
    att.lateLogin = r.lateLogin;
    att.lateByMinutes = r.lateByMinutes;
  }
  if (att.clockOut) {
    const r = evalLogout({ clockOutMins: clockMins(att.clockOut), startMins, endMins, perms });
    att.earlyLogout = r.earlyLogout;
    att.earlyByMinutes = r.earlyByMinutes;
  }
  const approvedIds = new Set(perms.map((p) => p.requestId));
  const before = att.permissionEntries?.length ?? 0;
  att.permissionEntries = (att.permissionEntries ?? []).filter((e) => approvedIds.has(e.requestId));
  if (att.permissionEntries.length !== before) att.markModified("permissionEntries");
  await att.save();
  return att;
}

/**
 * Per-permission view for the HR attendance screens.
 * status: UPCOMING | PENDING (window open, not recorded yet) | ACTIVE (out now)
 *         TAKEN | VIOLATED | NOT_TAKEN | COVERED (shift-edge permission used)
 */
export function buildPermissionView(log, perms, { startMins, endMins, graceMinutes, permGrace, nowDate, nowMins }) {
  if (!perms?.length) return [];
  const { list } = classifyPermissions(perms, startMins, endMins);
  const date = log?.date;
  const isToday = date === nowDate;
  const isPast = date < nowDate;
  const inMins = clockMins(log?.clockIn);
  const outMins = clockMins(log?.clockOut);

  return list.map(({ p, pf, pt, kind }) => {
    const base = {
      requestId: p.requestId, kind,
      fromTime: p.fromTime, toTime: p.toTime,
      durationText: p.durationText || "", durationHours: p.durationHours,
      reason: p.reason,
    };

    if (kind === "START") {
      if (inMins == null) {
        return { ...base, status: isPast ? "NOT_TAKEN" : "PENDING", note: isPast ? "No clock-in recorded" : "Waiting for login" };
      }
      const used = inMins > startMins + graceMinutes;
      if (!used) return { ...base, status: "NOT_TAKEN", note: "Logged in on time — permission not used" };
      const overBy = Math.max(0, inMins - pt);
      return overBy > graceMinutes
        ? { ...base, status: "VIOLATED", overByMinutes: overBy, note: `Logged in ${overBy}m after permission end` }
        : { ...base, status: "TAKEN", note: "Late login covered by permission" };
    }

    if (kind === "END") {
      if (outMins == null) {
        return { ...base, status: isPast ? "NOT_TAKEN" : "PENDING", note: isPast ? "No clock-out recorded" : "Waiting for logout" };
      }
      if (outMins >= endMins) return { ...base, status: "NOT_TAKEN", note: "Worked full shift — permission not used" };
      return outMins < pf
        ? { ...base, status: "VIOLATED", overByMinutes: pf - outMins, note: `Logged out ${pf - outMins}m before permission start` }
        : { ...base, status: "TAKEN", note: "Early logout covered by permission" };
    }

    // MID
    const entry = (log?.permissionEntries ?? []).find((e) => e.requestId === p.requestId);
    if (entry) {
      if (!entry.end) {
        const overdue = isToday && nowMins > pt + permGrace;
        return {
          ...base, status: "ACTIVE", start: entry.start, overdue,
          overByMinutes: overdue ? nowMins - pt : 0,
          note: overdue ? `Not back yet — ${nowMins - pt}m past permission end` : "Out on permission",
        };
      }
      return {
        ...base, start: entry.start, end: entry.end,
        status: entry.isViolation ? "VIOLATED" : "TAKEN",
        overByMinutes: entry.overByMinutes ?? 0,
        note: entry.isViolation ? `Returned ${entry.overByMinutes}m late` : "Returned on time",
      };
    }
    if (isPast) return { ...base, status: "NOT_TAKEN", note: "Permission not used" };
    if (isToday && nowMins >= pt) return { ...base, status: "NOT_TAKEN", note: "Permission not used" };
    return { ...base, status: isToday && nowMins >= pf ? "PENDING" : "UPCOMING", note: isToday && nowMins >= pf ? "Step out available" : "Approved" };
  });
}
