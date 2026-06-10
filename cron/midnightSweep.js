// ─── Midnight Sweep Cron ─────────────────────────────────────────────────────
//
// Fires every night at 00:00 Asia/Kolkata and closes any open break left on
// past-day attendance records. Leaves `clockOut` null intentionally — that's
// how the frontend detects a "Missed Clock-Out" violation:
//
//   isMissedClockOut = !!clockIn && !clockOut && date < today (IST)
//
// Also runs once at server start (startupCatchUp) so sessions that slipped
// through midnight while the server was offline get cleaned up immediately.
//
// "Today" is derived from nowIST() (authoritative true-time, tamper-resistant),
// NOT the raw local clock — so the sweep can't be tricked by a wrong OS clock.
//
// Place this file at: src/cron/midnightSweep.js
// Import it once from your server entry (e.g. index.js):  import "./cron/midnightSweep.js";

import cron from "node-cron";
import Attendance from "../model/Attendance.js";
import { nowIST } from "../utils/trueTime.js";

const IST = "Asia/Kolkata";

// ─── Helper: "9:34:23 PM" → minutes since midnight ────────────────────────────
function timeStrToMinutes(t) {
  if (!t) return null;
  const [timePart, periodRaw] = t.trim().split(" ");
  if (!timePart || !periodRaw) return null;
  const period = periodRaw.toUpperCase();
  let [h, m] = timePart.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

// ─── Core sweep logic ─────────────────────────────────────────────────────────
export async function sweepOpenSessions() {
  const todayIST = nowIST().format("YYYY-MM-DD");

  // Find all past sessions that were never clocked out
  const openSessions = await Attendance.find({
    date:     { $lt: todayIST },              // strictly before today (IST)
    clockIn:  { $exists: true, $ne: null },
    clockOut: null,
  });

  if (openSessions.length === 0) {
    console.log(`[Midnight Sweep] ${todayIST} — no stale open sessions found.`);
    return { swept: 0 };
  }

  let swept = 0;

  for (const session of openSessions) {
    let changed = false;

    // Close any dangling open break at end-of-day (11:59:59 PM)
    const lastBreak = session.breaks?.at(-1);
    if (lastBreak && !lastBreak.end) {
      const closeTime = "11:59:59 PM";
      lastBreak.end = closeTime;
      lastBreak.endImage = null;
      lastBreak.endLocation = null;

      // Recalculate break violation if allowedMinutes was set
      if (lastBreak.allowedMinutes != null && lastBreak.start) {
        const startMins = timeStrToMinutes(lastBreak.start);
        const endMins   = timeStrToMinutes(closeTime);
        if (startMins != null && endMins != null) {
          const duration = endMins - startMins;
          const over =
            duration > lastBreak.allowedMinutes
              ? Math.round(duration - lastBreak.allowedMinutes)
              : null;
          lastBreak.overByMinutes    = over;
          lastBreak.isBreakViolation = over != null && over > 0;
        }
      }

      session.markModified("breaks");
      changed = true;
    }

    // NOTE: deliberately leave clockOut = null.
    // The frontend uses (clockIn && !clockOut && date < today) to render
    // the "Missed Clock-Out" violation badge.

    if (changed) {
      await session.save();
      swept++;
      console.log(
        `[Midnight Sweep] Closed dangling break for session ${session._id} ` +
        `(date: ${session.date}, emp: ${session.employeeId})`
      );
    } else {
      // No open break to close — record already counts as missed clock-out
      // by virtue of having clockIn but no clockOut on a past date.
      console.log(
        `[Midnight Sweep] Session ${session._id} (date: ${session.date}, ` +
        `emp: ${session.employeeId}) already had no open break — flagged as missed clock-out.`
      );
    }
  }

  console.log(
    `[Midnight Sweep] ${todayIST} — processed ${openSessions.length} stale session(s), ` +
    `closed ${swept} open break(s).`
  );

  return { swept, total: openSessions.length };
}

// ─── Startup Catch-Up ─────────────────────────────────────────────────────────
// Runs once on server start. Handles the case where the server was down at
// midnight IST and missed the scheduled sweep.
export async function startupCatchUp() {
  console.log("[Midnight Sweep] Startup catch-up — checking for stale open sessions…");
  try {
    await sweepOpenSessions();
  } catch (err) {
    console.error("[Midnight Sweep] Startup catch-up failed:", err);
  }
}

// ─── Schedule the cron ────────────────────────────────────────────────────────
// "0 0 * * *" = every day at 00:00 in the given timezone (IST).
cron.schedule("0 0 * * *", () => {
  console.log("[Midnight Sweep] Cron fired at 00:00 IST.");
  sweepOpenSessions().catch((err) =>
    console.error("[Midnight Sweep] Cron run failed:", err)
  );
}, {
  timezone: IST,
  scheduled: true,
});

console.log("[Midnight Sweep] Cron registered — fires nightly at 00:00 IST.");

// Auto-run catch-up on import
startupCatchUp().catch((err) =>
  console.error("[Midnight Sweep] Initial catch-up failed:", err)
);