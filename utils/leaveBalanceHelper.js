
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
 *   Dec 21 – Jan 20  → cycleMonth = 0  (January),   cycleYear = YYYY+1
 *
 * "cycleMonth" = calendar month of the cycle END date (0-indexed).
 */
export const getCycleForDate = (date, startDay = 21) => {
    const d = dayjs.utc(date);
    const dayOfMonth = d.date();

    let cycleEndMonth, cycleEndYear;
    let cycleStartDate, cycleEndDate;

    if (startDay === 1) {
        cycleEndMonth = d.month();
        cycleEndYear = d.year();
        cycleStartDate = d.startOf('month');
        cycleEndDate = d.endOf('month');
    } else if (dayOfMonth >= startDay) {
        // On/after startDay → belongs to NEXT calendar month's named cycle
        const nextMonth = d.add(1, 'month');
        cycleEndMonth = nextMonth.month();
        cycleEndYear = nextMonth.year();
        cycleStartDate = d.date(startDay);
        cycleEndDate = nextMonth.date(startDay - 1);
    } else {
        // Before startDay → belongs to THIS calendar month's named cycle
        cycleEndMonth = d.month();
        cycleEndYear = d.year();
        cycleStartDate = d.subtract(1, 'month').date(startDay);
        cycleEndDate = d.date(startDay - 1);
    }

    return {
        cycleMonth: cycleEndMonth,   // 0-indexed
        cycleYear: cycleEndYear,
        cycleLabel: `${cycleStartDate.format('DD MMM')} – ${cycleEndDate.format('DD MMM YYYY')}`,
        start: cycleStartDate,
        end: cycleEndDate,
    };
};

/** Unique integer key for ordering cycles. */
export const getCycleNumber = (cycleYear, cycleMonth) =>
    cycleYear * 12 + cycleMonth;

// ─────────────────────────────────────────────────────────────────────────────
// CL ACCRUAL — CARRY-FORWARD MODEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total CLs earned from DOJ cycle up to (and including) targetCycle.
 * 1 CL per cycle month, starting from the cycle that contains the DOJ.
 *
 * Example — DOJ = 15 Jan 2026, startDay = 21:
 *   DOJ cycle = Jan 2026 (Dec 21 – Jan 20 contains Jan 15 ✓)
 *   Jan cycle = +1, Feb cycle = +2, … May cycle = +5
 */
// REPLACE WITH — year-scoped: max 12 per year, resets each year:
export const calculateTotalCLEarned = (dojDate, targetCycleYear, targetCycleMonth, startDay = 21) => {
    const doj = dayjs.utc(dojDate);
    const dojCycle = getCycleForDate(doj, startDay);
    const dojKey = getCycleNumber(dojCycle.cycleYear, dojCycle.cycleMonth);
    const targetKey = getCycleNumber(targetCycleYear, targetCycleMonth);

    if (targetKey < dojKey) return 0;

    // ── Year boundary: first cycle of the target year ────────────────────
    // The "leave year" starts from the cycle containing Jan 1 of targetCycleYear
    const yearStart = getCycleForDate(dayjs.utc(`${targetCycleYear}-01-01`), startDay);
    const yearStartKey = getCycleNumber(yearStart.cycleYear, yearStart.cycleMonth);

    // Earned from the later of: DOJ cycle OR year-start cycle
    const effectiveStartKey = Math.max(dojKey, yearStartKey);

    if (targetKey < effectiveStartKey) return 0;
    return targetKey - effectiveStartKey + 1;
};

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE SPLITTING FOR CROSS-CYCLE LEAVES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a date range into groups, one per salary cycle.
 * e.g. May 17–21 with startDay=21:
 *   May 17–20 → April cycle (May 20 end)
 *   May 21    → May   cycle (Jun 20 end)
 */
export const splitLeaveByCycles = (startDate, endDate, startDay = 21) => {
    const start = dayjs.utc(startDate).startOf('day');
    const end = dayjs.utc(endDate).startOf('day');
    const cycles = [];

    let current = start.clone();
    while (current.isSameOrBefore(end)) {
        const cycle = getCycleForDate(current, startDay);
        const key = getCycleNumber(cycle.cycleYear, cycle.cycleMonth);

        let bucket = cycles.find(c => c.cycleKey === key);
        if (!bucket) {
            bucket = {
                cycleKey: key,
                cycleYear: cycle.cycleYear,
                cycleMonth: cycle.cycleMonth,
                cycleLabel: cycle.cycleLabel,
                dates: [],
                dayCount: 0,
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
// MAIN ALLOCATION — allocateCLForLeave (FIXED)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FIXED LOGIC:
 * ─────────────
 * For a cross-cycle leave (e.g. May 17–21 spanning Apr & May cycles):
 *   • We split the leave by cycle.
 *   • For EACH cycle segment, we compute:
 *       earned_up_to_this_cycle  –  already_used_before_this_cycle
 *       = available CL for that segment
 *   • This means the May 21 day uses the May cycle's CL correctly.
 *
 * Net result: May 17–21 with 5 total CL earned → all 5 days as CL, 0 LOP.
 *
 * @param {ObjectId} employeeId
 * @param {Date|string} doj
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @param {number} requestedDays
 * @param {number} startDay
 * @param {number} year
 * @param {ObjectId|null} excludeLeaveId
 */
export const allocateCLForLeave = async (
    employeeId, doj, startDate, endDate, requestedDays, startDay, year,
    excludeLeaveId = null
) => {
    try {
        const dojDate = dayjs.utc(doj);

// REPLACE WITH — scope to this year's cycles only, reset each year:
const matchQuery = {
    employee: employeeId,
    leaveType: 'CASUAL',
    status: { $in: ['APPROVED', 'PENDING'] },
};
if (excludeLeaveId) matchQuery._id = { $ne: excludeLeaveId };
const allExistingLeaves = await Leave.find(matchQuery).lean();

// ── Year boundary: first cycle of this year → last cycle of this year ──
const firstCycleOfYear = getCycleForDate(
    dayjs.utc(`${year}-01-${startDay === 1 ? '01' : String(startDay).padStart(2,'0')}`),
    startDay
);
// For startDay=21: Jan 21 → yearStart cycle. But Jan 1–20 belongs to prev year's last cycle.
// The FIRST cycle of the year is the one containing Jan 1 of this year.
const yearStartCycle = getCycleForDate(dayjs.utc(`${year}-01-01`), startDay);
const yearStartKey = getCycleNumber(yearStartCycle.cycleYear, yearStartCycle.cycleMonth);

// Last cycle of year: the cycle containing Dec 31 of this year
const yearEndCycle = getCycleForDate(dayjs.utc(`${year}-12-31`), startDay);
const yearEndKey = getCycleNumber(yearEndCycle.cycleYear, yearEndCycle.cycleMonth);

// Only count leaves whose cycle falls within this year's range
const existingLeaves = allExistingLeaves.filter(leave => {
    const lc = getCycleForDate(dayjs.utc(leave.startDate), startDay);
    const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
    return lcKey >= yearStartKey && lcKey <= yearEndKey;
});

// ── Annual CL pool = CLs earned in cycles within this year only ──────────
// yearStartKey to yearEndKey = number of cycles in this year
const cyclesThisYear = yearEndKey - yearStartKey + 1;
// But cap by how many cycles employee has been active (from DOJ)
const dojCycle = getCycleForDate(dojDate, startDay);
const dojKey = getCycleNumber(dojCycle.cycleYear, dojCycle.cycleMonth);
const activeFromKey = Math.max(dojKey, yearStartKey);
const annualCLPool = Math.max(0, yearEndKey - activeFromKey + 1);

let totalCLUsedAllYear = 0;
for (const leave of existingLeaves) {
    totalCLUsedAllYear += leave.isSplit
        ? (leave.clDays || 0)
        : leave.totalDays;
}

const annualCLAvailable = Math.max(0, annualCLPool - totalCLUsedAllYear);

        // ── Split leave by cycles ─────────────────────────────────────────
        const leaveCycles = splitLeaveByCycles(startDate, endDate, startDay);

        let totalClDays = 0;
        let totalLopDays = 0;
        const cycleAllocations = [];

        for (const seg of leaveCycles) {
            const segCycleKey = getCycleNumber(seg.cycleYear, seg.cycleMonth);

            // CL already used in THIS cycle by other leaves
            let usedInThisCycle = 0;
            for (const leave of existingLeaves) {
                const lc = getCycleForDate(dayjs.utc(leave.startDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey === segCycleKey) {
                    usedInThisCycle += leave.isSplit
                        ? (leave.clDays || 0)
                        : leave.totalDays;
                }
            }

            // CL earned up to and including this segment's cycle
            const earnedUpToSeg = Math.min(
    calculateTotalCLEarned(dojDate, seg.cycleYear, seg.cycleMonth, startDay),
    annualCLPool
);

            // CL used in cycles BEFORE this one
            let usedBeforeThisCycle = 0;
            for (const leave of existingLeaves) {
                const lc = getCycleForDate(dayjs.utc(leave.startDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey < segCycleKey) {
                    usedBeforeThisCycle += leave.isSplit
                        ? (leave.clDays || 0)
                        : leave.totalDays;
                }
            }

            const cycleAvailable = Math.max(
                0,
                earnedUpToSeg - usedBeforeThisCycle - usedInThisCycle - totalClDays
            );

            const annualPoolRemaining = Math.max(0, annualCLAvailable - totalClDays);
            const availableForSeg = Math.min(cycleAvailable, annualPoolRemaining);
            const clForSeg = Math.min(seg.dayCount, availableForSeg);
            const lopForSeg = seg.dayCount - clForSeg;

            totalClDays += clForSeg;
            totalLopDays += lopForSeg;

            cycleAllocations.push({
                cycleKey: segCycleKey,
                cycleLabel: seg.cycleLabel,
                daysInCycle: seg.dayCount,
                clAllocated: clForSeg,
                lopAllocated: lopForSeg,
            });
        }

        totalClDays = parseFloat(totalClDays.toFixed(2));
        totalLopDays = parseFloat(totalLopDays.toFixed(2));
        const isSplit = totalClDays > 0 && totalLopDays > 0;

        let splitNote = null;
        if (isSplit) {
            splitNote = cycleAllocations.length > 1
                ? cycleAllocations.map(c =>
                    `${c.cycleLabel}: ${c.clAllocated} CL + ${c.lopAllocated} LOP`
                ).join('; ')
                : `${totalClDays} CL + ${totalLopDays} LOP`;
        }

        console.log('allocateCLForLeave result:', {
            requestedDays, totalClDays, totalLopDays, isSplit,
            annualCLPool, totalCLUsedAllYear, annualCLAvailable, cycleAllocations
        });

        return { clDays: totalClDays, lopDays: totalLopDays, isSplit, splitNote, cycleAllocations };

    } catch (error) {
        console.error('Error in allocateCLForLeave:', error);
        return { clDays: 0, lopDays: requestedDays, isSplit: false, splitNote: null, cycleAllocations: [] };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// getAvailableCL — snapshot for validation / display
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current CL balance as of a reference date.
 */
export const getAvailableCL = async (employeeId, doj, refDate, startDay, year) => {
    const dojDate = dayjs.utc(doj);
    const ref = dayjs.utc(refDate);
    const targetCycle = getCycleForDate(ref, startDay);

    const totalEarned = calculateTotalCLEarned(
        dojDate, targetCycle.cycleYear, targetCycle.cycleMonth, startDay
    );

    const fetchStart = dayjs.utc(`${year - 1}-12-01`).startOf('day').toDate();
    const fetchEnd = dayjs.utc(`${year + 1}-01-31`).endOf('day').toDate();

    const usedResult = await Leave.aggregate([
        {
            $match: {
                employee: employeeId,
                leaveType: 'CASUAL',
                status: { $in: ['APPROVED', 'PENDING'] },
                startDate: { $gte: fetchStart, $lte: fetchEnd },
            },
        },
        {
            $group: {
                _id: null,
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
        earned: totalEarned,
        used: parseFloat(totalUsed.toFixed(2)),
        remaining: Math.max(0, totalEarned - totalUsed),
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// calculateLeaveBalance — full balance summary
// ─────────────────────────────────────────────────────────────────────────────

export const calculateLeaveBalance = async (
    employeeId,
    isPermanentEmp = false,
    year = dayjs.utc().year(),
    referenceDate = null
) => {
    try {
        const policy = await LeavePolicy.findOne({ isActive: true }).lean();
        const startDay = policy?.salaryCycle?.startDay ?? 21;
        const slDaysPerYear = policy?.leaveTypes?.sick?.daysPerYear ?? 10;
        const maternityDays = policy?.leaveTypes?.maternity?.daysPerYear ?? 182;
        const paternityDays = policy?.leaveTypes?.paternity?.daysPerYear ?? 15;
        const maxPermHoursPerMonth = policy?.permissionLeave?.hoursPerMonth ?? 2;

        const ref = referenceDate ? dayjs.utc(referenceDate) : dayjs.utc();
        const employee = await Employee.findById(employeeId)
            .select('doj createdAt isPermanentEmp')
            .lean();


        if (!employee) throw new Error('Employee not found');

        const doj = employee.doj
            ? dayjs.utc(employee.doj)
            : dayjs.utc(employee.createdAt);

        const fetchStart = dayjs.utc(`${year - 1}-12-01`).startOf('day').toDate();
        const fetchEnd = dayjs.utc(`${year + 1}-01-31`).endOf('day').toDate();

        // AFTER — fetch ALL leave types for LOP calc:
        // REPLACE WITH — only leaves whose cycle belongs to this year:
const allCasualLeaves = await Leave.find({
    employee: employeeId,
    leaveType: 'CASUAL',
    status: { $in: ['APPROVED', 'PENDING'] },
}).lean();

const yearStartCycle = getCycleForDate(dayjs.utc(`${year}-01-01`), startDay);
const yearStartKey = getCycleNumber(yearStartCycle.cycleYear, yearStartCycle.cycleMonth);
const yearEndCycle = getCycleForDate(dayjs.utc(`${year}-12-20`), startDay);
const yearEndKey = getCycleNumber(yearEndCycle.cycleYear, yearEndCycle.cycleMonth);

const approvedLeaves = allCasualLeaves.filter(leave => {
    const lc = getCycleForDate(dayjs.utc(leave.startDate), startDay);
    const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
    return lcKey >= yearStartKey && lcKey <= yearEndKey;
});

        // Fetch LOP leaves separately
        const lopLeavesAll = await Leave.find({
            employee: employeeId,
            leaveType: 'LOP',
            status: { $in: ['APPROVED', 'PENDING'] },
        }).lean();

        // ── Current cycle ────────────────────────────────────────────────────
        const currentCycleMeta = getCycleForDate(ref, startDay);
        const currentCycleKey = getCycleNumber(currentCycleMeta.cycleYear, currentCycleMeta.cycleMonth);

        // ── Total CL earned now ──────────────────────────────────────────────
        const totalEarnedNow = calculateTotalCLEarned(
            doj, currentCycleMeta.cycleYear, currentCycleMeta.cycleMonth, startDay
        );

        // ── Total CL used globally ───────────────────────────────────────────
// REPLACE WITH — year-scoped pool is always max 12 (or fewer if new hire mid-year):
const decCycle = getCycleForDate(dayjs.utc(`${year}-12-20`), startDay);
const annualPool = calculateTotalCLEarned(doj, decCycle.cycleYear, decCycle.cycleMonth, startDay);
// annualPool now returns cycles from Jan of this year → Dec of this year (max 12)
        let clUsedTotal = 0;
        for (const leave of approvedLeaves) {
            clUsedTotal += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
        }
        // Cap used at annual pool (can't use more than 12)
        clUsedTotal = Math.min(clUsedTotal, annualPool);
        const clUsedEffective = Math.min(clUsedTotal, totalEarnedNow); // cap to what's earned today for display
        const clRemaining = Math.max(0, totalEarnedNow - clUsedEffective);
        const monthlyBreakdown = [];
        for (let m = 0; m <= 11; m++) {
            const probeDate = dayjs.utc(`${year}-${String(m + 1).padStart(2, '0')}-15`);
            const cycle = getCycleForDate(probeDate, startDay);
            const cycleKey = getCycleNumber(cycle.cycleYear, cycle.cycleMonth);

            const earnedUpTo = calculateTotalCLEarned(doj, cycle.cycleYear, cycle.cycleMonth, startDay);

            // CL used in cycles up to and including this one
            let usedUpToCycle = 0;
            for (const leave of approvedLeaves) {
                const leaveStartDate = dayjs.utc(leave.startDate).format('YYYY-MM-DD'); // normalize
                const lc = getCycleForDate(dayjs.utc(leaveStartDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey <= cycleKey) {
                    usedUpToCycle += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
                }
            }

            // CL used in exactly this cycle
            let usedInThisCycle = 0;
            for (const leave of approvedLeaves) {
                const leaveStartDate = dayjs.utc(leave.startDate).format('YYYY-MM-DD');
                const lc = getCycleForDate(dayjs.utc(leaveStartDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey === cycleKey) {
                    usedInThisCycle += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
                }
            }

            const isFuture = cycleKey > currentCycleKey;
            const isCurrent = cycleKey === currentCycleKey;
            // isEarned = DOJ has passed this cycle (even if future in calendar)
            const isEarned = earnedUpTo > 0;
            // REPLACE WITH:
            const usedUpToCycleCapped = Math.min(usedUpToCycle, earnedUpTo);
            // For future months: remaining = earnedUpTo (projected) minus used so far
            // For past/current: remaining = earned up to that cycle minus cumulative used
            const remainingUpTo = Math.max(0, earnedUpTo - usedUpToCycleCapped);
            monthlyBreakdown.push({
                month: probeDate.format('MMMM'),
                cycleLabel: cycle.cycleLabel,
                earned: earnedUpTo,
                usedThisCycle: parseFloat(usedInThisCycle.toFixed(2)),
                usedCumulative: parseFloat(usedUpToCycle.toFixed(2)),
                remaining: remainingUpTo,
                isFuture,
                isCurrent,
                isEarned: earnedUpTo > 0,
                quota: earnedUpTo > 0 ? 1 : 0,
            });
        }

        // ── Permission balance for current cycle ─────────────────────────────
        const permissionsThisCycle = await Permission.find({
            employee: employeeId,
            date: {
                $gte: currentCycleMeta.start.toDate(),
                $lte: currentCycleMeta.end.toDate(),
            },
            status: { $in: ['PENDING', 'APPROVED'] },
        }).lean();

        const permUsedHours = permissionsThisCycle.reduce((s, p) => s + (p.durationHours || 0), 0);
        const permRemainingHours = Math.max(0, maxPermHoursPerMonth - permUsedHours);

        // ── LOP days (this year) ─────────────────────────────────────────────
        // AFTER:
        const lopDaysTotal = lopLeavesAll.reduce((s, l) => s + l.totalDays, 0)
            + approvedLeaves.filter(l => l.isSplit).reduce((s, l) => s + (l.lopDays || 0), 0);
        // ── Build response ───────────────────────────────────────────────────
        // REPLACE WITH:
        const response = {
            year,
            doj: doj.format('YYYY-MM-DD'),
            salaryCycleStartDay: startDay,
            isPermanentEmployee: employee.isPermanentEmp || false,
            casual: {
                earnedThisYear: totalEarnedNow,
                annualPool: annualPool,
                usedThisYear: parseFloat(clUsedEffective.toFixed(2)),
                remainingThisYear: clRemaining,
                annualRemaining: Math.max(0, annualPool - clUsedTotal),
                policyNote: '1 CL per salary-cycle month from DOJ; unused days carry forward automatically',
                monthlyBreakdown: monthlyBreakdown,
            },
            lop: {
                days: parseFloat(lopDaysTotal.toFixed(2)),
            },
            permission: {
                hoursPerMonth: maxPermHoursPerMonth,
                usedThisCycle: parseFloat(permUsedHours.toFixed(2)),
                remainingThisCycle: parseFloat(permRemainingHours.toFixed(2)),
                maxPerRequest: 1,
                policyNote: `${maxPermHoursPerMonth} hrs/month; max 1 hr per request`,
            },
            currentCycle: {
                start: currentCycleMeta.start.format('YYYY-MM-DD'),
                end: currentCycleMeta.end.format('YYYY-MM-DD'),
                label: currentCycleMeta.cycleLabel,
            },
        };

        // Permanent-employee extras
        if (isPermanentEmp) {
            const permanentLeaves = await Leave.find({
                employee: employeeId,
                leaveType: { $in: ['SICK', 'MATERNITY', 'PATERNITY'] },
                status: { $in: ['APPROVED', 'PENDING'] },
            }).lean();
            const sickUsed = permanentLeaves.filter(l => l.leaveType === 'SICK').reduce((s, l) => s + l.totalDays, 0);
            const maternityUsed = permanentLeaves.filter(l => l.leaveType === 'MATERNITY').reduce((s, l) => s + l.totalDays, 0);
            const paternityUsed = permanentLeaves.filter(l => l.leaveType === 'PATERNITY').reduce((s, l) => s + l.totalDays, 0);
            response.sick = {
                total: slDaysPerYear,
                used: sickUsed,
                remaining: Math.max(0, slDaysPerYear - sickUsed),
                usedPercentage: Math.round((sickUsed / slDaysPerYear) * 100),
            };
            response.maternity = {
                total: maternityDays,
                used: maternityUsed,
                remaining: Math.max(0, maternityDays - maternityUsed),
            };
            response.paternity = {
                total: paternityDays,
                used: paternityUsed,
                remaining: Math.max(0, paternityDays - paternityUsed),
            };
        }

        return response;

    } catch (error) {
        console.error('Error in calculateLeaveBalance:', error);
        throw error;
    }
};