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
import { sendMail } from '../utils/mailer.js';
import { newEmployeeTemplate } from '../utils/Employer/emailTemplates.js';
dotenv.config();

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

