import mongoose from "mongoose";

/**
 * ViolationGracePolicy — singleton (key: "default")
 *
 * Grace thresholds used ONLY for salary-deduction violations.
 * Independent of OfficeTiming.graceMinutes (which drives employee warnings).
 *
 * Break grace is now PER break type (MORNING / LUNCH / EVENING) so HR can
 * tune each break independently for salary purposes.
 */
const breakGraceSchema = new mongoose.Schema(
  {
    MORNING: { type: Number, default: 0, min: 0 },
    LUNCH:   { type: Number, default: 0, min: 0 },
    EVENING: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const violationGracePolicySchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },

    // Minutes after OfficeTiming.startTime before a salary late violation
    loginGraceMinutes: { type: Number, default: 0, min: 0 },

    // Minutes before OfficeTiming.endTime before a salary early-logout violation
    logoutGraceMinutes: { type: Number, default: 0, min: 0 },

    // Per-break-type grace (extra minutes over each break's allowedMinutes)
    breakGrace: { type: breakGraceSchema, default: () => ({}) },

    // Salary days deducted for EACH violation (late / early logout / break /
    // missed clock-out). HR-configurable. Default 0.5 = previous fixed behaviour.
    violationDayCost: { type: Number, default: 0.5, min: 0, max: 10 },

    // Salary days deducted for each "not marked" day (no attendance and no
    // approved leave). HR-configurable. Default 2 = previous fixed behaviour.
    notMarkedDeductionDays: { type: Number, default: 2, min: 0, max: 10 },

    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ViolationGracePolicy", violationGracePolicySchema);