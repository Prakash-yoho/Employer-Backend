import mongoose, { Schema } from "mongoose";

// Notification Schema
const notificationSchema = new Schema({
    // NOTIFICATION CONTENT
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    description: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    type: {
        type: String,
        required: true,
        enum: [
            // EMPLOYEE RELATED
            'EMPLOYEE_CREATED',           // When new employee is created by HR/Admin
            'EMPLOYEE_UPDATED',          // When employee profile is updated
            'EMPLOYEE_STATUS_CHANGED',   // When employee status changes
            'EMPLOYEE_UPDATE_REQUEST',   // When employee requests profile update
            'EMPLOYEE_UPDATE_APPROVED',  // When HR approves update request
            'EMPLOYEE_UPDATE_REJECTED',  // When HR rejects update request
            'EMPLOYEE_UPDATE_STATUS_RESET', // When HR resets update request status
            // DOCUMENT RELATED
            'DOCUMENT_UPLOADED',         // When employee uploads document
            'DOCUMENT_VERIFIED',         // When HR verifies document
            'DOCUMENT_REJECTED',         // When HR rejects document
            'DOCUMENT_COMPLETED',        // When all documents are verified

            // TICKET RELATED
            'TICKET_CREATED',           // When employee creates ticket
            'TICKET_ASSIGNED',          // When ticket is assigned
            'TICKET_FORWARDED',         // When ticket is forwarded to IT
            'TICKET_RESOLVED',          // When ticket is resolved
            'TICKET_UPDATED',           // When ticket is updated

            // LEAVE RELATED
            'LEAVE_REQUEST',            // When employee requests leave
            'LEAVE_APPROVED',           // When HR approves leave
            'LEAVE_REJECTED',           // When HR rejects leave
            'LEAVE_CANCELLED',          // When employee cancels leave

            // ASSET RELATED
            'ASSET_ASSIGNED',           // When asset is assigned to employee
            'ASSET_UNASSIGNED',         // When asset is unassigned
            'ASSET_CREATED',            // When new asset is created
            'ASSET_UPDATED',            // When asset is updated

            // SYSTEM & ADMIN
            'SYSTEM_ALERT',             // System alerts
            'ANNOUNCEMENT',             // General announcements
            'REMINDER',              // Reminders (document expiry, etc.)

            // SCHEDULE RELATED
            'SCHEDULE_ASSIGNED',       // When employee is assigned to a schedule/phase
            'SCHEDULE_REMOVED',        // When employee is removed from a schedule/phase
            'SCHEDULE_UPDATED'        // When schedule dates are updated
        ]
    },

    // RECIPIENT INFORMATION
    recipientType: {
        type: String,
        required: true,
        enum: ['EMPLOYEE', 'EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT', 'ALL']
    },
    recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'recipientModel',
        default: null
    },
    recipientModel: {
        type: String,
        enum: ['Employee', 'EmployerUser', null],
        default: null
    },

    // SENDER INFORMATION
      senderId: {
        type: mongoose.Schema.Types.ObjectId,
        // ← NO refPath here — senderModel can be "System" which is not a mongoose model
        default: null
    },
    senderModel: {
        type: String,
        enum: ['Employee', 'EmployerUser', 'System', null],
        default: null
    },

    // RELATED ENTITY 
    relatedEntityType: {
        type: String,
        enum: ['Employee', 'Document', 'Ticket', 'Asset', 'Leave', 'Permission', null],
        default: null
    },
    relatedEntityId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'relatedEntityType',
        default: null
    },

    // STATUS
    status: {
        type: String,
        enum: ['unread', 'read'],
        default: 'unread'
    },

    // METADATA
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },

    metadata: {
        type: Schema.Types.Mixed,
        default: {}
    },

    // EXPIRY (for time-sensitive notifications)
    expiresAt: {
        type: Date,
        default: null
    },

    // READ TRACKING
    readAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Indexes for optimal querying
notificationSchema.index({ recipientId: 1, status: 1 });
notificationSchema.index({ recipientType: 1, status: 1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ status: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for notification age
notificationSchema.virtual('isNew').get(function () {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.createdAt > oneDayAgo;
});

// Method to mark as read
notificationSchema.methods.markAsRead = function () {
    this.status = 'read';
    this.readAt = new Date();
    return this.save();
};

// Method to mark as unread
notificationSchema.methods.markAsUnread = function () {
    this.status = 'unread';
    this.readAt = null;
    return this.save();
};

// Static method to create notification
notificationSchema.statics.createNotification = async function (data) {
    try {
        const notification = new this({
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
            expiresAt: data.expiresAt || null
        });

        return await notification.save();
    } catch (error) {
        console.error('Error creating notification:', error);
        throw error;
    }
};

// Static method to get notifications for user
// notificationSchema.statics.getNotificationsForUser = async function (userId, userType, options = {}) {
//     const {
//         limit = 50,
//         skip = 0,
//         status = null,
//         type = null,
//         read = null
//     } = options;

//     // Ensure userId is ObjectId
//     let userIdObj;
//     if (typeof userId === 'string') {
//         userIdObj = new mongoose.Types.ObjectId(userId);
//     } else if (userId && userId._id) {
//         userIdObj = userId._id;
//     } else {
//         userIdObj = userId;
//     }

//     // Build query - SIMPLIFIED VERSION FIRST
//     const query = {
//         $or: [
//             {
//                 recipientType: userType,
//                 recipientId: userIdObj
//             },
//             {
//                 recipientType: 'ALL'
//             }
//         ]
//     };

//     // Add optional filters
//     if (status) {
//         query.status = status;
//     }
//     if (type) {
//         query.type = type;
//     }
//     if (read !== null) {
//         query.status = read ? 'read' : 'unread';
//     }

//    const results = await this.find(query)
//     .sort({ createdAt: -1, priority: -1 })
//     .skip(skip)
//     .limit(limit)
//     .populate({ path: 'recipientId', select: 'firstName lastName email' })
//     .populate({ path: 'senderId', select: 'firstName lastName email' })
//     .populate({ path: 'relatedEntityId' });

//     return results;
// };
notificationSchema.statics.getNotificationsForUser = async function (userId, userType, options = {}) {
    const { limit = 50, skip = 0, status = null, type = null, read = null } = options;

    // Ensure userId is ObjectId
    let userIdObj;
    if (typeof userId === 'string') {
        userIdObj = new mongoose.Types.ObjectId(userId);
    } else if (userId && userId._id) {
        userIdObj = userId._id;
    } else {
        userIdObj = userId;
    }

    // Build query
    const query = {
        $or: [
            { recipientType: userType, recipientId: userIdObj },
            { recipientType: 'ALL' }
        ]
    };
    if (status) query.status = status;
    if (type) query.type = type;
    if (read !== null) query.status = read ? 'read' : 'unread';

    // Fetch notifications as plain objects (with basic populations)
    const notifications = await this.find(query)
        .sort({ createdAt: -1, priority: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: 'recipientId', select: 'firstName lastName email' })
        .populate({ path: 'relatedEntityId' })
        .lean();  // ← use .lean() to get plain objects

    // ----- Batch populate senderId based on senderModel -----
    const sendersByModel = {};
    for (const notif of notifications) {
        // Only populate if there is a senderId, a senderModel, and it's not "System"
        if (notif.senderId && notif.senderModel && notif.senderModel !== 'System') {
            if (!sendersByModel[notif.senderModel]) sendersByModel[notif.senderModel] = [];
            sendersByModel[notif.senderModel].push(notif.senderId);
        }
    }

    // Fetch all senders per model (one query per model type)
    const populatedSenders = {};
    for (const [modelName, ids] of Object.entries(sendersByModel)) {
        const Model = mongoose.model(modelName);
        const senders = await Model.find({ _id: { $in: ids } }).select('firstName lastName email').lean();
        populatedSenders[modelName] = senders.reduce((acc, s) => {
            acc[s._id.toString()] = s;
            return acc;
        }, {});
    }

    // Replace senderId with the populated document (or leave as original if not found)
    for (const notif of notifications) {
        if (notif.senderId && notif.senderModel && notif.senderModel !== 'System') {
            const populated = populatedSenders[notif.senderModel]?.[notif.senderId.toString()];
            if (populated) notif.senderId = populated;
            // Otherwise keep the ObjectId (sender may have been deleted)
        }
    }

    return notifications;
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = async function (userId, userType) {

    // Ensure userId is ObjectId
    let userIdObj;
    if (typeof userId === 'string') {
        userIdObj = new mongoose.Types.ObjectId(userId);
    } else if (userId && userId._id) {
        userIdObj = userId._id;
    } else {
        userIdObj = userId;
    }

    const query = {
        $or: [
            {
                recipientType: userType,
                recipientId: userIdObj,
                status: 'unread'
            },
            { recipientType: 'ALL', status: 'unread' }
        ]
    };

    // Add expiry filter
    // query.$or = [
    //     { ...query.$or, expiresAt: null },
    //     { ...query.$or, expiresAt: { $gt: new Date() } }
    // ];

    return await this.countDocuments(query);
};

// Static method to mark all as read
notificationSchema.statics.markAllAsRead = async function (userId, userType) {
    const query = {
        $or: [
            { recipientType: userType, recipientId: userId, status: 'unread' },
            { recipientType: 'ALL', status: 'unread' }
        ]
    };

    return await this.updateMany(query, {
        $set: {
            status: 'read',
            readAt: new Date()
        }
    });
};

// Static method to delete old notifications
notificationSchema.statics.cleanupOldNotifications = async function (days = 30) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return await this.deleteMany({
        createdAt: { $lt: cutoffDate },
        status: 'read'
    });
};

export default mongoose.model("Notification", notificationSchema);