// model/BreakPolicy.js
import mongoose, { Schema } from "mongoose";

const breakSlotSchema = new Schema(
  {
    type:          { type: String, enum: ["MORNING", "LUNCH", "EVENING"], required: true },
    label:         { type: String, default: "" },          // e.g. "Morning Break"
    allowedMinutes:{ type: Number, required: true },       // 15 / 60 / 15
    startWindow:   { type: String, default: null },        // "HH:MM" earliest allowed start
    endWindow:     { type: String, default: null },        // "HH:MM" latest allowed end
    isActive:      { type: Boolean, default: true },
  },
  { _id: false }
);

const breakPolicySchema = new Schema(
  {
    key:    { type: String, default: "default", unique: true },
    slots:  { type: [breakSlotSchema], default: [
      { type: "MORNING", label: "Morning Break", allowedMinutes: 15, startWindow: "10:30", endWindow: "11:00" },
      { type: "LUNCH",   label: "Lunch Break",   allowedMinutes: 60, startWindow: "13:00", endWindow: "14:30" },
      { type: "EVENING", label: "Evening Break", allowedMinutes: 15, startWindow: "16:30", endWindow: "17:00" },
    ]},
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("BreakPolicy", breakPolicySchema);