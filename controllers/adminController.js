import AdminUser from "../model/AdminUser.js";
import User from "../model/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
    adminRegistrationValidation,
    adminLoginValidation,
    createHrValidation,
    adminUpdateValidation,
    changePasswordValidation
} from "../validations/adminValidation.js";
import mongoose from "mongoose";
import { sendMail } from "../utils/mailer.js";
import { newHrCreationEmailTemplate } from "../utils/emailTemplates.js";

// Initialize Admin (One-time setup)
export const initializeAdmin = async (req, res) => {
    try {

        // Check if request body exists
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Request body is required"
            });
        }

        // Check if admin already exists
        const existingAdmin = await AdminUser.findOne();
        if (existingAdmin) {
            return res.status(400).json({
                success: false,
                message: "Admin already exists. Only one admin is allowed."
            });
        }

        const { error } = adminRegistrationValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { fullName, email, password, companyInfo } = req.body;

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create admin
        const admin = await AdminUser.create({
            fullName,
            email: email.toLowerCase(),
            password: hashedPassword,
            companyInfo
        });

        // Generate JWT token
        const token = jwt.sign(
            {
                userId: admin._id,
                role: 'admin',
                email: admin.email
            },
            process.env.JWT_SECRET,
            { expiresIn: '3d' }
        );

        res.status(201).json({
            success: true,
            message: "Admin initialized successfully",
            data: {
                admin: {
                    _id: admin._id,
                    fullName: admin.fullName,
                    email: admin.email,
                    role: admin.role,
                    companyInfo: admin.companyInfo
                },
                token
            }
        });

    } catch (error) {

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Email already exists"
            });
        }

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Admin Login
export const adminLogin = async (req, res) => {
    try {
        const { error } = adminLoginValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { email, password } = req.body;

        // Check if admin exists
        const admin = await AdminUser.findOne({ email: email.toLowerCase() });
        if (!admin) {
            return res.status(400).json({
                success: false,
                message: "Invalid email credentials"
            });
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, admin.password);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: "Invalid password credentials"
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                userId: admin._id,
                role: 'admin',
                email: admin.email
            },
            process.env.JWT_SECRET,
            { expiresIn: '3d' }
        );

        res.status(200).json({
            success: true,
            message: "Admin login successful",
            data: {
                admin: {
                    _id: admin._id,
                    fullName: admin.fullName,
                    email: admin.email,
                    role: admin.role,
                    companyInfo: admin.companyInfo
                },
                token
            }
        });

    } catch (error) {
        console.error("Admin login error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Create HR User (Admin only)
export const createHr = async (req, res) => {
    try {
        const { error } = createHrValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { fullName, email, phoneNumber, password, designation } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [
                { email: email.toLowerCase() },
                { phoneNumber }
            ]
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User with this email or phone number already exists"
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create HR user
        const hrUser = await User.create({
            fullName,
            email: email.toLowerCase(),
            phoneNumber,
            password: hashedPassword,
            designation,
            role: 'hr',
            isVerified: true
        });

        setTimeout(async () => {
            await sendMail({
                to: email,
                subject: "Your HR Account has been created",
                html: newHrCreationEmailTemplate(hrUser, password)
            });
        }, 2000);

        res.status(201).json({
            success: true,
            message: "HR user created successfully",
            data: {
                user: {
                    _id: hrUser._id,
                    fullName: hrUser.fullName,
                    email: hrUser.email,
                    phoneNumber: hrUser.phoneNumber,
                    role: hrUser.role,
                    isVerified: hrUser.isVerified
                }
            }
        });

    } catch (error) {

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "User with this email already exists"
            });
        }

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get All HR Users (Admin only)
export const getAllHrUsers = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;

        const filter = {
            role: 'hr'
        };

        // Add search filter
        if (search) {
            filter.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const hrUsers = await User.find(filter)
            .select('-password')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await User.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: "HR users retrieved successfully",
            data: hrUsers,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalUsers: total,
                hasNext: page * limit < total,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get HR User by ID (Admin only)
export const getHrUserById = async (req, res) => {
    try {
        const hrUser = await User.findOne({
            _id: req.params.id,
            role: 'hr'
        }).select('-password');

        if (!hrUser) {
            return res.status(404).json({
                success: false,
                message: "HR user not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "HR user retrieved successfully",
            data: hrUser
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update HR User (Admin only)
export const updateHrUser = async (req, res) => {
    try {
        const { error } = createHrValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const hrUser = await User.findOne({
            _id: req.params.id,
            role: 'hr'
        });

        if (!hrUser) {
            return res.status(404).json({
                success: false,
                message: "HR user not found"
            });
        }

        const { fullName, email, phoneNumber, password } = req.body;

        // Check for duplicate email or phone (excluding current user)
        const existingUser = await User.findOne({
            _id: { $ne: req.params.id },
            $or: [
                { email: email.toLowerCase() },
                { phoneNumber }
            ]
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User with this email or phone number already exists"
            });
        }

        // Update fields
        hrUser.fullName = fullName;
        hrUser.email = email.toLowerCase();
        hrUser.phoneNumber = phoneNumber;

        // Update password if provided
        if (password) {
            const salt = await bcrypt.genSalt(10);
            hrUser.password = await bcrypt.hash(password, salt);
        }

        await hrUser.save();

        res.status(200).json({
            success: true,
            message: "HR user updated successfully",
            data: {
                _id: hrUser._id,
                fullName: hrUser.fullName,
                email: hrUser.email,
                phoneNumber: hrUser.phoneNumber,
                role: hrUser.role
            }
        });

    } catch (error) {

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "User with this email already exists"
            });
        }

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Delete HR User (Admin only)
export const deleteHrUser = async (req, res) => {
    try {
        const hrUser = await User.findOneAndDelete({
            _id: req.params.id,
            role: 'hr'
        });

        if (!hrUser) {
            return res.status(404).json({
                success: false,
                message: "HR user not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "HR user deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get Admin Profile
export const getAdminProfile = async (req, res) => {
    try {
        const admin = await AdminUser.findById(req.user.userId);

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Admin not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Admin profile retrieved successfully",
            data: admin
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update Admin Profile
export const updateAdminProfile = async (req, res) => {
    try {
        const { error } = adminUpdateValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const admin = await AdminUser.findById(req.user.userId);

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Admin not found"
            });
        }

        // Update fields
        if (req.body.fullName) admin.fullName = req.body.fullName;
        if (req.body.email) admin.email = req.body.email;
        if (req.body.companyInfo) {
            admin.companyInfo = {
                ...admin.companyInfo,
                ...req.body.companyInfo
            };
        }

        await admin.save();

        res.status(200).json({
            success: true,
            message: "Admin profile updated successfully",
            data: admin
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Change Admin Password
export const changeAdminPassword = async (req, res) => {
    try {
        const { error } = changePasswordValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { currentPassword, newPassword } = req.body;

        const admin = await AdminUser.findById(req.user.userId);

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Admin not found"
            });
        }

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, admin.password);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        admin.password = await bcrypt.hash(newPassword, salt);

        await admin.save();

        res.status(200).json({
            success: true,
            message: "Password changed successfully"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get System Statistics (Admin only)
export const getSystemStatistics = async (req, res) => {
    try {
        const [
            totalCandidates,
            totalHrUsers,
            totalJobs,
            totalApplications,
            recentApplications
        ] = await Promise.all([
            // Total candidates
            User.countDocuments({ role: 'candidate' }),

            // Total HR users
            User.countDocuments({ role: 'hr' }),

            // Total jobs
            mongoose.model('Job').countDocuments(),

            // Total applications
            mongoose.model('Application').countDocuments(),

            // Recent applications (last 7 days)
            mongoose.model('Application')
                .find({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })
                .populate('job', 'title')
                .populate('user', 'fullName')
                .sort({ createdAt: -1 })
                .limit(10)
                .select('status createdAt')
        ]);

        res.status(200).json({
            success: true,
            message: "System statistics retrieved successfully",
            data: {
                totalCandidates,
                totalHrUsers,
                totalJobs,
                totalApplications,
                recentApplications
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};