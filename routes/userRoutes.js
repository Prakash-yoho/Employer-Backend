import express from "express";
import {
    registerUser,
    loginUser,
    getCurrentUser,
    updateUserProfile,
    changePassword,
    getUserById,
    getAllUsers,
    getCandidates,
    deactivateUser,
    activateUser,
    deleteUser,
    logoutUser
} from "../controllers/userController.js";
import { authMiddleware, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);

// Protected routes (require authentication)
router.use(authMiddleware);

router.get("/profile", getCurrentUser);
router.put("/profile", updateUserProfile);
router.put("/change-password", changePassword);

// HR only routes
router.get("/", authorizeRoles("hr"), getAllUsers);
router.get("/candidates", authorizeRoles("hr"), getCandidates);
router.get("/:id", authorizeRoles("hr"), getUserById);
router.put("/deactivate/:id", authorizeRoles("hr"), deactivateUser);
router.put("/activate/:id", authorizeRoles("hr"), activateUser);
router.delete("/:id", authorizeRoles("hr"), deleteUser);

export default router;