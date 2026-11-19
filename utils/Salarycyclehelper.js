import LeavePolicy from "../model/LeavePolicy.js";

/**
 * Salary-cycle helpers.
 *
 * A salary cycle runs from `startDay` of one month to `startDay - 1` of the
 * next month. E.g. startDay = 21 → cycle is 21 Jun – 20 Jul.
 *
 * `offset` selects which cycle relative to the one containing `ref`:
 *   0  = current cycle (the one that contains `ref`)
 *  -1  = previous cycle
 *  +1  = next cycle
 */

/** Read the active salary cycle start day (default 1). */
export async function getSalaryCycleStartDay() {
  const policy = await LeavePolicy.findOne({ isActive: true }).lean();
  return policy?.salaryCycle?.startDay ?? 1;
}

/** Format a Date as "YYYY-MM-DD" (UTC-safe, date-only). */
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compute the salary-cycle window for a given startDay + offset.
 *
 * Returns { startDate, endDate, label, startDay, offset }
 *   startDate / endDate are inclusive "YYYY-MM-DD" strings.
 */
export function computeCycleWindow(startDay, offset = 0, ref = new Date()) {
  // Normalise ref to a date with no time component
  const refY = ref.getFullYear();
  const refM = ref.getMonth();   // 0-based
  const refD = ref.getDate();

  // Determine the start month of the cycle that contains `ref`.
  // If today's day-of-month >= startDay, the cycle started THIS month;
  // otherwise it started LAST month.
  let cycleStartMonthIndex; // months since year 0 for easy arithmetic
  const baseMonthIndex = refY * 12 + refM;

  if (refD >= startDay) {
    cycleStartMonthIndex = baseMonthIndex;
  } else {
    cycleStartMonthIndex = baseMonthIndex - 1;
  }

  // Apply offset (each offset step = one whole cycle = one month shift)
  cycleStartMonthIndex += offset;

  const startYear  = Math.floor(cycleStartMonthIndex / 12);
  const startMonth = cycleStartMonthIndex % 12;

  // Start date = startDay of the start month
  const startDate = new Date(startYear, startMonth, startDay);

  // End date = (startDay - 1) of the following month
  const endDate = new Date(startYear, startMonth + 1, startDay - 1);

  const startStr = toDateStr(startDate);
  const endStr   = toDateStr(endDate);

  // Human label e.g. "21 Jun – 20 Jul 2025"
  const fmt = (d) =>
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const yearLabel = endDate.getFullYear();
  const label = `${fmt(startDate)} – ${fmt(endDate)} ${yearLabel}`;

  return {
    startDate: startStr,
    endDate:   endStr,
    label,
    startDay,
    offset,
  };
}

/** Convenience: resolve the active cycle window directly from DB. */
export async function getCycleWindow(offset = 0, ref = new Date()) {
  const startDay = await getSalaryCycleStartDay();
  return computeCycleWindow(startDay, offset, ref);
}