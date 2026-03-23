import mongoose, { Schema } from "mongoose";

const projectSchema = new Schema(
    {
        projectId: {
            type: String,
            unique: true,
            trim: true,
        },
        projectName: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        startDate: {
            type: Date,
            required: true,
        },
        endDate: {
            type: Date,
             required: true,
        },
        status: {
            type: String,
            enum: ["active", "completed", "on_hold", "cancelled", "planning"],
            default: "planning",
        },
        priority: {
            type: String,
            enum: ["low", "medium", "high", "critical"],
            default: "medium",
        },
        budget: {
            type: String,
            default: null,          // optional
        },
        client: {
            type: String,
            trim: true,
            default: null,          // optional
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EmployerUser",
            required: true,
        },

        // ── Soft delete ───────────────────────────────────────────────────────
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
        deletedAt: {
            type: Date,
            default: null,
        },
        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EmployerUser",
            default: null,
        },
    },
    { timestamps: true }
);

// ── Auto-generate projectId before saving ─────────────────────────────────────
projectSchema.pre("save", async function () {
    if (this.projectId) return;

    const last = await mongoose.model("Project")
        .findOne({}, { projectId: 1 }, { includeDeleted: true })
        .sort({ createdAt: -1 })
        .lean();

    let nextNum = 1;

    if (last?.projectId) {
        const match = last.projectId.match(/^PRJ(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    this.projectId = `PRJ${String(nextNum).padStart(3, "0")}`;
});

projectSchema.pre(/^find/, function () {
    if (this.getOptions().includeDeleted) return;
    this.where({ isDeleted: false });
});

export default mongoose.model("Project", projectSchema);