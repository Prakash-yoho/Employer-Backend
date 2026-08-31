import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { createEmployerUserSchema, updateEmployerUserSchema } from '../validations/employerUserValidation.js';
import EmployerUser from '../model/EmployerUser.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import BlacklistedToken from '../model/BlacklistedToken.js';
import Joi from 'joi';
import { sendMail } from '../utils/mailer.js';
import { newAdminUserTemplate } from '../utils/emailTemplates.js';
import { recordLogin, recordLogout } from '../utils/loginActivity.js';

dotenv.config();

const generateAuthToken = (user) => {

    const token = jwt.sign(
        {
            _id: user._id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '3d' }
    );
    return token;
}

//create admin
export const createAdminEmployerUser = async (req, res) => {
    try {
        const { firstName, lastName, email, password, phoneNumber } = req.body;
        const existingAdmin = await EmployerUser.findOne({ role: 'EMPLOYER_ADMIN' });
        if (existingAdmin) {
            return res.status(400).json({ success: false, message: "Admin already exists. Only one admin is allowed." })
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const adminUser = new EmployerUser({
            firstName,
            lastName,
            email,
            password: hashedPassword,
            phoneNumber,
            role: 'EMPLOYER_ADMIN',
            isActive: true
        });

        await adminUser.save();
        res.status(201).json({
            success: true,
            message: 'Admin employer user created successfully',
            data: adminUser.toJSON()
        });
    } catch (error) {
        console.error('Error creating admin employer user:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Admin login
export const employerAdminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const adminUser = await EmployerUser.findOne({ email, role: 'EMPLOYER_ADMIN' });
        if (!adminUser) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
        const isMatch = await bcrypt.compare(password, adminUser.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
        // Generate JWT token
        const token = generateAuthToken(adminUser);

        await recordLogin(req, {
            userId: adminUser._id,
            userModel: 'EmployerUser',
            role: adminUser.role,
            name: `${adminUser.firstName} ${adminUser.lastName}`.trim(),
            email: adminUser.email,
            token,
        });

        return res.status(200).json({
            success: true,
            message: 'Admin logged in successfully',
            data: {
                token,
                user: adminUser.toJSON()
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// ── PROJECT MANAGER LOGIN ──────────────────────────────────────────────────────
// POST /api/employer/auth/pm/login
export const projectManagerLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required",
            });
        }

        // Find user — must exist AND be a PROJECT_MANAGER
        const user = await EmployerUser.findOne({ email, role: "PROJECT_MANAGER" });
        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "Your account has been deactivated. Contact admin.",
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        const token = generateAuthToken(user);

        await recordLogin(req, {
            userId: user._id,
            userModel: 'EmployerUser',
            role: user.role,
            name: `${user.firstName} ${user.lastName}`.trim(),
            email: user.email,
            token,
        });

        return res.status(200).json({
            success: true,
            message: "Project Manager logged in successfully",
            data: {
                token,
                user: user.toJSON(),
            },
        });
    } catch (error) {
        console.error("projectManagerLogin:", error);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

//Employer User login
export const employerUserLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const employerUser = await EmployerUser.findOne({ email });
        if (!employerUser) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
        if (employerUser?.isActive === false) res.status(403).json({success:false, message:"Access Denied - Inactive Profile contact admin"})

        if (employerUser?.role.includes("EMPLOYER_ADMIN")) res.status(403).json({ success: false, message: "Access denied. Employer HR access only." })

        const isMatch = await bcrypt.compare(password, employerUser.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Generate JWT token
        const token = generateAuthToken(employerUser);

        await recordLogin(req, {
            userId: employerUser._id,
            userModel: 'EmployerUser',
            role: employerUser.role,
            name: `${employerUser.firstName} ${employerUser.lastName}`.trim(),
            email: employerUser.email,
            token,
        });

        return res.status(200).json({
            success: true,
            message: 'Employer user logged in successfully',
            data: {
                token,
                user: employerUser.toJSON()
            }
        });
    }
    catch (error) {
        console.error('Employer user login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// Employer Logout
export const employerUserLogout = async (req, res) => {
    try {

        const token = req.header("Authorization")?.replace("Bearer ", "");

        if (!token) return res.status(400).json({ message: "Token missing" });

        const decoded = jwt.decode(token);

        const alreadyBlacklisted = await BlacklistedToken.findOne({ token });
        if (alreadyBlacklisted) {
            return res.status(400).json({
                success: false,
                message: "Token already blacklisted"
            });
        }

        await BlacklistedToken.create({
            token,
            expiresAt: new Date(decoded.exp * 1000)
        });

        // Close out this login session (for admin login-activity monitoring)
        await recordLogout(token, decoded);

        return res.status(200).json({
            success: true,
            message: 'Employer user logged out successfully'
        });
    }
    catch (error) {
        console.error('Employer user logout error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

// Helper to get a human-readable role label for email subjects
const getRoleLabel = (role) => {
    const roleLabels = {
        EMPLOYER_HR: 'HR',
        EMPLOYER_IT: 'IT Support',
        PROJECT_MANAGER: 'Project Manager'
    };
    return roleLabels[role] || role;
};

// Create a new employer user (Admin creation is restricted)
export const createEmployerUser = async (req, res) => {
    try {
        // Validate request body
        const { error, value } = createEmployerUserSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Check if email already exists
        const existingUser = await EmployerUser.findOne({ email: value?.email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        // Check if trying to create ADMIN role (not allowed)
        if (value?.role === 'EMPLOYER_ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Cannot create ADMIN user'
            });
        }

        // Validate role is one of the allowed types
        const allowedRoles = ['EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER'];
        if (!allowedRoles.includes(value?.role)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Allowed roles: EMPLOYER_HR, EMPLOYER_IT, PROJECT_MANAGER'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(value?.password, salt);

        // Create new employer user
        const employerUser = new EmployerUser({
            ...value,
            password: hashedPassword
        });

        await employerUser.save();

        setTimeout(async () => {
            await sendMail({
                to: employerUser.email,
                subject: `${getRoleLabel(employerUser?.role)} Account - ${process.env.COMPANY_NAME}`,
                html: newAdminUserTemplate(
                    employerUser,
                    value.password,
                    employerUser?.role
                )
            });
        }, 2000);

        // Return user without password
        const userResponse = employerUser.toJSON();

        return res.status(201).json({
            success: true,
            message: 'Employer user created successfully',
            data: userResponse
        });
    } catch (error) {
        console.error('Create employer user error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

//Get all employer users with pagination and filtering
export const getAllEmployerUsers = async (req, res) => {
    try {
        const {
            isActive = true,
            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query;

        // Build filter query
        const filter = {};
        const userRole = req.user.role;

        // HR, IT & PROJECT_MANAGER can see only HR, IT & PROJECT_MANAGER (not ADMIN)
        if (userRole !== "EMPLOYER_ADMIN") {
            filter.role = { $in: ["EMPLOYER_HR", "EMPLOYER_IT", "PROJECT_MANAGER"] };
        }

        if (isActive !== undefined) {
            filter.isActive = isActive === true || isActive === "true";
        }

        // Build sort object
        const sort = {};
        const validSortFields = [
            "firstName",
            "lastName",
            "email",
            "role",
            "createdAt",
            "updatedAt",
        ];

        if (validSortFields.includes(sortBy)) {
            sort[sortBy] = sortOrder === "desc" ? -1 : 1;
        } else {
            sort.createdAt = -1;
        }

        // Execute query (NO pagination)
        const employerUsers = await EmployerUser.find(filter)
            .select("-password")
            .sort(sort);

        return res.status(200).json({
            success: true,
            message: "Employer users retrieved successfully",
            data: {
                employerUsers,
            },
        });
    } catch (error) {
        console.error("Get all employer users error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error:
                process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


//Get employer user by ID
export const getEmployerUserById = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employer user ID format'
            });
        }

        // Find employer user
        const employerUser = await EmployerUser.findById(id).select('-password');

        if (!employerUser) {
            return res.status(404).json({
                success: false,
                message: 'Employer user not found'
            });
        }

        // Check permissions
        const userRole = req.user.role;

        // HR, IT and PROJECT_MANAGER cannot view ADMIN users (except themselves)
        if (userRole !== 'EMPLOYER_ADMIN' && employerUser.role === 'EMPLOYER_ADMIN') {
            // Allow users to view their own profile
            if (employerUser._id.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to view this user'
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Employer user retrieved successfully',
            data: employerUser
        });
    } catch (error) {
        console.error('Get employer user by ID error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

//Update employer user
export const updateEmployerUser = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employer user ID format'
            });
        }

        // Validate request body
        const { error, value } = updateEmployerUserSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Check if employer user exists
        const employerUser = await EmployerUser.findById(id);
        if (!employerUser) {
            return res.status(404).json({
                success: false,
                message: 'Employer user not found'
            });
        }

        // Prevent updating ADMIN user's role (only one ADMIN allowed)
        if (employerUser.role === 'EMPLOYER_ADMIN') {
            if (value?.role && value?.role !== 'EMPLOYER_ADMIN') {
                return res.status(403).json({
                    success: false,
                    message: 'Cannot change ADMIN user role'
                });
            }
        }

        // Check if email is being updated and if it already exists
        if (value?.email && value?.email !== employerUser.email) {
            const existingUser = await EmployerUser.findOne({ email: value.email });
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already exists'
                });
            }
        }

        // Hash password if being updated
        if (value?.password) {
            const salt = await bcrypt.genSalt(10);
            value.password = await bcrypt.hash(value.password, salt);
        }

        // Update employer user
        const updatedEmployerUser = await EmployerUser.findByIdAndUpdate(
            id,
            { $set: value },
            { new: true, runValidators: true }
        ).select('-password');

        return res.status(200).json({
            success: true,
            message: 'Employer user updated successfully',
            data: updatedEmployerUser
        });
    } catch (error) {
        console.error('Update employer user error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete employer user (soft delete by setting isActive to false)
export const softDeleteEmployerUser = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employer user ID format'
            });
        }

        // Check if employer user exists
        const employerUser = await EmployerUser.findById(id);
        if (!employerUser) {
            return res.status(404).json({
                success: false,
                message: 'Employer user not found'
            });
        }

        // Prevent deleting ADMIN user
        if (employerUser.role === 'EMPLOYER_ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete ADMIN user'
            });
        }

        // Soft delete - set isActive to false
        employerUser.isActive = false;
        await employerUser.save();

        return res.status(200).json({
            success: true,
            message: 'Employer user deactivated successfully',
            data: { id }
        });
    } catch (error) {
        console.error('Delete employer user error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Hard delete employer user (permanently remove from database)
export const hardDeleteEmployerUser = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employer user ID format'
            });
        }

        // Check if employer user exists
        const employerUser = await EmployerUser.findById(id);
        if (!employerUser) {
            return res.status(404).json({
                success: false,
                message: 'Employer user not found'
            });
        }

        // Prevent deleting ADMIN user
        if (employerUser.role === 'EMPLOYER_ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete ADMIN user'
            });
        }

        // Hard delete - permanently remove from database
        await EmployerUser.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: 'Employer user permanently deleted',
            data: { id }
        });
    } catch (error) {
        console.error('Hard delete employer user error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Reactivate employer user
export const reactivateEmployerUser = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employer user ID format'
            });
        }

        // Check if employer user exists
        const employerUser = await EmployerUser.findById(id);
        if (!employerUser) {
            return res.status(404).json({
                success: false,
                message: 'Employer user not found'
            });
        }

        // Prevent reactivating ADMIN user if not ADMIN
        if (employerUser.role === 'EMPLOYER_ADMIN' && req.user.role !== 'EMPLOYER_ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Cannot reactivate ADMIN user'
            });
        }

        // Reactivate user
        employerUser.isActive = true;
        await employerUser.save();

        const userResponse = employerUser.toJSON();

        return res.status(200).json({
            success: true,
            message: 'Employer user reactivated successfully',
            data: userResponse
        });
    } catch (error) {
        console.error('Reactivate employer user error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get current logged-in user profile
export const getMyProfile = async (req, res) => {
    try {
        const user = await EmployerUser.findById(req.user._id).select('-password');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Profile retrieved successfully',
            data: user
        });
    } catch (error) {
        console.error('Get profile error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update current logged-in user profile
export const updateMyProfile = async (req, res) => {
    try {
        // Validate request body (only allowed fields for self-update)
        const updateSchema = {
            firstName: updateEmployerUserSchema.extract('firstName'),
            lastName: updateEmployerUserSchema.extract('lastName'),
            password: updateEmployerUserSchema.extract('password')
        };

        const { error, value } = Joi.object(updateSchema).validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Get current user
        const user = await EmployerUser.findById(req.user._id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Hash password if being updated
        if (value?.password) {
            const salt = await bcrypt.genSalt(10);
            value.password = await bcrypt.hash(value.password, salt);
        }

        // Update user
        const updatedUser = await EmployerUser.findByIdAndUpdate(
            req.user._id,
            { $set: value },
            { new: true, runValidators: true }
        ).select('-password');

        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: updatedUser
        });
    } catch (error) {
        console.error('Update profile error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};