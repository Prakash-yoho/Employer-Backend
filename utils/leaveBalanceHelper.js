/**
 * leaveBalanceHelper.js  —  FIXED
 *
 * ═══════════════════════════════════════════════════════════════
 * ROOT CAUSE OF THE BUG (May 27 → LOP when CL was available)
 * ═══════════════════════════════════════════════════════════════
 *
 * The "no future borrowing" guard used RAW calendar month as the
 * upper bound for which CL buckets a leave day is eligible to use:
 *
 *   OLD (broken):
 *     const mKeyOf = (d) => dayjs.utc(d).year() * 12 + dayjs.utc(d).month()
 *     // May 27 → month=4 (May)  → eligible: buckets with key ≤ May
 *     // Jun 16 → month=5 (June) → eligible: buckets with key ≤ June (May + June)
 *
 * With DOJ=May 1 (buckets: May, June), the leave applied FIRST (June 16)
 * consumed the MAY bucket (oldest first). Then May 27 (applied second)
 * found no bucket ≤ May → LOP. Mathematically correct FIFO, but wrong
 * in intent: a leave on May 27 should never get LOP when the June bucket
 * is available, especially if May 27 falls inside the June salary cycle.
 *
 * THE FIX:
 *   mKeyOf uses the SALARY-CYCLE-AWARE month — the cycle END month that
 *   the leave date belongs to.
 *
 *   Rule (same as used in calculateLeaveBalance and getCLAllocationDetail):
 *     if leaveDate.day >= salaryCycleStartDay:
 *         cycle end = next calendar month
 *     else:
 *         cycle end = this calendar month
 *
 *   With salaryCycleStartDay=1:
 *     May 27 (day=27 >= 1) → cycle end = June → key=June(24317) ✓
 *     Jun 16 (day=16 >= 1) → cycle end = July → key=July(24318)
 *     → May 27 now eligible for June bucket → CL ✓
 *
 *   With salaryCycleStartDay=21:
 *     May 27 (day=27 >= 21) → cycle end = June → key=June(24317)
 *     Jun 16 (day=16 <  21) → cycle end = June → key=June(24317)
 *     → both leave dates in same cycle → both eligible for same buckets → CL ✓
 *
 * This function is used in THREE places:
 *   1. replayLeavesOnBuckets  — FIFO replay
 *   2. allocateCLForLeave     — allocation at creation time
 *   3. getCLAllocationDetail  — detail view
 *
 * The salaryCycleStartDay is loaded from LeavePolicy once and threaded
 * through as a parameter so we don't make an extra DB call per day.
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

/**
 * cycleAwareMKeyOf(dateStr, salaryCycleStartDay)
 *
 * Returns the month key of the SALARY CYCLE END MONTH that contains the given date.
 *
 * Rule:
 *   if date.day >= salaryCycleStartDay  →  cycle end = NEXT calendar month
 *   else                                →  cycle end = THIS calendar month
 *
 * This is the "no future borrowing" upper bound: a leave on date D may only
 * use CL buckets whose key is ≤ the cycle end month of D.
 *
 * Examples (salaryCycleStartDay = 1):
 *   May 27 → day=27 >= 1 → cycle end = June  → key = June
 *   Jun 16 → day=16 >= 1 → cycle end = July  → key = July
 *
 * Examples (salaryCycleStartDay = 21):
 *   May 27 → day=27 >= 21 → cycle end = June  → key = June
 *   Jun 16 → day=16 <  21 → cycle end = June  → key = June  (same cycle!)
 *   Jun 21 → day=21 >= 21 → cycle end = July  → key = July
 */
const cycleAwareMKeyOf = (dateStr, salaryCycleStartDay = 1) => {
    const d     = dayjs.utc(dateStr).startOf('day');
    const year  = d.year();
    const month = d.month();   // 0-indexed
    const day   = d.date();

    if (day >= salaryCycleStartDay) {
        // This date is inside a cycle that ends NEXT calendar month
        const endMonth = (month + 1) % 12;
        const endYear  = endMonth === 0 ? year + 1 : year;
        return mKey(endYear, endMonth);
    } else {
        // This date is inside a cycle that ends THIS calendar month
        return mKey(year, month);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. BUILD CL BUCKETS — FIXED: salary-cycle-aware first earned month
//
// OLD (broken):
//   earned = 1 if m >= dojMonth  (raw calendar month)
//   DOJ=May21, startDay=21: dojMonth=4(May) → May earns CL ← WRONG
//   The May21 cycle ends in JUNE, so employee earns JUNE bucket first.
//
// NEW (correct):
//   Convert DOJ to its cycle-end month key using cycleEndKeyOfDOJ().
//   A bucket earns CL if bucket.key >= that first-cycle-end key.
//
//   DOJ=May21, startDay=21: first cycle end = June(24317)
//   → Jan–May buckets: key < 24317 → earned=0
//   → Jun–Dec buckets: key >= 24317 → earned=1  ✓
//
//   DOJ=May1, startDay=1: first cycle end = May(24316)
//   → Jan–Apr: earned=0, May–Dec: earned=1  ✓
//
//   DOJ=May20, startDay=21: day=20 < 21 → cycle end = May(24316)
//   → Jan–Apr: earned=0, May–Dec: earned=1  ✓
//
//   Prior-year DOJ: all 12 buckets earned ✓
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the mKey of the first salary cycle end month the employee earns.
 * This is the cycle-end month of the DOJ date.
 *
 * Special case: salaryCycleStartDay=1 → cycles = calendar months →
 *   use raw DOJ calendar month (avoid off-by-one from the >= formula).
 */
const cycleEndKeyOfDOJ = (dojDate, salaryCycleStartDay) => {
    const d     = dayjs.utc(dojDate);
    const year  = d.year();
    const month = d.month();   // 0-indexed
    const day   = d.date();

    if (salaryCycleStartDay === 1) {
        // Calendar-month cycles — earn the calendar month of DOJ
        return mKey(year, month);
    }
    if (day >= salaryCycleStartDay) {
        // DOJ is on or after cycle start → cycle ends NEXT calendar month
        const em = (month + 1) % 12;
        const ey = em === 0 ? year + 1 : year;
        return mKey(ey, em);
    } else {
        // DOJ is before cycle start → cycle ends THIS calendar month
        return mKey(year, month);
    }
};

export const buildCLBuckets = (dojDate, year, salaryCycleStartDay = 1) => {
    const doj         = dayjs.utc(dojDate);
    const dojYear     = doj.year();

    // Key of the first bucket the employee earns (salary-cycle-aware)
    const firstEarnedKey = dojYear > year
        ? Infinity                                           // DOJ is in the future → earns nothing
        : dojYear < year
            ? mKey(year, 0)                                 // DOJ before this year → all 12 buckets earned
            : cycleEndKeyOfDOJ(dojDate, salaryCycleStartDay); // DOJ this year → cycle-aware

    return Array.from({ length: 12 }, (_, m) => {
        const bucketKey = mKey(year, m);
        const earned    = bucketKey >= firstEarnedKey ? 1 : 0;

        const monthStart = dayjs.utc(`${year}-${String(m + 1).padStart(2, '0')}-01`);
        return {
            key:        bucketKey,
            year,
            month:      m,
            monthName:  monthStart.format('MMMM'),
            monthShort: monthStart.format('MMM'),
            label:      monthStart.format('MMMM YYYY'),
            earned,
            used:       0,
            remaining:  earned,
        };
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. BUILD DAY LIST FOR A LEAVE (unchanged — exported for reuse)
// ─────────────────────────────────────────────────────────────────────────────

export const buildDayList = (leave) => {
    const start = dayjs.utc(leave.startDate).startOf('day');
    const end   = dayjs.utc(leave.endDate).startOf('day');
    const days  = [];

    if (leave.leaveDuration === 'FIRST_HALF' || leave.leaveDuration === 'SECOND_HALF') {
        days.push({ date: start.format('YYYY-MM-DD'), weight: 0.5, isSandwich: false });
    } else {
        let cur = start.clone();
        while (cur.isSameOrBefore(end)) {
            days.push({ date: cur.format('YYYY-MM-DD'), weight: 1, isSandwich: false });
            cur = cur.add(1, 'day');
        }
        for (const sd of (leave.sandwichDates ?? [])) {
            const sdStr = dayjs.utc(sd).format('YYYY-MM-DD');
            if (!days.find(d => d.date === sdStr)) {
                days.push({ date: sdStr, weight: 1, isSandwich: true });
            }
        }
        days.sort((a, b) => a.date.localeCompare(b.date));
    }
    return days;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. FIFO REPLAY ENGINE  — FIXED: uses cycleAwareMKeyOf
// ─────────────────────────────────────────────────────────────────────────────

/**
 * replayLeavesOnBuckets(buckets, leaves, salaryCycleStartDay)
 *
 * Mutates each bucket's .used and .remaining.
 * Returns allocationRecords[].
 *
 * KEY CHANGE: the "no future borrowing" upper bound is now the
 * CYCLE END MONTH of each leave day (cycleAwareMKeyOf), not the
 * raw calendar month. This prevents a leave in a later cycle from
 * consuming a bucket that belongs to an earlier leave's cycle.
 */
export const replayLeavesOnBuckets = (buckets, leaves, salaryCycleStartDay = 1) => {
    // FIFO: sort by appliedAt ASC
    const ordered = [...leaves].sort((a, b) => {
        const tA = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
        const tB = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
        return tA - tB;
    });

    const allocationRecords = [];

    for (const leave of ordered) {
        const days = buildDayList(leave);

        for (const day of days) {
            // ✅ FIX: use salary-cycle-aware month key, not raw calendar month
            const dayMKey = cycleAwareMKeyOf(day.date, salaryCycleStartDay);

            const bucket = buckets
                .filter(b => b.earned > 0 && b.remaining > 0 && b.key <= dayMKey)
                .sort((a, b) => a.key - b.key)[0];

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
                    clBucketMonth: bucket.monthName,
                    clBucketLabel: bucket.label,
                    consume,
                });

                const lopPart = +(day.weight - consume).toFixed(2);
                if (lopPart > 0) {
                    allocationRecords.push({
                        leaveId: leave._id?.toString(), requestId: leave.requestId,
                        appliedAt: leave.appliedAt, leaveDate: day.date,
                        weight: lopPart, isSandwich: day.isSandwich,
                        isLOP: true, clBucketKey: null, clBucketMonth: null, clBucketLabel: null, consume: lopPart,
                    });
                }
            } else {
                allocationRecords.push({
                    leaveId: leave._id?.toString(), requestId: leave.requestId,
                    appliedAt: leave.appliedAt, leaveDate: day.date,
                    weight: day.weight, isSandwich: day.isSandwich,
                    isLOP: true, clBucketKey: null, clBucketMonth: null, clBucketLabel: null, consume: day.weight,
                });
            }
        }
    }

    return allocationRecords;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. ALLOCATE CL FOR A NEW LEAVE  — FIXED: uses cycleAwareMKeyOf + loads startDay
// ─────────────────────────────────────────────────────────────────────────────

export const allocateCLForLeave = async ({
    employeeId, doj, startDate, endDate, leaveDuration,
    sandwichDays = 0, sandwichDates = [], excludeLeaveId = null,
}) => {
    try {
        const startD = dayjs.utc(startDate).startOf('day');
        const endD   = dayjs.utc(endDate).startOf('day');
        const year   = startD.year();
        const endYear = endD.year();

        // ✅ Load salary cycle start day once
        const policy              = await LeavePolicy.findOne({ isActive: true }).lean();
        const salaryCycleStartDay = policy?.salaryCycle?.startDay ?? 1;

        const allBuckets = buildCLBuckets(doj, year, salaryCycleStartDay);
        if (endYear > year) allBuckets.push(...buildCLBuckets(doj, endYear, salaryCycleStartDay));

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

        // Replay existing with cycle-aware keys
        replayLeavesOnBuckets(allBuckets, existingLeaves, salaryCycleStartDay);

        const newLeaveObj = { startDate, endDate, leaveDuration, sandwichDates };
        const days        = buildDayList(newLeaveObj);

        let clDays  = 0;
        let lopDays = 0;
        const bucketConsumption = {};

        for (const day of days) {
            // ✅ FIX: cycle-aware upper bound
            const dayMKey = cycleAwareMKeyOf(day.date, salaryCycleStartDay);

            const bucket = allBuckets
                .filter(b => b.earned > 0 && b.remaining > 0 && b.key <= dayMKey)
                .sort((a, b) => a.key - b.key)[0];

            if (bucket) {
                const consume    = Math.min(bucket.remaining, day.weight);
                bucket.used      = +(bucket.used      + consume).toFixed(2);
                bucket.remaining = +(bucket.remaining - consume).toFixed(2);
                clDays          += consume;

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
            clDays, lopDays,
            isSplit:   clDays > 0 && lopDays > 0,
            isFullLOP: clDays === 0 && lopDays > 0,
            clBucketSummary: Object.values(bucketConsumption).sort((a, b) => a.key - b.key),
        };

    } catch (err) {
        console.error('allocateCLForLeave error:', err);
        const totalDays = leaveDuration !== 'FULL_DAY' ? 0.5 :
            Math.max(1, dayjs.utc(endDate).startOf('day').diff(dayjs.utc(startDate).startOf('day'), 'day') + 1 + sandwichDays);
        return { clDays: 0, lopDays: totalDays, isSplit: false, isFullLOP: true, clBucketSummary: [] };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. SANDWICH DETECTION  — FIXED: salary-cycle boundary instead of calendar month
//
// OLD RULE (broken):
//   Gap days are only sandwiched if dayA and dayB are in the SAME calendar month.
//   → May 29 (month=4) and Jun 1 (month=5) → different months → gap BLOCKED.
//
// NEW RULE (correct):
//   Gap days are sandwiched if dayA and dayB are in the SAME SALARY CYCLE.
//   With salaryCycleStartDay=21:
//     May 29 → cycle May 21–Jun 20
//     Jun  1 → cycle May 21–Jun 20  → SAME CYCLE ✓ → May 30+31 sandwiched ✓
//   With salaryCycleStartDay=1 (calendar month cycles):
//     May 29 → cycle May 1–May 31
//     Jun  1 → cycle Jun 1–Jun 30   → different cycle → no sandwich (same as before)
//
// The helper cycleStartOf(date) returns the UTC Date of the cycle start day
// that contains the given date. Two dates are in the same cycle iff their
// cycleStartOf is identical.
// ─────────────────────────────────────────────────────────────────────────────

export const calculateSandwichDays = async (
    employeeId,
    newStartDate,
    newEndDate,
    holidayDateStrings = [],
    salaryCycleStartDay = 1,   // ← NEW PARAM: load from LeavePolicy before calling
) => {
    const newStart   = dayjs.utc(newStartDate).startOf('day');
    const newEnd     = dayjs.utc(newEndDate).startOf('day');
    const holidaySet = new Set(holidayDateStrings);
    const isNonWorking = (d) => d.day() === 0 || d.day() === 6 || holidaySet.has(d.format('YYYY-MM-DD'));

    // Returns the start date (YYYY-MM-DD string) of the salary cycle containing d
    const cycleStartOf = (d) => {
        const day = d.date();
        if (day >= salaryCycleStartDay) {
            // cycle started THIS calendar month
            return d.date(salaryCycleStartDay).startOf('day').format('YYYY-MM-DD');
        } else {
            // cycle started LAST calendar month
            return d.subtract(1, 'month').date(salaryCycleStartDay).startOf('day').format('YYYY-MM-DD');
        }
    };

    const existingLeaves = await Leave.find({
        employee: employeeId,
        status:   { $in: ['APPROVED', 'PENDING'] },
    }).lean();

    const checkGap = (dayA, dayB) => {
        // ✅ FIXED: same salary cycle, not same calendar month
        if (cycleStartOf(dayA) !== cycleStartOf(dayB)) return [];

        const diff = dayB.diff(dayA, 'day');
        if (diff <= 1) return [];

        const gap = [];
        let cur = dayA.add(1, 'day');
        while (cur.isBefore(dayB)) { gap.push(cur.clone()); cur = cur.add(1, 'day'); }

        // All gap days must be non-working
        if (!gap.every(d => isNonWorking(d))) return [];
        return gap.map(d => d.format('YYYY-MM-DD'));
    };

    const prevLeave = existingLeaves
        .filter(l => dayjs.utc(l.endDate).startOf('day').isBefore(newStart))
        .sort((a, b) => dayjs.utc(b.endDate).valueOf() - dayjs.utc(a.endDate).valueOf())[0];
    const nextLeave = existingLeaves
        .filter(l => dayjs.utc(l.startDate).startOf('day').isAfter(newEnd))
        .sort((a, b) => dayjs.utc(a.startDate).valueOf() - dayjs.utc(b.startDate).valueOf())[0];

    const sandwichDates = [];
    if (prevLeave) {
        checkGap(dayjs.utc(prevLeave.endDate).startOf('day'), newStart)
            .forEach(d => { if (!sandwichDates.includes(d)) sandwichDates.push(d); });
    }
    if (nextLeave) {
        checkGap(newEnd, dayjs.utc(nextLeave.startDate).startOf('day'))
            .forEach(d => { if (!sandwichDates.includes(d)) sandwichDates.push(d); });
    }

    return { totalSandwichDays: sandwichDates.length, sandwichDates };
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET AVAILABLE CL  — FIXED: uses cycleAwareMKeyOf
// ─────────────────────────────────────────────────────────────────────────────

export const getAvailableCL = async (employeeId, doj, refDate, salaryCycleStartDay = 1) => {
    const ref      = dayjs.utc(refDate ?? new Date());
    const year     = ref.year();
    const dojD     = dayjs.utc(doj);
    const dojYear  = dojD.year();
    const dojMonth = dojD.month();

    const refDay   = ref.date();
    const refMonth = refDay >= salaryCycleStartDay
        ? ref.add(1, 'month').month()
        : ref.month();

    let earned = 0;
    if      (dojYear < year)  earned = refMonth + 1;
    else if (dojYear === year && dojMonth <= refMonth) earned = refMonth - dojMonth + 1;

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
// 7. FULL LEAVE BALANCE  — FIXED: passes salaryCycleStartDay to replayLeavesOnBuckets
// ─────────────────────────────────────────────────────────────────────────────

export const calculateLeaveBalance = async (employeeId, isPermanentEmp = false, year = dayjs.utc().year(), referenceDate = null) => {
    try {
        const policy              = await LeavePolicy.findOne({ isActive: true }).lean();
        const salaryCycleStartDay = policy?.salaryCycle?.startDay          ?? 1;
        const slDaysPerYear       = policy?.leaveTypes?.sick?.daysPerYear   ?? 10;
        const maternityDays       = policy?.leaveTypes?.maternity?.daysPerYear ?? 182;
        const paternityDays       = policy?.leaveTypes?.paternity?.daysPerYear ?? 15;
        const maxPermHoursPerMonth = policy?.permissionLeave?.hoursPerMonth ?? 2;

        const ref = referenceDate ? dayjs.utc(referenceDate) : dayjs.utc();

        const employee = await Employee.findById(employeeId).select('doj createdAt isPermanentEmp').lean();
        if (!employee) throw new Error('Employee not found');
        const doj = dayjs.utc(employee.doj ?? employee.createdAt);

        const buckets    = buildCLBuckets(doj, year, salaryCycleStartDay);
        const yearLeaves = await Leave.find({
            employee:  employeeId,
            leaveType: { $in: ['CASUAL', 'LOP'] },
            status:    { $in: ['APPROVED', 'PENDING'] },
            startDate: {
                $gte: dayjs.utc(`${year}-01-01`).toDate(),
                $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate(),
            },
        }).lean();

        // ✅ Pass salaryCycleStartDay so replay uses cycle-aware mKeyOf
        replayLeavesOnBuckets(buckets, yearLeaves, salaryCycleStartDay);

        const refDay = ref.date();
        const currentMonth = refDay >= salaryCycleStartDay
            ? ref.add(1, 'month').month()
            : ref.month();
        const currentMonthKey = mKey(year, currentMonth);

        const annualPool      = buckets.reduce((s, b) => s + b.earned, 0);
        const earnedToDate    = buckets.filter(b => b.key <= currentMonthKey).reduce((s, b) => s + b.earned, 0);
        const usedToDate      = +buckets.filter(b => b.key <= currentMonthKey).reduce((s, b) => s + b.used, 0).toFixed(2);
        const availableNow    = Math.max(0, earnedToDate - usedToDate);
        const annualRemaining = Math.max(0, annualPool - buckets.reduce((s, b) => s + b.used, 0));

        let cumEarned = 0, cumUsed = 0;
        const monthlyBreakdown = buckets.map(b => {
            if (b.earned > 0) cumEarned++;
            cumUsed += b.used;
            const cumBalance = Math.max(0, cumEarned - cumUsed);
            return {
                month:             b.monthName,
                monthShort:        b.monthShort,
                label:             b.label,
                key:               b.key,
                earned:            b.earned,
                usedFromBucket:    b.used,
                remainingInBucket: b.remaining,
                cumulativeEarned:  cumEarned,
                cumulativeUsed:    +cumUsed.toFixed(2),
                cumulativeBalance: +cumBalance.toFixed(2),
                isCurrent:         b.key === currentMonthKey,
                isFuture:          b.key  >  currentMonthKey,
                isEarned:          b.earned > 0,
            };
        });

        const lopLeaves    = await Leave.find({
            employee:  employeeId, leaveType: 'LOP', status: { $in: ['APPROVED', 'PENDING'] },
            startDate: { $gte: dayjs.utc(`${year}-01-01`).toDate(), $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate() },
        }).lean();
        const splitLopDays = yearLeaves.filter(l => l.isSplit).reduce((s, l) => s + (l.lopDays || 0), 0);
        const lopDaysTotal  = +(lopLeaves.reduce((s, l) => s + l.totalDays, 0) + splitLopDays).toFixed(2);

        const cycleStart = refDay >= salaryCycleStartDay
            ? ref.date(salaryCycleStartDay).startOf('day')
            : ref.subtract(1, 'month').date(salaryCycleStartDay).startOf('day');
        const cycleEnd = cycleStart.add(1, 'month').subtract(1, 'day').endOf('day');

        const permissionsThisCycle = await Permission.find({
            employee: employeeId,
            date:     { $gte: cycleStart.toDate(), $lte: cycleEnd.toDate() },
            status:   { $in: ['PENDING', 'APPROVED'] },
        }).lean();
        const permUsedHours      = +permissionsThisCycle.reduce((s, p) => s + (p.durationHours || 0), 0).toFixed(2);
        const permRemainingHours = +Math.max(0, maxPermHoursPerMonth - permUsedHours).toFixed(2);

        const response = {
            year,
            doj:                 doj.format('YYYY-MM-DD'),
            isPermanentEmployee: employee.isPermanentEmp || false,
            casual: {
                annualPool, earnedToDate, usedToDate, availableNow, annualRemaining,
                policyNote: '1 CL per salary cycle · carry-forward within year · FIFO by application order',
                monthlyBreakdown,
            },
            lop:   { daysThisYear: lopDaysTotal },
            permission: {
                hoursPerMonth:      maxPermHoursPerMonth,
                usedThisCycle:      permUsedHours,
                remainingThisCycle: permRemainingHours,
                maxPerRequest:      1,
                cycleLabel:         `${cycleStart.format('DD MMM')} – ${cycleEnd.format('DD MMM YYYY')}`,
            },
            currentMonth: {
                month: dayjs.utc().month(currentMonth).format('MMMM'),
                year,
                label: dayjs.utc(`${year}-${String(currentMonth + 1).padStart(2, '0')}-01`).format('MMMM YYYY'),
            },
            salaryCycleStartDay,
        };

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
// 8. CL ALLOCATION DETAIL  — FIXED: passes salaryCycleStartDay, bakes flags into buckets
// ─────────────────────────────────────────────────────────────────────────────

export const getCLAllocationDetail = async (employeeId, year) => {
    const employee = await Employee.findById(employeeId).select('doj createdAt').lean();
    if (!employee) throw new Error('Employee not found');
    const doj = dayjs.utc(employee.doj ?? employee.createdAt);

    const policy              = await LeavePolicy.findOne({ isActive: true }).lean();
    const salaryCycleStartDay = policy?.salaryCycle?.startDay ?? 1;

    const yearLeaves = await Leave.find({
        employee:  employeeId,
        leaveType: { $in: ['CASUAL', 'LOP'] },
        status:    { $in: ['APPROVED', 'PENDING'] },
        startDate: {
            $gte: dayjs.utc(`${year}-01-01`).toDate(),
            $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate(),
        },
    }).lean();

    const buckets = buildCLBuckets(doj, year, salaryCycleStartDay);
    // ✅ Pass salaryCycleStartDay
    const allocationRecords = replayLeavesOnBuckets(buckets, yearLeaves, salaryCycleStartDay);

    // Cycle-aware current month key (matches calculateLeaveBalance exactly)
    const ref    = dayjs.utc();
    const refDay = ref.date();
    const currentMonth    = refDay >= salaryCycleStartDay ? ref.add(1,'month').month() : ref.month();
    const currentMonthKey = mKey(year, currentMonth);

    const bucketSummary = buckets.map(b => ({
        key:               b.key,
        month:             b.monthName,
        monthShort:        b.monthShort,
        label:             b.label,
        earned:            b.earned,
        usedFromBucket:    b.used,
        remainingInBucket: b.remaining,
        // ✅ Baked in by server — frontend must NOT recompute from dayjs().month()
        isCurrent:         b.key === currentMonthKey,
        isFuture:          b.key  >  currentMonthKey,
        isEarned:          b.earned > 0,
    }));

    return { bucketSummary, allocationRecords, currentMonthKey, salaryCycleStartDay };
};