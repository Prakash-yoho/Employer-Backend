// utils/leaveBalanceHelper.js
import Leave from '../model/Leave.js';
import LeavePolicy from '../model/LeavePolicy.js';

/**
 * Get the quarterly CL quota for a given quarter (1-based: Q1=1, Q2=2...)
 * CL is 12/year = 3 per quarter, but unused days from previous months
 * within the same quarter carry forward within that quarter only.
 * Example: Jan quota = 1 (month 1 of Q1), Feb quota = 2 (months 1-2), Mar quota = 3
 * On Apr 1 (Q2 start), resets to 1 regardless of Q1 usage.
 */
export const getCLQuotaForCurrentQuarter = () => {
    const now = new Date();
    const month = now.getMonth(); // 0-indexed
    const monthInQuarter = month % 3; // 0, 1, or 2
    return monthInQuarter + 1; // 1, 2, or 3
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

/**
 * Get the end of the current quarter
 */
export const getCurrentQuarterEnd = () => {
    const now = new Date();
    const month = now.getMonth();
    const quarterEndMonth = Math.floor(month / 3) * 3 + 2;
    return new Date(now.getFullYear(), quarterEndMonth + 1, 0, 23, 59, 59, 999);
};

/**
 * Calculate leave balance for an employee
 * @param {ObjectId} employeeId 
 * @param {Boolean} isPermanentEmp
 * @param {Number} year
 */
export const calculateLeaveBalance = async (employeeId, isPermanentEmp = false, year = new Date().getFullYear()) => {
    // Get active policy
    const policy = await LeavePolicy.findOne({ isActive: true }).lean();

    const clDaysPerYear = policy?.leaveTypes?.casual?.daysPerYear ?? 12;
    const slDaysPerYear = policy?.leaveTypes?.sick?.daysPerYear ?? 10;
    const maternityDays = policy?.leaveTypes?.maternity?.daysPerYear ?? 182;
    const paternityDays = policy?.leaveTypes?.paternity?.daysPerYear ?? 15;

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

    // Get all approved leaves this year
    const approvedLeaves = await Leave.find({
        employee: employeeId,
        status: 'APPROVED',
        startDate: { $gte: startOfYear, $lte: endOfYear }
    }).lean();

    // CL: count used in current quarter only
    const qStart = getCurrentQuarterStart();
    const qEnd = getCurrentQuarterEnd();
    const clQuota = getCLQuotaForCurrentQuarter(); // available days in current quarter

    const clUsedThisQuarter = approvedLeaves
        .filter(l => l.leaveType === 'CASUAL' && new Date(l.startDate) >= qStart && new Date(l.startDate) <= qEnd)
        .reduce((sum, l) => sum + l.totalDays, 0);

    // SL, Maternity, Paternity — only for permanent employees
    let slUsed = 0, maternityUsed = 0, paternityUsed = 0;
    if (isPermanentEmp) {
        slUsed = approvedLeaves.filter(l => l.leaveType === 'SICK').reduce((sum, l) => sum + l.totalDays, 0);
        maternityUsed = approvedLeaves.filter(l => l.leaveType === 'MATERNITY').reduce((sum, l) => sum + l.totalDays, 0);
        paternityUsed = approvedLeaves.filter(l => l.leaveType === 'PATERNITY').reduce((sum, l) => sum + l.totalDays, 0);
    }

    // LOP count
    const lopDays = approvedLeaves.filter(l => l.leaveType === 'LOP').reduce((sum, l) => sum + l.totalDays, 0);

    const balance = {
        casual: {
            quotaThisQuarter: clQuota,
            usedThisQuarter: clUsedThisQuarter,
            remainingThisQuarter: Math.max(0, clQuota - clUsedThisQuarter),
            isLOP: clUsedThisQuarter > clQuota,
            annualTotal: clDaysPerYear
        },
        lop: {
            days: lopDays,
            note: 'Loss of Pay — leaves beyond available quota'
        }
    };

    if (isPermanentEmp) {
        balance.sick = {
            total: slDaysPerYear,
            used: slUsed,
            remaining: Math.max(0, slDaysPerYear - slUsed),
            usedPercentage: Math.round((slUsed / slDaysPerYear) * 100)
        };
        balance.maternity = {
            total: maternityDays,
            used: maternityUsed,
            remaining: Math.max(0, maternityDays - maternityUsed),
            note: 'As per Maternity Benefit Act'
        };
        balance.paternity = {
            total: paternityDays,
            used: paternityUsed,
            remaining: Math.max(0, paternityDays - paternityUsed),
            note: 'As per local law'
        };
    }

    return balance;
};