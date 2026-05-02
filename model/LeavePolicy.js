import mongoose, { Schema } from "mongoose";

const leavePolicySchema = new Schema({
    policyName: {
        type: String,
        required: true,
        trim: true
    },

    // ── Salary / Leave cycle ──────────────────────────────────────────────
    // startDay: the day of month the cycle begins (e.g. 21 → cycle is 21st to 20th)
    // endDay is always (startDay - 1) of the next month — auto-derived, not stored
    salaryCycle: {
        startDay: {
            type:    Number,
            default: 1,
            min:     1,
            max:     28  // max 28 to be safe across all months
        }
    },

    appliesTo: {
        type:     String,
        enum:     ['ALL', 'PERMANENT'],
        required: true
    },

    leaveTypes: {
        casual: {
            enabled:    { type: Boolean, default: true },
            daysPerYear:{ type: Number,  default: 12 },
            description:{ type: String,  default: 'Casual Leave - 3 per cycle-quarter, non-carry-forward' }
        },
        sick: {
            enabled:    { type: Boolean, default: false },
            daysPerYear:{ type: Number,  default: 10 },
            description:{ type: String,  default: 'Sick Leave - annual, HR editable' }
        },
        maternity: {
            enabled:    { type: Boolean, default: false },
            daysPerYear:{ type: Number,  default: 182 },
            description:{ type: String,  default: 'Maternity Leave - as per local law' }
        },
        paternity: {
            enabled:    { type: Boolean, default: false },
            daysPerYear:{ type: Number,  default: 15 },
            description:{ type: String,  default: 'Paternity Leave - as per local law' }
        }
    },

    permissionLeave: {
        enabled:      { type: Boolean, default: true },
        hoursPerMonth:{ type: Number,  default: 2 },
        description:  { type: String,  default: 'Permission leave - up to 2 hours/day, max 1/month' }
    },

    isActive:  { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser' }
}, { timestamps: true });

export default mongoose.model("LeavePolicy", leavePolicySchema);