import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createEmployeeSchema, employeeChangePasswordSchema, employeeLoginSchema, employeeUpdateRequestSchema, updateEmployeeByAdminSchema, updateEmployeeProfileSchema } from '../validations/employeeValidation.js';
import Employee from '../model/Employee.js';
import BlacklistedToken from '../model/BlacklistedToken.js';
import { deleteImageFromS3, uploadImageToS3 } from '../utils/saveOfferLetterInS3.js';
import NotificationService from '../services/notificationService.js';
import EmployerUser from '../model/EmployerUser.js';
import Notification from '../model/Notification.js';
import { sendAppointmentEmail, sendMail } from '../utils/mailer.js';
import { newEmployeeTemplate } from '../utils/emailTemplates.js';
import { generateAppointmentLetter } from '../services/appointmentLetterService.js';
import { saveAppointmentLetterInS3 } from '../utils/saveAppointmentLetterInS3.js';



// ✅ must match the filename on disk exactly
import { generateRelievingLetter }      from '../services/Relievingletterservice.js';
import { generateExperienceCertificate } from '../services/Experiencecertificateservice.js';
import { s3, S3_BUCKET } from '../config/s3.js';           // ← same import as saveAppointmentLetterInS3.js
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SendMailJet } from '../utils/mailer.js';         // ← your Mailjet sender
import {
    relievingLetterEmailTemplate,
    experienceCertificateEmailTemplate,
} from '../utils/emailTemplates.js';                                      // ← step 3 templates
import { saveExperienceCertificateInS3 } from '../utils/Saveexperiencecertificateins3.js';
import { saveRelievingLetterInS3 } from '../utils/Saverelievingletterins3.js';

dotenv.config();


const getSignedS3Url = async (storedUrl) => {
    const key = storedUrl.includes('.amazonaws.com/')
        ? decodeURIComponent(storedUrl.split('.amazonaws.com/')[1].split('?')[0])
        : storedUrl;
    const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    return getSignedUrl(s3, cmd, { expiresIn: 900 });
};






// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a Date object → "07-July-2025"
 */
const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    }).replace(/ /g, '-');
};

/**
 * Format a Date object → "09th April 2026"
 */
const ordinalDate = (date) => {
    const d = new Date(date);
    const day = d.getDate();
    const suffix = (day % 10 === 1 && day !== 11) ? 'st'
        : (day % 10 === 2 && day !== 12) ? 'nd'
            : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        .replace(/^\d+/, `${day}${suffix}`);
};

/**
 * Builds the data object fed into PDF generators
 */
const buildEmployeeData = (employee) => ({
    fullName: `${employee.firstName} ${employee.lastName}`,
    employeeId: employee.employeeId,
    designation: employee.designation || '—',
    department: employee.department || '—',
    joiningDate: formatDate(employee.createdAt),
    leavingDate: formatDate(employee.relievingDate || employee.updatedAt),
    resignationDate: formatDate(employee.resignationDate || employee.updatedAt),
    letterDate: ordinalDate(new Date()),
    refNo: employee.employeeId,
    hrName: process.env.HR_NAME || 'Hazeena Begum A',
    hrTitle: process.env.HR_TITLE || 'SR Executive - Human Resource',
});









// Generate JWT token
const generateAuthToken = (user) => {

    const token = jwt.sign(
        {
            _id: user._id,
            email: user.officialEmail,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '3d' }
    );
    return token;
}

// Create a new employee (ADMIN/HR only)
export const createEmployee = async (req, res) => {
    try {
        // Check if user has permission (ADMIN or HR)
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can create employees'
            });
        }

        // Validate request body
        const { error, value } = createEmployeeSchema.validate(req.body);

        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Check if employee ID already exists
        const existingEmployeeId = await Employee.findOne({ employeeId: value?.employeeId });
        if (existingEmployeeId) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID already exists'
            });
        }

        // Check if official email already exists
        const existingOfficialEmail = await Employee.findOne({ officialEmail: value?.officialEmail });
        if (existingOfficialEmail) {
            return res.status(400).json({
                success: false,
                message: 'Official email already exists'
            });
        }

        // Check if personal email already exists (if provided)
        if (value?.personalEmail) {
            const existingPersonalEmail = await Employee.findOne({ personalEmail: value?.personalEmail });
            if (existingPersonalEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'Personal email already exists'
                });
            }
        }

        // Hash official password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(value?.officialPassword, salt);

        // Create new employee
        const employee = new Employee({
            ...value,
            officialPassword: hashedPassword,
            // Additional fields to track creation
            createdBy: {
                userId: req.user._id,
                userEmail: req.user.email,
                role: req.user.role
            },
            // Default values
            role: 'Employee',
            isActive: true
        });

        await employee.save();

        setTimeout(async () => {
            await sendMail({
                to: employee.personalEmail,
                subject: `Welcome to ${process.env.COMPANY_NAME} - Employee Portal Access`,
                html: newEmployeeTemplate(employee, value?.officialPassword)
            });
        }, 2000);

        // After successful employee creation, create notification
        await NotificationService.createEmployeeCreatedNotification(employee, req.user);

        // Also notify all HR/Admin users
        const hrAdmins = await EmployerUser.find({
            role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
            _id: { $ne: req.user._id },
            isActive: true
        });

        for (const admin of hrAdmins) {
            await Notification.createNotification({
                title: 'New Employee Added',
                description: `${req.user.firstName} ${req.user.lastName} added new employee ${employee.firstName} ${employee.lastName}`,
                type: 'EMPLOYEE_CREATED',
                recipientType: admin.role,
                recipientId: admin._id,
                recipientModel: 'EmployerUser',
                senderId: req.user._id,
                senderModel: 'EmployerUser',
                relatedEntityType: 'Employee',
                relatedEntityId: employee._id,
                metadata: {
                    employeeId: employee.employeeId,
                    createdBy: req.user.email
                }
            });
        }

        // Return employee without password
        const employeeResponse = employee.toJSON();

        return res.status(201).json({
            success: true,
            message: 'Employee created successfully',
            data: employeeResponse
        });
    } catch (error) {
        console.error('Create employee error:', error?.message);

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Employee login
export const employeeLogin = async (req, res) => {
    try {
        // Validate request body
        const { error, value } = employeeLoginSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { officialEmail, officialPassword } = value;

        // Check if employee exists
        const employee = await Employee.findOne({ officialEmail });
        if (!employee) {
            return res.status(400).json({
                success: false,
                message: 'Invalid credentials , check your Email/password'
            });
        }

        // Check if employee is active
        if (!employee.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Your account has been deactivated. Please contact HR/Admin.'
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(officialPassword, employee.officialPassword);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid credentials Please try again'
            });
        }

        // Generate tokens
        const token = generateAuthToken(employee);

        await employee.save();

        // Return employee without password
        const employeeResponse = employee.toJSON();

        // Prepare response data
        const responseData = {
            employee: employeeResponse,
            token
        };

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            data: responseData
        });
    } catch (error) {
        console.error('Employee login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get employee profile
export const getEmployeeProfile = async (req, res) => {
    try {
        const employee = await Employee.findById(req.user._id).select('-officialPassword -createdBy');

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Profile retrieved successfully',
            data: employee
        });
    } catch (error) {
        console.error('Get employee profile error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update employee profile
export const updateEmployeeProfile = async (req, res) => {
    try {

        // Check if profile is already updated
        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Check if profile is already updated
        if (employee.isUpdated) {
            return res.status(403).json({
                success: false,
                message: 'Profile already updated. Please request HR/Admin for changes.'
            });
        }

        // Validate request body
        const { error, value } = updateEmployeeProfileSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Check if trying to update restricted fields
        const restrictedFields = ['employeeId', 'officialEmail', 'role', 'createdBy', 'designation', 'department', 'isActive'];
        const restrictedUpdate = Object.keys(value).some(field => restrictedFields.includes(field));

        if (restrictedUpdate) {
            return res.status(403).json({
                success: false,
                message: 'Cannot update restricted fields'
            });
        }

        // Check for unique field conflicts
        if (value?.personalEmail && value?.personalEmail !== employee.personalEmail) {
            const existingEmail = await Employee.findOne({ personalEmail: value?.personalEmail });
            if (existingEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'Personal email already exists'
                });
            }
        }

        if (value?.aadhaarNumber && value?.aadhaarNumber !== employee.aadhaarNumber) {
            const existingAadhaar = await Employee.findOne({ aadhaarNumber: value?.aadhaarNumber });
            if (existingAadhaar) {
                return res.status(400).json({
                    success: false,
                    message: 'Aadhaar number already exists'
                });
            }
        }

        if (value?.panNumber && value?.panNumber !== employee.panNumber) {
            const existingPAN = await Employee.findOne({ panNumber: value?.panNumber });
            if (existingPAN) {
                return res.status(400).json({
                    success: false,
                    message: 'PAN number already exists'
                });
            }
        }

        if (value?.drivingLicenseNumber && value?.drivingLicenseNumber !== employee.drivingLicenseNumber) {
            const existingDL = await Employee.findOne({ drivingLicenseNumber: value?.drivingLicenseNumber });
            if (existingDL) {
                return res.status(400).json({
                    success: false,
                    message: 'Driving license number already exists'
                });
            }
        }

        // Update employee with isUpdated flag
        const updateData = {
            ...value,
            isUpdated: true,
            status: "in_progress",
            lastUpdatedAt: new Date()
        };

        // Update employee
        const updatedEmployee = await Employee.findByIdAndUpdate(
            req.user._id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-officialPassword');

        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: updatedEmployee
        });
    } catch (error) {
        console.error('Update employee profile error:', error);

        // Handle duplicate key errors
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Change employee password
export const changeEmployeePassword = async (req, res) => {
    try {
        // Validate request body
        const { error, value } = employeeChangePasswordSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { currentPassword, newPassword } = value;

        // Get employee with password
        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, employee.officialPassword);
        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        employee.officialPassword = hashedPassword;
        await employee.save();

        return res.status(200).json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('Change employee password error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Employee logout
export const employeeLogout = async (req, res) => {
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

        return res.status(200).json({
            success: true,
            message: 'Logout successful'
        });

    } catch (error) {
        console.error('Employee logout error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all employees (ADMIN/HR only)
export const getAllEmployees = async (req, res) => {
    try {
        // Check if user has permission (ADMIN or HR)
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can view all employees'
            });
        }

        const {
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Build filter query
        const filter = {};

        // Build sort object
        const sort = {};
        const validSortFields = ['firstName', 'lastName', 'employeeId', 'officialEmail', 'createdAt', 'updatedAt'];
        if (validSortFields.includes(sortBy)) {
            sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
        } else {
            sort.createdAt = -1;
        }

        // Execute query with pagination
        const [employees, total] = await Promise.all([
            Employee.find(filter)
                .select('-officialPassword')
                .sort(sort)
                .skip(skip)
                .limit(limitNum),
            Employee.countDocuments(filter)
        ]);

        const totalPages = Math.ceil(total / limitNum);

        return res.status(200).json({
            success: true,
            message: 'Employees retrieved successfully',
            data: {
                employees,
                pagination: {
                    currentPage: pageNum,
                    totalPages,
                    totalItems: total,
                    itemsPerPage: limitNum,
                    hasNextPage: pageNum < totalPages,
                    hasPrevPage: pageNum > 1
                }
            }
        });
    } catch (error) {
        console.error('Get all employees error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get employee by ID (ADMIN/HR only)
export const getEmployeeById = async (req, res) => {
    try {
        // Check if user has permission (ADMIN or HR)
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can view employee details'
            });
        }

        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employee ID format'
            });
        }

        const employee = await Employee.findById(id).select('-officialPassword');

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Employee retrieved successfully',
            data: employee
        });
    } catch (error) {
        console.error('Get employee by ID error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update employee status (ADMIN/HR only)
export const updateEmployeeStatus = async (req, res) => {
    try {
        // Check if user has permission (ADMIN or HR)
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can update employee status'
            });
        }

        const { id } = req.params;
        const { isActive } = req.body;

        if (typeof isActive !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'isActive must be a boolean value'
            });
        }

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employee ID format'
            });
        }

        const employee = await Employee.findById(id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Update status
        employee.isActive = isActive;
        employee.updateRequested = false;
        employee.updateRequestReason = undefined;
        employee.lastUpdatedAt = new Date();

        await employee.save();


        const employeeResponse = employee.toJSON();

        return res.status(200).json({
            success: true,
            message: `Employee ${isActive ? 'activated' : 'deactivated'} successfully`,
            data: employeeResponse
        });

    } catch (error) {
        console.error('Update employee status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Request profile update (for employees who already updated)
export const requestProfileUpdate = async (req, res) => {
    try {
        // Validate request body
        const { error, value } = employeeUpdateRequestSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { updateRequestReason } = value;

        // Check if employee exists
        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Check if profile is already updated
        if (!employee.isUpdated) {
            return res.status(400).json({
                success: false,
                message: 'Profile not yet updated. You can directly update your profile.'
            });
        }

        // Check if update already requested
        if (employee.updateRequested) {
            return res.status(400).json({
                success: false,
                message: 'Update request already submitted. Please wait for HR/Admin to process.'
            });
        }

        // Create update request
        employee.updateRequested = true;
        employee.updateRequestReason = updateRequestReason;
        employee.lastUpdatedAt = new Date();

        await employee.save();

        // Notify all HR/Admin users about update request
        const hrAdmins = await EmployerUser.find({
            role: { $in: ['EMPLOYER_HR', 'EMPLOYER_ADMIN'] },
            isActive: true
        });

        await NotificationService.createEmployeeUpdateRequestNotification(
            employee,
            hrAdmins
        );

        const employeeResponse = employee.toJSON();

        return res.status(200).json({
            success: true,
            message: 'Update request submitted successfully. HR/Admin will review your request.',
            data: employeeResponse
        });
    } catch (error) {
        console.error('Request profile update error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Cancel update request
export const cancelUpdateRequest = async (req, res) => {
    try {
        // Check if employee exists
        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Check if update is requested
        if (!employee.updateRequested) {
            return res.status(400).json({
                success: false,
                message: 'No update request found'
            });
        }

        // Cancel update request
        employee.updateRequested = false;
        employee.updateRequestReason = undefined;

        await employee.save();

        const employeeResponse = employee.toJSON();

        return res.status(200).json({
            success: true,
            message: 'Update request cancelled successfully',
            data: employeeResponse
        });
    } catch (error) {
        console.error('Cancel update request error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update employee by HR/Admin (can update even if isUpdated is true)
export const updateEmployeeByAdmin = async (req, res) => {
    try {
        // Role check
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can update employee details'
            });
        }

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employee ID format'
            });
        }

        // Validate body
        const { error, value } = updateEmployeeByAdminSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(d => d.message)
            });
        }

        const employee = await Employee.findById(id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        const hadUpdateRequest = employee.updateRequested;

        // ✅ UNIQUE CHECKS (BEFORE UPDATE)
        if (value.personalEmail && value.personalEmail !== employee.personalEmail) {
            const exists = await Employee.findOne({
                personalEmail: value.personalEmail,
                _id: { $ne: id }
            });
            if (exists) {
                return res.status(400).json({
                    success: false,
                    message: 'Personal email already exists'
                });
            }
        }

        if (value.aadhaarNumber && value.aadhaarNumber !== employee.aadhaarNumber) {
            const exists = await Employee.findOne({
                aadhaarNumber: value.aadhaarNumber,
                _id: { $ne: id }
            });
            if (exists) {
                return res.status(400).json({
                    success: false,
                    message: 'Aadhaar number already exists'
                });
            }
        }

        if (value.panNumber && value.panNumber !== employee.panNumber) {
            const exists = await Employee.findOne({
                panNumber: value.panNumber,
                _id: { $ne: id }
            });
            if (exists) {
                return res.status(400).json({
                    success: false,
                    message: 'PAN number already exists'
                });
            }
        }

        if (value.drivingLicenseNumber && value.drivingLicenseNumber !== employee.drivingLicenseNumber) {
            const exists = await Employee.findOne({
                drivingLicenseNumber: value.drivingLicenseNumber,
                _id: { $ne: id }
            });
            if (exists) {
                return res.status(400).json({
                    success: false,
                    message: 'Driving license number already exists'
                });
            }
        }

        // ✅ FINAL UPDATE DATA
        const updateData = {
            ...value,
            lastUpdatedBy: req.user._id,
            lastUpdatedAt: new Date(),
            updateRequested: false,
            updateRequestReason: undefined
        };

        const updatedEmployee = await Employee.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-officialPassword');

        if (hadUpdateRequest) {
            await NotificationService.createEmployeeUpdateApprovedNotification(
                updatedEmployee,
                req.user
            );
        }

        return res.status(200).json({
            success: true,
            message: 'Employee updated successfully',
            data: updatedEmployee
        });

    } catch (error) {
        console.error('Update employee by admin error:', error);

        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get employees with update requests
export const getEmployeesWithUpdateRequests = async (req, res) => {
    try {
        // Role check
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can view update requests',
            });
        }

        // Filter only update requested employees
        const filter = {
            updateRequested: true,
        };

        // Fetch ALL matching employees (no pagination)
        const employees = await Employee.find(filter)
            .select('-officialPassword')
            .sort({ lastUpdatedAt: -1 });

        return res.status(200).json({
            success: true,
            message: 'Update requests retrieved successfully',
            data: {
                employees, // only employees array now
            },
        });
    } catch (error) {
        console.error('Get employees with update requests error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};


// Reset employee profile update status (ADMIN/HR only)
export const resetEmployeeUpdateStatus = async (req, res) => {
    try {
        // Check if user has permission (ADMIN or HR)
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can reset update status'
            });
        }

        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employee ID format'
            });
        }

        // Check if employee exists
        const employee = await Employee.findById(id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Reset update status
        employee.isUpdated = false;
        employee.updateRequested = false;
        employee.updateRequestReason = undefined;
        employee.lastUpdatedBy = req.user._id;
        employee.lastUpdatedAt = new Date();
        await employee.save();

        // Send notification to employee
        await NotificationService.createEmployeeUpdateStatusResetNotification(
            employee,
            req.user
        );

        const employeeResponse = employee.toJSON();

        return res.status(200).json({
            success: true,
            message: 'Employee update status reset successfully. Employee can now update their profile again.',
            data: employeeResponse
        });
    } catch (error) {
        console.error('Reset employee update status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Upload/Update profile image
export const uploadEmployeeImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Please upload an image file'
            });
        }

        const employee = await Employee.findById(req.user._id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Delete old image if exists
        if (employee.profileImageKey) {
            try {
                await deleteImageFromS3(employee.profileImageKey);
            } catch (error) {
                console.error('Error deleting old image from S3:', error);
                // Continue with upload even if deletion fails
            }
        }

        // Upload new image to S3
        const uploadResult = await uploadImageToS3(
            req.file.buffer,
            employee.employeeId,
            req.file.originalname
        );

        // Update employee profile
        employee.profileImage = uploadResult.url;
        employee.profileImageKey = uploadResult.key;
        employee.lastUpdatedAt = new Date();

        await employee.save();

        const employeeResponse = employee.toJSON();

        return res.status(200).json({
            success: true,
            message: 'Profile image uploaded successfully',
            data: {
                profileImage: employee.profileImage,
                profileImageKey: employee.profileImageKey,
                employee: employeeResponse
            }
        });
    } catch (error) {
        console.error('Upload profile image error:', error);

        if (error.message.includes('Failed to upload image to S3')) {
            return res.status(500).json({
                success: false,
                message: 'Failed to upload image. Please try again.'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete profile image
export const deleteEmployeeImage = async (req, res) => {
    const employee = await Employee.findById(req.user._id);
    try {
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        if (!employee.profileImage || !employee.profileImageKey) {
            return res.status(400).json({
                success: false,
                message: 'No profile image found'
            });
        }

        // Delete from S3
        await deleteImageFromS3(employee.profileImageKey);

        // Remove from employee record
        employee.profileImage = null;
        employee.profileImageKey = null;
        employee.lastUpdatedAt = new Date();

        await employee.save();

        const employeeResponse = employee.toJSON();

        return res.status(200).json({
            success: true,
            message: 'Profile image deleted successfully',
            data: employeeResponse
        });
    } catch (error) {
        console.error('Delete profile image error:', error);

        if (error.message.includes('Failed to delete image from S3')) {
            // Still remove from database even if S3 deletion fails
            employee.profileImage = null;
            employee.profileImageKey = null;
            employee.lastUpdatedAt = new Date();
            await employee.save();

            return res.status(200).json({
                success: true,
                message: 'Profile image reference removed (could not delete from S3)',
                data: employee.toJSON()
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update profile image by HR/Admin
export const updateEmployeeImageByAdmin = async (req, res) => {
    try {
        // Check if user has permission (ADMIN or HR)
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can update employee profile images'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Please upload an image file'
            });
        }

        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employee ID format'
            });
        }

        const employee = await Employee.findById(id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Delete old image if exists
        if (employee.profileImageKey) {
            try {
                await deleteFromS3(employee.profileImageKey);
            } catch (error) {
                console.error('Error deleting old image from S3:', error);
                // Continue with upload even if deletion fails
            }
        }

        // Upload new image to S3
        const uploadResult = await uploadImageToS3(
            req.file.buffer,
            employee.employeeId,
            req.file.originalname
        );

        // Update employee profile
        employee.profileImage = uploadResult.url;
        employee.profileImageKey = uploadResult.key;
        employee.lastUpdatedBy = req.user._id;
        employee.lastUpdatedAt = new Date();

        await employee.save();

        const employeeResponse = employee.toJSON();

        return res.status(200).json({
            success: true,
            message: 'Employee profile image updated successfully',
            data: {
                profileImage: employee.profileImage,
                profileImageKey: employee.profileImageKey,
                employee: employeeResponse
            }
        });
    } catch (error) {
        console.error('Update employee image by admin error:', error);

        if (error.message.includes('Failed to upload image to S3')) {
            return res.status(500).json({
                success: false,
                message: 'Failed to upload image. Please try again.'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete profile image by HR/Admin
export const deleteEmployeeImageByAdmin = async (req, res) => {
    try {
        // Check if user has permission (ADMIN or HR)
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can delete employee profile images'
            });
        }

        const { id } = req.params;

        // Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid employee ID format'
            });
        }

        const employee = await Employee.findById(id);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        if (!employee.profileImage || !employee.profileImageKey) {
            return res.status(400).json({
                success: false,
                message: 'No profile image found for this employee'
            });
        }

        // Delete from S3
        await deleteImageFromS3(employee.profileImageKey);

        // Remove from employee record
        employee.profileImage = null;
        employee.profileImageKey = null;
        employee.lastUpdatedBy = req.user._id;
        employee.lastUpdatedAt = new Date();

        await employee.save();

        const employeeResponse = employee.toJSON();

        return res.status(200).json({
            success: true,
            message: 'Employee profile image deleted successfully',
            data: employeeResponse
        });
    } catch (error) {
        console.error('Delete employee image by admin error:', error);

        if (error.message.includes('Failed to delete image from S3')) {
            // Still remove from database even if S3 deletion fails
            employee.profileImage = null;
            employee.profileImageKey = null;
            employee.lastUpdatedBy = req.user._id;
            employee.lastUpdatedAt = new Date();
            await employee.save();

            return res.status(200).json({
                success: true,
                message: 'Employee profile image reference removed (could not delete from S3)',
                data: employee.toJSON()
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


export const sendAppointmentLetter = async (req, res) => {
    try {
        const { employeeId } = req.body;

        const employee = await Employee.findOne({ employeeId });

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found",
            });
        }

        // ✅ 1️⃣ Check if appointment letter already exists (object check)
        if (employee.appointmentLetters && employee.appointmentLetters.url) {
            return res.status(200).json({
                success: true,
                message: "Appointment letter was already sent previously",
                data: {
                    employeeId: employee._id,
                    appointmentLetter: employee.appointmentLetters,
                    emailSent: true,
                },
            });
        }

        // ✅ 2️⃣ Prepare data for PDF
        const formattedEmployee = {
            ...employee.toObject(),
            user: {
                fullName: `${employee.firstName} ${employee.lastName}`,
                fullNameS3: `${employee.firstName}${employee.lastName}`,
            },
            joiningDate: employee.createdAt,
        };

        // ✅ 3️⃣ Generate PDF
        let pdfBuffer;
        try {
            pdfBuffer = await generateAppointmentLetter(formattedEmployee);
        } catch (err) {
            console.error("PDF Error:", err);
            return res.status(500).json({
                success: false,
                message: "Failed to generate appointment letter",
            });
        }

        // ✅ 4️⃣ Upload to S3
        let appointmentUrl;
        try {
            appointmentUrl = await saveAppointmentLetterInS3(
                pdfBuffer,
                formattedEmployee.user.fullNameS3
            );

            // ✅ Save as OBJECT (not array)
            employee.appointmentLetters = {
                url: appointmentUrl,
                fileName: `${formattedEmployee.user.fullNameS3}_AppointmentLetter_Kiaq.pdf`,
                uploadedAt: new Date(),
            };

            await employee.save();

        } catch (uploadError) {
            console.error("S3 Upload Error:", uploadError);
            return res.status(500).json({
                success: false,
                message: "Failed to upload appointment letter",
            });
        }

        // ✅ 5️⃣ Send Email
        let emailSent = false;
        try {
            await sendAppointmentEmail(employee, pdfBuffer);
            emailSent = true;
        } catch (emailError) {
            console.log("Email failed:", emailError);
        }

        // ✅ 6️⃣ Response
        res.status(200).json({
            success: true,
            message:
                "Appointment letter sent successfully" +
                (emailSent ? " with email" : " (email pending/failed)"),
            data: {
                employeeId: employee._id,
                appointmentLetter: employee.appointmentLetters,
                emailSent,
            },
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


export const verifyAppointmentLetter = async (req, res) => {
    try {
        const { employeeId } = req.body;

        const employee = await Employee.findOne({ employeeId });

        if (!employee || !employee.appointmentLetters?.url) {
            return res.status(404).json({
                success: false,
                message: "Appointment letter not found",
            });
        }

        // ✅ Already signed check
        if (employee.appointmentLetters.isVerified) {
            return res.status(200).json({
                success: true,
                message: "Already signed",
                data: employee.appointmentLetters,
            });
        }

        // ✅ Mark as signed
        employee.appointmentLetters.isVerified = true;
        await employee.save();

        res.status(200).json({
            success: true,
            message: "Appointment letter signed successfully",
            data: employee.appointmentLetters,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};



// Get all employees without pagination (HR/Admin only) - minimal fields
export const getAllEmployeesAppointment = async (req, res) => {
    try {
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can view all employees'
            });
        }

        const employees = await Employee.find({})
            .select('firstName lastName officialEmail employeeId appointmentLetters isActive')
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            message: 'Employees retrieved successfully',
            data: {
                employees,
                total: employees.length
            }
        });
    } catch (error) {
        console.error('Get all employees minimal error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};






























/**
 * GET /api/employees/resigned
 * Returns all inactive (resigned) employees
 */
export const getResignedEmployees = async (req, res) => {
    try {
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Only ADMIN or HR can view resigned employees' });
        }

        const employees = await Employee.find({ isActive: false })
            .select('firstName lastName officialEmail employeeId designation department createdAt relievingDate resignationDate relievingLetter experienceCertificate isActive')
            .sort({ updatedAt: -1 });

        return res.status(200).json({
            success: true,
            message: 'Resigned employees retrieved successfully',
            data: { employees, total: employees.length },
        });
    } catch (error) {
        console.error('Get resigned employees error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /api/employees/:id/send-relieving-letter
 * Generates PDF → uploads to S3 → sends Mailjet email with base64 attachment
 */
export const sendRelievingLetter = async (req, res) => {
    try {
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Only ADMIN or HR can send relieving letters' });
        }
 
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid employee ID format' });
        }
 
        const employee = await Employee.findById(req.params.id);
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
 
        // Already sent — return existing record
        if (employee.relievingLetter?.url) {
            return res.status(200).json({
                success: true,
                message: 'Relieving letter was already sent previously',
                data: { relievingLetter: employee.relievingLetter },
            });
        }
 
        // ✅ Use manually entered form data from req.body
        //    Fall back to buildEmployeeData() only for fields not provided
        const fallback = buildEmployeeData(employee);
        const empData = {
            fullName:        req.body.fullName        || fallback.fullName,
            employeeId:      req.body.employeeId      || fallback.employeeId,
            designation:     req.body.designation     || fallback.designation,
            department:      req.body.department      || fallback.department,
            joiningDate:     req.body.joiningDate     || fallback.joiningDate,
            leavingDate:     req.body.leavingDate     || fallback.leavingDate,
            resignationDate: req.body.resignationDate || fallback.resignationDate,
            letterDate:      req.body.letterDate      || fallback.letterDate,
            refNo:           req.body.refNo           || fallback.refNo,
            hrName:          req.body.hrName          || fallback.hrName,
            hrTitle:         req.body.hrTitle         || fallback.hrTitle,
        };
 
        // 1. Generate PDF
        const pdfBuffer = await generateRelievingLetter(empData);
 
        // 2. Upload to S3
        const fullName = `${employee.firstName}${employee.lastName}`;
        const url      = await saveRelievingLetterInS3(pdfBuffer, fullName);
        const fileName = `${fullName}_RelievingLetter_Kiaq.pdf`;
 
        // 3. Save to DB
        employee.relievingLetter = { url, fileName, sentAt: new Date() };
        await employee.save();
 
        // 4. Send Mailjet email
        let emailSent = false;
        try {
            await SendMailJet({
                to:      employee.personalEmail || employee.officialEmail,
                subject: `Relieving Letter – ${employee.firstName} ${employee.lastName} | ${process.env.COMPANY_NAME}`,
                html:    relievingLetterEmailTemplate(employee),
                attachments: [{
                    ContentType:   'application/pdf',
                    Filename:      fileName,
                    Base64Content: pdfBuffer.toString('base64'),
                }],
            });
            emailSent = true;
        } catch (emailErr) {
            console.error('Relieving letter email error:', emailErr);
        }
 
        return res.status(200).json({
            success: true,
            message: `Relieving letter sent successfully${emailSent ? ' with email' : ' (email failed)'}`,
            data: { relievingLetter: employee.relievingLetter, emailSent },
        });
    } catch (error) {
        console.error('Send relieving letter error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
 
 
/**
 * POST /api/employees/:id/send-experience-certificate
 * Body: { fullName, employeeId, designation, department,
 *         joiningDate, leavingDate, letterDate, refNo, hrName, hrTitle }
 */
export const sendExperienceCertificate = async (req, res) => {
    try {
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Only ADMIN or HR can send experience certificates' });
        }
 
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid employee ID format' });
        }
 
        const employee = await Employee.findById(req.params.id);
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
 
        // Already sent — return existing record
        if (employee.experienceCertificate?.url) {
            return res.status(200).json({
                success: true,
                message: 'Experience certificate was already sent previously',
                data: { experienceCertificate: employee.experienceCertificate },
            });
        }
 
        // ✅ Use manually entered form data from req.body
        const fallback = buildEmployeeData(employee);
        const empData = {
            fullName:    req.body.fullName    || fallback.fullName,
            employeeId:  req.body.employeeId  || fallback.employeeId,
            designation: req.body.designation || fallback.designation,
            department:  req.body.department  || fallback.department,
            joiningDate: req.body.joiningDate || fallback.joiningDate,
            leavingDate: req.body.leavingDate || fallback.leavingDate,
            letterDate:  req.body.letterDate  || fallback.letterDate,
            refNo:       req.body.refNo       || fallback.refNo,
            hrName:      req.body.hrName      || fallback.hrName,
            hrTitle:     req.body.hrTitle     || fallback.hrTitle,
        };
 
        // 1. Generate PDF
        const pdfBuffer = await generateExperienceCertificate(empData);
 
        // 2. Upload to S3
        const fullName = `${employee.firstName}${employee.lastName}`;
        const url      = await saveExperienceCertificateInS3(pdfBuffer, fullName);
        const fileName = `${fullName}_ExperienceCertificate_Kiaq.pdf`;
 
        // 3. Save to DB
        employee.experienceCertificate = { url, fileName, sentAt: new Date() };
        await employee.save();
 
        // 4. Send Mailjet email
        let emailSent = false;
        try {
            await SendMailJet({
                to:      employee.personalEmail || employee.officialEmail,
                subject: `Experience Certificate – ${employee.firstName} ${employee.lastName} | ${process.env.COMPANY_NAME}`,
                html:    experienceCertificateEmailTemplate(employee),
                attachments: [{
                    ContentType:   'application/pdf',
                    Filename:      fileName,
                    Base64Content: pdfBuffer.toString('base64'),
                }],
            });
            emailSent = true;
        } catch (emailErr) {
            console.error('Experience certificate email error:', emailErr);
        }
 
        return res.status(200).json({
            success: true,
            message: `Experience certificate sent successfully${emailSent ? ' with email' : ' (email failed)'}`,
            data: { experienceCertificate: employee.experienceCertificate, emailSent },
        });
    } catch (error) {
        console.error('Send experience certificate error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/employees/:id/preview-relieving-letter
 * Returns a 15-min signed S3 URL for in-browser preview
 */
export const previewRelievingLetter = async (req, res) => {
    try {
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid employee ID format' });
        }
        const employee = await Employee.findById(req.params.id);
        if (!employee?.relievingLetter?.url) {
            return res.status(404).json({ success: false, message: 'Relieving letter not found' });
        }
        const fileUrl = await getSignedS3Url(employee.relievingLetter.url);
        return res.status(200).json({ success: true, fileUrl });
    } catch (error) {
        console.error('Preview relieving letter error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/employees/:id/preview-experience-certificate
 */
export const previewExperienceCertificate = async (req, res) => {
    try {
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid employee ID format' });
        }
        const employee = await Employee.findById(req.params.id);
        if (!employee?.experienceCertificate?.url) {
            return res.status(404).json({ success: false, message: 'Experience certificate not found' });
        }
        const fileUrl = await getSignedS3Url(employee.experienceCertificate.url);
        return res.status(200).json({ success: true, fileUrl });
    } catch (error) {
        console.error('Preview experience certificate error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};









export const generateRelievingLetterDirect = async (req, res) => {
    try {
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
 
        const {
            fullName, employeeId, designation, department,
            joiningDate, leavingDate, resignationDate,
            letterDate, refNo, hrName, hrTitle,
            sendEmail = false, recipientEmail,
        } = req.body;
 
        // Validate required fields
        const missing = ['fullName', 'employeeId', 'designation', 'department',
                         'joiningDate', 'leavingDate', 'resignationDate',
                         'letterDate', 'refNo'].filter(f => !req.body[f]);
        if (missing.length) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(', ')}`,
            });
        }
 
        const empData = {
            fullName, employeeId, designation, department,
            joiningDate, leavingDate, resignationDate,
            letterDate, refNo,
            hrName:  hrName  || process.env.HR_NAME  || 'Hazeena Begum A',
            hrTitle: hrTitle || process.env.HR_TITLE || 'SR Executive - Human Resource',
        };
 
        const pdfBuffer = await generateRelievingLetter(empData);
        const fileName  = `${fullName.replace(/\s+/g, '')}_RelievingLetter_Kiaq.pdf`;
 
        // Optional email
        if (sendEmail && recipientEmail) {
            try {
                await SendMailJet({
                    to:      recipientEmail,
                    subject: `Relieving Letter – ${fullName} | ${process.env.COMPANY_NAME}`,
                    html:    relievingLetterEmailTemplate({ firstName: fullName.split(' ')[0], lastName: '', ...empData }),
                    attachments: [{
                        ContentType:   'application/pdf',
                        Filename:      fileName,
                        Base64Content: pdfBuffer.toString('base64'),
                    }],
                });
            } catch (emailErr) {
                console.error('Direct relieving email error:', emailErr);
            }
        }
 
        // Stream PDF back as download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.send(pdfBuffer);
 
    } catch (error) {
        console.error('Generate relieving letter direct error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
 
 
/**
 * POST /api/employees/generate-experience-certificate
 * Body: { fullName, employeeId, designation, department,
 *         joiningDate, leavingDate,
 *         letterDate, refNo, hrName, hrTitle }
 *
 * Returns the PDF as a downloadable file stream.
 */
export const generateExperienceCertificateDirect = async (req, res) => {
    try {
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
 
        const {
            fullName, employeeId, designation, department,
            joiningDate, leavingDate,
            letterDate, refNo, hrName, hrTitle,
            sendEmail = false, recipientEmail,
        } = req.body;
 
        const missing = ['fullName', 'employeeId', 'designation', 'department',
                         'joiningDate', 'leavingDate', 'letterDate', 'refNo'].filter(f => !req.body[f]);
        if (missing.length) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missing.join(', ')}`,
            });
        }
 
        const empData = {
            fullName, employeeId, designation, department,
            joiningDate, leavingDate,
            letterDate, refNo,
            hrName:  hrName  || process.env.HR_NAME  || 'Hazeena Begum A',
            hrTitle: hrTitle || process.env.HR_TITLE || 'SR Executive - Human Resource',
        };
 
        const pdfBuffer = await generateExperienceCertificate(empData);
        const fileName  = `${fullName.replace(/\s+/g, '')}_ExperienceCertificate_Kiaq.pdf`;
 
        // Optional email
        if (sendEmail && recipientEmail) {
            try {
                await SendMailJet({
                    to:      recipientEmail,
                    subject: `Experience Certificate – ${fullName} | ${process.env.COMPANY_NAME}`,
                    html:    experienceCertificateEmailTemplate({ firstName: fullName.split(' ')[0], lastName: '', ...empData }),
                    attachments: [{
                        ContentType:   'application/pdf',
                        Filename:      fileName,
                        Base64Content: pdfBuffer.toString('base64'),
                    }],
                });
            } catch (emailErr) {
                console.error('Direct experience email error:', emailErr);
            }
        }
 
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.send(pdfBuffer);
 
    } catch (error) {
        console.error('Generate experience certificate direct error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};