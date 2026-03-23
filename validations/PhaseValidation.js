import Joi from "joi";

export const createPhaseValidation = Joi.object({
    phaseName: Joi.string().trim().min(2).max(100).required().messages({
        "string.base": "Phase name must be a string",
        "string.empty": "Phase name is required",
        "string.min": "Phase name must be at least 2 characters long",
        "string.max": "Phase name must not exceed 100 characters",
        "any.required": "Phase name is required"
    }),
    location: Joi.string().trim().min(2).max(200).required().messages({
        "string.base": "Location must be a string",
        "string.empty": "Location is required",
        "string.min": "Location must be at least 2 characters long",
        "string.max": "Location must not exceed 200 characters",
        "any.required": "Location is required"
    }),
    address: Joi.string().trim().min(5).max(500).required().messages({
        "string.base": "Address must be a string",
        "string.empty": "Address is required",
        "string.min": "Address must be at least 5 characters long",
        "string.max": "Address must not exceed 500 characters",
        "any.required": "Address is required"
    }),
});

export const updatePhaseValidation = Joi.object({
    phaseName: Joi.string().trim().min(2).max(100).optional().messages({
        "string.base": "Phase name must be a string",
        "string.empty": "Phase name cannot be empty",
        "string.min": "Phase name must be at least 2 characters long",
        "string.max": "Phase name must not exceed 100 characters",
    }),
    location: Joi.string().trim().min(2).max(200).optional().messages({
        "string.base": "Location must be a string",
        "string.empty": "Location cannot be empty",
        "string.min": "Location must be at least 2 characters long",
        "string.max": "Location must not exceed 200 characters",
    }),
    address: Joi.string().trim().min(5).max(500).optional().messages({
        "string.base": "Address must be a string",
        "string.empty": "Address cannot be empty",
        "string.min": "Address must be at least 5 characters long",
        "string.max": "Address must not exceed 500 characters",
    }),
}).min(1).messages({
    "object.min": "At least one field (phaseName, location, or address) must be provided to update"
});