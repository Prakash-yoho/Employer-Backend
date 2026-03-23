import User from "../model/User.js";
import {
    registerValidation,
    loginValidation,
    updateUserValidation,
    changePasswordValidation
} from "../validations/userValidation.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import BlacklistedToken from '../model/BlacklistedToken.js'

// Generate JWT Token
const generateToken = (id, role, email) => {
    return jwt.sign({ userId: id, role, email }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "3d",
    });
};

// Hash password function
const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(12);
    return await bcrypt.hash(password, salt);
};

// Compare password function
const comparePassword = async (candidatePassword, hashedPassword) => {
    return await bcrypt.compare(candidatePassword, hashedPassword);
};

// Register User
export const registerUser = async (req, res) => {
    try {
        const { error } = registerValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { email, phoneNumber, password, role = 'candidate', ...userData } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ email }, { phoneNumber }]
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User with this email or phone number already exists"
            });
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user with hashed password
        const user = await User.create({
            email,
            phoneNumber,
            password: hashedPassword,
            role,
            ...userData
        });

        const token = generateToken(user?._id, user?.role, user?.email);

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            data: {
                user,
                token
            }
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Login User
export const loginUser = async (req, res) => {
    try {
        const { error } = loginValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { email, password, phoneNumber } = req.body;

        // Find user by email
        const user = await User.findOne({ $or: [{ email }, { phoneNumber }] });
        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or phoneNumber credentials"
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(400).json({
                success: false,
                message: "Account is deactivated. Please contact administrator."
            });
        }

        // Check password - using controller function
        const isPasswordValid = await comparePassword(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: "Invalid password credentials"
            });
        }

        const token = generateToken(user?._id, user?.role, user?.email);

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        res.status(200).json({
            success: true,
            message: "Login successful",
            data: {
                user,
                token
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// logout User
export const logoutUser = async (req, res) => {
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

        res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

// Get Current User Profile
export const getCurrentUser = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        res.status(200).json({
            success: true,
            message: "User profile retrieved successfully",
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Update User Profile
export const updateUserProfile = async (req, res) => {
    try {
        const { error } = updateUserValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        // Prevent role and email changes
        if (req.body.role || req.body.email) {
            return res.status(400).json({
                success: false,
                message: "Role and email cannot be updated"
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: req.body },
            { new: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Change Password
export const changePassword = async (req, res) => {
    try {
        const { error } = changePasswordValidation.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id);

        // Verify current password - using controller function
        const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({
                success: false,
                message: "Current password is incorrect"
            });
        }

        const hashedNewPassword = await hashPassword(newPassword);

        // Update password
        user.password = hashedNewPassword;
        await user.save();

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

// Get User by ID (Admin/HR only)
export const getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "User retrieved successfully",
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get All Users (Admin/HR only)
export const getAllUsers = async (req, res) => {
    try {
        const { role, search, page = 1, limit = 10 } = req.query;

        const filter = {};

        // Filter by role
        if (role) filter.role = role;

        // Search filter
        if (search) {
            filter.$or = [
                { fullName: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
                { phoneNumber: { $regex: search, $options: "i" } }
            ];
        }

        const users = await User.find(filter)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: "Users retrieved successfully",
            data: users,
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

// Get All Candidates (HR only)
export const getCandidates = async (req, res) => {
    try {
        const { search, skills, page = 1, limit = 10 } = req.query;

        const filter = { role: "candidate" };

        // Search filter
        if (search) {
            filter.$or = [
                { fullName: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
                { highestEducation: { $regex: search, $options: "i" } },
                { institution: { $regex: search, $options: "i" } }
            ];
        }

        // Skills filter
        if (skills) {
            const skillsArray = skills.split(",").map(skill => skill.trim());
            filter.keySkills = { $in: skillsArray };
        }

        const candidates = await User.find(filter)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: "Candidates retrieved successfully",
            data: candidates,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalCandidates: total,
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

// Deactivate User (Admin/HR only)
export const deactivateUser = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "User deactivated successfully",
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Activate User (Admin/HR only)
export const activateUser = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isActive: true },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "User activated successfully",
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Delete User (Admin/HR only)
export const deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "User deleted successfully"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};