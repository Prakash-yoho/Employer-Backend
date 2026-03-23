import jwt from 'jsonwebtoken';
import BlacklistedToken from '../../model/BlacklistedToken.js';
import EmployerUser from '../../model/Employer/EmployerUser.js';
import Employee from '../../model/Employer/Employee.js';

export const authenticate = async (req, res, next) => {
    try {
        // Get token from header
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No authentication token, access denied'
            });
        }

        const blacklisted = await BlacklistedToken.findOne({ token });
        if (blacklisted) {
            return res.status(401).json({ message: "Token invalidated" });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find user by ID from token
        const user = await EmployerUser.findById(decoded._id).select('-password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'User account is deactivated'
            });
        }

        // Attach user to request
        req.user = user;
        next();

    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Token expired"
            });
        }

        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({
                success: false,
                message: "Token is invalid"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
}

export const authorize = (roles = []) => {
    // If roles is a string, convert to array
    if (typeof roles === 'string') {
        roles = [roles];
    }

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        if (roles.length && !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to perform this action'
            });
        }

        next();
    };
};

export const authenticateEmployee = async (req, res, next) => {
    try {
        // Get token from header
        const token = req.header('Authorization')?.replace('Bearer ', '');

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    message: 'Token has expired. Please refresh your token.'
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }

        // Check if user is an employee
        if (!['Employee', 'TL'].includes(decoded.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Employee access only.'
            });
        }

        // Find employee
        const employee = await Employee.findById(decoded._id).select('-officialPassword');

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Check if employee is active
        if (!employee.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Your account has been deactivated. Please contact HR/Admin.'
            });
        }
        // Attach employee to request
        req.user = employee;
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "Token expired"
            });
        }

        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({
                success: false,
                message: "Token is invalid"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};