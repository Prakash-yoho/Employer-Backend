import Ticket from '../model/Ticket.js';
import Employee from '../model/Employee.js';
import {
    createTicketSchema,
    updateTicketSchema,
    resolveTicketSchema,
    forwardToITSchema,
    getTicketsQuerySchema,
    askQuestionSchema,
    answerQuestionSchema
} from '../validations/ticketValidation.js';
import EmployerUser from '../model/EmployerUser.js';
import NotificationService from '../services/notificationService.js';
import Notification from '../model/Notification.js';
import {
    uploadTicketAttachmentToS3,
    getTicketAttachmentPresignedUrl
} from '../utils/saveTicketAttachmentsInS3.js';

// Create new ticket (Employee only)
export const createTicket = async (req, res) => {
    try {
        const { error, value } = createTicketSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { category, priority, subject, description } = value;

        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        const ticketId = await Ticket.generateTicketId();

        // NEW: upload any attached screenshots/files to S3
        let attachments = [];
        if (req.files && req.files.length > 0) {
            attachments = await Promise.all(
                req.files.map((file) => uploadTicketAttachmentToS3(file))
            );
        }

        const ticket = new Ticket({
            ticketId,
            category,
            priority: priority || 'MEDIUM',
            subject,
            description,
            raisedBy: req.user._id,
            status: 'OPEN',
            attachments,
            activityLogs: [{
                action: 'Ticket created',
                type: 'SYSTEM',
                performedBy: req.user._id,
                performedByModel: 'Employee',
                comment: 'Ticket submitted by employee',
                timestamp: new Date()
            }]
        });

        await ticket.save();

        let notifyRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR'];

        if (ticket.category === 'TECHNICAL_ISSUE' || ticket.category === 'IT_ASSET') {
            notifyRoles.push('EMPLOYER_IT');
        }

        const hrItUsers = await EmployerUser.find({
            role: { $in: notifyRoles },
            isActive: true
        });

        await NotificationService.createTicketCreatedNotification(ticket, hrItUsers);

        await ticket.populate('raisedBy', 'firstName lastName employeeId officialEmail department');

        return res.status(201).json({
            success: true,
            message: 'Ticket created successfully',
            data: {
                ticket: ticket.toObject(),
                summary: ticket.getSummary()
            }
        });
    } catch (error) {
        console.error('Create ticket error:', error);

        if (error.code === 11000 && error.keyPattern && error.keyPattern.ticketId) {
            try {
                console.log('Duplicate ticketId detected, retrying...');
                return await createTicket(req, res);
            } catch (retryError) {
                console.error('Retry failed:', retryError);
            }
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get my tickets (Employee only)
export const getMyTickets = async (req, res) => {
    try {
        const { error, value } = getTicketsQuerySchema.validate(req.query);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = value;
        const skip = (page - 1) * limit;

        const filter = { raisedBy: req.user._id };

        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [tickets, total] = await Promise.all([
            Ticket.find(filter)
                .populate('raisedBy', 'firstName lastName employeeId officialEmail department')
                .populate('assignedTo', 'firstName lastName email role')
                .populate('forwardedTo', 'firstName lastName email role')
                .populate('resolvedBy', 'firstName lastName email role')
                .populate('activityLogs.performedBy', 'firstName lastName employeeId email role')
                .sort(sort)
                .skip(skip)
                .limit(limit),
            Ticket.countDocuments(filter)
        ]);

        const totalPages = Math.ceil(total / limit);

        const stats = {
            total,
            open: await Ticket.countDocuments({ ...filter, status: 'OPEN' }),
            inProgress: await Ticket.countDocuments({ ...filter, status: 'IN_PROGRESS' }),
            resolved: await Ticket.countDocuments({ ...filter, status: 'RESOLVED' })
        };

        return res.status(200).json({
            success: true,
            message: 'Tickets retrieved successfully',
            data: {
                tickets,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: total,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                },
                stats
            }
        });
    } catch (error) {
        console.error('Get my tickets error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all tickets (HR/Admin/IT Support)
export const getAllTickets = async (req, res) => {
    try {
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only ADMIN, HR, or IT Support can view all tickets'
            });
        }

        const { error, value } = getTicketsQuerySchema.validate(req.query);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { page = 1, limit = 10, category, sortBy = 'createdAt', sortOrder = 'desc' } = value;
        const skip = (page - 1) * limit;

        let filter = {};

        if (req.user.role === 'EMPLOYER_IT') {
            filter = {
                $and: [
                    { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                    {
                        $or: [
                            { forwardedTo: req.user._id },
                            { assignedTo: req.user._id }
                        ]
                    }
                ]
            };
        }

        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const [tickets, total] = await Promise.all([
            Ticket.find(filter)
                .populate('raisedBy', 'firstName lastName employeeId officialEmail department')
                .populate('assignedTo', 'firstName lastName email role')
                .populate('forwardedTo', 'firstName lastName email role')
                .populate('resolvedBy', 'firstName lastName email role')
                .sort(sort)
                .skip(skip)
                .limit(limit),
            Ticket.countDocuments(filter)
        ]);

        const totalPages = Math.ceil(total / limit);

        const stats = {
            total,
            open: await Ticket.countDocuments({ ...filter, status: 'OPEN' }),
            inProgress: await Ticket.countDocuments({ ...filter, status: 'IN_PROGRESS' }),
            resolved: await Ticket.countDocuments({ ...filter, status: 'RESOLVED' }),
            byCategory: {
                hr: await Ticket.countDocuments({ ...filter, category: 'HR_ISSUE' }),
                technical: await Ticket.countDocuments({ ...filter, category: 'TECHNICAL_ISSUE' }),
                itAsset: await Ticket.countDocuments({ ...filter, category: 'IT_ASSET' })
            },
            byPriority: {
                low: await Ticket.countDocuments({ ...filter, priority: 'LOW' }),
                medium: await Ticket.countDocuments({ ...filter, priority: 'MEDIUM' }),
                high: await Ticket.countDocuments({ ...filter, priority: 'HIGH' })
            }
        };

        return res.status(200).json({
            success: true,
            message: 'Tickets retrieved successfully',
            data: {
                tickets,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: total,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                },
                stats
            }
        });
    } catch (error) {
        console.error('Get all tickets error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get single ticket by ID
export const getTicketById = async (req, res) => {
    try {
        const { ticketId } = req.params;

        const ticket = await Ticket.findOne({ ticketId })
            .populate('raisedBy', 'firstName lastName employeeId officialEmail department')
            .populate('assignedTo', 'firstName lastName email role')
            .populate('forwardedTo', 'firstName lastName email role')
            .populate('resolvedBy', 'firstName lastName email role')
            .populate('activityLogs.performedBy', 'firstName lastName employeeId email role');

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        const isEmployeeOwner = ticket.raisedBy._id.toString() === req.user._id.toString();
        const isAssignedToUser = ticket.assignedTo && ticket.assignedTo._id.toString() === req.user._id.toString();
        const isForwardedToUser = ticket.forwardedTo && ticket.forwardedTo._id.toString() === req.user._id.toString();

        if (!isEmployeeOwner && !allowedRoles.includes(req.user.role) &&
            !isAssignedToUser && !isForwardedToUser) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        if (req.user.role === 'EMPLOYER_IT') {
            if (!['TECHNICAL_ISSUE', 'IT_ASSET'].includes(ticket.category) ||
                (!isForwardedToUser && !isAssignedToUser)) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. IT Support can only access assigned technical/IT tickets'
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Ticket retrieved successfully',
            data: {
                ticket: ticket.toObject(),
                summary: ticket.getSummary()
            }
        });
    } catch (error) {
        console.error('Get ticket by ID error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update ticket (HR/Admin only - can update priority, assign, forward, resolve)
export const updateTicket = async (req, res) => {
    try {
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can update tickets'
            });
        }

        const { ticketId } = req.params;

        const { error, value } = updateTicketSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        let ticket = await Ticket.findOne({ ticketId });
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        if (ticket.status === 'RESOLVED') {
            return res.status(400).json({
                success: false,
                message: 'Cannot update a resolved ticket'
            });
        }

        const changes = [];
        const previousValues = {};

        if (value?.priority && value?.priority !== ticket.priority) {
            previousValues.priority = ticket.priority;
            ticket.priority = value.priority;
            changes.push(`Priority changed from ${previousValues.priority} to ${value.priority}`);
        }

        if (value?.assignedTo && value?.assignedTo !== ticket.assignedTo?.toString()) {
            previousValues.assignedTo = ticket.assignedTo;
            ticket.assignedTo = value.assignedTo;
            ticket.status = 'IN_PROGRESS';
            changes.push(`Ticket assigned to HR/Admin user`);
        }

        if (value?.status && value?.status !== ticket.status) {
            previousValues.status = ticket.status;
            ticket.status = value?.status;

            if (value?.status === 'RESOLVED') {
                // NOTE: comment is now OPTIONAL — default text used if not provided
                ticket.resolvedComment = value?.resolvedComment?.trim()
                    ? value.resolvedComment.trim()
                    : 'Ticket resolved.';
                ticket.resolvedBy = req.user._id;
                ticket.resolvedByModel = 'EmployerUser';
                ticket.resolvedAt = new Date();
                ticket.assignedTo = req.user._id;
                changes.push(`Ticket resolved by HR/Admin`);
            } else {
                changes.push(`Status changed from ${previousValues.status} to ${value.status}`);
            }
        }

        if (value?.resolvedComment && value?.status !== 'RESOLVED') {
            ticket.resolvedComment = value?.resolvedComment;
        }

        if (changes.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No changes provided'
            });
        }

        for (const change of changes) {
            await ticket.addActivityLog(
                'Ticket updated',
                req.user._id,
                'EmployerUser',
                change
            );
        }

        await ticket.save();

        if (value?.status === 'RESOLVED') {
            await NotificationService.createTicketResolvedNotification(ticket, req.user);
        }

        await ticket.populate('raisedBy', 'firstName lastName employeeId officialEmail department');
        await ticket.populate('assignedTo', 'firstName lastName email role');
        await ticket.populate('resolvedBy', 'firstName lastName email role');
        await ticket.populate('activityLogs.performedBy', 'firstName lastName employeeId email role');

        return res.status(200).json({
            success: true,
            message: 'Ticket updated successfully',
            data: {
                ticket: ticket.toObject(),
                changes,
                summary: ticket.getSummary()
            }
        });
    } catch (error) {
        console.error('Update ticket error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Forward ticket to IT Support (HR/Admin only)
export const forwardToITSupport = async (req, res) => {
    try {
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can forward tickets to IT'
            });
        }

        const { ticketId } = req.params;

        const { error, value } = forwardToITSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { forwardedTo, comment } = value;

        let ticket = await Ticket.findOne({ ticketId });
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        if (ticket.status === 'RESOLVED') {
            return res.status(400).json({
                success: false,
                message: 'Cannot forward a resolved ticket'
            });
        }

        if (!['TECHNICAL_ISSUE', 'IT_ASSET'].includes(ticket.category)) {
            return res.status(400).json({
                success: false,
                message: 'Only TECHNICAL_ISSUE or IT_ASSET tickets can be forwarded to IT'
            });
        }

        ticket.forwardedTo = forwardedTo;
        ticket.status = 'IN_PROGRESS';
        ticket.assignedTo = null;

        await ticket.addActivityLog(
            'Ticket forwarded to IT Support',
            req.user._id,
            'EmployerUser',
            comment || `Ticket forwarded to IT Support for ${ticket.category}`
        );

        await ticket.save();

        const itUsers = await EmployerUser.find({
            role: 'EMPLOYER_IT',
            isActive: true
        });

        for (const itUser of itUsers) {
            await Notification.createNotification({
                title: 'Ticket Forwarded to IT',
                description: `Ticket ${ticket.ticketId} has been forwarded to IT department`,
                type: 'TICKET_FORWARDED',
                recipientType: 'EMPLOYER_IT',
                recipientId: itUser._id,
                recipientModel: 'EmployerUser',
                senderId: req.user._id,
                senderModel: 'EmployerUser',
                relatedEntityType: 'Ticket',
                relatedEntityId: ticket._id,
                metadata: {
                    ticketId: ticket.ticketId
                }
            });
        }

        await ticket.populate('raisedBy', 'firstName lastName employeeId officialEmail department');
        await ticket.populate('forwardedTo', 'firstName lastName email role');

        return res.status(200).json({
            success: true,
            message: 'Ticket forwarded to IT Support successfully',
            data: {
                ticket: ticket.toObject(),
                summary: ticket.getSummary()
            }
        });
    } catch (error) {
        console.error('Forward to IT error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Resolve ticket as IT Support
export const resolveTicketAsIT = async (req, res) => {
    try {
        if (req.user.role !== 'EMPLOYER_IT') {
            return res.status(403).json({
                success: false,
                message: 'Only IT Support can resolve tickets using this endpoint'
            });
        }

        const { ticketId } = req.params;

        const { error, value } = resolveTicketSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { resolvedComment } = value;

        let ticket = await Ticket.findOne({ ticketId });
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        if (ticket.forwardedTo?.toString() !== req.user._id.toString() &&
            ticket.assignedTo?.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'You can only resolve tickets assigned to you'
            });
        }

        if (!['TECHNICAL_ISSUE', 'IT_ASSET'].includes(ticket.category)) {
            return res.status(400).json({
                success: false,
                message: 'Only TECHNICAL_ISSUE or IT_ASSET tickets can be resolved by IT'
            });
        }

        if (ticket.status === 'RESOLVED') {
            return res.status(400).json({
                success: false,
                message: 'Ticket is already resolved'
            });
        }

        ticket.status = 'RESOLVED';
        // NOTE: comment is optional now
        ticket.resolvedComment = resolvedComment?.trim() ? resolvedComment.trim() : 'Ticket resolved by IT Support.';
        ticket.resolvedBy = req.user._id;
        ticket.resolvedByModel = 'EmployerUser';
        ticket.resolvedAt = new Date();

        await ticket.addActivityLog(
            'Ticket resolved by IT Support',
            req.user._id,
            'EmployerUser',
            ticket.resolvedComment
        );

        await ticket.save();

        await NotificationService.createTicketResolvedNotification(ticket, req.user);

        await ticket.populate('raisedBy', 'firstName lastName employeeId officialEmail department');
        await ticket.populate('forwardedTo', 'firstName lastName email role');
        await ticket.populate('resolvedBy', 'firstName lastName email role');

        return res.status(200).json({
            success: true,
            message: 'Ticket resolved successfully',
            data: {
                ticket: ticket.toObject(),
                summary: ticket.getSummary()
            }
        });
    } catch (error) {
        console.error('Resolve ticket as IT error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// NEW: HR/Admin/IT asks a question on a ticket (can be called any number of times)
export const addQuestionToTicket = async (req, res) => {
    try {
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN, HR or IT Support can ask questions on a ticket'
            });
        }

        const { ticketId } = req.params;

        const { error, value } = askQuestionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const ticket = await Ticket.findOne({ ticketId });
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        if (ticket.status === 'RESOLVED') {
            return res.status(400).json({
                success: false,
                message: 'Cannot ask questions on a resolved ticket'
            });
        }

        ticket.activityLogs.push({
            action: 'Question raised',
            type: 'QUESTION',
            performedBy: req.user._id,
            performedByModel: 'EmployerUser',
            comment: value.question,
            timestamp: new Date()
        });

        await ticket.save();

        // Best-effort notification — wrapped so an enum/field mismatch doesn't break the request
        try {
            await Notification.createNotification({
                title: 'New Question on Your Ticket',
                description: `A question was raised on ticket ${ticket.ticketId}: "${value.question}"`,
                type: 'TICKET_QUESTION',
                recipientType: 'EMPLOYEE',
                recipientId: ticket.raisedBy,
                recipientModel: 'Employee',
                senderId: req.user._id,
                senderModel: 'EmployerUser',
                relatedEntityType: 'Ticket',
                relatedEntityId: ticket._id,
                metadata: { ticketId: ticket.ticketId }
            });
        } catch (notifyErr) {
            console.error('Question notification failed:', notifyErr.message);
        }

        await ticket.populate('raisedBy', 'firstName lastName employeeId officialEmail department');
        await ticket.populate('activityLogs.performedBy', 'firstName lastName employeeId email role');

        return res.status(200).json({
            success: true,
            message: 'Question added successfully',
            data: {
                ticket: ticket.toObject(),
                summary: ticket.getSummary()
            }
        });
    } catch (error) {
        console.error('Add question error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// NEW: Employee answers a question raised on their own ticket
export const answerQuestionOnTicket = async (req, res) => {
    try {
        const { ticketId } = req.params;

        const { error, value } = answerQuestionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const ticket = await Ticket.findOne({ ticketId });
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        if (ticket.raisedBy.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'You can only answer questions on your own tickets'
            });
        }

        if (ticket.status === 'RESOLVED') {
            return res.status(400).json({
                success: false,
                message: 'Cannot answer on a resolved ticket'
            });
        }

        ticket.activityLogs.push({
            action: 'Answer submitted',
            type: 'ANSWER',
            performedBy: req.user._id,
            performedByModel: 'Employee',
            comment: value.answer,
            timestamp: new Date()
        });

        await ticket.save();

        try {
            const notifyTarget = ticket.forwardedTo || ticket.assignedTo;
            if (notifyTarget) {
                await Notification.createNotification({
                    title: 'Employee Answered Your Question',
                    description: `${req.user.firstName} ${req.user.lastName} replied on ticket ${ticket.ticketId}`,
                    type: 'TICKET_ANSWER',
                    recipientType: 'EMPLOYER_HR',
                    recipientId: notifyTarget,
                    recipientModel: 'EmployerUser',
                    senderId: req.user._id,
                    senderModel: 'Employee',
                    relatedEntityType: 'Ticket',
                    relatedEntityId: ticket._id,
                    metadata: { ticketId: ticket.ticketId }
                });
            }
        } catch (notifyErr) {
            console.error('Answer notification failed:', notifyErr.message);
        }

        await ticket.populate('raisedBy', 'firstName lastName employeeId officialEmail department');
        await ticket.populate('activityLogs.performedBy', 'firstName lastName employeeId email role');

        return res.status(200).json({
            success: true,
            message: 'Answer submitted successfully',
            data: {
                ticket: ticket.toObject(),
                summary: ticket.getSummary()
            }
        });
    } catch (error) {
        console.error('Answer question error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// NEW: presigned URL for viewing/downloading a ticket attachment
export const getTicketAttachmentUrl = async (req, res) => {
    try {
        const { key } = req.query;

        if (!key) {
            return res.status(400).json({ success: false, message: 'Key is required' });
        }

        const url = await getTicketAttachmentPresignedUrl(decodeURIComponent(key));

        return res.status(200).json({ success: true, url });
    } catch (error) {
        console.error('Get attachment URL error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error generating attachment URL',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get ticket statistics
export const getTicketStatistics = async (req, res) => {
    try {
        let filter = {};

        if (req.user.role === 'EMPLOYEE') {
            filter.raisedBy = req.user._id;
        }
        else if (req.user.role === 'EMPLOYER_IT') {
            filter = {
                $and: [
                    { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                    {
                        $or: [
                            { forwardedTo: req.user._id },
                            { assignedTo: req.user._id }
                        ]
                    }
                ]
            };
        }

        const [
            total,
            open,
            inProgress,
            resolved,
            byCategory,
            byPriority
        ] = await Promise.all([
            Ticket.countDocuments(filter),
            Ticket.countDocuments({ ...filter, status: 'OPEN' }),
            Ticket.countDocuments({ ...filter, status: 'IN_PROGRESS' }),
            Ticket.countDocuments({ ...filter, status: 'RESOLVED' }),
            Ticket.aggregate([
                { $match: filter },
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ]),
            Ticket.aggregate([
                { $match: filter },
                { $group: { _id: '$priority', count: { $sum: 1 } } }
            ])
        ]);

        const stats = {
            total,
            status: {
                open,
                inProgress,
                resolved
            },
            categories: byCategory.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            priorities: byPriority.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            responseTime: {
                averageDays: await Ticket.aggregate([
                    { $match: { ...filter, resolvedAt: { $ne: null } } },
                    {
                        $addFields: {
                            resolutionTime: {
                                $divide: [
                                    { $subtract: ['$resolvedAt', '$createdAt'] },
                                    1000 * 60 * 60 * 24
                                ]
                            }
                        }
                    },
                    { $group: { _id: null, avg: { $avg: '$resolutionTime' } } }
                ]).then(result => result[0]?.avg ? result[0].avg.toFixed(2) : 0)
            }
        };

        return res.status(200).json({
            success: true,
            message: 'Statistics retrieved successfully',
            data: stats
        });
    } catch (error) {
        console.error('Get ticket statistics error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};