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

    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ViolationGracePolicy", violationGracePolicySchema);