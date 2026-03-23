import mongoose, { Schema } from "mongoose";

const teamSchema = new Schema(
    {
        teamId: {
            type: String,
            unique: true,
            trim: true,
        },
        teamName: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        project: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Project",
            default: null,
        },
        // Optional — team can exist without a TL
        teamLead: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            default: null,
        },
        members: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Employee",
            },
        ],
        isActive: {
            type: Boolean,
            default: true,
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

// ── Auto-generate teamId before saving ────────────────────────────────────────
teamSchema.pre("save", async function () {
    if (this.teamId) return;

    const last = await mongoose.model("Team")
        .findOne({}, { teamId: 1 }, { includeDeleted: true })
        .sort({ createdAt: -1 })
        .lean();

    let nextNum = 1;
    if (last?.teamId) {
        const match = last.teamId.match(/^TEAM(\d+)$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
    }

    // TEAM001, TEAM002 … TEAM999, TEAM1000
    this.teamId = `TEAM${String(nextNum).padStart(3, "0")}`;
});

// ── Default filter: exclude soft-deleted docs ─────────────────────────────────
teamSchema.pre(/^find/, function () {
    if (this.getOptions().includeDeleted) return;
    this.where({ isDeleted: false });
});

export default mongoose.model("Team", teamSchema);