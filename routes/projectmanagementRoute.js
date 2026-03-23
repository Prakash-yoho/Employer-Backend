import express from "express";
import { createProject, softDeleteProject, getAllProjects, getProjectById, updateProject, hardDeleteProject, restoreProject } from "../controllers/projectController.js";
import { createTeam, softDeleteTeam, getAllTeams, getTeamById, getTeamsByTL, updateTeam, hardDeleteTeam, restoreTeam, getUnassignedEmployees } from "../controllers/teamController.js";
import { assignTL, getAllTLs, getMyTLDashboard, getTLById, removeTL } from "../controllers/tlController.js";
import { authenticate, authenticateEmployee, authorize } from "../middleware/authMiddleware.js";
import {
    createTask,
    updateTask,
    deleteTask,
    getAllTasks,
    getAssignableEmployees,
    getMyTasks,
    getTaskById,
    getTasksOverview,
    getTLTeamTasks,
    tlAssignTask,
    tlUpdateTask,
    tlDeleteTask,
    tlReviewTask,
    pmReviewTask,
    updateMyTaskStatus,
    getTeamTasks,
    getTeamTaskDetails,
    getTaskReport,
    exportTaskReport,
    getEmployeePerformance,
    exportPerformanceReport,
} from "../controllers/taskController.js";

const router = express.Router();
const PM_ADMIN_HR = ["PROJECT_MANAGER", "EMPLOYER_ADMIN", "EMPLOYER_HR"];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/projects", authenticate, authorize(PM_ADMIN_HR), createProject);
router.get("/projects", authenticate, authorize(PM_ADMIN_HR), getAllProjects);
router.get("/projects/:id", authenticate, authorize(PM_ADMIN_HR), getProjectById);
router.put("/projects/:id", authenticate, authorize(PM_ADMIN_HR), updateProject);
router.delete("/projects/:id", authenticate, authorize(PM_ADMIN_HR), softDeleteProject);
router.delete("/projects/:id/harddelete", authenticate, authorize(PM_ADMIN_HR), hardDeleteProject);
router.patch("/projects/:id/restore", authenticate, authorize(PM_ADMIN_HR), restoreProject);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TL ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/tl/me", authenticateEmployee, authorize(["TL"]), getMyTLDashboard);
router.post("/tl/assign", authenticate, authorize(PM_ADMIN_HR), assignTL);
router.post("/tl/remove", authenticate, authorize(PM_ADMIN_HR), removeTL);
router.get("/tl", authenticate, authorize(PM_ADMIN_HR), getAllTLs);
router.get("/tl/:id", authenticate, authorize(PM_ADMIN_HR), getTLById);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEAM ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/teams", authenticate, authorize(PM_ADMIN_HR), createTeam);
router.get("/teams", authenticate, authorize(PM_ADMIN_HR), getAllTeams);
router.get("/teams/by-tl/:tlId", authenticate, authorize(PM_ADMIN_HR), getTeamsByTL);
router.get("/teams/:id", authenticate, authorize(PM_ADMIN_HR), getTeamById);
router.put("/teams/:id", authenticate, authorize(PM_ADMIN_HR), updateTeam);
router.delete("/teams/:id", authenticate, authorize(PM_ADMIN_HR), softDeleteTeam);
router.delete("/teams/:id/harddelete", authenticate, authorize(PM_ADMIN_HR), hardDeleteTeam);
router.patch("/teams/:id/restore", authenticate, authorize(PM_ADMIN_HR), restoreTeam);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TASK ROUTES — PM / ADMIN / HR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/tasks", authenticate, authorize(PM_ADMIN_HR), createTask);
router.get("/tasks/assignable", authenticate, authorize(PM_ADMIN_HR), getAssignableEmployees);
router.get("/tasks/teamdetails", authenticate, authorize(PM_ADMIN_HR), getTasksOverview);
router.get("/tasks/team/:teamId", authenticate, authorize(PM_ADMIN_HR), getTeamTaskDetails);


router.get("/tasks/report", authenticate, authorize(PM_ADMIN_HR), getTaskReport);
router.get("/tasks/report/export", exportTaskReport);
router.get("/tasks/performance/export", authenticate, authorize(PM_ADMIN_HR), exportPerformanceReport);
router.get("/tasks/performance", getEmployeePerformance);



router.get("/tasks", authenticate, authorize(PM_ADMIN_HR), getAllTasks);
router.get("/tasks/:id", authenticate, authorize(PM_ADMIN_HR), getTaskById);
router.put("/tasks/update/:id", authenticate, authorize(PM_ADMIN_HR), updateTask);
router.delete("/tasks/delete/:id", authenticate, authorize(PM_ADMIN_HR), deleteTask);
router.patch("/tasks/:id/review", authenticate, authorize(PM_ADMIN_HR), pmReviewTask);
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TASK ROUTES — TEAM LEAD (Employee token)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/tl/tasks", authenticateEmployee, authorize(["TL"]), getTLTeamTasks);
router.post("/tl/tasks/assign", authenticateEmployee, authorize(["TL"]), tlAssignTask);
router.get("/tl/tasks/:teamid", authenticateEmployee, authorize(["TL"]), getTeamTasks);
router.put("/tl/tasks/update/:id", authenticateEmployee, authorize(["TL"]), tlUpdateTask);
router.delete("/tl/tasks/delete/:id", authenticateEmployee, authorize(["TL"]), tlDeleteTask);
router.patch("/tl/tasks/:id/review", authenticateEmployee, authorize(["TL"]), tlReviewTask);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TASK ROUTES — EMPLOYEE (Employee token)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/employee/tasks", authenticateEmployee, getMyTasks);
router.patch("/employee/tasks/:id/status", authenticateEmployee, updateMyTaskStatus);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMPLOYEE UTILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/employees/unassigned", authenticate, authorize(PM_ADMIN_HR), getUnassignedEmployees);
router.get("/employees/assignable", authenticate, authorize(PM_ADMIN_HR), getAssignableEmployees);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TASK REPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/tasks/report", authenticate, authorize(PM_ADMIN_HR), getTaskReport);
router.get("/tasks/report/export", authenticate, authorize(PM_ADMIN_HR), exportTaskReport)



export default router;