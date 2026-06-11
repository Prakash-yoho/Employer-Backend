/**
 * Salary breakdown from a monthly CTC figure.
 * (Same formula as the provided calculateSalaryFromCTC.)
 */
export function calculateSalaryFromCTC(ctcMonthly) {
  const basic       = ctcMonthly / 2.5;
  const hra         = basic * 0.50;
  const conveyance  = basic * 0.25;
  const medical     = basic * 0.05;
  const lta         = basic * 0.05;
  const performance = basic * 0.10;

  const pfEmployee = basic * 0.12;
  const pfEmployer = basic * 0.12;
  const gratuity   = basic * 0.0481;

  const totalEarnings = ctcMonthly - pfEmployer - gratuity;
  const special       = basic * 0.2619;

  const r2 = (n) => Math.round(n * 100) / 100;

  return {
    basic:        r2(basic),
    hra:          r2(hra),
    conveyance:   r2(conveyance),
    medical:      r2(medical),
    lta:          r2(lta),
    performance:  r2(performance),
    special:      r2(special),
    totalEarnings:r2(totalEarnings),
    pfEmployee:   r2(pfEmployee),
    pfEmployer:   r2(pfEmployer),
    gratuity:     r2(gratuity),
    ctc:          r2(ctcMonthly),
  };
}

/**
 * Working-days + pay proration.
 *
 * Rules (per HR spec):
 *   STANDARD_DAYS = 30
 *   workedDays = STANDARD_DAYS − lopDays − violationDayCost
 *
 *   violationDayCost:
 *     NOT_MARKED      → 1.0 day each
 *     all other types → 0.5 day each
 *
 * Pay is prorated on worked days:
 *   perDay  = totalEarnings / STANDARD_DAYS
 *   gross   = perDay × workedDays
 *
 * @param {Object} args
 * @param {Object} args.breakdown   - from calculateSalaryFromCTC
 * @param {number} args.lopDays
 * @param {number} args.notMarkedDays
 * @param {number} args.otherViolationCount  - late + early + break + missedClockOut
 */
export function computeWorkedDaysAndPay({
  breakdown,
  lopDays = 0,
  notMarkedDays = 0,
  otherViolationCount = 0,
  extraViolationDayCost = 0,
  standardDays = 30,
  manualWorkedDays = null,
}) {
  // Day-cost weights per violation type:
  //   NOT_MARKED      → 2 full days each
  //   other violations→ 0.5 day each (late/early/break/missed-clockout)
  const NOT_MARKED_DAY_COST = 2;
  const violationDayCost = notMarkedDays * NOT_MARKED_DAY_COST + otherViolationCount * 0.5 + extraViolationDayCost;

  let workedDays;
  if (manualWorkedDays != null) {
    // Manual override — use entered value directly (clamped to 0..standardDays)
    workedDays = Math.max(0, Math.min(standardDays, manualWorkedDays));
  } else {
    workedDays = standardDays - lopDays - violationDayCost;
    if (workedDays < 0) workedDays = 0;
  }

  const perDay = breakdown.totalEarnings / standardDays;
  const r2 = (n) => Math.round(n * 100) / 100;

  // Proration factor applied to each earning component
  const factor = workedDays / standardDays;

  const proratedEarnings = {
    basic:       r2(breakdown.basic       * factor),
    hra:         r2(breakdown.hra         * factor),
    conveyance:  r2(breakdown.conveyance  * factor),
    medical:     r2(breakdown.medical     * factor),
    lta:         r2(breakdown.lta         * factor),
    performance: r2(breakdown.performance * factor),
    special:     r2(breakdown.special     * factor),
  };

  // Sum of the prorated earning components = the employee's take-home (NET).
  const componentsSum = r2(
    Object.values(proratedEarnings).reduce((s, v) => s + v, 0)
  );

  // Deductions prorate too (PF on prorated basic)
  const proratedBasic = proratedEarnings.basic;
  const deductions = {
    pfEmployee: r2(proratedBasic * 0.12),
    pfEmployer: r2(proratedBasic * 0.12),
    gratuity:   r2(proratedBasic * 0.0481),
  };
  const totalDeduction = r2(deductions.pfEmployee + deductions.pfEmployer + deductions.gratuity);

  // NET PAY = sum of prorated earning components (take-home).
  // TOTAL EARNINGS = NET PAY + TOTAL DEDUCTIONS (gross, sample-payslip identity:
  // e.g. 40000.00 = 35390.40 + 4609.60 on a full month).
  const netSalary = componentsSum;
  const proratedTotalEarnings = r2(netSalary + totalDeduction);

  return {
    standardDays,
    lopDays,
    notMarkedDays,
    otherViolationCount,
    violationDayCost,
    workedDays: r2(workedDays),
    perDay: r2(perDay),
    proratedEarnings,
    proratedTotalEarnings,
    deductions,
    totalDeduction,
    netSalary,
  };
}