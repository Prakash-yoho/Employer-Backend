import Joi from "joi";

export const jobValidation = Joi.object({
    title: Joi.string().required(),
    department: Joi.string().optional(),
    location: Joi.string().required(),
    experienceRequired: Joi.string().required(),
    employmentType: Joi.string().required(),
    salaryRange: Joi.string().optional(),
    jobDescription: Joi.string().required(),
    keyResponsibilities: Joi.array().items(Joi.string()).min(1).required(),
    qualifications: Joi.array().items(Joi.string()).min(1).required(),
    eligibility: Joi.array().items(Joi.string()).min(1).required(),
    terms: Joi.string().optional(),
    vacancyCount: Joi.number().positive().required(),
    workingMode: Joi.string().valid("Remote", "Hybrid", "Onsite").required()
});
