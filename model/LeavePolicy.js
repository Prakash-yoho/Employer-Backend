import mongoose, { Schema } from "mongoose";

const leavePolicySchema = new Schema({
    policyName: {
        type: String,
        required: true,
        trim: true
    },
    // Who this policy applies to
    appliesTo: {
        type: String,
        enum: ['ALL', 'PERMANENT'],
        required: true
    },
    leaveTypes: {
        casual: {
            enabled: { type: Boolean, default: true },
            daysPerYear: { type: Number, default: 12 }, // distributed quarterly: 3/qtr
            description: { type: String, default: 'Casual Leave - 3 per quarter, non-carry-forward' }
        },
        sick: {
            enabled: { type: Boolean, default: false }, // only for PERMANENT
            daysPerYear: { type: Number, default: 10 },
            description: { type: String, default: 'Sick Leave - annual, HR editable' }
        },
        maternity: {
            enabled: { type: Boolean, default: false }, // only for PERMANENT
            daysPerYear: { type: Number, default: 182 }, // 26 weeks as per local law
            description: { type: String, default: 'Maternity Leave - as per local law' }
        },
        paternity: {
            enabled: { type: Boolean, default: false }, // only for PERMANENT
            daysPerYear: { type: Number, default: 15 },
            description: { type: String, default: 'Paternity Leave - as per local law' }
        }
    },
    permissionLeave: {
        enabled: { type: Boolean, default: true },
        hoursPerMonth: { type: Number, default: 2 }, // 2 hours per month
        description: { type: String, default: 'Permission leave - up to 2 hours/day, max 1/month' }
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser' }
}, { timestamps: true });

export default mongoose.model("LeavePolicy", leavePolicySchema);