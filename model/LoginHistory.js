import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * LoginHistory
 * ─────────────────────────────────────────────────────────────────────────
 * One document per login session, for BOTH Employees (Employee/TL) and
 * EmployerUsers (EMPLOYER_ADMIN / EMPLOYER_HR / EMPLOYER_IT / PROJECT_MANAGER).
 *
 * A session is opened on login (status: 'active') and closed on logout
 * (status: 'logged_out', logoutAt set). Name/email/role/employeeId are
 * denormalized at write-time so the admin activity feed can be queried
 * directly off this collection without joins, and so history survives
 * even if the user record is later edited.
 * ─────────────────────────────────────────────────────────────────────────
 */
const loginHistorySchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        userModel: {
            type: String,
            enum: ["Employee", "EmployerUser"],
            required: true,
            index: true,
        },
        role: {
            type: String, // snapshot: Employee | TL | EMPLOYER_ADMIN | EMPLOYER_HR | EMPLOYER_IT | PROJECT_MANAGER
            required: true,
            index: true,
        },
        name: { type: String, default: null },
        email: { type: String, default: null },
        employeeId: { type: String, default: null }, // only for Employee/TL

        token: { type: String, select: false }, // used internally to match the logout call to this session

        ipAddress: { type: String, default: null },
        userAgent: { type: String, default: null },

        loginAt: { type: Date, default: Date.now, index: true },
        logoutAt: { type: Date, default: null },

        status: {
            type: String,
            enum: ["active", "logged_out"],
            default: "active",
            index: true,
        },
    },
    { timestamps: true }
);

loginHistorySchema.index({ userId: 1, loginAt: -1 });
loginHistorySchema.index({ token: 1, status: 1 });

export default mongoose.model("LoginHistory", loginHistorySchema);
