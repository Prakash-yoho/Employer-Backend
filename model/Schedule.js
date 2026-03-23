import mongoose from "mongoose";

// ── Per-employee entry inside a schedule-phase ────────────────────────────────
const employeeEntrySchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    removedAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

// ── Main schedule-phase document ──────────────────────────────────────────────
const scheduleSchema = new mongoose.Schema(
  {
    scheduleGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      // index: true,
    },
    scheduleName: {
      type: String,
      required: true,
    },
    scheduleNumber: {
      type: Number,
      required: true,
    },
    phase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Phase",
      required: true,
    },
    fromDate: {
      type: Date,
      required: true,
    },
    toDate: {
      type: Date,
      required: true,
    },
    employees: [employeeEntrySchema],
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    // ── IMPORTANT: virtuals must be enabled so isExpired
    //    appears in res.json() and .toObject() calls.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Virtual: isExpired ────────────────────────────────────────────────────────
// true  → schedule's toDate has already passed today (read-only, employees locked)
// false → schedule is upcoming or currently active
//
// Because this is a virtual it is computed on-the-fly — no cron needed,
// no migration needed, always accurate.
//
// It will appear automatically in every API response that returns a
// Schedule document (getScheduleById, getSchedulesByPhase,
// getAllSchedulesGrouped, getAllPhasesWithSchedules, etc.)
scheduleSchema.virtual("isExpired").get(function () {
  if (!this.toDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const to = new Date(this.toDate);
  to.setHours(23, 59, 59, 999);
  return today > to;
});

// ── Virtual: scheduleStatus ───────────────────────────────────────────────────
// A single human-readable status string for the frontend to display.
//   "upcoming"  → fromDate is in the future
//   "active"    → fromDate <= today <= toDate
//   "expired"   → toDate is in the past
scheduleSchema.virtual("scheduleStatus").get(function () {
  if (!this.fromDate || !this.toDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(this.fromDate);
  const to = new Date(this.toDate);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  if (today > to) return "expired";
  if (today < from) return "upcoming";
  return "active";
});

// Prevent duplicate schedule numbers within the same phase
scheduleSchema.index({ phase: 1, scheduleNumber: 1 }, { unique: true });

export default mongoose.model("Schedule", scheduleSchema);