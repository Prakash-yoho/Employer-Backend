import mongoose from "mongoose";

const applicationSchema = new mongoose.Schema(
    {
        job: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Job",
            required: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        status: {
            type: String,
            enum: [
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
            ],
            default: "applied"
        },
        interviewDetails: {
            date: Date,
            time: String,
            mode: {
                type: String,
                enum: ["online", "offline"]
            },
            venue: String,
            meetingLink: String,
            instructions: String,
            rescheduleHistory: [{
                previousDate: Date,
                previousTime: String,
                previousMode: String,
                previousVenue: String,
                previousMeetingLink: String,
                rescheduledBy: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User"
                },
                rescheduledAt: {
                    type: Date,
                    default: Date.now
                },
                reason: String
            }]
        },
        offerDetails: {
            sentDate: Date,
            offerLetter: String,
            salary: Number,
            joiningDate: Date,
            terms: String,
            offerRef: String,
            rejectionReason: {
                type: String,
                default: ""
            }
        },
        documents: [{
            documentType: {
                type: String,
                enum: [
                    "10th_certificate",
                    "11th_certificate",
                    "12th_certificate",
                    "ug_degree",
                    "pg_degree",
                    "provisional_certificate",
                    "consolidate_marksheet",
                    "aadhar_card",
                    "pan_card",
                    "experience_certificate",
                    "relieving_letter",
                    "bank_statement_3_months",
                    "passport_size_photo",
                    "resume",
                    "other"
                ]
            },
            name: String,
            file: String,
            status: {
                type: String,
                enum: ["pending", "approved", "rejected"],
                default: "pending"
            },
            rejectionReason: String,
            uploadedAt: {
                type: Date,
                default: Date.now
            },
            verifiedAt: Date,
            verifiedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            },
            isRequired: {
                type: Boolean,
                default: true
            }
        }],
        rejectionReason: {
            type: String,
            default: ""
        },
        additionalDocuments: [{
            name: String,
            file: String,
            fileSize: Number
        }],
        isActive: {
            type: Boolean,
            default: true
        },
    },
    {
        timestamps: true
    }
);

// Index for better query performance
applicationSchema.index({ user: 1, job: 1 }, { unique: true });
applicationSchema.index({ status: 1 });
applicationSchema.index({ job: 1, status: 1 });
applicationSchema.index({ "interviewDetails.date": 1 });

export default mongoose.model("Application", applicationSchema);