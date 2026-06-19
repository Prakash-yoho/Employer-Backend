import mongoose, { Schema } from "mongoose";

const leaveSchema = new Schema({
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
        enum: ['CASUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'LOP'],
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
                validator: function (value) { return value >= this.startDate; },
                message: 'End date cannot be before start date'
            },
            {
                validator: function (value) {
                    if (this.leaveDuration !== 'FULL_DAY') {
                        return new Date(this.startDate).toDateString() === new Date(value).toDateString();
                    }
                    return true;
                },
                message: 'Half-day leaves must be on the same day'
            }
        ]
    },
    totalDays: { type: Number, required: true, min: 0.5, max: 365 },
    sandwichDays: { type: Number, default: 0, min: 0 },
    sandwichDates: { type: [String], default: [] },
    clDays: { type: Number, default: 0, min: 0 },
    lopDays: { type: Number, default: 0, min: 0 },
    isSplit: { type: Boolean, default: false },
    splitNote: { type: String, default: null },
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 500 },
    cancelReason: { type: String, trim: true, minlength: 10, maxlength: 500, default: null },
    isSpecialLeave: { type: Boolean, default: false },
    specialLeaveNote: { type: String, default: null },

    status: {
        type: String,
        required: true,
        enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
        default: 'PENDING'
    },
    cancelledAt: Date,
    cancelledByEmployee: { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser', default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser', default: null },
    approvedComments: { type: String, trim: true, maxlength: 500, default: null },
    rejectedComments: { type: String, trim: true, maxlength: 500, default: null },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },

    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    department: { type: String, required: true },
    designation: { type: String, required: true },
    employeeEmail: String,

    appliedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ── Pre-save: compute totalDays ───────────────────────────────────────────────
leaveSchema.pre('save', function () {
    if (this.startDate && this.endDate) {
        const diffTime = Math.abs(new Date(this.endDate) - new Date(this.startDate));
        let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        if (this.leaveDuration !== 'FULL_DAY') diffDays = 0.5;
        this.totalDays = diffDays + (this.sandwichDays || 0);
    }
});

// ── generateRequestId — ATOMIC ────────────────────────────────────────────────
//
// OLD (race condition under concurrent load):
//   findOne({ sort: createdAt: -1 }) — two simultaneous requests both read
//   "LR-035" as the last ID, both compute "LR-036" → E11000 duplicate key.
//
// NEW (atomic — safe for 300+ concurrent employees):
//   findOneAndUpdate with $inc reads AND increments the counter in a single
//   MongoDB operation. MongoDB's document-level locking guarantees each
//   caller gets a unique seq value, even under extreme concurrency.
//
leaveSchema.statics.generateRequestId = async function () {
    // Retrieve Counter lazily — by the time this method is called at runtime,
    // Task.js has already registered Counter at startup.
    const Counter = mongoose.model('Counter');
    const MAX_RETRIES = 5;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const counter = await Counter.findOneAndUpdate(
            { _id: 'leaveRequestId' },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );
        const candidate = `LR-${String(counter.seq).padStart(3, '0')}`;

        // Guard: if this ID already exists (counter was behind), loop to get next
        const exists = await this.findOne({ requestId: candidate }).lean();
        if (!exists) return candidate;

        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 50 * attempt));
    }
    throw new Error('Failed to generate unique requestId after max retries');
};

// ── checkOverlap ──────────────────────────────────────────────────────────────
leaveSchema.statics.checkOverlap = async function (employeeId, startDate, endDate, leaveDuration) {
    const start = new Date(startDate); start.setHours(0, 0, 0, 0);
    const end = new Date(endDate); end.setHours(23, 59, 59, 999);
    const query = {
        employee: employeeId,
        status: { $in: ['PENDING', 'APPROVED'] },
    };
    if (leaveDuration !== 'FULL_DAY') {
        query.$or = [
            { startDate: { $lte: end }, endDate: { $gte: start }, leaveDuration: 'FULL_DAY' },
            { startDate: { $lte: end }, endDate: { $gte: start }, leaveDuration: leaveDuration },
        ];
    } else {
        query.$or = [{ startDate: { $lte: end }, endDate: { $gte: start } }];
    }
    return await this.findOne(query);
};

// ── approve / reject ──────────────────────────────────────────────────────────
leaveSchema.methods.approve = async function (approvedBy, comments = '') {
    this.status = 'APPROVED';
    this.approvedBy = approvedBy;
    this.approvedComments = comments;
    this.approvedAt = new Date();
    this.updatedAt = new Date();
    this.rejectedBy = null;
    this.rejectedComments = null;
    this.rejectedAt = null;
    return await this.save();
};

leaveSchema.methods.reject = async function (rejectedBy, comments = '') {
    this.status = 'REJECTED';
    this.rejectedBy = rejectedBy;
    this.rejectedComments = comments;
    this.rejectedAt = new Date();
    this.updatedAt = new Date();
    this.approvedBy = null;
    this.approvedComments = null;
    this.approvedAt = null;
    return await this.save();
};

// ── Indexes ───────────────────────────────────────────────────────────────────
leaveSchema.index({ employee: 1, status: 1 });
leaveSchema.index({ status: 1 });
leaveSchema.index({ startDate: 1, endDate: 1 });
leaveSchema.index({ department: 1, status: 1 });
leaveSchema.index({ createdAt: -1 });

export default mongoose.model("Leave", leaveSchema);