import mongoose from 'mongoose';
import Employee from '../model/Employee.js';
import Document from '../model/Document.js';
import { addExperienceCompanySchema, getDocumentsQuerySchema, uploadDocumentSchema, verifyDocumentSchema } from '../validations/documentValidation.js';
import { deleteDocumentFromS3, uploadDocumentToS3 } from '../utils/saveOfferLetterInS3.js';
import EmployerUser from '../model/EmployerUser.js';
import NotificationService from '../services/notificationService.js';
import { s3, S3_BUCKET } from '../config/s3.js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { pipeline } from "stream";
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promisify } from 'util';



// Copy this exact s3Client setup from your existing controller
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
    },
});



// Create or get document record for employee
export const initEmployeeDocument = async (req, res) => {
    try {
        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        let document = await Document.findOne({ employee: req.user._id });

        if (!document) {
            document = new Document({
                employee: req.user._id,
                employeeId: employee.employeeId,
                lastUpdatedBy: req.user._id,
                status: "pending" // document workflow status
            });

            await document.save();

            // 🔥 FORCE employee status
            await Employee.findByIdAndUpdate(req.user._id, {
                $set: {
                    status: "in_progress"
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Document record initialized',
            data: document
        });

    } catch (error) {
        console.error('Init document error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};



// Upload document file
export const uploadDocument = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Please upload a document file'
            });
        }

        // Validate query parameters
        const { error: queryError, value: queryValue } = uploadDocumentSchema.validate(req.query);
        if (queryError) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: queryError.details.map(detail => detail.message)
            });
        }

        const { documentType, companyIndex, subDocumentType, payslipIndex } = queryValue;

        // Get employee
        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Get or create document record
        let document = await Document.findOne({ employee: req.user._id });
        if (!document) {
            document = new Document({
                employee: req.user._id,
                employeeId: employee.employeeId,
                lastUpdatedBy: req.user._id
            });
        }

        // Define valid document types
        const validDocumentTypes = [
            'aadharCard', 'panCard', 'addressProof', 'tenthCertificate',
            'twelfthCertificate', 'ugCertificate', 'bankPassbook', 'signedOfferLetter',
            'drivingLicense', 'passport', 'birthCertificate', 'consolidatedCertificate',
            'diplomaCertificate', 'pgCertificate', 'trainingCertificates'
        ];

        const validExperienceSubTypes = [
            'experienceCertificate', 'relievingCertificate', 'appointmentLetter', 'payslips'
        ];

        let currentDocument;

        if (documentType.startsWith('experienceDocuments')) {
            // Handle experience documents
            if (companyIndex === undefined || subDocumentType === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'companyIndex and subDocumentType are required for experience documents'
                });
            }

            if (!validExperienceSubTypes.includes(subDocumentType)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid experience sub document type'
                });
            }

            // Check if company exists at index
            if (!document.experienceDocuments[companyIndex]) {
                return res.status(400).json({
                    success: false,
                    message: 'Company not found at specified index'
                });
            }

            if (subDocumentType === 'payslips') {
                // Handle payslips array
                if (payslipIndex !== undefined) {
                    // Update existing payslip
                    if (!document.experienceDocuments[companyIndex].payslips[payslipIndex]) {
                        return res.status(400).json({
                            success: false,
                            message: 'Payslip not found at specified index'
                        });
                    }
                    currentDocument = document.experienceDocuments[companyIndex].payslips[payslipIndex];
                } else {
                    // Create new payslip object for array
                    currentDocument = {
                        fileUrl: null,
                        fileKey: null,
                        fileName: null,
                        fileSize: null,
                        mimeType: null,
                        uploadedAt: null,
                        status: 'pending',
                        remark: null,
                        verifiedBy: null,
                        verifiedAt: null
                    };
                    // Add new payslip to array
                    document.experienceDocuments[companyIndex].payslips.push(currentDocument);
                    // Get the last index after push
                    currentDocument = document.experienceDocuments[companyIndex].payslips[
                        document.experienceDocuments[companyIndex].payslips.length - 1
                    ];
                }
            } else {
                // Handle other experience documents
                currentDocument = document.experienceDocuments[companyIndex][subDocumentType];
            }
        } else if (documentType === 'trainingCertificates') {
            // Handle training certificates array
            // Create new certificate object for array
            currentDocument = {
                fileUrl: null,
                fileKey: null,
                fileName: null,
                fileSize: null,
                mimeType: null,
                uploadedAt: null,
                status: 'pending',
                remark: null,
                verifiedBy: null,
                verifiedAt: null
            };
            // Add new certificate to array
            document.trainingCertificates.push(currentDocument);
            // Get the last index after push
            currentDocument = document.trainingCertificates[
                document.trainingCertificates.length - 1
            ];
        } else {
            // Handle regular documents
            if (!validDocumentTypes.includes(documentType)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid document type'
                });
            }
            currentDocument = document[documentType];
        }

        // Delete old file if exists
        if (currentDocument && currentDocument.fileKey) {
            try {
                await deleteDocumentFromS3(currentDocument.fileKey);
            } catch (error) {
                console.error('Error deleting old document:', error);
                // Continue with upload
            }
        }

        // Upload new file to S3
        const uploadResult = await uploadDocumentToS3(
            req.file.buffer,
            employee.employeeId,
            documentType,
            req.file.originalname
        );

        // Update document data
        currentDocument.fileUrl = uploadResult.url;
        currentDocument.fileKey = uploadResult.key;
        currentDocument.fileName = uploadResult.filename;
        currentDocument.fileSize = uploadResult.size;
        currentDocument.mimeType = uploadResult.mimeType;
        currentDocument.uploadedAt = new Date();
        currentDocument.status = 'doc_submitted';
        currentDocument.remark = null;
        currentDocument.verifiedBy = null;
        currentDocument.verifiedAt = null;

        // Update tracking
        document.lastUpdatedBy = req.user._id;
        document.submittedAt = new Date();

        // SAVE the document to trigger pre-save hook
        await document.save();

        // Notify HR/Admin about document upload
        const hrAdmins = await EmployerUser.find({
            role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
            isActive: true
        });

        await NotificationService.createDocumentUploadedNotification(
            employee,
            documentType,
            hrAdmins
        );

        // Re-fetch to get populated fields if needed
        const updatedDocument = await Document.findById(document._id)
            .populate('lastUpdatedBy', 'firstName lastName employeeId');

        return res.status(200).json({
            success: true,
            message: 'Document uploaded successfully',
            data: {
                documentType,
                fileUrl: uploadResult.url,
                document: updatedDocument.toObject()
            }
        });
    } catch (error) {
        console.error('Upload document error:', error);

        if (error.message.includes('Failed to upload document to S3')) {
            return res.status(500).json({
                success: false,
                message: 'Failed to upload document. Please try again.'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Add experience company
export const addExperienceCompany = async (req, res) => {
    try {
        // Validate request body
        const { error, value } = addExperienceCompanySchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { companyName } = value;

        // Get document record
        let document = await Document.findOne({ employee: req.user._id });
        if (!document) {
            const employee = await Employee.findById(req.user._id);
            if (!employee) {
                return res.status(404).json({
                    success: false,
                    message: 'Employee not found'
                });
            }

            document = new Document({
                employee: req.user._id,
                employeeId: employee.employeeId
            });
        }

        // Add new company
        document.experienceDocuments.push({
            companyName,
            experienceCertificate: { status: 'pending' },
            relievingCertificate: { status: 'pending' },
            payslips: [],
            appointmentLetter: { status: 'pending' }
        });

        document.lastUpdatedBy = req.user._id;
        await document.save();

        return res.status(200).json({
            success: true,
            message: 'Experience company added successfully',
            data: {
                companyIndex: document.experienceDocuments.length - 1,
                companyName,
                document: document.toObject()
            }
        });
    } catch (error) {
        console.error('Add experience company error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get employee documents
export const getMyDocuments = async (req, res) => {
    try {
        const document = await Document.findOne({ employee: req.user._id })
            .populate('lastUpdatedBy', 'firstName lastName employeeId')
            .populate('lastVerifiedBy', 'firstName lastName email role');

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'No documents found'
            });
        }

        const stats = document.getDocumentStats();

        return res.status(200).json({
            success: true,
            message: 'Documents retrieved successfully',
            data: {
                document: document.toObject(),
                stats
            }
        });
    } catch (error) {
        console.error('Get my documents error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all documents (HR/Admin only)
export const getAllDocuments = async (req, res) => {
    try {
        // Check if user has permission
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can view all documents'
            });
        }

        // Validate query parameters
        const { error, value } = getDocumentsQuerySchema.validate(req.query);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { overallStatus, employeeId, sortBy, sortOrder } = value;
        // const skip = (page - 1) * limit;

        // Build filter
        const filter = {};
        if (overallStatus) filter.overallStatus = overallStatus;
        if (employeeId) filter.employeeId = { $regex: employeeId, $options: 'i' };

        // Build sort
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Execute query
        const [documents, total] = await Promise.all([
            Document.find(filter)
                .populate('employee')
                .populate('lastVerifiedBy', 'firstName lastName email role')
                .sort(sort),
            // .skip(skip)
            // .limit(limit),
            Document.countDocuments(filter)
        ]);

        // const totalPages = Math.ceil(total / limit);

        // Calculate overall statistics
        const stats = {
            totalDocuments: total,
            pending: await Document.countDocuments({ overallStatus: 'pending' }),
            inProgress: await Document.countDocuments({ overallStatus: 'in_progress' }),
            completed: await Document.countDocuments({ overallStatus: 'completed' })
        };

        return res.status(200).json({
            success: true,
            message: 'Documents retrieved successfully',
            data: {
                documents,
                // pagination: {
                //     currentPage: page,
                //     totalPages,
                //     totalItems: total,
                //     itemsPerPage: limit,
                //     hasNextPage: page < totalPages,
                //     hasPrevPage: page > 1
                // },
                stats
            }
        });
    } catch (error) {
        console.error('Get all documents error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get documents by employee ID (HR/Admin only)
export const getDocumentsByEmployeeId = async (req, res) => {
    try {
        // Check if user has permission
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can view employee documents'
            });
        }

        const { employeeId } = req.params;

        const document = await Document.findOne({ employeeId })
            .populate('employee')

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'No documents found for this employee'
            });
        }

        const stats = document.getDocumentStats();

        return res.status(200).json({
            success: true,
            message: 'Employee documents retrieved successfully',
            data: {
                document: document.toObject(),
                stats
            }
        });
    } catch (error) {
        console.error('Get documents by employee ID error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Verify/reject document (HR/Admin only)
export const verifyDocument = async (req, res) => {
    try {
        // Check if user has permission
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can verify documents'
            });
        }

        // Validate request body
        const { error, value } = verifyDocumentSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { documentType, status, remark, companyIndex, subDocumentType, payslipIndex, certificateIndex } = value;
        const { employeeId } = req.params;

        // Find document
        const document = await Document.findOne({ employeeId });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document record not found'
            });
        }

        // Update the specific document field
        if (documentType.startsWith('experienceDocuments')) {
            // Verify experience document
            if (companyIndex === undefined || subDocumentType === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'companyIndex and subDocumentType are required for experience documents'
                });
            }

            if (!document.experienceDocuments[companyIndex]) {
                return res.status(400).json({
                    success: false,
                    message: 'Company not found at specified index'
                });
            }

            if (subDocumentType === 'payslips') {
                if (payslipIndex === undefined) {
                    return res.status(400).json({
                        success: false,
                        message: 'payslipIndex is required for payslips'
                    });
                }

                // Update payslip
                document.experienceDocuments[companyIndex].payslips[payslipIndex] = {
                    ...document.experienceDocuments[companyIndex].payslips[payslipIndex],
                    status,
                    remark: status === 'doc_rejected' ? remark : (document.experienceDocuments[companyIndex].payslips[payslipIndex].remark || remark),
                    verifiedBy: req.user._id,
                    verifiedAt: new Date()
                };
            } else {
                // Update other experience documents
                document.experienceDocuments[companyIndex][subDocumentType] = {
                    ...document.experienceDocuments[companyIndex][subDocumentType],
                    status,
                    remark: status === 'doc_rejected' ? remark : (document.experienceDocuments[companyIndex][subDocumentType].remark || null),
                    verifiedBy: req.user._id,
                    verifiedAt: new Date()
                };
            }
        } else if (documentType === 'trainingCertificates') {
            // Verify training certificate
            if (certificateIndex === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'certificateIndex is required for training certificates'
                });
            }

            document.trainingCertificates[certificateIndex] = {
                ...document.trainingCertificates[certificateIndex],
                status,
                remark: status === 'doc_rejected' ? remark : (document.trainingCertificates[certificateIndex].remark || null),
                verifiedBy: req.user._id,
                verifiedAt: new Date()
            };
        } else {
            // Verify regular document
            document[documentType] = {
                ...document[documentType],
                status,
                remark: status === 'doc_rejected' ? remark : (document[documentType].remark || null),
                verifiedBy: req.user._id,
                verifiedAt: new Date()
            };
        }

        // Update verification tracking
        document.lastVerifiedBy = req.user._id;
        document.lastVerifiedAt = new Date();

        // SAVE the document to trigger pre-save hook
        const updatedDocument = await document.save();

        if (status === 'doc_rejected') {
            // Notify employee about document rejection
            await NotificationService.createDocumentRejectedNotification(
                updatedDocument.employee,
                documentType,
                req.user
            );
        } else {
            // Notify employee about document verification
            await NotificationService.createDocumentVerifiedNotification(
                updatedDocument.employee,
                documentType,
                req.user
            );
        }

        // Check if all documents are verified
        if (document.verifiedDocuments === document.totalDocuments && document.totalDocuments > 0) {
            await NotificationService.createAllDocumentsVerifiedNotification(updatedDocument.employee, req.user);
        }

        // Populate references
        await updatedDocument.populate('employee', 'firstName lastName employeeId officialEmail department');
        await updatedDocument.populate('lastVerifiedBy', 'firstName lastName email role');

        const stats = updatedDocument.getDocumentStats();

        return res.status(200).json({
            success: true,
            message: `Document ${status === 'verified' ? 'verified' : 'rejected'} successfully`,
            data: {
                document: updatedDocument.toObject(),
                stats
            }
        });
    } catch (error) {
        console.error('Verify document error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete document file
export const deleteDocument = async (req, res) => {
    try {
        const { documentType } = req.params;
        const { companyIndex, subDocumentType, payslipIndex, certificateIndex } = req.query;

        // Get document record
        const document = await Document.findOne({ employee: req.user._id });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document record not found'
            });
        }

        // Find and reset the target document
        if (documentType.startsWith('experienceDocuments')) {
            if (companyIndex === undefined || subDocumentType === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'companyIndex and subDocumentType are required'
                });
            }

            const companyIdx = parseInt(companyIndex);
            if (!document.experienceDocuments[companyIdx]) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found'
                });
            }

            if (subDocumentType === 'payslips') {
                if (payslipIndex === undefined) {
                    return res.status(400).json({
                        success: false,
                        message: 'payslipIndex is required for payslips'
                    });
                }

                const payslipIdx = parseInt(payslipIndex);
                const targetDocument = document.experienceDocuments[companyIdx].payslips[payslipIdx];

                if (!targetDocument || !targetDocument.fileKey) {
                    return res.status(404).json({
                        success: false,
                        message: 'Payslip not found or no file uploaded'
                    });
                }

                // Delete from S3
                await deleteDocumentFromS3(targetDocument.fileKey);

                // Reset payslip fields
                document.experienceDocuments[companyIdx].payslips[payslipIdx] = {
                    fileUrl: null,
                    fileKey: null,
                    fileName: null,
                    fileSize: null,
                    mimeType: null,
                    uploadedAt: null,
                    status: 'pending',
                    remark: null,
                    verifiedBy: null,
                    verifiedAt: null
                };
            } else {
                const targetDocument = document.experienceDocuments[companyIdx][subDocumentType];

                if (!targetDocument || !targetDocument.fileKey) {
                    return res.status(404).json({
                        success: false,
                        message: 'Document not found or no file uploaded'
                    });
                }

                // Delete from S3
                await deleteDocumentFromS3(targetDocument.fileKey);

                // Reset experience document fields
                document.experienceDocuments[companyIdx][subDocumentType] = {
                    fileUrl: null,
                    fileKey: null,
                    fileName: null,
                    fileSize: null,
                    mimeType: null,
                    uploadedAt: null,
                    status: 'pending',
                    remark: null,
                    verifiedBy: null,
                    verifiedAt: null
                };
            }
        } else if (documentType === 'trainingCertificates') {
            if (certificateIndex === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'certificateIndex is required for training certificates'
                });
            }

            const certIdx = parseInt(certificateIndex);
            const targetDocument = document.trainingCertificates[certIdx];

            if (!targetDocument || !targetDocument.fileKey) {
                return res.status(404).json({
                    success: false,
                    message: 'Training certificate not found or no file uploaded'
                });
            }

            // Delete from S3
            await deleteDocumentFromS3(targetDocument.fileKey);

            // Reset training certificate fields
            document.trainingCertificates[certIdx] = {
                fileUrl: null,
                fileKey: null,
                fileName: null,
                fileSize: null,
                mimeType: null,
                uploadedAt: null,
                status: 'pending',
                remark: null,
                verifiedBy: null,
                verifiedAt: null
            };
        } else {
            const targetDocument = document[documentType];

            if (!targetDocument || !targetDocument.fileKey) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found or no file uploaded'
                });
            }

            // Delete from S3
            await deleteDocumentFromS3(targetDocument.fileKey);

            // Reset document fields
            document[documentType] = {
                fileUrl: null,
                fileKey: null,
                fileName: null,
                fileSize: null,
                mimeType: null,
                uploadedAt: null,
                status: 'pending',
                remark: null,
                verifiedBy: null,
                verifiedAt: null
            };
        }

        // Update tracking
        document.lastUpdatedBy = req.user._id;

        // SAVE the document to trigger pre-save hook
        const updatedDocument = await document.save();

        // Get updated stats
        const stats = updatedDocument.getDocumentStats();

        return res.status(200).json({
            success: true,
            message: 'Document deleted successfully',
            data: {
                document: updatedDocument.toObject(),
                stats
            }
        });
    } catch (error) {
        console.error('Delete document error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete an experience entry
export const deleteExperience = async (req, res) => {
    try {
        const { experienceIndex } = req.params;
        const index = parseInt(experienceIndex);

        // Validate index
        if (isNaN(index) || index < 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid experience index'
            });
        }

        // Get document record
        const document = await Document.findOne({ employee: req.user._id });
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document record not found'
            });
        }

        // Check if experience exists at index
        if (!document.experienceDocuments[index]) {
            return res.status(404).json({
                success: false,
                message: 'Experience not found at specified index'
            });
        }

        const experienceToDelete = document.experienceDocuments[index];

        // Delete all associated files from S3
        const deletePromises = [];

        // Delete experience certificate
        if (experienceToDelete.experienceCertificate?.fileKey) {
            deletePromises.push(
                deleteDocumentFromS3(experienceToDelete.experienceCertificate.fileKey)
                    .catch(err => console.error('Error deleting experience certificate:', err))
            );
        }

        // Delete relieving certificate
        if (experienceToDelete.relievingCertificate?.fileKey) {
            deletePromises.push(
                deleteDocumentFromS3(experienceToDelete.relievingCertificate.fileKey)
                    .catch(err => console.error('Error deleting relieving certificate:', err))
            );
        }

        // Delete appointment letter
        if (experienceToDelete.appointmentLetter?.fileKey) {
            deletePromises.push(
                deleteDocumentFromS3(experienceToDelete.appointmentLetter.fileKey)
                    .catch(err => console.error('Error deleting appointment letter:', err))
            );
        }

        // Delete all payslips
        if (experienceToDelete.payslips && experienceToDelete.payslips.length > 0) {
            experienceToDelete.payslips.forEach(payslip => {
                if (payslip.fileKey) {
                    deletePromises.push(
                        deleteDocumentFromS3(payslip.fileKey)
                            .catch(err => console.error('Error deleting payslip:', err))
                    );
                }
            });
        }

        // Wait for all file deletions to complete (or fail gracefully)
        await Promise.all(deletePromises);

        // Remove the experience from the array
        document.experienceDocuments.splice(index, 1);
        document.lastUpdatedBy = req.user._id;

        await document.save();

        const documentResponse = document.toObject();

        return res.status(200).json({
            success: true,
            message: 'Experience deleted successfully',
            data: {
                deletedExperienceIndex: index,
                document: documentResponse,
                stats: document.getDocumentStats ? document.getDocumentStats() : {
                    totalDocuments: document.totalDocuments,
                    verifiedDocuments: document.verifiedDocuments,
                    verificationProgress: document.verificationProgress,
                    overallStatus: document.overallStatus
                }
            }
        });
    } catch (error) {
        console.error('Delete experience error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Preview Docuements
export const previewDocument = async (req, res) => {
    try {
        const { documentType, employeeId } = req.params;
        const { companyIndex, subDocumentType, payslipIndex, certificateIndex } = req.query;

        let targetEmployeeId;

        // HR / ADMIN preview another employee
        if (employeeId) {
            if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Only HR or ADMIN can preview employee documents'
                });
            }
            targetEmployeeId = employeeId;
        } else {
            // Employee preview own document
            targetEmployeeId = req.user._id;
        }

        const document = await Document.findOne({
            [employeeId ? 'employeeId' : 'employee']: targetEmployeeId
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document record not found'
            });
        }

        let targetDocument;

        // ================= EXPERIENCE DOCUMENTS =================
        if (documentType === 'experienceDocuments') {
            if (companyIndex === undefined || !subDocumentType) {
                return res.status(400).json({
                    success: false,
                    message: 'companyIndex and subDocumentType are required'
                });
            }

            const company = document.experienceDocuments[parseInt(companyIndex)];
            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found'
                });
            }

            if (subDocumentType === 'payslips') {
                if (payslipIndex === undefined) {
                    return res.status(400).json({
                        success: false,
                        message: 'payslipIndex is required'
                    });
                }
                targetDocument = company.payslips[parseInt(payslipIndex)];
            } else {
                targetDocument = company[subDocumentType];
            }
        }

        // ================= TRAINING CERTIFICATES =================
        else if (documentType === 'trainingCertificates') {
            if (certificateIndex === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'certificateIndex is required'
                });
            }
            targetDocument = document.trainingCertificates[parseInt(certificateIndex)];
        }

        // ================= REGULAR DOCUMENTS =================
        else {
            const documentFieldMap = {
                aadharCard: 'aadharCard',
                panCard: 'panCard',
                drivingLicense: 'drivingLicense',
                passport: 'passport',
                addressProof: 'addressProof',
                birthCertificate: 'birthCertificate',
                tenthCertificate: 'tenthCertificate',
                twelfthCertificate: 'twelfthCertificate',
                ugCertificate: 'ugCertificate',
                pgCertificate: 'pgCertificate',
                diplomaCertificate: 'diplomaCertificate',
                consolidatedCertificate: 'consolidatedCertificate',
                signedOfferLetter: 'signedOfferLetter',
                bankPassbook: 'bankPassbook'
            };

            const fieldName = documentFieldMap[documentType];
            if (!fieldName) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid document type'
                });
            }

            targetDocument = document[fieldName];
        }

        if (!targetDocument || !targetDocument.fileKey) {
            return res.status(404).json({
                success: false,
                message: 'File not uploaded'
            });
        }

        let s3Key = targetDocument.fileKey;

        if (s3Key.includes(`${S3_BUCKET}/`)) {
            s3Key = s3Key.replace(`${S3_BUCKET}/`, '');
        }

        if (s3Key.includes('?')) {
            s3Key = s3Key.split('?')[0];
        }

        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            ResponseContentDisposition: `inline; filename="${targetDocument.fileName}"`,
            ResponseContentType: targetDocument.mimeType || 'application/pdf'
        });

        const signedUrl = await getSignedUrl(s3, command, {
            expiresIn: 60 * 5
        });

        return res.status(200).json({
            success: true,
            fileUrl: signedUrl,
            expiresIn: 300
        });

    } catch (error) {
        console.error('Preview document error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error previewing document'
        });
    }
};

const streamPipeline = promisify(pipeline);
// Download document file
export const downloadDocument = async (req, res) => {
    try {
        const { documentType } = req.params;
        const { companyIndex, subDocumentType, payslipIndex, certificateIndex } = req.query;
        let employeeId;
        if (req.params.employeeId) {
            if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Only ADMIN or HR can download employee documents'
                });
            }
            employeeId = req.params.employeeId;
        } else {
            employeeId = req.user._id;
        }
        const document = await Document.findOne({
            [req.params.employeeId ? 'employeeId' : 'employee']: employeeId
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                message: "Document record not found",
            });
        }

        let targetDocument;
        if (documentType === "experienceDocuments") {
            if (companyIndex === undefined || !subDocumentType) {
                return res.status(400).json({
                    success: false,
                    message: "companyIndex and subDocumentType are required",
                });
            }

            const company = document.experienceDocuments[parseInt(companyIndex)];
            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: "Company not found",
                });
            }

            if (subDocumentType === "payslips") {
                if (payslipIndex === undefined) {
                    return res.status(400).json({
                        success: false,
                        message: "payslipIndex is required",
                    });
                }
                targetDocument = company.payslips[parseInt(payslipIndex)];
            } else {
                targetDocument = company[subDocumentType];
            }
        }
        else if (documentType === "trainingCertificates") {
            if (certificateIndex === undefined) {
                return res.status(400).json({
                    success: false,
                    message: "certificateIndex is required",
                });
            }
            targetDocument = document.trainingCertificates[parseInt(certificateIndex)];
        }
        else {
            const documentFieldMap = {
                aadharCard: "aadharCard",
                panCard: "panCard",
                drivingLicense: "drivingLicense",
                passport: "passport",
                addressProof: "addressProof",
                birthCertificate: "birthCertificate",
                tenthCertificate: "tenthCertificate",
                twelfthCertificate: "twelfthCertificate",
                ugCertificate: "ugCertificate",
                pgCertificate: "pgCertificate",
                diplomaCertificate: "diplomaCertificate",
                consolidatedCertificate: "consolidatedCertificate",
                signedOfferLetter: "signedOfferLetter",
                bankPassbook: "bankPassbook",
            };

            const fieldName = documentFieldMap[documentType];
            if (!fieldName) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid document type",
                });
            }

            targetDocument = document[fieldName];
        }

        if (!targetDocument) {
            return res.status(404).json({
                success: false,
                message: "Document not found",
            });
        }
        if (!targetDocument.fileKey && !targetDocument.fileUrl) {
            return res.status(404).json({
                success: false,
                message: "File not uploaded yet"
            });
        }
        let s3Key = targetDocument.fileKey;
        if (!s3Key && targetDocument.fileUrl) {
            const url = targetDocument.fileUrl;
            const urlParts = url.split(".amazonaws.com/");

            if (urlParts.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid S3 document URL"
                });
            }

            s3Key = urlParts[1];
            if (s3Key.includes("?")) {
                s3Key = s3Key.split("?")[0];
            }
            if (s3Key.includes(S3_BUCKET + "/")) {
                s3Key = s3Key.replace(`${S3_BUCKET}/`, "");
            }
        }

        if (!s3Key) {
            return res.status(400).json({
                success: false,
                message: "Could not extract S3 key from document"
            });
        }
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key
        });

        const file = await s3.send(command);
        if (!file.Body) {
            return res.status(404).json({
                success: false,
                message: "File not found in storage"
            });
        }
        res.setHeader("Content-Type", targetDocument.mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${targetDocument.fileName || 'document'}"`);

        if (targetDocument.fileSize) {
            res.setHeader("Content-Length", targetDocument.fileSize);
        }

        // Stream file to client
        await streamPipeline(file.Body, res);

    } catch (error) {
        console.error(" Download document error:", error);

        if (error.name === 'NoSuchKey') {
            return res.status(404).json({
                success: false,
                message: "File not found in storage"
            });
        }

        if (error.name === 'AccessDenied') {
            return res.status(403).json({
                success: false,
                message: "Access denied to file"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Error downloading document",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};





















// Appointment Letters 



export const previewAppointmentLetter = async (req, res) => {
  try {
    // ✅ Always use logged-in user
    const employeeId = req.user._id;

    const employee = await Employee.findById(employeeId);

    if (!employee || !employee.appointmentLetters?.url) {
      return res.status(404).json({
        success: false,
        message: "Appointment letter not found",
      });
    }

    let fileUrl = employee.appointmentLetters.url;

    // Extract S3 key
    let s3Key = fileUrl.split(".amazonaws.com/")[1];

    if (s3Key.includes("?")) {
      s3Key = s3Key.split("?")[0];
    }

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      ResponseContentDisposition: `inline; filename="${employee.appointmentLetters.fileName}"`,
      ResponseContentType: "application/pdf",
    });

    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: 60 * 5, // 5 mins
    });

    return res.status(200).json({
      success: true,
      fileUrl: signedUrl,
      expiresIn: 300,
    });

  } catch (error) {
    console.error("Preview appointment letter error:", error);
    return res.status(500).json({
      success: false,
      message: "Error previewing appointment letter",
    });
  }
};



// const streamPipeline = promisify(pipeline);

export const downloadAppointmentLetter = async (req, res) => {
  try {
    // ✅ Logged-in employee only
    const employeeId = req.user._id;

    const employee = await Employee.findById(employeeId);

    if (!employee || !employee.appointmentLetters?.url) {
      return res.status(404).json({
        success: false,
        message: "Appointment letter not found",
      });
    }

    let fileUrl = employee.appointmentLetters.url;

    // Extract S3 key
    let s3Key = fileUrl.split(".amazonaws.com/")[1];

    if (s3Key.includes("?")) {
      s3Key = s3Key.split("?")[0];
    }

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    });

    const file = await s3.send(command);

    if (!file.Body) {
      return res.status(404).json({
        success: false,
        message: "File not found in storage",
      });
    }

    // Force download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${employee.appointmentLetters.fileName}"`
    );

    await streamPipeline(file.Body, res);

  } catch (error) {
    console.error("Download appointment letter error:", error);

    return res.status(500).json({
      success: false,
      message: "Error downloading appointment letter",
    });
  }
};






export const previewAppointmentLetterByAdmin = async (req, res) => {
    try {
        const { employeeId } = req.params;

        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        if (!employee.appointmentLetters?.url) {
            return res.status(404).json({ success: false, message: "Appointment letter not found" });
        }

        // Extract S3 key from stored URL
        const s3Key = employee.appointmentLetters.url
            .split('.amazonaws.com/')[1]
            ?.split('?')[0];

        if (!s3Key) {
            return res.status(400).json({ success: false, message: "Invalid file URL" });
        }

        const command = new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: decodeURIComponent(s3Key),
        });

        // Signed URL valid for 15 minutes
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

        return res.status(200).json({
            success: true,
            fileUrl: signedUrl,
            fileName: employee.appointmentLetters.fileName,
            isVerified: employee.appointmentLetters.isVerified
        });
    } catch (error) {
        console.error("Preview appointment letter by admin error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const downloadAppointmentLetterByAdmin = async (req, res) => {
    try {
        const { employeeId } = req.params;

        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        if (!employee.appointmentLetters?.url) {
            return res.status(404).json({ success: false, message: "Appointment letter not found" });
        }

        const s3Key = employee.appointmentLetters.url
            .split('.amazonaws.com/')[1]
            ?.split('?')[0];

        if (!s3Key) {
            return res.status(400).json({ success: false, message: "Invalid file URL" });
        }

        const command = new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: decodeURIComponent(s3Key),
        });

        const s3Response = await s3Client.send(command);
        const fileName = employee.appointmentLetters.fileName || `${employeeId}_AppointmentLetter.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        s3Response.Body.pipe(res);
    } catch (error) {
        console.error("Download appointment letter by admin error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};