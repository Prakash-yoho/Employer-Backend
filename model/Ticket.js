import mongoose, { Schema } from "mongoose";

// Activity log schema
const activityLogSchema = new Schema({
    action: {
        type: String,
        required: true,
        trim: true
    },
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'activityLogs.performedByModel'
    },
    performedByModel: {
        type: String,
        required: true,
        enum: ['Employee', 'EmployerUser']
    },
    comment: {
        type: String,
        trim: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

// Main Ticket Schema - NO pre-save hooks, NO required on ticketId
const ticketSchema = new Schema({
    ticketId: {
        type: String,
        unique: true,
        index: true
        // NOT required, NO default
    },
    category: {
        type: String,
        required: true,
        enum: ['HR_ISSUE', 'TECHNICAL_ISSUE', 'IT_ASSET']
    },
    priority: {
        type: String,
        required: true,
        enum: ['LOW', 'MEDIUM', 'HIGH'],
        default: 'MEDIUM'
    },
    subject: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        required: true,
        enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'],
        default: 'OPEN'
    },
    raisedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        default: null
    },
    forwardedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        default: null
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'resolvedByModel'
    },
    resolvedByModel: {
        type: String,
        enum: ['Employee', 'EmployerUser'],
        default: null
    },
    resolvedComment: {
        type: String,
        trim: true,
        default: null
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    activityLogs: [activityLogSchema]
}, {
    timestamps: true
});

// Indexes
ticketSchema.index({ raisedBy: 1, status: 1 });
ticketSchema.index({ category: 1, status: 1 });
ticketSchema.index({ priority: 1 });
ticketSchema.index({ assignedTo: 1 });
ticketSchema.index({ forwardedTo: 1 });
ticketSchema.index({ createdAt: -1 });

// Virtuals
ticketSchema.virtual('categoryDisplay').get(function () {
    const categories = {
        'HR_ISSUE': 'HR Issue',
        'TECHNICAL_ISSUE': 'Technical Issue',
        'IT_ASSET': 'IT Asset'
    };
    return categories[this.category] || this.category;
});

ticketSchema.virtual('priorityDisplay').get(function () {
    const priorities = {
        'LOW': 'Low',
        'MEDIUM': 'Medium',
        'HIGH': 'High'
    };
    return priorities[this.priority] || this.priority;
});

ticketSchema.virtual('statusDisplay').get(function () {
    const statuses = {
        'OPEN': 'Open',
        'IN_PROGRESS': 'In Progress',
        'RESOLVED': 'Resolved'
    };
    return statuses[this.status] || this.status;
});

// Static method to generate ticket ID
ticketSchema.statics.generateTicketId = async function () {
    try {
        const lastTicket = await this.findOne(
            {},
            { ticketId: 1 },
            { sort: { createdAt: -1 } }
        );

        let newNumber = 1;
        if (lastTicket && lastTicket.ticketId) {
            const match = lastTicket.ticketId.match(/TKT-(\d+)/);
            if (match && match[1]) {
                newNumber = parseInt(match[1]) + 1;
            }
        }

        return `TKT-${newNumber.toString().padStart(3, '0')}`;
    } catch (error) {
        console.error('Error generating ticket ID:', error);
        // Fallback using timestamp
        const timestamp = Date.now();
        return `TKT-${timestamp.toString().slice(-6)}`;
    }
};

// Method to add activity log
ticketSchema.methods.addActivityLog = async function (action, performedBy, performedByModel, comment = null) {
    this.activityLogs.push({
        action,
        performedBy,
        performedByModel,
        comment,
        timestamp: new Date()
    });
    return await this.save();
};

// Method to get ticket summary
ticketSchema.methods.getSummary = function () {
    return {
        ticketId: this.ticketId,
        subject: this.subject,
        category: this.categoryDisplay,
        priority: this.priorityDisplay,
        status: this.statusDisplay,
        raisedBy: this.raisedBy,
        createdAt: this.createdAt,
        resolvedAt: this.resolvedAt,
        activityCount: this.activityLogs.length
    };
};

export default mongoose.model("Ticket", ticketSchema);