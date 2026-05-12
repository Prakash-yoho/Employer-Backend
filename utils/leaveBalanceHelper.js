
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
export const calculateTotalCLEarned = (dojDate, targetCycleYear, targetCycleMonth, startDay = 21) => {
    const doj = dayjs.utc(dojDate);
    const dojCycle = getCycleForDate(doj, startDay);

    const dojKey = getCycleNumber(dojCycle.cycleYear, dojCycle.cycleMonth);
    const targetKey = getCycleNumber(targetCycleYear, targetCycleMonth);

    if (targetKey < dojKey) return 0;
    return targetKey - dojKey + 1;
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

        // Load ALL existing CASUAL leaves (approved/pending) for a broad window
        const fetchStart = dayjs.utc(`${year - 1}-12-01`).startOf('day').toDate();
        const fetchEnd = dayjs.utc(`${year + 1}-01-31`).endOf('day').toDate();

        const matchQuery = {
            employee: employeeId,
            leaveType: 'CASUAL',
            status: { $in: ['APPROVED', 'PENDING'] },
            startDate: { $gte: fetchStart, $lte: fetchEnd },
        };
        if (excludeLeaveId) {
            matchQuery._id = { $ne: excludeLeaveId };
        }
        const existingLeaves = await Leave.find(matchQuery).lean();

        // Split the requested leave by cycle
        const leaveCycles = splitLeaveByCycles(startDate, endDate, startDay);

        let totalClDays = 0;
        let totalLopDays = 0;
        const cycleAllocations = [];

        for (const seg of leaveCycles) {
            // CL earned UP TO AND INCLUDING this segment's cycle
            const leaveCycle = getCycleForDate(dayjs.utc(endDate), startDay);
            const leaveCycleKey = getCycleNumber(leaveCycle.cycleYear, leaveCycle.cycleMonth);
            const segCycleKey = getCycleNumber(seg.cycleYear, seg.cycleMonth);

            // Use the smaller of: this segment's cycle vs leave end cycle
            // (never count CL beyond what's earned by the leave end date)
            const effectiveCycleYear = segCycleKey <= leaveCycleKey ? seg.cycleYear : leaveCycle.cycleYear;
            const effectiveCycleMonth = segCycleKey <= leaveCycleKey ? seg.cycleMonth : leaveCycle.cycleMonth;

            const earnedUpToNow = calculateTotalCLEarned(
                dojDate, effectiveCycleYear, effectiveCycleMonth, startDay
            );

            // CL already used in cycles STRICTLY BEFORE this segment's cycle
            let usedBeforeThisCycle = 0;
            for (const leave of existingLeaves) {
                if (leave.leaveType !== 'CASUAL') continue;
                const lc = getCycleForDate(dayjs.utc(leave.startDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey < seg.cycleKey) {
                    usedBeforeThisCycle += leave.isSplit
                        ? (leave.clDays || 0)
                        : leave.totalDays;
                }
            }

            // CL already used IN this cycle (by other leaves, not this one)
            let usedInThisCycle = 0;
            for (const leave of existingLeaves) {
                if (leave.leaveType !== 'CASUAL') continue;
                const lc = getCycleForDate(dayjs.utc(leave.startDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey === seg.cycleKey) {
                    usedInThisCycle += leave.isSplit
                        ? (leave.clDays || 0)
                        : leave.totalDays;
                }
            }

            // Available for this specific cycle segment:
            //   total earned up to this cycle  –  used before this cycle  –  used in this cycle
            const alreadyConsumed = usedBeforeThisCycle + usedInThisCycle + totalClDays; // totalClDays = CL already allocated to earlier segments of THIS leave
            const globalAvailable = Math.max(0, earnedUpToNow - alreadyConsumed + totalClDays);
            // Re-derive: available = earnedUpToNow - usedBeforeThisCycle - usedInThisCycle - clAllocatedToPriorSegments
            const clAllocatedPrior = totalClDays;
            const availableForSeg = Math.max(0, earnedUpToNow - usedBeforeThisCycle - usedInThisCycle - clAllocatedPrior);

            const clForSeg = Math.min(seg.dayCount, availableForSeg);
            const lopForSeg = seg.dayCount - clForSeg;

            totalClDays += clForSeg;
            totalLopDays += lopForSeg;

            cycleAllocations.push({
                cycleKey: seg.cycleKey,
                cycleLabel: seg.cycleLabel,
                daysInCycle: seg.dayCount,
                clAllocated: clForSeg,
                lopAllocated: lopForSeg,
            });
        }

        totalClDays = parseFloat(totalClDays.toFixed(2));
        totalLopDays = parseFloat(totalLopDays.toFixed(2));
        const isSplit = totalClDays > 0 && totalLopDays > 0;

        // Build splitNote
        let splitNote = null;
        if (isSplit) {
            if (cycleAllocations.length > 1) {
                splitNote = cycleAllocations
                    .map(c => `${c.cycleLabel}: ${c.clAllocated} CL + ${c.lopAllocated} LOP`)
                    .join('; ');
            } else {
                splitNote = `${totalClDays} CL + ${totalLopDays} LOP`;
            }
        }

        console.log('allocateCLForLeave result:', {
            requestedDays, totalClDays, totalLopDays, isSplit, cycleAllocations
        });

        return {
            clDays: totalClDays,
            lopDays: totalLopDays,
            isSplit,
            splitNote,
            cycleAllocations,
        };

    } catch (error) {
        console.error('Error in allocateCLForLeave:', error);
        return {
            clDays: 0,
            lopDays: requestedDays,
            isSplit: false,
            splitNote: null,
            cycleAllocations: [],
        };
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

        const approvedLeaves = await Leave.find({
            employee: employeeId,
            status: { $in: ['APPROVED', 'PENDING'] },
            startDate: { $gte: fetchStart, $lte: fetchEnd },
        }).lean();

        // ── Current cycle ────────────────────────────────────────────────────
        const currentCycleMeta = getCycleForDate(ref, startDay);
        const currentCycleKey = getCycleNumber(currentCycleMeta.cycleYear, currentCycleMeta.cycleMonth);

        // ── Total CL earned now ──────────────────────────────────────────────
        const totalEarnedNow = calculateTotalCLEarned(
            doj, currentCycleMeta.cycleYear, currentCycleMeta.cycleMonth, startDay
        );

        // ── Total CL used globally ───────────────────────────────────────────
        let clUsedTotal = 0;
        for (const leave of approvedLeaves) {
            if (leave.leaveType !== 'CASUAL') continue;
            clUsedTotal += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
        }
        const clRemaining = Math.max(0, totalEarnedNow - clUsedTotal);

        // ── Monthly breakdown (one entry per calendar month) ─────────────────
        const monthlyBreakdown = [];
        for (let m = 0; m <= 11; m++) {
            const probeDate = dayjs.utc(`${year}-${String(m + 1).padStart(2, '0')}-15`);
            const cycle = getCycleForDate(probeDate, startDay);
            const cycleKey = getCycleNumber(cycle.cycleYear, cycle.cycleMonth);

            const earnedUpTo = calculateTotalCLEarned(doj, cycle.cycleYear, cycle.cycleMonth, startDay);

            // CL used across all cycles up to and including this one
            let usedUpToCycle = 0;
            for (const leave of approvedLeaves) {
                if (leave.leaveType !== 'CASUAL') continue;
                const lc = getCycleForDate(dayjs.utc(leave.startDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey <= cycleKey) {
                    usedUpToCycle += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
                }
            }

            // CL used in exactly this cycle
            let usedInThisCycle = 0;
            for (const leave of approvedLeaves) {
                if (leave.leaveType !== 'CASUAL') continue;
                const lc = getCycleForDate(dayjs.utc(leave.startDate), startDay);
                const lcKey = getCycleNumber(lc.cycleYear, lc.cycleMonth);
                if (lcKey === cycleKey) {
                    usedInThisCycle += leave.isSplit ? (leave.clDays || 0) : leave.totalDays;
                }
            }

            const isFuture = cycleKey > currentCycleKey;
            const isCurrent = cycleKey === currentCycleKey;
            const isEarned = earnedUpTo > 0 && !isFuture;

            // Remaining = total earned up to this cycle − total used up to this cycle
            const remainingUpTo = Math.max(0, earnedUpTo - usedUpToCycle);

            monthlyBreakdown.push({
                month: probeDate.format('MMMM'),
                cycleLabel: cycle.cycleLabel,
                earned: earnedUpTo,          // cumulative
                usedThisCycle: parseFloat(usedInThisCycle.toFixed(2)),
                usedCumulative: parseFloat(usedUpToCycle.toFixed(2)),
                remaining: remainingUpTo,        // balance after using all prior
                isFuture,
                isCurrent,
                isEarned,
                quota: isEarned ? 1 : 0,     // 1 CL unlocked per cycle month
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
        const lopLeaves = approvedLeaves.filter(l => l.leaveType === 'LOP');
        const lopDaysTotal = lopLeaves.reduce((s, l) => s + l.totalDays, 0)
            + approvedLeaves.filter(l => l.isSplit).reduce((s, l) => s + (l.lopDays || 0), 0);

        // ── Build response ───────────────────────────────────────────────────
        const response = {
            year,
            doj: doj.format('YYYY-MM-DD'),
            salaryCycleStartDay: startDay,
            isPermanentEmployee: employee.isPermanentEmp || false,
            casual: {
                earnedThisYear: totalEarnedNow,
                usedThisYear: parseFloat(clUsedTotal.toFixed(2)),
                remainingThisYear: clRemaining,
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
            const sickUsed = approvedLeaves.filter(l => l.leaveType === 'SICK').reduce((s, l) => s + l.totalDays, 0);
            const maternityUsed = approvedLeaves.filter(l => l.leaveType === 'MATERNITY').reduce((s, l) => s + l.totalDays, 0);
            const paternityUsed = approvedLeaves.filter(l => l.leaveType === 'PATERNITY').reduce((s, l) => s + l.totalDays, 0);

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