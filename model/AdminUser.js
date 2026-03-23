import mongoose from "mongoose";

const adminUserSchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true
        },
        password: {
            type: String,
            required: true
        },
        role: {
            type: String,
            unique: true,
            default: "admin"
        },
        companyInfo: {
            name: {
                type: String,
                required: true
            },
            location: String,
            logo: String
        },
        isActive: {
            type: Boolean,
            default: true
        }
    }, { timestamps: true })

// Remove password from JSON output
adminUserSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    return user;
};

export default mongoose.model("AdminUser", adminUserSchema);