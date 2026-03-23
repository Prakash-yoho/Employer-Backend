import Joi from 'joi';

export const createEmployerUserSchema = Joi.object({
    firstName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .trim()
        .messages({
            'string.empty': 'First name is required',
            'string.min': 'First name must be at least 2 characters',
            'string.max': 'First name cannot exceed 50 characters'
        }),

    lastName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .trim()
        .messages({
            'string.empty': 'Last name is required',
            'string.min': 'Last name must be at least 2 characters',
            'string.max': 'Last name cannot exceed 50 characters'
        }),

    email: Joi.string()
        .email()
        .required()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Invalid email format',
            'string.empty': 'Email is required'
        }),

    password: Joi.string()
        .min(8)
        .max(128)
        .required()
        .pattern(
            new RegExp(
                '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&_#])[A-Za-z\\d@$!%*?&_#]{8,}$'
            )
        )
        .messages({
            'string.empty': 'Password is required',
            'string.min': 'Password must be at least 8 characters',
            'string.max': 'Password cannot exceed 128 characters',
            'string.pattern.base':
                'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
        }),

    role: Joi.string()
        .valid('EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER')
        .required()
        .messages({
            'any.only': 'Role must be one of: EMPLOYER_HR, EMPLOYER_IT, PROJECT_MANAGER',
            'string.empty': 'Role is required'
        }),

    phoneNumber: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid mobile number'
        }),

    isActive: Joi.boolean()
        .default(true)
});

export const updateEmployerUserSchema = Joi.object({
    firstName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.min': 'First name must be at least 2 characters',
            'string.max': 'First name cannot exceed 50 characters'
        }),

    lastName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.min': 'Last name must be at least 2 characters',
            'string.max': 'Last name cannot exceed 50 characters'
        }),

    email: Joi.string()
        .email()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Invalid email format'
        }),

    password: Joi.string()
        .min(8)
        .max(128)
        .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&_#])[A-Za-z\\d@$!%*?&_#]{8,}$'))
        .messages({
            'string.min': 'Password must be at least 8 characters',
            'string.max': 'Password cannot exceed 128 characters',
            'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'
        }),

    phoneNumber: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid mobile number'
        }),

    role: Joi.string()
        .valid('EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER')
        .messages({
            'any.only': 'Role must be one of: EMPLOYER_HR, EMPLOYER_IT, PROJECT_MANAGER'
        }),

    isActive: Joi.boolean()
}).min(1).messages({
    'object.min': 'At least one field is required for update'
});