// utils/leaveBalanceHelper.js
import Leave from '../model/Leave.js';
import LeavePolicy from '../model/LeavePolicy.js';

/**
 * Get the quarterly CL quota for the current month within the quarter.
 *
 * CL = 12 days/year = 3 days/quarter.
 * Within a quarter, unused days from earlier months carry forward:
 *   Month 1 of quarter (Jan/Apr/Jul/Oct) → quota = 1
 *   Month 2 of quarter (Feb/May/Aug/Nov) → quota = 2
 *   Month 3 of quarter (Mar/Jun/Sep/Dec) → quota = 3
 *
 * On the first day of a new quarter the counter resets to 1,
 * regardless of how many CL days were unused in the previous quarter.
 *
 * When the annual policy is not 12, we scale proportionally:
 *   e.g. 6 days/year → 1.5 days/quarter → 0.5 / 1.0 / 1.5 per month
 */
export const getCLQuotaForCurrentQuarter = (clDaysPerYear = 12) => {
    const now             = new Date();
    const month           = now.getMonth();       // 0-indexed (0 = Jan)
    const monthInQuarter  = month % 3;             // 0, 1, or 2
    const daysPerQuarter  = clDaysPerYear / 4;     // e.g. 12/4 = 3
    const daysPerMonth    = daysPerQuarter / 3;    // e.g. 3/3  = 1

    // cumulative quota up to and including the current month in this quarter
    return parseFloat(((monthInQuarter + 1) * daysPerMonth).toFixed(2));
};

/**
 * Get the start of the current quarter
 */
export const getCurrentQuarterStart = () => {
    const now = new Date();
    const month = now.getMonth();
    const quarterStartMonth = Math.floor(month / 3) * 3;
    return new Date(now.getFullYear(), quarterStartMonth, 1);
};

export const getCurrentQuarterEnd = () => {
    const now = new Date();
    const month = now.getMonth();
    const quarterEndMonth = Math.floor(month / 3) * 3 + 2;
    return new Date(now.getFullYear(), quarterEndMonth + 1, 0, 23, 59, 59, 999);
};

// ─── Salary cycle helpers (21st prev month → 20th current month) ─────────────
// ─── Salary cycle helpers (HR-configured start day, default 21) ──────────────
export const getCurrentSalaryCycleStart = (startDay = 21) => {
    const now = new Date();
    if (now.getDate() >= startDay) {
        return new Date(now.getFullYear(), now.getMonth(), startDay, 0, 0, 0, 0);
    }
    return new Date(now.getFullYear(), now.getMonth() - 1, startDay, 0, 0, 0, 0);
};

export const getCurrentSalaryCycleEnd = (startDay = 21) => {
    const start = getCurrentSalaryCycleStart(startDay);
    // end = (startDay - 1) of the month after start
    return new Date(start.getFullYear(), start.getMonth() + 1, startDay - 1, 23, 59, 59, 999);
};

/**
 * Returns the quarter number (1–4) for the current date.
 */
export const getCurrentQuarterNumber = () => {
    return Math.ceil((new Date().getMonth() + 1) / 3);
};

/**
 * Returns the quarter label string, e.g. "Q2 2025".
 */
export const getCurrentQuarterLabel = (year = new Date().getFullYear()) => {
    return `Q${getCurrentQuarterNumber()} ${year}`;
};

/**
 * Calculate how many CL days are still available this quarter for an employee.
 * This is the value used by createLeaveRequest to decide how many days to
 * allocate as CL vs LOP when the request spans the boundary.
 *
 * @param {ObjectId} employeeId
 * @param {Number}   clDaysPerYear  — from the active policy (default 12)
 * @returns {Number} remaining CL days (may be fractional, e.g. 0.5)
 */
export const getCLRemainingThisQuarter = async (employeeId, clDaysPerYear = 12) => {
    const qStart = getCurrentQuarterStart();
    const qEnd   = getCurrentQuarterEnd();
    const quota  = getCLQuotaForCurrentQuarter(clDaysPerYear);

    const approvedCLThisQuarter = await Leave.find({
        employee:  employeeId,
        leaveType: 'CASUAL',
        status:    'APPROVED',
        startDate: { $gte: qStart, $lte: qEnd }
    }).lean();

    const used = approvedCLThisQuarter.reduce((sum, l) => sum + l.totalDays, 0);

    return Math.max(0, parseFloat((quota - used).toFixed(2)));
};

/**
 * Full leave balance calculation for an employee.
 *
 * @param {ObjectId} employeeId
 * @param {Boolean}  isPermanentEmp
 * @param {Number}   year
 * @returns {Object} balance object
 */
export const calculateLeaveBalance = async (
    employeeId,
    isPermanentEmp = false,
    year = new Date().getFullYear()
) => {
    // ── Fetch active policy ───────────────────────────────────────────────
    const policy = await LeavePolicy.findOne({ isActive: true }).lean();

    const clDaysPerYear = policy?.leaveTypes?.casual?.daysPerYear    ?? 12;
    const slDaysPerYear = policy?.leaveTypes?.sick?.daysPerYear       ?? 10;
    const maternityDays = policy?.leaveTypes?.maternity?.daysPerYear  ?? 182;
    const paternityDays = policy?.leaveTypes?.paternity?.daysPerYear  ?? 15;

    // ── Fetch all approved leaves for the year ────────────────────────────
    const startOfYear = new Date(year, 0,  1,  0,  0,  0,   0);
    const endOfYear   = new Date(year, 11, 31, 23, 59, 59, 999);

const approvedLeaves = await Leave.find({
        employee:  employeeId,
        status:    'APPROVED',
    }).lean();

    // ── CL — current quarter only ─────────────────────────────────────────
    const qStart = getCurrentQuarterStart();
    const qEnd   = getCurrentQuarterEnd();
    const clQuota = getCLQuotaForCurrentQuarter(clDaysPerYear);

    const clUsedThisQuarter = approvedLeaves
        .filter(l =>
            l.leaveType === 'CASUAL' &&
            new Date(l.startDate) >= qStart &&
            new Date(l.startDate) <= qEnd
        )
        .reduce((sum, l) => sum + l.totalDays, 0);

    const clRemainingRaw   = clQuota - clUsedThisQuarter;
    const clRemaining      = Math.max(0, parseFloat(clRemainingRaw.toFixed(2)));

    // Total CL used this entire year (all quarters)
const clUsedThisYear = approvedLeaves
        .filter(l => l.leaveType === 'CASUAL' &&
            new Date(l.startDate) >= startOfYear &&
            new Date(l.startDate) <= endOfYear)
        .reduce((sum, l) => sum + l.totalDays, 0);
    // ── LOP — full year ───────────────────────────────────────────────────
   // In calculateLeaveBalance — replace the LOP count section

// LOP count — includes both explicit LOP leaves AND the LOP portion of split CL leaves
const explicitLopDays = approvedLeaves
    .filter(l => l.leaveType === 'LOP' &&
        new Date(l.startDate) >= startOfYear &&
        new Date(l.startDate) <= endOfYear)
    .reduce((sum, l) => sum + l.totalDays, 0);

const splitLopDays = approvedLeaves
    .filter(l => l.isSplit && l.lopDays > 0 &&
        new Date(l.startDate) >= startOfYear &&
        new Date(l.startDate) <= endOfYear)
    .reduce((sum, l) => sum + (l.lopDays || 0), 0);

const lopDays = parseFloat((explicitLopDays + splitLopDays).toFixed(2));

    // ── Permanent-only leave types ────────────────────────────────────────
let slUsed = 0, maternityUsed = 0, paternityUsed = 0;
    if (isPermanentEmp) {
        slUsed = approvedLeaves
            .filter(l =>
                l.leaveType === 'SICK' &&
                new Date(l.startDate) >= startOfYear &&
                new Date(l.startDate) <= endOfYear
            )
            .reduce((sum, l) => sum + l.totalDays, 0);

        maternityUsed = approvedLeaves
            .filter(l => l.leaveType === 'MATERNITY')
            .reduce((sum, l) => sum + l.totalDays, 0);

        paternityUsed = approvedLeaves
            .filter(l => l.leaveType === 'PATERNITY')
            .reduce((sum, l) => sum + l.totalDays, 0);
    }
    // ── Assemble balance object ───────────────────────────────────────────
    const balance = {
        casual: {
            // Current quarter
            quotaThisQuarter:     clQuota,
            usedThisQuarter:      parseFloat(clUsedThisQuarter.toFixed(2)),
            remainingThisQuarter: clRemaining,

            // Flag: employee has gone over their quarterly quota
            // (can happen if HR manually approved leaves that exceeded quota)
            isLOP: clRemainingRaw < 0,

            // Annual summary (informational)
            annualTotal:    clDaysPerYear,
            usedThisYear:   parseFloat(clUsedThisYear.toFixed(2)),

            // Policy description for the UI
            policyNote: `${clDaysPerYear} days/year • ${clDaysPerYear / 4} days/quarter • resets each quarter`
        },

        lop: {
            days: lopDays,
            note: 'Loss of Pay — leaves beyond available quota'
        }
    };

    // ── Sick / Maternity / Paternity (permanent employees only) ──────────
    if (isPermanentEmp) {
        const slUsedPct = slDaysPerYear > 0
            ? Math.min(100, Math.round((slUsed / slDaysPerYear) * 100))
            : 0;

        balance.sick = {
            total:          slDaysPerYear,
            used:           parseFloat(slUsed.toFixed(2)),
            remaining:      Math.max(0, parseFloat((slDaysPerYear - slUsed).toFixed(2))),
            usedPercentage: slUsedPct,
            policyNote:     `${slDaysPerYear} days/year — HR may adjust at any time`
        };

balance.maternity = {
            total:          maternityDays,
            used:           parseFloat(maternityUsed.toFixed(2)),
            remaining:      Math.max(0, parseFloat((maternityDays - maternityUsed).toFixed(2))),
            usedPercentage: maternityDays > 0 ? Math.min(100, Math.round((maternityUsed / maternityDays) * 100)) : 0,
            note:           'As per Maternity Benefit Act (26 weeks)'
        };

        balance.paternity = {
            total:          paternityDays,
            used:           parseFloat(paternityUsed.toFixed(2)),
            remaining:      Math.max(0, parseFloat((paternityDays - paternityUsed).toFixed(2))),
            usedPercentage: paternityDays > 0 ? Math.min(100, Math.round((paternityUsed / paternityDays) * 100)) : 0,
            note:           'As per local law'
        };
    }

    return balance;
};