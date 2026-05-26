/**
 * leaveValidationHelper.js
 *
 * VALIDATION RULES:
 *
 * SINGLE DAY (startDate === endDate, or half-day):
 *   Block if: weekend, holiday, or sandwich date
 *   Reason: an employee cannot apply a single leave on a non-working day
 *
 * RANGE (startDate !== endDate, full-day):
 *   Block ONLY if: any date in the range is a sandwich date of another leave
 *   Weekends and holidays inside a continuous range are NOT blocked —
 *   they are naturally included in totalDays and that is correct behaviour.
 *   (e.g. applying May 27–Jun 2 includes May 30+31 weekend automatically)
 *   Overlap with existing leaves is handled by Leave.checkOverlap separately.
 *
 * Used by createLeaveRequest BEFORE the overlap check.
 *
 * ── HOW TO USE IN leaveController.js ──────────────────────────────
 *   import { validateLeaveDates } from '../utils/leaveValidationHelper.js';
 *
 *   const dateValidation = await validateLeaveDates(
 *       user._id, startDateObj, endDateObj, body.leaveDuration,
 *   );
 *   if (!dateValidation.ok) {
 *       return res.status(400).json({
 *           success: false,
 *           message: dateValidation.message,
 *           blockedDates: dateValidation.blockedDates,
 *       });
 *   }
 */

import dayjs   from 'dayjs';
import utc     from 'dayjs/plugin/utc.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(utc);
dayjs.extend(isSameOrBefore);

import Leave   from '../model/Leave.js';
import Holiday from '../model/Holiday.js';

export const validateLeaveDates = async (
    employeeId,
    startDate,
    endDate,
    leaveDuration,
) => {
    const start      = dayjs.utc(startDate).startOf('day');
    const end        = dayjs.utc(endDate).startOf('day');
    const isHalfDay  = leaveDuration === 'FIRST_HALF' || leaveDuration === 'SECOND_HALF';
    const isSingleDay = isHalfDay || start.isSame(end, 'day');
    const isRange     = !isSingleDay;

    // Build the list of all calendar dates in the range
    const requestedDates = [];
    if (isHalfDay) {
        requestedDates.push(start.clone());
    } else {
        let cur = start.clone();
        while (cur.isSameOrBefore(end)) {
            requestedDates.push(cur.clone());
            cur = cur.add(1, 'day');
        }
    }

    const blockedDates = [];

    // ── Weekend + Holiday: ONLY for single-day leaves ────────────────────────
    // For a range leave, weekends/holidays inside the range are part of the
    // continuous block and are counted naturally in totalDays — do NOT block them.
    if (isSingleDay) {
        // Weekend check
        requestedDates
            .filter(d => d.day() === 0 || d.day() === 6)
            .forEach(d => blockedDates.push({
                date:   d.format('YYYY-MM-DD'),
                reason: 'WEEKEND',
                detail: `${d.format('dddd')} — cannot apply leave on a weekend`,
            }));

        // Holiday check
        const year      = start.year();
        const endYear   = end.year();
        const hDocs     = await Holiday.find({
            year: { $in: year === endYear ? [year] : [year, endYear] },
        }).lean();
        const holidayMap = new Map(hDocs.map(h => [dayjs.utc(h.date).format('YYYY-MM-DD'), h.name]));
        requestedDates
            .filter(d => holidayMap.has(d.format('YYYY-MM-DD')))
            .forEach(d => blockedDates.push({
                date:   d.format('YYYY-MM-DD'),
                reason: 'HOLIDAY',
                detail: `${holidayMap.get(d.format('YYYY-MM-DD'))} — public holiday`,
            }));
    }

    // ── Sandwich date conflict: checked for BOTH single-day and range ─────────
    // Sandwich dates are "owned" by another leave. Applying on them would
    // double-count that day and break the sandwich calculation.
    const activeLeaves = await Leave.find({
        employee: employeeId,
        status:   { $in: ['APPROVED', 'PENDING'] },
    }).select('sandwichDates requestId').lean();

    const sandwichDateMap = new Map();
    for (const l of activeLeaves) {
        for (const sd of (l.sandwichDates ?? [])) {
            const sdStr = dayjs.utc(sd).format('YYYY-MM-DD');
            if (!sandwichDateMap.has(sdStr)) sandwichDateMap.set(sdStr, l.requestId);
        }
    }

    requestedDates
        .filter(d => sandwichDateMap.has(d.format('YYYY-MM-DD')))
        .forEach(d => blockedDates.push({
            date:   d.format('YYYY-MM-DD'),
            reason: 'SANDWICH',
            detail: `Already counted as a sandwich day for leave ${sandwichDateMap.get(d.format('YYYY-MM-DD'))}`,
        }));

    if (blockedDates.length === 0) return { ok: true };

    // Build human-readable message
    const byReason = (r) => blockedDates.filter(b => b.reason === r);
    const parts    = [];
    if (byReason('WEEKEND').length)  parts.push(`weekends: ${byReason('WEEKEND').map(b => b.date).join(', ')}`);
    if (byReason('HOLIDAY').length)  parts.push(`holidays: ${byReason('HOLIDAY').map(b => `${b.date} (${b.detail})`).join(', ')}`);
    if (byReason('SANDWICH').length) parts.push(`sandwich dates already allocated to another leave: ${byReason('SANDWICH').map(b => b.date).join(', ')}`);

    return {
        ok: false,
        message: `Cannot apply leave — ${parts.join('; ')}`,
        blockedDates,
    };
};



/**
 * getBlockedDatesForEmployee(employeeId, year)
 *
 * Returns a complete set of blocked date strings for a given employee and year.
 * Used by the frontend to disable dates in the date picker.
 *
 * Returns:
 * {
 *   weekends:   ['2026-05-30', '2026-05-31', ...],   // all Sat/Sun of the year
 *   holidays:   [{ date, name }, ...],
 *   sandwiches: [{ date, ownedByRequestId }, ...],
 * }
 *
 * Add a GET endpoint in your routes:
 *   router.get('/leaves/blocked-dates', authenticate, getBlockedDates);
 *
 * And the controller:
 *   export const getBlockedDates = async (req, res) => {
 *       const year = parseInt(req.query.year) || dayjs.utc().year();
 *       const data = await getBlockedDatesForEmployee(req.user._id, year);
 *       return res.json({ success: true, data });
 *   };
 */
export const getBlockedDatesForEmployee = async (employeeId, year) => {
    // Weekends for the year
    const weekends = [];
    let cur = dayjs.utc(`${year}-01-01`);
    const yearEnd = dayjs.utc(`${year}-12-31`);
    while (cur.isSameOrBefore(yearEnd)) {
        if (cur.day() === 0 || cur.day() === 6)
            weekends.push(cur.format('YYYY-MM-DD'));
        cur = cur.add(1, 'day');
    }

    // Holidays
    const holidayDocs = await Holiday.find({ year }).lean();
    const holidays    = holidayDocs.map(h => ({
        date: dayjs.utc(h.date).format('YYYY-MM-DD'),
        name: h.name,
    }));

    // Sandwich dates from active leaves
    const activeLeaves = await Leave.find({
        employee: employeeId,
        status:   { $in: ['APPROVED', 'PENDING'] },
    }).select('sandwichDates requestId startDate').lean();

    const sandwiches = [];
    for (const l of activeLeaves) {
        const leaveYear = dayjs.utc(l.startDate).year();
        if (leaveYear !== year && dayjs.utc(l.startDate).year() !== year) continue;
        for (const sd of (l.sandwichDates ?? [])) {
            const sdStr = dayjs.utc(sd).format('YYYY-MM-DD');
            if (!sandwiches.find(s => s.date === sdStr))
                sandwiches.push({ date: sdStr, ownedByRequestId: l.requestId });
        }
    }

    return { weekends, holidays, sandwiches };
};