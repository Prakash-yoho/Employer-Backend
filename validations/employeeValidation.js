import Joi from 'joi';

// Create Employee Schema (only basic details by ADMIN/HR)
export const createEmployeeSchema = Joi.object({
    employeeId: Joi.string()
        .required()
        .trim()
        .messages({
            'string.empty': 'Employee ID is required'
        }),

    firstName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .trim()
        .messages({
            'string.empty': 'First name is required',
            'string.min': 'First name must be at least 2 characters',
            'string.max': 'First name cannot exceed 50 characters'
        }),

    lastName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .trim()
        .messages({
            'string.empty': 'Last name is required',
            'string.min': 'Last name must be at least 2 characters',
            'string.max': 'Last name cannot exceed 50 characters'
        }),

    officialEmail: Joi.string()
        .email()
        .required()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Invalid official email format',
            'string.empty': 'Official email is required'
        }),

    officialPassword: Joi.string()
        .min(8)
        .max(128)
        .required()
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
        .messages({
            'string.empty': 'Official password is required',
            'string.min': 'Password must be at least 8 characters',
            'string.max': 'Password cannot exceed 128 characters',
            'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
            'any.required': 'Official password is required'
        }),

    department: Joi.string()
        .required()
        .trim()
        .messages({
            'string.empty': 'Department is required'
        }),

    designation: Joi.string()
        .required()
        .trim()
        .messages({
            'string.empty': 'Designation is required'
        }),

    employmentType: Joi.string()
        .valid('Fresher', 'Experienced')
        .required()
        .messages({
            'any.only': 'Employment type must be either Fresher or Experienced',
            'string.empty': 'Employment type is required'
        }),

    personalEmail: Joi.string()
        .email()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Invalid personal email format'
        }),

    personalMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid mobile number'
        })
});

// Update Employee Profile Schema (for employees to update their details)
export const updateEmployeeProfileSchema = Joi.object({
    // Personal Details
    firstName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.min': 'First name must be at least 2 characters',
            'string.max': 'First name cannot exceed 50 characters'
        }),

    lastName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.min': 'Last name must be at least 2 characters',
            'string.max': 'Last name cannot exceed 50 characters'
        }),

    gender: Joi.string()
        .valid('Male', 'Female', 'Other')
        .messages({
            'any.only': 'Gender must be Male, Female, or Other'
        }),

    dateOfBirth: Joi.date()
        .max('now')
        .messages({
            'date.max': 'Date of birth cannot be in the future'
        }),

    bloodGroup: Joi.string()
        .valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
        .allow(null),

    maritalStatus: Joi.string()
        .valid('Single', 'Married', 'Divorced', 'Widowed')
        .messages({
            'any.only': 'Marital status must be Single, Married, Divorced, or Widowed'
        }),

    spouseName: Joi.string()
        .trim(),

    spouseDateOfBirth: Joi.date()
        .max('now'),

    spouseOccupation: Joi.string()
        .trim(),

    nationality: Joi.string()
        .trim(),

    motherTongue: Joi.string()
        .trim(),

    languagesKnown: Joi.array()
        .items(Joi.string().trim()),

    physicallyDisabled: Joi.boolean(),

    disabilityType: Joi.string()
        .when('physicallyDisabled', {
            is: true,
            then: Joi.string().required(),
            otherwise: Joi.string().allow('')
        }),

    placeOfBirth: Joi.string()
        .trim(),

    personalEmail: Joi.string()
        .email()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Invalid personal email format'
        }),

    personalMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid mobile number'
        }),

    alternateMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid alternate mobile number'
        }),

    whatsappNumber: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid WhatsApp number'
        }),

    aadhaarNumber: Joi.string()
        .pattern(/^\d{12}$/)
        .messages({
            'string.pattern.base': 'Invalid Aadhaar number'
        }),

    panNumber: Joi.string()
        .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
        .messages({
            'string.pattern.base': 'Invalid PAN number'
        }),

    passportNumber: Joi.string()
        .trim(),

    drivingLicenseAvailable: Joi.boolean(),

    drivingLicenseNumber: Joi.string()
        .trim(),

    // Address Details
    address: Joi.object({
        currentAddressLine1: Joi.string()
            .trim(),

        currentAddressLine2: Joi.string()
            .trim(),

        city: Joi.string()
            .trim(),

        district: Joi.string()
            .trim(),

        state: Joi.string()
            .trim(),

        country: Joi.string()
            .trim(),

        pincode: Joi.number()
            .integer()
            .min(100000)
            .max(999999)
            .messages({
                'number.min': 'Invalid pincode',
                'number.max': 'Invalid pincode'
            }),

        landmark: Joi.string()
            .trim(),

        residenceType: Joi.string()
            .valid('Owned', 'Rented', 'Other'),

        stayingSince: Joi.date()
            .max('now'),

        permanentAddressSameAsCurrent: Joi.boolean(),

        permanentAddressLine1: Joi.string()
            .trim(),

        permanentAddressLine2: Joi.string()
            .trim(),

        permanentCity: Joi.string()
            .trim(),

        permanentDistrict: Joi.string()
            .trim(),

        permanentState: Joi.string()
            .trim(),

        permanentCountry: Joi.string()
            .trim(),

        permanentPincode: Joi.number()
            .integer()
            .min(100000)
            .max(999999)
            .messages({
                'number.min': 'Invalid permanent pincode',
                'number.max': 'Invalid permanent pincode'
            })
    }),

    // Emergency Contact
    emergencyContact: Joi.object({
        name: Joi.string()
            .trim(),

        relationship: Joi.string()
            .trim(),

        mobileNumber: Joi.string()
            .pattern(/^[6-9]\d{9}$/)
            .messages({
                'string.pattern.base': 'Invalid emergency contact mobile number'
            }),

        address: Joi.string()
            .trim()
    }),

    // Family Details
    fatherName: Joi.string()
        .trim(),

    fatherDateOfBirth: Joi.date()
        .max('now'),

    fatherOccupation: Joi.string()
        .trim(),

    fatherMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid father mobile number'
        }),

    motherName: Joi.string()
        .trim(),

    motherDateOfBirth: Joi.date()
        .max('now'),

    motherOccupation: Joi.string()
        .trim(),

    motherMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid mother mobile number'
        }),

    hasSiblings: Joi.boolean(),

    numberOfBrothers: Joi.number()
        .integer()
        .min(0),

    numberOfSisters: Joi.number()
        .integer()
        .min(0),

    totalSiblings: Joi.number().integer().min(0),

    siblings: Joi.array().items(
        Joi.object({
            _id: Joi.string().optional(),
            siblingName: Joi.string()
                .trim(),

            relationship: Joi.string()
                .valid('Brother', 'Sister'),

            gender: Joi.string()
                .valid('Male', 'Female', 'Other'),

            dateOfBirth: Joi.date()
                .max('now'),

            maritalStatus: Joi.string()
                .valid('Single', 'Married', 'Divorced', 'Widowed'),

            education: Joi.string()
                .trim(),

            occupation: Joi.string()
                .trim(),

            companyName: Joi.string()
                .trim(),

            mobileNumber: Joi.string()
                .pattern(/^[6-9]\d{9}$/)
                .messages({
                    'string.pattern.base': 'Invalid sibling mobile number'
                })
        })
    ),

    // Education Details
    education: Joi.object({
        tenthStandard: Joi.object({
            schoolName: Joi.string()
                .trim(),

            board: Joi.string()
                .trim(),

            year: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            percentage: Joi.number()
                .min(0)
                .max(100)
        }),

        eleventhStandard: Joi.object({
            schoolName: Joi.string()
                .trim(),

            board: Joi.string()
                .trim(),

            year: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            percentage: Joi.number()
                .min(0)
                .max(100)
        }),

        twelfthStandard: Joi.object({
            schoolName: Joi.string()
                .trim(),

            board: Joi.string()
                .trim(),

            year: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            percentage: Joi.number()
                .min(0)
                .max(100)
        }),

        higherEducation: Joi.object({
            highestQualification: Joi.string()
                .trim(),

            diplomaCompleted: Joi.boolean(),

            diplomaCourse: Joi.string()
                .trim(),

            diplomaPercentage: Joi.number()
                .min(0)
                .max(100),

            diplomaGraduationYear: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            diplomaInstitution: Joi.string()
                .trim(),

            graduationCompleted: Joi.boolean(),

            degree: Joi.string()
                .trim(),

            graduationYear: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            percentage: Joi.number()
                .min(0)
                .max(100),

            college: Joi.string()
                .trim(),

            university: Joi.string()
                .trim(),

            postGraduationCompleted: Joi.boolean(),

            pgDegree: Joi.string()
                .trim(),

            pgPercentage: Joi.number()
                .min(0)
                .max(100),

            pgGraduationYear: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            pgCollege: Joi.string()
                .trim(),

            pgUniversity: Joi.string()
                .trim(),

            certificationsAvailable: Joi.boolean(),

            certificationDetails: Joi.string()
                .trim()
        })
    }),

    // Employment History (for experienced employees)
    totalExperience: Joi.number()
        .min(0),

    previousEmployers: Joi.array().items(
        Joi.object({
            _id: Joi.string().optional(),
            companyName: Joi.string()
                .trim(),

            designation: Joi.string()
                .trim(),

            startDate: Joi.date()
                .max('now'),

            endDate: Joi.date()
                .max('now')
                .when('startDate', {
                    is: Joi.exist(),
                    then: Joi.date().min(Joi.ref('startDate')),
                    otherwise: Joi.date()
                })
        })
    ),

    // Bank Details
    bankDetails: Joi.object({
        bankName: Joi.string()
            .trim(),

        accountNumber: Joi.string()
            .trim(),

        ifscCode: Joi.string()
            .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
            .messages({
                'string.pattern.base': 'Invalid IFSC code'
            }),

        pfApplicable: Joi.boolean(),

        uanNumber: Joi.string()
            .trim()
    }),

    // Account status (only for ADMIN/HR updates)
    isActive: Joi.boolean()
}).min(1).messages({
    'object.min': 'At least one field is required for update'
});

// Employee Login Schema
export const employeeLoginSchema = Joi.object({
    officialEmail: Joi.string()
        .email()
        .required()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Invalid email format',
            'string.empty': 'Official email is required'
        }),

    officialPassword: Joi.string()
        .required()
        .messages({
            'string.empty': 'Password is required'
        })
});

// Employee Change Password Schema
export const employeeChangePasswordSchema = Joi.object({
    currentPassword: Joi.string()
        .required()
        .messages({
            'string.empty': 'Current password is required'
        }),

    newPassword: Joi.string()
        .min(8)
        .max(128)
        .required()
        .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$'))
        .messages({
            'string.empty': 'New password is required',
            'string.min': 'New password must be at least 8 characters',
            'string.max': 'New password cannot exceed 128 characters',
            'string.pattern.base': 'New password must contain at least one uppercase letter, one lowercase letter, one number and one special character'
        }),

    confirmPassword: Joi.string()
        .valid(Joi.ref('newPassword'))
        .required()
        .messages({
            'any.only': 'Passwords do not match',
            'string.empty': 'Confirm password is required'
        })
});

// Employee update request schema
export const employeeUpdateRequestSchema = Joi.object({
    updateRequestReason: Joi.string()
        .min(10)
        .max(500)
        .required()
        .trim()
        .messages({
            'string.empty': 'Update request reason is required',
            'string.min': 'Reason must be at least 10 characters',
            'string.max': 'Reason cannot exceed 500 characters'
        })
});

// HR/Admin update employee schema
export const updateEmployeeByAdminSchema = Joi.object({
    // Include all fields from updateEmployeeProfileSchema

    // Personal Details
    firstName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.min': 'First name must be at least 2 characters',
            'string.max': 'First name cannot exceed 50 characters'
        }),

    lastName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .messages({
            'string.min': 'Last name must be at least 2 characters',
            'string.max': 'Last name cannot exceed 50 characters'
        }),

    gender: Joi.string()
        .valid('Male', 'Female', 'Other')
        .messages({
            'any.only': 'Gender must be Male, Female, or Other'
        }),

    dateOfBirth: Joi.date()
        .max('now')
        .messages({
            'date.max': 'Date of birth cannot be in the future'
        }),

    bloodGroup: Joi.string()
        .valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', null)
        .allow(null),

    maritalStatus: Joi.string()
        .valid('Single', 'Married', 'Divorced', 'Widowed')
        .messages({
            'any.only': 'Marital status must be Single, Married, Divorced, or Widowed'
        }),

    spouseName: Joi.string()
        .trim(),

    spouseDateOfBirth: Joi.date()
        .max('now'),

    spouseOccupation: Joi.string()
        .trim(),

    nationality: Joi.string()
        .trim(),

    motherTongue: Joi.string()
        .trim(),

    languagesKnown: Joi.array()
        .items(Joi.string().trim()),

    physicallyDisabled: Joi.boolean(),

    disabilityType: Joi.string()
        .when('physicallyDisabled', {
            is: true,
            then: Joi.string().required(),
            otherwise: Joi.string().allow('')
        }),

    placeOfBirth: Joi.string()
        .trim(),

    personalEmail: Joi.string()
        .email()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Invalid personal email format'
        }),

    personalMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid mobile number'
        }),

    alternateMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid alternate mobile number'
        }),

    whatsappNumber: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid WhatsApp number'
        }),

    aadhaarNumber: Joi.string()
        .pattern(/^\d{12}$/)
        .messages({
            'string.pattern.base': 'Invalid Aadhaar number'
        }),

    panNumber: Joi.string()
        .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
        .messages({
            'string.pattern.base': 'Invalid PAN number'
        }),

    passportNumber: Joi.string()
        .trim(),

    drivingLicenseAvailable: Joi.boolean(),

    drivingLicenseNumber: Joi.string()
        .trim(),

    // Address Details
    address: Joi.object({
        currentAddressLine1: Joi.string()
            .trim(),

        currentAddressLine2: Joi.string()
            .trim(),

        city: Joi.string()
            .trim(),

        district: Joi.string()
            .trim(),

        state: Joi.string()
            .trim(),

        country: Joi.string()
            .trim(),

        pincode: Joi.number()
            .integer()
            .min(100000)
            .max(999999)
            .messages({
                'number.min': 'Invalid pincode',
                'number.max': 'Invalid pincode'
            }),

        landmark: Joi.string()
            .trim(),

        residenceType: Joi.string()
            .valid('Owned', 'Rented', 'Other'),

        stayingSince: Joi.date()
            .max('now'),

        permanentAddressSameAsCurrent: Joi.boolean(),

        permanentAddressLine1: Joi.string()
            .trim(),

        permanentAddressLine2: Joi.string()
            .trim(),

        permanentCity: Joi.string()
            .trim(),

        permanentDistrict: Joi.string()
            .trim(),

        permanentState: Joi.string()
            .trim(),

        permanentCountry: Joi.string()
            .trim(),

        permanentPincode: Joi.number()
            .integer()
            .min(100000)
            .max(999999)
            .messages({
                'number.min': 'Invalid permanent pincode',
                'number.max': 'Invalid permanent pincode'
            })
    }),

    // Emergency Contact
    emergencyContact: Joi.object({
        name: Joi.string()
            .trim(),

        relationship: Joi.string()
            .trim(),

        mobileNumber: Joi.string()
            .pattern(/^[6-9]\d{9}$/)
            .messages({
                'string.pattern.base': 'Invalid emergency contact mobile number'
            }),

        address: Joi.string()
            .trim()
    }),

    // Family Details
    fatherName: Joi.string()
        .trim(),

    fatherDateOfBirth: Joi.date()
        .max('now'),

    fatherOccupation: Joi.string()
        .trim(),

    fatherMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid father mobile number'
        }),

    motherName: Joi.string()
        .trim(),

    motherDateOfBirth: Joi.date()
        .max('now'),

    motherOccupation: Joi.string()
        .trim(),

    motherMobile: Joi.string()
        .pattern(/^[6-9]\d{9}$/)
        .messages({
            'string.pattern.base': 'Invalid mother mobile number'
        }),

    hasSiblings: Joi.boolean(),

    numberOfBrothers: Joi.number()
        .integer()
        .min(0),

    numberOfSisters: Joi.number()
        .integer()
        .min(0),

    siblings: Joi.array().items(
        Joi.object({
            siblingName: Joi.string()
                .trim(),

            relationship: Joi.string()
                .valid('Brother', 'Sister'),

            gender: Joi.string()
                .valid('Male', 'Female', 'Other'),

            dateOfBirth: Joi.date()
                .max('now'),

            maritalStatus: Joi.string()
                .valid('Single', 'Married', 'Divorced', 'Widowed'),

            education: Joi.string()
                .trim(),

            occupation: Joi.string()
                .trim(),

            companyName: Joi.string()
                .trim(),

            mobileNumber: Joi.string()
                .pattern(/^[6-9]\d{9}$/)
                .messages({
                    'string.pattern.base': 'Invalid sibling mobile number'
                })
        })
    ),

    // Education Details
    education: Joi.object({
        tenthStandard: Joi.object({
            schoolName: Joi.string()
                .trim(),

            board: Joi.string()
                .trim(),

            year: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            percentage: Joi.number()
                .min(0)
                .max(100)
        }),

        eleventhStandard: Joi.object({
            schoolName: Joi.string()
                .trim(),

            board: Joi.string()
                .trim(),

            year: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            percentage: Joi.number()
                .min(0)
                .max(100)
        }),

        twelfthStandard: Joi.object({
            schoolName: Joi.string()
                .trim(),

            board: Joi.string()
                .trim(),

            year: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            percentage: Joi.number()
                .min(0)
                .max(100)
        }),

        higherEducation: Joi.object({
            highestQualification: Joi.string()
                .trim(),

            diplomaCompleted: Joi.boolean(),

            diplomaCourse: Joi.string()
                .trim(),

            diplomaPercentage: Joi.number()
                .min(0)
                .max(100),

            diplomaGraduationYear: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            diplomaInstitution: Joi.string()
                .trim(),

            graduationCompleted: Joi.boolean(),

            degree: Joi.string()
                .trim(),

            graduationYear: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            percentage: Joi.number()
                .min(0)
                .max(100),

            college: Joi.string()
                .trim(),

            university: Joi.string()
                .trim(),

            postGraduationCompleted: Joi.boolean(),

            pgDegree: Joi.string()
                .trim(),

            pgPercentage: Joi.number()
                .min(0)
                .max(100),

            pgGraduationYear: Joi.number()
                .integer()
                .min(1900)
                .max(new Date().getFullYear()),

            pgCollege: Joi.string()
                .trim(),

            pgUniversity: Joi.string()
                .trim(),

            certificationsAvailable: Joi.boolean(),

            certificationDetails: Joi.string()
                .trim()
        })
    }),

    // Employment History (for experienced employees)
    totalExperience: Joi.number()
        .min(0),

    previousEmployers: Joi.array().items(
        Joi.object({
            companyName: Joi.string()
                .trim(),

            designation: Joi.string()
                .trim(),

            startDate: Joi.date()
                .max('now'),

            endDate: Joi.date()
                .max('now')
                .when('startDate', {
                    is: Joi.exist(),
                    then: Joi.date().min(Joi.ref('startDate')),
                    otherwise: Joi.date()
                })
        })
    ),

    // Bank Details
    bankDetails: Joi.object({
        bankName: Joi.string()
            .trim(),

        accountNumber: Joi.string()
            .trim(),

        ifscCode: Joi.string()
            .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
            .messages({
                'string.pattern.base': 'Invalid IFSC code'
            }),

        pfApplicable: Joi.boolean(),

        uanNumber: Joi.string()
            .trim()
    }),

    // Additional fields for HR/Admin
    isUpdated: Joi.boolean(),
    updateRequested: Joi.boolean(),
    updateRequestReason: Joi.string().trim()
}).min(1).messages({
    'object.min': 'At least one field is required for update'
});