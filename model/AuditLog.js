import mongoose from 'mongoose';

/**
 * AUDIT LOG
 * ---------
 * One row per action performed by an HR / IT / Project-Manager user.
 * Written only by the server (middleware/auditLogMiddleware.js) and
 * readable only by the Admin (routes/auditLogRoutes.js).
 * There are intentionally NO update / delete endpoints — logs are append-only.
 */
const changeSchema = new mongoose.Schema(
    {
        field: String,
        from: mongoose.Schema.Types.Mixed,
        to: mongoose.Schema.Types.Mixed,
        sensitive: Boolean,
    },
    { _id: false }
);

const entitySchema = new mongoose.Schema(
    {
        model: String,
        type: { type: String },   // friendly record type, e.g. "Leave request"
        op: { type: String, enum: ['create', 'update', 'delete'] },
        id: String,
        label: String,         // e.g. "Arun Kumar – Casual (LV-0012)"
        bulk: Boolean,
        changes: [changeSchema],
    },
    { _id: false }
);

const auditLogSchema = new mongoose.Schema(
    {
        // ── WHO ────────────────────────────────────────────────────────────
        actor: {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser', index: true },
            name: String,
            email: String,
            role: { type: String, index: true },   // EMPLOYER_HR | EMPLOYER_IT | PROJECT_MANAGER
            phoneNumber: String,
        },

        // ── WHAT ───────────────────────────────────────────────────────────
        module: { type: String, index: true },     // e.g. "Leave Management"
        action: { type: String, index: true },     // CREATE | UPDATE | DELETE | APPROVE | ...
        title: String,                             // "Approved leave request"
        description: String,                       // full readable sentence
        changedFields: [String],
        entities: [entitySchema],                  // every record created / changed / deleted
        droppedEntities: { type: Number, default: 0 },

        // ── FOR WHOM / ON WHAT ─────────────────────────────────────────────
        target: {
            type: { type: String },                // "Leave request", "Employee", ...
            id: String,
            name: String,
        },
        affectedEmployees: [
            {
                _id: false,
                id: { type: mongoose.Schema.Types.ObjectId, index: true },
                employeeId: String,                // EMP-code
                name: String,
                department: String,
                designation: String,
            },
        ],

        // ── RESULT ─────────────────────────────────────────────────────────
        outcome: { type: String, enum: ['SUCCESS', 'FAILED', 'DENIED'], default: 'SUCCESS', index: true },
        statusCode: Number,
        message: String,                           // server message (esp. for failures)

        // ── REQUEST DETAILS ────────────────────────────────────────────────
        request: {
            method: String,
            path: String,
            params: mongoose.Schema.Types.Mixed,
            query: mongoose.Schema.Types.Mixed,
            body: mongoose.Schema.Types.Mixed,     // sanitised: secrets masked, long values trimmed
            files: [String],
        },
        ip: String,
        userAgent: String,
        device: String,
        durationMs: Number,
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        skipAuditTrail: true,      // read by auditTrailPlugin — never audit the audit log
    }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ 'actor.userId': 1, createdAt: -1 });
auditLogSchema.index({ module: 1, createdAt: -1 });
auditLogSchema.index({ 'affectedEmployees.employeeId': 1, createdAt: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
