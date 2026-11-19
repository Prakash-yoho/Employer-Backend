import Joi from 'joi';

// validations/ticketValidation.js — only this schema changes

export const createTicketSchema = Joi.object({
    category: Joi.string()
        .valid('HR_ISSUE', 'TECHNICAL_ISSUE', 'IT_ASSET')
        .required()
        .messages({
            'any.required': 'Category is required',
            'any.only': 'Category must be one of: HR_ISSUE, TECHNICAL_ISSUE, IT_ASSET'
        }),
    priority: Joi.string()
        .valid('LOW', 'MEDIUM', 'HIGH')
        .default('MEDIUM')
        .messages({
            'any.only': 'Priority must be one of: LOW, MEDIUM, HIGH'
        }),
    subject: Joi.string()
        .required()
        .min(5)
        .max(200)
        .messages({
            'string.empty': 'Subject is required',
            'string.min': 'Subject must be at least 5 characters',
            'string.max': 'Subject cannot exceed 200 characters'
        }),
    description: Joi.string()
        .required()
        .min(10)
        .messages({
            'string.empty': 'Description is required',
            'string.min': 'Description must be at least 10 characters'
        })
}).unknown(true); // NEW: ignore stray fields (e.g. "attachments" leaking into body from multipart form parsing)

export const updateTicketSchema = Joi.object({
    priority: Joi.string()
        .valid('LOW', 'MEDIUM', 'HIGH')
        .messages({
            'any.only': 'Priority must be one of: LOW, MEDIUM, HIGH'
        }),
    assignedTo: Joi.string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .messages({
            'string.pattern.base': 'Invalid assignedTo user ID'
        }),
    status: Joi.string()
        .valid('OPEN', 'IN_PROGRESS', 'RESOLVED')
        .messages({
            'any.only': 'Status must be one of: OPEN, IN_PROGRESS, RESOLVED'
        }),
    // NOTE: resolvedComment is now OPTIONAL even when status is RESOLVED
    resolvedComment: Joi.string()
        .trim()
        .max(500)
        .allow('', null)
        .optional()
        .messages({
            'string.max': 'Resolved comment cannot exceed 500 characters'
        }),
    forwardedTo: Joi.string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .messages({
            'string.pattern.base': 'Invalid forwardedTo user ID'
        })
});

export const resolveTicketSchema = Joi.object({
    // NOTE: optional now — IT can close without a comment
    resolvedComment: Joi.string()
        .trim()
        .max(500)
        .allow('', null)
        .optional()
        .messages({
            'string.max': 'Resolved comment cannot exceed 500 characters'
        })
});

export const forwardToITSchema = Joi.object({
    forwardedTo: Joi.string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .required()
        .messages({
            'string.empty': 'IT user ID is required',
            'string.pattern.base': 'Invalid IT user ID'
        }),
    comment: Joi.string()
        .optional()
        .max(500)
        .messages({
            'string.max': 'Comment cannot exceed 500 characters'
        })
});

export const getTicketsQuerySchema = Joi.object({
    page: Joi.number()
        .integer()
        .min(1)
        .default(1),
    limit: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(10),
    category: Joi.string()
        .valid('HR_ISSUE', 'TECHNICAL_ISSUE', 'IT_ASSET'),
    priority: Joi.string()
        .valid('LOW', 'MEDIUM', 'HIGH'),
    status: Joi.string()
        .valid('OPEN', 'IN_PROGRESS', 'RESOLVED'),
    sortBy: Joi.string()
        .valid('createdAt', 'updatedAt', 'priority', 'status')
        .default('createdAt'),
    sortOrder: Joi.string()
        .valid('asc', 'desc')
        .default('desc')
});

// NEW: HR/Admin/IT asking a question on a ticket
export const askQuestionSchema = Joi.object({
    question: Joi.string()
        .trim()
        .required()
        .min(3)
        .max(500)
        .messages({
            'string.empty': 'Question is required',
            'string.min': 'Question must be at least 3 characters',
            'string.max': 'Question cannot exceed 500 characters'
        })
});

// NEW: Employee answering a question
export const answerQuestionSchema = Joi.object({
    answer: Joi.string()
        .trim()
        .required()
        .min(1)
        .max(1000)
        .messages({
            'string.empty': 'Answer is required',
            'string.max': 'Answer cannot exceed 1000 characters'
        })
});