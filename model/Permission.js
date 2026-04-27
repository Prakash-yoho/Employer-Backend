import mongoose, { Schema } from "mongoose";

const permissionSchema = new Schema({
    requestId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    department: { type: String, required: true },
    designation: { type: String, required: true },
    date: {
        type: Date,
        required: true
    },
    fromTime: {
        type: String,
        required: true // e.g. "10:00"
    },
    toTime: {
        type: String,
        required: true // e.g. "12:00"
    },
    durationHours: {
        type: Number,
        required: true,
        max: 2
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        minlength: 10,
        maxlength: 300
    },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING'
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser', default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser', default: null },
    approvedComments: { type: String, default: null },
    rejectedComments: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    appliedAt: { type: Date, default: Date.now }
}, { timestamps: true });

permissionSchema.statics.generateRequestId = async function () {
    const last = await this.findOne({}, { requestId: 1 }, { sort: { createdAt: -1 } }).lean();
    let num = 1;
    if (last?.requestId) {
        const match = last.requestId.match(/PR-(\d+)/);
        if (match) num = parseInt(match[1]) + 1;
    }
    return `PR-${num.toString().padStart(3, '0')}`;
};

export default mongoose.model("Permission", permissionSchema);