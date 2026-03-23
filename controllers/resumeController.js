import User from "../model/User.js";
import { saveResumeInS3 } from "../utils/saveOfferLetterInS3.js";
import { resumeValidation } from "../validations/userValidation.js";
import mime from "mime-types";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "../config/s3.js";
import { pipeline } from "stream";
import { promisify } from "util";

// Upload Resume
export const uploadResume = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        const userId = req.user._id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Upload to S3
        const resumeUrl = await saveResumeInS3(
            req.file.buffer,
            userId,
            req.file.mimetype
        );

        // Save metadata in DB
        user.resume = {
            url: resumeUrl,
            originalName: req.file.originalname,
            contentType: req.file.mimetype,
            fileSize: req.file.size,
            uploadedAt: new Date()
        };

        await user.save();

        res.status(200).json({
            success: true,
            message: "Resume uploaded successfully",
            resume: user.resume
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error uploading resume",
            error: error.message
        });
    }
};

// Get Resume
export const getResume = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId).select('resume');

        if (!user || !user.resume.data) {
            return res.status(404).json({
                success: false,
                message: "Resume not found"
            });
        }

        // Return resume data
        res.status(200).json({
            success: true,
            resume: {
                data: user.resume.data,
                contentType: user.resume.contentType,
                originalName: user.resume.originalName,
                fileSize: user.resume.fileSize,
                uploadedAt: user.resume.uploadedAt
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching resume",
            error: error.message
        });
    }
};

const streamPipeline = promisify(pipeline);

// Download Resume
export const downloadResume = async (req, res) => {
    try {
        const userId = req.params.id;

        const user = await User.findById(userId).select("resume");

        if (!user || !user.resume.url) {
            return res.status(404).json({
                success: false,
                message: "Resume not found"
            });
        }

        // Extract S3 key from URL
        const key = user.resume.url.split(".amazonaws.com/")[1];

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "Invalid S3 resume URL"
            });
        }

        // Prepare S3 command
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key
        });

        const file = await s3.send(command);

        // Set headers
        res.setHeader("Content-Type", user.resume.contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${user.resume.originalName}"`);
        res.setHeader("Content-Length", user.resume.fileSize);

        // Stream to client
        await streamPipeline(file.Body, res);

    } catch (error) {
        console.error("Download resume error:", error);
        res.status(500).json({
            success: false,
            message: "Error downloading resume",
            error: error.message
        });
    }
};

// Preview Resume
export const previewResume = async (req, res) => {
    try {
        const userId = req.user._id;

        const user = await User.findById(userId).select("resume");

        if (!user || !user.resume.url) {
            return res.status(404).json({
                success: false,
                message: "Resume not found"
            });
        }

        // Extract S3 key
        const key = user.resume.url.split(".amazonaws.com/")[1];

        if (!key) {
            return res.status(400).json({
                success: false,
                message: "Invalid resume URL stored"
            });
        }

        // Get file from S3
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key
        });

        const file = await s3.send(command);

        // Set preview headers
        res.setHeader("Content-Type", user.resume.contentType);
        res.setHeader("Content-Disposition", `inline; filename="${user.resume.originalName}"`);
        res.setHeader("Content-Length", user.resume.fileSize);

        // Stream file to browser
        await streamPipeline(file.Body, res);

    } catch (error) {
        console.error("Preview resume error:", error);
        res.status(500).json({
            success: false,
            message: "Error previewing resume",
            error: error.message
        });
    }
};

// Delete Resume
export const deleteResume = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        await user.removeResume();

        res.status(200).json({
            success: true,
            message: "Resume deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error deleting resume",
            error: error.message
        });
    }
};