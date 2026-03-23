import mongoose, { Schema } from "mongoose";

// Leave Schema with half-day support
const leaveSchema = new Schema({
    // LEAVE REQUEST DETAILS
    requestId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    leaveType: {
        type: String,
        required: true,
        enum: ['CASUAL', 'SICK', 'OTHER'],
        default: 'CASUAL'
    },
    leaveDuration: {
        type: String,
        required: true,
        enum: ['FULL_DAY', 'FIRST_HALF', 'SECOND_HALF'],
        default: 'FULL_DAY'
    },
    startDate: {
        type: Date,
        required: true,
        validate: {
            validator: function (value) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const start = new Date(value);
                start.setHours(0, 0, 0, 0);

                return start >= today;
            },
            message: 'Start date cannot be in the past'
        }
    },

    endDate: {
        type: Date,
        required: true,
        validate: [
            {
                validator: function (value) {
                    return value >= this.startDate;
                },
                message: 'End date cannot be before start date'
            },
            {
                validator: function (value) {
                    // For half-day leaves, start and end date must be same
                    if (this.leaveDuration !== 'FULL_DAY') {
                        const start = new Date(this.startDate);
                        const end = new Date(value);
                        return start.toDateString() === end.toDateString();
                    }
                    return true;
                },
                message: 'Half-day leaves must be on the same day'
            }
        ]
    },
    totalDays: {
        type: Number,
        default: 1,
        min: 0.5,
        max: 30
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        minlength: 10,
        maxlength: 500
    },

    // STATUS & APPROVAL
    status: {
        type: String,
        required: true,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        default: null
    },
    rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        default: null
    },
    approvedComments: {
        type: String,
        trim: true,
        maxlength: 500,
        default: null
    },
    rejectedComments: {
        type: String,
        trim: true,
        maxlength: 500,
        default: null
    },
    approvedAt: {
        type: Date,
        default: null
    },
    rejectedAt: {
        type: Date,
        default: null
    },

    // APPLICANT DETAILS
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    employeeId: {
        type: String,
        required: true
    },
    employeeName: {
        type: String,
        required: true
    },
    department: {
        type: String,
        required: true
    },
    designation: {
        type: String,
        required: true
    },

    // TRACKING
    appliedAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Calculate total days before saving
leaveSchema.pre('save', function () {
    if (this.startDate && this.endDate) {
        const start = new Date(this.startDate);
        const end = new Date(this.endDate);

        // Calculate difference in days
        const diffTime = Math.abs(end - start);
        let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

        // Adjust for half-day leaves
        if (this.leaveDuration !== 'FULL_DAY') {
            diffDays = 0.5;
        }

        this.totalDays = diffDays;
    }
});

// Virtual for leave duration display
leaveSchema.virtual('durationDisplay').get(function () {
    if (this.leaveDuration === 'FULL_DAY') {
        if (this.totalDays === 1) {
            return '1 Full Day';
        }
        return `${this.totalDays} Full Days`;
    } else if (this.leaveDuration === 'FIRST_HALF') {
        return 'First Half (9 AM - 1 PM)';
    } else if (this.leaveDuration === 'SECOND_HALF') {
        return 'Second Half (1 PM - 5 PM)';
    }
    return `${this.totalDays} days`;
});

// Virtual for formatted status
leaveSchema.virtual('statusDisplay').get(function () {
    const statusMap = {
        'PENDING': 'Pending',
        'APPROVED': 'Approved',
        'REJECTED': 'Rejected'
    };
    return statusMap[this.status] || this.status;
});

// Virtual for formatted leave type
leaveSchema.virtual('leaveTypeDisplay').get(function () {
    const typeMap = {
        'CASUAL': 'Casual Leave',
        'SICK': 'Sick Leave',
        'OTHER': 'Other Leave'
    };
    return typeMap[this.leaveType] || this.leaveType;
});

// Virtual for formatted leave duration
leaveSchema.virtual('leaveDurationDisplay').get(function () {
    const durationMap = {
        'FULL_DAY': 'Full Day',
        'FIRST_HALF': 'First Half',
        'SECOND_HALF': 'Second Half'
    };
    return durationMap[this.leaveDuration] || this.leaveDuration;
});

// Static method to generate request ID
leaveSchema.statics.generateRequestId = async function () {
    try {
        const lastLeave = await this.findOne(
            {},
            { requestId: 1 },
            { sort: { createdAt: -1 } }
        ).lean();

        let newNumber = 1;
        if (lastLeave && lastLeave.requestId) {
            const match = lastLeave.requestId.match(/LR-(\d+)/);
            if (match && match[1]) {
                newNumber = parseInt(match[1]) + 1;
            }
        }

        return `LR-${newNumber.toString().padStart(3, '0')}`;
    } catch (error) {
        console.error('Error generating request ID:', error);
        const timestamp = Date.now();
        return `LR-${timestamp.toString().slice(-6)}`;
    }
};

// Static method to check for overlapping leaves (with half-day support)
leaveSchema.statics.checkOverlap = async function (employeeId, startDate, endDate, leaveDuration) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const query = {
        employee: employeeId,
        status: { $in: ['PENDING', 'APPROVED'] }
    };

    // For half-day leaves
    if (leaveDuration !== 'FULL_DAY') {
        // Check for any leave on the same date
        query.$or = [
            // Full day on same date
            {
                startDate: { $lte: end },
                endDate: { $gte: start },
                leaveDuration: 'FULL_DAY'
            },
            // Same half on same date
            {
                startDate: { $lte: end },
                endDate: { $gte: start },
                leaveDuration: leaveDuration
            }
        ];
    } else {
        // Full day leaves - check for any overlap
        query.$or = [
            {
                startDate: { $lte: end },
                endDate: { $gte: start }
            }
        ];
    }

    return await this.findOne(query);
};

// Method to approve leave
leaveSchema.methods.approve = async function (approvedBy, comments = '') {
    this.status = 'APPROVED';
    this.approvedBy = approvedBy;
    this.approvedComments = comments;
    this.approvedAt = new Date();
    this.updatedAt = new Date();

    // Clear rejection fields if previously rejected
    this.rejectedBy = null;
    this.rejectedComments = null;
    this.rejectedAt = null;

    return await this.save();
};

// Method to reject leave
leaveSchema.methods.reject = async function (rejectedBy, comments = '') {
    this.status = 'REJECTED';
    this.rejectedBy = rejectedBy;
    this.rejectedComments = comments;
    this.rejectedAt = new Date();
    this.updatedAt = new Date();

    // Clear approval fields if previously approved
    this.approvedBy = null;
    this.approvedComments = null;
    this.approvedAt = null;

    return await this.save();
};

// Method to get leave summary
leaveSchema.methods.getSummary = function () {
    return {
        requestId: this.requestId,
        employeeName: this.employeeName,
        employeeId: this.employeeId,
        leaveType: this.leaveTypeDisplay,
        leaveDuration: this.leaveDurationDisplay,
        startDate: this.startDate,
        endDate: this.endDate,
        totalDays: this.totalDays,
        status: this.statusDisplay,
        appliedAt: this.appliedAt,
        department: this.department
    };
};

// Indexes for better performance
leaveSchema.index({ employee: 1, status: 1 });
// leaveSchema.index({ requestId: 1 });
leaveSchema.index({ status: 1 });
leaveSchema.index({ startDate: 1, endDate: 1 });
leaveSchema.index({ department: 1, status: 1 });
leaveSchema.index({ createdAt: -1 });

export default mongoose.model("Leave", leaveSchema);