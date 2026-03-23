import Joi from 'joi';

export const createApplicationValidation = Joi.object({
    job: Joi.string().hex().length(24).required(),
    additionalDocuments: Joi.array().items(
        Joi.object({
            name: Joi.string().required(),
            file: Joi.string().required()
        })
    ).optional()
});

export const updateApplicationValidation = Joi.object({
    additionalDocuments: Joi.array().items(
        Joi.object({
            name: Joi.string().required(),
            file: Joi.string().required()
        })
    ).optional()
});

export const updateApplicationStatusValidation = Joi.object({
    status: Joi.string().valid(
        "applied",
        "reviewed",
        "shortlisted",
        "interview scheduled",
        "interview selected",
        "interview rejected",
        "offer sent",
        "offer accepted",
        "offer rejected",
        "rejected",
        "doc verification pending",
        "doc verified",
        "onboarded"
    ).required(),
    rejectionReason: Joi.string().optional().allow('')
});

export const applicationQueryValidation = Joi.object({
    status: Joi.string().valid(
        "applied",
        "reviewed",
        "shortlisted",
        "interview scheduled",
        "interview selected",
        "interview rejected",
        "offer sent",
        "offer accepted",
        "offer rejected",
        "rejected",
        "doc verification pending",
        "doc verified",
        "onboarded"
    ).optional(),
    job: Joi.string().hex().length(24).optional(),
    user: Joi.string().hex().length(24).optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    sortBy: Joi.string().valid('createdAt', 'updatedAt', 'status').optional(),
    sortOrder: Joi.string().valid('asc', 'desc').optional()
});

export const interviewValidation = Joi.object({
    date: Joi.date().required().min('now'),
    time: Joi.string().required(),
    mode: Joi.string().valid('online', 'offline').required(),
    venue: Joi.when('mode', {
        is: 'offline',
        then: Joi.string().required(),
        otherwise: Joi.string().optional().allow('')
    }),
    meetingLink: Joi.when('mode', {
        is: 'online',
        then: Joi.string().uri().required(),
        otherwise: Joi.string().optional().allow('')
    }),
    instructions: Joi.string().optional().allow('')
});

export const offerValidation = Joi.object({
    salary: Joi.number().required().min(0),
    joiningDate: Joi.date().required().min('now'),
    terms: Joi.string().optional().allow('')
});

export const offerStatusValidation = Joi.object({
    status: Joi.string().valid('offer accepted', 'offer rejected').required(),
    rejectionReason: Joi.string().optional().allow('')
});

export const documentVerificationValidation = Joi.object({
    documentId: Joi.string().required(),
    status: Joi.string().valid('approved', 'rejected').required(),
    rejectionReason: Joi.when('status', {
        is: 'rejected',
        then: Joi.string().required(),
        otherwise: Joi.string().optional().allow('')
    })
});

export const rescheduleInterviewValidation = Joi.object({
    date: Joi.date().required().min('now'),
    time: Joi.string().required(),
    mode: Joi.string().valid('online', 'offline').required(),
    venue: Joi.when('mode', {
        is: 'offline',
        then: Joi.string().required(),
        otherwise: Joi.string().optional().allow('')
    }),
    meetingLink: Joi.when('mode', {
        is: 'online',
        then: Joi.string().uri().required(),
        otherwise: Joi.string().optional().allow('')
    }),
    instructions: Joi.string().optional().allow(''),
    reason: Joi.string().optional().allow('').max(500)
});

export const documentUploadValidation = Joi.object({
    documents: Joi.array().items(
        Joi.object({
            documentType: Joi.string().valid(
                "10th_certificate",
                "11th_certificate",
                "12th_certificate",
                "ug_degree",
                "pg_degree",
                "provisional_certificate",
                "consolidate_marksheet",
                "aadhar_card",
                "pan_card",
                "experience_certificate",
                "relieving_letter",
                "bank_statement_3_months",
                "passport_size_photo",
                "resume",
                "other"
            ).required(),
            name: Joi.string().required().max(255),
            file: Joi.string().required(),
        })
    ).min(1).max(20).required()
});

export const documentUpdateValidation = Joi.object({
    documentId: Joi.string().required(),
    file: Joi.string().required(),
    name: Joi.string().optional().max(255),
});