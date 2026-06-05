import mongoose from "mongoose";

/**
 * PayrollRelease — one document per payroll month (key = "YYYY-MM").
 *
 * Stores ONLY the small bits of state we can't recompute from attendance:
 *   - which employees' slips are released
 *   - per-employee skipped violation IDs
 *   - per-employee manual worked-days override
 *
 * All salary numbers are computed LIVE from attendance + annualSalary each
 * time — nothing financial is frozen here (except the manual override input).
 */
const skippedViolationSchema = new mongoose.Schema(
  {
    employeeId:   { type: String, required: true },
    violationIds: { type: [String], default: [] },
  },
  { _id: false }
);

// Per-employee release state + manual override
const empStateSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true },

    // Selective release — this employee's slip is released
    released:   { type: Boolean, default: false },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: String, default: null },

    // Manual worked-days override. When not null, it REPLACES the auto
    // (standardDays − LOP − violationDayCost) calculation entirely.
    manualWorkedDays: { type: Number, default: null },
  },
  { _id: false }
);

const payrollReleaseSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true },

    // Global release flag (kept for "release everyone" convenience + back-compat)
    released:   { type: Boolean, default: false },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: String, default: null },

    // Per-employee skipped violations
    skipped: { type: [skippedViolationSchema], default: [] },

    // Per-employee release state + manual worked-days override
    empState: { type: [empStateSchema], default: [] },

    skipAllForEveryone: { type: Boolean, default: false },

    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("PayrollRelease", payrollReleaseSchema);