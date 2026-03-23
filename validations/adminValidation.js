import Joi from 'joi';

// Admin registration validation
export const adminRegistrationValidation = Joi.object({
    fullName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .messages({
            'string.empty': 'Full name is required',
            'string.min': 'Full name must be at least 2 characters long',
            'string.max': 'Full name cannot exceed 50 characters'
        }),

    email: Joi.string()
        .email()
        .required()
        .messages({
            'string.empty': 'Email is required',
            'string.email': 'Please provide a valid email address'
        }),

    password: Joi.string()
        .min(6)
        .required()
        .messages({
            'string.empty': 'Password is required',
            'string.min': 'Password must be at least 6 characters long'
        }),

    companyInfo: Joi.object({
        name: Joi.string()
            .required()
            .messages({
                'string.empty': 'Company name is required'
            }),
        location: Joi.string()
            .optional()
            .allow(''),
        logo: Joi.string()
            .optional()
            .allow('')
    }).required()
});

// Admin login validation
export const adminLoginValidation = Joi.object({
    email: Joi.string()
        .email()
        .required()
        .messages({
            'string.empty': 'Email is required',
            'string.email': 'Please provide a valid email address'
        }),

    password: Joi.string()
        .required()
        .messages({
            'string.empty': 'Password is required'
        })
});

// HR creation validation
export const createHrValidation = Joi.object({
    fullName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .messages({
            'string.empty': 'Full name is required',
            'string.min': 'Full name must be at least 2 characters long',
            'string.max': 'Full name cannot exceed 50 characters'
        }),

    email: Joi.string()
        .email()
        .required()
        .messages({
            'string.empty': 'Email is required',
            'string.email': 'Please provide a valid email address'
        }),

    phoneNumber: Joi.string()
        .pattern(/^[0-9]{10}$/)
        .required()
        .messages({
            'string.empty': 'Phone number is required',
            'string.pattern.base': 'Phone number must be 10 digits'
        }),

    designation: Joi.string()
        .required()
        .messages({
            'string.empty': 'Designation is required'
        }),

    password: Joi.string()
        .min(6)
        .required()
        .messages({
            'string.empty': 'Password is required',
            'string.min': 'Password must be at least 6 characters long'
        })
});

// Admin update validation
export const adminUpdateValidation = Joi.object({
    fullName: Joi.string()
        .min(2)
        .max(50)
        .optional()
        .messages({
            'string.min': 'Full name must be at least 2 characters long',
            'string.max': 'Full name cannot exceed 50 characters'
        }),
    email: Joi.string()
        .email()
        .optional()
        .messages({
            'string.empty': 'Email is required',
            'string.email': 'Please provide a valid email address'
        }),

    designation: Joi.string()
        .optional(),

    companyInfo: Joi.object({
        name: Joi.string()
            .optional(),
        location: Joi.string()
            .optional()
            .allow(''),
        logo: Joi.string()
            .optional()
            .allow('')
    }).optional()
});

// Change password validation
export const changePasswordValidation = Joi.object({
    currentPassword: Joi.string()
        .required()
        .messages({
            'string.empty': 'Current password is required'
        }),

    newPassword: Joi.string()
        .min(6)
        .required()
        .messages({
            'string.empty': 'New password is required',
            'string.min': 'New password must be at least 6 characters long'
        })
});