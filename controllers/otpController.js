import User from "../model/User.js";
import {
    generateOtpValidation,
    verifyOtpValidation,
    resetPasswordValidation
} from "../validations/otpValidation.js";
import { createOTPRecord, verifyOTP, isValidOTP } from "../utils/otpUtils.js";
import bcrypt from "bcryptjs";
import Otp from '../model/Otp.js'
import { sendMail } from "../utils/mailer.js";
import { forgotPasswordOtpTemplate, otpSendTemplate } from "../utils/emailTemplates.js";

const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(12);
    return await bcrypt.hash(password, salt);
};


// Verify OTP
export const verifyOtp = async (req, res) => {
    try {
        const { error } = verifyOtpValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { email, phoneNumber, otp, type } = req.body;

        // Check if user exists
        const user = await User.findOne({
            $or: [
                { email: email || null },
                { phoneNumber: phoneNumber || null }
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found with this email or phone number"
            });
        }

        // Verify OTP
        const verificationResult = await verifyOTP(email, phoneNumber, otp, type);

        if (!verificationResult.success) {
            return res.status(400).json({
                success: false,
                message: verificationResult.message
            });
        }

        // If it's a verification OTP, mark user as verified
        if (type === "verification") {
            user.isVerified = true;
            await user.save();
        }

        res.status(200).json({
            success: true,
            message: verificationResult.message,
            data: {
                verified: true,
                type: type
            }
        });
    } catch (error) {
        console.error("Verify OTP error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Resend OTP
export const resendOtp = async (req, res) => {
    try {
        const { error } = generateOtpValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { email, phoneNumber } = req.body;

        // Check if user exists
        const user = await User.findOne({
            $or: [
                { email: email || null },
                { phoneNumber: phoneNumber || null }
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found with this email"
            });
        }

        // Check if there's a valid OTP already
        const hasValidOtp = await isValidOTP(email, phoneNumber, "reset");

        if (hasValidOtp) {
            return res.status(400).json({
                success: false,
                message: "A valid OTP already exists. Please wait for it to expire or use the existing OTP."
            });
        }

        // Generate new OTP
        const otp = await createOTPRecord(email, phoneNumber, "reset");

        setTimeout(async () => {
            await sendMail({
                to: email,
                subject: `OTP verification email from KIAQ Job Portal`,
                html: forgotPasswordOtpTemplate(user, otp)
            });
        }, 2000)

        res.status(200).json({
            success: true,
            message: "OTP resent successfully",
            data: {
                otp: otp,
                expiresIn: "2 minutes"
            }
        });
    } catch (error) {
        console.error("Resend OTP error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Reset Password
export const resetPassword = async (req, res) => {
    try {
        const { error } = resetPasswordValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { email, phoneNumber, newPassword, confirmPassword } = req.body;

        if (newPassword !== confirmPassword) return res.status(400).json({ success: false, message: "New Password and Confirm Password must be same." })

        // Check if user exists
        const user = await User.findOne({
            $or: [
                { email: email || null },
                { phoneNumber: phoneNumber || null }
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found with this email or phone number"
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(400).json({
                success: false,
                message: "Account is deactivated. Please contact administrator."
            });
        }

        // Verify that OTP was validated first
        const hasValidOtp = await isValidOTP(email, phoneNumber, "reset");

        // if (!hasValidOtp) {
        //     return res.status(400).json({
        //         success: false,
        //         message: "OTP verification required before password reset. Please verify OTP first."
        //     });
        // }

        // Hash new password
        const hashedPassword = await hashPassword(newPassword);

        // Update user password
        user.password = hashedPassword;
        await user.save();

        // Delete any remaining OTP records for this user
        await Otp.deleteMany({
            $or: [
                { email: email || null },
                { phoneNumber: phoneNumber || null }
            ],
            type: "reset"
        });

        res.status(200).json({
            success: true,
            message: "Password reset successfully"
        });
    } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Verify Email/Phone (Send verification OTP)
export const sendVerificationOtp = async (req, res) => {
    try {
        const { error } = generateOtpValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { email, phoneNumber } = req.body;

        // Check if user exists
        const user = await User.findOne({
            $or: [
                { email: email || null },
                { phoneNumber: phoneNumber || null }
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found with this email"
            });
        }

        // Check if already verified
        if (user.isVerified) {
            return res.status(400).json({
                success: false,
                message: "Account is already verified"
            });
        }

        // Generate verification OTP
        const otp = await createOTPRecord(email, phoneNumber, "verification");

        setTimeout(async () => {
            await sendMail({
                to: email,
                subject: `OTP verification email from Job Portal`,
                html: otpSendTemplate(user, otp)
            });
        }, 2000)

        res.status(200).json({
            success: true,
            message: "Verification OTP sent successfully",
            data: {
                otp: otp,
                expiresIn: "3 minutes"
            }
        });
    } catch (error) {
        console.error("Send verification OTP error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};