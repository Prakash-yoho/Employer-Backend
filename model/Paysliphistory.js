import mongoose from "mongoose";

/**
 * PayslipHistory — an immutable snapshot of a single employee's slip at the
 * moment HR released it. Each release creates a new version (v1, v2, ...).
 *
 * While a slip is released, all reads (employee slip, HR list, reports,
 * violation report) serve the LATEST snapshot for that employee+month, so
 * later salary-policy / office-timing changes never alter a released slip.
 * Revert does NOT delete history; the next release adds a new version.
 */
const payslipHistorySchema = new mongoose.Schema(
  {
    month:      { type: String, required: true, index: true }, // "YYYY-MM"
    employeeId: { type: String, required: true, index: true },
    version:    { type: Number, required: true },              // 1, 2, 3...

    // Lifecycle
    releasedAt: { type: Date, default: Date.now },
    releasedBy: { type: String, default: null },
    revertedAt: { type: Date, default: null },                // set when this version is reverted
    revertedBy: { type: String, default: null },
    isCurrent:  { type: Boolean, default: true },             // the active released snapshot

    // Frozen slip payload — the COMPLETE per-employee buildPayroll object
    // (employee meta + breakdown + pay). Stored as-is so the payslip PDF and
    // on-screen view render identically forever.
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },

    // Frozen violation report data (aggregated violations + manual violations)
    // so the violation PDF also stays identical to release time.
    violationSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    // Cycle window label at release time
    cycleLabel: { type: String, default: null },
  },
  { timestamps: true }
);

payslipHistorySchema.index({ month: 1, employeeId: 1, version: 1 }, { unique: true });
payslipHistorySchema.index({ month: 1, employeeId: 1, isCurrent: 1 });

export default mongoose.model("PayslipHistory", payslipHistorySchema);