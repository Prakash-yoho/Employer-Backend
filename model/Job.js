import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const jobSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        department: { type: String },
        location: { type: String, required: true },
        experienceRequired: { type: String, required: true },
        employmentType: { type: String, required: true },
        salaryRange: { type: String },
        jobDescription: { type: String, required: true },
        keyResponsibilities: { type: [String], required: true },
        qualifications: { type: [String], required: true },
        eligibility: { type: [String], required: true },
        terms: { type: String },
        vacancyCount: { type: Number, required: true, default: 1 },
        applicantsCount: { type: Number, default: 0 },
        workingMode: {
            type: String,
            enum: ["Remote", "Hybrid", "Onsite"],
            required: true
        },
        jobId: {
            type: String,
            default: () => uuidv4(),
            unique: true
        },
        isActive: {
            type: Boolean,
            default: true
        }

    },
    { timestamps: true }
);

const Job = mongoose.model("Job", jobSchema);
export default Job;
