import mongoose, { Schema } from "mongoose";

const counterSchema = new Schema({
    _id: { type: String, required: true }, // e.g., 'taskId'
    seq: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', counterSchema);

const correctionHistorySchema = new Schema(
    {
        reason: { type: String, required: true },
        // Dynamic ref — TL is Employee, PM is EmployerUser
        correctedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "correctionHistory.correctedByModel",
        },
        correctedByModel: {
            type: String,
            enum: ["Employee", "EmployerUser"],
        },
        correctedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const taskSchema = new Schema(
    {
        // ── Auto-generated task ID ─────────────────────────────────────────────
        taskId: {
            type: String,
            unique: true,
            trim: true,
        },

        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        deadline: {
            type: Date,
            required: true,
        },
        additionalNotice: {
            type: String,
            trim: true,
            default: null,
        },

        priority: {
            type: String,
            enum: ["low", "medium", "high"],
            default: "medium",
        },

        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            required: true,
        },

        team: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Team",
            default: null,
        },

        // PM (EmployerUser) who created the task
        assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "assignedByModel",   // ← dynamic ref
            required: true,
        },
        assignedByModel: {
            type: String,
            enum: ["EmployerUser", "Employee"],
            required: true,
            default: "EmployerUser",
        },

        // ── TL who supervises this task — null if PM assigned directly to TL ─────────
        supervisedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            default: null,
        },

        /*
         * ── Status lifecycle ─────────────────────────────────────────
                /*
                 * ── Status lifecycle ──────────────────────────────────────────────────
                 *
                 *  pending
                 *    ↓  employee starts
                 *  in_progress
                 *    ↓  employee submits
                 *  completed_by_employee
                 *    ↓  TL or PM reviews — three options:
                 *    ├─ approve    → completed   (no reason needed)
                 *    ├─ correction → in_progress (reason required, logged in correctionHistory)
                 *    └─ revoke     → revoked     (reason required)
                 *
                 *  "need_correction" is NOT a status —
                 *  correction sends the task back to in_progress directly.
                 */

        status: {
            type: String,
            enum: [
                "pending",
                "in_progress",
                "completed_by_employee",
                "completed",
                "revoked",
                "incomplete",   
                // "overtime",     // ← deadline crossed, task still active
            ],
            default: "pending",
        },


        // Remark left by TL or PM on correction or revoke
        tlRemark: {
            type: String,
            trim: true,
            default: null,
        },

        // Full history of every correction sent
        correctionHistory: [correctionHistorySchema],

        // Set once when employee first moves task to in_progress
        startedAt: {
            type: Date,
            default: null,
        },

        // Timestamp when task is completed or revoked
        resolvedAt: {
            type: Date,
            default: null,
        },

        // true once employee submits — signals TL/PM to review
        notifiedTL: {
            type: Boolean,
            default: false,
        },
        // ── Who last edited the task (PM or TL) ──────────────────────────────────────
        lastModifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "lastModifiedByModel",
            default: null,
        },
        lastModifiedByModel: {
            type: String,
            enum: ["EmployerUser", "Employee"],
            default: null,
        },

        // ── Who closed the task (completed / revoked) ─────────────────────────────────
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "resolvedByModel",
            default: null,
        },
        resolvedByModel: {
            type: String,
            enum: ["EmployerUser", "Employee"],
            default: null,
        },


        // ── Overtime tracking ─────────────────────────────────────────────────────────
        isOvertime: {
            type: Boolean,
            default: false,
        },
        overtimeAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

// ── Auto-generate taskId before saving ────────────────────────────────────────
taskSchema.pre('save', async function () {
    if (this.taskId) return;

    const MAX_RETRIES = 5;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const counter = await Counter.findByIdAndUpdate(
            'taskId',
            { $inc: { seq: 1 } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        const candidate = `TASK${String(counter.seq).padStart(3, '0')}`;

        // Guard: if this ID already exists in DB, loop again
        const exists = await mongoose.model('Task').findOne({ taskId: candidate }).lean();
        if (!exists) {
            this.taskId = candidate;
            return; // done
        }
        // else: counter already moved forward, next iteration gets a new seq
        if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 50 * attempt));
        }
    }

    throw new Error('Failed to generate unique taskId after max retries');
});
export default mongoose.model("Task", taskSchema);