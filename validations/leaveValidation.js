import Joi from 'joi';
import { isValidObjectId } from 'mongoose';

// ─── Create Leave Request ─────────────────────────────────────────────────────

export const createLeaveValidation = Joi.object({
    leaveType: Joi.string()
        .valid('CASUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'LOP')
        .required()
        .messages({
            'any.required': 'Leave type is required',
            'any.only': 'Leave type must be CASUAL, SICK, MATERNITY, PATERNITY, or LOP'
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
            if (input < today) return helpers.error('date.min');
            return value;
        })
        .messages({
            'date.base': 'Start date must be a valid date',
            'date.format': 'Start date must be in ISO format (YYYY-MM-DD)',
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
            const end   = new Date(value);

            if (end < start)
                return helpers.error('date.min');

            if (leaveDuration !== 'FULL_DAY' && start.toDateString() !== end.toDateString())
                return helpers.error('date.halfDaySameDate');

            return value;
        })
        .messages({
            'date.base':            'End date must be a valid date',
            'date.format':          'End date must be in ISO format (YYYY-MM-DD)',
            'date.min':             'End date cannot be before start date',
            'date.halfDaySameDate': 'Half-day leaves must be on the same date',
            'any.required':         'End date is required'
        }),

    reason: Joi.string()
        .required()
        .min(10)
        .max(500)
        .trim()
        .messages({
            'string.empty':   'Reason is required',
            'string.min':     'Reason must be at least 10 characters',
            'string.max':     'Reason cannot exceed 500 characters',
            'any.required':   'Reason is required'
        })
});

// ─── Update Leave Status (HR/Admin) ──────────────────────────────────────────

export const updateLeaveStatusValidation = Joi.object({
    status: Joi.string()
        .valid('APPROVED', 'REJECTED')
        .required()
        .messages({
            'any.required': 'Status is required',
            'any.only':     'Status must be APPROVED or REJECTED'
        }),

    comments: Joi.string()
        .max(500)
        .trim()
        .allow('', null)
        .optional()
        .messages({
            'string.max': 'Comments cannot exceed 500 characters'
        })
});

// ─── Get Leaves Query (list/filter) ──────────────────────────────────────────

export const getLeavesQueryValidation = Joi.object({
    status: Joi.string()
        .valid('PENDING', 'APPROVED', 'REJECTED', 'ALL')
        .default('ALL')
        .messages({
            'any.only': 'Status must be PENDING, APPROVED, REJECTED, or ALL'
        }),

    leaveType: Joi.string()
        .valid('CASUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'LOP', 'ALL')
        .default('ALL')
        .messages({
            'any.only': 'Leave type must be CASUAL, SICK, MATERNITY, PATERNITY, LOP, or ALL'
        }),

    leaveDuration: Joi.string()
        .valid('FULL_DAY', 'FIRST_HALF', 'SECOND_HALF', 'ALL')
        .default('ALL')
        .messages({
            'any.only': 'Leave duration must be FULL_DAY, FIRST_HALF, SECOND_HALF, or ALL'
        }),

    startDate: Joi.date()
        .iso()
        .optional()
        .messages({
            'date.base':   'Start date must be a valid date',
            'date.format': 'Start date must be in ISO format'
        }),

    endDate: Joi.date()
        .iso()
        .min(Joi.ref('startDate'))
        .optional()
        .messages({
            'date.base':   'End date must be a valid date',
            'date.format': 'End date must be in ISO format',
            'date.min':    'End date cannot be before start date'
        }),

    department: Joi.string()
        .trim()
        .max(100)
        .optional()
        .messages({
            'string.max': 'Department name cannot exceed 100 characters'
        }),

    page: Joi.number()
        .integer()
        .min(1)
        .default(1)
        .messages({
            'number.base': 'Page must be a number',
            'number.min':  'Page must be at least 1'
        }),

    limit: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(10)
        .messages({
            'number.base': 'Limit must be a number',
            'number.min':  'Limit must be at least 1',
            'number.max':  'Limit cannot exceed 100'
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

// ─── Permission Request ───────────────────────────────────────────────────────

export const createPermissionValidation = Joi.object({
    date: Joi.date()
        .iso()
        .required()
        .custom((value, helpers) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const input = new Date(value);
            input.setHours(0, 0, 0, 0);
            if (input < today) return helpers.error('date.min');
            return value;
        })
        .messages({
            'date.base':    'Date must be a valid date',
            'date.format':  'Date must be in ISO format (YYYY-MM-DD)',
            'date.min':     'Permission date cannot be in the past',
            'any.required': 'Date is required'
        }),

    fromTime: Joi.string()
        .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
        .required()
        .messages({
            'string.pattern.base': 'fromTime must be in HH:MM format (24-hour)',
            'any.required':        'fromTime is required'
        }),

    toTime: Joi.string()
        .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
        .required()
        .messages({
            'string.pattern.base': 'toTime must be in HH:MM format (24-hour)',
            'any.required':        'toTime is required'
        }),

    reason: Joi.string()
        .required()
        .min(10)
        .max(300)
        .trim()
        .messages({
            'string.empty':   'Reason is required',
            'string.min':     'Reason must be at least 10 characters',
            'string.max':     'Reason cannot exceed 300 characters',
            'any.required':   'Reason is required'
        })
}).custom((value, helpers) => {
    // Cross-field: toTime must be after fromTime and within 2 hours
    const [fH, fM] = value.fromTime.split(':').map(Number);
    const [tH, tM] = value.toTime.split(':').map(Number);
    const totalMinutes = (tH * 60 + tM) - (fH * 60 + fM);

    if (totalMinutes <= 0)
        return helpers.error('object.timeOrder');
    if (totalMinutes > 120)
        return helpers.error('object.timeExceedsLimit');

    return value;
}, 'Permission time validation').messages({
    'object.timeOrder':        'toTime must be after fromTime',
    'object.timeExceedsLimit': 'Permission cannot exceed 2 hours'
});

// ─── Update Permission Status (HR/Admin) ─────────────────────────────────────

export const updatePermissionStatusValidation = Joi.object({
    status: Joi.string()
        .valid('APPROVED', 'REJECTED')
        .required()
        .messages({
            'any.required': 'Status is required',
            'any.only':     'Status must be APPROVED or REJECTED'
        }),

    comments: Joi.string()
        .max(500)
        .trim()
        .allow('', null)
        .optional()
        .messages({
            'string.max': 'Comments cannot exceed 500 characters'
        })
});

// ─── Leave Policy ─────────────────────────────────────────────────────────────

export const createLeavePolicyValidation = Joi.object({
    policyName: Joi.string()
        .trim()
        .max(100)
        .default('Default Leave Policy')
        .messages({
            'string.max': 'Policy name cannot exceed 100 characters'
        }),

    appliesTo: Joi.string()
        .valid('ALL', 'PERMANENT')
        .default('ALL')
        .messages({
            'any.only': 'appliesTo must be ALL or PERMANENT'
        }),

    leaveTypes: Joi.object({
        casual: Joi.object({
            enabled:    Joi.boolean().default(true),
            daysPerYear: Joi.number().integer().min(1).max(30).default(12)
                .messages({
                    'number.min': 'Casual leave days must be at least 1',
                    'number.max': 'Casual leave days cannot exceed 30'
                })
        }).optional(),

        sick: Joi.object({
            enabled:    Joi.boolean().default(false),
            daysPerYear: Joi.number().integer().min(1).max(30).default(10)
                .messages({
                    'number.min': 'Sick leave days must be at least 1',
                    'number.max': 'Sick leave days cannot exceed 30'
                })
        }).optional(),

        maternity: Joi.object({
            enabled:    Joi.boolean().default(false),
            daysPerYear: Joi.number().integer().min(1).max(365).default(182)
                .messages({
                    'number.min': 'Maternity leave days must be at least 1',
                    'number.max': 'Maternity leave days cannot exceed 365'
                })
        }).optional(),

        paternity: Joi.object({
            enabled:    Joi.boolean().default(false),
            daysPerYear: Joi.number().integer().min(1).max(60).default(15)
                .messages({
                    'number.min': 'Paternity leave days must be at least 1',
                    'number.max': 'Paternity leave days cannot exceed 60'
                })
        }).optional()
    }).optional(),

    permissionLeave: Joi.object({
        enabled:       Joi.boolean().default(true),
        hoursPerMonth: Joi.number().min(0.5).max(4).default(2)
            .messages({
                'number.min': 'Permission hours must be at least 0.5',
                'number.max': 'Permission hours cannot exceed 4'
            })
    }).optional(),

    isActive: Joi.boolean().default(true)
});

export const updateLeavePolicyValidation = Joi.object({
    policyName: Joi.string()
        .trim()
        .max(100)
        .optional(),

    appliesTo: Joi.string()
        .valid('ALL', 'PERMANENT')
        .optional(),

    leaveTypes: Joi.object({
        casual: Joi.object({
            enabled:    Joi.boolean().optional(),
            daysPerYear: Joi.number().integer().min(1).max(30).optional()
                .messages({
                    'number.min': 'Casual leave days must be at least 1',
                    'number.max': 'Casual leave days cannot exceed 30'
                })
        }).optional(),

        sick: Joi.object({
            enabled:    Joi.boolean().optional(),
            daysPerYear: Joi.number().integer().min(1).max(30).optional()
                .messages({
                    'number.min': 'Sick leave days must be at least 1',
                    'number.max': 'Sick leave days cannot exceed 30'
                })
        }).optional(),

        maternity: Joi.object({
            enabled:    Joi.boolean().optional(),
            daysPerYear: Joi.number().integer().min(1).max(365).optional()
                .messages({
                    'number.min': 'Maternity leave days must be at least 1',
                    'number.max': 'Maternity leave days cannot exceed 365'
                })
        }).optional(),

        paternity: Joi.object({
            enabled:    Joi.boolean().optional(),
            daysPerYear: Joi.number().integer().min(1).max(60).optional()
                .messages({
                    'number.min': 'Paternity leave days must be at least 1',
                    'number.max': 'Paternity leave days cannot exceed 60'
                })
        }).optional()
    }).optional(),

    permissionLeave: Joi.object({
        enabled:       Joi.boolean().optional(),
        hoursPerMonth: Joi.number().min(0.5).max(4).optional()
            .messages({
                'number.min': 'Permission hours must be at least 0.5',
                'number.max': 'Permission hours cannot exceed 4'
            })
    }).optional(),

    isActive: Joi.boolean().optional()
});

// ─── Holiday ──────────────────────────────────────────────────────────────────

export const createHolidayValidation = Joi.object({
    name: Joi.string()
        .trim()
        .min(2)
        .max(100)
        .required()
        .messages({
            'string.empty':   'Holiday name is required',
            'string.min':     'Holiday name must be at least 2 characters',
            'string.max':     'Holiday name cannot exceed 100 characters',
            'any.required':   'Holiday name is required'
        }),

    date: Joi.date()
        .iso()
        .required()
        .messages({
            'date.base':    'Date must be a valid date',
            'date.format':  'Date must be in ISO format (YYYY-MM-DD)',
            'any.required': 'Date is required'
        }),

    type: Joi.string()
        .valid('GOVERNMENT', 'OPTIONAL', 'COMPANY')
        .default('GOVERNMENT')
        .messages({
            'any.only': 'Type must be GOVERNMENT, OPTIONAL, or COMPANY'
        }),

    description: Joi.string()
        .trim()
        .max(300)
        .allow('', null)
        .optional()
        .messages({
            'string.max': 'Description cannot exceed 300 characters'
        }),

    isRecurring: Joi.boolean()
        .default(false)
});

export const updateHolidayValidation = Joi.object({
    name: Joi.string()
        .trim()
        .min(2)
        .max(100)
        .optional()
        .messages({
            'string.min': 'Holiday name must be at least 2 characters',
            'string.max': 'Holiday name cannot exceed 100 characters'
        }),

    date: Joi.date()
        .iso()
        .optional()
        .messages({
            'date.base':   'Date must be a valid date',
            'date.format': 'Date must be in ISO format (YYYY-MM-DD)'
        }),

    type: Joi.string()
        .valid('GOVERNMENT', 'OPTIONAL', 'COMPANY')
        .optional()
        .messages({
            'any.only': 'Type must be GOVERNMENT, OPTIONAL, or COMPANY'
        }),

    description: Joi.string()
        .trim()
        .max(300)
        .allow('', null)
        .optional()
        .messages({
            'string.max': 'Description cannot exceed 300 characters'
        }),

    isRecurring: Joi.boolean().optional()
});

// ─── Leave Statistics Query ───────────────────────────────────────────────────

export const leaveStatsValidation = Joi.object({
    year: Joi.number()
        .integer()
        .min(2000)
        .max(2100)
        .default(new Date().getFullYear())
        .messages({
            'number.base': 'Year must be a number',
            'number.min':  'Year must be at least 2000',
            'number.max':  'Year cannot exceed 2100'
        }),

    department: Joi.string()
        .trim()
        .max(100)
        .optional()
        .messages({
            'string.max': 'Department name cannot exceed 100 characters'
        })
});

// ─── Leave Balance Query ──────────────────────────────────────────────────────

export const leaveBalanceValidation = Joi.object({
    year: Joi.number()
        .integer()
        .min(2000)
        .max(2100)
        .default(new Date().getFullYear())
        .messages({
            'number.base': 'Year must be a number',
            'number.min':  'Year must be at least 2000',
            'number.max':  'Year cannot exceed 2100'
        })
});

// ─── ObjectId Validation ──────────────────────────────────────────────────────

export const objectIdValidation = Joi.string()
    .custom((value, helpers) => {
        if (!isValidObjectId(value)) return helpers.error('any.invalid');
        return value;
    }, 'ObjectId validation')
    .messages({
        'any.invalid': 'Invalid ID format'
    });