import mongoose, { Schema } from "mongoose";

const officeTimingSchema = new Schema(
  {
    // Unique per organisation/tenant — extend with orgId if needed
    key: { type: String, default: "default", unique: true },

    // Stored as "HH:MM" 24-hour strings, e.g. "09:30"
    startTime:     { type: String, default: "09:30" },
    endTime:       { type: String, default: "19:00" },

    // Grace period in minutes after startTime before a login is "Late"
    graceMinutes:  { type: Number, default: 5 },

    // Grace (minutes) after an approved mid-shift permission ends before the
    // employee gets a "late return" warning
    permissionGraceMinutes: { type: Number, default: 5, min: 0 },

    updatedBy: { type: String, default: null }, // employeeId of last editor
  },
  { timestamps: true }
);

export default mongoose.model("OfficeTiming", officeTimingSchema);