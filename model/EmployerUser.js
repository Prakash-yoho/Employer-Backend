import mongoose from "mongoose";

const employerUserSchema = new mongoose.Schema(
    {
        firstName: {
            type: String,
            required: true,
            trim: true
        },
        lastName: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, "Invalid email format"]
        },
        password: {
            type: String,
            required: true
        },
        role: {
            type: String,
            enum: ["EMPLOYER_HR", "EMPLOYER_ADMIN", "EMPLOYER_IT" ,"PROJECT_MANAGER"],
            required: true
        },
        phoneNumber: {
            type: String,
            required: true,
            match: [/^[6-9]\d{9}$/, "Invalid mobile number"]
        },
        isActive: {
            type: Boolean,
            default: true
        },
        // Cached login-activity fields (source of truth is the LoginHistory collection)
        loginStatus: {
            type: String,
            enum: ["Online", "Offline"],
            default: "Offline"
        },
        lastLoginAt: {
            type: Date,
            default: null
        },
        lastLogoutAt: {
            type: Date,
            default: null
        }
    }, { timestamps: true })


// Remove password from JSON output
employerUserSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    return user;
};

export default mongoose.model("EmployerUser", employerUserSchema);