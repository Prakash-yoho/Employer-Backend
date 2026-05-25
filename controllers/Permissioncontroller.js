/**
 * permissionController.js
 * Handles: employee permission requests (apply, view, cancel) + HR approval.
 */

import Permission from '../model/Permission.js';
import Employee from '../model/Employee.js';
import EmployerUser from '../model/EmployerUser.js';
import Notification from '../model/Notification.js';
import LeavePolicy from '../model/LeavePolicy.js';
import { validate, sanitize, fmtStatus, toUTC, toStr, paginate } from './leaveController.js';
import {
    createPermissionValidation,
    updatePermissionStatusValidation,
} from '../validations/leaveValidation.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

// ─── Format helper ────────────────────────────────────────────────────────────

const fmtPerm = (p) => ({
    id:               p._id,
    requestId:        p.requestId,
    employeeName:     p.employeeName,
    employeeId:       p.employeeId,
    department:       p.department,
    date:             toStr(p.date),
    fromTime:         p.fromTime,
    toTime:           p.toTime,
    durationHours:    p.durationHours,
    durationText:     p.durationText,
    reason:           p.reason,
    status:           fmtStatus(p.status),
    appliedAt:        p.appliedAt,
    approvedComments: p.approvedComments,
    rejectedComments: p.rejectedComments,
});

// ─── EMPLOYEE: Apply permission ───────────────────────────────────────────────

export const createPermissionRequest = async (req, res) => {
    try {
        const v = validate(createPermissionValidation, req.body);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });
        const { date, fromTime, toTime, reason } = v.data;

        const [fH, fM] = fromTime.split(':').map(Number);
        const [tH, tM] = toTime.split(':').map(Number);
        const totalMins = (tH * 60 + tM) - (fH * 60 + fM);

        if (totalMins <= 0) return res.status(400).json({ success: false, message: 'toTime must be after fromTime' });
        if (totalMins > 60) return res.status(400).json({ success: false, message: 'Max 1 hour per permission request' });

        const durationHours = +(totalMins / 60).toFixed(4);
        const durationText  = [
            Math.floor(totalMins / 60) > 0 ? `${Math.floor(totalMins / 60)}h` : '',
            totalMins % 60 > 0             ? `${totalMins % 60}min`           : '',
        ].filter(Boolean).join(' ');

        const policy       = await LeavePolicy.findOne({ isActive: true }).lean();
        const maxPermHours = policy?.permissionLeave?.hoursPerMonth ?? 2;
        const sDay         = policy?.salaryCycle?.startDay ?? 21;

        const reqDate    = toUTC(date);
        const refD       = dayjs.utc(reqDate);
        const cycleStart = refD.date() >= sDay
            ? refD.date(sDay).startOf('day')
            : refD.subtract(1, 'month').date(sDay).startOf('day');
        const cycleEnd   = cycleStart.add(1, 'month').subtract(1, 'day').endOf('day');

        const existing = await Permission.find({
            employee: req.user._id,
            date:     { $gte: cycleStart.toDate(), $lte: cycleEnd.toDate() },
            status:   { $in: ['PENDING', 'APPROVED'] },
        }).lean();

        const usedHours      = +existing.reduce((s, p) => s + (p.durationHours || 0), 0).toFixed(2);
        const remainingHours = +(maxPermHours - usedHours).toFixed(2);

        if (remainingHours <= 0)
            return res.status(400).json({ success: false, message: `Full ${maxPermHours}h quota used this cycle. Apply for a half-day leave instead.` });
        if (durationHours > remainingHours)
            return res.status(400).json({ success: false, message: `Only ${Math.round(remainingHours * 60)}min remaining. Requested ${totalMins}min.` });

        // Time overlap check for the same day
        const overlap = existing.find(p => {
            if (dayjs.utc(p.date).format('YYYY-MM-DD') !== dayjs.utc(reqDate).format('YYYY-MM-DD')) return false;
            const [pfH, pfM] = p.fromTime.split(':').map(Number);
            const [ptH, ptM] = p.toTime.split(':').map(Number);
            return fH * 60 + fM < ptH * 60 + ptM && tH * 60 + tM > pfH * 60 + pfM;
        });
        if (overlap)
            return res.status(400).json({ success: false, message: `Overlaps with existing permission (${overlap.fromTime}–${overlap.toTime})` });

        const emp = await Employee.findById(req.user._id)
            .select('employeeId firstName lastName department designation officialEmail').lean();
        if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

        const requestId  = await Permission.generateRequestId();
        const permission = new Permission({
            requestId,
            employee:     req.user._id,
            employeeId:   emp.employeeId,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            department:   emp.department,
            designation:  emp.designation,
            date:         reqDate,
            fromTime,     toTime,
            durationHours, durationText,
            reason:       sanitize(reason),
        });
        await permission.save();

        const hrAdmins = await EmployerUser.find({ role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] }, isActive: true });
        for (const hr of hrAdmins) {
            await Notification.create({
                title:       'New Permission Request',
                description: `${emp.firstName} ${emp.lastName} — ${dayjs.utc(reqDate).format('DD MMM')} ${fromTime}–${toTime}`,
                type: 'LEAVE_REQUEST', recipientType: hr.role, recipientId: hr._id, recipientModel: 'EmployerUser',
                senderId: req.user._id, senderModel: 'Employee',
                relatedEntityType: 'Permission', relatedEntityId: permission._id,
                status: 'unread', priority: 'low',
            });
        }

        const usedAfter = +(usedHours + durationHours).toFixed(2);
        return res.status(201).json({
            success: true,
            message: `Permission submitted (${totalMins}min). ${Math.round((maxPermHours - usedAfter) * 60)}min remaining this cycle.`,
            data: {
                requestId:          permission.requestId,
                date:               toStr(permission.date),
                fromTime,           toTime,
                duration:           durationText,
                usedThisCycle:      usedAfter,
                remainingThisCycle: +(maxPermHours - usedAfter).toFixed(2),
                status:             'Pending',
            },
        });
    } catch (err) {
        console.error('createPermissionRequest error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ─── EMPLOYEE: My permissions ─────────────────────────────────────────────────

export const getMyPermissions = async (req, res) => {
    try {
        const page  = parseInt(req.query.page)  || 1;
        const limit = parseInt(req.query.limit) || 10;
        const [perms, total] = await Promise.all([
            Permission.find({ employee: req.user._id }).sort({ appliedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Permission.countDocuments({ employee: req.user._id }),
        ]);
        return res.json({ success: true, data: { permissions: perms.map(fmtPerm), pagination: paginate(total, page, limit) } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const cancelPermissionRequest = async (req, res) => {
    try {
        const p = await Permission.findOne({ requestId: req.params.requestId, employee: req.user._id });
        if (!p) return res.status(404).json({ success: false, message: 'Not found' });
        if (p.status !== 'PENDING') return res.status(400).json({ success: false, message: `Cannot cancel a ${p.status.toLowerCase()} permission` });
        await p.deleteOne();
        return res.json({ success: true, message: 'Permission cancelled' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ─── HR/ADMIN ─────────────────────────────────────────────────────────────────

export const getAllPermissions = async (req, res) => {
    try {
        const status = req.query.status || 'ALL';
        const page   = parseInt(req.query.page)  || 1;
        const limit  = parseInt(req.query.limit) || 10;
        const q      = status !== 'ALL' ? { status } : {};
        const [perms, total] = await Promise.all([
            Permission.find(q).sort({ appliedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Permission.countDocuments(q),
        ]);
        return res.json({ success: true, data: { permissions: perms.map(fmtPerm), pagination: paginate(total, page, limit) } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const updatePermissionStatus = async (req, res) => {
    try {
        const v = validate(updatePermissionStatusValidation, req.body);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });
        const { status, comments } = v.data;

        const p = await Permission.findOne({ requestId: req.params.requestId });
        if (!p) return res.status(404).json({ success: false, message: 'Not found' });
        if (p.status !== 'PENDING') return res.status(400).json({ success: false, message: `Already ${p.status.toLowerCase()}` });

        if (status === 'APPROVED') {
            p.status = 'APPROVED'; p.approvedBy = req.user._id; p.approvedComments = comments || null; p.approvedAt = new Date();
        } else {
            p.status = 'REJECTED'; p.rejectedBy = req.user._id; p.rejectedComments = comments || null; p.rejectedAt = new Date();
        }
        await p.save();

        await Notification.create({
            title:       `Permission ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
            description: `Your permission (${p.requestId}) has been ${status.toLowerCase()}.`,
            type: status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
            recipientType: 'EMPLOYEE', recipientId: p.employee, recipientModel: 'Employee',
            senderId: req.user._id, senderModel: 'EmployerUser',
            relatedEntityType: 'Permission', relatedEntityId: p._id,
            status: 'unread', priority: 'low',
        });

        return res.json({ success: true, message: `Permission ${status.toLowerCase()}`, data: { requestId: p.requestId, status: fmtStatus(status) } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};