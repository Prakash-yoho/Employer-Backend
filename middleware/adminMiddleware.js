import jwt from "jsonwebtoken";
import AdminUser from "../model/AdminUser.js";

export const adminAuthMiddleware = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(400).json({
                success: false,
                message: "Access denied. No token provided."
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Check if user is admin
        if (decoded.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin role required."
            });
        }

        // Verify admin exists
        const admin = await AdminUser.findById(decoded.userId);
        if (!admin) {
            return res.status(400).json({
                success: false,
                message: "Invalid token. Admin not found."
            });
        }

        req.user = decoded;
        next();

    } catch (error) {
        console.error("Admin auth middleware error:", error);

        if (error.name === 'JsonWebTokenError') {
            return res.status(400).json({
                success: false,
                message: "Invalid token."
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: "Token expired."
            });
        }

        res.status(500).json({
            success: false,
            message: "Authentication failed."
        });
    }
};

// Check if admin is already initialized
export const checkAdminInitialization = async (req, res, next) => {
    try {
        const existingAdmin = await AdminUser.findOne();
        if (existingAdmin && req.method === 'POST' && req.originalUrl === '/api/admin/initialize') {
            return res.status(400).json({
                success: false,
                message: "Admin already exists. Only one admin is allowed."
            });
        }
        next();
    } catch (error) {
        console.error("Check admin initialization error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};