// ─── True-Time Utility ───────────────────────────────────────────────────────
//
// Fetches authoritative UTC time from a public time API and computes the
// offset between true time and the local server clock. All attendance
// timestamps are then derived as (Date.now() + offset), making the RECORDED
// time tamper-resistant even if the OS clock is wrong.
//
// The same offset can be fed into the AWS S3 client's `systemClockOffset`
// (see config/s3.js) so presigned URLs are signed with corrected time too.
//
// Drop-in: import { getNow } from "../utils/trueTime.js";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const IST = "Asia/Kolkata";

// Offset in ms: (true_utc_ms - Date.now()). Positive = local clock is behind.
let serverTimeOffsetMs = 0;
let lastSyncedAt = null;

// Listeners fired after each successful sync (e.g. to update the S3 client).
const syncListeners = [];

// Each source's `extract` returns the true UTC time AS MILLISECONDS (number),
// built from unambiguous fields — never a bare string JS might parse as local.
const TIME_SOURCES = [
  {
    name: "worldtimeapi.org",
    url: "https://worldtimeapi.org/api/timezone/Etc/UTC",
    extract: (d) =>
      typeof d.unixtime === "number"
        ? d.unixtime * 1000                       // unix epoch seconds → ms (unambiguous)
        : Date.parse(d.utc_datetime),             // has +00:00, safe to parse
  },
  {
    name: "timeapi.io",
    url: "https://timeapi.io/api/Time/current/zone?timeZone=UTC",
    extract: (d) =>
      Date.UTC(                                   // build explicitly as UTC
        d.year, (d.month - 1), d.day,
        d.hour, d.minute, d.seconds, d.milliSeconds || 0
      ),
  },
];

async function fetchTrueUtcMs() {
  for (const src of TIME_SOURCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const t0 = Date.now();
      const res = await fetch(src.url, { signal: controller.signal });
      const t1 = Date.now();
      clearTimeout(timeoutId);

      if (!res.ok) {
        console.warn(`[TrueTime] ${src.name} responded ${res.status}`);
        continue;
      }
      const data = await res.json();
      const baseMs = src.extract(data);
      if (!baseMs || Number.isNaN(baseMs)) {
        console.warn(`[TrueTime] ${src.name} returned an unusable time value`);
        continue;
      }

      const networkDelayMs = Math.round((t1 - t0) / 2);
      const trueUtcMs = baseMs + networkDelayMs;

      console.log(`[TrueTime] Synced from ${src.name} (RTT ${t1 - t0}ms)`);
      return trueUtcMs;
    } catch (err) {
      console.warn(`[TrueTime] ${src.name} failed: ${err.message}`);
    }
  }
  throw new Error("All time sources failed");
}

/** Sync local-to-true offset. Call on startup + hourly. Never throws. */
export async function syncTrueTime() {
  try {
    const trueUtcMs = await fetchTrueUtcMs();
    const localUtcMs = Date.now();
    serverTimeOffsetMs = trueUtcMs - localUtcMs;
    lastSyncedAt = new Date();

    const driftSec = Math.round(serverTimeOffsetMs / 1000);
    if (Math.abs(driftSec) > 5) {
      console.warn(
        `[TrueTime] ⚠️  Clock drift detected: ${driftSec}s ` +
        `(local clock is ${driftSec > 0 ? "behind" : "ahead of"} true time). ` +
        `Offset applied to recorded timestamps + AWS signing.`
      );
    } else {
      console.log(`[TrueTime] ✓ In sync (offset ${serverTimeOffsetMs}ms).`);
    }

    // Notify listeners (e.g. update s3.config.systemClockOffset)
    for (const cb of syncListeners) {
      try { cb(serverTimeOffsetMs); } catch (e) { console.error("[TrueTime] listener error:", e); }
    }
  } catch (err) {
    console.error(
      `[TrueTime] Sync FAILED — recorded times will use the LOCAL clock ` +
      `(offset stays ${serverTimeOffsetMs}ms). Reason: ${err.message}`
    );
  }
}

/** Current offset in ms (true - local). */
export function getClockOffset() {
  return serverTimeOffsetMs;
}

/** Register a callback fired after every successful sync. Fires immediately too. */
export function onTimeSync(cb) {
  syncListeners.push(cb);
  if (lastSyncedAt) cb(serverTimeOffsetMs); // give current value right away
}

/** Current authoritative time as a dayjs object in IST. */
export function nowIST() {
  return dayjs(Date.now() + serverTimeOffsetMs).tz(IST);
}

/** Drop-in replacement for the old getNow() in attendanceController. */
export function getNow() {
  const now = nowIST();
  return {
    date: now.format("YYYY-MM-DD"),   // "2026-06-09"
    time: now.format("h:mm:ss A"),    // "10:50:31 AM"
  };
}

/** A Date at the true (offset-corrected) time — pass to getSignedUrl({ signingDate }). */
export function correctedDate() {
  return new Date(Date.now() + serverTimeOffsetMs);
}

/** Diagnostic — wire to a quick GET route to confirm sync is working. */
export function getTimeStatus() {
  return {
    isSynced: lastSyncedAt !== null,
    lastSyncedAt,
    serverTimeOffsetMs,
    epochMs: Date.now() + serverTimeOffsetMs,   // ← ADD THIS LINE
    trueTimeIST: nowIST().format("YYYY-MM-DD HH:mm:ss"),
    rawLocalClockIST: dayjs().tz(IST).format("YYYY-MM-DD HH:mm:ss"),
  };
}