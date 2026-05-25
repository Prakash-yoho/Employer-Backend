/**
 * leaveBalanceHelper.js
 *
 * ═══════════════════════════════════════════════════════════════
 * LEAVE CONCEPT — READ THIS BEFORE TOUCHING ANYTHING
 * ═══════════════════════════════════════════════════════════════
 *
 * CL ACCRUAL:
 *   • 1 CL per calendar month = 12 CL per year.
 *   • DOJ in January  → earns Jan–Dec = 12 CL.
 *   • DOJ in February → earns Feb–Dec = 11 CL. (month of DOJ counts as full 1 CL)
 *   • No proration within a month.
 *   • Year resets on Jan 1. Unused CL does NOT carry across years.
 *
 * CARRY FORWARD (within the year):
 *   • Unused CL from Jan carries to Feb, unused Feb+Jan carries to Mar, etc.
 *   • Available CL right now = months_earned_so_far − total_CL_used_so_far.
 *   • Example: DOJ=Jan, today=June, no leaves taken → available = 6.
 *
 * FIFO — ORDER OF APPLICATION (not leave date):
 *   • CL buckets are drained in application-date order (appliedAt ASC).
 *   • Employee applies Leave-A (June 10) first  → gets January's CL bucket.
 *   • Employee applies Leave-B (June  3) second → gets February's CL bucket.
 *   • Leave-B's date (June 3) < Leave-A's date (June 10) but that does NOT matter.
 *     What matters is which leave was APPLIED FIRST.
 *
 * ONCE SAVED = FIXED:
 *   • A saved leave's clDays/lopDays/clBucketUsed is the permanent record.
 *   • No recalculation or reordering of already-saved leaves.
 *   • New allocation only runs on fresh leave creation.
 *
 * NO FUTURE BORROWING:
 *   • A leave in month M can only use CL from buckets ≤ M.
 *   • Cannot use December CL for a January leave.
 *
 * SANDWICH RULE:
 *   • Non-working days (weekend/holiday) between two adjacent leaves
 *     IN THE SAME CALENDAR MONTH are counted as leave days.
 *   • Cross-month sandwich is NOT allowed.
 *
 * LOP:
 *   • If no CL bucket available → the day becomes Loss of Pay.
 *   • isSplit = true when a single leave has both CL days and LOP days.
 *
 * ═══════════════════════════════════════════════════════════════
 */

import dayjs from 'dayjs';
import utc          from 'dayjs/plugin/utc.js';
import isSameOrAfter  from 'dayjs/plugin/isSameOrAfter.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';

dayjs.extend(utc);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

import Leave      from '../model/Leave.js';
import Employee   from '../model/Employee.js';
import LeavePolicy from '../model/LeavePolicy.js';
import Permission  from '../model/Permission.js';
import Holiday     from '../model/Holiday.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Unique integer key for a calendar month. Jan 2025 → 24300. Comparable. */
const mKey = (year, month /* 0-indexed */) => year * 12 + month;

/** month key from a dayjs date */
const mKeyOf = (d) => mKey(dayjs.utc(d).year(), dayjs.utc(d).month());

// ─────────────────────────────────────────────────────────────────────────────
// 1. BUILD CL BUCKETS
//    12 buckets per year. Each bucket = 1 CL if employee was already joined.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildCLBuckets(doj, year)
 *
 * Returns 12 bucket objects, one per calendar month.
 * bucket.earned = 1 if the employee had joined by that month, else 0.
 * bucket.used   = 0 initially; mutated by replayLeavesOnBuckets.
 * bucket.remaining = earned - used.
 */
export const buildCLBuckets = (dojDate, year) => {
    const doj      = dayjs.utc(dojDate);
    const dojYear  = doj.year();
    const dojMonth = doj.month(); // 0-indexed

    return Array.from({ length: 12 }, (_, m) => {
        // earned = 1 only if employee joined on or before this month
        let earned = 0;
        if      (dojYear <  year)                      earned = 1;
        else if (dojYear === year && m >= dojMonth)    earned = 1;
        // dojYear > year → earned = 0 (joined in the future)

        const monthStart = dayjs.utc(`${year}-${String(m + 1).padStart(2, '0')}-01`);
        return {
            key:        mKey(year, m),
            year,
            month:      m,           // 0-indexed
            monthName:  monthStart.format('MMMM'),
            monthShort: monthStart.format('MMM'),
            label:      monthStart.format('MMMM YYYY'),  // "January 2025"
            earned,
            used:       0,
            remaining:  earned,
        };
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. BUILD DAY LIST FOR A LEAVE
//    Returns individual days with weights (1 = full day, 0.5 = half day).
// ─────────────────────────────────────────────────────────────────────────────

const buildDayList = (leave) => {
    const start = dayjs.utc(leave.startDate).startOf('day');
    const end   = dayjs.utc(leave.endDate).startOf('day');
    const days  = [];

    if (leave.leaveDuration === 'FIRST_HALF' || leave.leaveDuration === 'SECOND_HALF') {
        // Half-day: single entry with weight 0.5
        days.push({ date: start.format('YYYY-MM-DD'), weight: 0.5, isSandwich: false });
    } else {
        // Full day range
        let cur = start.clone();
        while (cur.isSameOrBefore(end)) {
            days.push({ date: cur.format('YYYY-MM-DD'), weight: 1, isSandwich: false });
            cur = cur.add(1, 'day');
        }
        // Append sandwich days (already stored on the leave record)
        for (const sd of (leave.sandwichDates ?? [])) {
            const sdStr = dayjs.utc(sd).format('YYYY-MM-DD');
            if (!days.find(d => d.date === sdStr)) {
                days.push({ date: sdStr, weight: 1, isSandwich: true });
            }
        }
        // Sort all days ascending
        days.sort((a, b) => a.date.localeCompare(b.date));
    }
    return days;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. FIFO REPLAY ENGINE
//
//    KEY RULE: sort by appliedAt (application date), NOT by leave start date.
//
//    Why: if employee applies Leave-A (June 10) first, it gets Jan CL.
//         Then applies Leave-B (June 3) — even though June 3 < June 10,
//         Leave-B is second in application order, so it gets Feb CL.
//         The saved allocation is FIXED — never recalculated.
//
//    The "no future borrowing" guard: for each day, only buckets with
//    key ≤ that day's month key are eligible. This prevents using
//    December's CL for a January leave.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * replayLeavesOnBuckets(buckets, leaves)
 *
 * Mutates each bucket's .used and .remaining.
 * Returns allocationRecords[] — one entry per leave day showing which bucket
 * was used (or whether it was LOP).
 *
 * IMPORTANT: leaves are sorted by appliedAt ASC (application order).
 */
export const replayLeavesOnBuckets = (buckets, leaves) => {
    // ★ SORT BY appliedAt — this is the core of the FIFO contract
    const ordered = [...leaves].sort((a, b) => {
        const tA = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
        const tB = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
        return tA - tB;
    });

    const allocationRecords = [];

    for (const leave of ordered) {
        const days = buildDayList(leave);

        for (const day of days) {
            const dayMKey = mKeyOf(day.date);

            // Find oldest available bucket that is ≤ this day's month
            // (cannot borrow from future months)
            const bucket = buckets
                .filter(b => b.earned > 0 && b.remaining > 0 && b.key <= dayMKey)
                .sort((a, b) => a.key - b.key)[0]; // oldest first

            if (bucket) {
                const consume    = Math.min(bucket.remaining, day.weight);
                bucket.used      = +(bucket.used      + consume).toFixed(2);
                bucket.remaining = +(bucket.remaining - consume).toFixed(2);

                allocationRecords.push({
                    leaveId:       leave._id?.toString(),
                    requestId:     leave.requestId,
                    appliedAt:     leave.appliedAt,
                    leaveDate:     day.date,
                    weight:        day.weight,
                    isSandwich:    day.isSandwich,
                    isLOP:         false,
                    clBucketKey:   bucket.key,
                    clBucketMonth: bucket.monthName,   // "January"
                    clBucketLabel: bucket.label,       // "January 2025"
                    consume,
                });

                // Partial draw — remaining weight becomes LOP
                const lopPart = +(day.weight - consume).toFixed(2);
                if (lopPart > 0) {
                    allocationRecords.push({
                        leaveId:       leave._id?.toString(),
                        requestId:     leave.requestId,
                        appliedAt:     leave.appliedAt,
                        leaveDate:     day.date,
                        weight:        lopPart,
                        isSandwich:    day.isSandwich,
                        isLOP:         true,
                        clBucketKey:   null,
                        clBucketMonth: null,
                        clBucketLabel: null,
                        consume:       lopPart,
                    });
                }
            } else {
                // No CL available → full LOP for this day
                allocationRecords.push({
                    leaveId:       leave._id?.toString(),
                    requestId:     leave.requestId,
                    appliedAt:     leave.appliedAt,
                    leaveDate:     day.date,
                    weight:        day.weight,
                    isSandwich:    day.isSandwich,
                    isLOP:         true,
                    clBucketKey:   null,
                    clBucketMonth: null,
                    clBucketLabel: null,
                    consume:       day.weight,
                });
            }
        }
    }

    return allocationRecords;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. ALLOCATE CL FOR A NEW LEAVE
//    Called at leave creation time. Runs FIFO over existing saved leaves
//    (in their applied order) to find what's still available, then allocates
//    for the new leave.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * allocateCLForLeave({ employeeId, doj, startDate, endDate, leaveDuration,
 *                      sandwichDays, sandwichDates, excludeLeaveId })
 *
 * Returns { clDays, lopDays, isSplit, isFullLOP, clBucketSummary }
 *
 * clBucketSummary: which buckets were consumed and how much.
 *   e.g. [{ bucket: "January 2025", days: 1 }, { bucket: "February 2025", days: 2 }]
 */
export const allocateCLForLeave = async ({
    employeeId,
    doj,
    startDate,
    endDate,
    leaveDuration,
    sandwichDays  = 0,
    sandwichDates = [],
    excludeLeaveId = null,
}) => {
    try {
        const startD = dayjs.utc(startDate).startOf('day');
        const endD   = dayjs.utc(endDate).startOf('day');
        const year   = startD.year();

        // Build fresh buckets for the year
        const buckets = buildCLBuckets(doj, year);

        // If leave spans into next year, add next year's buckets too
        const endYear     = endD.year();
        const nextBuckets = endYear > year ? buildCLBuckets(doj, endYear) : [];
        const allBuckets  = [...buckets, ...nextBuckets];

        // Fetch all existing CASUAL leaves this year (APPROVED + PENDING)
        // Exclude the leave being edited (if any)
        const filter = {
            employee:  employeeId,
            leaveType: { $in: ['CASUAL', 'LOP'] },
            status:    { $in: ['APPROVED', 'PENDING'] },
            startDate: {
                $gte: dayjs.utc(`${year}-01-01`).toDate(),
                $lte: dayjs.utc(`${endYear}-12-31`).endOf('day').toDate(),
            },
        };
        if (excludeLeaveId) filter._id = { $ne: excludeLeaveId };

        const existingLeaves = await Leave.find(filter).lean();

        // Replay existing leaves to drain buckets (in appliedAt order)
        replayLeavesOnBuckets(allBuckets, existingLeaves);

        // Now build the new leave's day list and run through remaining buckets
        const newLeaveObj = { startDate, endDate, leaveDuration, sandwichDates };
        const days        = buildDayList(newLeaveObj);

        let clDays  = 0;
        let lopDays = 0;
        const bucketConsumption = {}; // key → { label, days }

        for (const day of days) {
            const dayMKey = mKeyOf(day.date);

            const bucket = allBuckets
                .filter(b => b.earned > 0 && b.remaining > 0 && b.key <= dayMKey)
                .sort((a, b) => a.key - b.key)[0];

            if (bucket) {
                const consume    = Math.min(bucket.remaining, day.weight);
                bucket.used      = +(bucket.used      + consume).toFixed(2);
                bucket.remaining = +(bucket.remaining - consume).toFixed(2);
                clDays          += consume;

                // Track which buckets were used
                if (!bucketConsumption[bucket.key]) {
                    bucketConsumption[bucket.key] = { key: bucket.key, label: bucket.label, monthName: bucket.monthName, days: 0 };
                }
                bucketConsumption[bucket.key].days = +(bucketConsumption[bucket.key].days + consume).toFixed(2);

                const lopPart = +(day.weight - consume).toFixed(2);
                if (lopPart > 0) lopDays += lopPart;
            } else {
                lopDays += day.weight;
            }
        }

        clDays  = +clDays.toFixed(2);
        lopDays = +lopDays.toFixed(2);

        return {
            clDays,
            lopDays,
            isSplit:   clDays > 0 && lopDays > 0,
            isFullLOP: clDays === 0 && lopDays > 0,
            clBucketSummary: Object.values(bucketConsumption).sort((a, b) => a.key - b.key),
        };

    } catch (err) {
        console.error('allocateCLForLeave error:', err);
        // Safe fallback
        const totalDays = leaveDuration !== 'FULL_DAY' ? 0.5 :
            Math.max(1, dayjs.utc(endDate).startOf('day').diff(dayjs.utc(startDate).startOf('day'), 'day') + 1 + sandwichDays);
        return { clDays: 0, lopDays: totalDays, isSplit: false, isFullLOP: true, clBucketSummary: [] };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. SANDWICH DETECTION
//    Non-working days between two adjacent leaves IN THE SAME CALENDAR MONTH
//    are counted as leave days.
//    Cross-month sandwich is NOT allowed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateSandwichDays(employeeId, newStartDate, newEndDate, holidayDateStrings)
 *
 * Returns { totalSandwichDays, sandwichDates: ['YYYY-MM-DD', ...] }
 */
export const calculateSandwichDays = async (
    employeeId,
    newStartDate,
    newEndDate,
    holidayDateStrings = []
) => {
    const newStart   = dayjs.utc(newStartDate).startOf('day');
    const newEnd     = dayjs.utc(newEndDate).startOf('day');
    const holidaySet = new Set(holidayDateStrings);
    const isNonWorking = (d) => d.day() === 0 || d.day() === 6 || holidaySet.has(d.format('YYYY-MM-DD'));

    const existingLeaves = await Leave.find({
        employee: employeeId,
        status:   { $in: ['APPROVED', 'PENDING'] },
    }).lean();

    // checkGap: returns sandwich dates in the gap between dayA and dayB
    // Rules:
    //   1. Gap must be entirely non-working days
    //   2. dayA and dayB must be in the SAME calendar month
    const checkGap = (dayA, dayB) => {
        // Must be same calendar month
        if (dayA.month() !== dayB.month() || dayA.year() !== dayB.year()) return [];
        const diff = dayB.diff(dayA, 'day');
        if (diff <= 1) return []; // no gap to sandwich

        const gap = [];
        let cur = dayA.add(1, 'day');
        while (cur.isBefore(dayB)) { gap.push(cur.clone()); cur = cur.add(1, 'day'); }

        // All gap days must be non-working
        if (!gap.every(d => isNonWorking(d))) return [];
        return gap.map(d => d.format('YYYY-MM-DD'));
    };

    // Nearest existing leave BEFORE new leave
    const prevLeave = existingLeaves
        .filter(l => dayjs.utc(l.endDate).startOf('day').isBefore(newStart))
        .sort((a, b) => dayjs.utc(b.endDate).valueOf() - dayjs.utc(a.endDate).valueOf())[0];

    // Nearest existing leave AFTER new leave
    const nextLeave = existingLeaves
        .filter(l => dayjs.utc(l.startDate).startOf('day').isAfter(newEnd))
        .sort((a, b) => dayjs.utc(a.startDate).valueOf() - dayjs.utc(b.startDate).valueOf())[0];

    const sandwichDates = [];

    if (prevLeave) {
        const dates = checkGap(dayjs.utc(prevLeave.endDate).startOf('day'), newStart);
        dates.forEach(d => { if (!sandwichDates.includes(d)) sandwichDates.push(d); });
    }
    if (nextLeave) {
        const dates = checkGap(newEnd, dayjs.utc(nextLeave.startDate).startOf('day'));
        dates.forEach(d => { if (!sandwichDates.includes(d)) sandwichDates.push(d); });
    }

    return { totalSandwichDays: sandwichDates.length, sandwichDates };
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET AVAILABLE CL (quick check — for form display / validation)
//    available = earned_months_so_far − total_cl_used_so_far
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getAvailableCL(employeeId, doj, refDate)
 *
 * Returns { earned, used, available }
 * refDate: the date to check "as of" (defaults to today).
 */
export const getAvailableCL = async (employeeId, doj, refDate, salaryCycleStartDay = 21) => {
    const ref      = dayjs.utc(refDate ?? new Date());
    const year     = ref.year();
    const dojD     = dayjs.utc(doj);
    const dojYear  = dojD.year();
    const dojMonth = dojD.month(); // 0-indexed

    // Use cycle-end month, not raw calendar month.
    // e.g. today=May 24, startDay=21 → we are in May21-Jun20 cycle → cycleMonth = June (5)
    const refDay   = ref.date();
    const refMonth = refDay >= salaryCycleStartDay
        ? ref.add(1, 'month').month()   // cycle ends next calendar month
        : ref.month();                  // cycle ends this calendar month

    // How many months earned as of cycle month (inclusive)
    let earned = 0;
    if      (dojYear < year)  earned = refMonth + 1;
    else if (dojYear === year && dojMonth <= refMonth) earned = refMonth - dojMonth + 1;

    // Total CL used this year (approved + pending, counting clDays for split leaves)
    const usedAgg = await Leave.aggregate([
        {
            $match: {
                employee:  employeeId,
                leaveType: { $in: ['CASUAL'] },
                status:    { $in: ['APPROVED', 'PENDING'] },
                startDate: {
                    $gte: dayjs.utc(`${year}-01-01`).toDate(),
                    $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate(),
                },
            },
        },
        {
            $group: {
                _id:  null,
                used: {
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
    const used = +(usedAgg?.[0]?.used ?? 0).toFixed(2);

    return { earned, used, available: Math.max(0, earned - used) };
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. FULL LEAVE BALANCE (for the balance API endpoint)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateLeaveBalance(employeeId, isPermanentEmp, year, referenceDate)
 *
 * Returns the full balance object used by the frontend:
 *   casual.monthlyBreakdown[]  — per-month view, includes cumulativeBalance
 *   casual.earnedToDate        — how many months earned so far
 *   casual.usedToDate          — CL used so far
 *   casual.availableNow        — what can be taken right now (carry-forward included)
 *   casual.annualPool          — total CL for the year (e.g. 12)
 *   casual.annualRemaining     — how much CL is left for the rest of the year
 */
export const calculateLeaveBalance = async (
    employeeId,
    isPermanentEmp  = false,
    year            = dayjs.utc().year(),
    referenceDate   = null
) => {
    try {
        const policy              = await LeavePolicy.findOne({ isActive: true }).lean();
        const salaryCycleStartDay = policy?.salaryCycle?.startDay          ?? 21;
        const slDaysPerYear       = policy?.leaveTypes?.sick?.daysPerYear   ?? 10;
        const maternityDays       = policy?.leaveTypes?.maternity?.daysPerYear ?? 182;
        const paternityDays       = policy?.leaveTypes?.paternity?.daysPerYear ?? 15;
        const maxPermHoursPerMonth = policy?.permissionLeave?.hoursPerMonth ?? 2;

        const ref = referenceDate ? dayjs.utc(referenceDate) : dayjs.utc();

        const employee = await Employee.findById(employeeId).select('doj createdAt isPermanentEmp').lean();
        if (!employee) throw new Error('Employee not found');
        const doj = dayjs.utc(employee.doj ?? employee.createdAt);

        // ── Build buckets and replay existing leaves ─────────────────────────
        const buckets = buildCLBuckets(doj, year);

        const yearLeaves = await Leave.find({
            employee:  employeeId,
            leaveType: { $in: ['CASUAL', 'LOP'] },
            status:    { $in: ['APPROVED', 'PENDING'] },
            startDate: {
                $gte: dayjs.utc(`${year}-01-01`).toDate(),
                $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate(),
            },
        }).lean();

        replayLeavesOnBuckets(buckets, yearLeaves);

        // ── Determine "current cycle month" based on salary cycle start day ─
        //
        // Example: salaryCycleStartDay = 21
        //   Today = May 24  → we are inside the May 21–Jun 20 cycle
        //                    → the cycle's END month = June (index 5)
        //                    → so currentMonth = 5 (June), NOT 4 (May)
        //
        //   Today = May 10  → we are inside the Apr 21–May 20 cycle
        //                    → the cycle's END month = May (index 4)
        //                    → currentMonth = 4 (May)
        //
        // Rule: if today's date >= salaryCycleStartDay,
        //         cycle spans this month → next month, so END month = next month
        //       else
        //         cycle spans prev month → this month, so END month = this month
        const refDay = ref.date();
        const currentMonth = refDay >= salaryCycleStartDay
            ? ref.add(1, 'month').month()   // cycle end = next calendar month
            : ref.month();                  // cycle end = this calendar month
        const currentMonthKey = mKey(year, currentMonth);

        const annualPool    = buckets.reduce((s, b) => s + b.earned, 0);
        const earnedToDate  = buckets.filter(b => b.key <= currentMonthKey).reduce((s, b) => s + b.earned, 0);
        const usedToDate    = +buckets.filter(b => b.key <= currentMonthKey).reduce((s, b) => s + b.used, 0).toFixed(2);
        const availableNow  = Math.max(0, earnedToDate - usedToDate);
        const annualRemaining = Math.max(0, annualPool - buckets.reduce((s, b) => s + b.used, 0));

        // ── Monthly breakdown with cumulative carry-forward ──────────────────
        let cumEarned = 0, cumUsed = 0;
        const monthlyBreakdown = buckets.map(b => {
            if (b.earned > 0) cumEarned++;
            cumUsed += b.used;
            const cumBalance = Math.max(0, cumEarned - cumUsed);
            return {
                month:            b.monthName,
                monthShort:       b.monthShort,
                label:            b.label,
                key:              b.key,
                earned:           b.earned,       // 1 if this month earns CL, else 0
                usedFromBucket:   b.used,          // CL drawn FROM this specific bucket
                remainingInBucket: b.remaining,   // CL left in this specific bucket
                cumulativeEarned: cumEarned,       // total earned up to this month
                cumulativeUsed:   +cumUsed.toFixed(2),
                cumulativeBalance: +cumBalance.toFixed(2), // carry-forward balance
                isCurrent:        b.key === currentMonthKey,
                isFuture:         b.key >  currentMonthKey,
                isEarned:         b.earned > 0,
            };
        });

        // ── LOP days this year ───────────────────────────────────────────────
        const lopLeaves = await Leave.find({
            employee:  employeeId,
            leaveType: 'LOP',
            status:    { $in: ['APPROVED', 'PENDING'] },
            startDate: { $gte: dayjs.utc(`${year}-01-01`).toDate(), $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate() },
        }).lean();
        const splitLopDays = yearLeaves.filter(l => l.isSplit).reduce((s, l) => s + (l.lopDays || 0), 0);
        const lopDaysTotal  = +(lopLeaves.reduce((s, l) => s + l.totalDays, 0) + splitLopDays).toFixed(2);

        // ── Permission quota (uses salary cycle, not calendar month) ─────────
        // refDay is already declared above — reuse it here
        const cycleStart = refDay >= salaryCycleStartDay
            ? ref.date(salaryCycleStartDay).startOf('day')
            : ref.subtract(1, 'month').date(salaryCycleStartDay).startOf('day');
        const cycleEnd   = cycleStart.add(1, 'month').subtract(1, 'day').endOf('day');

        const permissionsThisCycle = await Permission.find({
            employee: employeeId,
            date:     { $gte: cycleStart.toDate(), $lte: cycleEnd.toDate() },
            status:   { $in: ['PENDING', 'APPROVED'] },
        }).lean();
        const permUsedHours      = +permissionsThisCycle.reduce((s, p) => s + (p.durationHours || 0), 0).toFixed(2);
        const permRemainingHours = +Math.max(0, maxPermHoursPerMonth - permUsedHours).toFixed(2);

        // ── Compose response ─────────────────────────────────────────────────
        const response = {
            year,
            doj:                 doj.format('YYYY-MM-DD'),
            isPermanentEmployee: employee.isPermanentEmp || false,
            casual: {
                annualPool,
                earnedToDate,
                usedToDate,
                availableNow,
                annualRemaining,
                policyNote: '1 CL per calendar month · unused carries forward within the year · no cross-year carry',
                monthlyBreakdown,
            },
            lop: {
                daysThisYear: lopDaysTotal,
            },
            permission: {
                hoursPerMonth:      maxPermHoursPerMonth,
                usedThisCycle:      permUsedHours,
                remainingThisCycle: permRemainingHours,
                maxPerRequest:      1,
                cycleLabel:         `${cycleStart.format('DD MMM')} – ${cycleEnd.format('DD MMM YYYY')}`,
            },
            currentMonth: {
                // Show the cycle's current month (end month of current salary cycle)
                // e.g. today=May 24, cycle=May21–Jun20 → shows "June 2026"
                month: dayjs.utc().month(currentMonth).format('MMMM'),
                year,
                label: dayjs.utc(`${year}-${String(currentMonth + 1).padStart(2, '0')}-01`).format('MMMM YYYY'),
            },
            salaryCycleStartDay,
        };

        // ── Permanent employee leave types ───────────────────────────────────
        if (isPermanentEmp) {
            const permLeaves = await Leave.find({
                employee:  employeeId,
                leaveType: { $in: ['SICK', 'MATERNITY', 'PATERNITY'] },
                status:    { $in: ['APPROVED', 'PENDING'] },
                startDate: { $gte: dayjs.utc(`${year}-01-01`).toDate(), $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate() },
            }).lean();

            const sickUsed      = permLeaves.filter(l => l.leaveType === 'SICK').reduce((s, l) => s + l.totalDays, 0);
            const maternityUsed = permLeaves.filter(l => l.leaveType === 'MATERNITY').reduce((s, l) => s + l.totalDays, 0);
            const paternityUsed = permLeaves.filter(l => l.leaveType === 'PATERNITY').reduce((s, l) => s + l.totalDays, 0);

            response.sick      = { total: slDaysPerYear,  used: sickUsed,      remaining: Math.max(0, slDaysPerYear  - sickUsed) };
            response.maternity = { total: maternityDays,  used: maternityUsed, remaining: Math.max(0, maternityDays  - maternityUsed) };
            response.paternity = { total: paternityDays,  used: paternityUsed, remaining: Math.max(0, paternityDays  - paternityUsed) };
        }

        return response;

    } catch (err) {
        console.error('calculateLeaveBalance error:', err);
        throw err;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. CL ALLOCATION DETAIL  (for the detail modal)
//    Shows per-bucket usage and per-day FIFO trail (in application order).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getCLAllocationDetail(employeeId, year)
 *
 * Returns:
 *   bucketSummary[]      — 12 monthly buckets: earned / used / remaining
 *   allocationRecords[]  — per-day trail in application order:
 *                          which bucket was used (or LOP) for each leave day
 */
export const getCLAllocationDetail = async (employeeId, year) => {
    const employee = await Employee.findById(employeeId).select('doj createdAt').lean();
    if (!employee) throw new Error('Employee not found');
    const doj = dayjs.utc(employee.doj ?? employee.createdAt);

    const yearLeaves = await Leave.find({
        employee:  employeeId,
        leaveType: { $in: ['CASUAL', 'LOP'] },
        status:    { $in: ['APPROVED', 'PENDING'] },
        startDate: {
            $gte: dayjs.utc(`${year}-01-01`).toDate(),
            $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate(),
        },
    }).lean();

    const buckets           = buildCLBuckets(doj, year);
    const allocationRecords = replayLeavesOnBuckets(buckets, yearLeaves);

    const bucketSummary = buckets.map(b => ({
        key:              b.key,
        month:            b.monthName,
        monthShort:       b.monthShort,
        label:            b.label,
        earned:           b.earned,
        usedFromBucket:   b.used,
        remainingInBucket: b.remaining,
    }));

    return { bucketSummary, allocationRecords };
};