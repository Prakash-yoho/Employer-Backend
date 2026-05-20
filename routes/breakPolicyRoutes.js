// routes/breakPolicyRoutes.js
import express from "express";
import { getBreakPolicy, updateBreakPolicy } from "../controllers/breakPolicyController.js";
import { authenticate, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Employee can GET to populate the break-type popup
router.get("/", getBreakPolicy);

// Only HR/Admin can update
router.put("/", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), updateBreakPolicy);

export default router;