import Joi from 'joi';

// Document status validation
const documentStatusSchema = Joi.string()
    .valid('pending', 'doc_submitted', 'doc_rejected', 'verified')
    .default('pending');

// Document field validation
const documentFieldValidation = Joi.object({
    status: documentStatusSchema,
    remark: Joi.string().trim().max(500).allow(null, '')
}).unknown();

// Experience document validation
const experienceDocumentValidation = Joi.object({
    companyName: Joi.string().trim().required(),
    experienceCertificate: documentFieldValidation,
    relievingCertificate: documentFieldValidation,
    payslips: Joi.array().items(documentFieldValidation),
    appointmentLetter: documentFieldValidation,
    sixmonthstatement: documentFieldValidation,
});

// Create/Update document validation
export const createUpdateDocumentSchema = Joi.object({
    // Mandatory fields (for reference, actual files uploaded via form-data)
    aadharCard: documentFieldValidation,
    panCard: documentFieldValidation,
    addressProof: documentFieldValidation,
    tenthCertificate: documentFieldValidation,
    eleventhCertificate: documentFieldValidation,
    twelfthCertificate: documentFieldValidation,
    ugCertificate: documentFieldValidation,
    bankPassbook: documentFieldValidation,
    signedOfferLetter: documentFieldValidation,
    interviewresume: documentFieldValidation,
    

    // Optional fields
    drivingLicense: documentFieldValidation,
    passport: documentFieldValidation,
    birthCertificate: documentFieldValidation,
    consolidatedCertificate: documentFieldValidation,
    pgconsolidatedCertificate: documentFieldValidation,
    diplomaconsolidatedCertificate: documentFieldValidation,
    trainingCertificates: Joi.array().items(documentFieldValidation),
    diplomaCertificate: documentFieldValidation,
    pgCertificate: documentFieldValidation,

    // Experience documents
    experienceDocuments: Joi.array().items(experienceDocumentValidation)
}).min(1);

// Document verification validation
export const verifyDocumentSchema = Joi.object({
    documentType: Joi.string().required(),
    status: Joi.string().valid('verified', 'doc_rejected').required(),
    remark: Joi.when('status', {
        is: 'doc_rejected',
        then: Joi.string().trim().min(5).max(500).required(),
        otherwise: Joi.string().trim().max(500).allow(null, '')
    }),
    companyIndex: Joi.number().integer().min(0).when('documentType', {
        is: Joi.string().pattern(/^experienceDocuments/),
        then: Joi.required(),
        otherwise: Joi.optional()
    }),
    subDocumentType: Joi.string().when('documentType', {
        is: Joi.string().pattern(/^experienceDocuments/),
        then: Joi.valid('experienceCertificate', 'relievingCertificate', 'appointmentLetter', 'payslips', 'sixmonthstatement').required(),
        otherwise: Joi.optional()
    }),
    payslipIndex: Joi.number().integer().min(0).when('subDocumentType', {
        is: 'payslips',
        then: Joi.required(),
        otherwise: Joi.optional()
    })
});

// Add experience company validation
export const addExperienceCompanySchema = Joi.object({
    companyName: Joi.string().trim().min(2).max(100).required()
});

// Upload document validation
export const uploadDocumentSchema = Joi.object({
    documentType: Joi.string().required(),
    companyIndex: Joi.number().integer().min(0).optional(),
    subDocumentType: Joi.string().optional(),
    payslipIndex: Joi.number().integer().min(0).optional()
});

// Query parameters for get documents
export const getDocumentsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    overallStatus: Joi.string().valid('pending', 'in_progress', 'completed'),
    employeeId: Joi.string().trim(),
    sortBy: Joi.string().valid('createdAt', 'updatedAt', 'overallStatus').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc')
});