import Joi from "joi";

// ─── PROJECT VALIDATORS ───────────────────────────────────────────────────────

export const createProjectValidator = Joi.object({
    projectName: Joi.string().trim().min(2).max(100).required()
        .messages({
            "string.empty": "Project name is required",
            "string.min": "Project name must be at least 2 characters",
            "string.max": "Project name must not exceed 100 characters",
            "any.required": "Project name is required",
        }),
    description: Joi.string().trim().max(500).required().allow(""),
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().min(Joi.ref("startDate")).required()
        .messages({
            "date.min": "End date must be after start date",
            "any.required": "End date is required",
        }),
    status: Joi.string()
        .valid("active", "completed", "on_hold", "cancelled", "planning")
        .default("planning"),
    priority: Joi.string()
        .valid("low", "medium", "high", "critical")
        .default("medium"),

    // Both optional
    budget: Joi.string().trim().optional().allow("", null),
    client: Joi.string().trim().max(100).optional().allow("", null),
});

export const updateProjectValidator = Joi.object({
    projectName: Joi.string().trim().min(2).max(100).optional(),
    description: Joi.string().trim().max(500).optional().allow(""),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional(),
    status: Joi.string()
        .valid("active", "completed", "on_hold", "cancelled", "planning")
        .optional(),
    priority: Joi.string()
        .valid("low", "medium", "high", "critical")
        .optional(),

    // Both optional — can also be cleared by passing null
    budget: Joi.string().trim().optional().allow("", null),
    client: Joi.string().trim().max(100).optional().allow("", null),
}).min(1).messages({ "object.min": "At least one field is required to update" });


// ─── TL VALIDATORS ────────────────────────────────────────────────────────────
// Both accept single employeeId (string) OR employeeIds (array of strings)

export const assignTLValidator = Joi.object({
    // employeeId: Joi.string().trim().optional(),
    employeeId: Joi.array().items(Joi.string().trim()).min(1).optional(),
}).or("employeeId")
    .messages({ "object.missing": "Provide employeeId (single) or employeeIds (array)" });

export const removeTLValidator = Joi.object({
    employeeId: Joi.string().trim().required()
        .messages({
            "string.empty": "Employee ID is required",
            "any.required": "Employee ID is required",
        }),
});


// ─── TEAM VALIDATORS ──────────────────────────────────────────────────────────

export const createTeamValidator = Joi.object({
    teamName: Joi.string().trim().min(2).max(100).required()
        .messages({
            "string.empty": "Team name is required",
            "string.min": "Team name must be at least 2 characters",
            "any.required": "Team name is required",
        }),
    description: Joi.string().trim().max(500).optional().allow(""),
    project: Joi.string().hex().length(24).optional().allow(null, "")
        .messages({ "string.length": "Invalid project ID" }),
    teamLead: Joi.string().hex().length(24).optional(),
    members: Joi.array()
        .items(Joi.string().hex().length(24))
        .min(1)
        .required()
        .messages({
            "array.min": "At least one team member is required",
            "any.required": "Team members are required",
        }),
});

export const updateTeamValidator = Joi.object({
    teamName: Joi.string().trim().min(2).max(100).optional(),
    description: Joi.string().trim().max(500).optional().allow(""),
    project: Joi.string().hex().length(24).optional().allow(null, ""),
    teamLead: Joi.string().hex().length(24).optional(),
    members: Joi.array().items(Joi.string().hex().length(24)).optional(),
    isActive: Joi.boolean().optional(),
}).min(1).messages({ "object.min": "At least one field is required to update" });


// ─── TASK VALIDATORS ──────────────────────────────────────────────────────────

export const createTaskValidator = Joi.object({
    title: Joi.string().trim().min(2).max(200).required()
        .messages({
            "string.empty": "Task title is required",
            "string.min": "Title must be at least 2 characters",
            "any.required": "Task title is required",
        }),
    description: Joi.string().trim().max(1000).optional().allow(""),
    deadline: Joi.date().iso().required().custom((value, helpers) => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const inputDate = new Date(value);
        const inputLocalStart = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate());

        if (inputLocalStart < todayStart) {
            return helpers.error("any.invalid", { message: "Deadline must be today or a future date" });
        }
        return value;
    }).messages({
        "any.invalid": "Deadline must be today or a future date",
        "any.required": "Deadline is required",
    }),
    additionalNotice: Joi.string().trim().max(500).optional().allow("", null),
    priority: Joi.string().valid("low", "medium", "high").default("medium"),
    team: Joi.string().hex().length(24).optional().allow(null, ""),
    assignedTo: Joi.string().hex().length(24).required()
        .messages({ "any.required": "assignedTo (employee ID) is required" }),
});
// ── UPDATE TASK VALIDATOR (PM + TL) ───────────────────────────────────────────
export const updateTaskValidator = Joi.object({
    title: Joi.string().trim().min(2).max(200).optional()
        .messages({
            "string.min": "Title must be at least 2 characters",
            "string.max": "Title must not exceed 200 characters",
        }),
    description: Joi.string().trim().max(1000).optional().allow(""),
    deadline: Joi.date().iso().optional().custom((value, helpers) => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const inputDate = new Date(value);
        const inputLocalStart = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate());
        if (inputLocalStart < todayStart) {
            return helpers.error("any.invalid");
        }
        return value;
    }).messages({
        "any.invalid": "Deadline must be today or a future date",
    }),
    additionalNotice: Joi.string().trim().max(500).optional().allow("", null),
    priority: Joi.string().valid("low", "medium", "high").optional(),
    team: Joi.string().hex().length(24).optional().allow(null, ""),
    assignedTo: Joi.string().hex().length(24).optional(),
}).min(1).messages({ "object.min": "At least one field is required to update" });

export const updateTaskStatusValidator = Joi.object({
    status: Joi.string()
        .valid("in_progress", "completed_by_employee")
        .required()
        .messages({
            "any.required": "Status is required",
            "any.only": "Status must be 'in_progress' or 'completed_by_employee'",
        }),
});

export const tlReviewTaskValidator = Joi.object({
    action: Joi.string()
        .valid("need_correction", "completed", "revoked", "incomplete")
        .required()
        .messages({
            "any.only": "Action must be 'need_correction', 'completed', 'revoked', or 'incomplete'",
            "any.required": "Action is required",
        }),
    reason: Joi.string().trim().min(5).max(500).required()
        .messages({
            "string.empty": "Reason is required",
            "string.min": "Reason must be at least 5 characters",
            "any.required": "Reason is required for all review actions",
        }),
});