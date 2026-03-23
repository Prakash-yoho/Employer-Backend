import Otp from "../model/Otp.js";

// Generate random 6-digit OTP
export const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Create OTP record
export const createOTPRecord = async (email, phoneNumber, type = "verification") => {
    try {
        // Delete any existing OTP for this email/phone
        await Otp.deleteMany({
            $or: [
                { email: email || null },
                { phoneNumber: phoneNumber || null }
            ],
            type
        });

        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

        await Otp.create({
            email,
            phoneNumber,
            otp,
            expiresAt,
            type
        });

        return otp;
    } catch (error) {
        throw new Error("Failed to create OTP record");
    }
};

// Verify OTP
export const verifyOTP = async (email, phoneNumber, otp, type = "verification") => {
    try {
        const otpRecord = await Otp.findOne({
            $or: [
                { email: email || null },
                { phoneNumber: phoneNumber || null }
            ],
            type,
            otp
        });

        if (!otpRecord) {
            return { success: false, message: "Invalid OTP" };
        }

        if (otpRecord.isExpired()) {
            await Otp.deleteOne({ _id: otpRecord._id });
            return { success: false, message: "OTP has expired" };
        }

        // Increment attempts
        otpRecord.attempts += 1;
        await otpRecord.save();

        // Delete OTP after successful verification
        await Otp.deleteOne({ _id: otpRecord._id });

        return { success: true, message: "OTP verified successfully" };
    } catch (error) {
        throw new Error("Failed to verify OTP");
    }
};

// Check if OTP exists and is valid
export const isValidOTP = async (email, phoneNumber, type = "verification") => {
    try {
        const otpRecord = await Otp.findOne({
            $or: [
                { email: email || null },
                { phoneNumber: phoneNumber || null }
            ],
            type
        });

        if (!otpRecord) {
            return false;
        }

        if (otpRecord.isExpired()) {
            await Otp.deleteOne({ _id: otpRecord._id });
            return false;
        }

        return true;
    } catch (error) {
        return false;
    }
};