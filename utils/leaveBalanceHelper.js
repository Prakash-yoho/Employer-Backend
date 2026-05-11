// utils/leaveBalanceHelper.js
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';

dayjs.extend(utc);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

import Leave from '../model/Leave.js';
import LeavePolicy from '../model/LeavePolicy.js';

// ─────────────────────────────────────────────────────────────────────────────
// CYCLE PERIOD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the cycle period that contains the given date.
 *
 * Example startDay=21:
 *   Dec 21 – Jan 20  → cycleMonth=0 (Jan), cycleYear=this year
 *   Jan 21 – Feb 20  → cycleMonth=1 (Feb)
 *
 * @param {dayjs.Dayjs} date     — UTC dayjs object
 * @param {number}      startDay — 1–28, from policy
 */
export const getCyclePeriodForDate = (date, startDay = 1) => {
    const d = dayjs.utc(date);
    const day = d.date();

    let cycleEndYear, cycleEndMonth;

    if (startDay === 1) {
        cycleEndMonth = d.month();   // 0-indexed
        cycleEndYear = d.year();
    } else if (day >= startDay) {
        // In the second half of the cycle — cycle ends next month
        const next = d.add(1, 'month');
        cycleEndMonth = next.month();
        cycleEndYear = next.year();
    } else {
        // In the first half — cycle ends this month
        cycleEndMonth = d.month();
        cycleEndYear = d.year();
    }

    // Use string constructor — avoids dayjs object-literal bugs
    const endMonthStr = String(cycleEndMonth + 1).padStart(2, '0'); // 1-indexed
    const startDayStr = String(startDay).padStart(2, '0');

    // Cycle START = startDay of the month before cycleEnd
    const cycleStart = dayjs.utc(`${cycleEndYear}-${endMonthStr}-01`)
        .subtract(1, 'month')
        .date(startDay)
        .startOf('day');

    // Cycle END = (startDay - 1) of cycleEnd month
    const cycleEnd = dayjs.utc(`${cycleEndYear}-${endMonthStr}-${startDayStr}`)
        .subtract(1, 'day')
        .endOf('day');

    return {
        start: cycleStart,
        end: cycleEnd,
        cycleMonth: cycleEndMonth,
        cycleYear: cycleEndYear
    };
};

/**
 * Get the CURRENT cycle period (today UTC).
 */
export const getCurrentCyclePeriod = (startDay = 1) => {
    return getCyclePeriodForDate(dayjs.utc(), startDay);
};

// ─────────────────────────────────────────────────────────────────────────────
// QUARTER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quarter number (1–4) from a 0-indexed cycleMonth.
 */
export const getCycleQuarterNumber = (cycleMonth) => {
    return Math.floor(cycleMonth / 3) + 1;
};

/**
 * Full date range of the cycle-quarter containing `date`.
 */
export const getCycleQuarterForDate = (date, startDay = 1) => {
    const { cycleMonth, cycleYear } = getCyclePeriodForDate(dayjs.utc(date), startDay);
    const quarterNumber = getCycleQuarterNumber(cycleMonth);

    const firstEndMonth = (quarterNumber - 1) * 3;   // 0, 3, 6, or 9
    const lastEndMonth = firstEndMonth + 2;           // 2, 5, 8, or 11

    // String-based construction for safety
    const firstEndMonthStr = String(firstEndMonth + 1).padStart(2, '0');
    const lastEndMonthStr = String(lastEndMonth + 1).padStart(2, '0');
    const startDayStr = String(startDay).padStart(2, '0');

    // First cycle of quarter: starts at startDay of (firstEndMonth - 1)
    const firstCycleStartYear = firstEndMonth === 0 && startDay > 1
        ? cycleYear - 1
        : cycleYear;

    const firstCycleStart = dayjs.utc(`${firstCycleStartYear}-${firstEndMonthStr}-01`)
        .subtract(1, 'month')
        .date(startDay)
        .startOf('day');

    const lastCycleEnd = dayjs.utc(`${cycleYear}-${lastEndMonthStr}-${startDayStr}`)
        .subtract(1, 'day')
        .endOf('day');

    // Validate
    if (!firstCycleStart.isValid() || !lastCycleEnd.isValid()) {
        throw new Error(
            `getCycleQuarterForDate produced invalid dates: startDay=${startDay}, cycleYear=${cycleYear}, Q${quarterNumber}`
        );
    }

    return {
        start: firstCycleStart,
        end: lastCycleEnd,
        quarterNumber,
        quarterLabel: `Q${quarterNumber} ${cycleYear}`,
        firstEndMonth,
        lastEndMonth
    };
};

/**
 * Current cycle-quarter (today-based).
 */
export const getCurrentCycleQuarter = (startDay = 1) => {
    return getCycleQuarterForDate(dayjs.utc(), startDay);
};

/**
 * CL quota available up to and including the current cycle-month within the quarter.
 */
export const getCLQuotaForCurrentCycleMonth = (clDaysPerYear = 12, startDay = 1) => {
    const { cycleMonth } = getCurrentCyclePeriod(startDay);
    const quarterNumber = getCycleQuarterNumber(cycleMonth);
    const firstMonthOfQuarter = (quarterNumber - 1) * 3;
    const monthIndexInQuarter = cycleMonth - firstMonthOfQuarter; // 0, 1, or 2

    const daysPerQuarter = clDaysPerYear / 4;
    const daysPerCycleMonth = daysPerQuarter / 3;

    return parseFloat(((monthIndexInQuarter + 1) * daysPerCycleMonth).toFixed(2));
};

// ─────────────────────────────────────────────────────────────────────────────
// FULL BALANCE CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

export const calculateLeaveBalance = async (
    employeeId,
    isPermanentEmp = false,
    year = dayjs.utc().year(),
    referenceDate = null
) => {
    // ── Fetch active policy ───────────────────────────────────────────────
    const policy = await LeavePolicy.findOne({ isActive: true }).lean();
    const startDay = policy?.salaryCycle?.startDay ?? 1;

    const clDaysPerYear = policy?.leaveTypes?.casual?.daysPerYear ?? 12;
    const slDaysPerYear = policy?.leaveTypes?.sick?.daysPerYear ?? 10;
    const maternityDays = policy?.leaveTypes?.maternity?.daysPerYear ?? 182;
    const paternityDays = policy?.leaveTypes?.paternity?.daysPerYear ?? 15;

    // ── Annual window — string-based, safe ───────────────────────────────
    const startOfYear   = dayjs.utc(`${year}-01-01`).startOf('day').toDate();
    const endOfYear     = dayjs.utc(`${year}-12-31`).endOf('day').toDate();
    const endOfNextYear = dayjs.utc(`${year + 1}-12-31`).endOf('day').toDate();

    if (isNaN(startOfYear.getTime()) || isNaN(endOfYear.getTime())) {
        throw new Error(`Invalid year provided: ${year}`);
    }

    // ── Fetch approved leaves for the year ───────────────────────────────
    const approvedLeaves = await Leave.find({
        employee:  employeeId,
        status:    { $in: ['APPROVED', 'PENDING'] },
        startDate: { $gte: startOfYear, $lte: endOfNextYear }
    }).lean();

    // ── Current cycle and quarter ─────────────────────────────────────────
    const ref = referenceDate ? dayjs.utc(referenceDate) : dayjs.utc();
    const currentCycle   = getCyclePeriodForDate(ref, startDay);
    const currentQuarter = getCycleQuarterForDate(ref, startDay);

    if (!currentQuarter.start.isValid() || !currentQuarter.end.isValid()) {
        throw new Error('Invalid quarter date range. Check salaryCycle.startDay in policy.');
    }

    const daysPerQuarter      = clDaysPerYear / 4;
    const daysPerMonth        = parseFloat((daysPerQuarter / 3).toFixed(2));
    const firstMonthOfQuarter = (currentQuarter.quarterNumber - 1) * 3;
    const refCycleMonth       = getCyclePeriodForDate(ref, startDay).cycleMonth;
    const monthIndexInQuarter = ((refCycleMonth - firstMonthOfQuarter) + 12) % 12;
    const clQuota             = parseFloat(((monthIndexInQuarter + 1) * daysPerMonth).toFixed(2));
    const fullQuarterQuota    = parseFloat(daysPerQuarter.toFixed(2));

    const clUsedThisQuarter = approvedLeaves
        .filter(l => {
if (l.leaveType !== 'CASUAL') return false;
            const s = dayjs.utc(l.startDate);
            const e = dayjs.utc(l.endDate);
            let current = s;
            let hasClDaysInThisQuarter = false;
            while (current.isSameOrBefore(e, 'day')) {
                const lQuarter = getCycleQuarterForDate(current.toDate(), startDay);
                if (
                    lQuarter.quarterNumber === currentQuarter.quarterNumber &&
                    lQuarter.quarterLabel  === currentQuarter.quarterLabel
                ) {
                    hasClDaysInThisQuarter = true;
                    break;
                }
                current = current.add(1, 'day');
            }
            return hasClDaysInThisQuarter;
        })
        .reduce((sum, l) => {
            // Walk each day and only count days that fall in the current quarter
            const s = dayjs.utc(l.startDate);
            const e = dayjs.utc(l.endDate);
            let current = s;
            let daysInThisQuarter = 0;

            while (current.isSameOrBefore(e, 'day')) {
                const lQuarter = getCycleQuarterForDate(current.toDate(), startDay);
                if (
                    lQuarter.quarterNumber === currentQuarter.quarterNumber &&
                    lQuarter.quarterLabel  === currentQuarter.quarterLabel
                ) {
                    daysInThisQuarter++;
                }
                current = current.add(1, 'day');
            }

            // For split leaves, use proportional clDays. For normal CL, each day = 1 CL day
       // For split leaves, use proportional clDays. For normal CL, each day = 1 CL day
            if (l.isSplit && l.totalDays > 0 && (l.clDays ?? 0) > 0) {
                const ratio = daysInThisQuarter / l.totalDays;
                return sum + parseFloat((l.clDays * ratio).toFixed(2));
            }
            // For pure CASUAL (non-split), count each day as 1 CL day
            if (l.leaveType === 'CASUAL' && !l.isSplit) {
                return sum + daysInThisQuarter;
            }
            return sum;
        }, 0);

    const clRemainingRaw = fullQuarterQuota - clUsedThisQuarter;
    const clRemaining    = Math.max(0, parseFloat(clRemainingRaw.toFixed(2)));

    // ── CL used this year ─────────────────────────────────────────────────
    const clUsedThisYear = approvedLeaves
        .filter(l => l.leaveType === 'CASUAL')
        .reduce((sum, l) => sum + l.totalDays, 0);

    // ── LOP (explicit + split portion) ───────────────────────────────────
    const explicitLopDays = approvedLeaves
        .filter(l => l.leaveType === 'LOP')
        .reduce((sum, l) => sum + l.totalDays, 0);

    const splitLopDays = approvedLeaves
        .filter(l => l.isSplit && (l.lopDays ?? 0) > 0)
        .reduce((sum, l) => sum + (l.lopDays ?? 0), 0);

    const lopDays = parseFloat((explicitLopDays + splitLopDays).toFixed(2));

    // ── Permanent leave types ─────────────────────────────────────────────
    let slUsed = 0, maternityUsed = 0, paternityUsed = 0;
    if (isPermanentEmp) {
        slUsed        = approvedLeaves.filter(l => l.leaveType === 'SICK').reduce((sum, l) => sum + l.totalDays, 0);
        maternityUsed = approvedLeaves.filter(l => l.leaveType === 'MATERNITY').reduce((sum, l) => sum + l.totalDays, 0);
        paternityUsed = approvedLeaves.filter(l => l.leaveType === 'PATERNITY').reduce((sum, l) => sum + l.totalDays, 0);
    }

    // ── Assemble balance object ───────────────────────────────────────────
    const balance = {
        casual: {
            quotaThisQuarter:     fullQuarterQuota,
            usedThisQuarter:      parseFloat(clUsedThisQuarter.toFixed(2)),
            remainingThisQuarter: clRemaining,
            unlockedThisMonth:    clQuota,
            isLOP:                clRemainingRaw < 0,
            annualTotal:          clDaysPerYear,
            usedThisYear:         parseFloat(clUsedThisYear.toFixed(2)),
            policyNote:           `${clDaysPerYear} days/year • ${daysPerQuarter} days/quarter • unlocks ${daysPerMonth}/month`
        },
        lop: {
            days: lopDays,
            note: 'Loss of Pay — leaves beyond available quota'
        },
        currentCycle: {
            start: currentCycle.start.format('YYYY-MM-DD'),
            end:   currentCycle.end.format('YYYY-MM-DD'),
            label: currentCycle.start.format('DD MMM') + ' – ' + currentCycle.end.format('DD MMM YYYY')
        },
        currentQuarter: {
            start:         currentQuarter.start.format('YYYY-MM-DD'),
            end:           currentQuarter.end.format('YYYY-MM-DD'),
            quarterLabel:  currentQuarter.quarterLabel,
            quarterNumber: currentQuarter.quarterNumber
        },
        salaryCycleStartDay: startDay,
        year
    };

    if (isPermanentEmp) {
        balance.sick = {
            total:          slDaysPerYear,
            used:           parseFloat(slUsed.toFixed(2)),
            remaining:      Math.max(0, parseFloat((slDaysPerYear - slUsed).toFixed(2))),
            usedPercentage: slDaysPerYear > 0 ? Math.min(100, Math.round((slUsed / slDaysPerYear) * 100)) : 0,
            policyNote:     `${slDaysPerYear} days/year`
        };
        balance.maternity = {
            total:     maternityDays,
            used:      parseFloat(maternityUsed.toFixed(2)),
            remaining: Math.max(0, parseFloat((maternityDays - maternityUsed).toFixed(2))),
            note:      'As per Maternity Benefit Act (26 weeks)'
        };
        balance.paternity = {
            total:     paternityDays,
            used:      parseFloat(paternityUsed.toFixed(2)),
            remaining: Math.max(0, parseFloat((paternityDays - paternityUsed).toFixed(2))),
            note:      'As per local law'
        };
    }

    return balance;
};