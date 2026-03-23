import Joi from 'joi';
import { isValidObjectId } from 'mongoose';

// Create leave request validation
export const createLeaveValidation = Joi.object({
    leaveType: Joi.string()
        .valid('CASUAL', 'SICK', 'OTHER')
        .required()
        .messages({
            'any.required': 'Leave type is required',
            'any.only': 'Leave type must be CASUAL, SICK, or OTHER'
        }),

    leaveDuration: Joi.string()
        .valid('FULL_DAY', 'FIRST_HALF', 'SECOND_HALF')
        .required()
        .messages({
            'any.required': 'Leave duration is required',
            'any.only': 'Leave duration must be FULL_DAY, FIRST_HALF, or SECOND_HALF'
        }),

    startDate: Joi.date()
        .iso()
        .required()
        .custom((value, helpers) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const input = new Date(value);
            input.setHours(0, 0, 0, 0);

            if (input < today) {
                return helpers.error('date.min');
            }
            return value;
        })
        .messages({
            'date.min': 'Start date cannot be in the past',
            'any.required': 'Start date is required'
        }),


    endDate: Joi.date()
        .iso()
        .required()
        .custom((value, helpers) => {
            const { leaveDuration, startDate } = helpers.state.ancestors[0];

            if (!startDate) return value;

            const start = new Date(startDate);
            const end = new Date(value);

            // For half-day, dates must be same
            if (leaveDuration !== 'FULL_DAY') {
                if (start.toDateString() !== end.toDateString()) {
                    return helpers.error('date.halfDaySameDate');
                }
            }

            // End date must be >= start date
            if (end < start) {
                return helpers.error('date.min');
            }

            return value;
        })
        .messages({
            'date.base': 'End date must be a valid date',
            'date.format': 'End date must be in ISO format (YYYY-MM-DD)',
            'date.min': 'End date cannot be before start date',
            'date.halfDaySameDate': 'Half-day leaves must be on the same date',
            'any.required': 'End date is required'
        }),

    reason: Joi.string()
        .required()
        .min(10)
        .max(500)
        .trim()
        .messages({
            'string.empty': 'Reason is required',
            'string.min': 'Reason must be at least 10 characters',
            'string.max': 'Reason cannot exceed 500 characters',
            'any.required': 'Reason is required'
        })
});

// Update leave status validation (for HR/Admin)
export const updateLeaveStatusValidation = Joi.object({
    status: Joi.string()
        .valid('APPROVED', 'REJECTED')
        .required()
        .messages({
            'any.required': 'Status is required',
            'any.only': 'Status must be APPROVED or REJECTED'
        }),

    comments: Joi.string()
        .max(500)
        .trim()
        .allow('', null)
        .messages({
            'string.max': 'Comments cannot exceed 500 characters'
        })
});

// Get leaves query validation
export const getLeavesQueryValidation = Joi.object({
    status: Joi.string()
        .valid('PENDING', 'APPROVED', 'REJECTED', 'ALL')
        .default('ALL')
        .messages({
            'any.only': 'Status must be PENDING, APPROVED, REJECTED, or ALL'
        }),

    leaveType: Joi.string()
        .valid('CASUAL', 'SICK', 'OTHER', 'ALL')
        .default('ALL')
        .messages({
            'any.only': 'Leave type must be CASUAL, SICK, OTHER, or ALL'
        }),

    leaveDuration: Joi.string()
        .valid('FULL_DAY', 'FIRST_HALF', 'SECOND_HALF', 'ALL')
        .default('ALL')
        .messages({
            'any.only': 'Leave duration must be FULL_DAY, FIRST_HALF, SECOND_HALF, or ALL'
        }),

    startDate: Joi.date()
        .iso()
        .messages({
            'date.base': 'Start date must be a valid date',
            'date.format': 'Start date must be in ISO format'
        }),

    endDate: Joi.date()
        .iso()
        .min(Joi.ref('startDate'))
        .messages({
            'date.base': 'End date must be a valid date',
            'date.format': 'End date must be in ISO format',
            'date.min': 'End date cannot be before start date'
        }),

    department: Joi.string()
        .trim()
        .max(100)
        .messages({
            'string.max': 'Department name cannot exceed 100 characters'
        }),

    page: Joi.number()
        .integer()
        .min(1)
        .default(1)
        .messages({
            'number.base': 'Page must be a number',
            'number.min': 'Page must be at least 1'
        }),

    limit: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(10)
        .messages({
            'number.base': 'Limit must be a number',
            'number.min': 'Limit must be at least 1',
            'number.max': 'Limit cannot exceed 100'
        }),

    sortBy: Joi.string()
        .valid('appliedAt', 'startDate', 'endDate', 'status', 'employeeName')
        .default('appliedAt')
        .messages({
            'any.only': 'Sort by must be appliedAt, startDate, endDate, status, or employeeName'
        }),

    sortOrder: Joi.string()
        .valid('asc', 'desc')
        .default('desc')
        .messages({
            'any.only': 'Sort order must be asc or desc'
        })
});

// ObjectId validation
export const objectIdValidation = Joi.string()
    .custom((value, helpers) => {
        if (!isValidObjectId(value)) {
            return helpers.error('any.invalid');
        }
        return value;
    }, 'ObjectId validation')
    .messages({
        'any.invalid': 'Invalid ID format'
    });

// Leave statistics validation
export const leaveStatsValidation = Joi.object({
    year: Joi.number()
        .integer()
        .min(2000)
        .max(2100)
        .default(new Date().getFullYear())
        .messages({
            'number.base': 'Year must be a number',
            'number.min': 'Year must be at least 2000',
            'number.max': 'Year cannot exceed 2100'
        }),

    department: Joi.string()
        .trim()
        .max(100)
        .messages({
            'string.max': 'Department name cannot exceed 100 characters'
        })
});

// Leave balance validation
export const leaveBalanceValidation = Joi.object({
    year: Joi.number()
        .integer()
        .min(2000)
        .max(2100)
        .default(new Date().getFullYear())
        .messages({
            'number.base': 'Year must be a number',
            'number.min': 'Year must be at least 2000',
            'number.max': 'Year cannot exceed 2100'
        })
});