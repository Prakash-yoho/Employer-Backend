// model/Announcements.js
import mongoose, { Schema } from "mongoose";

const announcementSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: ["general", "hr", "policy", "event", "urgent"],
      default: "general",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["draft", "active", "inactive"],
      default: "draft",
    },
    audience: {
      type: String,
      enum: ["all", "department", "employee"],
      default: "all",
    },
    department: {
      type: String,
      default: "",
    },
    employeeIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
      },
    ],
    publishDate: {
      type: Date,
      required: true,
    },
    // In Announcements.js model — fix the ref
createdBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "EmployerUser",   // ← was "Employee", change to your employer model name
},
createdByName: {
  type: String,
  default: "",
},
    expiryDate: {
      type: Date,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    attachments: [
      {
        filename: { type: String },
        url:      { type: String },
        key:      { type: String },   // ← S3 key for deletion
        isImage:  { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Announcement", announcementSchema);