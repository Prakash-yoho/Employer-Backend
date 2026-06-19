/**
 * leaveController.js
 * Handles: leave application, balance, CL detail, cancel, HR approval, statistics.
 */

import Leave from '../model/Leave.js';
import Employee from '../model/Employee.js';
import EmployerUser from '../model/EmployerUser.js';
import Notification from '../model/Notification.js';
import LeavePolicy from '../model/LeavePolicy.js';
import Holiday from '../model/Holiday.js';
import { sendMail } from '../utils/mailer.js';
import { leaveEmailTemplate } from '../utils/emailTemplates.js';
import {
    calculateLeaveBalance,
    allocateCLForLeave,
    calculateSandwichDays,
    getCLAllocationDetail,
} from '../utils/leaveBalanceHelper.js';
import {
    createLeaveValidation,
    updateLeaveStatusValidation,
    getLeavesQueryValidation,
    leaveStatsValidation,
    leaveBalanceValidation,
} from '../validations/leaveValidation.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { recalculateAfterCancel } from '../utils/Leaverecalculation.js';
import { getBlockedDatesForEmployee, validateLeaveDates } from '../utils/Leavevalidationhelper.js';
dayjs.extend(utc);

// ─── Shared utilities (also used by permissionController) ─────────────────────

export const validate = (schema, data) => {
    const { error, value } = schema.validate(data, { abortEarly: false, stripUnknown: true, convert: true });
    if (error) return { ok: false, errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message.replace(/['"]/g, '') })) };
    return { ok: true, data: value };
};

export const sanitize = (s = '') => s.replace(/<[^>]*>/g, '').trim();
export const fmtType = t => ({ CASUAL: 'Casual Leave', SICK: 'Sick Leave', MATERNITY: 'Maternity Leave', PATERNITY: 'Paternity Leave', LOP: 'Loss of Pay' }[t] ?? t);
export const fmtDur = d => ({ FULL_DAY: 'Full Day', FIRST_HALF: 'First Half', SECOND_HALF: 'Second Half' }[d] ?? d);
export const fmtStatus = s => ({ PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' }[s] ?? s);
export const toUTC = d => d ? dayjs.utc(d).startOf('day').toDate() : null;
export const toStr = d => d ? dayjs.utc(d).format('YYYY-MM-DD') : null;
export const paginate = (total, page, limit) => ({ total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1 });
export const fmtUser = u => ({ id: u._id, name: `${u.firstName} ${u.lastName}`, email: u.email, role: u.role });

export const fmtLeave = (l, withDetail = false) => {
    const base = {
        id: l._id,
        requestId: l.requestId,
        leaveType: fmtType(l.leaveType),
        leaveTypeRaw: l.leaveType,
        leaveDuration: fmtDur(l.leaveDuration),
        startDate: toStr(l.startDate),
        endDate: toStr(l.endDate),
        totalDays: l.totalDays,
        clDays: l.clDays ?? 0,
        lopDays: l.lopDays ?? 0,
        isSplit: l.isSplit ?? false,
        isLOP: l.leaveType === 'LOP',
        isPartialLOP: l.isSplit ?? false,
        sandwichDays: l.sandwichDays ?? 0,
        sandwichDates: l.sandwichDates ?? [],
        clBucketSummary: l.clBucketSummary ?? [],
        reason: l.reason,
        status: fmtStatus(l.status),
        appliedAt: l.appliedAt,
        approvedComments: l.approvedComments,
        rejectedComments: l.rejectedComments,
        approvedAt: l.approvedAt,
        rejectedAt: l.rejectedAt,
        department: l.department,
        employeeName: l.employeeName,
        employeeId: l.employeeId,
    };
    if (withDetail) {
        base.approvedBy = l.approvedBy ? fmtUser(l.approvedBy) : null;
        base.rejectedBy = l.rejectedBy ? fmtUser(l.rejectedBy) : null;
    }
    return base;
};

// ─── EMPLOYEE: Apply leave ────────────────────────────────────────────────────

export const createLeaveRequest = async (req, res) => {
    try {
        const user = req.user;
        const v = validate(createLeaveValidation, req.body);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });

        const body = v.data;
        body.reason = sanitize(body.reason);

        const employee = await Employee.findById(user._id)
            .select('employeeId firstName lastName department designation officialEmail isPermanentEmp doj createdAt').lean();
        if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

        const isPermanent = employee.isPermanentEmp || false;
        const doj = employee.doj ?? employee.createdAt;

        if (['SICK', 'MATERNITY', 'PATERNITY'].includes(body.leaveType) && !isPermanent)
            return res.status(403).json({ success: false, message: `${fmtType(body.leaveType)} is for permanent employees only` });

        // ── Declare date objects HERE (moved above all checks that need them) ──
        const startDateObj = toUTC(body.startDate);
        const endDateObj = body.leaveDuration !== 'FULL_DAY' ? toUTC(body.startDate) : toUTC(body.endDate);

        // ── 1. Blocked-date validation (weekend / holiday / sandwich) ──────────
        const dateValidation = await validateLeaveDates(
            user._id,
            startDateObj,
            endDateObj,
            body.leaveDuration,
        );
        if (!dateValidation.ok) {
            return res.status(400).json({
                success: false,
                message: dateValidation.message,
                blockedDates: dateValidation.blockedDates,
            });
        }

        // ── 2. Overlap check (existing leave on same dates) ────────────────────
        const overlap = await Leave.checkOverlap(user._id, body.startDate, body.endDate, body.leaveDuration);
        if (overlap)
            return res.status(400).json({
                success: false,
                message: `You already have a ${fmtDur(overlap.leaveDuration).toLowerCase()} leave for these dates`,
                conflictingLeave: { requestId: overlap.requestId, startDate: toStr(overlap.startDate), endDate: toStr(overlap.endDate), status: fmtStatus(overlap.status) },
            });

        // ── Base calendar days ─────────────────────────────────────────────────
        const baseCalDays = body.leaveDuration !== 'FULL_DAY' ? 0.5
            : dayjs.utc(endDateObj).startOf('day').diff(dayjs.utc(startDateObj).startOf('day'), 'day') + 1;

        if (baseCalDays <= 0)
            return res.status(400).json({ success: false, message: 'End date must be on or after start date' });

        const policy = await LeavePolicy.findOne({ isActive: true }).lean();

        let finalLeaveType = body.leaveType;
        let clDays = 0;
        let lopDays = 0;
        let isSplit = false;
        let isFullLOP = false;
        let sandwichDays = 0;
        let sandwichDates = [];
        let totalDays = baseCalDays;
        let clBucketSummary = [];
        let successMessage = 'Leave request submitted successfully';

        // ── CASUAL ─────────────────────────────────────────────────────────────
        if (body.leaveType === 'CASUAL') {
            if (body.leaveDuration === 'FULL_DAY') {
                try {
                    const holidays = await Holiday.find({ year: dayjs.utc(startDateObj).year() }).lean();
                    const holidayStrs = holidays.map(h => dayjs.utc(h.date).format('YYYY-MM-DD'));
                    const sw = await calculateSandwichDays(
                        user._id,
                        startDateObj,
                        endDateObj,
                        holidayStrs,
                        policy?.salaryCycle?.startDay ?? 1,
                    );
                    sandwichDays = sw.totalSandwichDays;
                    sandwichDates = sw.sandwichDates;
                } catch (e) {
                    console.warn('Sandwich check failed, proceeding without:', e.message);
                }
            }
            totalDays = baseCalDays + sandwichDays;

            const alloc = await allocateCLForLeave({
                employeeId: user._id, doj,
                startDate: startDateObj, endDate: endDateObj,
                leaveDuration: body.leaveDuration,
                sandwichDays, sandwichDates,
            });

            clDays = alloc.clDays;
            lopDays = alloc.lopDays;
            isSplit = alloc.isSplit;
            isFullLOP = alloc.isFullLOP;
            clBucketSummary = alloc.clBucketSummary;

            if (isFullLOP) {
                finalLeaveType = 'LOP';
                successMessage = `No CL available — ${totalDays} day(s) applied as Loss of Pay (LOP).`;
            } else if (isSplit) {
                const desc = clBucketSummary.map(b => `${b.days}d from ${b.label}`).join(', ');
                successMessage = `Leave applied: ${clDays}d CL (${desc}) + ${lopDays}d LOP.`;
            } else {
                const desc = clBucketSummary.map(b => `${b.days}d from ${b.label}`).join(', ');
                successMessage = `Leave applied: ${totalDays}d CL deducted (${desc}).`;
            }
            if (sandwichDays > 0)
                successMessage += ` Sandwich: ${sandwichDates.map(d => dayjs.utc(d).format('DD MMM')).join(', ')} (${sandwichDays}d added).`;

            // ── SICK ───────────────────────────────────────────────────────────────
        } else if (body.leaveType === 'SICK') {
            const max = policy?.leaveTypes?.sick?.daysPerYear ?? 10;
            const used = await Leave.aggregate([
                { $match: { employee: user._id, leaveType: 'SICK', status: { $in: ['APPROVED', 'PENDING'] }, startDate: { $gte: toUTC(`${dayjs.utc().year()}-01-01`) } } },
                { $group: { _id: null, total: { $sum: '$totalDays' } } },
            ]);
            const remaining = Math.max(0, max - (used[0]?.total ?? 0));
            totalDays = baseCalDays;
            if (remaining <= 0) return res.status(400).json({ success: false, message: `Sick Leave quota (${max}d) exhausted. Apply as LOP instead.` });
            if (totalDays > remaining) return res.status(400).json({ success: false, message: `Only ${remaining} sick day(s) remaining.` });
            finalLeaveType = 'SICK';

            // ── PATERNITY ──────────────────────────────────────────────────────────
        } else if (body.leaveType === 'PATERNITY') {
            const max = policy?.leaveTypes?.paternity?.daysPerYear ?? 15;
            const used = await Leave.aggregate([
                { $match: { employee: user._id, leaveType: 'PATERNITY', status: { $in: ['APPROVED', 'PENDING'] }, startDate: { $gte: toUTC(`${dayjs.utc().year()}-01-01`) } } },
                { $group: { _id: null, total: { $sum: '$totalDays' } } },
            ]);
            const remaining = Math.max(0, max - (used[0]?.total ?? 0));
            totalDays = baseCalDays;
            if (totalDays > remaining) return res.status(400).json({ success: false, message: `Only ${remaining} paternity day(s) remaining.` });
            finalLeaveType = 'PATERNITY';

            // ── MATERNITY ──────────────────────────────────────────────────────────
        } else if (body.leaveType === 'MATERNITY') {
            const max = policy?.leaveTypes?.maternity?.daysPerYear ?? 182;
            const used = await Leave.aggregate([
                { $match: { employee: user._id, leaveType: 'MATERNITY', status: { $in: ['APPROVED', 'PENDING'] }, startDate: { $gte: toUTC(`${dayjs.utc().year()}-01-01`) } } },
                { $group: { _id: null, total: { $sum: '$totalDays' } } },
            ]);
            const remaining = Math.max(0, max - (used[0]?.total ?? 0));
            totalDays = baseCalDays;
            if (totalDays > remaining) return res.status(400).json({ success: false, message: `Only ${remaining} maternity day(s) remaining.` });
            finalLeaveType = 'MATERNITY';

            // ── Explicit LOP ───────────────────────────────────────────────────────
        } else {
            finalLeaveType = 'LOP';
            lopDays = baseCalDays;
            totalDays = baseCalDays;
        }

        if (totalDays <= 0) return res.status(400).json({ success: false, message: 'Invalid leave duration' });

        const requestId = await Leave.generateRequestId();
        const leave = new Leave({
            requestId,
            leaveType: finalLeaveType,
            leaveDuration: body.leaveDuration,
            startDate: startDateObj,
            endDate: endDateObj,
            reason: body.reason,
            totalDays, clDays, lopDays,
            isSplit, sandwichDays, sandwichDates,
            clBucketSummary,
            employee: user._id,
            employeeId: employee.employeeId,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            department: employee.department,
            designation: employee.designation,
            employeeEmail: employee.officialEmail,
        });
        await leave.save();


        sendMail({
            to: process.env.LEAVECREATEMAILID,
            subject: `New Leave Request - ${employee.firstName} ${employee.lastName} (${leave.requestId})`,
            html: leaveEmailTemplate('REQUEST_TO_HR', leave)
        }).catch(err => console.error('Error sending email:', err));

        const hrAdmins = await EmployerUser.find({ role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] }, isActive: true });
        for (const hr of hrAdmins) {
            await Notification.create({
                title: isSplit ? 'New Leave (CL + LOP Split)' : 'New Leave Request',
                description: `${employee.firstName} ${employee.lastName} — ${fmtType(finalLeaveType)} ${totalDays}d`,
                type: 'LEAVE_REQUEST', recipientType: hr.role, recipientId: hr._id, recipientModel: 'EmployerUser',
                senderId: user._id, senderModel: 'Employee', relatedEntityType: 'Leave', relatedEntityId: leave._id,
                status: 'unread', priority: 'medium',
                metadata: { requestId: leave.requestId, leaveType: leave.leaveType, isSplit, clDays, lopDays, sandwichDays },
            });
        }

        return res.status(201).json({
            success: true, message: successMessage,
            data: {
                requestId: leave.requestId,
                leaveType: fmtType(leave.leaveType),
                leaveTypeRaw: leave.leaveType,
                leaveDuration: fmtDur(leave.leaveDuration),
                startDate: toStr(leave.startDate),
                endDate: toStr(leave.endDate),
                totalDays, clDays, lopDays, isSplit, isFullLOP,
                sandwichDays, sandwichDates, clBucketSummary,
                status: 'Pending',
                appliedAt: leave.appliedAt,
            },
        });

    } catch (err) {
        console.error('createLeaveRequest error:', err);
        return res.status(500).json({ success: false, message: 'Error creating leave request', error: err.message });
    }
};


export const getBlockedDates = async (req, res) => {
    try {
        const year = parseInt(req.query.year) || dayjs.utc().year();
        const data = await getBlockedDatesForEmployee(req.user._id, year);
        return res.json({ success: true, data });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ─── EMPLOYEE: Read ───────────────────────────────────────────────────────────

export const getMyLeaveRequests = async (req, res) => {
    try {
        const v = validate(getLeavesQueryValidation, req.query);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });
        const { status, leaveType, leaveDuration, page, limit, sortBy, sortOrder } = v.data;
        const q = { employee: req.user._id };
        if (status !== 'ALL') q.status = status;
        if (leaveType !== 'ALL') q.leaveType = leaveType;
        if (leaveDuration !== 'ALL') q.leaveDuration = leaveDuration;
        const [leaves, total] = await Promise.all([
            Leave.find(q).sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 }).skip((page - 1) * limit).limit(limit).select('-__v').lean(),
            Leave.countDocuments(q),
        ]);
        return res.json({ success: true, data: { leaves: leaves.map(l => fmtLeave(l)), pagination: paginate(total, page, limit) } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getAllLeavesForCalc = async (req, res) => {
    try {
        const leaves = await Leave.find({ employee: req.user._id, status: { $in: ['PENDING', 'APPROVED'] } })
            .sort({ appliedAt: 1 }).select('-__v').lean();
        return res.json({ success: true, data: leaves.map(l => fmtLeave(l)) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getLeaveBalance = async (req, res) => {
    try {
        const v = validate(leaveBalanceValidation, req.query);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });
        const emp = await Employee.findById(req.user._id).select('isPermanentEmp').lean();
        if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });
        const balance = await calculateLeaveBalance(req.user._id, emp.isPermanentEmp || false, v.data.year);
        return res.json({ success: true, data: balance });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getCLAllocationDetailController = async (req, res) => {
    try {
        const year = parseInt(req.query.year) || dayjs.utc().year();
        const detail = await getCLAllocationDetail(req.user._id, year);
        return res.json({ success: true, data: detail });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getLeaveRequestById = async (req, res) => {
    try {
        const leave = await Leave.findOne({ requestId: req.params.leaveRequestId })
            .populate('approvedBy', 'firstName lastName email role')
            .populate('rejectedBy', 'firstName lastName email role')
            .select('-__v').lean();
        if (!leave) return res.status(404).json({ success: false, message: 'Not found' });
        const isOwner = leave.employee.toString() === req.user._id.toString();
        const isHRAdmin = ['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(req.user.role);
        if (!isOwner && !isHRAdmin) return res.status(403).json({ success: false, message: 'Not authorized' });
        return res.json({ success: true, data: fmtLeave(leave, true) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * leaveController.js — cancelLeaveRequest FINAL
 *
 * ── TWO CHANGES REQUIRED IN leaveController.js ────────────────────
 *
 * 1. At the top of the file, ADD this import
 *    (remove any old recalculateCLAllocations import if present):
 *
 *      import { recalculateAfterCancel } from '../utils/leaveRecalculation.js';
 *
 * 2. Replace the entire cancelLeaveRequest export with this function.
 * ──────────────────────────────────────────────────────────────────
 */

export const cancelLeaveRequest = async (req, res) => {
    try {
        const leave = await Leave.findOne({ requestId: req.params.leaveRequestId });
        if (!leave)
            return res.status(404).json({ success: false, message: 'Leave request not found' });

        if (leave.employee.toString() !== req.user._id.toString())
            return res.status(403).json({ success: false, message: 'Not authorised' });

        if (!['PENDING', 'APPROVED'].includes(leave.status))
            return res.status(400).json({ success: false, message: `Cannot cancel a ${leave.status.toLowerCase()} leave` });

        if (dayjs.utc(leave.startDate).startOf('day').isBefore(dayjs.utc().startOf('day')))
            return res.status(400).json({ success: false, message: 'Cannot cancel a leave that has already started' });

        // ── Save cancellation ─────────────────────────────────────────────────
        const wasApproved       = leave.status === 'APPROVED';
        const cancelledLeaveType = leave.leaveType;
        const cancelledYear     = dayjs.utc(leave.startDate).year();

        leave.status              = 'CANCELLED';
        leave.cancelledAt         = new Date();
        leave.cancelledByEmployee = true;
        await leave.save();

        // ── Email: notify HR of cancellation ─────────────────────────────────
        sendMail({
            to:      process.env.LEAVECREATEMAILID,
            subject: `Leave Cancelled – ${leave.employeeName} (${leave.requestId})`,
            html:    leaveEmailTemplate('CANCELLED_TO_HR', {
                employeeName: leave.employeeName,
                requestId:    leave.requestId,
                leaveType:    fmtType(leave.leaveType),
                startDate:    leave.startDate,
                endDate:      leave.endDate,
                totalDays:    leave.totalDays,
                wasApproved,
            }),
        }).catch(err => console.error('Error sending cancellation email:', err));

        // ── Recalculate: sandwich first, then CL/LOP FIFO ────────────────────
        let recalcResult = { sandwich: { updated: 0, changes: [] }, cl: { recalculated: 0, changes: [] }, allChanges: [] };

        if (['CASUAL', 'LOP'].includes(cancelledLeaveType)) {
            try {
                recalcResult = await recalculateAfterCancel(req.user._id, cancelledYear);
            } catch (err) {
                console.error('[cancelLeave] recalculateAfterCancel failed (non-fatal):', err.message);
            }
        }

        // ── Notifications: HR admins ──────────────────────────────────────────
        const hrAdmins = await EmployerUser.find({ role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] }, isActive: true });

        for (const hr of hrAdmins) {
            await Notification.create({
                title:            wasApproved ? 'Approved Leave Cancelled' : 'Leave Cancelled',
                description:      `${leave.employeeName} cancelled ${fmtType(leave.leaveType)} (${leave.requestId})`,
                type:             'LEAVE_CANCELLED',
                recipientType:    hr.role,
                recipientId:      hr._id,
                recipientModel:   'EmployerUser',
                senderId:         req.user._id,
                senderModel:      'Employee',
                relatedEntityType: 'Leave',
                relatedEntityId:  leave._id,
                status:           'unread',
                priority:         wasApproved ? 'high' : 'low',
            });
        }

        // ── Response ──────────────────────────────────────────────────────────
        return res.json({
            success: true,
            message: wasApproved ? 'Approved leave cancelled. HR notified.' : 'Leave cancelled successfully.',
            data: {
                requestId: leave.requestId,
                wasApproved,
                recalculation: {
                    sandwichUpdated: recalcResult.sandwich.updated,
                    leavesUpdated:   recalcResult.cl.recalculated,
                    allChanges:      recalcResult.allChanges,
                },
            },
        });

    } catch (err) {
        console.error('cancelLeaveRequest error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ─── HR/ADMIN ─────────────────────────────────────────────────────────────────

export const getAllLeaveRequests = async (req, res) => {
    try {
        const v = validate(getLeavesQueryValidation, req.query);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });
        const { status, leaveType, leaveDuration, department, startDate, endDate, page, limit, sortBy, sortOrder } = v.data;
        const q = {};
        if (status !== 'ALL') q.status = status;
        if (leaveType !== 'ALL') q.leaveType = leaveType;
        if (leaveDuration !== 'ALL') q.leaveDuration = leaveDuration;
        if (department) q.department = new RegExp(department, 'i');
        if (startDate && endDate) q.$or = [{ startDate: { $lte: toUTC(endDate) }, endDate: { $gte: toUTC(startDate) } }];

        const [leaves, total] = await Promise.all([
            Leave.find(q).sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 }).skip((page - 1) * limit).limit(limit)
                .populate('employee', 'firstName lastName officialEmail isPermanentEmp')
                .populate('approvedBy', 'firstName lastName email role')
                .populate('rejectedBy', 'firstName lastName email role')
                .select('-__v').lean(),
            Leave.countDocuments(q),
        ]);

        return res.json({
            success: true,
            data: {
                leaves: leaves.map(l => ({
                    ...fmtLeave(l),
                    employee: l.employee ? { id: l.employee._id, name: `${l.employee.firstName} ${l.employee.lastName}`, email: l.employee.officialEmail, isPermanentEmp: l.employee.isPermanentEmp ?? false } : null,
                    actionBy: l.status === 'APPROVED' && l.approvedBy ? fmtUser(l.approvedBy) : l.status === 'REJECTED' && l.rejectedBy ? fmtUser(l.rejectedBy) : null,
                    actionAt: l.status === 'APPROVED' ? l.approvedAt : l.status === 'REJECTED' ? l.rejectedAt : null,
                    comments: l.status === 'APPROVED' ? l.approvedComments : l.status === 'REJECTED' ? l.rejectedComments : null,
                })),
                pagination: paginate(total, page, limit),
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const updateLeaveStatus = async (req, res) => {
    try {
        const v = validate(updateLeaveStatusValidation, req.body);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });
        const { status, comments } = v.data;

        const leave = await Leave.findOne({ requestId: req.params.leaveRequestId });
        if (!leave) return res.status(404).json({ success: false, message: 'Not found' });
        if (leave.status !== 'PENDING') return res.status(400).json({ success: false, message: `Leave already ${leave.status.toLowerCase()}` });

        const isPastLeave = dayjs.utc(leave.startDate).startOf('day').isBefore(dayjs.utc().startOf('day'));
        const updated = status === 'APPROVED' ? await leave.approve(req.user._id, comments) : await leave.reject(req.user._id, comments);

        const emp = await Employee.findById(leave.employee).select('firstName lastName officialEmail').lean();
        if (emp) {
            await Notification.create({
                title: `Leave ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
                description: `Your ${fmtType(leave.leaveType)} (${leave.requestId}) has been ${status.toLowerCase()}.${comments ? ` Note: ${comments}` : ''}`,
                type: status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
                recipientType: 'EMPLOYEE', recipientId: leave.employee, recipientModel: 'Employee',
                senderId: req.user._id, senderModel: 'EmployerUser',
                relatedEntityType: 'Leave', relatedEntityId: leave._id,  
                status: 'unread', priority: 'medium',
            });
            setTimeout(async () => {
                await sendMail({
                    to: emp.officialEmail,
                    subject: `Leave ${status === 'APPROVED' ? 'Approved' : 'Rejected'} — ${updated.requestId}`,
                    html: leaveEmailTemplate(status === 'APPROVED' ? 'APPROVED_TO_EMPLOYEE' : 'REJECTED_TO_EMPLOYEE', leave),
                });
            }, 2000);
        }

        return res.json({ success: true, message: `Leave ${status.toLowerCase()}${isPastLeave ? ' (leave has already started)' : ''}`, data: { requestId: updated.requestId, status: fmtStatus(status), isPastLeave, comments: comments || null } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getLeaveStatistics = async (req, res) => {
    try {
        const v = validate(leaveStatsValidation, req.query);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });
        const { year, department } = v.data;
        const q = { startDate: { $gte: toUTC(`${year}-01-01`), $lte: dayjs.utc(`${year}-12-31`).endOf('day').toDate() } };
        if (department) q.department = new RegExp(department, 'i');
        if (!['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(req.user.role)) q.employee = req.user._id;
        const leaves = await Leave.find(q).lean();
        const countBy = (key, val) => leaves.filter(l => l[key] === val).length;
        return res.json({
            success: true,
            data: {
                total: leaves.length, pending: countBy('status', 'PENDING'), approved: countBy('status', 'APPROVED'), rejected: countBy('status', 'REJECTED'),
                byType: { CASUAL: countBy('leaveType', 'CASUAL'), SICK: countBy('leaveType', 'SICK'), MATERNITY: countBy('leaveType', 'MATERNITY'), PATERNITY: countBy('leaveType', 'PATERNITY'), LOP: countBy('leaveType', 'LOP') },
                approvalRate: leaves.length > 0 ? Math.round((countBy('status', 'APPROVED') / leaves.length) * 100) : 0,
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getUpcomingLeaves = async (req, res) => {
    try {
        const q = { status: 'APPROVED', startDate: { $gte: dayjs.utc().startOf('day').toDate(), $lte: dayjs.utc().add(1, 'month').toDate() } };
        if (!['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(req.user.role)) q.employee = req.user._id;
        const leaves = await Leave.find(q).sort({ startDate: 1 }).limit(10).lean();
        return res.json({ success: true, data: leaves.map(l => ({ requestId: l.requestId, employeeName: l.employeeName, leaveType: fmtType(l.leaveType), startDate: toStr(l.startDate), endDate: toStr(l.endDate), totalDays: l.totalDays, department: l.department })) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};