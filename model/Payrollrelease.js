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

    // Stage 1 — "Released": HR-verified, included in reports. Does NOT grant
    // employee access on its own.
    released:   { type: Boolean, default: false },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: String, default: null },
    // Full details of the HR/Admin who released: { userId, name, email, role, phoneNumber }
    releasedByDetails: { type: mongoose.Schema.Types.Mixed, default: null },

    // Revert (unrelease) tracking
    revertedAt: { type: Date, default: null },
    revertedBy: { type: String, default: null },
    revertedByDetails: { type: mongoose.Schema.Types.Mixed, default: null },

    // Stage 2 — "Published": employee can now see/download their slip.
    // Only allowed once `released` is true.
    published:   { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: String, default: null },
    // Full details of the HR/Admin who published
    publishedByDetails: { type: mongoose.Schema.Types.Mixed, default: null },

    // Unpublish (revoke visibility) tracking
    unpublishedAt: { type: Date, default: null },
    unpublishedBy: { type: String, default: null },
    unpublishedByDetails: { type: mongoose.Schema.Types.Mixed, default: null },

    // Manual worked-days override. When not null, it REPLACES the auto
    // (standardDays − LOP − violationDayCost) calculation entirely.
    manualWorkedDays: { type: Number, default: null },

    // HR-added manual violations. Each ADDS its dayCost to the violation-day
    // total (on top of auto attendance violations) and appears in the report.
    manualViolations: {
      type: [
        new mongoose.Schema(
          {
            id:      { type: String, required: true }, // client-stable id
            message: { type: String, required: true },
            date:    { type: String, required: true }, // "YYYY-MM-DD"
            dayCost: { type: Number, default: 0.5 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
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
    releasedByDetails: { type: mongoose.Schema.Types.Mixed, default: null },

    // Per-employee skipped violations
    skipped: { type: [skippedViolationSchema], default: [] },

    // Per-employee release state + manual worked-days override
    empState: { type: [empStateSchema], default: [] },

    skipAllForEveryone: { type: Boolean, default: false },

    updatedBy: { type: String, default: null },

    // ── Payroll activity log ─────────────────────────────────────────────────
    // One entry per HR/Admin action on this month's payroll. `by` holds the
    // full actor details and `changes` holds field-level { field, from, to }
    // diffs so you can always see exactly WHAT was changed and BY WHOM.
    activityLog: {
      type: [
        new mongoose.Schema(
          {
            action:      { type: String, required: true }, // RELEASED | REVERTED | PUBLISHED | UNPUBLISHED | ...
            employeeId:  { type: String, default: null },  // single-employee actions
            employeeIds: { type: [String], default: undefined }, // bulk actions
            changes: {
              type: [
                new mongoose.Schema(
                  {
                    field: { type: String, required: true },
                    from:  { type: mongoose.Schema.Types.Mixed, default: null },
                    to:    { type: mongoose.Schema.Types.Mixed, default: null },
                  },
                  { _id: false }
                ),
              ],
              default: [],
            },
            meta: { type: mongoose.Schema.Types.Mixed, default: null },   // extra context (version, scope, ...)
            by:   { type: mongoose.Schema.Types.Mixed, default: null },   // { userId, name, email, role, phoneNumber }
            at:   { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model("PayrollRelease", payrollReleaseSchema);