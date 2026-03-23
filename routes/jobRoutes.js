import express from "express";
import {
    createJob,
    getJobs,
    getJobById,
    updateJob,
    deleteJob,
    updateJobStatus,
} from "../controllers/jobController.js";
import { authMiddleware, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", authMiddleware, authorizeRoles("hr"), createJob);
router.get("/", getJobs);
router.get("/:id", getJobById);
router.put("/:id", authMiddleware, authorizeRoles("hr"), updateJob);
router.delete("/:id", authMiddleware, authorizeRoles("hr"), deleteJob);
router.patch("/:id/status", authMiddleware, authorizeRoles("hr"), updateJobStatus);

export default router;
