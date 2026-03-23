import Joi from "joi";

export const generateOtpValidation = Joi.object({
    email: Joi.string().email().optional().messages({
        "string.email": "Please provide a valid email"
    }),
    phoneNumber: Joi.string().pattern(/^\d{10}$/).optional().messages({
        "string.pattern.base": "Phone number must be 10 digits"
    })
}).or('email', 'phoneNumber').messages({
    'object.missing': 'Either email or phone number is required'
});

export const verifyOtpValidation = Joi.object({
    email: Joi.string().email().optional().messages({
        "string.email": "Please provide a valid email"
    }),
    phoneNumber: Joi.string().pattern(/^\d{10}$/).optional().messages({
        "string.pattern.base": "Phone number must be 10 digits"
    }),
    otp: Joi.string().length(6).pattern(/^\d+$/).required().messages({
        "string.length": "OTP must be 6 digits",
        "string.pattern.base": "OTP must contain only numbers"
    }),
    type: Joi.string().valid("verification", "reset").required().messages({
        "any.only": "Type must be either 'verification' or 'reset'"
    })
}).or('email', 'phoneNumber').messages({
    'object.missing': 'Either email or phone number is required'
});

export const resetPasswordValidation = Joi.object({
    email: Joi.string().email().optional().messages({
        "string.email": "Please provide a valid email"
    }),
    phoneNumber: Joi.string().pattern(/^\d{10}$/).optional().messages({
        "string.pattern.base": "Phone number must be 10 digits"
    }),
    newPassword: Joi.string().min(6).required().messages({
        "string.min": "Password must be at least 6 characters long",
        "string.empty": "New password is required"
    }),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
        "any.only": "Passwords do not match",
        "string.empty": "Confirm password is required"
    })
}).or('email', 'phoneNumber').messages({
    'object.missing': 'Either email or phone number is required'
});