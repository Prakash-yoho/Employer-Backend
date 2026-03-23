import Application from "../model/Application.js";
import Job from "../model/Job.js";
import { generateOfferLetter, saveOfferLetter } from "../services/offerLetterService.js";
import { sendMail, sendOfferEmail, sendOfferStatusEmail } from "../utils/mailer.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    createApplicationValidation,
    updateApplicationValidation,
    updateApplicationStatusValidation,
    applicationQueryValidation,
    interviewValidation,
    offerValidation,
    offerStatusValidation,
    documentUploadValidation,
    documentVerificationValidation,
    documentUpdateValidation
} from "../validations/applicationValidation.js";
import { generateOfferCode } from "../utils/helper.js";
import OfferSequence from "../model/OfferSequence.js";
import { saveOfferLetterInS3 } from "../utils/saveOfferLetterInS3.js";
import { applicationSubmittedEmailTemplate, interviewRescheduledEmailTemplate, interviewScheduledEmailTemplate, interviewSelectedEmailTemplate,interviewRejectedEmailTemplate } from "../utils/emailTemplates.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "../config/s3.js";
import { pipeline } from "stream";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Application
export const createApplication = async (req, res) => {
    try {
        const { error } = createApplicationValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        if (req.user.role !== 'candidate') {
            return res.status(400).json({
                success: false,
                message: "Only candidates can apply for a job"
            });
        }

        const { job: jobId, additionalDocuments = [] } = req.body;
        const userId = req.user._id;

        // Check if job exists
        const job = await Job.findById(jobId);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found"
            });
        }

        // Check if job is active
        if (!job.isActive) {
            return res.status(400).json({
                success: false,
                message: "This job is no longer accepting applications"
            });
        }

        // Check if user has already applied for this job
        const existingApplication = await Application.findOne({
            job: jobId,
            user: userId
        });

        if (existingApplication) {
            return res.status(400).json({
                success: false,
                message: "You have already applied for this job"
            });
        }

        // Create application
        const application = await Application.create({
            job: jobId,
            user: userId,
            additionalDocuments
        });

        // Populate application details
        await application.populate([
            { path: 'job', select: 'title department location employmentType workingMode' },
            { path: 'user', select: 'fullName email phoneNumber' }
        ]);

        // Increment job applicants count
        await Job.findByIdAndUpdate(jobId, { $inc: { applicantsCount: 1 } });

        // Send notification to Candidate
        await sendMail({
            to: application.user.email,
            subject: `Application Received – ${application.job.title}`,
            html: applicationSubmittedEmailTemplate(application.user, application.job)
        });

        res.status(201).json({
            success: true,
            message: "Application submitted successfully",
            data: application
        });
    } catch (error) {
        console.error("Create application error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get User's Applications
export const getMyApplications = async (req, res) => {
    try {
        const { error } = applicationQueryValidation.validate(req.query);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { page = 1, limit = 10, sortBy = "createdAt", sortOrder = "desc" } = req.query;
        const userId = req.user._id;

        const filter = { user: userId };

        const sort = {};
        sort[sortBy] = sortOrder === "desc" ? -1 : 1;

        const applications = await Application.find(filter)
            .populate({
                path: 'job',
                select: 'title department location employmentType workingMode salaryRange experienceRequired applicantsCount'
            })
            .populate({ path: 'user', select: 'fullName email phoneNumber' })
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Application.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: "Applications retrieved successfully",
            data: applications,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalApplications: total,
                hasNext: page * limit < total,
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error("Get my applications error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Application by ID
export const getApplicationById = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id)
            .populate({
                path: 'job',
                select: 'title department location employmentType workingMode salaryRange experienceRequired jobDescription keyResponsibilities qualifications vacancyCount applicantsCount'
            })
            .populate({
                path: 'user',
                select: 'fullName email phoneNumber dateOfBirth gender address city state pincode highestEducation institution graduationYear percentage specialization totalExperience keySkills resume'
            });

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check if user has permission to view this application
        if (req.user.role === "candidate" && application.user._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only view your own applications."
            });
        }

        res.status(200).json({
            success: true,
            message: "Application retrieved successfully",
            data: application
        });
    } catch (error) {
        console.error("Get application by ID error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update Application (Candidate can update additional documents)
export const updateApplication = async (req, res) => {
    try {
        const { error } = updateApplicationValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const application = await Application.findById(req.params.id);
        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check permissions
        if (req.user.role === "candidate") {
            if (application.user.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied. You can only update your own applications."
                });
            }
            // Candidates can only update additional documents
            const allowedFields = ["additionalDocuments"];
            Object.keys(req.body).forEach(key => {
                if (!allowedFields.includes(key)) {
                    delete req.body[key];
                }
            });
        }

        const updatedApplication = await Application.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        ).populate([
            { path: 'job', select: 'title department location employmentType workingMode' },
            { path: 'user', select: 'fullName email phoneNumber' }
        ]);

        res.status(200).json({
            success: true,
            message: "Application updated successfully",
            data: updatedApplication
        });
    } catch (error) {
        console.error("Update application error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update Application Status (HR only)
export const updateApplicationStatus = async (req, res) => {
    try {
        const { error } = updateApplicationStatusValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const application = await Application.findById(req.params.id);
        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        const { status, rejectionReason = '' } = req.body;

        // Validate status transition
        const validTransitions = {
            "applied": ["reviewed", "rejected"],
            "reviewed": ["shortlisted", "rejected"],
            "shortlisted": ["interview scheduled", "rejected"],
            "interview scheduled": ["interview selected", "interview rejected", "rejected"],
            "interview rescheduled": ["interview selected", "interview rejected", "rejected"],
            "interview selected": ["offer sent", "rejected"],
            "interview rejected": ["rejected"],
            "offer sent": ["offer accepted", "offer rejected", "rejected"],
            "offer accepted": ["doc verification pending", "rejected"],
            "offer rejected": ["rejected"],
            "doc verification pending": ["doc verified", "rejected"],
            "doc verified": ["onboarded", "rejected"]
        };

        if (!validTransitions[application.status]?.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status transition from ${application.status} to ${status}`
            });
        }

        const updateData = { status, rejectionReason };

        // Handle interview results
        if (status === "interview selected" || status === "interview rejected") {
            // Preserve existing interview details and add result info
            updateData.interviewDetails = {
                ...application.interviewDetails.toObject()
            };

            if (status === "interview rejected") {
                updateData.rejectionReason = rejectionReason || "Not selected after interview";
            }
        } else if (rejectionReason) {
            updateData.rejectionReason = rejectionReason;
            updateData.isActive = false;

        }

        const updatedApplication = await Application.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate([
            { path: 'job', select: 'title department location' },
            { path: 'user', select: 'fullName email phoneNumber' },
        ]);

       // TODO: Send status update notification to candidate
if (status === "interview selected" || status === "interview rejected") {
    setTimeout(async () => {
        const isSelected = status === "interview selected";

        await sendMail({
            to: updatedApplication.user.email,
            subject: isSelected
                ? "Congratulations – You’ve Been Selected"
                : "Interview Update – Application Status",
            html: isSelected
                ? interviewSelectedEmailTemplate(
                    updatedApplication.user,
                    updatedApplication.job
                  )
                : interviewRejectedEmailTemplate(
                    updatedApplication.user,
                    updatedApplication.job
                  )
        });
    }, 2000);
}

        res.status(200).json({
            success: true,
            message: `Application status updated to ${status}`,
            data: updatedApplication
        });
    } catch (error) {
        console.error("Update application status error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Schedule Interview (HR only)
export const scheduleInterview = async (req, res) => {
    try {
        const { error } = interviewValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const application = await Application.findById(req.params.id);
        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check if application is in shortlisted status
        if (application.status !== "shortlisted") {
            return res.status(400).json({
                success: false,
                message: "Interview can only be scheduled for shortlisted applications"
            });
        }

        const updateData = {
            status: "interview scheduled",
            interviewDetails: {
                date: req.body.date,
                time: req.body.time,
                mode: req.body.mode,
                venue: req.body.mode === "offline" ? req.body.venue : undefined,
                meetingLink: req.body.mode === "online" ? req.body.meetingLink : undefined,
                instructions: req.body.instructions,
                scheduledBy: req.user._id,
                scheduledAt: new Date(),
                rescheduleHistory: [] // Initialize empty array
            }
        };

        const updatedApplication = await Application.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate([
            { path: 'job', select: 'title department location' },
            { path: 'user', select: 'fullName email phoneNumber' }
        ]);

        // Send email to candidate
        setTimeout(async () => {
            await sendMail({
                to: updatedApplication.user.email,
                subject: `INTERVIEW INVITATION– ${process.env.COMPANY_NAME}`,
                html: interviewScheduledEmailTemplate(
                    updatedApplication.user,
                    updatedApplication,
                    updatedApplication.interviewDetails
                )
            });
        }, 2000)

        res.status(200).json({
            success: true,
            message: "Interview scheduled successfully",
            data: updatedApplication
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Send Offer (HR only)
export const sendOffer = async (req, res) => {
    try {
        const { error } = offerValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const application = await Application.findById(req.params.id)
            .populate('job')
            .populate('user');

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check if the user already has an offer in any other application
        const existingOffer = await Application.findOne({
            user: application.user._id,
            status: "offer sent",
            _id: { $ne: application._id }
        });

        if (existingOffer) {
            return res.status(400).json({
                success: false,
                message: `User already has an offer for another application. Only one offer is allowed per candidate.`
            });
        }

        // Check if application is in interview selected status
        if (application.status !== "interview selected") {
            return res.status(400).json({
                success: false,
                message: "Offer can only be sent for selected candidates"
            });
        }

        if (application.offerDetails && application.offerDetails.offerLetter) {
            return res.status(400).json({
                success: false,
                message: `User already has an offer for the application (${application.job.title})`
            });
        }

        const offerSendDate = new Date();
        let seq = await OfferSequence.findOne();
        if (!seq) {
            seq = await OfferSequence.create({ lastNumber: 0 });
        }

        const newSequence = seq.lastNumber + 1;

        // Update global sequence
        await OfferSequence.updateOne({}, { lastNumber: newSequence });

        const offerRef = generateOfferCode(
            offerSendDate,
            application.job.location,
            application.job.title,
            newSequence
        );

        // Generate offer letter PDF
        let pdfBuffer;
        // let offerLetterFilename;
        let offerLetterUrl;

        try {
            pdfBuffer = await generateOfferLetter(application,
                { ...req.body, offerRef });
            // offerLetterFilename = await saveOfferLetter(pdfBuffer, application._id);
            offerLetterUrl = await saveOfferLetterInS3(pdfBuffer, application._id);
        } catch (pdfError) {
            console.error("PDF generation error:", pdfError);
            return res.status(500).json({
                success: false,
                message: "Failed to generate offer letter PDF"
            });
        }

        const updateData = {
            status: "offer sent",
            offerDetails: {
                ...req.body,
                // offerLetter: offerLetterFilename,
                offerLetter: offerLetterUrl,
                sentDate: offerSendDate,
                terms: req.body.terms || "This offer is subject to background verification and document validation. The first 3 months will be a probationary period.",
                offerRef
            }
        };

        const updatedApplication = await Application.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate([
            { path: 'job', select: 'title department location employmentType workingMode' },
            { path: 'user', select: 'fullName email phoneNumber' }
        ]);

        // Send offer email with PDF attachment using Brevo
        let emailSent = false;
        setTimeout(async () => {
            try {
                await sendOfferEmail(application.user, updatedApplication, pdfBuffer);
                emailSent = true;
            } catch (emailError) {
                console.log('Failed to send offer email:', emailError);
            }
        }, 2000)

        res.status(200).json({
            success: true,
            message: "Offer sent successfully" + (emailSent ? " with email notification" : " (email failed)"),
            data: {
                application: updatedApplication,
                // offerLetter: {
                //     filename: offerLetterFilename,
                //     downloadUrl: `/api/applications/${application._id}/offer-letter`,
                //     previewUrl: `/api/applications/${application._id}/offer-letter/preview`
                // },
                offerLetter: {
                    url: offerLetterUrl
                },
                emailSent: emailSent
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update Offer Status (Candidate)
export const updateOfferStatus = async (req, res) => {
    try {
        const { error } = offerStatusValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { status } = req.body;
        const application = await Application.findById(req.params.id)
            .populate('job')
            .populate('user');

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check permissions
        if (application.user._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only update your own applications."
            });
        }

        // Check if application is in offer sent status
        if (application.status !== "offer sent") {
            return res.status(400).json({
                success: false,
                message: "Offer status can only be updated when offer is sent"
            });
        }

        let updateData = {};

        if (status === "offer rejected") {
            updateData = {
                status: "offer rejected",
                isActive: false,
                offerDetails: {
                    ...application.offerDetails,
                    rejectionReason: req.body.rejectionReason || "Candidate rejected the offer"
                }
            };
        } else if (status === "offer accepted") {
            // IMPORTANT: Change to doc verification pending, not offer accepted
            updateData = {
                status: "offer accepted"
            };
        } else {
            return res.status(400).json({
                success: false,
                message: "Invalid offer status. Must be 'offer accepted' or 'offer rejected'"
            });
        }

        const updatedApplication = await Application.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate([
            { path: 'job', select: 'title department location' },
            { path: 'user', select: 'fullName email phoneNumber' }
        ]);

        // Send offer status email via Brevo
        setTimeout(async () => {
            try {
                await sendOfferStatusEmail(application.user, application, status);
            } catch (emailError) {
                console.log('Failed to send offer status email:', emailError);
            }
        }, 2000)

        res.status(200).json({
            success: true,
            message: `Offer ${status} successfully`,
            data: updatedApplication
        });
    } catch (error) {
        console.error("Update offer status error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Upload Documents (Candidate)
export const uploadDocuments = async (req, res) => {
    try {
        const { error } = documentUploadValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const application = await Application.findById(req.params.id);

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check permissions
        if (application.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only update your own applications."
            });
        }

        // Check if application is in doc verification pending status
        if (application.status !== "doc verification pending") {
            return res.status(400).json({
                success: false,
                message: "Documents can only be uploaded when document verification is pending"
            });
        }

        const { documents } = req.body;

        const updatedApplication = await Application.findByIdAndUpdate(
            req.params.id,
            {
                $push: { documents: { $each: documents } }
            },
            { new: true, runValidators: true }
        ).populate([
            { path: 'job', select: 'title department location' },
            { path: 'user', select: 'fullName email phoneNumber' }
        ]);

        res.status(200).json({
            success: true,
            message: "Documents uploaded successfully",
            data: updatedApplication
        });
    } catch (error) {
        console.error("Upload documents error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update Document (Candidate)
export const updateDocument = async (req, res) => {
    try {
        const { error } = documentUpdateValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const application = await Application.findById(req.params.id);

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check permissions
        if (application.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only update your own applications."
            });
        }

        const { documentId, file, name } = req.body;

        // Find the document
        const document = application.documents.id(documentId);
        if (!document) {
            return res.status(404).json({
                success: false,
                message: "Document not found"
            });
        }

        // Update document
        document.file = file;
        document.name = name || document.name;
        document.status = "pending";
        document.rejectionReason = "";
        document.uploadedAt = new Date();

        await application.save();

        const updatedApplication = await Application.findById(req.params.id)
            .populate([
                { path: 'job', select: 'title department location' },
                { path: 'user', select: 'fullName email phoneNumber' }
            ]);

        res.status(200).json({
            success: true,
            message: "Document updated successfully",
            data: updatedApplication
        });
    } catch (error) {
        console.error("Update document error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Verify Document (HR only)
export const verifyDocument = async (req, res) => {
    try {
        const { error } = documentVerificationValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { documentId, status, rejectionReason } = req.body;
        const application = await Application.findById(req.params.id);

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Find the document
        const document = application.documents.id(documentId);
        if (!document) {
            return res.status(404).json({
                success: false,
                message: "Document not found"
            });
        }

        // Update document status
        document.status = status;
        document.verifiedAt = new Date();

        if (status === "rejected" && rejectionReason) {
            document.rejectionReason = rejectionReason;
        }

        await application.save();

        // Check if all documents are approved
        const allApproved = application.documents.every(doc => doc.status === "approved");

        if (allApproved && application.documents.length > 0) {
            application.status = "doc verified";
            await application.save();
        }

        const updatedApplication = await Application.findById(req.params.id)
            .populate([
                { path: 'job', select: 'title department location' },
                { path: 'user', select: 'fullName email phoneNumber' }
            ]);

        res.status(200).json({
            success: true,
            message: `Document ${status} successfully`,
            data: updatedApplication
        });
    } catch (error) {
        console.error("Verify document error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Onboard Candidate (HR only)
export const onboardCandidate = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check if application is in doc verified status
        if (application.status !== "doc verified") {
            return res.status(400).json({
                success: false,
                message: "Candidate can only be onboarded after document verification"
            });
        }

        const updatedApplication = await Application.findByIdAndUpdate(
            req.params.id,
            { status: "onboarded" },
            { new: true, runValidators: true }
        ).populate([
            { path: 'job', select: 'title department location' },
            { path: 'user', select: 'fullName email phoneNumber' }
        ]);

        // TODO: Create employee record and send onboarding email

        res.status(200).json({
            success: true,
            message: "Candidate onboarded successfully",
            data: updatedApplication
        });
    } catch (error) {
        console.error("Onboard candidate error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Applications for a Job (HR only)
export const getJobApplications = async (req, res) => {
    try {
        const { error } = applicationQueryValidation.validate(req.query);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { status, page = 1, limit = 10, sortBy = "createdAt", sortOrder = "desc" } = req.query;
        const jobId = req.params.jobId;

        // Check if job exists
        const job = await Job.findById(jobId);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found"
            });
        }

        const filter = { job: jobId };
        if (status) filter.status = status;

        const sort = {};
        sort[sortBy] = sortOrder === "desc" ? -1 : 1;

        const applications = await Application.find(filter)
            .populate({
                path: 'user',
                select: 'fullName email phoneNumber highestEducation institution totalExperience keySkills resume'
            })
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Application.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: "Job applications retrieved successfully",
            data: applications,
            job: {
                title: job.title,
                department: job.department,
                location: job.location
            },
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalApplications: total,
                hasNext: page * limit < total,
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error("Get job applications error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get All Applications (HR only)
export const getAllApplications = async (req, res) => {
    try {
        const { error } = applicationQueryValidation.validate(req.query);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { status, job, user, sortBy = "createdAt", sortOrder = "desc" } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (job) filter.job = job;
        if (user) filter.user = user;

        const sort = {};
        sort[sortBy] = sortOrder === "desc" ? -1 : 1;

        const applications = await Application.find(filter)
            .populate({
                path: 'job',
                select: 'title department location employmentType'
            })
            .populate({
                path: 'user',
                select: 'fullName email phoneNumber highestEducation totalExperience designation resume gender parentName, address1 address2 city state pincode'
            })
            .sort(sort)

        const total = await Application.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: "All applications retrieved successfully",
            data: applications,
            count: total,
        });
    } catch (error) {
        console.error("Get all applications error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Delete/Withdraw Application
export const deleteApplication = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check if user owns this application or is HR
        if (req.user.role === "candidate" && application.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only delete your own applications."
            });
        }

        await Application.findByIdAndDelete(req.params.id);

        // Decrement job applicants count
        await Job.findByIdAndUpdate(application.job, { $inc: { applicantsCount: -1 } });

        res.status(200).json({
            success: true,
            message: "Application deleted successfully"
        });
    } catch (error) {
        console.error("Delete application error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Application Statistics
export const getApplicationStats = async (req, res) => {
    try {
        let filter = {};

        // If candidate, only show their stats
        if (req.user.role === "candidate") {
            filter.user = req.user._id;
        }

        const stats = await Application.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const total = await Application.countDocuments(filter);

        const statistics = {
            total,
            applied: 0,
            reviewed: 0,
            shortlisted: 0,
            "interview scheduled": 0,
            "interview selected": 0,
            "interview rejected": 0,
            "offer sent": 0,
            "offer accepted": 0,
            "offer rejected": 0,
            rejected: 0,
            "doc verification pending": 0,
            "doc verified": 0,
            onboarded: 0
        };

        stats.forEach(stat => {
            statistics[stat._id] = stat.count;
        });

        res.status(200).json({
            success: true,
            message: "Application statistics retrieved successfully",
            data: statistics
        });
    } catch (error) {
        console.error("Get application stats error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Reschedule Interview (HR only)
export const rescheduleInterview = async (req, res) => {
    try {
        const { error } = interviewValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const application = await Application.findById(req.params.id);
        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check if application is in interview scheduled or interview rescheduled status
        if (!["interview scheduled", "interview rescheduled"].includes(application.status)) {
            return res.status(400).json({
                success: false,
                message: "Interview can only be rescheduled for scheduled interviews"
            });
        }

        // Ensure interviewDetails exists
        if (!application.interviewDetails) {
            return res.status(400).json({
                success: false,
                message: "No interview details found to reschedule"
            });
        }

        // Save previous interview details to history
        const rescheduleRecord = {
            previousDate: application.interviewDetails.date,
            previousTime: application.interviewDetails.time,
            previousMode: application.interviewDetails.mode,
            previousVenue: application.interviewDetails.venue,
            previousMeetingLink: application.interviewDetails.meetingLink,
            rescheduledBy: req.user._id,
            rescheduledAt: new Date(),
            reason: req.body.reason || "Rescheduled by HR"
        };

        // Get existing reschedule history or initialize empty array
        const existingHistory = application.interviewDetails.rescheduleHistory || [];

        // Update interview details
        const updateData = {
            status: "interview rescheduled",
            interviewDetails: {
                date: req.body.date,
                time: req.body.time,
                mode: req.body.mode,
                venue: req.body.mode === "offline" ? req.body.venue : undefined,
                meetingLink: req.body.mode === "online" ? req.body.meetingLink : undefined,
                instructions: req.body.instructions,
                scheduledBy: req.user._id,
                scheduledAt: new Date(),
                rescheduleHistory: [...existingHistory, rescheduleRecord] // Add new record
            }
        };

        const updatedApplication = await Application.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate([
            { path: 'job', select: 'title department location' },
            { path: 'user', select: 'fullName email phoneNumber' },
        ]);

        setTimeout(async () => {
            await sendMail({
                to: updatedApplication.user.email,
                subject: `RESCHEDULED INTERVIEW INVITATION– ${process.env.COMPANY_NAME}`,
                html: interviewRescheduledEmailTemplate(
                    updatedApplication.user,
                    updatedApplication,
                    updatedApplication.interviewDetails,
                )
            });
        }, 2000)

        res.status(200).json({
            success: true,
            message: "Interview rescheduled successfully",
            data: updatedApplication
        });
    } catch (error) {
        console.error("Reschedule interview error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Interview Reschedule History (HR & Candidate)
export const getInterviewRescheduleHistory = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id)
            .populate({
                path: 'interviewDetails.rescheduleHistory.rescheduledBy',
                select: 'fullName email role'
            })
            .select('interviewDetails.rescheduleHistory status');

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check permissions
        if (req.user.role === "candidate" && application.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only view your own applications."
            });
        }

        res.status(200).json({
            success: true,
            message: "Reschedule history retrieved successfully",
            data: {
                rescheduleHistory: application.interviewDetails.rescheduleHistory || [],
                currentStatus: application.status
            }
        });
    } catch (error) {
        console.error("Get reschedule history error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Application Timeline Status
export const getApplicationTimeline = async (req, res) => {
    try {
        const application = await Application.findById(req.params.id)
            .populate([
                {
                    path: 'job',
                    select: 'title department location employmentType workingMode'
                },
                {
                    path: 'user',
                    select: 'fullName email phoneNumber'
                },
            ]);

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        // Check permissions
        if (req.user.role === "candidate" && application.user._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only view your own applications."
            });
        }

        // Define statuses in order
        const allStatuses = [
            "applied",
            "reviewed",
            "shortlisted",
            "interview scheduled",
            "interview rescheduled",
            "interview selected",
            "interview rejected",
            "offer sent",
            "offer accepted",
            "offer rejected",
            "rejected",
            "doc verification pending",
            "doc verified",
            "onboarded"
        ];

        const currentStatus = application.status;
        const currentIndex = allStatuses.indexOf(currentStatus);
        const hasRescheduleHistory = application.interviewDetails?.rescheduleHistory?.length > 0;

        // Helper function to determine timeline item state
        const getTimelineItemState = (status, index) => {
            const timelineItem = {
                status,
                title: getStatusTitle(status),
                description: getStatusDescription(status),
                completed: false,
                inProgress: false,
                pending: false,
                date: getStatusDate(application, status),
                data: getStatusData(application, status)
            };

            // ====== REJECTION CASES ======
            if (currentStatus === "rejected") {
                // Simple rejection path: applied → reviewed → rejected
                if (status === "applied" || status === "reviewed") {
                    timelineItem.completed = true;
                } else if (status === "rejected") {
                    timelineItem.inProgress = true;
                }
                return timelineItem;
            }

            if (currentStatus === "interview rejected") {
                // Path: applied → reviewed → shortlisted → interview scheduled → interview rejected
                const completedStatuses = ["applied", "reviewed", "shortlisted", "interview scheduled"];
                if (completedStatuses.includes(status)) {
                    timelineItem.completed = true;
                } else if (status === "interview rescheduled") {
                    timelineItem.completed = hasRescheduleHistory;
                } else if (status === "interview rejected") {
                    timelineItem.inProgress = true;
                }
                return timelineItem;
            }

            if (currentStatus === "offer rejected") {
                // Path: applied → reviewed → shortlisted → interview scheduled → interview selected → offer sent → offer rejected
                // EXCLUDE: interview rejected, rejected (these are different rejection paths)

                const offerSentIndex = allStatuses.indexOf("offer sent");
                const interviewRejectedIndex = allStatuses.indexOf("interview rejected");
                const rejectedIndex = allStatuses.indexOf("rejected");

                // Define which statuses should be completed for offer rejected path
                const offerRejectedCompletedStatuses = [
                    "applied", "reviewed", "shortlisted", "interview scheduled",
                    "interview selected", "offer sent"
                ];

                if (offerRejectedCompletedStatuses.includes(status)) {
                    timelineItem.completed = true;

                    // Handle interview rescheduled - only if there was history
                    if (status === "interview rescheduled") {
                        timelineItem.completed = hasRescheduleHistory;
                    }
                } else if (status === "offer rejected") {
                    timelineItem.inProgress = true;
                }
                // All other statuses (interview rejected, rejected, doc verification pending, etc.) remain false
                return timelineItem;
            }

            // ====== SUCCESSFUL PATHS ======
            // For successful paths, NEVER show rejection statuses
            const isRejectionStatus = ["interview rejected", "offer rejected", "rejected"].includes(status);

            if (isRejectionStatus) {
                // Always false for successful paths
                timelineItem.completed = false;
                timelineItem.inProgress = false;
                timelineItem.pending = false;
                return timelineItem;
            }

            // ====== INTERVIEW SELECTED SPECIFIC LOGIC ======
            if (currentStatus === "interview selected") {
                // For interview selected, show successful path only
                const successfulPathStatuses = [
                    "applied",
                    "reviewed",
                    "shortlisted",
                    "interview scheduled",
                    "interview rescheduled",
                    "interview selected",
                    "offer sent",
                    "offer accepted",
                    "doc verification pending",
                    "doc verified",
                    "onboarded"
                ];

                if (!successfulPathStatuses.includes(status)) {
                    // Skip this status entirely
                    timelineItem.completed = false;
                    timelineItem.inProgress = false;
                    timelineItem.pending = false;
                    return timelineItem;
                }

                if (index < currentIndex) {
                    timelineItem.completed = true;
                } else if (index === currentIndex) {
                    timelineItem.inProgress = true;
                } else {
                    timelineItem.pending = true;
                }

                // Handle interview rescheduled
                if (status === "interview rescheduled") {
                    timelineItem.completed = hasRescheduleHistory;
                    timelineItem.inProgress = false;
                    timelineItem.pending = !hasRescheduleHistory;
                }
                return timelineItem;
            }

            // ====== OTHER SUCCESSFUL PATHS ======
            const isSuccessfulPath = ["offer sent", "offer accepted", "doc verification pending", "doc verified", "onboarded"].includes(currentStatus);

            if (isSuccessfulPath) {
                // Filter out rejection statuses for successful paths
                if (isRejectionStatus) {
                    timelineItem.completed = false;
                    timelineItem.inProgress = false;
                    timelineItem.pending = false;
                    return timelineItem;
                }

                if (index < currentIndex) {
                    timelineItem.completed = true;
                } else if (index === currentIndex) {
                    timelineItem.inProgress = true;
                } else {
                    timelineItem.pending = true;
                }

                // Handle interview rescheduled
                if (status === "interview rescheduled") {
                    timelineItem.completed = hasRescheduleHistory;
                    timelineItem.inProgress = false;
                    timelineItem.pending = !hasRescheduleHistory;
                }
                return timelineItem;
            }

            // ====== DEFAULT LOGIC (for intermediate statuses) ======
            if (index < currentIndex) {
                timelineItem.completed = true;

                // Special handling for interview rescheduled
                if (status === "interview rescheduled") {
                    timelineItem.completed = hasRescheduleHistory;
                }
            } else if (index === currentIndex) {
                timelineItem.inProgress = true;
            } else {
                timelineItem.pending = true;
            }

            return timelineItem;
        };

        // Build timeline
        const timeline = allStatuses.map((status, index) =>
            getTimelineItemState(status, index)
        );

        // Filter out items where all states are false
        let filteredTimeline = timeline.filter(item =>
            item.completed || item.inProgress || item.pending
        );

        res.status(200).json({
            success: true,
            message: "Application timeline retrieved successfully",
            data: {
                applicationId: application._id,
                jobTitle: application.job?.title,
                currentStatus: application.status,
                currentStatusTitle: getStatusTitle(application.status),
                hasRescheduleHistory: hasRescheduleHistory,
                timeline: filteredTimeline,
                summary: {
                    appliedDate: application.createdAt,
                    lastUpdated: application.updatedAt,
                    isActive: application.isActive,
                    rejectionReason: application.rejectionReason
                }
            }
        });
    } catch (error) {
        console.error("Get application timeline error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Helper function to get status title
const getStatusTitle = (status) => {
    const statusTitles = {
        "applied": "Application Submitted",
        "reviewed": "Application Reviewed",
        "shortlisted": "Shortlisted",
        "interview scheduled": "Interview Scheduled",
        "interview rescheduled": "Interview Rescheduled",
        "interview selected": "Interview Passed",
        "interview rejected": "Interview Failed",
        "offer sent": "Offer Sent",
        "offer accepted": "Offer Accepted",
        "offer rejected": "Offer Rejected",
        "rejected": "Application Rejected",
        "doc verification pending": "Document Verification Pending",
        "doc verified": "Documents Verified",
        "onboarded": "Onboarded"
    };
    return statusTitles[status] || status;
};

// Helper function to get status description
const getStatusDescription = (status) => {
    const statusDescriptions = {
        "applied": "Your application has been successfully submitted",
        "reviewed": "HR has reviewed your application",
        "shortlisted": "Your profile has been shortlisted for the next round",
        "interview scheduled": "Interview has been scheduled",
        "interview rescheduled": "Interview has been rescheduled",
        "interview selected": "You have successfully cleared the interview",
        "interview rejected": "You did not clear the interview round",
        "offer sent": "Offer letter has been sent to you",
        "offer accepted": "You have accepted the offer",
        "offer rejected": "You have rejected the offer",
        "rejected": "Your application has been rejected",
        "doc verification pending": "Please upload required documents for verification",
        "doc verified": "All your documents have been verified successfully",
        "onboarded": "Welcome aboard! You have been successfully onboarded"
    };
    return statusDescriptions[status] || "";
};

// Helper function to get status date
const getStatusDate = (application, status) => {
    switch (status) {
        case "applied":
            return application.createdAt;

        case "interview scheduled":
            return application.interviewDetails?.scheduledAt;

        case "interview rescheduled":
            // Return the latest reschedule date if exists
            const history = application.interviewDetails?.rescheduleHistory;
            if (history && history.length > 0) {
                return history[history.length - 1].rescheduledAt;
            }
            return null;

        case "offer sent":
            return application.offerDetails?.sentDate;

        case "doc verified":
            // Find when all documents were approved
            const allVerified = application.documents?.every(doc => doc.status === "approved");
            if (allVerified && application.documents?.length > 0) {
                const lastVerifiedDoc = application.documents
                    .filter(doc => doc.verifiedAt)
                    .sort((a, b) => new Date(b.verifiedAt) - new Date(a.verifiedAt))[0];
                return lastVerifiedDoc?.verifiedAt;
            }
            return null;

        case "onboarded":
            return application.updatedAt;

        case "rejected":
        case "interview rejected":
        case "offer rejected":
            return application.updatedAt;

        default:
            // For other statuses, find when status was updated to this value
            return application.updatedAt;
    }
};


// Helper function to get status-specific data
const getStatusData = (application, status) => {
    switch (status) {
        case "interview scheduled":
            return {
                interviewDate: application.interviewDetails?.date,
                interviewTime: application.interviewDetails?.time,
                mode: application.interviewDetails?.mode,
                venue: application.interviewDetails?.venue,
                meetingLink: application.interviewDetails?.meetingLink,
                instructions: application.interviewDetails?.instructions,
                scheduledBy: application.interviewDetails?.scheduledBy
            };

        case "interview rescheduled":
            const history = application.interviewDetails?.rescheduleHistory || [];
            const lastReschedule = history.length > 0 ? history[history.length - 1] : null;
            const currentInterview = application.interviewDetails || {};

            return {
                interviewDate: currentInterview.date,
                interviewTime: currentInterview.time,
                mode: currentInterview.mode,
                venue: currentInterview.venue,
                meetingLink: currentInterview.meetingLink,
                instructions: currentInterview.instructions,
                scheduledBy: currentInterview.scheduledBy,
                rescheduleCount: history.length,
                lastReschedule: lastReschedule ? {
                    previousDate: lastReschedule.previousDate,
                    previousTime: lastReschedule.previousTime,
                    reason: lastReschedule.reason,
                    rescheduledAt: lastReschedule.rescheduledAt,
                    rescheduledBy: lastReschedule.rescheduledBy
                } : null
            };

        case "offer sent":
            return {
                offerLetter: application.offerDetails?.offerLetter,
                salary: application.offerDetails?.salary,
                joiningDate: application.offerDetails?.joiningDate,
                terms: application.offerDetails?.terms
            };

        case "doc verification pending":
        case "doc verified":
            const documents = application.documents || [];
            return {
                totalDocuments: documents.length,
                approvedDocuments: documents.filter(doc => doc.status === "approved").length,
                pendingDocuments: documents.filter(doc => doc.status === "pending").length,
                rejectedDocuments: documents.filter(doc => doc.status === "rejected").length,
                documents: documents.map(doc => ({
                    documentType: doc.documentType,
                    name: doc.name,
                    status: doc.status,
                    rejectionReason: doc.rejectionReason,
                    uploadedAt: doc.uploadedAt,
                    verifiedAt: doc.verifiedAt
                }))
            };

        case "rejected":
        case "interview rejected":
        case "offer rejected":
            return {
                rejectionReason: application.rejectionReason
            };

        default:
            return null;
    }
};

// Get Interview Scheduled Applications (HR only)
export const getInterviewScheduledApplications = async (req, res) => {
    try {
        const { error } = applicationQueryValidation.validate(req.query);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const {
            sortBy = "interviewDetails.date",
            sortOrder = "asc",
        } = req.query;

        // Filter for interview scheduled applications
        const filter = {
            status: {
                $in: ["interview scheduled", "interview rescheduled"]
            }
        };

        const sort = {};
        sort[sortBy] = sortOrder === "desc" ? -1 : 1;

        const applications = await Application.find(filter)
            .populate({
                path: 'job',
                select: 'title department location employmentType workingMode'
            })
            .populate({
                path: 'user',
                select: 'fullName email phoneNumber highestEducation totalExperience keySkills resume'
            })
            .sort(sort)

        const total = await Application.countDocuments(filter);

        // Get statistics for interview scheduled applications
        const stats = await Application.aggregate([
            { $match: { status: { $in: ["interview scheduled", "interview rescheduled"] } } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const statistics = {
            total: total,
            "interview scheduled": 0,
            "interview rescheduled": 0
        };

        stats.forEach(stat => {
            statistics[stat._id] = stat.count;
        });

        res.status(200).json({
            success: true,
            message: "Interview scheduled applications retrieved successfully",
            data: applications,
            statistics: statistics,
        });
    } catch (error) {
        console.error("Get interview scheduled applications error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const streamPipeline = promisify(pipeline);

// Download Offer Letter
export const downloadOfferLetter = async (req, res) => {
    try {
        const applicationId = req.params.id;

        // Find application with offer details
        const application = await Application.findById(applicationId)
            .populate('job', 'title department')
            .populate('user', 'fullName');

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        if (!application.offerDetails || !application.offerDetails.offerLetter) {
            return res.status(404).json({
                success: false,
                message: "Offer letter not found for this application"
            });
        }

        // Permission checks
        if (req.user.role === 'candidate' &&
            application.user._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only download your own offer letter."
            });
        }

        // Offer letter URL stored in DB
        const offerLetterUrl = application.offerDetails.offerLetter;

        // Extract S3 key from the URL
        const key = offerLetterUrl.split(".amazonaws.com/")[1]; // remove domain

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "Invalid offer letter URL"
            });
        }

        // Generate a proper filename
        const safeFilename =
            `Offer_Letter_${application.job.title.replace(/[^a-zA-Z0-9]/g, '_')}_${application.user.fullName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

        // Fetch object from S3
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key
        });

        const file = await s3.send(command);

        // Set headers for browser download
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);

        // Stream S3 file to response
        await streamPipeline(file.Body, res);

    } catch (error) {
        console.error("Download offer letter error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Preview Offer Letter (inline in browser)
export const previewOfferLetter = async (req, res) => {
    try {
        const applicationId = req.params.id;

        const application = await Application.findById(applicationId)
            .populate('job', 'title department')
            .populate('user', 'fullName');

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        if (!application.offerDetails || !application.offerDetails.offerLetter) {
            return res.status(404).json({
                success: false,
                message: "Offer letter not found for this application"
            });
        }

        // Check permissions
        if (req.user.role === 'candidate' && application.user._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only preview your own offer letter."
            });
        }

        const filename = application.offerDetails.offerLetter;
        const filepath = path.join(__dirname, '../uploads/offer-letters', filename);

        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                success: false,
                message: "Offer letter file not found on server"
            });
        }

        // Set headers for inline preview (opens in browser instead of download)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', fs.statSync(filepath).size);
        res.setHeader('Cache-Control', 'no-cache');

        const fileStream = fs.createReadStream(filepath);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('File stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: "Error streaming offer letter file"
                });
            }
        });

    } catch (error) {
        console.error("Preview offer letter error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Offer Letter Info (without downloading file)
export const getOfferLetterInfo = async (req, res) => {
    try {
        const applicationId = req.params.id;

        const application = await Application.findById(applicationId)
            .populate('job', 'title department location')
            .populate('user', 'fullName email');

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }

        if (!application.offerDetails) {
            return res.status(404).json({
                success: false,
                message: "No offer details found for this application"
            });
        }

        // Check permissions
        if (req.user.role === 'candidate' && application.user._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Access denied. You can only view your own offer information."
            });
        }

        const offerInfo = {
            applicationId: application._id,
            status: application.status,
            offerDetails: {
                salary: application.offerDetails.salary,
                joiningDate: application.offerDetails.joiningDate,
                sentDate: application.offerDetails.sentDate,
                hasOfferLetter: !!application.offerDetails.offerLetter,
                offerLetter: application.offerDetails.offerLetter ? {
                    filename: application.offerDetails.offerLetter,
                    downloadUrl: `/api/applications/${application._id}/offer-letter`,
                    previewUrl: `/api/applications/${application._id}/offer-letter/preview`
                } : null
            },
            job: application.job,
            candidate: application.user
        };

        res.status(200).json({
            success: true,
            message: "Offer letter information retrieved successfully",
            data: offerInfo
        });

    } catch (error) {
        console.error("Get offer letter info error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};