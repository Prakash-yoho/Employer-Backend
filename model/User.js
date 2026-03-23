import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        // Basic Information
        fullName: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        phoneNumber: {
            type: String,
            required: true,
            trim: true
        },
        password: {
            type: String,
            required: true,
            minlength: 6
        },
        role: {
            type: String,
            enum: ["hr", "candidate", "employee"],
            required: true
        },

        // Personal Details
        dateOfBirth: {
            type: Date
        },
        gender: {
            type: String,
            enum: ["Male", "Female", "Other", ""],
            default: ""
        },
        parentName: {
            type: String,
            default: ""
        },
        address1: {
            type: String,
            default: ""
        },
        address2: {
            type: String,
            default: ""
        },
        city: {
            type: String,
            default: ""
        },
        state: {
            type: String,
            default: ""
        },
        pincode: {
            type: String,
            default: ""
        },

        // Educational Details
        highestEducation: {
            type: String,
            default: ""
        },
        institution: {
            type: String,
            default: ""
        },
        graduationYear: {
            type: Number,
            default: null
        },
        percentage: {
            type: Number,
            default: null
        },
        specialization: {
            type: String,
            default: ""
        },

        // Experience and Skills
        totalExperience: {
            type: Number,
            default: 0
        },
        designation: {
            type: String,
            default: ''
        },
        keySkills: [{
            type: String
        }],

        // Resume Information
        resume: {
            url: { type: String, default: "" },
            originalName: { type: String, default: "" },
            contentType: { type: String, default: "" },
            fileSize: { type: Number, default: 0 },
            uploadedAt: { type: Date, default: null }
        },

        // Account Status
        isActive: {
            type: Boolean,
            default: true
        },
        isVerified: {
            type: Boolean,
            default: false
        },
        lastLogin: {
            type: Date
        }
    },
    {
        timestamps: true
    }
);

// Method to handle resume upload
userSchema.methods.uploadResume = async function (fileBuffer, originalName, contentType) {
    const base64Data = fileBuffer.toString('base64');
    const fileSize = fileBuffer.length;

    this.resume = {
        data: base64Data,
        contentType: contentType,
        originalName: originalName,
        fileSize: fileSize,
        uploadedAt: new Date()
    };

    return await this.save();
};

// Method to remove resume
userSchema.methods.removeResume = async function () {
    this.resume = {
        data: "",
        contentType: "",
        originalName: "",
        fileSize: 0,
        uploadedAt: null
    };

    return await this.save();
};


// Remove password from JSON output
userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    return user;
};

export default mongoose.model("User", userSchema);