import express from "express";
import { getDefaultDocuments } from "../controllers/defaultDocs.js";

const router = express.Router();

router.get("/default-documents", getDefaultDocuments);

export default router;