// ── Attendance.js — add these four fields to your existing attendanceSchema ──
//
// Inside the Schema({...}) object, alongside clockOut / clockOutLocation, add:
//
//   lateLogin:      { type: Boolean, default: false },
//   lateByMinutes:  { type: Number,  default: null  },
//   earlyLogout:    { type: Boolean, default: false },
//   earlyByMinutes: { type: Number,  default: null  },
//
// Full updated schema for reference:

import mongoose, { Schema } from "mongoose";

const locationSchema = new Schema(
  {
    latitude:  { type: Number, default: null },
    longitude: { type: Number, default: null },
    accuracy:  { type: Number, default: null },
  },
  { _id: false }
);

// In model/Attendance.js — update breakSchema only
const breakSchema = new Schema(
  {
    start:         { type: String, default: null },
    end:           { type: String, default: null },
    startImage:    { type: String, default: null },
    endImage:      { type: String, default: null },
    startLocation: { type: locationSchema, default: null },
    endLocation:   { type: locationSchema, default: null },

    // ── NEW ──
    breakType:      { type: String, enum: ["MORNING", "LUNCH", "EVENING", "OTHER"], default: "OTHER" },
    allowedMinutes: { type: Number, default: null },   // copied from policy at break-start time
    overByMinutes:  { type: Number, default: null },   // computed on break-end; null = on time
    isBreakViolation: { type: Boolean, default: false },
    // ─────────
  },
  { _id: false }
);

const attendanceSchema = new Schema(
  {
    employeeId: { type: String, required: true },
    date:       { type: String, required: true },

    clockIn:         { type: String, default: null },
    clockInImage:    { type: String, default: null },
    clockInLocation: { type: locationSchema, default: null },

    // ── NEW ──
    lateLogin:      { type: Boolean, default: false },
    lateByMinutes:  { type: Number,  default: null  },
    // ─────────

    breaks: { type: [breakSchema], default: [] },

    clockOut:         { type: String, default: null },
    clockOutImage:    { type: String, default: null },
    clockOutLocation: { type: locationSchema, default: null },

    // ── NEW ──
    earlyLogout:    { type: Boolean, default: false },
    earlyByMinutes: { type: Number,  default: null  },
    // ─────────
  },
  { timestamps: true }
);

export default mongoose.model("Attendance", attendanceSchema);