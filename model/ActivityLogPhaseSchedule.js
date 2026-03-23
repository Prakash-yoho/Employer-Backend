import mongoose from "mongoose";

/**
 * ACTIVITY LOG MODEL
 * Tracks every create / update / delete action on phases and schedules.
 * phaseId is stored directly so logs can be queried by phase efficiently.
 */
const activityLogSchema = new mongoose.Schema(
  {
    entity: {
      type: String,
      enum: ["Phase", "Schedule"],
      required: true,
    },

    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // ── NEW: store phaseId directly for fast phase-scoped queries ──────────────
    phaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Phase",
      default: null,
    },

    action: {
      type: String,
      enum: [
        // ───── PHASE ACTIONS ─────
        "PHASE_CREATED",
        "PHASE_UPDATED",
        "PHASE_DELETED",
        "PHASE_RESTORED",

        // ───────── SCHEDULE GROUP ACTIONS ─────────
        "SCHEDULE_GROUP_CREATED",
        "SCHEDULE_GROUP_UPDATED",
        "SCHEDULE_GROUP_DELETED",
        "SCHEDULE_GROUP_RESTORED",

        // ───────── SCHEDULE PHASE-DOC ACTIONS ─────────
        "SCHEDULE_CREATED",
        "SCHEDULE_UPDATED",
        "SCHEDULE_DELETED",
        "SCHEDULE_RESTORED",

        // ───────── EMPLOYEE ACTIONS ─────────
        "EMPLOYEE_ADDED",
        "EMPLOYEE_REMOVED",
        "EMPLOYEE_UPDATED",
      ],
      required: true,
    },

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmployerUser",
      default: null,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    message: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes for fast filtering
activityLogSchema.index({ entity: 1, action: 1, createdAt: -1 });
activityLogSchema.index({ phaseId: 1, createdAt: -1 }); // ← NEW: phase-scoped queries

export default mongoose.model("ActivityLog", activityLogSchema);