import Joi from "joi";

export const createScheduleValidation = Joi.object({
    fromDate: Joi.date().iso().required().messages({
        "date.base": "From date must be a valid date",
        "date.format": "From date must be in ISO format (YYYY-MM-DD)",
        "any.required": "From date is required"
    }),
    toDate: Joi.date().iso().min(Joi.ref("fromDate")).required().messages({
        "date.base": "To date must be a valid date",
        "date.format": "To date must be in ISO format (YYYY-MM-DD)",
        "date.min": "To date must be the same as or after from date",
        "any.required": "To date is required"
    }),
});

export const updateScheduleValidation = Joi.object({
    fromDate: Joi.date().iso().optional().messages({
        "date.base": "From date must be a valid date",
        "date.format": "From date must be in ISO format (YYYY-MM-DD)",
    }),
    toDate: Joi.date().iso().min(Joi.ref("fromDate")).optional().messages({
        "date.base": "To date must be a valid date",
        "date.format": "To date must be in ISO format (YYYY-MM-DD)",
        "date.min": "To date must be the same as or after from date",
    }),
})
    .min(1)
    .and("fromDate", "toDate")
    .messages({
        "object.min": "At least one field (fromDate or toDate) must be provided to update",
        "object.and": "Both fromDate and toDate must be provided together when updating dates"
    });