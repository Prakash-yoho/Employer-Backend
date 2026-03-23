import express from "express";

import { createPhase, getAllPhases, getAllPhasesWithSchedules, getPhaseById, updatePhase, deletePhase, restorePhase } from "../controllers/PhaseController.js";
import {
    createSchedule,
    getAllSchedulesGrouped,
    updateScheduleGroupDates,
    updateEmployeesInPhaseSchedule,
    getSchedulesByPhase,
    getScheduleById,
    deleteSchedule,
    restoreSchedule,
    getAvailableEmployees,
    getOnlyAvailableEmployees,
    addEmployeesToSchedule,
    removeEmployeeFromSchedule,
    getMySchedule,
    getActivityLogs,
    getRecentActivityLogs,
    deleteScheduleGroup,
    getActivityLogsByPhase,
} from "../controllers/ScheduleController.js";
import { authenticate, authenticateEmployee, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();
const ADMIN_HR = ["EMPLOYER_ADMIN", "EMPLOYER_HR"];
const ALL_STAFF = ["EMPLOYER_ADMIN", "EMPLOYER_HR", "Employee"];

// ── Phase routes ──────────────────────────────────────────────────────────────
router.post("/phase/create", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), createPhase);
router.get("/phase/getall", getAllPhases);

router.get("/phases/with-schedules", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getAllPhasesWithSchedules);

router.get("/phases/:id", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getPhaseById);

router.put("/phases/:id", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), updatePhase);
router.delete("/phases/:id", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), deletePhase);
router.patch("/phases/:id/restore", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), restorePhase);

// ── Employee: my own schedule ─────────────────────────────────────────────────
router.get("/my-schedule",
    authenticateEmployee,
    getMySchedule);

// ── Schedule routes ───────────────────────────────────────────────────────────
router.post("/schedules/create", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), createSchedule);
// GET grouped list 
router.get("/schedules/grouped", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getAllSchedulesGrouped);
// UPDATE dates for whole group 
router.put("/schedules/group/:groupId", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), updateScheduleGroupDates);
// Sub-path routes — before /:id
router.get("/schedules/phase/:phaseId", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getSchedulesByPhase);
router.get("/schedules/:id/available-employees", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getAvailableEmployees);

// Single phase-doc routes
router.get("/schedules/:id", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getScheduleById);
router.delete("/schedules/:id", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), deleteSchedule);
router.delete("/schedules/group/:groupId", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), deleteScheduleGroup);
router.patch("/schedules/:id/restore", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), restoreSchedule);

// ── Employee assignment routes ────────────────────────────────────────────────
router.get(
    "/employees/available",
    authenticate,
    authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]),
    getOnlyAvailableEmployees
);
// POST   — add employees to a phase  (same as before)
router.post("/schedules/:id/employees", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), addEmployeesToSchedule);

// PUT — update (replace) employee list inside ONE phase of a schedule
router.put("/schedules/:id/employees", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), updateEmployeesInPhaseSchedule);

// DELETE — remove a single employee from a phase
router.delete("/schedules/:id/employees/:employeeId", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), removeEmployeeFromSchedule);

// ── Activity logs ─────────────────────────────────────────────────────────────
router.get("/activity-logs/recent", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getRecentActivityLogs);
router.get("/activity-logs/phase/:phaseId", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getActivityLogsByPhase);
router.get("/activity-logs", authenticate, authorize(["EMPLOYER_ADMIN", "EMPLOYER_HR"]), getActivityLogs);

export default router;