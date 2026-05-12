// utils/leaveBalanceHelper.js
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';

dayjs.extend(utc);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

import Leave from '../model/Leave.js';
import Employee from '../model/Employee.js';
import LeavePolicy from '../model/LeavePolicy.js';
import Permission from '../model/Permission.js';

// ─────────────────────────────────────────────────────────────────────────────
// CORE CYCLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get which cycle period a date belongs to.
 *
 * With startDay = 21:
 *   Jan 21 – Feb 20  → cycleMonth = 1  (February),  cycleYear = YYYY
 *   Feb 21 – Mar 20  → cycleMonth = 2  (March),     cycleYear = YYYY
 *   ...
 *   Dec 21 – Jan 20  → cycleMonth = 0  (January),   cycleYear = YYYY+1
 *
 * The "cycleMonth" is the calendar month that contains the cycle's END date.
 * This is what we use as the unique cycle identifier throughout the system.
 */
export const getCycleForDate = (date, startDay = 21) => {
    const d = dayjs.utc(date);
    const dayOfMonth = d.date();

    let cycleEndMonth, cycleEndYear;
    let cycleStartDate, cycleEndDate;

    if (startDay === 1) {
        // Calendar-month cycle: simple case
        cycleEndMonth   = d.month();
        cycleEndYear    = d.year();
        cycleStartDate  = d.startOf('month');
        cycleEndDate    = d.endOf('month');
    } else if (dayOfMonth >= startDay) {
        // Date is on/after startDay (e.g. >= 21) → belongs to NEXT month's named cycle
        // e.g. Jan 21–Feb 20 is called the "February" cycle
        const nextMonth = d.add(1, 'month');
        cycleEndMonth   = nextMonth.month();       // 0-indexed
        cycleEndYear    = nextMonth.year();
        cycleStartDate  = d.date(startDay);
        cycleEndDate    = nextMonth.date(startDay - 1);
    } else {
        // Date is before startDay (e.g. 1–20) → belongs to THIS month's named cycle
        // e.g. Feb 1–20 is still part of the "February" cycle (Feb 20 = end)
        cycleEndMonth   = d.month();               // 0-indexed
        cycleEndYear    = d.year();
        cycleStartDate  = d.subtract(1, 'month').date(startDay);
        cycleEndDate    = d.date(startDay - 1);
    }

    return {
        cycleMonth: cycleEndMonth,   // 0-indexed (0 = Jan … 11 = Dec)
        cycleYear:  cycleEndYear,
        cycleLabel: `${cycleStartDate.format('DD MMM')} – ${cycleEndDate.format('DD MMM YYYY')}`,
        start:      cycleStartDate,
        end:        cycleEndDate,
    };
};

/**
 * Unique integer key for a cycle — used for ordering / comparison.
 * e.g. Jan-2026 cycle → 2026 * 12 + 0 = 24312
 */
export const getCycleNumber = (cycleYear, cycleMonth) =>
    cycleYear * 12 + cycleMonth;

// ─────────────────────────────────────────────────────────────────────────────
// CL ACCRUAL — CARRY-FORWARD MODEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many CLs has the employee EARNED in total up to (and including) the
 * given target cycle?
 *
 * Rule: 1 CL per cycle from (and including) the cycle that contains the DOJ.
 * Unused CLs accumulate automatically — no hard reset within a calendar year.
 *
 * Example — DOJ = 02 Feb 2026, startDay = 21:
 *   DOJ cycle = Feb 2026 (Jan 21 – Feb 20 contains Feb 2? NO — Feb 2 < 21,
 *   so it falls in the Feb cycle: Jan 21–Feb 20 → cycleMonth=1=Feb ✓)
 *
 *   Cycle Feb-2026 (Jan21–Feb20): +1  → total 1
 *   Cycle Mar-2026 (Feb21–Mar20): +1  → total 2
 *   Cycle Apr-2026 (Mar21–Apr20): +1  → total 3
 *   ...
 */
export const calculateTotalCLEarned = (dojDate, targetCycleYear, targetCycleMonth, startDay = 21) => {
    const doj      = dayjs.utc(dojDate);
    const dojCycle = getCycleForDate(doj, startDay);

    const dojKey    = getCycleNumber(dojCycle.cycleYear, dojCycle.cycleMonth);
    const targetKey = getCycleNumber(targetCycleYear,    targetCycleMonth);

    if (targetKey < dojKey) return 0;

    // Number of cycles from DOJ cycle → target cycle (inclusive on both ends)
    return targetKey - dojKey + 1;
};

// ─────────────────────────────────────────────────────────────────────────────
// USED CL — counting what has already been consumed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns total CL days consumed from all APPROVED/PENDING casual leaves
 * whose cycle is BEFORE the given target cycle.
 *
 * "Before" = strictly less than targetCycleKey.
 * Used to compute the balance that *carries forward* into the target cycle.
 *
 * @param {object[]} existingLeaves  - array of Leave documents (lean)
 * @param {number}   targetCycleKey  - getCycleNumber(year, month)
 * @param {number}   startDay
 */
const clUsedBeforeCycle = (existingLeaves, targetCycleKey, startDay) => {
    let used = 0;
    for (const leave of existingLeaves) {
        if (leave.leaveType !== 'CASUAL') continue;

        // Each leave is "owned" by the cycle of its START date.
        // (A split leave is stored as one record; clDays already reflects
        //  the portion that counted as CL.)
        const leaveCycle = getCycleForDate(dayjs.utc(leave.startDate), startDay);
        const leaveCycleKey = getCycleNumber(leaveCycle.cycleYear, leaveCycle.cycleMonth);

        if (leaveCycleKey < targetCycleKey) {
            used += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
        }
    }
    return used;
};

/**
 * Returns total CL days consumed in a SPECIFIC cycle (matching cycle key exactly).
 */
const clUsedInCycle = (existingLeaves, targetCycleKey, startDay) => {
    let used = 0;
    for (const leave of existingLeaves) {
        if (leave.leaveType !== 'CASUAL') continue;

        const leaveCycle    = getCycleForDate(dayjs.utc(leave.startDate), startDay);
        const leaveCycleKey = getCycleNumber(leaveCycle.cycleYear, leaveCycle.cycleMonth);

        if (leaveCycleKey === targetCycleKey) {
            used += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
        }
    }
    return used;
};

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE SPLITTING FOR CROSS-CYCLE LEAVES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a date range into groups, one per salary cycle.
 *
 * Example: Leave Mar 19–22, startDay=21
 *   Mar 19–20 → March cycle  (Feb 21–Mar 20)
 *   Mar 21–22 → April cycle  (Mar 21–Apr 20)
 */
export const splitLeaveByCycles = (startDate, endDate, startDay = 21) => {
    const start  = dayjs.utc(startDate).startOf('day');
    const end    = dayjs.utc(endDate).startOf('day');
    const cycles = [];

    let current = start.clone();
    while (current.isSameOrBefore(end)) {
        const cycle = getCycleForDate(current, startDay);
        const key   = getCycleNumber(cycle.cycleYear, cycle.cycleMonth);

        let bucket = cycles.find(c => c.cycleKey === key);
        if (!bucket) {
            bucket = {
                cycleKey:   key,
                cycleYear:  cycle.cycleYear,
                cycleMonth: cycle.cycleMonth,
                cycleLabel: cycle.cycleLabel,
                dates:      [],
                dayCount:   0,
            };
            cycles.push(bucket);
        }
        bucket.dates.push(current.clone());
        bucket.dayCount++;
        current = current.add(1, 'day');
    }

    return cycles;
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ALLOCATION — allocateCLForLeave
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine how many days of a leave request are covered by CL vs LOP.
 *
 * CARRY-FORWARD RULES (the key logic):
 * ─────────────────────────────────────
 * 1. Employee earns 1 CL per completed cycle month from DOJ (inclusive).
 * 2. CLs that are NOT used in a cycle roll forward automatically.
 * 3. Balance available for cycle N  =  totalEarned(up to N)  –  totalUsed(before N)
 *    i.e. we look at ALL previously used CLs to determine the carry-forward balance.
 *
 * FORWARD-DATED LEAVES (applying in Feb for March leave):
 * ────────────────────────────────────────────────────────
 * We credit the CL that will be earned by the time the leave cycle arrives.
 * e.g. Apply on 10 Feb for a Mar 5 leave:
 *   - Mar 5 belongs to the "March" cycle (Feb 21–Mar 20)
 *   - By March cycle, the employee will have earned CL through March
 *   - So we use calculateTotalCLEarned(..., marchCycle) to check availability
 *   This correctly allows booking a future CL that will exist when the leave starts.
 *
 * CROSS-CYCLE LEAVES (e.g. Mar 19–22):
 * ──────────────────────────────────────
 * Split into cycles, allocate CL per cycle, fall back to LOP within each cycle.
 *
 * @param {ObjectId} employeeId
 * @param {Date|string} doj          - employee date of joining
 * @param {Date|string} startDate    - leave start
 * @param {Date|string} endDate      - leave end
 * @param {number}      requestedDays
 * @param {number}      startDay     - salary cycle start day (default 21)
 * @param {number}      year         - calendar year of the leave
 * @returns {{ clDays, lopDays, isSplit, splitNote, cycleAllocations }}
 */
export const allocateCLForLeave = async (
    employeeId, doj, startDate, endDate, requestedDays, startDay, year
) => {
    try {
        const dojDate = dayjs.utc(doj);

        // ── Step 1: Split leave into per-cycle buckets ────────────────────
        const cycles = splitLeaveByCycles(startDate, endDate, startDay);

        // ── Step 2: Load ALL existing CASUAL leaves for this employee
        //    (whole year + surrounding cycles to capture carry-forward).
        //    We fetch the full year plus one month on each side to be safe.
        const fetchStart = dayjs.utc(`${year - 1}-12-01`).startOf('day').toDate();
        const fetchEnd   = dayjs.utc(`${year + 1}-01-31`).endOf('day').toDate();

        const existingLeaves = await Leave.find({
            employee:  employeeId,
            leaveType: 'CASUAL',
            status:    { $in: ['APPROVED', 'PENDING'] },
            startDate: { $gte: fetchStart, $lte: fetchEnd },
        }).lean();

        // ── Step 3: Allocate CL per cycle ────────────────────────────────
        let totalCL   = 0;
        let totalLOP  = 0;
        const cycleAllocations = [];

        for (const cycle of cycles) {
            // Total CL earned up to and including this cycle
            const totalEarned = calculateTotalCLEarned(
                dojDate, cycle.cycleYear, cycle.cycleMonth, startDay
            );

            // CL already consumed in cycles BEFORE this one (the carry-forward ledger)
            const usedBefore = clUsedBeforeCycle(existingLeaves, cycle.cycleKey, startDay);

            // CL already consumed IN this same cycle (other leaves, not the current request)
            const usedInCycle = clUsedInCycle(existingLeaves, cycle.cycleKey, startDay);

            // Available = everything earned minus everything spent so far
            const available = Math.max(0, totalEarned - usedBefore - usedInCycle);

            // How much of this cycle's days can be covered by CL?
            const clForCycle  = Math.min(cycle.dayCount, available);
            const lopForCycle = cycle.dayCount - clForCycle;

            totalCL  += clForCycle;
            totalLOP += lopForCycle;

            cycleAllocations.push({
                cycleLabel:      cycle.cycleLabel,
                daysInCycle:     cycle.dayCount,
                totalEarned,
                usedBefore,
                usedInCycle,
                availableInCycle: available,
                clAllocated:     clForCycle,
                lopAllocated:    lopForCycle,
            });
        }

        // ── Step 4: Build response ─────────────────────────────────────────
        const isSplit = totalCL > 0 && totalLOP > 0;
        const splitNote = isSplit
            ? cycleAllocations
                .filter(c => c.clAllocated > 0 || c.lopAllocated > 0)
                .map(c => `${c.cycleLabel}: ${c.clAllocated} CL + ${c.lopAllocated} LOP`)
                .join('; ')
            : null;

        return {
            clDays:  parseFloat(totalCL.toFixed(2)),
            lopDays: parseFloat(totalLOP.toFixed(2)),
            isSplit,
            splitNote,
            cycleAllocations,
        };

    } catch (error) {
        console.error('Error in allocateCLForLeave:', error);
        return {
            clDays:           0,
            lopDays:          requestedDays,
            isSplit:          false,
            splitNote:        null,
            cycleAllocations: [],
        };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// getAvailableCL — snapshot for validation / display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current CL balance as of a reference date.
 * Used by the balance API and pre-submission validation.
 *
 * @param {ObjectId}    employeeId
 * @param {Date|string} doj
 * @param {Date|string} refDate    - "as of" date (usually today)
 * @param {number}      startDay
 * @param {number}      year
 */
export const getAvailableCL = async (employeeId, doj, refDate, startDay, year) => {
    const dojDate     = dayjs.utc(doj);
    const ref         = dayjs.utc(refDate);
    const targetCycle = getCycleForDate(ref, startDay);

    // Total earned up to (and including) the current cycle
    const totalEarned = calculateTotalCLEarned(
        dojDate, targetCycle.cycleYear, targetCycle.cycleMonth, startDay
    );

    // Total consumed across ALL cycles up to now
    const fetchStart = dayjs.utc(`${year - 1}-12-01`).startOf('day').toDate();
    const fetchEnd   = dayjs.utc(`${year + 1}-01-31`).endOf('day').toDate();

    const usedResult = await Leave.aggregate([
        {
            $match: {
                employee:  employeeId,
                leaveType: 'CASUAL',
                status:    { $in: ['APPROVED', 'PENDING'] },
                startDate: { $gte: fetchStart, $lte: fetchEnd },
            },
        },
        {
            $group: {
                _id:       null,
                totalUsed: {
                    $sum: {
                        $cond: [
                            { $eq: ['$isSplit', true] },
                            { $ifNull: ['$clDays', 0] },
                            '$totalDays',
                        ],
                    },
                },
            },
        },
    ]);

    const totalUsed = usedResult?.[0]?.totalUsed || 0;

    return {
        earned:    totalEarned,
        used:      parseFloat(totalUsed.toFixed(2)),
        remaining: Math.max(0, totalEarned - totalUsed),
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// calculateLeaveBalance — full balance summary with monthly breakdown
// ─────────────────────────────────────────────────────────────────────────────

export const calculateLeaveBalance = async (
    employeeId,
    isPermanentEmp = false,
    year           = dayjs.utc().year(),
    referenceDate  = null
) => {
    try {
        const policy              = await LeavePolicy.findOne({ isActive: true }).lean();
        const startDay            = policy?.salaryCycle?.startDay            ?? 21;
        const slDaysPerYear       = policy?.leaveTypes?.sick?.daysPerYear    ?? 10;
        const maternityDays       = policy?.leaveTypes?.maternity?.daysPerYear ?? 182;
        const paternityDays       = policy?.leaveTypes?.paternity?.daysPerYear ?? 15;
        const maxPermHoursPerMonth = policy?.permissionLeave?.hoursPerMonth   ?? 2;

        const ref      = referenceDate ? dayjs.utc(referenceDate) : dayjs.utc();
        const employee = await Employee.findById(employeeId)
            .select('doj createdAt isPermanentEmp')
            .lean();
        if (!employee) throw new Error('Employee not found');

        const doj = employee.doj
            ? dayjs.utc(employee.doj)
            : dayjs.utc(employee.createdAt);

        // Fetch all leaves for this year (plus one month buffer on each side)
        const fetchStart   = dayjs.utc(`${year - 1}-12-01`).startOf('day').toDate();
        const fetchEnd     = dayjs.utc(`${year + 1}-01-31`).endOf('day').toDate();

        const approvedLeaves = await Leave.find({
            employee: employeeId,
            status:   { $in: ['APPROVED', 'PENDING'] },
            startDate: { $gte: fetchStart, $lte: fetchEnd },
        }).lean();

        // ── Monthly breakdown (cycle by cycle) ───────────────────────────
        const monthlyBreakdown = [];
        const currentCycleMeta = getCycleForDate(ref, startDay);
        const currentCycleKey  = getCycleNumber(currentCycleMeta.cycleYear, currentCycleMeta.cycleMonth);

        for (let m = 0; m <= 11; m++) {
            // Use the 15th of each calendar month as a stable probe date
            const probeDate = dayjs.utc(`${year}-${String(m + 1).padStart(2, '0')}-15`);
            const cycle     = getCycleForDate(probeDate, startDay);
            const cycleKey  = getCycleNumber(cycle.cycleYear, cycle.cycleMonth);

            const totalEarned = calculateTotalCLEarned(doj, cycle.cycleYear, cycle.cycleMonth, startDay);

            // CL used up to and including this cycle
            let usedUpToCycle = 0;
            for (const leave of approvedLeaves) {
                if (leave.leaveType !== 'CASUAL') continue;
                const lc    = getCycleForDate(dayjs.utc(leave.startDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey <= cycleKey) {
                    usedUpToCycle += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
                }
            }

            const isFuture = cycleKey > currentCycleKey;

            monthlyBreakdown.push({
                month:      probeDate.format('MMMM'),
                cycleLabel: cycle.cycleLabel,
                earned:     totalEarned,
                used:       parseFloat(usedUpToCycle.toFixed(2)),
                remaining:  Math.max(0, totalEarned - usedUpToCycle),
                isFuture,
            });
        }

        // ── Current totals ────────────────────────────────────────────────
        const totalEarnedNow = calculateTotalCLEarned(
            doj, currentCycleMeta.cycleYear, currentCycleMeta.cycleMonth, startDay
        );

        let clUsedTotal = 0;
        for (const leave of approvedLeaves) {
            if (leave.leaveType !== 'CASUAL') continue;
            clUsedTotal += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
        }

        const clRemaining = Math.max(0, totalEarnedNow - clUsedTotal);

        // ── Permission balance for current cycle ──────────────────────────
        const permissionsThisCycle = await Permission.find({
            employee: employeeId,
            date:     {
                $gte: currentCycleMeta.start.toDate(),
                $lte: currentCycleMeta.end.toDate(),
            },
            status: { $in: ['PENDING', 'APPROVED'] },
        }).lean();

        const permUsedHours      = permissionsThisCycle.reduce((s, p) => s + (p.durationHours || 0), 0);
        const permRemainingHours = Math.max(0, maxPermHoursPerMonth - permUsedHours);

        // ── Build response ────────────────────────────────────────────────
        const response = {
            year,
            doj:                  doj.format('YYYY-MM-DD'),
            salaryCycleStartDay:  startDay,
            isPermanentEmployee:  employee.isPermanentEmp || false,
            casual: {
                earnedThisYear:    totalEarnedNow,
                usedThisYear:      parseFloat(clUsedTotal.toFixed(2)),
                remainingThisYear: clRemaining,
                policyNote:
                    '1 CL per salary-cycle month from DOJ; unused days carry forward automatically',
                monthlyBreakdown:  monthlyBreakdown.filter(m => !m.isFuture),
            },
            permission: {
                hoursPerMonth:    maxPermHoursPerMonth,
                usedThisCycle:    parseFloat(permUsedHours.toFixed(2)),
                remainingThisCycle: parseFloat(permRemainingHours.toFixed(2)),
                maxPerRequest:    1,
                policyNote:       `${maxPermHoursPerMonth} hrs/month; max 1 hr per request`,
            },
            currentCycle: {
                start: currentCycleMeta.start.format('YYYY-MM-DD'),
                end:   currentCycleMeta.end.format('YYYY-MM-DD'),
                label: currentCycleMeta.cycleLabel,
            },
        };

        // Permanent-employee extras
        if (isPermanentEmp) {
            const sickUsed      = approvedLeaves.filter(l => l.leaveType === 'SICK').reduce((s, l) => s + l.totalDays, 0);
            const maternityUsed = approvedLeaves.filter(l => l.leaveType === 'MATERNITY').reduce((s, l) => s + l.totalDays, 0);
            const paternityUsed = approvedLeaves.filter(l => l.leaveType === 'PATERNITY').reduce((s, l) => s + l.totalDays, 0);

            response.sick = {
                total:     slDaysPerYear,
                used:      sickUsed,
                remaining: Math.max(0, slDaysPerYear - sickUsed),
            };
            response.maternity = {
                total:     maternityDays,
                used:      maternityUsed,
                remaining: Math.max(0, maternityDays - maternityUsed),
            };
            response.paternity = {
                total:     paternityDays,
                used:      paternityUsed,
                remaining: Math.max(0, paternityDays - paternityUsed),
            };
        }

        return response;

    } catch (error) {
        console.error('Error in calculateLeaveBalance:', error);
        throw error;
    }
};