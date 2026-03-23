import Joi from "joi";

// Allowed file types and size limits
const ALLOWED_FILE_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/jpg'
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// User registration validation
export const registerValidation = Joi.object({
    // Basic Information
    fullName: Joi.string().min(2).max(100).required().messages({
        "string.empty": "Full name is required",
        "string.min": "Full name must be at least 2 characters long",
        "any.required": "Full name is required"
    }),
    email: Joi.string().email().required().messages({
        "string.email": "Please provide a valid email",
        "string.empty": "Email is required",
        "any.required": "Email is required"
    }),
    phoneNumber: Joi.string().pattern(/^\d{10}$/).required().messages({
        "string.pattern.base": "Phone number must be 10 digits",
        "any.required": "Phone number is required"
    }),
    password: Joi.string().min(6).required().messages({
        "string.min": "Password must be at least 6 characters long",
        "string.empty": "Password is required",
        "any.required": "Password is required"
    }),
    role: Joi.string().valid("hr", "candidate").required().messages({
        "any.only": "Role must be either 'hr' or 'candidate'",
        "any.required": "Role is required"
    }),

    // Personal Details
    dateOfBirth: Joi.date().max("now").optional().messages({
        "date.max": "Date of birth cannot be in the future"
    }),
    gender: Joi.string().valid("Male", "Female", "Other", "").optional(),
    parentName: Joi.string().allow("").optional(),
    address1: Joi.string().allow("").optional(),
    address2: Joi.string().allow("").optional(),
    city: Joi.string().allow("").optional(),
    state: Joi.string().allow("").optional(),
    pincode: Joi.string().pattern(/^\d{6}$/).allow("").optional().messages({
        "string.pattern.base": "Pincode must be 6 digits"
    }),

    // Educational Details
    highestEducation: Joi.string().allow("").optional(),
    institution: Joi.string().allow("").optional(),
    graduationYear: Joi.number().integer().min(1900).max(new Date().getFullYear())
        .allow(null).optional().messages({
            "number.base": "Graduation year must be a number",
            "number.min": "Graduation year is invalid",
            "number.max": "Graduation year cannot be in the future"
        }),
    percentage: Joi.number().min(0).max(100).allow(null).optional().messages({
        "number.base": "Percentage must be a number",
        "number.min": "Percentage cannot be negative",
        "number.max": "Percentage cannot exceed 100"
    }),
    specialization: Joi.string().allow("").optional(),

    // Experience and Skills
    totalExperience: Joi.number().min(0).max(50).default(0).messages({
        "number.base": "Total experience must be a number",
        "number.min": "Total experience cannot be negative",
        "number.max": "Total experience seems too high"
    }),
    designation: Joi.string().allow("").optional(),
    keySkills: Joi.array().items(Joi.string()).default([]),
    resume: Joi.object({
        data: Joi.string().base64().allow("").optional(),
        contentType: Joi.string().optional().allow(""),
        originalName: Joi.string().optional().allow(""),
        fileSize: Joi.number().optional(),
        uploadedAt: Joi.date().optional()
    }).optional()
});

// User login validation
export const loginValidation = Joi.object({
    email: Joi.string().email().optional(),
    phoneNumber: Joi.string().pattern(/^\d{10}$/).optional().messages({
        "string.pattern.base": "Phone number must be 10 digits"
    }),
    password: Joi.string().required().messages({
        "string.empty": "Password is required"
    })
});

// User update validation
export const updateUserValidation = Joi.object({
    // Basic Information
    fullName: Joi.string().min(2).max(100).optional(),
    phoneNumber: Joi.string().pattern(/^\d{10}$/).optional().messages({
        "string.pattern.base": "Phone number must be 10 digits"
    }),

    // Personal Details
    dateOfBirth: Joi.date().max("now").optional().messages({
        "date.max": "Date of birth cannot be in the future"
    }),
    gender: Joi.string().valid("Male", "Female", "Other", "").optional(),
    parentName: Joi.string().allow("").optional(),
    address1: Joi.string().allow("").optional(),
    address2: Joi.string().allow("").optional(),
    city: Joi.string().allow("").optional(),
    state: Joi.string().allow("").optional(),
    pincode: Joi.string().pattern(/^\d{6}$/).allow("").optional().messages({
        "string.pattern.base": "Pincode must be 6 digits"
    }),

    // Educational Details
    highestEducation: Joi.string().allow("").optional(),
    institution: Joi.string().allow("").optional(),
    graduationYear: Joi.number().integer().min(1900).max(new Date().getFullYear())
        .allow(null).optional().messages({
            "number.base": "Graduation year must be a number",
            "number.min": "Graduation year is invalid",
            "number.max": "Graduation year cannot be in the future"
        }),
    percentage: Joi.number().min(0).max(100).allow(null).optional().messages({
        "number.base": "Percentage must be a number",
        "number.min": "Percentage cannot be negative",
        "number.max": "Percentage cannot exceed 100"
    }),
    specialization: Joi.string().allow("").optional(),

    // Experience and Skills
    totalExperience: Joi.number().min(0).max(50).optional().messages({
        "number.base": "Total experience must be a number",
        "number.min": "Total experience cannot be negative",
        "number.max": "Total experience seems too high"
    }),
    keySkills: Joi.array().items(Joi.string()).optional(),
    resume: Joi.string().allow("").optional()
});

// Password update validation
export const changePasswordValidation = Joi.object({
    currentPassword: Joi.string().required().messages({
        "string.empty": "Current password is required"
    }),
    newPassword: Joi.string().min(6).required().messages({
        "string.min": "New password must be at least 6 characters long",
        "string.empty": "New password is required"
    })
});

// Resume upload validation
export const resumeValidation = Joi.object({
    resume: Joi.object({
        mimetype: Joi.string().valid(...ALLOWED_FILE_TYPES).required().messages({
            'any.only': 'File type not allowed. Please upload PDF, DOC, DOCX, JPEG, or PNG files.',
            'string.empty': 'Resume file is required'
        }),
        size: Joi.number().max(MAX_FILE_SIZE).required().messages({
            'number.max': 'File size must be less than 5MB',
            'any.required': 'Resume file is required'
        }),
        originalname: Joi.string().required(),
        buffer: Joi.binary().required()
    }).unknown(true).required()
});
