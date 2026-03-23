import jwt from "jsonwebtoken";
import User from "../model/User.js";
import AdminUser from "../model/AdminUser.js";
import BlacklistedToken from "../model/BlacklistedToken.js";

export const authMiddleware = async (req, res, next) => {
    try {
        const token = req.header("Authorization")?.replace("Bearer ", "");

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Access denied. No token provided."
            });
        }

        const blacklisted = await BlacklistedToken.findOne({ token });
        if (blacklisted) {
            return res.status(401).json({ message: "Token invalidated" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        let user = null;

        // Check if it's an admin token
        if (decoded.role === 'admin') {
            user = await AdminUser.findById(decoded.userId || decoded.id);
        }
        // Check if it's a user token (hr, candidate, employee)
        else {
            user = await User.findById(decoded.id || decoded.userId);
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Token is invalid - user not found"
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: "Account is deactivated"
            });
        }

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
};

export const authorizeRoles = (...roles) => {
    return (req, res, next) => {

        if (req.user.role === 'admin') {
            return next();
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Required role: ${roles.join(" or ")} or admin`
            });
        }
        next();
    };
};