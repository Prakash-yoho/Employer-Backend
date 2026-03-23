import Job from "../model/Job.js";
import User from "../model/User.js";
import { jobValidation } from "../validations/jobValidation.js";

// Create Job
export const createJob = async (req, res) => {
    try {
        const { error } = jobValidation.validate(req.body);
        if (error) return res.status(400).json({ success: false, message: error.details[0].message });

        const job = await Job.create({ ...req.body });

        res.status(201).json({ success: true, message: "Job posted successfully", data: job });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Get all jobs
export const getJobs = async (req, res) => {
    try {
        const jobs = await Job.find().sort({ createdAt: -1 });
        const candidates = await User.countDocuments({ role: "candidate", isActive: true })
        res.status(200).json({ success: true, message: "Jobs retrieved successfully", data: jobs, count: jobs.length, totalCandidates: candidates });
    } catch (err) {
        res.status(500).json({ succes: false, message: err.message });
    }
};

// Get single job
export const getJobById = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ succes: false, message: "Job not found" });
        res.status(200).json({ success: true, message: "Job retrieved successfully", data: job });
    } catch (err) {
        res.status(500).json({ succes: false, message: err.message });
    }
};

// Update Job
export const updateJob = async (req, res) => {
    try {
        const { id } = req.params;

        const updatedJob = await Job.findByIdAndUpdate(id, req.body, { new: true });

        if (!updatedJob) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }

        res.status(200).json({ success: true, message: "Job updated successfully", data: updatedJob });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Delete Job
export const deleteJob = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedJob = await Job.findByIdAndDelete(id);

        if (!deletedJob) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }

        res.status(200).json({ success: true, message: "Job deleted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Update Job Status (Activate / Deactivate)
export const updateJobStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (typeof isActive !== "boolean") {
            return res.status(400).json({ success: false, message: "isActive must be true or false" });
        }

        const job = await Job.findByIdAndUpdate(
            id,
            { isActive },
            { new: true }
        );

        if (!job) {
            return res.status(404).json({ success: false, message: "Job not found" });
        }

        res.status(200).json({
            success: true,
            message: `Job ${isActive ? "activated" : "deactivated"} successfully`,
            data: job
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

