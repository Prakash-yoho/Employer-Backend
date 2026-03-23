import Notification from "../model/Notification.js";

const formatDate = (date) =>
    new Date(date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).replace(/ /g, '-');

class NotificationService {

    // Employee Related
    static async createEmployeeCreatedNotification(employee, createdBy) {
        console.log(createdBy)
        return await Notification.createNotification({
            title: 'New Employee Added',
            description: `New employee ${employee.firstName} ${employee.lastName} has been added to the system.`,
            type: 'EMPLOYEE_CREATED',
            recipientType: 'EMPLOYER_ADMIN',
            recipientId: createdBy._id,
            recipientModel: 'EmployerUser',
            senderId: createdBy._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Employee',
            relatedEntityId: employee._id,
            metadata: {
                employeeId: employee.employeeId,
                department: employee.department,
                createdBy: createdBy.email
            }
        });
    }

    static async createEmployeeUpdateRequestNotification(employee, hrUsers) {
        const notifications = [];

        for (const hrUser of hrUsers) {
            const notification = await Notification.createNotification({
                title: 'Employee Update Request',
                description: `${employee.firstName} ${employee.lastName} has requested profile update.`,
                type: 'EMPLOYEE_UPDATE_REQUEST',
                recipientType: hrUser.role,
                recipientId: hrUser._id,
                recipientModel: 'EmployerUser',
                senderId: employee._id,
                senderModel: 'Employee',
                relatedEntityType: 'Employee',
                relatedEntityId: employee._id,
                priority: 'medium',
                metadata: {
                    employeeId: employee.employeeId,
                    updateReason: employee.updateRequestReason
                }
            });
            notifications.push(notification);
        }

        return notifications;
    }

    static async createEmployeeUpdateApprovedNotification(employee, approvedBy) {
        return await Notification.createNotification({
            title: 'Profile Update Approved',
            description: `Your profile update request has been approved and done by HR`,
            type: 'EMPLOYEE_UPDATE_APPROVED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: approvedBy._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Employee',
            relatedEntityId: employee._id
        });
    }

    static async createEmployeeUpdateStatusResetNotification(employee, resetBy) {
        return await Notification.createNotification({
            title: 'Profile Edit Access Granted',
            description: `Your edit request has been approved. You can now edit your profile. Please log out and log in again to apply the changes.`,
            type: 'EMPLOYEE_UPDATE_STATUS_RESET',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: resetBy._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Employee',
            relatedEntityId: employee._id,
            priority: 'high',
            metadata: {
                employeeId: employee.employeeId,
                resetBy: resetBy.email,
                resetAt: new Date()
            }
        });
    }

    // Document Related
    static async createDocumentUploadedNotification(employee, documentType, hrUsers) {
        const notifications = [];

        for (const hrUser of hrUsers) {
            const notification = await Notification.createNotification({
                title: 'New Document Uploaded',
                description: `${employee.firstName} ${employee.lastName} uploaded ${documentType}.`,
                type: 'DOCUMENT_UPLOADED',
                recipientType: hrUser.role,
                recipientId: hrUser._id,
                recipientModel: 'EmployerUser',
                senderId: employee._id,
                senderModel: 'Employee',
                relatedEntityType: 'Document',
                relatedEntityId: employee._id,
                metadata: {
                    employeeId: employee.employeeId,
                    documentType: documentType
                }
            });
            notifications.push(notification);
        }

        return notifications;
    }

    static async createDocumentVerifiedNotification(employee, documentType, verifiedBy) {
        return await Notification.createNotification({
            title: 'Document Verified',
            description: `${documentType} has been verified by HR.`,
            type: 'DOCUMENT_VERIFIED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: verifiedBy._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Document',
            relatedEntityId: employee._id,
            metadata: {
                documentType: documentType
            }
        });
    }

    static async createDocumentRejectedNotification(employee, documentType, verifiedBy) {
        return await Notification.createNotification({
            title: 'Document Rejected',
            description: `${documentType} has been rejected by HR.`,
            type: 'DOCUMENT_REJECTED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: verifiedBy._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Document',
            relatedEntityId: employee._id,
            metadata: {
                documentType: documentType
            }
        });
    }


    static async createAllDocumentsVerifiedNotification(employee, verifiedBy) {
        return await Notification.createNotification({
            title: 'All Documents Verified!',
            description: 'Congratulations! All your documents have been verified.',
            type: 'DOCUMENT_COMPLETED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderModel: verifiedBy._id,
            relatedEntityType: 'Document',
            relatedEntityId: employee._id,
            priority: 'high'
        });
    }

    // Ticket Related
    static async createTicketCreatedNotification(ticket, hrItUsers) {
        const notifications = [];

        for (const user of hrItUsers) {
            const notification = await Notification.createNotification({
                title: 'New Support Ticket',
                description: `New ${ticket.categoryDisplay} ticket created: ${ticket.subject}`,
                type: 'TICKET_CREATED',
                recipientType: user.role,
                recipientId: user._id,
                recipientModel: 'EmployerUser',
                senderId: ticket.raisedBy,
                senderModel: 'Employee',
                relatedEntityType: 'Ticket',
                relatedEntityId: ticket._id,
                priority: ticket.priority === 'HIGH' ? 'high' : 'medium',
                metadata: {
                    ticketId: ticket.ticketId,
                    category: ticket.category,
                    priority: ticket.priority
                }
            });
            notifications.push(notification);
        }

        return notifications;
    }

    static async createTicketAssignedNotification(ticket, assignedTo) {
        return await Notification.createNotification({
            title: 'Ticket Assigned to You',
            description: `Ticket ${ticket.ticketId}: ${ticket.subject} has been assigned to you.`,
            type: 'TICKET_ASSIGNED',
            recipientType: assignedTo.role,
            recipientId: assignedTo._id,
            recipientModel: 'EmployerUser',
            senderId: ticket.assignedBy,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Ticket',
            relatedEntityId: ticket._id,
            metadata: {
                ticketId: ticket.ticketId
            }
        });
    }

    static async createTicketResolvedNotification(ticket, resolvedBy) {
        return await Notification.createNotification({
            title: 'Ticket Resolved',
            description: `Your ticket ${ticket.ticketId} has been resolved by ${resolvedBy?.role === 'EMPLOYER_IT' ? "IT support" : "HR"}.`,
            type: 'TICKET_RESOLVED',
            recipientType: 'EMPLOYEE',
            recipientId: ticket.raisedBy,
            recipientModel: 'Employee',
            senderId: resolvedBy._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Ticket',
            relatedEntityId: ticket._id,
            metadata: {
                ticketId: ticket.ticketId,
                resolvedComment: ticket.resolvedComment
            }
        });
    }

    // Asset Related
    static async createAssetAssignedNotification(asset, employee, assignedBy) {
        return await Notification.createNotification({
            title: 'Asset Assigned',
            description: `${asset.assetName} (${asset.assetId}) has been assigned to you.`,
            type: 'ASSET_ASSIGNED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: assignedBy._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Asset',
            relatedEntityId: asset._id,
            metadata: {
                assetId: asset.assetId,
                assetName: asset.assetName,
                serialNumber: asset.serialNumber
            }
        });
    }

    static async createAssetUnassignedNotification(asset, employee, unassignedBy) {
        return await Notification.createNotification({
            title: 'Asset Unassigned',
            description: `${asset.assetName} (${asset.assetId}) has been unassigned from you.`,
            type: 'ASSET_UNASSIGNED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: unassignedBy._id,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Asset',
            relatedEntityId: asset._id
        });
    }

    // NotificationService class
    static async createNotification(data) {
        try {
            const notification = await Notification.create({
                title: data.title,
                description: data.description,
                type: data.type,
                recipientType: data.recipientType,
                recipientId: data.recipientId || null,
                recipientModel: data.recipientModel || null,
                senderId: data.senderId || null,
                senderModel: data.senderModel || null,
                relatedEntityType: data.relatedEntityType || null,
                relatedEntityId: data.relatedEntityId || null,
                priority: data.priority || 'medium',
                metadata: data.metadata || {},
                expiresAt: data.expiresAt || null,
                status: 'unread'
            });

            return notification;
        } catch (error) {
            console.error('Error creating notification:', error);
            throw error;
        }
    }

    // System Announcements
    static async createAnnouncement(title, description, recipientType = 'ALL', recipients = null) {
        if (recipients && Array.isArray(recipients)) {
            const notifications = [];

            for (const recipient of recipients) {
                const notification = await Notification.createNotification({
                    title,
                    description,
                    type: 'ANNOUNCEMENT',
                    recipientType: recipient.role || recipientType,
                    recipientId: recipient._id,
                    recipientModel: recipient.role ? 'EmployerUser' : 'Employee',
                    senderModel: 'System',
                    priority: 'high'
                });
                notifications.push(notification);
            }

            return notifications;
        } else {
            return await Notification.createNotification({
                title,
                description,
                type: 'ANNOUNCEMENT',
                recipientType: recipientType,
                senderModel: 'System',
                priority: 'high'
            });
        }
    }

    // Schedule Related
    static async createScheduleAssignedNotification(employee, schedule, phase, assignedBy) {
        return await Notification.createNotification({
            title: 'You Have Been Assigned to a Schedule',
            description: `You have been assigned to schedule "${schedule.scheduleName}" in phase "${phase.phaseName}" from ${formatDate(schedule.fromDate)} to ${formatDate(schedule.toDate)}.`,
            type: 'SCHEDULE_ASSIGNED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: assignedBy?._id || null,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Employee',
            relatedEntityId: employee._id,
            priority: 'high',
            metadata: {
                scheduleId: schedule._id,
                scheduleGroupId: schedule.scheduleGroupId,
                scheduleName: schedule.scheduleName,
                phaseId: phase._id,
                phaseName: phase.phaseName,
                fromDate: schedule.fromDate,
                toDate: schedule.toDate,
            }
        });
    }

    static async createScheduleRemovedNotification(employee, schedule, phase, removedBy) {
        return await Notification.createNotification({
            title: 'You Have Been Removed from a Schedule',
            description: `You have been removed from schedule "${schedule.scheduleName}" in phase "${phase.phaseName}".`,
            type: 'SCHEDULE_REMOVED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: removedBy?._id || null,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Employee',
            relatedEntityId: employee._id,
            priority: 'medium',
            metadata: {
                scheduleId: schedule._id,
                scheduleName: schedule.scheduleName,
                phaseId: phase._id,
                phaseName: phase.phaseName,
            }
        });
    }

    static async createScheduleDatesUpdatedNotification(employee, schedule, phase, updatedBy) {
        return await Notification.createNotification({
            title: 'Your Schedule Dates Have Been Updated',
            description: `The dates for schedule "${schedule.scheduleName}" in phase "${phase.phaseName}" have been updated to ${formatDate(schedule.fromDate)} – ${formatDate(schedule.toDate)}.`,
            type: 'SCHEDULE_UPDATED',
            recipientType: 'EMPLOYEE',
            recipientId: employee._id,
            recipientModel: 'Employee',
            senderId: updatedBy?._id || null,
            senderModel: 'EmployerUser',
            relatedEntityType: 'Employee',
            relatedEntityId: employee._id,
            priority: 'medium',
            metadata: {
                scheduleId: schedule._id,
                scheduleName: schedule.scheduleName,
                phaseId: phase._id,
                phaseName: phase.phaseName,
                fromDate: schedule.fromDate,
                toDate: schedule.toDate,
            }
        });
    }

    // Get user notifications with pagination
    static async getUserNotifications(userId, userType, options = {}) {
        return await Notification.getNotificationsForUser(userId, userType, options);
    }

    // Get unread count
    static async getUnreadCount(userId, userType) {
        return await Notification.getUnreadCount(userId, userType);
    }

    // Mark all as read
    static async markAllAsRead(userId, userType) {
        return await Notification.markAllAsRead(userId, userType);
    }

    // Mark single notification as read
    static async markAsRead(notificationId) {
        const notification = await Notification.findById(notificationId);
        if (notification) {
            return await notification.markAsRead();
        }
        return null;
    }
}

export default NotificationService;