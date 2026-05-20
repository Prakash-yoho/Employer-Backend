import mongoose, { Schema } from "mongoose";

const breakSlotSchema = new Schema(
  {
    type:           { type: String, enum: ["MORNING", "LUNCH", "EVENING"], required: true },
    label:          { type: String, default: "" },
    allowedMinutes: { type: Number, required: true },
    isActive:       { type: Boolean, default: true },
  },
  { _id: false }
);

const breakPolicySchema = new Schema(
  {
    key:  { type: String, default: "default", unique: true },
    slots: {
      type: [breakSlotSchema],
      default: [
        { type: "MORNING", label: "Morning Break", allowedMinutes: 15 },
        { type: "LUNCH",   label: "Lunch Break",   allowedMinutes: 60 },
        { type: "EVENING", label: "Evening Break", allowedMinutes: 15 },
      ],
    },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("BreakPolicy", breakPolicySchema);