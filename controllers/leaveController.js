import Leave from '../model/Leave.js';
import Employee from '../model/Employee.js';
import EmployerUser from '../model/EmployerUser.js';
import Notification from '../model/Notification.js';
import mongoose from 'mongoose';

// Import Joi validation schemas
import {
    createLeaveValidation,
    updateLeaveStatusValidation,
    getLeavesQueryValidation,
    leaveStatsValidation,
    leaveBalanceValidation
} from '../validations/leaveValidation.js';
import { sendMail } from '../utils/mailer.js';
import { leaveEmailTemplate } from '../utils/Employer/emailTemplates.js';

// Helper function for validation
const validateRequest = (schema, data) => {
    const { error, value } = schema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });

    if (error) {
        const formattedErrors = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message.replace(/['"]/g, ''),
            type: detail.type
        }));

        return {
            isValid: false,
            errors: formattedErrors
        };
    }

    return {
        isValid: true,
        data: value
    };
};

// Create leave request (Employee only)
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
            .select('employeeId firstName lastName department designation officialEmail')
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }
        const overlappingLeave = await Leave.checkOverlap(
            user._id,
            validatedData.startDate,
            validatedData.endDate,
            validatedData.leaveDuration
        );

        if (overlappingLeave) {
            const conflictMessage = overlappingLeave.leaveDuration === 'FULL_DAY'
                ? 'You already have a full day leave'
                : `You already have a ${overlappingLeave.leaveDuration === 'FIRST_HALF' ? 'first half' : 'second half'} leave`;

            return res.status(400).json({
                success: false,
                message: `${conflictMessage} for these dates`,
                conflictingLeave: {
                    requestId: overlappingLeave.requestId,
                    leaveDuration: overlappingLeave.leaveDuration === 'FULL_DAY' ? 'Full Day' :
                        overlappingLeave.leaveDuration === 'FIRST_HALF' ? 'First Half' : 'Second Half',
                    startDate: overlappingLeave.startDate,
                    endDate: overlappingLeave.endDate,
                    status: overlappingLeave.status === 'PENDING' ? 'Pending' :
                        overlappingLeave.status === 'APPROVED' ? 'Approved' : 'Rejected'
                }
            });
        }

        const requestId = await Leave.generateRequestId();

        const startDateObj = new Date(validatedData.startDate);
        startDateObj.setHours(0, 0, 0, 0);

        let endDateObj = new Date(validatedData.endDate);
        endDateObj.setHours(0, 0, 0, 0);

        if (validatedData.leaveDuration !== 'FULL_DAY') {
            endDateObj = new Date(startDateObj);
        }

        let totalDays = 0;
        if (validatedData.leaveDuration === 'FULL_DAY') {
            const timeDiff = endDateObj.getTime() - startDateObj.getTime();
            totalDays = Math.floor(timeDiff / (1000 * 3600 * 24)) + 1;
        } else {
            totalDays = 0.5;
        }

        const leaveRequest = new Leave({
            requestId,
            leaveType: validatedData.leaveType.toUpperCase(),
            leaveDuration: validatedData.leaveDuration.toUpperCase(),
            startDate: startDateObj,
            endDate: endDateObj,
            reason: validatedData.reason,
            totalDays,
            employee: user._id,
            employeeId: employee.employeeId,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            department: employee.department,
            designation: employee.designation,
            employeeEmail: employee.officialEmail
        });

        await leaveRequest.save();
        let durationText = '';
        if (leaveRequest.leaveDuration === 'FULL_DAY') {
            durationText = totalDays === 1 ? '1 day' : `${totalDays} days`;
        } else if (leaveRequest.leaveDuration === 'FIRST_HALF') {
            durationText = 'first half (9 AM - 1 PM)';
        } else if (leaveRequest.leaveDuration === 'SECOND_HALF') {
            durationText = 'second half (1 PM - 5 PM)';
        }

        let dateText = '';
        if (startDateObj.toDateString() === endDateObj.toDateString()) {
            dateText = startDateObj.toLocaleDateString();
        } else {
            dateText = `${startDateObj.toLocaleDateString()} to ${endDateObj.toLocaleDateString()}`;
        }

        const hrAdmins = await EmployerUser.find({
            role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
            isActive: true
        });

        for (const hrAdmin of hrAdmins) {
            if (hrAdmin?.role === 'EMPLOYER_HR') {
                sendMail({
                    to: hrAdmin.email,
                    subject: `New Leave Request - ${employee.firstName} ${employee.lastName} (${leaveRequest.requestId})`,
                    html: leaveEmailTemplate('REQUEST_TO_HR', leaveRequest)
                }).catch(err => console.error('Error sending email:', err));
            }

            await Notification.create({
                title: 'New Leave Request',
                description: `${employee.firstName} ${employee.lastName} has requested ${validatedData.leaveType.toLowerCase()} leave for ${durationText} on ${dateText}`,
                type: 'LEAVE_REQUEST',
                recipientType: hrAdmin.role,
                recipientId: hrAdmin._id,
                recipientModel: 'EmployerUser',
                senderId: user._id,
                senderModel: 'Employee',
                relatedEntityType: 'Leave',
                relatedEntityId: leaveRequest._id,
                status: 'unread',
                priority: 'medium',
                metadata: {
                    requestId: leaveRequest.requestId,
                    leaveType: leaveRequest.leaveType,
                    leaveDuration: leaveRequest.leaveDuration,
                    employeeName: leaveRequest.employeeName
                }
            });
        }

        res.status(201).json({
            success: true,
            message: 'Leave request submitted successfully',
            data: {
                requestId: leaveRequest.requestId,
                leaveType: leaveRequest.leaveType === 'CASUAL' ? 'Casual Leave' :
                    leaveRequest.leaveType === 'SICK' ? 'Sick Leave' : 'Other Leave',
                leaveDuration: leaveRequest.leaveDuration === 'FULL_DAY' ? 'Full Day' :
                    leaveRequest.leaveDuration === 'FIRST_HALF' ? 'First Half' : 'Second Half',
                startDate: leaveRequest.startDate,
                endDate: leaveRequest.endDate,
                totalDays: leaveRequest.totalDays,
                status: 'Pending',
                appliedAt: leaveRequest.appliedAt,
                reason: leaveRequest.reason
            }
        });

    } catch (error) {
        console.error('Error creating leave request:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating leave request',
            error: error.message
        });
    }
};

// Get my leave requests (Employee only)
export const getMyLeaveRequests = async (req, res) => {
    try {
        const user = req.user;

        // Validate query parameters
        const validation = validateRequest(getLeavesQueryValidation, req.query);

        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const {
            status = 'ALL',
            leaveDuration = 'ALL',
            page = 1,
            limit = 10,
            sortBy = 'appliedAt',
            sortOrder = 'desc'
        } = validation.data;

        // Build query
        const query = { employee: user._id };

        if (status !== 'ALL') {
            query.status = status;
        }

        if (leaveDuration !== 'ALL') {
            query.leaveDuration = leaveDuration;
        }

        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Get leaves with pagination
        const [leaves, total] = await Promise.all([
            Leave.find(query)
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit))
                .select('-__v')
                .lean(),
            Leave.countDocuments(query)
        ]);

        // Format dates and add display properties
        const formattedLeaves = leaves.map(leave => ({
            id: leave._id,
            requestId: leave.requestId,
            leaveType: leave.leaveType === 'CASUAL' ? 'Casual Leave' :
                leave.leaveType === 'SICK' ? 'Sick Leave' : 'Other Leave',
            leaveDuration: leave.leaveDuration === 'FULL_DAY' ? 'Full Day' :
                leave.leaveDuration === 'FIRST_HALF' ? 'First Half' : 'Second Half',
            startDate: leave.startDate.toISOString().split('T')[0],
            endDate: leave.endDate.toISOString().split('T')[0],
            totalDays: leave.totalDays,
            reason: leave.reason,
            status: leave.status === 'PENDING' ? 'Pending' :
                leave.status === 'APPROVED' ? 'Approved' : 'Rejected',
            employeeName: leave.employeeName,
            department: leave.department,
            appliedAt: leave.appliedAt.toISOString(),
            approvedBy: leave.approvedBy,
            rejectedBy: leave.rejectedBy,
            approvedComments: leave.approvedComments,
            rejectedComments: leave.rejectedComments,
            approvedAt: leave.approvedAt ? leave.approvedAt.toISOString() : null,
            rejectedAt: leave.rejectedAt ? leave.rejectedAt.toISOString() : null
        }));

        // Calculate pagination info
        const totalPages = Math.ceil(total / parseInt(limit));
        const hasNext = parseInt(page) < totalPages;
        const hasPrev = parseInt(page) > 1;

        res.json({
            success: true,
            message: 'Leave requests fetched successfully',
            data: {
                leaves: formattedLeaves,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext,
                    hasPrev
                }
            }
        });

    } catch (error) {
        console.error('Error fetching leave requests:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leave requests',
            error: error.message
        });
    }
};

// Get leave request by ID
export const getLeaveRequestById = async (req, res) => {
    try {
        const { leaveRequestId } = req.params;
        const user = req.user;

        // Find leave request
        const leaveRequest = await Leave.findOne({ requestId: leaveRequestId })
            .populate('approvedBy', 'firstName lastName email role')
            .populate('rejectedBy', 'firstName lastName email role')
            .select('-__v')
            .lean();

        if (!leaveRequest) {
            return res.status(404).json({
                success: false,
                message: 'Leave request not found'
            });
        }

        // Check authorization
        const isEmployeeOwner = leaveRequest.employee.toString() === user._id.toString();
        const isHRAdmin = user.role && ['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(user.role);

        if (!isEmployeeOwner && !isHRAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view this leave request'
            });
        }

        // Format the response
        const formattedLeave = {
            id: leaveRequest._id,
            requestId: leaveRequest.requestId,
            leaveType: leaveRequest.leaveType === 'CASUAL' ? 'Casual Leave' :
                leaveRequest.leaveType === 'SICK' ? 'Sick Leave' : 'Other Leave',
            leaveDuration: leaveRequest.leaveDuration === 'FULL_DAY' ? 'Full Day' :
                leaveRequest.leaveDuration === 'FIRST_HALF' ? 'First Half' : 'Second Half',
            startDate: leaveRequest.startDate.toISOString().split('T')[0],
            endDate: leaveRequest.endDate.toISOString().split('T')[0],
            totalDays: leaveRequest.totalDays,
            reason: leaveRequest.reason,
            status: leaveRequest.status === 'PENDING' ? 'Pending' :
                leaveRequest.status === 'APPROVED' ? 'Approved' : 'Rejected',
            employee: {
                id: leaveRequest.employee,
                employeeId: leaveRequest.employeeId,
                name: leaveRequest.employeeName,
                department: leaveRequest.department,
                designation: leaveRequest.designation
            },
            appliedAt: leaveRequest.appliedAt.toISOString(),
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
            approvedAt: leaveRequest.approvedAt ? leaveRequest.approvedAt.toISOString() : null,
            rejectedAt: leaveRequest.rejectedAt ? leaveRequest.rejectedAt.toISOString() : null,
            updatedAt: leaveRequest.updatedAt.toISOString()
        };

        res.json({
            success: true,
            message: 'Leave request fetched successfully',
            data: formattedLeave
        });

    } catch (error) {
        console.error('Error fetching leave request:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leave request',
            error: error.message
        });
    }
};

// Get all leave requests (HR/Admin only)
export const getAllLeaveRequests = async (req, res) => {
    try {
        const user = req.user;

        // Validate query parameters
        const validation = validateRequest(getLeavesQueryValidation, req.query);

        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const {
            status = 'ALL',
            leaveType = 'ALL',
            leaveDuration = 'ALL',
            department,
            startDate,
            endDate,
            page = 1,
            limit = 10,
            sortBy = 'appliedAt',
            sortOrder = 'desc'
        } = validation.data;

        // Build query
        const query = {};

        if (status !== 'ALL') {
            query.status = status;
        }

        if (leaveType !== 'ALL') {
            query.leaveType = leaveType;
        }

        if (leaveDuration !== 'ALL') {
            query.leaveDuration = leaveDuration;
        }

        if (department) {
            query.department = new RegExp(department, 'i');
        }

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            query.$or = [
                {
                    startDate: { $lte: end },
                    endDate: { $gte: start }
                }
            ];
        } else if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            query.startDate = { $gte: start };
        } else if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            query.endDate = { $lte: end };
        }

        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Get leaves with pagination
        const [leaves, total] = await Promise.all([
            Leave.find(query)
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit))
                .populate('employee', 'firstName lastName officialEmail')
                .populate('approvedBy', 'firstName lastName email role')
                .populate('rejectedBy', 'firstName lastName email role')
                .select('-__v')
                .lean(),
            Leave.countDocuments(query)
        ]);

        // console.log(leaves,"All Leaves")

        // Format response
        const formattedLeaves = leaves.map(leave => ({
            id: leave._id,
            requestId: leave.requestId,
            leaveType:
                leave.leaveType === 'CASUAL'
                    ? 'Casual Leave'
                    : leave.leaveType === 'SICK'
                        ? 'Sick Leave'
                        : 'Other Leave',
            leaveDuration:
                leave.leaveDuration === 'FULL_DAY'
                    ? 'Full Day'
                    : leave.leaveDuration === 'FIRST_HALF'
                        ? 'First Half'
                        : 'Second Half',

            startDate: leave.startDate.toISOString().split('T')[0],
            endDate: leave.endDate.toISOString().split('T')[0],
            totalDays: leave.totalDays,
            reason: leave.reason,
            status: leave.status === 'PENDING' ? 'Pending' :
                leave.status === 'APPROVED' ? 'Approved' : 'Rejected',
            employee: leave.employee ? {
                id: leave.employee._id,
                name: `${leave.employee.firstName} ${leave.employee.lastName}`,
                email: leave.employee.officialEmail
            } : null,
            employeeName: leave.employeeName,
            department: leave.department,
            appliedAt: leave.appliedAt.toISOString(),
            actionBy:
                leave.status === 'APPROVED' && leave.approvedBy
                    ? {
                        id: leave.approvedBy._id,
                        name: `${leave.approvedBy.firstName} ${leave.approvedBy.lastName}`,
                        email: leave.approvedBy.email,
                        role: leave.approvedBy.role
                    }
                    : leave.status === 'REJECTED' && leave.rejectedBy
                        ? {
                            id: leave.rejectedBy._id,
                            name: `${leave.rejectedBy.firstName} ${leave.rejectedBy.lastName}`,
                            email: leave.rejectedBy.email,
                            role: leave.rejectedBy.role
                        }
                        : null,

            actionAt:
                leave.status === 'APPROVED'
                    ? leave.approvedAt
                    : leave.status === 'REJECTED'
                        ? leave.rejectedAt
                        : null,

            comments:
                leave.status === 'APPROVED'
                    ? leave.approvedComments
                    : leave.status === 'REJECTED'
                        ? leave.rejectedComments
                        : null
        }));


        // console.log(formattedLeaves,"fjelhn")

        // Calculate pagination info
        const totalPages = Math.ceil(total / parseInt(limit));
        const hasNext = parseInt(page) < totalPages;
        const hasPrev = parseInt(page) > 1;

        res.json({
            success: true,
            message: 'Leave requests fetched successfully',
            data: {
                leaves: formattedLeaves,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext,
                    hasPrev
                }
            }
        });

    } catch (error) {
        console.error('Error fetching leave requests:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leave requests',
            error: error.message
        });
    }
};

// Update leave status (HR/Admin only)
export const updateLeaveStatus = async (req, res) => {
    try {
        const user = req.user;
        const { leaveRequestId } = req.params;

        // Validate request body
        const validation = validateRequest(updateLeaveStatusValidation, req.body);

        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { status, comments } = validation.data;

        // Find leave request
        const leaveRequest = await Leave.findOne({ requestId: leaveRequestId });

        if (!leaveRequest) {
            return res.status(404).json({
                success: false,
                message: 'Leave request not found'
            });
        }

        // Check if status is already set
        if (leaveRequest.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Leave request is already ${leaveRequest.status.toLowerCase()}`,
                currentStatus: leaveRequest.status === 'PENDING' ? 'Pending' :
                    leaveRequest.status === 'APPROVED' ? 'Approved' : 'Rejected'
            });
        }

        // Update status
        let updatedLeave;
        if (status === 'APPROVED') {
            updatedLeave = await leaveRequest.approve(user._id, comments);

            // Get employee details for notification
            const employee = await Employee.findById(leaveRequest.employee)
                .select('firstName lastName personalEmail')
                .lean();

            if (employee) {
                // Create approval notification
                await Notification.create({
                    title: 'Leave Request Approved',
                    description: `Your ${leaveRequest.leaveType.toLowerCase()} leave request (${leaveRequest.requestId}) has been approved.${comments ? ` Comments: ${comments}` : ''}`,
                    type: 'LEAVE_APPROVED',
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
                        leaveType: leaveRequest.leaveType,
                        approvedBy: `${user.firstName} ${user.lastName}`
                    }
                });

                const toEmail = employee.personalEmail;

                setTimeout(async () => {
                    await sendMail({
                        to: toEmail,
                        subject: `Leave Request Approved - ${updatedLeave.requestId}`,
                        html: leaveEmailTemplate('APPROVED_TO_EMPLOYEE', leaveRequest)
                    });
                }, 2000);

            }

        } else if (status === 'REJECTED') {
            updatedLeave = await leaveRequest.reject(user._id, comments);
            // Get employee details for notification
            const employee = await Employee.findById(leaveRequest.employee)
                .select('firstName lastName personalEmail')
                .lean();

            if (employee) {
                // Create rejection notification
                await Notification.create({
                    title: 'Leave Request Rejected',
                    description: `Your ${leaveRequest.leaveType.toLowerCase()} leave request (${leaveRequest.requestId}) has been rejected.${comments ? ` Reason: ${comments}` : ''}`,
                    type: 'LEAVE_REJECTED',
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
                        leaveType: leaveRequest.leaveType,
                        rejectedBy: `${user.firstName} ${user.lastName}`
                    }
                });

                const toEmail = employee.personalEmail

                setTimeout(async () => {
                    await sendMail({
                        to: toEmail,
                        subject: `Leave Request Update - ${updatedLeave.requestId}`,
                        html: leaveEmailTemplate('REJECTED_TO_EMPLOYEE', leaveRequest)
                    });
                }, 2000);
            }
        }

        res.json({
            success: true,
            message: `Leave request ${status.toLowerCase()} successfully`,
            data: {
                requestId: updatedLeave.requestId,
                status: status === 'APPROVED' ? 'Approved' : 'Rejected',
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
        console.error('Error updating leave status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating leave status',
            error: error.message
        });
    }
};

// Get leave statistics
export const getLeaveStatistics = async (req, res) => {
    try {
        const user = req.user;

        // Validate query parameters
        const validation = validateRequest(leaveStatsValidation, req.query);

        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { year = new Date().getFullYear(), department } = validation.data;

        // Build query based on user role
        let query = {};

        if (department) {
            query.department = new RegExp(department, 'i');
        }

        if (user.role && ['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(user.role)) {
            // HR/Admin can see all departments
        } else {
            // Employee can only see their own data
            query.employee = user._id;
        }

        // Get date range for the year
        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

        query.appliedAt = { $gte: startOfYear, $lte: endOfYear };

        // Get all leaves for the year
        const leaves = await Leave.find(query).lean();

        // Calculate statistics including half-days
        const stats = {
            total: leaves.length,
            pending: leaves.filter(l => l.status === 'PENDING').length,
            approved: leaves.filter(l => l.status === 'APPROVED').length,
            rejected: leaves.filter(l => l.status === 'REJECTED').length,

            byType: {
                CASUAL: leaves.filter(l => l.leaveType === 'CASUAL').length,
                SICK: leaves.filter(l => l.leaveType === 'SICK').length,
                OTHER: leaves.filter(l => l.leaveType === 'OTHER').length
            },

            byDuration: {
                FULL_DAY: leaves.filter(l => l.leaveDuration === 'FULL_DAY').length,
                FIRST_HALF: leaves.filter(l => l.leaveDuration === 'FIRST_HALF').length,
                SECOND_HALF: leaves.filter(l => l.leaveDuration === 'SECOND_HALF').length
            },

            byMonth: Array(12).fill(0).map((_, index) => {
                const monthLeaves = leaves.filter(l => {
                    const date = new Date(l.appliedAt);
                    return date.getMonth() === index;
                });

                return {
                    month: new Date(year, index).toLocaleString('default', { month: 'short' }),
                    count: monthLeaves.length,
                    fullDay: monthLeaves.filter(l => l.leaveDuration === 'FULL_DAY').length,
                    firstHalf: monthLeaves.filter(l => l.leaveDuration === 'FIRST_HALF').length,
                    secondHalf: monthLeaves.filter(l => l.leaveDuration === 'SECOND_HALF').length,
                    approved: monthLeaves.filter(l => l.status === 'APPROVED').length,
                    rejected: monthLeaves.filter(l => l.status === 'REJECTED').length
                };
            }),

            totalDays: {
                approved: leaves
                    .filter(l => l.status === 'APPROVED')
                    .reduce((sum, l) => sum + l.totalDays, 0),
                pending: leaves
                    .filter(l => l.status === 'PENDING')
                    .reduce((sum, l) => sum + l.totalDays, 0),
                fullDay: leaves
                    .filter(l => l.leaveDuration === 'FULL_DAY' && l.status === 'APPROVED')
                    .reduce((sum, l) => sum + l.totalDays, 0),
                halfDay: leaves
                    .filter(l => l.leaveDuration !== 'FULL_DAY' && l.status === 'APPROVED')
                    .length * 0.5
            }
        };

        // Calculate percentages
        stats.approvalRate = stats.total > 0
            ? Math.round((stats.approved / stats.total) * 100)
            : 0;

        stats.rejectionRate = stats.total > 0
            ? Math.round((stats.rejected / stats.total) * 100)
            : 0;

        stats.halfDayPercentage = stats.total > 0
            ? Math.round(((stats.byDuration.FIRST_HALF + stats.byDuration.SECOND_HALF) / stats.total) * 100)
            : 0;

        res.json({
            success: true,
            message: 'Leave statistics fetched successfully',
            data: stats
        });

    } catch (error) {
        console.error('Error fetching leave statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leave statistics',
            error: error.message
        });
    }
};

// Get leave balance
export const getLeaveBalance = async (req, res) => {
    try {
        const user = req.user;

        // Validate query parameters
        const validation = validateRequest(leaveBalanceValidation, req.query);

        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        const { year = new Date().getFullYear() } = validation.data;

        // Company policy (you can customize this)
        const policy = {
            casualLeaves: 12, // 12 casual leaves per year
            sickLeaves: 10,   // 10 sick leaves per year
            otherLeaves: 5,   // 5 other leaves per year
            halfDayAllowed: true,
            maxHalfDaysPerMonth: 4
        };

        // Get date range for the year
        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

        // Get all approved leaves for the year
        const approvedLeaves = await Leave.find({
            employee: user._id,
            status: 'APPROVED',
            appliedAt: { $gte: startOfYear, $lte: endOfYear }
        }).lean();

        // Calculate used leaves by type and duration
        let usedCasual = 0;
        let usedSick = 0;
        let usedOther = 0;
        let usedHalfDays = 0;

        approvedLeaves.forEach(leave => {
            const leaveCount = leave.leaveDuration === 'FULL_DAY' ? leave.totalDays : 0.5;

            if (leave.leaveType === 'CASUAL') {
                usedCasual += leaveCount;
            } else if (leave.leaveType === 'SICK') {
                usedSick += leaveCount;
            } else if (leave.leaveType === 'OTHER') {
                usedOther += leaveCount;
            }

            if (leave.leaveDuration !== 'FULL_DAY') {
                usedHalfDays += 1;
            }
        });

        // Calculate balance
        const balance = {
            casual: {
                total: policy.casualLeaves,
                used: usedCasual,
                remaining: Math.max(0, policy.casualLeaves - usedCasual),
                usedPercentage: Math.round((usedCasual / policy.casualLeaves) * 100)
            },
            sick: {
                total: policy.sickLeaves,
                used: usedSick,
                remaining: Math.max(0, policy.sickLeaves - usedSick),
                usedPercentage: Math.round((usedSick / policy.sickLeaves) * 100)
            },
            other: {
                total: policy.otherLeaves,
                used: usedOther,
                remaining: Math.max(0, policy.otherLeaves - usedOther),
                usedPercentage: Math.round((usedOther / policy.otherLeaves) * 100)
            },
            halfDays: {
                total: policy.maxHalfDaysPerMonth * 12,
                used: usedHalfDays,
                remaining: Math.max(0, (policy.maxHalfDaysPerMonth * 12) - usedHalfDays),
                usedPercentage: Math.round((usedHalfDays / (policy.maxHalfDaysPerMonth * 12)) * 100)
            },
            summary: {
                totalDaysTaken: usedCasual + usedSick + usedOther,
                totalHalfDaysTaken: usedHalfDays,
                averageLeavesPerMonth: ((usedCasual + usedSick + usedOther) / (new Date().getMonth() + 1)).toFixed(1)
            }
        };

        res.json({
            success: true,
            message: 'Leave balance fetched successfully',
            data: balance
        });

    } catch (error) {
        console.error('Error fetching leave balance:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leave balance',
            error: error.message
        });
    }
};

// Cancel leave request (Employee only)
export const cancelLeaveRequest = async (req, res) => {
    try {
        const user = req.user;
        const { leaveRequestId } = req.params;

        // Find leave request
        const leaveRequest = await Leave.findOne({ requestId: leaveRequestId });

        if (!leaveRequest) {
            return res.status(404).json({
                success: false,
                message: 'Leave request not found'
            });
        }

        // Check authorization
        if (leaveRequest.employee.toString() !== user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to cancel this leave request'
            });
        }

        // Check if status is PENDING
        if (leaveRequest.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel ${leaveRequest.status === 'APPROVED' ? 'approved' : 'rejected'} leave request`
            });
        }

        // Delete the leave request
        await leaveRequest.deleteOne();

        // Notify HR/Admin
        const hrAdmins = await EmployerUser.find({
            role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
            isActive: true
        });

        for (const hrAdmin of hrAdmins) {
            // Create cancellation notification
            await Notification.create({
                title: 'Leave Request Cancelled',
                description: `${leaveRequest.employeeName} has cancelled their ${leaveRequest.leaveType.toLowerCase()} leave request (${leaveRequest.requestId})`,
                type: 'LEAVE_CANCELLED',
                recipientType: hrAdmin.role,
                recipientId: hrAdmin._id,
                recipientModel: 'EmployerUser',
                senderId: user._id,
                senderModel: 'Employee',
                relatedEntityType: 'Leave',
                relatedEntityId: leaveRequest._id,
                status: 'unread',
                priority: 'low',
                metadata: {
                    requestId: leaveRequest.requestId,
                    leaveType: leaveRequest.leaveType
                }
            });
        }

        res.json({
            success: true,
            message: 'Leave request cancelled successfully',
            data: {
                requestId: leaveRequest.requestId,
                cancelledAt: new Date()
            }
        });

    } catch (error) {
        console.error('Error cancelling leave request:', error);
        res.status(500).json({
            success: false,
            message: 'Error cancelling leave request',
            error: error.message
        });
    }
};

// Get upcoming leaves (for dashboard)
export const getUpcomingLeaves = async (req, res) => {
    try {
        const user = req.user;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());

        let query = {
            status: 'APPROVED',
            startDate: { $gte: today, $lte: nextMonth }
        };

        // If employee, only show their leaves
        // If HR/Admin, show all leaves
        if (!user.role || !['EMPLOYER_HR', 'EMPLOYER_ADMIN'].includes(user.role)) {
            query.employee = user._id;
        }

        const upcomingLeaves = await Leave.find(query)
            .sort({ startDate: 1 })
            .limit(10)
            .select('requestId employeeName startDate endDate totalDays department leaveDuration')
            .lean();

        // Format the response
        const formattedLeaves = upcomingLeaves.map(leave => ({
            id: leave._id,
            requestId: leave.requestId,
            employeeName: leave.employeeName,
            leaveDuration: leave.leaveDuration === 'FULL_DAY' ? 'Full Day' :
                leave.leaveDuration === 'FIRST_HALF' ? 'First Half' : 'Second Half',
            startDate: leave.startDate.toISOString().split('T')[0],
            endDate: leave.endDate.toISOString().split('T')[0],
            totalDays: leave.totalDays,
            department: leave.department
        }));

        res.json({
            success: true,
            message: 'Upcoming leaves fetched successfully',
            data: formattedLeaves
        });

    } catch (error) {
        console.error('Error fetching upcoming leaves:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching upcoming leaves',
            error: error.message
        });
    }
};