import express from "express";
import {
    initializeAdmin,
    adminLogin,
    createHr,
    getAllHrUsers,
    getHrUserById,
    updateHrUser,
    deleteHrUser,
    getAdminProfile,
    updateAdminProfile,
    changeAdminPassword,
    getSystemStatistics
} from "../controllers/adminController.js";
import { adminAuthMiddleware, checkAdminInitialization } from "../middleware/adminMiddleware.js";

const router = express.Router();

// Public routes
router.post("/initialize", checkAdminInitialization, initializeAdmin);
router.post("/login", adminLogin);

// Protected routes (Admin only)
router.use(adminAuthMiddleware);

// Admin profile routes
router.get("/profile", getAdminProfile);
router.put("/profile", updateAdminProfile);
router.put("/change-password", changeAdminPassword);

// HR management routes
router.post("/hr", createHr);
router.get("/hr", getAllHrUsers);
router.get("/hr/:id", getHrUserById);
router.put("/hr/:id", updateHrUser);
router.delete("/hr/:id", deleteHrUser);

// System statistics
router.get("/statistics", getSystemStatistics);

export default router;