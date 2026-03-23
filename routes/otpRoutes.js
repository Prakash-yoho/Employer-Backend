import express from "express";
import {
    verifyOtp,
    resendOtp,
    resetPassword,
    sendVerificationOtp
} from "../controllers/otpController.js";

const router = express.Router();

router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);
router.post("/reset-password", resetPassword);
router.post("/send-verification", sendVerificationOtp);

export default router;