import mongoose, { Schema } from "mongoose";

// Sub-schema for each document
const documentFieldSchema = new Schema({
    fileUrl: {
        type: String,
        default: null
    },
    fileKey: {
        type: String,
        default: null
    },
    fileName: {
        type: String,
        default: null
    },
    fileSize: {
        type: Number,
        default: null
    },
    mimeType: {
        type: String,
        default: null
    },
    uploadedAt: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'doc_submitted', 'doc_rejected', 'verified'],
        default: 'pending'
    },
    remark: {
        type: String,
        default: null,
        trim: true
    },
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        default: null
    },
    verifiedAt: {
        type: Date,
        default: null
    }
}, { _id: false });

// Sub-schema for experience documents
const experienceDocumentSchema = new Schema({
    companyName: {
        type: String,
        required: true,
        trim: true
    },
    experienceCertificate: documentFieldSchema,
    sixmonthstatement:documentFieldSchema,
    relievingCertificate: documentFieldSchema,
    payslips: [documentFieldSchema], // Array for multiple payslips (last 6 months)
    appointmentLetter: documentFieldSchema
}, { _id: false });

// Main Document Schema
const documentSchema = new Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    employeeId: {
        type: String,
        required: true
    },

    // MANDATORY DOCUMENTS
    aadharCard: {
        type: documentFieldSchema,
        default: () => ({})
    },

    panCard: {
        type: documentFieldSchema,
        default: () => ({})
    },

    addressProof: {
        type: documentFieldSchema,
        default: () => ({})
    },

    tenthCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },
    eleventhCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },
    twelfthCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },

    ugCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },

    bankPassbook: {
        type: documentFieldSchema,
        default: () => ({})
    },

    signedOfferLetter: {
        type: documentFieldSchema,
        default: () => ({})
    },

    // OPTIONAL DOCUMENTS
    drivingLicense: {
        type: documentFieldSchema,
        default: () => ({})
    },

    passport: {
        type: documentFieldSchema,
        default: () => ({})
    },
    interviewresume: {
        type: documentFieldSchema,
        default: () => ({})
    },

    birthCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },

    consolidatedCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },
    pgconsolidatedCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },
    diplomaconsolidatedCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },

    trainingCertificates: {
        type: [documentFieldSchema],
        default: []
    },

    diplomaCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },

    pgCertificate: {
        type: documentFieldSchema,
        default: () => ({})
    },

    // EXPERIENCE DOCUMENTS (Array for multiple companies)
    experienceDocuments: {
        type: [experienceDocumentSchema],
        default: []
    },

    // OVERALL STATUS
    overallStatus: {
        type: String,
        enum: ['pending', 'in_progress', 'completed'],
        default: 'pending'
    },

    verificationProgress: {
        type: String,
        default: '0/0'
    },

    submittedAt: {
        type: Date,
        default: null
    },

    completedAt: {
        type: Date,
        default: null
    },

    // TRACKING
    totalDocuments: {
        type: Number,
        default: 0
    },

    submittedDocuments: {
        type: Number,
        default: 0
    },

    verifiedDocuments: {
        type: Number,
        default: 0
    },

    rejectedDocuments: {
        type: Number,
        default: 0
    },

    pendingDocuments: {
        type: Number,
        default: 0
    },

    lastUpdatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    },

    lastVerifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        default: null
    },

    lastVerifiedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// FIXED: Calculate verification progress before saving
documentSchema.pre('save', async function (next) {
    try {
        // Count all document fields
        const mandatoryFields = [
            'aadharCard', 'panCard', 'addressProof', 'tenthCertificate','eleventhCertificate',
            'twelfthCertificate', 'ugCertificate', 'bankPassbook', 'signedOfferLetter','interviewresume'
        ];

        const optionalFields = [
            'drivingLicense', 'passport', 'birthCertificate', 'consolidatedCertificate','pgconsolidatedCertificate','diplomaconsolidatedCertificate',
            'diplomaCertificate', 'pgCertificate'
        ];

        let totalDocuments = 0;
        let submittedDocuments = 0;
        let verifiedDocuments = 0;
        let rejectedDocuments = 0;
        let pendingDocuments = 0;

        // Count mandatory documents
        mandatoryFields.forEach(field => {
            if (this[field] && this[field].status && this[field].status !== 'pending') {
                totalDocuments++;
                submittedDocuments++;

                if (this[field].status === 'verified') verifiedDocuments++;
                if (this[field].status === 'doc_rejected') rejectedDocuments++;
                if (this[field].status === 'doc_submitted') pendingDocuments++;
            }
        });

        // Count optional documents (only if submitted)
        optionalFields.forEach(field => {
            if (this[field] && this[field].status && this[field].status !== 'pending') {
                totalDocuments++;
                submittedDocuments++;

                if (this[field].status === 'verified') verifiedDocuments++;
                if (this[field].status === 'doc_rejected') rejectedDocuments++;
                if (this[field].status === 'doc_submitted') pendingDocuments++;
            }
        });

        // Count training certificates
        if (this.trainingCertificates && Array.isArray(this.trainingCertificates)) {
            this.trainingCertificates.forEach(cert => {
                if (cert && cert.status && cert.status !== 'pending') {
                    totalDocuments++;
                    submittedDocuments++;

                    if (cert.status === 'verified') verifiedDocuments++;
                    if (cert.status === 'doc_rejected') rejectedDocuments++;
                    if (cert.status === 'doc_submitted') pendingDocuments++;
                }
            });
        }

        // Count experience documents
        if (this.experienceDocuments && Array.isArray(this.experienceDocuments)) {
            this.experienceDocuments.forEach(exp => {
                if (exp) {
                    // Count each document field in experience
                    const expFields = ['experienceCertificate', 'relievingCertificate', 'sixmonthstatement', 'appointmentLetter'];
                    expFields.forEach(field => {
                        if (exp[field] && exp[field].status && exp[field].status !== 'pending') {
                            totalDocuments++;
                            submittedDocuments++;

                            if (exp[field].status === 'verified') verifiedDocuments++;
                            if (exp[field].status === 'doc_rejected') rejectedDocuments++;
                            if (exp[field].status === 'doc_submitted') pendingDocuments++;
                        }
                    });

                    // Count payslips
                    if (exp.payslips && Array.isArray(exp.payslips)) {
                        exp.payslips.forEach(payslip => {
                            if (payslip && payslip.status && payslip.status !== 'pending') {
                                totalDocuments++;
                                submittedDocuments++;

                                if (payslip.status === 'verified') verifiedDocuments++;
                                if (payslip.status === 'doc_rejected') rejectedDocuments++;
                                if (payslip.status === 'doc_submitted') pendingDocuments++;
                            }
                        });
                    }
                }
            });
        }

        // Update counts
        this.totalDocuments = totalDocuments;
        this.submittedDocuments = submittedDocuments;
        this.verifiedDocuments = verifiedDocuments;
        this.rejectedDocuments = rejectedDocuments;
        this.pendingDocuments = pendingDocuments;

        // Calculate progress
        if (totalDocuments > 0) {
            this.verificationProgress = `${verifiedDocuments}/${totalDocuments}`;

            // Update overall status
            if (verifiedDocuments === totalDocuments && totalDocuments > 0) {
                this.overallStatus = 'completed';
                await mongoose.model('Employee').updateOne(
                    { _id: this.employee },
                    { $set: { status: 'verified' } }
                );
                this.completedAt = new Date();
            } else if (submittedDocuments > 0) {
                this.overallStatus = 'in_progress';
                await mongoose.model('Employee').updateOne(
                    { _id: this.employee },
                    { $set: { status: 'in_progress' } }
                );
            } else {
                this.overallStatus = 'pending';
                await mongoose.model('Employee').updateOne(
                    { _id: this.employee },
                    { $set: { status: 'pending' } }
                );
            }
        } else {
            this.verificationProgress = '0/0';
            this.overallStatus = 'pending';
            await mongoose.model('Employee').updateOne(
                { _id: this.employee },
                { $set: { status: 'pending' } }
            );
        }

        // FIX: Check if next exists before calling it
        if (typeof next === 'function') {
            next();
        }
    } catch (error) {
        console.error('Error in document pre-save hook:', error);
        // FIX: Check if next exists before calling it with error
        if (typeof next === 'function') {
            next(error);
        }
    }
});

// Indexes for better performance
documentSchema.index({ employee: 1 });
documentSchema.index({ employeeId: 1 });
documentSchema.index({ overallStatus: 1 });
documentSchema.index({ createdAt: -1 });

// Method to get document statistics
documentSchema.methods.getDocumentStats = function () {
    return {
        totalDocuments: this.totalDocuments,
        submittedDocuments: this.submittedDocuments,
        verifiedDocuments: this.verifiedDocuments,
        rejectedDocuments: this.rejectedDocuments,
        pendingDocuments: this.pendingDocuments,
        verificationProgress: this.verificationProgress,
        overallStatus: this.overallStatus
    };
};

export default mongoose.model("Document", documentSchema);