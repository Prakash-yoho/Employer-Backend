import Leave from '../model/Leave.js';
import Permission from '../model/Permission.js';
import Employee from '../model/Employee.js';
import EmployerUser from '../model/EmployerUser.js';
import Notification from '../model/Notification.js';
import LeavePolicy from '../model/LeavePolicy.js';
import Holiday from '../model/Holiday.js';
import { sendMail } from '../utils/mailer.js';
import { leaveEmailTemplate } from '../utils/emailTemplates.js';
import {
    calculateLeaveBalance,
    // getCLQuotaForCurrentQuarter,
    // getCurrentQuarterStart,
    // getCurrentQuarterEnd,
    getCyclePeriodForDate,
    getCycleQuarterForDate
} from '../utils/leaveBalanceHelper.js';
import {
    createLeaveValidation,
    updateLeaveStatusValidation,
    getLeavesQueryValidation,
    createPermissionValidation,
    updatePermissionStatusValidation,
    createLeavePolicyValidation,
    updateLeavePolicyValidation,
    createHolidayValidation,
    updateHolidayValidation,
    leaveStatsValidation,
    leaveBalanceValidation
} from '../validations/leaveValidation.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);

import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(isSameOrBefore);

// ─── Validation helper ────────────────────────────────────────────────────────

const validateRequest = (schema, data) => {
    const { error, value } = schema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
    if (error) {
        return {
            isValid: false,
            errors: error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message.replace(/['"]/g, ''),
                type: d.type
            }))
        };
    }
    return { isValid: true, data: value };
};

// ─── Format helpers ───────────────────────────────────────────────────────────

const formatLeaveType = (t) => {
    const map = {
        CASUAL: 'Casual Leave',
        SICK: 'Sick Leave',
        MATERNITY: 'Maternity Leave',
        PATERNITY: 'Paternity Leave',
        LOP: 'Loss of Pay'
    };
    return map[t] || t;
};

const formatDuration = (d) => ({
    FULL_DAY: 'Full Day',
    FIRST_HALF: 'First Half',
    SECOND_HALF: 'Second Half'
}[d] || d);

const formatStatus = (s) => ({
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled'
}[s] || s);

// ─── Date helper ──────────────────────────────────────────────────────────────

const parseUTCDate = (input) => {
    if (!input) return null;
    return dayjs.utc(input).startOf('day').toDate();
};

const formatUTCDate = (date) => {
    if (!date) return null;
    return dayjs.utc(date).format('YYYY-MM-DD');
};

// ─── EMPLOYEE: Leave ──────────────────────────────────────────────────────────









// ─── Internal helpers for leave creation ─────────────────────────────────────

/**
 * Creates a single Leave document
 */
const createSingleLeave = async ({
    validatedData,
    startDateObj,
    endDateObj,
    totalDays,
    leaveType,
    employee,
    userId
}) => {
    const requestId = await Leave.generateRequestId();

    const leaveRequest = new Leave({
        requestId,
        leaveType,
        leaveDuration: validatedData.leaveDuration,
        startDate: startDateObj,
        endDate: endDateObj,
        reason: validatedData.reason,
        totalDays,
        employee: userId,
        employeeId: employee.employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        department: employee.department,
        designation: employee.designation,
        employeeEmail: employee.officialEmail
    });

    await leaveRequest.save();
    return leaveRequest;
};

/**
 * Notifies all active HR/Admin users about a new leave request
 */
const notifyHRAdmins = async (leaveRequest, employee, totalDays, senderId) => {
    const hrAdmins = await EmployerUser.find({
        role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
        isActive: true
    });

    for (const hrAdmin of hrAdmins) {
        if (hrAdmin.role === 'EMPLOYER_HR') {
            sendMail({
                to: hrAdmin.email,
                subject: `New Leave Request - ${employee.firstName} ${employee.lastName} (${leaveRequest.requestId})`,
                html: leaveEmailTemplate('REQUEST_TO_HR', leaveRequest)
            }).catch(err => console.error('Email error:', err));
        }

        await Notification.create({
            title: 'New Leave Request',
            description: `${employee.firstName} ${employee.lastName} has requested ${formatLeaveType(leaveRequest.leaveType)} for ${totalDays} day(s)`,
            type: 'LEAVE_REQUEST',
            recipientType: hrAdmin.role,
            recipientId: hrAdmin._id,
            recipientModel: 'EmployerUser',
            senderId,
            senderModel: 'Employee',
            relatedEntityType: 'Leave',
            relatedEntityId: leaveRequest._id,
            status: 'unread',
            priority: 'medium',
            metadata: {
                requestId: leaveRequest.requestId,
                leaveType: leaveRequest.leaveType,
                employeeName: leaveRequest.employeeName
            }
        });
    }
};

/**
 * Formats a leave document for API response
 */
const formatLeaveResponse = (leave) => ({
    requestId: leave.requestId,
    leaveType: formatLeaveType(leave.leaveType),
    leaveDuration: formatDuration(leave.leaveDuration),
    startDate: formatUTCDate(leave.startDate),
    endDate: formatUTCDate(leave.endDate),
    totalDays: leave.totalDays,
    status: 'Pending',
    appliedAt: leave.appliedAt,
    reason: leave.reason,
    isLOP: leave.leaveType === 'LOP'
});




/**
 * POST /api/leaves
 * Single leave request with correct CL + LOP day tracking
 */
export const createLeaveRequest = async (req, res) => {
    try {
        const user = req.user;

        const validation = validateRequest(createLeaveValidation, req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const validatedData = validation.data;

        const employee = await Employee.findById(user._id)
            .select('employeeId firstName lastName department designation officialEmail isPermanentEmp')
            .lean();
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        const isPermanent = employee.isPermanentEmp || false;

        // ── Eligibility check ─────────────────────────────────────────────
        if (['SICK', 'MATERNITY', 'PATERNITY'].includes(validatedData.leaveType) && !isPermanent) {
            return res.status(403).json({
                success: false,
                message: `${formatLeaveType(validatedData.leaveType)} is only available for permanent employees`
            });
        }

        // ── Overlap check ─────────────────────────────────────────────────
        const overlappingLeave = await Leave.checkOverlap(
            user._id,
            validatedData.startDate,
            validatedData.endDate,
            validatedData.leaveDuration
        );
        if (overlappingLeave) {
            const durLabel =
                overlappingLeave.leaveDuration === 'FULL_DAY' ? 'full day' :
                    overlappingLeave.leaveDuration === 'FIRST_HALF' ? 'first half' : 'second half';
            return res.status(400).json({
                success: false,
                message: `You already have a ${durLabel} leave for these dates`,
                conflictingLeave: {
                    requestId: overlappingLeave.requestId,
                    leaveDuration: formatDuration(overlappingLeave.leaveDuration),
                    startDate: formatUTCDate(overlappingLeave.startDate),
                    endDate: formatUTCDate(overlappingLeave.endDate),
                    status: formatStatus(overlappingLeave.status)
                }
            });
        }

        // ── Calculate dates and total days ────────────────────────────────
        const startDateObj = parseUTCDate(validatedData.startDate);
        const endDateObj = validatedData.leaveDuration !== 'FULL_DAY'
            ? parseUTCDate(validatedData.startDate)
            : parseUTCDate(validatedData.endDate);

        const requestedDays = validatedData.leaveDuration !== 'FULL_DAY'
            ? 0.5
            : Math.floor((endDateObj - startDateObj) / (1000 * 3600 * 24)) + 1;

        // ── Determine leaveType, clDays, lopDays ──────────────────────────
        let finalLeaveType = validatedData.leaveType;
        let clDays = 0;
        let lopDays = 0;
        let isSplit = false;
        let splitNote = null;
        let successMessage = 'Leave request submitted successfully';

        // ════════════════════════════════════════════════════════════════
        // CASUAL LEAVE — Cross-quarter aware CL calculation
        // ════════════════════════════════════════════════════════════════
        if (validatedData.leaveType === 'CASUAL') {

            // ── Fetch policy for startDay ─────────────────────────────────
            const policy = await LeavePolicy.findOne({ isActive: true }).lean();
            const startDay = policy?.salaryCycle?.startDay ?? 1;

            // ── Step 1: Build a list of each day in the leave range ───────
            // For half-day: only 1 day (0.5), treat as single day in startDate's quarter
            if (validatedData.leaveDuration !== 'FULL_DAY') {
                // ── Half day — single quarter, simple check ───────────────
                const balance = await calculateLeaveBalance(
                    user._id,
                    isPermanent,
                    startDateObj.getFullYear(),

                    startDateObj  // ✅ use startDate
                );


                const clRemaining = Math.max(
                    0,
                    parseFloat((balance.casual.remainingThisQuarter ?? 0).toFixed(2))
                );

                if (clRemaining >= 0.5) {
                    finalLeaveType = 'CASUAL';
                    clDays = 0.5;
                    lopDays = 0;
                } else {
                    finalLeaveType = 'LOP';
                    clDays = 0;
                    lopDays = 0.5;
                    successMessage = 'No CL quota remaining. Half day applied as Loss of Pay (LOP).';
                }

            } else {
                // ── Full day leave — may span multiple quarters ───────────

                // Step 2: Walk each day and group by quarter
                const quarterGroups = {}; // key = "Q2-2026", value = { days, quarterNum, quarterYear, firstDate }

                let current = dayjs.utc(startDateObj);
                const end = dayjs.utc(endDateObj);

                while (current.isSameOrBefore(end, 'day')) {
                    const qInfo = getCycleQuarterForDate(current.toDate(), startDay);
                    const key = qInfo.quarterLabel;
                    if (!quarterGroups[key]) {
                        quarterGroups[key] = {
                            days: 0,
                            quarterNumber: qInfo.quarterNumber,
                            quarterLabel: qInfo.quarterLabel,
                            firstDate: current.toDate(), // first day of leave in this quarter
                            quarterStart: qInfo.start,
                            quarterEnd: qInfo.end
                        };
                    }
                    quarterGroups[key].days++;
                    current = current.add(1, 'day');
                }

                // Step 3: For each quarter group, check available CL
                let totalCLGranted = 0;

                for (const [key, group] of Object.entries(quarterGroups)) {
                    // Get balance using the FIRST day of leave in this quarter
                    // This correctly identifies the quarter and its full unlocked quota
                    const balance = await calculateLeaveBalance(
                        user._id,
                        isPermanent,
                        dayjs.utc(group.firstDate).year(),
                        group.firstDate  // ✅ use first day of leave in this quarter
                    );

                    const today = dayjs.utc();
                    const isCurrentQuarter =
                        balance.currentQuarter.quarterNumber === group.quarterNumber &&
                        balance.currentQuarter.quarterLabel === group.quarterLabel;

                    let clAvailableInQuarter;

                    if (isCurrentQuarter) {
                        // Current quarter: use remaining (already accounts for used days)
                        clAvailableInQuarter = Math.max(
                            0,
                            parseFloat((balance.casual.remainingThisQuarter ?? 0).toFixed(2))
                        );
                    } else {
                        // Future quarter: full quota available (nothing used yet)
                        // BUT we need to subtract any already-pending/approved leaves in that quarter
                        clAvailableInQuarter = Math.max(
                            0,
                            parseFloat((balance.casual.quotaThisQuarter - balance.casual.usedThisQuarter).toFixed(2))
                        );
                    }

                    // How many CL can we grant from this quarter?
                    const clFromThisQuarter = Math.min(group.days, clAvailableInQuarter);
                    totalCLGranted += clFromThisQuarter;

                    console.log(`[CL Calc] ${key}: need=${group.days}, available=${clAvailableInQuarter}, granted=${clFromThisQuarter}`);
                }

                // Step 4: Determine final CL / LOP split
                clDays = parseFloat(totalCLGranted.toFixed(2));
                lopDays = parseFloat((requestedDays - clDays).toFixed(2));

                if (clDays <= 0) {
                    // All LOP
                    finalLeaveType = 'LOP';
                    clDays = 0;
                    lopDays = requestedDays;
                    successMessage = `No CL quota remaining. ${requestedDays} day(s) applied as Loss of Pay (LOP).`;

                } else if (lopDays <= 0) {
                    // All CL
                    finalLeaveType = 'CASUAL';
                    clDays = requestedDays;
                    lopDays = 0;
                    isSplit = false;

                } else {
                    // Mixed CL + LOP
                    finalLeaveType = 'CASUAL';
                    isSplit = true;
                    splitNote = `${clDays} day(s) Casual Leave + ${lopDays} day(s) Loss of Pay (insufficient CL quota)`;
                    successMessage = `Leave applied: ${clDays} day(s) as Casual Leave + ${lopDays} day(s) as Loss of Pay (LOP).`;
                }
            }

            // ════════════════════════════════════════════════════════════════
            // PATERNITY LEAVE
            // ════════════════════════════════════════════════════════════════
        } else if (validatedData.leaveType === 'PATERNITY') {
            const policy = await LeavePolicy.findOne({ isActive: true }).lean();
            const maxPaternity = policy?.leaveTypes?.paternity?.daysPerYear ?? 15;

            const yearStart = new Date(new Date().getFullYear(), 0, 1);
            const usedPaternity = await Leave.aggregate([
                {
                    $match: {
                        employee: user._id,
                        leaveType: 'PATERNITY',
                        status: { $in: ['APPROVED', 'PENDING'] },
                        startDate: { $gte: yearStart }
                    }
                },
                { $group: { _id: null, total: { $sum: '$totalDays' } } }
            ]);
            const usedDays = usedPaternity[0]?.total ?? 0;
            const remainingPaternity = Math.max(0, maxPaternity - usedDays);
            const paternityOverQuota = requestedDays > remainingPaternity;

            finalLeaveType = 'PATERNITY';
            clDays = 0;
            lopDays = 0;

            if (paternityOverQuota) {
                successMessage = `Paternity leave submitted successfully.`;
            }

            // ════════════════════════════════════════════════════════════════
            // MATERNITY LEAVE
            // ════════════════════════════════════════════════════════════════
        } else if (validatedData.leaveType === 'MATERNITY') {
            const policy = await LeavePolicy.findOne({ isActive: true }).lean();
            const maxMaternity = policy?.leaveTypes?.maternity?.daysPerYear ?? 182;

            const yearStart = new Date(new Date().getFullYear(), 0, 1);
            const usedMaternity = await Leave.aggregate([
                {
                    $match: {
                        employee: user._id,
                        leaveType: 'MATERNITY',
                        status: { $in: ['APPROVED', 'PENDING'] },
                        startDate: { $gte: yearStart }
                    }
                },
                { $group: { _id: null, total: { $sum: '$totalDays' } } }
            ]);
            const usedDays = usedMaternity[0]?.total ?? 0;
            const remainingMaternity = Math.max(0, maxMaternity - usedDays);
            const maternityOverQuota = requestedDays > remainingMaternity;

            finalLeaveType = 'MATERNITY';
            clDays = 0;
            lopDays = 0;

            if (maternityOverQuota) {
                successMessage = `Maternity leave submitted successfully.`;
            }

            // ════════════════════════════════════════════════════════════════
            // SICK LEAVE
            // ════════════════════════════════════════════════════════════════
        } else if (validatedData.leaveType === 'SICK') {
            const policy = await LeavePolicy.findOne({ isActive: true }).lean();
            const maxSick = policy?.leaveTypes?.sick?.daysPerYear ?? 10;

            const yearStart = new Date(new Date().getFullYear(), 0, 1);
            const usedSick = await Leave.aggregate([
                {
                    $match: {
                        employee: user._id,
                        leaveType: 'SICK',
                        status: 'APPROVED',
                        startDate: { $gte: yearStart }
                    }
                },
                { $group: { _id: null, total: { $sum: '$totalDays' } } }
            ]);
            const usedDays = usedSick[0]?.total ?? 0;
            const remainingSick = Math.max(0, maxSick - usedDays);

            if (remainingSick <= 0) {
                return res.status(400).json({
                    success: false,
                    message: `Your Sick Leave quota of ${maxSick} days is fully exhausted for this year. Please apply as Loss of Pay (LOP) instead.`
                });
            }

            if (requestedDays > remainingSick) {
                return res.status(400).json({
                    success: false,
                    message: `You only have ${remainingSick} Sick Leave day(s) remaining this year. Please apply for ${remainingSick} days or less.`
                });
            }

            finalLeaveType = 'SICK';
            clDays = 0;
            lopDays = 0;

            // ════════════════════════════════════════════════════════════════
            // EXPLICIT LOP
            // ════════════════════════════════════════════════════════════════
        } else {
            finalLeaveType = validatedData.leaveType;
            clDays = 0;
            lopDays = requestedDays;
        }

        // ── Create the leave record ───────────────────────────────────────
        const requestId = await Leave.generateRequestId();
        const leaveRequest = new Leave({
            requestId,
            leaveType: finalLeaveType,
            leaveDuration: validatedData.leaveDuration,
            startDate: startDateObj,
            endDate: endDateObj,
            reason: validatedData.reason,
            totalDays: requestedDays,
            clDays,
            lopDays,
            isSplit,
            splitNote,
            employee: user._id,
            employeeId: employee.employeeId,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            department: employee.department,
            designation: employee.designation,
            employeeEmail: employee.officialEmail
        });

        await leaveRequest.save();

        // ── Notify HR/Admin ───────────────────────────────────────────────
        const hrAdmins = await EmployerUser.find({
            role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
            isActive: true
        });

        const isOverQuota = ['MATERNITY', 'PATERNITY', 'SICK'].includes(finalLeaveType) &&
            successMessage.includes('HR will be alerted');

        for (const hrAdmin of hrAdmins) {
            if (hrAdmin.role === 'EMPLOYER_HR') {
                sendMail({
                    to: hrAdmin.email,
                    subject: `New Leave Request - ${employee.firstName} ${employee.lastName} (${leaveRequest.requestId})`,
                    html: leaveEmailTemplate('REQUEST_TO_HR', leaveRequest)
                }).catch(err => console.error('Email error:', err));
            }

            await Notification.create({
                title: isOverQuota ? '⚠ Leave Request — Quota Exceeded' : 'New Leave Request',
                description: isSplit
                    ? `${employee.firstName} ${employee.lastName} applied leave: ${clDays}d CL + ${lopDays}d LOP`
                    : isOverQuota
                        ? `${employee.firstName} ${employee.lastName} applied ${formatLeaveType(finalLeaveType)} for ${requestedDays} day(s) — quota may be exceeded.`
                        : `${employee.firstName} ${employee.lastName} has requested ${formatLeaveType(finalLeaveType)} for ${requestedDays} day(s)`,
                type: 'LEAVE_REQUEST',
                recipientType: hrAdmin.role,
                recipientId: hrAdmin._id,
                recipientModel: 'EmployerUser',
                senderId: user._id,
                senderModel: 'Employee',
                relatedEntityType: 'Leave',
                relatedEntityId: leaveRequest._id,
                status: 'unread',
                priority: isOverQuota ? 'high' : 'medium',
                metadata: {
                    requestId: leaveRequest.requestId,
                    leaveType: leaveRequest.leaveType,
                    employeeName: leaveRequest.employeeName,
                    isSplit,
                    clDays,
                    lopDays,
                    isOverQuota
                }
            });
        }

        return res.status(201).json({
            success: true,
            message: successMessage,
            data: {
                requestId: leaveRequest.requestId,
                leaveType: formatLeaveType(leaveRequest.leaveType),
                leaveDuration: formatDuration(leaveRequest.leaveDuration),
                startDate: formatUTCDate(leaveRequest.startDate),
                endDate: formatUTCDate(leaveRequest.endDate),
                totalDays: leaveRequest.totalDays,
                clDays,
                lopDays,
                isSplit,
                splitNote,
                status: 'Pending',
                appliedAt: leaveRequest.appliedAt,
                reason: leaveRequest.reason,
                isLOP: finalLeaveType === 'LOP',
                isPartialLOP: isSplit
            }
        });

    } catch (error) {
        console.error('createLeaveRequest error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error creating leave request',
            error: error.message
        });
    }
};

/**
 * GET /api/leaves/me
 * Get my leave requests (employee)
 */
export const getMyLeaveRequests = async (req, res) => {
    try {
        const user = req.user;

        const validation = validateRequest(getLeavesQueryValidation, req.query);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { status, leaveType, leaveDuration, page, limit, sortBy, sortOrder } = validation.data;

        const query = { employee: user._id };
        if (status !== 'ALL') query.status = status;
        if (leaveType !== 'ALL') query.leaveType = leaveType;
        if (leaveDuration !== 'ALL') query.leaveDuration = leaveDuration;

        const skip = (page - 1) * limit;
        const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

        const [leaves, total] = await Promise.all([
            Leave.find(query).sort(sort).skip(skip).limit(limit).select('-__v').lean(),
            Leave.countDocuments(query)
        ]);

        const formattedLeaves = leaves.map(leave => ({
            id: leave._id,
            requestId: leave.requestId,
            leaveType: formatLeaveType(leave.leaveType),
            leaveTypeRaw: leave.leaveType,
            leaveDuration: formatDuration(leave.leaveDuration),
            startDate: formatUTCDate(leave.startDate),
            endDate: formatUTCDate(leave.endDate),
            totalDays: leave.totalDays,

            // ── Split breakdown ────────────────────────────────────────────────
            clDays: leave.clDays ?? 0,
            lopDays: leave.lopDays ?? 0,
            isSplit: leave.isSplit ?? false,
            splitNote: leave.splitNote ?? null,

            reason: leave.reason,
            status: formatStatus(leave.status),
            appliedAt: leave.appliedAt,
            approvedComments: leave.approvedComments,
            rejectedComments: leave.rejectedComments,
            approvedAt: leave.approvedAt,
            rejectedAt: leave.rejectedAt,
            isLOP: leave.leaveType === 'LOP',
            isPartialLOP: leave.isSplit ?? false
        }));

        const totalPages = Math.ceil(total / limit);
        return res.json({
            success: true,
            message: 'Leave requests fetched successfully',
            data: {
                leaves: formattedLeaves,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('getMyLeaveRequests error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching leave requests',
            error: error.message
        });
    }
};

/**
 * GET /api/leaves/me/balance
 * Get leave balance for logged-in employee
 */
export const getLeaveBalance = async (req, res) => {
    try {
        const user = req.user;

        const validation = validateRequest(leaveBalanceValidation, req.query);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { year } = validation.data;

        const employee = await Employee.findById(user._id).select('isPermanentEmp').lean();
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        const balance = await calculateLeaveBalance(user._id, employee.isPermanentEmp, year);

        return res.json({
            success: true,
            message: 'Leave balance fetched successfully',
            data: {
                ...balance,
                isPermanentEmployee: employee.isPermanentEmp
            }
        });
    } catch (error) {
        console.error('getLeaveBalance error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching leave balance',
            error: error.message
        });
    }
};

/**
 * GET /api/leaves/me/:leaveRequestId
 * Get single leave by request ID
 */
export const getLeaveRequestById = async (req, res) => {
    try {
        const { leaveRequestId } = req.params;
        const user = req.user;

        const leaveRequest = await Leave.findOne({ requestId: leaveRequestId })
            .populate('approvedBy', 'firstName lastName email role')
            .populate('rejectedBy', 'firstName lastName email role')
            .select('-__v')
            .lean();

        if (!leaveRequest) {
            return res.status(404).json({ success: false, message: 'Leave request not found' });
        }

        const isOwner = leaveRequest.employee.toString() === user._id.toString();
        const isHRAdmin = user.role && ['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(user.role);
        if (!isOwner && !isHRAdmin) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        return res.json({
            success: true,
            data: {
                id: leaveRequest._id,
                requestId: leaveRequest.requestId,
                leaveType: formatLeaveType(leaveRequest.leaveType),
                leaveTypeRaw: leaveRequest.leaveType,
                leaveDuration: formatDuration(leaveRequest.leaveDuration),
                startDate: formatUTCDate(leaveRequest.startDate),
                endDate: formatUTCDate(leaveRequest.endDate),
                totalDays: leaveRequest.totalDays,
                reason: leaveRequest.reason,
                status: formatStatus(leaveRequest.status),
                isLOP: leaveRequest.leaveType === 'LOP',
                employee: {
                    id: leaveRequest.employee,
                    employeeId: leaveRequest.employeeId,
                    name: leaveRequest.employeeName,
                    department: leaveRequest.department,
                    designation: leaveRequest.designation
                },
                appliedAt: leaveRequest.appliedAt,
                approvedBy: leaveRequest.approvedBy ? {
                    id: leaveRequest.approvedBy._id,
                    name: `${leaveRequest.approvedBy.firstName} ${leaveRequest.approvedBy.lastName}`,
                    email: leaveRequest.approvedBy.email,
                    role: leaveRequest.approvedBy.role
                } : null,
                rejectedBy: leaveRequest.rejectedBy ? {
                    id: leaveRequest.rejectedBy._id,
                    name: `${leaveRequest.rejectedBy.firstName} ${leaveRequest.rejectedBy.lastName}`,
                    email: leaveRequest.rejectedBy.email,
                    role: leaveRequest.rejectedBy.role
                } : null,
                approvedComments: leaveRequest.approvedComments,
                rejectedComments: leaveRequest.rejectedComments,
                approvedAt: leaveRequest.approvedAt,
                rejectedAt: leaveRequest.rejectedAt
            }
        });
    } catch (error) {
        console.error('getLeaveRequestById error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching leave request',
            error: error.message
        });
    }
};

/**
 * DELETE /api/leaves/me/:leaveRequestId/cancel
 * Cancel a pending leave
 */
export const cancelLeaveRequest = async (req, res) => {
    try {
        const user = req.user;
        const { leaveRequestId } = req.params;

        const leaveRequest = await Leave.findOne({ requestId: leaveRequestId });
        if (!leaveRequest) {
            return res.status(404).json({ success: false, message: 'Leave request not found' });
        }

        // Only the owner can cancel
        if (leaveRequest.employee.toString() !== user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to cancel this leave request'
            });
        }

        // Only PENDING or APPROVED can be cancelled
        if (!['PENDING', 'APPROVED'].includes(leaveRequest.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel a ${leaveRequest.status.toLowerCase()} leave request`
            });
        }

        // Cannot cancel if leave has already started
        const today = dayjs.utc().startOf('day');
        const leaveStart = dayjs.utc(leaveRequest.startDate).startOf('day');

        if (leaveStart.isSameOrBefore(today)) {
            return res.status(400).json({
                success: false,
                message: 'Cannot cancel a leave that has already started or passed'
            });
        }

        const wasApproved = leaveRequest.status === 'APPROVED';

        leaveRequest.status = 'CANCELLED';
        leaveRequest.cancelledAt = new Date();
        leaveRequest.cancelledByEmployee = true;
        await leaveRequest.save();


        // Notify HR/Admin
        const hrAdmins = await EmployerUser.find({
            role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
            isActive: true
        });

        for (const hrAdmin of hrAdmins) {
            await Notification.create({
                title: wasApproved
                    ? '⚠ Approved Leave Cancelled by Employee'
                    : 'Leave Request Cancelled',
                description: `${leaveRequest.employeeName} cancelled their ${formatLeaveType(leaveRequest.leaveType)} request (${leaveRequest.requestId})${wasApproved ? ' — this leave was already approved' : ''}`,
                type: 'LEAVE_CANCELLED',
                recipientType: hrAdmin.role,
                recipientId: hrAdmin._id,
                recipientModel: 'EmployerUser',
                senderId: user._id,
                senderModel: 'Employee',
                relatedEntityType: 'Leave',
                relatedEntityId: leaveRequest._id,
                status: 'unread',
                priority: wasApproved ? 'high' : 'low',
                metadata: {
                    requestId: leaveRequest.requestId,
                    leaveType: leaveRequest.leaveType,
                    wasApproved
                }
            });
        }

        return res.json({
            success: true,
            message: wasApproved
                ? 'Approved leave cancelled successfully. HR has been notified.'
                : 'Leave request cancelled successfully',
            data: {
                requestId: leaveRequest.requestId,
                cancelledAt: new Date(),
                wasApproved
            }
        });


    } catch (error) {
        console.error('cancelLeaveRequest error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error cancelling leave request',
            error: error.message
        });
    }
};

// ─── HR/ADMIN: Leave ──────────────────────────────────────────────────────────

/**
 * GET /api/leaves
 * Get all leave requests (HR/Admin)
 */
export const getAllLeaveRequests = async (req, res) => {
    try {
        const validation = validateRequest(getLeavesQueryValidation, req.query);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const {
            status, leaveType, leaveDuration, department,
            startDate, endDate, page, limit, sortBy, sortOrder
        } = validation.data;

        const query = {};
        if (status !== 'ALL') query.status = status;
        if (leaveType !== 'ALL') query.leaveType = leaveType;
        if (leaveDuration !== 'ALL') query.leaveDuration = leaveDuration;
        if (department) query.department = new RegExp(department, 'i');

        if (startDate && endDate) {
            const start = parseUTCDate(startDate);
            const end = dayjs.utc(endDate).endOf('day').toDate();
            query.$or = [{ startDate: { $lte: end }, endDate: { $gte: start } }];
        } else if (startDate) {
            query.startDate = { $gte: parseUTCDate(startDate) };
        } else if (endDate) {
            query.endDate = { $lte: dayjs.utc(endDate).endOf('day').toDate() };
        }

        const skip = (page - 1) * limit;
        const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

        const [leaves, total] = await Promise.all([
            Leave.find(query)
                .sort(sort).skip(skip).limit(limit)
                .populate('employee', 'firstName lastName officialEmail isPermanentEmp')
                .populate('approvedBy', 'firstName lastName email role')
                .populate('rejectedBy', 'firstName lastName email role')
                .select('-__v')
                .lean(),
            Leave.countDocuments(query)
        ]);

        const formattedLeaves = leaves.map(leave => ({
            id: leave._id,
            requestId: leave.requestId,
            leaveType: formatLeaveType(leave.leaveType),
            leaveTypeRaw: leave.leaveType,
            leaveDuration: formatDuration(leave.leaveDuration),
            startDate: formatUTCDate(leave.startDate),
            endDate: formatUTCDate(leave.endDate),
            totalDays: leave.totalDays,
            // ── Split breakdown ────────────────────────────────────────────────
            clDays: leave.clDays ?? 0,
            lopDays: leave.lopDays ?? 0,
            isSplit: leave.isSplit ?? false,
            splitNote: leave.splitNote ?? null,
            reason: leave.reason,
            status: formatStatus(leave.status),
            isLOP: leave.leaveType === 'LOP',
            employee: leave.employee ? {
                id: leave.employee._id,
                name: `${leave.employee.firstName} ${leave.employee.lastName}`,
                email: leave.employee.officialEmail,
                isPermanentEmp: leave.employee.isPermanentEmp
            } : null,
            employeeName: leave.employeeName,
            department: leave.department,
            appliedAt: leave.appliedAt,
            actionBy:
                leave.status === 'APPROVED' && leave.approvedBy ? {
                    id: leave.approvedBy._id,
                    name: `${leave.approvedBy.firstName} ${leave.approvedBy.lastName}`,
                    email: leave.approvedBy.email,
                    role: leave.approvedBy.role
                } :
                    leave.status === 'REJECTED' && leave.rejectedBy ? {
                        id: leave.rejectedBy._id,
                        name: `${leave.rejectedBy.firstName} ${leave.rejectedBy.lastName}`,
                        email: leave.rejectedBy.email,
                        role: leave.rejectedBy.role
                    } : null,
            actionAt:
                leave.status === 'APPROVED' ? leave.approvedAt :
                    leave.status === 'REJECTED' ? leave.rejectedAt : null,
            comments:
                leave.status === 'APPROVED' ? leave.approvedComments :
                    leave.status === 'REJECTED' ? leave.rejectedComments : null
        }));

        const totalPages = Math.ceil(total / limit);
        return res.json({
            success: true,
            message: 'Leave requests fetched successfully',
            data: {
                leaves: formattedLeaves,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('getAllLeaveRequests error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching leave requests',
            error: error.message
        });
    }
};

/**
 * PATCH /api/leaves/:leaveRequestId/status
 * Approve or reject a leave (HR/Admin)
 */
export const updateLeaveStatus = async (req, res) => {
    try {
        const user = req.user;
        const { leaveRequestId } = req.params;

        const validation = validateRequest(updateLeaveStatusValidation, req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { status, comments } = validation.data;

        const leaveRequest = await Leave.findOne({ requestId: leaveRequestId });
        if (!leaveRequest) {
            return res.status(404).json({ success: false, message: 'Leave request not found' });
        }
        if (leaveRequest.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Leave request is already ${leaveRequest.status.toLowerCase()}`
            });
        }

        const updatedLeave = status === 'APPROVED'
            ? await leaveRequest.approve(user._id, comments)
            : await leaveRequest.reject(user._id, comments);

        const employee = await Employee.findById(leaveRequest.employee)
            .select('firstName lastName personalEmail')
            .lean();

        if (employee) {
            await Notification.create({
                title: status === 'APPROVED' ? 'Leave Request Approved' : 'Leave Request Rejected',
                description: `Your ${formatLeaveType(leaveRequest.leaveType)} request (${leaveRequest.requestId}) has been ${status.toLowerCase()}.${comments ? ` Comments: ${comments}` : ''}`,
                type: status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
                recipientType: 'EMPLOYEE',
                recipientId: leaveRequest.employee,
                recipientModel: 'Employee',
                senderId: user._id,
                senderModel: 'EmployerUser',
                relatedEntityType: 'Leave',
                relatedEntityId: leaveRequest._id,
                status: 'unread',
                priority: 'medium',
                metadata: {
                    requestId: leaveRequest.requestId,
                    leaveType: leaveRequest.leaveType
                }
            });

            setTimeout(async () => {
                await sendMail({
                    to: employee.personalEmail,
                    subject: `Leave Request ${status === 'APPROVED' ? 'Approved' : 'Rejected'} - ${updatedLeave.requestId}`,
                    html: leaveEmailTemplate(
                        status === 'APPROVED' ? 'APPROVED_TO_EMPLOYEE' : 'REJECTED_TO_EMPLOYEE',
                        leaveRequest
                    )
                });
            }, 2000);
        }

        return res.json({
            success: true,
            message: `Leave request ${status.toLowerCase()} successfully`,
            data: {
                requestId: updatedLeave.requestId,
                status: formatStatus(status),
                updatedBy: {
                    id: user._id,
                    name: `${user.firstName} ${user.lastName}`,
                    role: user.role
                },
                comments: comments || null,
                updatedAt: updatedLeave.updatedAt
            }
        });
    } catch (error) {
        console.error('updateLeaveStatus error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating leave status',
            error: error.message
        });
    }
};

/**
 * GET /api/leaves/statistics/overview
 */
export const getLeaveStatistics = async (req, res) => {
    try {
        const user = req.user;

        const validation = validateRequest(leaveStatsValidation, req.query);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { year, department } = validation.data;

        const query = {};
        if (department) query.department = new RegExp(department, 'i');
        if (!['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(user.role)) {
            query.employee = user._id;
        }

        // Salary cycle: 21st of previous month → 20th of current month
        // Salary cycle: HR-configured start day (default 21)
        const cyclePolicy = await LeavePolicy.findOne({ isActive: true }).lean();
        const cycleStartDay = cyclePolicy?.salaryCycle?.startDay ?? 21;
        const now = new Date();
        const cycleStartDate = now.getDate() >= cycleStartDay
            ? new Date(now.getFullYear(), now.getMonth(), cycleStartDay, 0, 0, 0, 0)
            : new Date(now.getFullYear(), now.getMonth() - 1, cycleStartDay, 0, 0, 0, 0);
        const cycleEndDate = new Date(cycleStartDate.getFullYear(), cycleStartDate.getMonth() + 1, cycleStartDay - 1, 23, 59, 59, 999);
        query.startDate = { $gte: cycleStartDate, $lte: cycleEndDate };


        const leaves = await Leave.find(query).lean();
        const stats = {
            total: leaves.length,
            pending: leaves.filter(l => l.status === 'PENDING').length,
            approved: leaves.filter(l => l.status === 'APPROVED').length,
            rejected: leaves.filter(l => l.status === 'REJECTED').length,
            byType: {
                CASUAL: leaves.filter(l => l.leaveType === 'CASUAL').length,
                SICK: leaves.filter(l => l.leaveType === 'SICK').length,
                MATERNITY: leaves.filter(l => l.leaveType === 'MATERNITY').length,
                PATERNITY: leaves.filter(l => l.leaveType === 'PATERNITY').length,
                LOP: leaves.filter(l => l.leaveType === 'LOP').length
            },
            byDuration: {
                FULL_DAY: leaves.filter(l => l.leaveDuration === 'FULL_DAY').length,
                FIRST_HALF: leaves.filter(l => l.leaveDuration === 'FIRST_HALF').length,
                SECOND_HALF: leaves.filter(l => l.leaveDuration === 'SECOND_HALF').length
            },
            byMonth: Array(12).fill(0).map((_, i) => {
                const monthLeaves = leaves.filter(l => new Date(l.appliedAt).getMonth() === i);
                return {
                    month: new Date(year, i).toLocaleString('default', { month: 'short' }),
                    count: monthLeaves.length,
                    approved: monthLeaves.filter(l => l.status === 'APPROVED').length,
                    rejected: monthLeaves.filter(l => l.status === 'REJECTED').length
                };
            }),
            approvalRate: leaves.length > 0
                ? Math.round((leaves.filter(l => l.status === 'APPROVED').length / leaves.length) * 100)
                : 0
        };

        return res.json({
            success: true,
            message: 'Leave statistics fetched successfully',
            data: stats
        });
    } catch (error) {
        console.error('getLeaveStatistics error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching statistics',
            error: error.message
        });
    }
};

/**
 * GET /api/leaves/upcoming
 */
export const getUpcomingLeaves = async (req, res) => {
    try {
        const user = req.user;
        const today = dayjs.utc().startOf('day').toDate();
        const nextMonth = dayjs.utc().add(1, 'month').startOf('day').toDate();

        const query = { status: 'APPROVED', startDate: { $gte: today, $lte: nextMonth } };
        if (!['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(user.role)) {
            query.employee = user._id;
        }

        const upcomingLeaves = await Leave.find(query)
            .sort({ startDate: 1 })
            .limit(10)
            .select('requestId employeeName startDate endDate totalDays department leaveDuration leaveType')
            .lean();

        return res.json({
            success: true,
            data: upcomingLeaves.map(leave => ({
                id: leave._id,
                requestId: leave.requestId,
                employeeName: leave.employeeName,
                leaveType: formatLeaveType(leave.leaveType),
                leaveDuration: formatDuration(leave.leaveDuration),
                startDate: formatUTCDate(leave.startDate),
                endDate: formatUTCDate(leave.endDate),
                totalDays: leave.totalDays,
                department: leave.department
            }))
        });
    } catch (error) {
        console.error('getUpcomingLeaves error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching upcoming leaves',
            error: error.message
        });
    }
};

// ─── EMPLOYEE: Permission ─────────────────────────────────────────────────────

/**
 * POST /api/leaves/permission
 */
export const createPermissionRequest = async (req, res) => {
    try {
        const user = req.user;

        const validation = validateRequest(createPermissionValidation, req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { date, fromTime, toTime, reason } = validation.data;

        // ── Calculate duration ────────────────────────────────────────────
        const [fH, fM] = fromTime.split(':').map(Number);
        const [tH, tM] = toTime.split(':').map(Number);
        const totalMinutes = (tH * 60 + tM) - (fH * 60 + fM);
        const durationHours = totalMinutes / 60;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const durationText = [
            hours > 0 ? `${hours} hr` : '',
            minutes > 0 ? `${minutes} min` : ''
        ].filter(Boolean).join(' ');

        // ── Fetch policy for cycle startDay ───────────────────────────────
        const policy = await LeavePolicy.findOne({ isActive: true }).lean();
        const startDay = policy?.salaryCycle?.startDay ?? 1;
        const maxPermHours = policy?.permissionLeave?.hoursPerMonth ?? 2;

        // ── Get cycle period for the requested date ───────────────────────
        const requestDate = parseUTCDate(date);
        const cyclePeriod = getCyclePeriodForDate(dayjs.utc(requestDate), startDay);
        const cycleStart = cyclePeriod.start.toDate();
        const cycleEnd = cyclePeriod.end.toDate();

        // ── Check how many hours used this cycle month ────────────────────
        const existingThisCycle = await Permission.find({
            employee: user._id,
            date: { $gte: cycleStart, $lte: cycleEnd },
            status: { $in: ['PENDING', 'APPROVED'] }
        }).lean();

        const usedHours = existingThisCycle.reduce((sum, p) => sum + (p.durationHours || 0), 0);
        const remainingHours = maxPermHours - usedHours;

        if (remainingHours <= 0) {
            return res.status(400).json({
                success: false,
                message: `You have used your full ${maxPermHours}-hour permission quota for the cycle period (${cyclePeriod.start.format('DD MMM')} – ${cyclePeriod.end.format('DD MMM YYYY')}). Consider applying for a half-day leave instead.`
            });
        }

        if (durationHours > remainingHours) {
            return res.status(400).json({
                success: false,
                message: `You only have ${Math.round(remainingHours * 60)}min of permission remaining this cycle period. Requested ${Math.round(durationHours * 60)}min exceeds your quota.`
            });
        }

        // ── Fetch employee ────────────────────────────────────────────────
        const employee = await Employee.findById(user._id)
            .select('employeeId firstName lastName department designation officialEmail')
            .lean();
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        const requestId = await Permission.generateRequestId();
        const permission = new Permission({
            requestId,
            employee: user._id,
            employeeId: employee.employeeId,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            department: employee.department,
            designation: employee.designation,
            date: requestDate,
            fromTime,
            toTime,
            durationHours,
            durationText,
            reason
        });

        await permission.save();

        // ── Notify HR/Admin ───────────────────────────────────────────────
        const hrAdmins = await EmployerUser.find({
            role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
            isActive: true
        });
        for (const hr of hrAdmins) {
            await Notification.create({
                title: 'New Permission Request',
                description: `${employee.firstName} ${employee.lastName} requested permission on ${formatUTCDate(requestDate)} from ${fromTime} to ${toTime}`,
                type: 'LEAVE_REQUEST',
                recipientType: hr.role,
                recipientId: hr._id,
                recipientModel: 'EmployerUser',
                senderId: user._id,
                senderModel: 'Employee',
                relatedEntityType: 'Permission',
                relatedEntityId: permission._id,
                status: 'unread',
                priority: 'low',
                metadata: { requestId: permission.requestId }
            });
        }

        const usedAfter = parseFloat((usedHours + durationHours).toFixed(2));
        const remainingAfter = parseFloat((maxPermHours - usedAfter).toFixed(2));
        const remainMins = Math.round(remainingAfter * 60);

        return res.status(201).json({
            success: true,
            message: remainingAfter > 0
                ? `Permission submitted (${Math.round(durationHours * 60)}min). ${remainMins}min remaining this cycle period.`
                : `Permission submitted. You have used your full ${maxPermHours}-hour quota for this cycle period.`,
            data: {
                requestId: permission.requestId,
                date: formatUTCDate(permission.date),
                fromTime: permission.fromTime,
                toTime: permission.toTime,
                duration: durationText,
                durationHours: permission.durationHours,
                usedThisMonth: usedAfter,
                remainingThisMonth: remainingAfter,
                cyclePeriod: {
                    start: cyclePeriod.start.format('DD MMM YYYY'),
                    end: cyclePeriod.end.format('DD MMM YYYY')
                },
                status: 'Pending',
                reason: permission.reason
            }
        });
    } catch (error) {
        console.error('createPermissionRequest error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error creating permission request',
            error: error.message
        });
    }
};

/**
 * GET /api/leaves/permission/me
 */
export const getMyPermissions = async (req, res) => {
    try {
        const user = req.user;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const [permissions, total] = await Promise.all([
            Permission.find({ employee: user._id })
                .sort({ appliedAt: -1 }).skip(skip).limit(limit).lean(),
            Permission.countDocuments({ employee: user._id })
        ]);

        const formatted = permissions.map(p => ({
            id: p._id,
            requestId: p.requestId,
            date: formatUTCDate(p.date),
            fromTime: p.fromTime,
            toTime: p.toTime,
            durationHours: p.durationHours,
            reason: p.reason,
            status: formatStatus(p.status),
            appliedAt: p.appliedAt,
            approvedComments: p.approvedComments,
            rejectedComments: p.rejectedComments
        }));

        const totalPages = Math.ceil(total / limit);
        return res.json({
            success: true,
            data: {
                permissions: formatted,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('getMyPermissions error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching permissions',
            error: error.message
        });
    }
};

/**
 * DELETE /api/leaves/permission/me/:requestId/cancel
 */
export const cancelPermissionRequest = async (req, res) => {
    try {
        const user = req.user;
        const { requestId } = req.params;

        const permission = await Permission.findOne({ requestId, employee: user._id });
        if (!permission) {
            return res.status(404).json({ success: false, message: 'Permission request not found' });
        }
        if (permission.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel a ${permission.status.toLowerCase()} permission`
            });
        }

        await permission.deleteOne();
        return res.json({ success: true, message: 'Permission request cancelled successfully' });
    } catch (error) {
        console.error('cancelPermissionRequest error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error cancelling permission',
            error: error.message
        });
    }
};

// ─── HR/ADMIN: Permission ─────────────────────────────────────────────────────

/**
 * GET /api/leaves/permission
 */
export const getAllPermissions = async (req, res) => {
    try {
        const status = req.query.status || 'ALL';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const query = {};
        if (status !== 'ALL') query.status = status;

        const [permissions, total] = await Promise.all([
            Permission.find(query)
                .sort({ appliedAt: -1 }).skip(skip).limit(limit).lean(),
            Permission.countDocuments(query)
        ]);

        const formatted = permissions.map(p => ({
            id: p._id,
            requestId: p.requestId,
            employeeName: p.employeeName,
            employeeId: p.employeeId,
            department: p.department,
            date: formatUTCDate(p.date),
            fromTime: p.fromTime,
            toTime: p.toTime,
            durationHours: p.durationHours,
            reason: p.reason,
            status: formatStatus(p.status),
            appliedAt: p.appliedAt,
            approvedComments: p.approvedComments,
            rejectedComments: p.rejectedComments
        }));

        const totalPages = Math.ceil(total / limit);
        return res.json({
            success: true,
            data: {
                permissions: formatted,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('getAllPermissions error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching permissions',
            error: error.message
        });
    }
};

/**
 * PATCH /api/leaves/permission/:requestId/status
 */
export const updatePermissionStatus = async (req, res) => {
    try {
        const user = req.user;
        const { requestId } = req.params;

        const validation = validateRequest(updatePermissionStatusValidation, req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { status, comments } = validation.data;

        const permission = await Permission.findOne({ requestId });
        if (!permission) {
            return res.status(404).json({ success: false, message: 'Permission request not found' });
        }
        if (permission.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Permission already ${permission.status.toLowerCase()}`
            });
        }

        if (status === 'APPROVED') {
            permission.status = 'APPROVED';
            permission.approvedBy = user._id;
            permission.approvedComments = comments || null;
            permission.approvedAt = new Date();
        } else {
            permission.status = 'REJECTED';
            permission.rejectedBy = user._id;
            permission.rejectedComments = comments || null;
            permission.rejectedAt = new Date();
        }
        await permission.save();

        await Notification.create({
            title: status === 'APPROVED' ? 'Permission Approved' : 'Permission Rejected',
            description: `Your permission request (${permission.requestId}) has been ${status.toLowerCase()}${comments ? `. Comments: ${comments}` : ''}`,
            type: status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
            recipientType: 'EMPLOYEE',
            recipientId: permission.employee,
            recipientModel: 'Employee',
            senderId: user._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Permission',
            relatedEntityId: permission._id,
            status: 'unread',
            priority: 'low',
            metadata: { requestId: permission.requestId }
        });

        return res.json({
            success: true,
            message: `Permission ${status.toLowerCase()} successfully`,
            data: {
                requestId: permission.requestId,
                status: formatStatus(status),
                comments: comments || null
            }
        });
    } catch (error) {
        console.error('updatePermissionStatus error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating permission status',
            error: error.message
        });
    }
};

// ─── Leave Policy CRUD ────────────────────────────────────────────────────────

/**
 * POST /api/leaves/policy
 */
export const createLeavePolicy = async (req, res) => {
    try {
        const validation = validateRequest(createLeavePolicyValidation, req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const existing = await LeavePolicy.findOne({ isActive: true });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'An active policy already exists. Please update it instead.'
            });
        }

        const policy = new LeavePolicy({ ...validation.data, createdBy: req.user._id });
        await policy.save();

        return res.status(201).json({
            success: true,
            message: 'Leave policy created',
            data: policy
        });
    } catch (error) {
        console.error('createLeavePolicy error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/leaves/policy
 */
export const getLeavePolicy = async (req, res) => {
    try {
        const policy = await LeavePolicy.findOne({ isActive: true }).lean();
        if (!policy) {
            return res.status(404).json({
                success: false,
                message: 'No active leave policy found'
            });
        }
        return res.json({ success: true, data: policy });
    } catch (error) {
        console.error('getLeavePolicy error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * PATCH /api/leaves/policy/:id
 */
export const updateLeavePolicy = async (req, res) => {
    try {
        const validation = validateRequest(updateLeavePolicyValidation, req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const policy = await LeavePolicy.findByIdAndUpdate(
            req.params.id,
            { ...validation.data, updatedBy: req.user._id },
            { new: true, runValidators: true }
        );
        if (!policy) {
            return res.status(404).json({ success: false, message: 'Policy not found' });
        }

        return res.json({ success: true, message: 'Leave policy updated', data: policy });
    } catch (error) {
        console.error('updateLeavePolicy error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * DELETE /api/leaves/policy/:id
 */
export const deleteLeavePolicy = async (req, res) => {
    try {
        await LeavePolicy.findByIdAndDelete(req.params.id);
        return res.json({ success: true, message: 'Leave policy deleted' });
    } catch (error) {
        console.error('deleteLeavePolicy error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── Holiday CRUD ─────────────────────────────────────────────────────────────

/**
 * POST /api/leaves/holidays
 */
export const createHoliday = async (req, res) => {
    try {
        const validation = validateRequest(createHolidayValidation, req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { name, date, type, description, isRecurring } = validation.data;
        const dateObj = parseUTCDate(date);

        const holiday = new Holiday({
            name: name.trim(),
            date: dateObj,
            year: dayjs.utc(dateObj).year(),
            type: type || 'GOVERNMENT',
            description: description || '',
            isRecurring: isRecurring || false,
            createdBy: req.user._id
        });
        await holiday.save();

        return res.status(201).json({
            success: true,
            message: 'Holiday created',
            data: holiday
        });
    } catch (error) {
        console.error('createHoliday error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/leaves/holidays
 */
export const getHolidays = async (req, res) => {
    try {
        const year = parseInt(req.query.year) || dayjs.utc().year();
        const query = { year };
        if (req.query.type) query.type = req.query.type;

        const holidays = await Holiday.find(query).sort({ date: 1 }).lean();
        return res.json({
            success: true,
            data: holidays,
            total: holidays.length
        });
    } catch (error) {
        console.error('getHolidays error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * PUT /api/leaves/holidays/:id
 */
export const updateHoliday = async (req, res) => {
    try {
        const validation = validateRequest(updateHolidayValidation, req.body);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const updateData = { ...validation.data, updatedBy: req.user._id };
        if (updateData.date) {
            const dateObj = parseUTCDate(updateData.date);
            updateData.date = dateObj;
            updateData.year = dayjs.utc(dateObj).year();
        }

        const holiday = await Holiday.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        );
        if (!holiday) {
            return res.status(404).json({ success: false, message: 'Holiday not found' });
        }

        return res.json({ success: true, message: 'Holiday updated', data: holiday });
    } catch (error) {
        console.error('updateHoliday error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * DELETE /api/leaves/holidays/:id
 */
export const deleteHoliday = async (req, res) => {
    try {
        await Holiday.findByIdAndDelete(req.params.id);
        return res.json({ success: true, message: 'Holiday deleted' });
    } catch (error) {
        console.error('deleteHoliday error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};