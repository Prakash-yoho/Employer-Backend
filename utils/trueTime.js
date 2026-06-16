// ─── True-Time Utility (monotonic-anchored) ──────────────────────────────────
//
// KEY IDEA: We anchor the true server time to a MONOTONIC clock
// (performance.now()), NOT to Date.now(). The monotonic clock only ever moves
// forward at a steady rate and is COMPLETELY UNAFFECTED by system clock changes.
//
//   At sync:   trueTimeAtSync   = <true UTC ms from time API>
//              monotonicAtSync  = performance.now()
//   Any time:  correctedNowMs() = trueTimeAtSync + (performance.now() - monotonicAtSync)
//
// Because performance.now() ignores system clock changes, correctedNowMs() stays
// correct even if the OS clock is moved by days mid-session — with NO restart and
// NO dependency on Date.now(). This is the single source of truth for the whole app.
//
// Exports (all backward compatible):
//   syncTrueTime()    — call at startup + periodically
//   getNow()          — { date:"YYYY-MM-DD", time:"h:mm:ss A" } in IST
//   nowIST()          — dayjs object in IST
//   correctedDate()   — Date object at true time (for S3 signingDate)
//   correctedNowMs()  — true epoch ms
//   getClockOffset()  — (trueTime - systemTime) computed FRESH each call (for S3 systemClockOffset)
//   onTimeSync(cb)    — fire cb after each sync
//   getTimeStatus()   — diagnostics + epochMs for frontend

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { performance } from "perf_hooks";

dayjs.extend(utc);
dayjs.extend(timezone);

const IST = "Asia/Kolkata";

// ── Monotonic anchor state ────────────────────────────────────────────────────
let _trueTimeAtSync  = Date.now();        // true epoch ms captured at last sync
let _monotonicAtSync = performance.now(); // monotonic reading at last sync
let _synced          = false;
let _lastSyncedAt    = null;

const syncListeners = [];

// ── Time sources — extract returns true UTC ms (number), unambiguous ──────────
const TIME_SOURCES = [
  {
    name: "worldtimeapi.org",
    url:  "https://worldtimeapi.org/api/timezone/Etc/UTC",
    extract: (d) =>
      typeof d.unixtime === "number" ? d.unixtime * 1000 : Date.parse(d.utc_datetime),
  },
  {
    name: "timeapi.io",
    url:  "https://timeapi.io/api/Time/current/zone?timeZone=UTC",
    extract: (d) =>
      Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.seconds, d.milliSeconds || 0),
  },
];

async function fetchTrueUtcMs() {
  for (const src of TIME_SOURCES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Use monotonic clock for RTT so a wrong system clock can't skew it
      const m0 = performance.now();
      const res = await fetch(src.url, { signal: controller.signal });
      const m1 = performance.now();
      clearTimeout(timeoutId);

      if (!res.ok) { console.warn(`[TrueTime] ${src.name} responded ${res.status}`); continue; }

      const data = await res.json();
      const baseMs = src.extract(data);
      if (!baseMs || Number.isNaN(baseMs)) {
        console.warn(`[TrueTime] ${src.name} returned unusable time`); continue;
      }

      const networkDelayMs = Math.round((m1 - m0) / 2);
      const trueUtcMs = baseMs + networkDelayMs;
      console.log(`[TrueTime] Synced from ${src.name} (RTT ${Math.round(m1 - m0)}ms)`);
      return { trueUtcMs, monotonic: m1 };
    } catch (err) {
      console.warn(`[TrueTime] ${src.name} failed: ${err.message}`);
    }
  }
  throw new Error("All time sources failed");
}

/** Sync true-time anchor. Call on startup + periodically. Never throws. */
export async function syncTrueTime() {
  try {
    const { trueUtcMs, monotonic } = await fetchTrueUtcMs();

    _trueTimeAtSync  = trueUtcMs;
    _monotonicAtSync = monotonic;
    _synced          = true;
    _lastSyncedAt    = new Date(trueUtcMs);

    // Difference vs the (possibly wrong) system clock — purely informational
    const skewSec = Math.round((correctedNowMs() - Date.now()) / 1000);
    if (Math.abs(skewSec) > 5) {
      console.warn(`[TrueTime] ⚠ System clock off by ${skewSec}s — using true time (clock changes now have NO effect)`);
    } else {
      console.log(`[TrueTime] ✓ In sync (system skew ${skewSec}s).`);
    }

    for (const cb of syncListeners) {
      try { cb(getClockOffset()); } catch (e) { console.error("[TrueTime] listener error:", e); }
    }
  } catch (err) {
    console.error(`[TrueTime] Sync FAILED — falling back to system clock. Reason: ${err.message}`);
  }
}

// ── Core: true epoch ms, anchored to the monotonic clock ──────────────────────
export function correctedNowMs() {
  if (!_synced) return Date.now();  // not yet synced — best effort
  return _trueTimeAtSync + (performance.now() - _monotonicAtSync);
}

/**
 * (trueTime - systemTime) computed FRESH on every call.
 * Pass to AWS S3Client { systemClockOffset } so presigned URLs sign with true time.
 * Because correctedNowMs() ignores the system clock, this offset is always
 * whatever is needed to cancel out the current (possibly wrong) system clock.
 */
export function getClockOffset() {
  return correctedNowMs() - Date.now();
}

/** Register a callback fired after every successful sync (and immediately if already synced). */
export function onTimeSync(cb) {
  syncListeners.push(cb);
  if (_synced) cb(getClockOffset());
}

/** Authoritative current time as a dayjs object in IST. */
export function nowIST() {
  return dayjs(correctedNowMs()).tz(IST);
}

/** Drop-in for attendance timestamps. */
export function getNow() {
  const now = nowIST();
  return {
    date: now.format("YYYY-MM-DD"),  // "2026-06-15"
    time: now.format("h:mm:ss A"),   // "4:07:12 PM"
  };
}

/** Date at true time — pass to getSignedUrl({ signingDate }). */
export function correctedDate() {
  return new Date(correctedNowMs());
}

/** Diagnostics + epochMs for the frontend /time-status endpoint. */
export function getTimeStatus() {
  return {
    isSynced:         _synced,
    lastSyncedAt:     _lastSyncedAt,
    epochMs:          correctedNowMs(),
    clockOffsetMs:    getClockOffset(),
    trueTimeIST:      nowIST().format("YYYY-MM-DD HH:mm:ss"),
    rawSystemClockIST: dayjs().tz(IST).format("YYYY-MM-DD HH:mm:ss"),
  };
}