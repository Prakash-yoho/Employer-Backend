import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
    email: {
        type: String,
        required: function () {
            return !this.phoneNumber;
        }
    },
    phoneNumber: {
        type: String,
        required: function () {
            return !this.email;
        }
    },
    otp: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true
    },
    type: {
        type: String,
        enum: ["verification", "reset"],
        required: true
    },
    attempts: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Create TTL index for automatic expiration
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to check if OTP is expired
otpSchema.methods.isExpired = function () {
    return Date.now() > this.expiresAt;
};

export default mongoose.model("Otp", otpSchema);