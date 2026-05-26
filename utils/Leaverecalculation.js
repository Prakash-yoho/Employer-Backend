/**
 * leaveRecalculation.js — COMPLETE SELF-CONTAINED VERSION
 *
 * Drop this file into utils/leaveRecalculation.js
 * No changes needed to leaveBalanceHelper.js for this to work.
 *
 * ── HOW TO WIRE IT UP ──────────────────────────────────────────────
 * In leaveController.js, replace:
 *
 *   OLD import (remove entirely):
 *     import { recalculateCLAllocations } from '../utils/leaveRecalculation.js';
 *
 *   NEW import:
 *     import { recalculateAfterCancel } from '../utils/leaveRecalculation.js';
 *
 * In cancelLeaveRequest, replace the recalc call with:
 *   recalcResult = await recalculateAfterCancel(req.user._id, cancelledYear);
 *
 * ── WHAT THIS FILE DOES ────────────────────────────────────────────
 * After a leave is cancelled, two things must happen IN ORDER:
 *
 * 1. recalculateSandwich()
 *    Re-evaluates sandwich days for every remaining active leave.
 *    A leave that HAD sandwich because of the cancelled leave loses
 *    those days. Its sandwichDates, sandwichDays, and totalDays are
 *    patched in the DB before FIFO runs.
 *
 *    Example: Cancel May 29
 *      Jun 1 had sandwichDates=[May30,May31], totalDays=3
 *      → prevLeave is now null → newSandwichDates=[]
 *      → DB patched: sandwichDays=0, totalDays=1
 *
 * 2. recalculateCLAllocations()
 *    Re-fetches leaves (so totalDays is fresh), then re-runs FIFO
 *    bucket allocation in appliedAt order using cycle-aware eligibility.
 *
 *    Example after above:
 *      Jun 1: 1 day (not 3). May bucket is free. → 1d CL ✓
 */

import dayjs      from 'dayjs';
import utc        from 'dayjs/plugin/utc.js';
dayjs.extend(utc);

import Leave      from '../model/Leave.js';
import Employee   from '../model/Employee.js';
import LeavePolicy from '../model/LeavePolicy.js';
import Holiday    from '../model/Holiday.js';

// ─── Internal helpers (self-contained, no imports from leaveBalanceHelper) ───

const mKey = (y, m) => y * 12 + m;

/** Returns cycle-end month key for a date given salary cycle start day */
const cycleAwareMKeyOf = (dateStr, salaryCycleStartDay) => {
    const d     = dayjs.utc(dateStr).startOf('day');
    const year  = d.year();
    const month = d.month();
    const day   = d.date();
    if (day >= salaryCycleStartDay) {
        const em = (month + 1) % 12;
        return mKey(em === 0 ? year + 1 : year, em);
    }
    return mKey(year, month);
};

/** Returns the cycle-start date string for a dayjs date */
const cycleStartStrOf = (d, salaryCycleStartDay) => {
    if (d.date() >= salaryCycleStartDay)
        return d.date(salaryCycleStartDay).startOf('day').format('YYYY-MM-DD');
    return d.subtract(1, 'month').date(salaryCycleStartDay).startOf('day').format('YYYY-MM-DD');
};

/** Returns the mKey of the first salary cycle end month the employee earns */
const cycleEndKeyOfDOJ = (dojDate, salaryCycleStartDay) => {
    const d     = dayjs.utc(dojDate);
    const year  = d.year();
    const month = d.month();
    const day   = d.date();
    if (salaryCycleStartDay === 1) return mKey(year, month);
    if (day >= salaryCycleStartDay) {
        const em = (month + 1) % 12;
        return mKey(em === 0 ? year + 1 : year, em);
    }
    return mKey(year, month);
};

/** Build CL buckets for a year from DOJ — salary-cycle-aware */
const buildBuckets = (dojDate, year, salaryCycleStartDay = 1) => {
    const doj     = dayjs.utc(dojDate);
    const dojYear = doj.year();

    const firstEarnedKey = dojYear > year
        ? Infinity
        : dojYear < year
            ? mKey(year, 0)
            : cycleEndKeyOfDOJ(dojDate, salaryCycleStartDay);

    return Array.from({ length: 12 }, (_, m) => {
        const bucketKey = mKey(year, m);
        const earned    = bucketKey >= firstEarnedKey ? 1 : 0;
        const ms        = dayjs.utc(`${year}-${String(m + 1).padStart(2, '0')}-01`);
        return { key: bucketKey, month: m, monthName: ms.format('MMMM'), monthShort: ms.format('MMM'), label: ms.format('MMMM YYYY'), earned, used: 0, remaining: earned };
    });
};

/** Build the list of leave days (weight=1 full, 0.5 half) including sandwich dates */
const buildDayList = (leave) => {
    const start = dayjs.utc(leave.startDate).startOf('day');
    const end   = dayjs.utc(leave.endDate).startOf('day');
    if (leave.leaveDuration === 'FIRST_HALF' || leave.leaveDuration === 'SECOND_HALF')
        return [{ date: start.format('YYYY-MM-DD'), weight: 0.5, isSandwich: false }];
    const days = [];
    let cur = start.clone();
    while (cur.isSameOrBefore(end)) {
        days.push({ date: cur.format('YYYY-MM-DD'), weight: 1, isSandwich: false });
        cur = cur.add(1, 'day');
    }
    for (const sd of (leave.sandwichDates ?? [])) {
        const sdStr = dayjs.utc(sd).format('YYYY-MM-DD');
        if (!days.find(d => d.date === sdStr))
            days.push({ date: sdStr, weight: 1, isSandwich: true });
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    return days;
};

// need isSameOrBefore on dayjs
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(isSameOrBefore);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — recalculateSandwich
// ─────────────────────────────────────────────────────────────────────────────

const recalculateSandwich = async (employeeId, year, salaryCycleStartDay, holidaySet) => {
    const isNonWorking = (d) => d.day() === 0 || d.day() === 6 || holidaySet.has(d.format('YYYY-MM-DD'));

    // All active full-day CASUAL leaves for the year, sorted by startDate ASC
    const activeLeaves = await Leave.find({
        employee:  employeeId,
        leaveType: { $in: ['CASUAL', 'LOP'] },
        status:    { $in: ['APPROVED', 'PENDING'] },
        startDate: {
            $gte: dayjs.utc(`${year}-01-01`).toDate(),
            $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate(),
        },
    }).sort({ startDate: 1 }).lean();

    // Returns array of sandwich date strings for the gap between dayA and dayB,
    // or [] if the gap is not a valid sandwich (same cycle, all non-working)
    const checkGap = (dayA, dayB) => {
        if (cycleStartStrOf(dayA, salaryCycleStartDay) !== cycleStartStrOf(dayB, salaryCycleStartDay)) return [];
        const diff = dayB.diff(dayA, 'day');
        if (diff <= 1) return [];
        const gap = [];
        let cur = dayA.add(1, 'day');
        while (cur.isBefore(dayB)) { gap.push(cur.clone()); cur = cur.add(1, 'day'); }
        if (!gap.every(d => isNonWorking(d))) return [];
        return gap.map(d => d.format('YYYY-MM-DD'));
    };

    const changes = [];
    let   updated = 0;

    for (const leave of activeLeaves) {
        // Sandwich only applies to full-day leaves
        if (leave.leaveDuration !== 'FULL_DAY') continue;

        const leaveStart = dayjs.utc(leave.startDate).startOf('day');
        const leaveEnd   = dayjs.utc(leave.endDate).startOf('day');
        const selfId     = leave._id.toString();

        // Nearest active leave BEFORE this one (endDate < leaveStart)
        const prevLeave = activeLeaves
            .filter(l => l._id.toString() !== selfId && dayjs.utc(l.endDate).startOf('day').isBefore(leaveStart))
            .sort((a, b) => dayjs.utc(b.endDate).valueOf() - dayjs.utc(a.endDate).valueOf())[0];

        // Nearest active leave AFTER this one (startDate > leaveEnd)
        const nextLeave = activeLeaves
            .filter(l => l._id.toString() !== selfId && dayjs.utc(l.startDate).startOf('day').isAfter(leaveEnd))
            .sort((a, b) => dayjs.utc(a.startDate).valueOf() - dayjs.utc(b.startDate).valueOf())[0];

        // Compute fresh sandwich dates
        const fresh = [];
        if (prevLeave) checkGap(dayjs.utc(prevLeave.endDate).startOf('day'), leaveStart)
            .forEach(d => { if (!fresh.includes(d)) fresh.push(d); });
        if (nextLeave) checkGap(leaveEnd, dayjs.utc(nextLeave.startDate).startOf('day'))
            .forEach(d => { if (!fresh.includes(d)) fresh.push(d); });

        const newSandwichDates = fresh.sort();
        const oldSandwichDates = (leave.sandwichDates ?? [])
            .map(d => dayjs.utc(d).format('YYYY-MM-DD')).sort();

        if (JSON.stringify(newSandwichDates) === JSON.stringify(oldSandwichDates)) continue;

        // Base days = calendar days in [startDate..endDate] (no sandwich)
        const baseDays     = leaveEnd.diff(leaveStart, 'day') + 1;
        const newTotalDays = +(baseDays + newSandwichDates.length).toFixed(2);

        await Leave.findByIdAndUpdate(leave._id, {
            $set: {
                sandwichDays:  newSandwichDates.length,
                sandwichDates: newSandwichDates,
                totalDays:     newTotalDays,
            },
        });

        changes.push({
            requestId: leave.requestId,
            type:      'sandwich',
            before:    { sandwichDays: leave.sandwichDays ?? 0, sandwichDates: oldSandwichDates, totalDays: leave.totalDays },
            after:     { sandwichDays: newSandwichDates.length, sandwichDates: newSandwichDates, totalDays: newTotalDays },
            summary:   newSandwichDates.length === 0
                ? `${leave.requestId}: sandwich removed — back to ${newTotalDays}d`
                : `${leave.requestId}: sandwich updated — now ${newSandwichDates.length}d added, total ${newTotalDays}d`,
        });
        updated++;
    }

    return { updated, changes };
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — recalculateCLAllocations
// ─────────────────────────────────────────────────────────────────────────────

const recalculateCLAllocations = async (employeeId, year, salaryCycleStartDay, doj) => {
    // Re-fetch leaves so we get the fresh totalDays / sandwichDates from Step 1
    const leaves = await Leave.find({
        employee:  employeeId,
        leaveType: { $in: ['CASUAL', 'LOP'] },
        status:    { $in: ['APPROVED', 'PENDING'] },
        startDate: {
            $gte: dayjs.utc(`${year}-01-01`).toDate(),
            $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate(),
        },
    }).sort({ appliedAt: 1 }).lean();   // FIFO: appliedAt ASC

    if (leaves.length === 0) return { recalculated: 0, changes: [] };

    const maxEndYear = Math.max(...leaves.map(l => dayjs.utc(l.endDate).year()));
    const allBuckets = buildBuckets(doj, year, salaryCycleStartDay);
    if (maxEndYear > year) allBuckets.push(...buildBuckets(doj, maxEndYear, salaryCycleStartDay));

    const newAllocations = [];

    for (const leave of leaves) {
        const days = buildDayList(leave);   // uses fresh sandwichDates from DB

        let clDays = 0, lopDays = 0;
        const bucketConsumption = {};

        for (const day of days) {
            const dayMKey = cycleAwareMKeyOf(day.date, salaryCycleStartDay);
            const bucket  = allBuckets
                .filter(b => b.earned > 0 && b.remaining > 0 && b.key <= dayMKey)
                .sort((a, b) => a.key - b.key)[0];

            if (bucket) {
                const consume    = Math.min(bucket.remaining, day.weight);
                bucket.used      = +(bucket.used      + consume).toFixed(2);
                bucket.remaining = +(bucket.remaining - consume).toFixed(2);
                clDays          += consume;
                if (!bucketConsumption[bucket.key])
                    bucketConsumption[bucket.key] = { key: bucket.key, label: bucket.label, monthName: bucket.monthName, days: 0 };
                bucketConsumption[bucket.key].days = +(bucketConsumption[bucket.key].days + consume).toFixed(2);
                const lopPart = +(day.weight - consume).toFixed(2);
                if (lopPart > 0) lopDays += lopPart;
            } else {
                lopDays += day.weight;
            }
        }

        clDays  = +clDays.toFixed(2);
        lopDays = +lopDays.toFixed(2);

        const isSplit      = clDays > 0 && lopDays > 0;
        const newLeaveType = (clDays === 0 && lopDays > 0) ? 'LOP' : 'CASUAL';
        const newTotalDays = +(clDays + lopDays).toFixed(2);

        newAllocations.push({
            _id:          leave._id,
            requestId:    leave.requestId,
            newLeaveType, newClDays: clDays, newLopDays: lopDays, newIsSplit: isSplit, newTotalDays,
            newClBuckets: Object.values(bucketConsumption).sort((a, b) => a.key - b.key),
            oldLeaveType: leave.leaveType,
            oldClDays:    leave.clDays  ?? 0,
            oldLopDays:   leave.lopDays ?? 0,
            oldIsSplit:   leave.isSplit ?? false,
        });
    }

    const changes = []; let recalculated = 0;

    for (const alloc of newAllocations) {
        if (
            alloc.newLeaveType === alloc.oldLeaveType &&
            alloc.newClDays    === alloc.oldClDays    &&
            alloc.newLopDays   === alloc.oldLopDays   &&
            alloc.newIsSplit   === alloc.oldIsSplit
        ) continue;

        await Leave.findByIdAndUpdate(alloc._id, {
            $set: {
                leaveType:       alloc.newLeaveType,
                clDays:          alloc.newClDays,
                lopDays:         alloc.newLopDays,
                isSplit:         alloc.newIsSplit,
                totalDays:       alloc.newTotalDays,
                clBucketSummary: alloc.newClBuckets,
            },
        });

        const summary = alloc.oldLeaveType === 'LOP' && alloc.newLeaveType === 'CASUAL'
            ? `${alloc.requestId}: LOP → Casual Leave (${alloc.newClDays}d CL)`
            : alloc.oldLeaveType === 'CASUAL' && alloc.newLeaveType === 'LOP'
                ? `${alloc.requestId}: Casual Leave → LOP`
                : alloc.oldIsSplit && !alloc.newIsSplit
                    ? `${alloc.requestId}: split resolved → ${alloc.newClDays}d CL only`
                    : `${alloc.requestId}: updated → ${alloc.newClDays}d CL, ${alloc.newLopDays}d LOP`;

        changes.push({
            requestId: alloc.requestId, type: 'cl',
            before: { leaveType: alloc.oldLeaveType, clDays: alloc.oldClDays, lopDays: alloc.oldLopDays, isSplit: alloc.oldIsSplit },
            after:  { leaveType: alloc.newLeaveType, clDays: alloc.newClDays, lopDays: alloc.newLopDays, isSplit: alloc.newIsSplit },
            summary,
        });
        recalculated++;
    }

    return { recalculated, changes };
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT — recalculateAfterCancel
// This is the ONLY function you need to import in leaveController.js
// ─────────────────────────────────────────────────────────────────────────────

export const recalculateAfterCancel = async (employeeId, year) => {
    // Load shared dependencies once
    const employee = await Employee.findById(employeeId).select('doj createdAt').lean();
    if (!employee) throw new Error('Employee not found');
    const doj = employee.doj ?? employee.createdAt;

    const policy              = await LeavePolicy.findOne({ isActive: true }).lean();
    const salaryCycleStartDay = policy?.salaryCycle?.startDay ?? 1;

    const holidays   = await Holiday.find({ year: { $in: [year, year + 1] } }).lean();
    const holidaySet = new Set(holidays.map(h => dayjs.utc(h.date).format('YYYY-MM-DD')));

    // Step 1: Fix sandwich dates + totalDays FIRST
    let sandwichResult = { updated: 0, changes: [] };
    try {
        sandwichResult = await recalculateSandwich(employeeId, year, salaryCycleStartDay, holidaySet);
        if (sandwichResult.updated > 0)
            console.info('[recalcAfterCancel] Sandwich:', sandwichResult.changes.map(c => c.summary));
    } catch (e) {
        console.error('[recalcAfterCancel] Sandwich step failed (non-fatal):', e.message);
    }

    // Step 2: Re-run FIFO with corrected totalDays
    let clResult = { recalculated: 0, changes: [] };
    try {
        clResult = await recalculateCLAllocations(employeeId, year, salaryCycleStartDay, doj);
        if (clResult.recalculated > 0)
            console.info('[recalcAfterCancel] CL/LOP:', clResult.changes.map(c => c.summary));
    } catch (e) {
        console.error('[recalcAfterCancel] CL step failed (non-fatal):', e.message);
    }

    return {
        sandwich:   sandwichResult,
        cl:         clResult,
        allChanges: [...sandwichResult.changes, ...clResult.changes],
    };
};