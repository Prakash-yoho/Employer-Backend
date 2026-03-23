import Joi from 'joi';

export const createAssetSchema = Joi.object({
    assetName: Joi.string()
        .required()
        .min(2)
        .max(100)
        .trim()
        .messages({
            'string.empty': 'Asset name is required',
            'string.min': 'Asset name must be at least 2 characters',
            'string.max': 'Asset name cannot exceed 100 characters'
        }),

    category: Joi.string()
        .required()
        .valid(
            'LAPTOP', 'DESKTOP', 'CHARGER', 'MONITOR', 'KEYBOARD', 'MOUSE',
            'HEADPHONES', 'MOBILE', 'TABLET', 'SERVER', 'NETWORK',
            'PRINTER', 'SCANNER', 'PROJECTOR', 'OTHER'
        )
        .messages({
            'any.required': 'Category is required',
            'any.only': 'Invalid category'
        }),

    brand: Joi.string()
        .required()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.empty': 'Brand is required',
            'string.min': 'Brand must be at least 2 characters',
            'string.max': 'Brand cannot exceed 50 characters'
        }),

    model: Joi.string()
        .required()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.empty': 'Model is required',
            'string.min': 'Model must be at least 2 characters',
            'string.max': 'Model cannot exceed 50 characters'
        }),

    serialNumber: Joi.string()
        .required()
        .trim()
        .messages({
            'string.empty': 'Serial number is required'
        }),

    status: Joi.string()
        .valid('AVAILABLE', 'ASSIGNED', 'REPAIR')
        .default('AVAILABLE')
        .messages({
            'any.only': 'Status must be one of: AVAILABLE, ASSIGNED, REPAIR'
        }),

    condition: Joi.string()
        .valid('EXCELLENT', 'FAIR')
        .default('EXCELLENT')
        .messages({
            'any.only': 'Condition must be one of: EXCELLENT, FAIR'
        }),

    specifications: Joi.string()
        .max(500)
        .trim()
        .allow(null, '')
        .messages({
            'string.max': 'Notes cannot exceed 500 characters'
        }),

    notes: Joi.string()
        .max(500)
        .trim()
        .allow(null, '')
        .messages({
            'string.max': 'Notes cannot exceed 500 characters'
        }),

    purchaseDate: Joi.date()
        .allow(null)
        .messages({
            'date.base': 'Purchase date must be a valid date'
        }),

    purchaseRate: Joi.number()
        .min(0)
        .allow(null)
        .messages({
            'number.base': 'Purchase price must be a number',
            'number.min': 'Purchase price cannot be negative'
        }),

    warrantyExpiryDate: Joi.date()
        .allow(null)
        .messages({
            'date.base': 'Warranty expiry date must be a valid date'
        })
});

export const updateAssetSchema = Joi.object({
    assetName: Joi.string()
        .min(2)
        .max(100)
        .trim()
        .messages({
            'string.min': 'Asset name must be at least 2 characters',
            'string.max': 'Asset name cannot exceed 100 characters'
        }),

    category: Joi.string()
        .valid(
            'LAPTOP', 'DESKTOP', 'CHARGER', 'MONITOR', 'KEYBOARD', 'MOUSE',
            'HEADPHONES', 'MOBILE', 'TABLET', 'SERVER', 'NETWORK',
            'PRINTER', 'SCANNER', 'PROJECTOR', 'OTHER'
        )
        .messages({
            'any.only': 'Invalid category'
        }),

    brand: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.min': 'Brand must be at least 2 characters',
            'string.max': 'Brand cannot exceed 50 characters'
        }),

    model: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.min': 'Model must be at least 2 characters',
            'string.max': 'Model cannot exceed 50 characters'
        }),

    status: Joi.string()
        .valid('AVAILABLE', 'ASSIGNED', 'REPAIR')
        .messages({
            'any.only': 'Status must be one of: AVAILABLE, ASSIGNED, REPAIR'
        }),

    serialNumber: Joi.string()
        .trim()
        .messages({
            'string.empty': 'Serial number is required'
        }),


    condition: Joi.string()
        .valid('EXCELLENT', 'FAIR')
        .messages({
            'any.only': 'Condition must be one of: EXCELLENT, FAIR'
        }),

    specifications: Joi.string()
        .max(500)
        .trim()
        .allow(null, '')
        .messages({
            'string.max': 'Notes cannot exceed 500 characters'
        }),

    notes: Joi.string()
        .max(500)
        .trim()
        .allow(null, '')
        .messages({
            'string.max': 'Notes cannot exceed 500 characters'
        }),

    purchaseDate: Joi.date()
        .allow(null)
        .messages({
            'date.base': 'Purchase date must be a valid date'
        }),

    purchaseRate: Joi.number()
        .min(0)
        .allow(null)
        .messages({
            'number.base': 'Purchase price must be a number',
            'number.min': 'Purchase price cannot be negative'
        }),

    warrantyExpiryDate: Joi.date()
        .allow(null)
        .messages({
            'date.base': 'Warranty expiry date must be a valid date'
        })
});

export const assignAssetSchema = Joi.object({
    employeeId: Joi.string()
        .required()
        .messages({
            'string.empty': 'Employee ID is required'
        }),

    notes: Joi.string()
        .max(500)
        .trim()
        .allow(null, '')
        .messages({
            'string.max': 'Notes cannot exceed 500 characters'
        })
});

export const removeAssignmentSchema = Joi.object({
    notes: Joi.string()
        .max(500)
        .trim()
        .allow(null, '')
        .messages({
            'string.max': 'Notes cannot exceed 500 characters'
        })
});

export const getAssetsQuerySchema = Joi.object({
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
        .valid(
            'LAPTOP', 'DESKTOP', 'CHARGER', 'MONITOR', 'KEYBOARD', 'MOUSE',
            'HEADPHONES', 'MOBILE', 'TABLET', 'SERVER', 'NETWORK',
            'PRINTER', 'SCANNER', 'PROJECTOR', 'OTHER'
        ),

    status: Joi.string()
        .valid('AVAILABLE', 'ASSIGNED', 'REPAIR'),

    condition: Joi.string()
        .valid('EXCELLENT', 'FAIR'),

    brand: Joi.string()
        .trim(),

    search: Joi.string()
        .trim()
        .allow(''),

    sortBy: Joi.string()
        .valid('assetName', 'category', 'status', 'condition', 'createdAt', 'updatedAt')
        .default('createdAt'),

    sortOrder: Joi.string()
        .valid('asc', 'desc')
        .default('desc')
});