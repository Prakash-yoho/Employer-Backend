import Joi from 'joi';

export const idCardReportQuerySchema = Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional()
        .messages({ 'date.min': 'endDate must be on or after startDate' }),
    status: Joi.string().valid('all', 'active', 'expired', 'not_generated').default('all'),
    department: Joi.string().trim().allow('', null).optional(),
    employeeIds: Joi.string().trim().allow('', null).optional(),
});