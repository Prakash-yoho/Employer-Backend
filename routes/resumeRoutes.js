import express from "express";
import {
    uploadResume,
    getResume,
    downloadResume,
    previewResume,
    deleteResume
} from "../controllers/resumeController.js";
import { uploadResumeMiddleware } from "../config/multer.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/upload", authMiddleware, uploadResumeMiddleware, uploadResume);
router.get("/", authMiddleware, getResume);
router.get("/download/:id", authMiddleware, downloadResume);
router.get("/preview", authMiddleware, previewResume);
router.delete("/", authMiddleware, deleteResume);

export default router;