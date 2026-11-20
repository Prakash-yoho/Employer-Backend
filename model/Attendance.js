import mongoose, { Schema } from "mongoose";

const locationSchema = new Schema(
  {
    latitude:  { type: Number, default: null },
    longitude: { type: Number, default: null },
    accuracy:  { type: Number, default: null },
  },
  { _id: false }
);

const breakSchema = new Schema(
  {
    start:         { type: String, default: null },
    end:           { type: String, default: null },
    startImage:    { type: String, default: null },
    endImage:      { type: String, default: null },
    startLocation: { type: locationSchema, default: null },
    endLocation:   { type: locationSchema, default: null },
    breakType:        { type: String, enum: ["MORNING", "LUNCH", "EVENING"], required: true },
    allowedMinutes:   { type: Number, default: null },
    overByMinutes:    { type: Number, default: null },
    isBreakViolation: { type: Boolean, default: false },
  },
  { _id: false }
);

// Mid-shift permission "Out / In" record (only for APPROVED permissions)
const permissionEntrySchema = new Schema(
  {
    requestId:        { type: String, required: true },
    fromTime:         { type: String, default: null }, // approved window "HH:MM"
    toTime:           { type: String, default: null },
    allowedMinutes:   { type: Number, default: null },
    start:            { type: String, default: null }, // "h:mm:ss A" when employee stepped out
    end:              { type: String, default: null }, // "h:mm:ss A" when employee was back
    overByMinutes:    { type: Number, default: null }, // minutes after approved end
    isViolation:      { type: Boolean, default: false },
    startImage:       { type: String, default: null },
    endImage:         { type: String, default: null },
    startLocation:    { type: locationSchema, default: null },
    endLocation:      { type: locationSchema, default: null },
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
    lateLogin:       { type: Boolean, default: false },
    lateByMinutes:   { type: Number,  default: null },

    breaks: { type: [breakSchema], default: [] },
    permissionEntries: { type: [permissionEntrySchema], default: [] },

    clockOut:         { type: String, default: null },
    clockOutImage:    { type: String, default: null },
    clockOutLocation: { type: locationSchema, default: null },
    earlyLogout:      { type: Boolean, default: false },
    earlyByMinutes:   { type: Number,  default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Attendance", attendanceSchema);