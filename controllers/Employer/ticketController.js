import Ticket from '../../model/Ticket.js';
import Employee from '../../model/Employee.js';
import {
    createTicketSchema,
    updateTicketSchema,
    resolveTicketSchema,
    forwardToITSchema,
    getTicketsQuerySchema
} from '../../validations/Employer/ticketValidation.js';
import EmployerUser from '../../model/EmployerUser.js';
import NotificationService from '../../services/notificationService.js';
import Notification from '../../model/Notification.js';

// Create new ticket (Employee only)
export const createTicket = async (req, res) => {
    try {
        // Validate request body
        const { error, value } = createTicketSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { category, priority, subject, description } = value;

        // Check if employee exists
        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Generate ticket ID
        const ticketId = await Ticket.generateTicketId();

        // Create ticket with initial activity log
        const ticket = new Ticket({
            ticketId,
            category,
            priority: priority || 'MEDIUM',
            subject,
            description,
            raisedBy: req.user._id,
            status: 'OPEN',
            activityLogs: [{
                action: 'Ticket created',
                performedBy: req.user._id,
                performedByModel: 'Employee',
                comment: 'Ticket submitted by employee',
                timestamp: new Date()
            }]
        });

        // Save ticket
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

        // Populate raisedBy details
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

        // Handle duplicate ticketId error
        if (error.code === 11000 && error.keyPattern && error.keyPattern.ticketId) {
            try {
                // Retry with new ticket ID
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
        // Validate query parameters
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

        // Build filter
        const filter = { raisedBy: req.user._id };

        // Build sort
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Execute query
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

        // Calculate statistics
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
        // Check user role
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only ADMIN, HR, or IT Support can view all tickets'
            });
        }

        // Validate query parameters
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

        // Build filter based on user role
        let filter = {};

        // IT Support can only see TECHNICAL_ISSUE and IT_ASSET tickets assigned to them
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

        // Build sort
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Execute query
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

        // Calculate statistics
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

        // Find ticket
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

        // Check access permissions
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

        // IT Support can only access TECHNICAL_ISSUE and IT_ASSET tickets assigned to them
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

// Update ticket (HR/Admin only - can update priority, assign, forward)
export const updateTicket = async (req, res) => {
    try {
        // Check user role
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can update tickets'
            });
        }

        const { ticketId } = req.params;

        // Validate request body
        const { error, value } = updateTicketSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Find ticket
        let ticket = await Ticket.findOne({ ticketId });
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        // Check if ticket is already resolved
        if (ticket.status === 'RESOLVED') {
            return res.status(400).json({
                success: false,
                message: 'Cannot update a resolved ticket'
            });
        }

        // Track changes for activity log
        const changes = [];
        const previousValues = {};

        // Update fields if provided
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
                if (!value?.resolvedComment) {
                    return res.status(400).json({
                        success: false,
                        message: 'Resolved comment is required when resolving a ticket'
                    });
                }
                ticket.resolvedComment = value?.resolvedComment;
                ticket.resolvedBy = req.user._id;
                ticket.resolvedByModel = 'EmployerUser';
                ticket.resolvedAt = new Date();
                ticket.assignedTo = req.user._id; // Auto-assign to resolver
                changes.push(`Ticket resolved by HR/Admin`);
            } else {
                changes.push(`Status changed from ${previousValues.status} to ${value.status}`);
            }
        }

        if (value?.resolvedComment && value?.status !== 'RESOLVED') {
            ticket.resolvedComment = value?.resolvedComment;
        }

        // If no changes were made
        if (changes.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No changes provided'
            });
        }

        // Add activity log for each change
        for (const change of changes) {
            await ticket.addActivityLog(
                'Ticket updated',
                req.user._id,
                'EmployerUser',
                change
            );
        }

        // Save ticket
        await ticket.save();

        if (value?.status === 'RESOLVED') {
            // Notify employee about resolution
            await NotificationService.createTicketResolvedNotification(ticket, req.user);
        }

        // Populate data
        await ticket.populate('raisedBy', 'firstName lastName employeeId officialEmail department');
        await ticket.populate('assignedTo', 'firstName lastName email role');
        await ticket.populate('resolvedBy', 'firstName lastName email role');

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
        // Check user role
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can forward tickets to IT'
            });
        }

        const { ticketId } = req.params;

        // Validate request body
        const { error, value } = forwardToITSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { forwardedTo, comment } = value;

        // Find ticket
        let ticket = await Ticket.findOne({ ticketId });
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        // Check if ticket is already resolved
        if (ticket.status === 'RESOLVED') {
            return res.status(400).json({
                success: false,
                message: 'Cannot forward a resolved ticket'
            });
        }

        // Check if ticket is IT-related
        if (!['TECHNICAL_ISSUE', 'IT_ASSET'].includes(ticket.category)) {
            return res.status(400).json({
                success: false,
                message: 'Only TECHNICAL_ISSUE or IT_ASSET tickets can be forwarded to IT'
            });
        }

        // Update ticket
        ticket.forwardedTo = forwardedTo;
        ticket.status = 'IN_PROGRESS';
        ticket.assignedTo = null; // Remove HR assignment when forwarding to IT

        // Add activity log
        await ticket.addActivityLog(
            'Ticket forwarded to IT Support',
            req.user._id,
            'EmployerUser',
            comment || `Ticket forwarded to IT Support for ${ticket.category}`
        );

        // Save ticket
        await ticket.save();

        // Notify IT support
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

        // Populate data
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
        // Check user role
        if (req.user.role !== 'EMPLOYER_IT') {
            return res.status(403).json({
                success: false,
                message: 'Only IT Support can resolve tickets using this endpoint'
            });
        }

        const { ticketId } = req.params;

        // Validate request body
        const { error, value } = resolveTicketSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { resolvedComment } = value;

        // Find ticket
        let ticket = await Ticket.findOne({ ticketId });
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }

        // Check if ticket is assigned/forwarded to this IT user
        if (ticket.forwardedTo?.toString() !== req.user._id.toString() &&
            ticket.assignedTo?.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'You can only resolve tickets assigned to you'
            });
        }

        // Check if ticket is IT-related
        if (!['TECHNICAL_ISSUE', 'IT_ASSET'].includes(ticket.category)) {
            return res.status(400).json({
                success: false,
                message: 'Only TECHNICAL_ISSUE or IT_ASSET tickets can be resolved by IT'
            });
        }

        // Check if ticket is already resolved
        if (ticket.status === 'RESOLVED') {
            return res.status(400).json({
                success: false,
                message: 'Ticket is already resolved'
            });
        }

        // Update ticket
        ticket.status = 'RESOLVED';
        ticket.resolvedComment = resolvedComment;
        ticket.resolvedBy = req.user._id;
        ticket.resolvedByModel = 'EmployerUser';
        ticket.resolvedAt = new Date();

        // Add activity log
        await ticket.addActivityLog(
            'Ticket resolved by IT Support',
            req.user._id,
            'EmployerUser',
            resolvedComment
        );

        // Save ticket
        await ticket.save();

        // Notify employee about resolution
        await NotificationService.createTicketResolvedNotification(ticket, req.user);

        // Populate data
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

// Get ticket statistics
export const getTicketStatistics = async (req, res) => {
    try {
        let filter = {};

        // If employee, only show their tickets
        if (req.user.role === 'EMPLOYEE') {
            filter.raisedBy = req.user._id;
        }
        // If IT Support, only show assigned IT tickets
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

        // Format statistics
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
                // Average resolution time in days
                averageDays: await Ticket.aggregate([
                    { $match: { ...filter, resolvedAt: { $ne: null } } },
                    {
                        $addFields: {
                            resolutionTime: {
                                $divide: [
                                    { $subtract: ['$resolvedAt', '$createdAt'] },
                                    1000 * 60 * 60 * 24 // Convert to days
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