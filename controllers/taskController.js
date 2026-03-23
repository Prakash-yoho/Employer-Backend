import mongoose from "mongoose";
import {
    createTaskValidator,
    tlReviewTaskValidator,
    updateTaskStatusValidator,
    updateTaskValidator,
} from "../validations/projectmanagementValidation.js";
import Employee from "../model/Employer/Employee.js";
import Team from "../model/Team.js";
import ExcelJS from "exceljs"
import Task from "../model/Task.js";

// ── Mark task as overtime if deadline passed and still active ─────────────────
// AFTER
const checkAndMarkOvertime = async (task) => {
    const activeStatuses = ["pending", "in_progress"];
    if (
        activeStatuses.includes(task.status) &&
        !task.isOvertime &&
        task.deadline
    ) {
        // Overtime starts only after midnight (00:00) of the deadline day
        const deadlineMidnight = new Date(task.deadline);
        deadlineMidnight.setHours(23, 59, 59, 999); // end of deadline day
        const afterMidnight = new Date(deadlineMidnight.getTime() + 1); // 00:00 of next day

        if (new Date() >= afterMidnight) {
            // ✅ Only flag — do NOT change status
            task.isOvertime = true;
            task.overtimeAt = new Date();
            await task.save();
        }
    }
    return task;
};

const getReviewBlockMessage = (currentStatus) => {
    switch (currentStatus) {
        case "pending":
            return "Cannot apply need_correction — employee hasn't started yet. Use 'completed', 'revoked', or 'incomplete'.";
        case "in_progress":
            return "Cannot apply need_correction — employee hasn't submitted yet. Use 'completed', 'revoked', or 'incomplete'.";
        case "completed":
            return "Cannot review — this task is already completed.";
        case "revoked":
            return "Cannot review — this task has already been revoked.";
        default:
            return `Cannot review — current status is '${currentStatus}'.`;
    }
};
// ─────────────────────────────────────────────────────────────────────────────
// PM: Create a task
// ─────────────────────────────────────────────────────────────────────────────
export const createTask = async (req, res) => {
    try {
        const { error, value } = createTaskValidator.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }

        const { title, description, deadline, additionalNotice, priority, team, assignedTo } = value;

        const employee = await Employee.findOne({ _id: assignedTo, isActive: true });
        if (!employee) {
            return res.status(404).json({ success: false, message: "Assigned employee not found or inactive" });
        }

        let supervisedBy = null;

        if (team) {
            const teamDoc = await Team.findById(team);
            if (!teamDoc || !teamDoc.isActive) {
                return res.status(404).json({ success: false, message: "Team not found or inactive" });
            }

            const isMember = teamDoc.members.map((m) => m.toString()).includes(assignedTo);
            const isTL = teamDoc.teamLead?.toString() === assignedTo;

            if (!isMember && !isTL) {
                return res.status(400).json({
                    success: false,
                    message: "Assigned employee is not a member or TL of the selected team",
                });
            }

            if (isMember && !isTL) {
                supervisedBy = teamDoc.teamLead;
            }
        }

        // new + save so pre("save") hook fires for taskId generation
        const task = new Task({
            title,
            description,
            deadline,
            additionalNotice: additionalNotice || null,
            priority,
            assignedTo,
            team: team || null,
            assignedBy: req.user._id,
            assignedByModel: "EmployerUser",
            supervisedBy,
        });
        await task.save();

        // ── createTask (PM) — populated response ──────────────────────────────────────
        const populated = await Task.findById(task._id)
            .populate("assignedTo", "firstName lastName employeeId")
            .populate("supervisedBy", "firstName lastName employeeId")
            .populate({
                path: "team",
                populate: {
                    path: "project",
                    select: "projectId projectName status priority startDate endDate client",
                },
            })
            .populate("assignedBy", "firstName lastName email");

        return res.status(201).json({ success: true, message: "Task created successfully", data: populated });
    } catch (err) {
        console.error("createTask:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PM: Edit ANY task (not just ones they created)
// If assignedTo changes → task resets to pending
// ─────────────────────────────────────────────────────────────────────────────
export const updateTask = async (req, res) => {
    try {
        const { error, value } = updateTaskValidator.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }
        // PM can edit ANY task — no assignedBy filter
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        if (["completed", "revoked"].includes(task.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot edit task — task is already '${task.status}'.`,
                currentStatus: task.status,
            });
        }

        const { title, description, deadline, additionalNotice, priority, team, assignedTo } = req.body;

        const newAssignedTo = assignedTo || task.assignedTo.toString();
        const newTeam = team !== undefined ? team : task.team?.toString();

        // ── If assignedTo changed → recalculate supervisedBy + RESET to pending ──
        const assigneeChanged = assignedTo && assignedTo !== task.assignedTo.toString();

        if (assignedTo !== undefined || team !== undefined) {
            task.supervisedBy = null;

            if (newTeam) {
                const teamDoc = await Team.findById(newTeam);
                if (!teamDoc || !teamDoc.isActive) {
                    return res.status(404).json({ success: false, message: "Team not found or inactive" });
                }

                const isMember = teamDoc.members.map((m) => m.toString()).includes(newAssignedTo);
                const isTL = teamDoc.teamLead?.toString() === newAssignedTo;

                if (!isMember && !isTL) {
                    return res.status(400).json({
                        success: false,
                        message: "Assigned employee is not a member or TL of the selected team",
                    });
                }

                if (isMember && !isTL) task.supervisedBy = teamDoc.teamLead;
            }
        }

        // ── Reset task lifecycle if employee is reassigned ────────────────────
        if (assigneeChanged) {
            task.status = "pending";
            task.startedAt = null;
            task.resolvedAt = null;
            task.resolvedBy = null;
            task.resolvedByModel = null;
            task.notifiedTL = false;
            task.tlRemark = null;
            task.correctionHistory = [];
        }

        if (title !== undefined) task.title = title;
        if (description !== undefined) task.description = description;
        if (deadline !== undefined) task.deadline = deadline;
        if (additionalNotice !== undefined) task.additionalNotice = additionalNotice;
        if (priority !== undefined) task.priority = priority;
        if (assignedTo !== undefined) task.assignedTo = assignedTo;
        if (team !== undefined) task.team = team || null;

        // ── Track who made this edit ──────────────────────────────────────────
        task.lastModifiedBy = req.user._id;
        task.lastModifiedByModel = "EmployerUser"; // PM is always EmployerUser

        await task.save();

        const populated = await Task.findById(task._id)
            .populate("assignedTo", "firstName lastName employeeId")
            .populate("supervisedBy", "firstName lastName employeeId")
            .populate("team", "teamName")
            .populate("assignedBy", "firstName lastName email")
            .populate("lastModifiedBy", "firstName lastName email");

        return res.status(200).json({ success: true, message: "Task updated successfully", data: populated });
    } catch (err) {
        console.error("updateTask:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PM: Delete any task (regardless of who created it)
// Only deletable when status is pending
// ─────────────────────────────────────────────────────────────────────────────
export const deleteTask = async (req, res) => {
    try {
        // PM can delete ANY task — no assignedBy filter
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }



        await task.deleteOne();
        return res.status(200).json({ success: true, message: "Task permanently deleted" });
    } catch (err) {
        console.error("deleteTask:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

export const getAllTasks = async (req, res) => {
    try {
        const { status, priority, team, assignedTo, search } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        if (team) filter.team = team;
        if (assignedTo) filter.assignedTo = assignedTo;
        if (search) filter.title = { $regex: search, $options: "i" };

        const [rawTasks, pmAwaitingReview, tlAwaitingReview, globalStats, allTeams] = await Promise.all([
            Task.find(filter)
                .populate("assignedTo", "firstName lastName employeeId department designation profileImage")
                .populate("supervisedBy", "firstName lastName employeeId")
                .populate({
                    path: "team",
                    populate: [
                        {
                            path: "teamLead",
                            select: "firstName lastName employeeId designation profileImage department officialEmail",
                        },
                        {
                            path: "project",
                            select: "projectId projectName status priority startDate endDate client budget description",
                        },
                    ],
                })
                .populate("assignedBy", "firstName lastName email employeeId")
                .populate("lastModifiedBy", "firstName lastName email")
                .populate("resolvedBy", "firstName lastName email")
                .sort({ createdAt: -1 }),

            Task.countDocuments({ supervisedBy: null, status: "completed_by_employee" }),
            Task.countDocuments({ supervisedBy: { $ne: null }, status: "completed_by_employee" }),

            Task.aggregate([
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
                        in_progress: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
                        overtime: { $sum: { $cond: [{ $eq: ["$status", "overtime"] }, 1, 0] } },
                        completed_by_employee: { $sum: { $cond: [{ $eq: ["$status", "completed_by_employee"] }, 1, 0] } },
                        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
                        revoked: { $sum: { $cond: [{ $eq: ["$status", "revoked"] }, 1, 0] } },
                        incomplete: { $sum: { $cond: [{ $eq: ["$status", "incomplete"] }, 1, 0] } },
                    },
                },
            ]),
            Team.find({ isActive: true })
                .select("_id teamId teamName members project teamLead")
                .populate("teamLead", "firstName lastName employeeId designation profileImage department officialEmail")
                .populate("members", "firstName lastName employeeId designation profileImage")
                .populate("project", "projectId projectName status priority startDate endDate client budget description")
                .lean(),
        ]);

        // ── fullName on task's nested teamLead ────────────────────────────────
        const tasks = rawTasks.map((task) => {
            const t = task.toObject();
            if (t.team?.teamLead) {
                t.team.teamLead = {
                    ...t.team.teamLead,
                    fullName: `${t.team.teamLead.firstName} ${t.team.teamLead.lastName}`,
                };
            }
            return t;
        });

        const g = globalStats[0] ?? {
            total: 0, pending: 0, in_progress: 0,
            completed_by_employee: 0, completed: 0, revoked: 0,
        };

        // ── Build lookup map — fullName on allTeams teamLead ──────────────────
        const teamInfoMap = {};
        allTeams.forEach((t) => {
            if (t.teamLead) {
                t.teamLead = {
                    ...t.teamLead,
                    fullName: `${t.teamLead.firstName} ${t.teamLead.lastName}`,
                };
            }
            teamInfoMap[t._id.toString()] = t;
        });

        // ── Group tasks by team ───────────────────────────────────────────────
        const teamMap = {};
        const individual = [];

        tasks.forEach((task) => {
            if (task.team) {
                const key = task.team._id.toString();
                const teamInfo = teamInfoMap[key];

                if (!teamMap[key]) {
                    teamMap[key] = {
                        teamId: teamInfo?.teamId ?? task.team._id,
                        teamName: teamInfo?.teamName ?? task.team.teamName,
                        project: teamInfo?.project ?? null,
                        teamLead: teamInfo?.teamLead ?? null,
                        members: teamInfo?.members ?? [],
                        memberCount: teamInfo?.members?.length ?? 0,
                        summary: {},
                        total: 0,
                        tasks: [],
                    };
                }

                const entry = teamMap[key];
                entry.tasks.push(task);
                entry.summary[task.status] = (entry.summary[task.status] || 0) + 1;
                entry.total++;
            } else {
                individual.push(task);
            }
        });

        return res.status(200).json({
            success: true,
            total: tasks.length,

            stats: {
                totalTasks: g.total,
                pending: g.pending,
                inProgress: g.in_progress,
                // overtime: g.overtime,
                completedByEmployee: g.completed_by_employee,
                completed: g.completed,
                revoked: g.revoked,
                incomplete: g.incomplete,
            },

            awaitingReview: {
                pmDirect: pmAwaitingReview,
                tlManaged: tlAwaitingReview,
                total: pmAwaitingReview + tlAwaitingReview,
            },

            teams: Object.values(teamMap),

            individual: {
                total: individual.length,
                tasks: individual,
            },

            data: tasks,
        });
    } catch (err) {
        console.error("getAllTasks:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PM: Get single task (only if they created it)
// ─────────────────────────────────────────────────────────────────────────────
export const getTaskById = async (req, res) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, assignedBy: req.user._id })
            .populate("assignedTo", "firstName lastName employeeId department designation")
            .populate("supervisedBy", "firstName lastName employeeId")
            .populate("team", "teamName description")
            .populate("assignedBy", "firstName lastName email");

        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found or not created by you" });
        }

        return res.status(200).json({ success: true, data: task });
    } catch (err) {
        console.error("getTaskById:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PM: Tasks overview — every team with its tasks, TL info + TL's own tasks,
//     project info and per-team status summary
// ─────────────────────────────────────────────────────────────────────────────
export const getTasksOverview = async (req, res) => {
    try {
        const { teamId } = req.query;
        const teamFilter = { isActive: true };
        if (teamId) teamFilter._id = teamId;
        const teams = await Team.find(teamFilter)
            .populate("teamLead", "firstName lastName employeeId department designation profileImage officialEmail isTL")
            .populate("members", "firstName lastName employeeId department designation profileImage")
            .populate("project", "projectId projectName status priority startDate endDate client")
            .lean();

        const teamIds = teams.map((t) => t._id);
        const tlIds = teams.filter((t) => t.teamLead).map((t) => t.teamLead._id);

        const [teamTasks, tlDirectTasks, statusCounts] = await Promise.all([
            // All tasks belonging to a team
            Task.find({ team: { $in: teamIds } })
                .populate("assignedTo", "firstName lastName employeeId designation profileImage")
                .populate("supervisedBy", "firstName lastName employeeId")
                .populate("assignedBy", "firstName lastName email")
                .sort({ createdAt: -1 })
                .lean(),

            // Tasks assigned directly to TLs (could be with or without a team)
            Task.find({ assignedTo: { $in: tlIds } })
                .populate("assignedTo", "firstName lastName employeeId designation profileImage")
                .populate("supervisedBy", "firstName lastName employeeId")
                .populate("assignedBy", "firstName lastName email")
                .populate("team", "teamName")
                .sort({ createdAt: -1 })
                .lean(),

            // Overall status counts across all team tasks
            Task.aggregate([
                { $match: { team: { $in: teamIds } } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
        ]);

        // Map tasks by teamId string
        const tasksByTeam = {};
        teamTasks.forEach((task) => {
            const key = task.team.toString();
            if (!tasksByTeam[key]) tasksByTeam[key] = [];
            tasksByTeam[key].push(task);
        });

        // Map TL direct tasks by TL _id string
        const tasksByTL = {};
        tlDirectTasks.forEach((task) => {
            const key = task.assignedTo._id.toString();
            if (!tasksByTL[key]) tasksByTL[key] = [];
            tasksByTL[key].push(task);
        });

        const overallSummary = statusCounts.reduce((acc, s) => {
            acc[s._id] = s.count;
            return acc;
        }, {});

        const data = teams.map((team) => {
            const tasks = tasksByTeam[team._id.toString()] || [];
            const tlId = team.teamLead?._id?.toString();
            const myTLTasks = tlId ? (tasksByTL[tlId] || []) : [];

            const teamSummary = tasks.reduce((acc, t) => {
                acc[t.status] = (acc[t.status] || 0) + 1;
                return acc;
            }, {});

            return {
                team: {
                    _id: team._id,
                    teamId: team.teamId,
                    teamName: team.teamName,
                    project: team.project ?? null,
                    isActive: team.isActive,
                },
                teamLead: team.teamLead
                    ? { ...team.teamLead, tlTasks: myTLTasks, tlTaskTotal: myTLTasks.length }
                    : null,
                members: team.members,
                memberCount: team.members.length,
                tasks,
                taskTotal: tasks.length,
                teamSummary,
            };
        });

        return res.status(200).json({
            success: true,
            totalTeams: teams.length,
            overallSummary,
            data,
        });
    } catch (err) {
        console.error("getTasksOverview:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PM: Review / close ANY task (not just ones they created)
// ─────────────────────────────────────────────────────────────────────────────
export const pmReviewTask = async (req, res) => {
    try {
        const { error, value } = tlReviewTaskValidator.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }

        const { action, reason } = value;

        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        // ── Block only permanently closed ────────────────────────────────────────────
        if (["completed", "revoked"].includes(task.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot review — task is already '${task.status}'.`,
                currentStatus: task.status,
            });
        }
        if (action === "completed" && task.status !== "completed_by_employee") {
            return res.status(400).json({
                success: false,
                message: `Cannot mark as completed — task must be submitted by employee first. Current status: '${task.status}'.`,
                currentStatus: task.status,
            });
        }
        // ── need_correction blocked only on pending/in_progress ──────────────────────
        // overtime + incomplete + completed_by_employee → allowed
        if (action === "need_correction" && ["pending", "in_progress"].includes(task.status)) {
            return res.status(400).json({
                success: false,
                message: getReviewBlockMessage(task.status),
                currentStatus: task.status,
            });
        }

        if (action === "need_correction") {
            task.status = "in_progress";
            task.tlRemark = reason;
            task.notifiedTL = false;
            task.isOvertime = false;   // ← reset overtime when giving another chance
            task.overtimeAt = null;    // ← reset overtime when giving another chance
            task.correctionHistory.push({ reason, correctedBy: req.user._id, correctedAt: new Date() });
        } else if (action === "completed") {
            task.status = "completed";
            task.resolvedAt = new Date();
            task.resolvedBy = req.user._id;
            task.resolvedByModel = "EmployerUser";
            task.tlRemark = reason;
        } else if (action === "revoked") {
            task.status = "revoked";
            task.resolvedAt = new Date();
            task.resolvedBy = req.user._id;
            task.resolvedByModel = "EmployerUser";
            task.tlRemark = reason;
        } else if (action === "incomplete") {          // ← renamed from not_completed
            task.status = "incomplete";
            task.resolvedAt = new Date();
            task.resolvedBy = req.user._id;
            task.resolvedByModel = "EmployerUser";
            task.tlRemark = reason;
        }

        await task.save();

        const populated = await Task.findById(task._id)
            .populate("assignedTo", "firstName lastName employeeId")
            .populate("team", "teamName")
            .populate("assignedBy", "firstName lastName email")
            .populate("resolvedBy", "firstName lastName email");

        return res.status(200).json({
            success: true,
            message: `Task marked as '${action}' successfully`,
            data: populated,
        });
    } catch (err) {
        console.error("pmReviewTask:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE: Get their own tasks
// Query: ?status=&priority=
// ─────────────────────────────────────────────────────────────────────────────
export const getMyTasks = async (req, res) => {
    try {
        const { status, priority } = req.query;
        const filter = { assignedTo: req.user._id };
        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        const tasks = await Task.find(filter)
            .populate("supervisedBy", "firstName lastName employeeId designation profileImage")
            .populate({
                path: "team", select: "teamId teamName description",
                populate: { path: "project", select: "projectId projectName status priority startDate endDate client budget description" },
            })
            .populate("assignedBy", "firstName lastName email employeeId")
            .populate("lastModifiedBy", "firstName lastName email employeeId")
            .populate("resolvedBy", "firstName lastName email employeeId")
            .sort({ deadline: 1 });

        // ── Auto-mark overtime for eligible tasks past deadline ────────────────
        await Promise.all(tasks.map((t) => checkAndMarkOvertime(t)));

        // Re-fetch after overtime updates so response reflects latest status
        const updated = await Task.find(filter)
            .populate("supervisedBy", "firstName lastName employeeId designation profileImage")
            .populate({
                path: "team", select: "teamId teamName description",
                populate: { path: "project", select: "projectId projectName status priority startDate endDate client budget description" },
            })
            .populate("assignedBy", "firstName lastName email employeeId")
            .populate("lastModifiedBy", "firstName lastName email employeeId")
            .populate("resolvedBy", "firstName lastName email employeeId")
            .sort({ deadline: 1 });

        return res.status(200).json({ success: true, total: updated.length, data: updated });
    } catch (err) {
        console.error("getMyTasks:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE: Update task status
//
// Flow:
//   pending     → in_progress          (employee starts for the first time)
//   in_progress → completed_by_employee (employee submits)
//
// After TL/PM sends need_correction:
//   Task is already set back to in_progress by the reviewer.
//   Employee just continues working and submits again (in_progress → completed_by_employee).
//   Employee CANNOT go back to pending once started.
// ─────────────────────────────────────────────────────────────────────────────
export const updateMyTaskStatus = async (req, res) => {
    try {
        const { error, value } = updateTaskStatusValidator.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }

        const task = await Task.findOne({ _id: req.params.id, assignedTo: req.user._id });
        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found or not assigned to you" });
        }

        const { status } = value;

        // Only pending → in_progress (first start)
        if (status === "in_progress" && task.status !== "pending") {
            return res.status(400).json({
                success: false,
                message: `Cannot start — current status is '${task.status}'. Only a pending task can be started.`,
            });
        }

        // in_progress → completed_by_employee (submit)
        if (status === "completed_by_employee" && !["in_progress", "incomplete"].includes(task.status)) {
            return res.status(400).json({
                success: false,
                message: "Task must be in_progress or incomplete before marking as done",
            });
        }

        task.status = status;

        if (status === "in_progress") {
            // Only set startedAt the very first time — never overwrite it
            if (!task.startedAt) {
                task.startedAt = new Date();
            }
        }

        if (status === "completed_by_employee") {
            task.notifiedTL = true;
        }

        await task.save();
        return res.status(200).json({ success: true, message: "Task status updated", data: task });
    } catch (err) {
        console.error("updateMyTaskStatus:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

export const getTLTeamTasks = async (req, res) => {
    try {
        const { status, priority, teamId } = req.query;

        const myTeams = await Team.find({ teamLead: req.user._id, isActive: true })
            .select("_id teamName members");

        if (!myTeams.length) {
            return res.status(200).json({
                success: true,
                total: 0,
                data: [],
                grouped: {},
                pendingReview: { total: 0, byTeam: [] },
                message: "You are not leading any active team",
            });
        }

        const myTeamIds = myTeams.map((t) => t._id);

        // ── Only member tasks — exclude tasks assigned TO the TL themselves ───
        let filter = {
            team: { $in: myTeamIds },
            assignedTo: { $ne: req.user._id }, // ← exclude TL's own tasks
        };

        if (teamId) {
            const owns = myTeamIds.map((id) => id.toString()).includes(teamId);
            if (!owns) {
                return res.status(403).json({ success: false, message: "You are not the TL of this team" });
            }
            filter.team = new mongoose.Types.ObjectId(teamId);
        }

        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        const pendingReviewAgg = Task.aggregate([
            {
                $match: {
                    supervisedBy: new mongoose.Types.ObjectId(req.user._id.toString()),
                    status: "completed_by_employee",
                    team: { $in: myTeamIds },
                },
            },
            { $group: { _id: "$team", count: { $sum: 1 } } },
        ]);

        const [tasks, reviewGroups] = await Promise.all([
            Task.find(filter)
                .populate("assignedTo", "firstName lastName employeeId department designation profileImage")
                .populate("supervisedBy", "firstName lastName employeeId")
                .populate("team", "teamName _id")
                .populate("assignedBy")
                .populate("lastModifiedBy", "firstName lastName email")
                .populate("resolvedBy")
                .sort({ deadline: 1 }),
            pendingReviewAgg,
        ]);

        const teamNameMap = {};
        myTeams.forEach((t) => { teamNameMap[t._id.toString()] = t.teamName; });

        const byTeam = reviewGroups.map((g) => ({
            teamId: g._id,
            teamName: teamNameMap[g._id.toString()] || "Unknown",
            count: g.count,
        }));
        const pendingTotal = byTeam.reduce((sum, t) => sum + t.count, 0);

        // ── Group by team ─────────────────────────────────────────────────────
        const grouped = {};
        myTeams.forEach((t) => {
            grouped[t._id.toString()] = {
                teamName: t.teamName,
                total: 0,
                summary: {},
                tasks: [],
            };
        });

        tasks.forEach((task) => {
            const key = task.team?._id.toString();
            if (key && grouped[key]) {
                grouped[key].tasks.push(task);
                grouped[key].total++;
                grouped[key].summary[task.status] = (grouped[key].summary[task.status] || 0) + 1;
            }
        });

        return res.status(200).json({
            success: true,
            total: tasks.length,
            totalTeams: myTeams.length,
            pendingReview: { total: pendingTotal, byTeam },
            grouped,
            data: tasks,
        });
    } catch (err) {
        console.error("getTLTeamTasks:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TL: Assign a task to a member in one of their teams
// ─────────────────────────────────────────────────────────────────────────────
export const tlAssignTask = async (req, res) => {
    try {
        const { error, value } = createTaskValidator.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }

        const { title, description, deadline, additionalNotice, priority, team, assignedTo } = value;

        if (!team) {
            return res.status(400).json({ success: false, message: "team is required when TL assigns a task" });
        }

        const teamDoc = await Team.findOne({ _id: team, teamLead: req.user._id, isActive: true });
        if (!teamDoc) {
            return res.status(403).json({
                success: false,
                message: "You are not the TL of this team or the team is inactive",
            });
        }

        const isMember = teamDoc.members.map((m) => m.toString()).includes(assignedTo);
        if (!isMember) {
            return res.status(400).json({
                success: false,
                message: "You can only assign tasks to members of your team",
            });
        }

        // new + save so pre("save") hook fires for taskId
        const task = new Task({
            title,
            description,
            deadline,
            additionalNotice: additionalNotice || null,
            priority,
            assignedTo,
            team,
            assignedBy: req.user._id,
            assignedByModel: "Employee",
            supervisedBy: req.user._id,
        });
        await task.save();

        // ── tlAssignTask (TL) — populated response ────────────────────────────────────
        const populated = await Task.findById(task._id)
            .populate("assignedTo", "firstName lastName employeeId")
            .populate("supervisedBy", "firstName lastName employeeId")
            .populate({
                path: "team",
                populate: {
                    path: "project",
                    select: "projectId projectName status priority startDate endDate client",
                },
            })
            .populate("assignedBy", "firstName lastName employeeId");
        return res.status(201).json({
            success: true,
            message: "Task assigned to team member successfully",
            data: populated,
        });
    } catch (err) {
        console.error("tlAssignTask:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TL: Edit a task they assigned
// If assignedTo changes → task resets to pending
// ─────────────────────────────────────────────────────────────────────────────
export const tlUpdateTask = async (req, res) => {
    try {
        const { error, value } = updateTaskValidator.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }
        const task = await Task.findOne({ _id: req.params.id, assignedBy: req.user._id });
        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found or not assigned by you" });
        }

        if (["completed", "revoked"].includes(task.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot edit task — task is already '${task.status}'.`,
                currentStatus: task.status,
            });
        }

        const { title, description, deadline, additionalNotice, priority, assignedTo } = req.body;

        const assigneeChanged = assignedTo && assignedTo !== task.assignedTo.toString();

        // Reassigning to different member — must still be in same team
        if (assigneeChanged) {
            const teamDoc = await Team.findOne({ _id: task.team, teamLead: req.user._id, isActive: true });
            if (!teamDoc) {
                return res.status(403).json({ success: false, message: "You are not the TL of this task's team" });
            }

            const isMember = teamDoc.members.map((m) => m.toString()).includes(assignedTo);
            if (!isMember) {
                return res.status(400).json({
                    success: false,
                    message: "You can only reassign to members of your team",
                });
            }

            task.assignedTo = assignedTo;

            // ── Reset task lifecycle when employee changes ─────────────────────
            task.status = "pending";
            task.startedAt = null;
            task.resolvedAt = null;
            task.resolvedBy = null;
            task.resolvedByModel = null;
            task.notifiedTL = false;
            task.tlRemark = null;
            task.correctionHistory = [];
        }

        if (title !== undefined) task.title = title;
        if (description !== undefined) task.description = description;
        if (deadline !== undefined) task.deadline = deadline;
        if (additionalNotice !== undefined) task.additionalNotice = additionalNotice;
        if (priority !== undefined) task.priority = priority;

        // ── Track who made this edit ──────────────────────────────────────────
        task.lastModifiedBy = req.user._id;
        task.lastModifiedByModel = "Employee"; // TL is always Employee

        await task.save();

        const populated = await Task.findById(task._id)
            .populate("assignedTo", "firstName lastName employeeId")
            .populate("supervisedBy", "firstName lastName employeeId")
            .populate("team", "teamName")
            .populate("lastModifiedBy", "firstName lastName employeeId");

        return res.status(200).json({ success: true, message: "Task updated successfully", data: populated });
    } catch (err) {
        console.error("tlUpdateTask:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TL: Delete a task they assigned
// Only deletable when status is pending
// ─────────────────────────────────────────────────────────────────────────────
export const tlDeleteTask = async (req, res) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, assignedBy: req.user._id });
        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found or not assigned by you" });
        }

        if (task.status !== "pending") {
            return res.status(400).json({
                success: false,
                message: `Cannot delete task — current status is '${task.status}'. Only pending tasks can be deleted.`,
            });
        }

        await task.deleteOne();
        return res.status(200).json({ success: true, message: "Task permanently deleted" });
    } catch (err) {
        console.error("tlDeleteTask:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TL: Review a task (need_correction / completed / revoked)
// need_correction → sets task back to in_progress (NOT pending)
// ─────────────────────────────────────────────────────────────────────────────
export const tlReviewTask = async (req, res) => {
    try {
        const { error, value } = tlReviewTaskValidator.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }

        const { action, reason } = value;

        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        if (!task.supervisedBy || task.supervisedBy.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "You are not the supervisor of this task" });
        }
        // TL can only review members from their own teams
        const myTeams = await Team.find({ teamLead: req.user._id, isActive: true }).select("members");
        const myMemberIds = myTeams.flatMap((t) => t.members.map((m) => m.toString()));
        if (!myMemberIds.includes(task.assignedTo.toString())) {
            return res.status(403).json({ success: false, message: "This task's employee is not a member of your teams" });
        }

        if (["completed", "revoked"].includes(task.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot review — task is already '${task.status}'.`,
                currentStatus: task.status,
            });
        }
        if (action === "completed" && task.status !== "completed_by_employee") {
            return res.status(400).json({
                success: false,
                message: `Cannot mark as completed — task must be submitted by employee first. Current status: '${task.status}'.`,
                currentStatus: task.status,
            });
        }

        if (action === "need_correction" && task.status === "pending") {
            return res.status(400).json({
                success: false,
                message: getReviewBlockMessage(task.status),
                currentStatus: task.status,
            });
        }

        if (action === "need_correction") {
            task.status = "in_progress";
            task.tlRemark = reason;
            task.notifiedTL = false;
            task.isOvertime = false;
            task.overtimeAt = null;
            task.correctionHistory.push({ reason, correctedBy: req.user._id, correctedAt: new Date() });
        } else if (action === "completed") {
            task.status = "completed";
            task.resolvedAt = new Date();
            task.resolvedBy = req.user._id;
            task.resolvedByModel = "Employee";
            task.tlRemark = reason;
        } else if (action === "revoked") {
            task.status = "revoked";
            task.resolvedAt = new Date();
            task.resolvedBy = req.user._id;
            task.resolvedByModel = "Employee";
            task.tlRemark = reason;
        } else if (action === "incomplete") {
            task.status = "incomplete";
            task.resolvedAt = new Date();
            task.resolvedBy = req.user._id;
            task.resolvedByModel = "Employee";
            task.tlRemark = reason;
        }

        await task.save();

        const populated = await Task.findById(task._id)
            .populate("assignedTo", "firstName lastName employeeId")
            .populate("supervisedBy", "firstName lastName employeeId")
            .populate("team", "teamName")
            .populate("resolvedBy", "firstName lastName employeeId");

        return res.status(200).json({
            success: true,
            message: `Task marked as '${action}' successfully`,
            data: populated,
        });
    } catch (err) {
        console.error("tlReviewTask:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PM: Get assignable employees
// Query: ?teamId=  (omit for all employees)
// ─────────────────────────────────────────────────────────────────────────────
export const getAssignableEmployees = async (req, res) => {
    try {
        const { teamId } = req.query;

        // ── MODE 2: team given → return TL + members of that team ─────────────
        if (teamId) {
            const team = await Team.findById(teamId)
                .populate("teamLead", "firstName lastName employeeId officialEmail department designation profileImage role isTL")
                .populate("members", "firstName lastName employeeId officialEmail department designation profileImage role isTL");

            if (!team) {
                return res.status(404).json({ success: false, message: "Team not found" });
            }

            const formatEmp = (e, isLead) => ({
                _id: e._id,
                employeeId: e.employeeId,
                firstName: e.firstName,
                lastName: e.lastName,
                officialEmail: e.officialEmail,
                department: e.department,
                designation: e.designation,
                profileImage: e.profileImage,
                role: e.role,
                isTL: e.isTL,
                isTeamLead: isLead,
            });

            const tl = team.teamLead ? formatEmp(team.teamLead, true) : null;
            const members = team.members.map((m) => formatEmp(m, false));
            const all = tl ? [tl, ...members] : members;

            return res.status(200).json({
                success: true,
                mode: "team",
                team: {
                    _id: team._id,
                    teamId: team.teamId,
                    teamName: team.teamName,
                },
                total: all.length,
                data: all,
            });
        }

        // ── MODE 1: no teamId → return employees with NO team ─────────────────
        // Only active, non-TL employees whose currentTeam.teamId is null
        // This matches the logic of getUnassignedEmployees and excludes assigned employees.
        const employees = await Employee.find({
            isActive: true,
            isTL: false,                     // Exclude team leads (they cannot be regular members)
            "currentTeam.teamId": null        // This covers: field missing, null, or whole currentTeam missing
        })
            .select("firstName lastName employeeId officialEmail department designation profileImage role isTL")
            .sort({ firstName: 1 });

        const data = employees.map((e) => ({
            _id: e._id,
            employeeId: e.employeeId,
            firstName: e.firstName,
            lastName: e.lastName,
            officialEmail: e.officialEmail,
            department: e.department,
            designation: e.designation,
            profileImage: e.profileImage,
            role: e.role,
            isTL: e.isTL,
            isTeamLead: false,
        }));

        return res.status(200).json({
            success: true,
            mode: "individual",
            total: data.length,
            data,
        });

    } catch (err) {
        console.error("getAssignableEmployees:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// TL: Get all tasks for a specific team (only teams they lead)
// GET /api/pm/tl/tasks/:teamid
// Query: ?status=&priority=
// ─────────────────────────────────────────────────────────────────────────────
export const getTeamTasks = async (req, res) => {
    try {
        const { teamid } = req.params;
        const { status, priority } = req.query;

        const team = await Team.findOne({ _id: teamid, teamLead: req.user._id, isActive: true })
            .populate("teamLead", "firstName lastName employeeId department designation profileImage")
            .populate("members", "firstName lastName employeeId department designation profileImage")
            .populate("project", "projectId projectName status");

        if (!team) {
            return res.status(404).json({
                success: false,
                message: "Team not found or you are not the lead of this team",
            });
        }

        // ── Members only — exclude tasks assigned to the TL ───────────────────
        const filter = {
            team: teamid,
            assignedTo: { $ne: team.teamLead?._id },
        };
        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        const [tasks, statusCounts] = await Promise.all([
            Task.find(filter)
                .populate("assignedTo", "firstName lastName employeeId department designation profileImage")
                .populate("supervisedBy", "firstName lastName employeeId")
                .populate("assignedBy", "firstName lastName email employeeId")
                .sort({ createdAt: -1 }),

            Task.aggregate([
                {
                    $match: {
                        team: new mongoose.Types.ObjectId(teamid),
                        assignedTo: { $ne: team.teamLead?._id }, // consistent with query
                    },
                },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
        ]);

        const summary = statusCounts.reduce((acc, s) => {
            acc[s._id] = s.count;
            return acc;
        }, {});

        return res.status(200).json({
            success: true,
            total: tasks.length,
            team: {
                _id: team._id,
                teamName: team.teamName,
                teamLead: team.teamLead,
                members: team.members,
                project: team.project,
            },
            summary,
            data: tasks,
        });
    } catch (err) {
        console.error("getTeamTasks:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// PM: Get a SPECIFIC team's full task details
// GET /api/pm/tasks/team/:teamId
// Query: ?status=&priority=
// ─────────────────────────────────────────────────────────────────────────────
export const getTeamTaskDetails = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { status, priority } = req.query;

        const team = await Team.findById(teamId)
            .populate("teamLead", "firstName lastName employeeId department designation profileImage officialEmail isTL")
            .populate("members", "firstName lastName employeeId department designation profileImage officialEmail")
            .populate("project", "projectId projectName status priority startDate endDate client budget");

        if (!team || !team.isActive) {
            return res.status(404).json({ success: false, message: "Team not found or inactive" });
        }

        const memberFilter = { team: teamId };
        if (status) memberFilter.status = status;
        if (priority) memberFilter.priority = priority;

        const [memberTasks, statusCounts] = await Promise.all([
            Task.find(memberFilter)
                .populate("assignedTo", "firstName lastName employeeId department designation profileImage")
                .populate("supervisedBy", "firstName lastName employeeId")
                .populate("assignedBy", "firstName lastName email")
                .sort({ createdAt: -1 }),

            // Always count all statuses regardless of filter
            Task.aggregate([
                { $match: { team: new mongoose.Types.ObjectId(teamId) } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
        ]);

        // TL's own tasks
        let tlTasks = [];
        if (team.teamLead) {
            const tlFilter = { assignedTo: team.teamLead._id };
            if (status) tlFilter.status = status;
            if (priority) tlFilter.priority = priority;
            tlTasks = await Task.find(tlFilter)
                .populate("assignedBy", "firstName lastName email")
                .populate("team", "teamName")
                .sort({ createdAt: -1 });
        }

        const summary = statusCounts.reduce((acc, s) => {
            acc[s._id] = s.count;
            return acc;
        }, {});

        return res.status(200).json({
            success: true,
            team: { _id: team._id, teamId: team.teamId, teamName: team.teamName, project: team.project ?? null, isActive: team.isActive },
            teamLead: team.teamLead ? { ...team.teamLead.toObject(), tlTasks, tlTaskTotal: tlTasks.length } : null,
            members: team.members,
            memberCount: team.members.length,
            summary,
            total: memberTasks.length,
            data: memberTasks,
        });
    } catch (err) {
        console.error("getTeamTaskDetails:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};



export const getTaskReport = async (req, res) => {
    try {
        let { employeeId, employeeIds, status, priority, startDate, endDate } = req.query;

        const filter = {};

        // ── Handle single or multiple employee IDs ───────────────────────────
        // ✅ REPLACE WITH
        const parseIds = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val.map(id => id.trim()).filter(Boolean);
            try {
                const parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed.map(id => id.trim()).filter(Boolean) : [val.trim()];
            } catch {
                return val.split(",").map(id => id.trim()).filter(Boolean);
            }
        };

        let empIds = [...new Set([...parseIds(employeeId), ...parseIds(employeeIds)])];

        if (empIds.length > 0) {
            filter.assignedTo = { $in: empIds.map(id => new mongoose.Types.ObjectId(id)) };
        }

        // ── Optional filters ────────────────────────────────────────────────
        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        // ── Fetch tasks with full details ───────────────────────────────────
        const tasks = await Task.find(filter)
            .populate("assignedTo", "firstName lastName employeeId department designation")
            .populate("supervisedBy", "firstName lastName employeeId")
            .populate({
                path: "team",
                populate: {
                    path: "project",
                    select: "projectId projectName status priority startDate endDate client",
                },
            })
            .populate("assignedBy", "firstName lastName email")
            .populate("lastModifiedBy", "firstName lastName email")
            .populate("resolvedBy", "firstName lastName email")
            .sort({ createdAt: -1 });

        // ── Summary Stats ───────────────────────────────────────────────────
        const summary = tasks.reduce((acc, t) => {
            acc.total++;
            acc[t.status] = (acc[t.status] || 0) + 1;
            return acc;
        }, {
            total: 0,
            pending: 0,
            in_progress: 0,
            completed_by_employee: 0,
            completed: 0,
            revoked: 0,
        });

        // ── Group by Employee ───────────────────────────────────────────────
        const grouped = {};

        tasks.forEach(task => {
            const emp = task.assignedTo;
            const key = emp._id.toString();

            if (!grouped[key]) {
                grouped[key] = {
                    employeeId: emp.employeeId,
                    name: ` ${emp.firstName} ${emp.lastName}`,
                    department: emp.department,
                    designation: emp.designation,
                    total: 0,
                    summary: {},
                    tasks: [],
                };
            }

            grouped[key].tasks.push(task);
            grouped[key].total++;
            grouped[key].summary[task.status] =
                (grouped[key].summary[task.status] || 0) + 1;
        });

        return res.status(200).json({
            success: true,
            filters: {
                employeeIds: empIds,
                status,
                priority,
                startDate,
                endDate,
            },
            summary,
            totalTasks: tasks.length,
            groupedByEmployee: Object.values(grouped),
            data: tasks,
        });

    } catch (err) {
        console.error("getTaskReport:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            error: err.message,
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PM: Employee Performance Report
// Query: ?employeeId=&employeeIds=&startDate=&endDate=
// ─────────────────────────────────────────────────────────────────────────────
export const getEmployeePerformance = async (req, res) => {
    try {
        let { employeeId, employeeIds, startDate, endDate } = req.query;

        const filter = {};

        // ── Build employee ID list ────────────────────────────────────────────
        const parseIds = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val.map(id => id.trim()).filter(Boolean);
            try {
                const parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed.map(id => id.trim()).filter(Boolean) : [val.trim()];
            } catch {
                return val.split(",").map(id => id.trim()).filter(Boolean);
            }
        };

        let empIds = [...new Set([...parseIds(employeeId), ...parseIds(employeeIds)])];

        if (empIds.length > 0) {
            filter.assignedTo = { $in: empIds.map(id => new mongoose.Types.ObjectId(id)) };
        }

        // ── Date range — matches createdAt, startedAt, or resolvedAt ─────────
        if (startDate || endDate) {
            const dateRange = {};
            if (startDate) dateRange.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateRange.$lte = end;
            }
            filter.$or = [
                { createdAt: dateRange },
                { startedAt: dateRange },
                { resolvedAt: dateRange },
            ];
        }

        const tasks = await Task.find(filter)
            .populate("assignedTo", "firstName lastName employeeId department designation profileImage")
            .lean();

        // ── Group and calculate per employee ──────────────────────────────────
        const empMap = {};

        tasks.forEach((task) => {
            const emp = task.assignedTo;
            if (!emp) return;
            const key = emp._id.toString();

            if (!empMap[key]) {
                empMap[key] = {
                    _id: emp._id,
                    employeeId: emp.employeeId,
                    name: `${emp.firstName} ${emp.lastName}`,
                    department: emp.department,
                    designation: emp.designation,
                    profileImage: emp.profileImage,
                    counts: {
                        total: 0,
                        completed: 0,
                        completedOnTime: 0,
                        completedOvertime: 0,
                        pending: 0,
                        inProgress: 0,
                        overtime: 0,
                        revoked: 0,
                        incomplete: 0,
                        awaitingReview: 0,
                    },
                };
            }

            const c = empMap[key].counts;
            c.total++;

            switch (task.status) {
                case "completed":
                    c.completed++;
                    if (task.resolvedAt && task.deadline &&
                        new Date(task.resolvedAt) <= new Date(task.deadline)) {
                        c.completedOnTime++;
                    } else {
                        c.completedOvertime++;
                    }
                    break;
                case "pending": c.pending++; break;
                case "in_progress": c.inProgress++; break;
                case "overtime": c.overtime++; break;
                case "revoked": c.revoked++; break;
                case "incomplete": c.incomplete++; break;
                case "completed_by_employee": c.awaitingReview++; break;
            }
        });

        // ── Compute rates ─────────────────────────────────────────────────────
        const employees = Object.values(empMap).map((e) => {
            const c = e.counts;

            // Exclude revoked from performance base — they were cancelled not failed
            const effectiveTasks = c.total - c.revoked;

            const completionRate = effectiveTasks > 0
                ? Math.round((c.completed / effectiveTasks) * 100)
                : 0;

            const onTimeRate = c.completed > 0
                ? Math.round((c.completedOnTime / c.completed) * 100)
                : 0;

            return {
                _id: e._id,
                employeeId: e.employeeId,
                name: e.name,
                department: e.department,
                designation: e.designation,
                profileImage: e.profileImage,

                performance: {
                    totalTasks: c.total,
                    effectiveTasks,
                    completed: c.completed,
                    completedOnTime: c.completedOnTime,
                    completedOvertime: c.completedOvertime,
                    pending: c.pending,
                    inProgress: c.inProgress,
                    overtime: c.overtime,
                    revoked: c.revoked,
                    incomplete: c.incomplete,
                    awaitingReview: c.awaitingReview,
                    completionRate: `${completionRate}%`,
                    onTimeRate: `${onTimeRate}%`,
                },
            };
        });

        // ── Overall summary ───────────────────────────────────────────────────
        const overall = {
            totalTasks: tasks.length,
            completed: tasks.filter(t => t.status === "completed").length,
            pending: tasks.filter(t => t.status === "pending").length,
            inProgress: tasks.filter(t => t.status === "in_progress").length,
            overtime: tasks.filter(t => t.status === "overtime").length,
            revoked: tasks.filter(t => t.status === "revoked").length,
            incomplete: tasks.filter(t => t.status === "incomplete").length,
            awaitingReview: tasks.filter(t => t.status === "completed_by_employee").length,
        };

        const effectiveTotal = overall.totalTasks - overall.revoked;
        overall.completionRate = effectiveTotal > 0
            ? `${Math.round((overall.completed / effectiveTotal) * 100)}%`
            : "0%";

        return res.status(200).json({
            success: true,
            filters: { employeeIds: empIds, startDate, endDate },
            overall,
            totalEmployees: employees.length,
            employees,
        });

    } catch (err) {
        console.error("getEmployeePerformance:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};


export const exportTaskReport = async (req, res) => {
    try {
        let {
            employeeId, employeeIds, status, priority,
            createdStart, createdEnd,
            startedStart, startedEnd,
            resolvedStart, resolvedEnd,
        } = req.query;

        const filter = {};

        const parseIds = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val.map(id => id.trim()).filter(Boolean);
            try {
                const parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed.map(id => id.trim()).filter(Boolean) : [val.trim()];
            } catch {
                return val.split(",").map(id => id.trim()).filter(Boolean);
            }
        };

        let empIds = [...new Set([...parseIds(employeeId), ...parseIds(employeeIds)])];
        if (empIds.length > 0) {
            filter.assignedTo = { $in: empIds.map(id => new mongoose.Types.ObjectId(id)) };
        }

        if (status) filter.status = status;
        if (priority) filter.priority = priority;

        // ── Date range filters ─────────────────────────────────────────
        if (createdStart || createdEnd) {
            filter.createdAt = {};
            if (createdStart) filter.createdAt.$gte = new Date(createdStart);
            if (createdEnd) { const e = new Date(createdEnd); e.setHours(23, 59, 59, 999); filter.createdAt.$lte = e; }
        }
        if (startedStart || startedEnd) {
            filter.startedAt = {};
            if (startedStart) filter.startedAt.$gte = new Date(startedStart);
            if (startedEnd) { const e = new Date(startedEnd); e.setHours(23, 59, 59, 999); filter.startedAt.$lte = e; }
        }
        if (resolvedStart || resolvedEnd) {
            filter.resolvedAt = {};
            if (resolvedStart) filter.resolvedAt.$gte = new Date(resolvedStart);
            if (resolvedEnd) { const e = new Date(resolvedEnd); e.setHours(23, 59, 59, 999); filter.resolvedAt.$lte = e; }
        }
        // ── Fetch tasks ────────────────────────────────────────────────
        const tasks = await Task.find(filter)
            .populate("assignedTo", "firstName lastName employeeId department designation")
            .populate("supervisedBy", "firstName lastName employeeId")
            .populate("team", "teamName")
            .populate("assignedBy", "firstName lastName email")
            .populate("resolvedBy", "firstName lastName email")
            .sort({ createdAt: -1 });

        // ── Create workbook ────────────────────────────────────────────
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Task Report");

        // ── Columns ────────────────────────────────────────────────────
        worksheet.columns = [
            { header: "Employee ID", key: "employeeId", width: 15 },
            { header: "Employee Name", key: "employeeName", width: 25 },
            { header: "Department", key: "department", width: 20 },

            { header: "Team", key: "team", width: 20 },
            { header: "Task ID", key: "taskId", width: 15 },
            { header: "Title", key: "title", width: 25 },
            { header: "Description", key: "description", width: 30 },
            { header: "Priority", key: "priority", width: 15 },

            { header: "Assigned By", key: "assignedBy", width: 25 },
            { header: "Created At", key: "createdAt", width: 20 },

            { header: "Deadline", key: "deadline", width: 20 },
            { header: "Started At", key: "startedAt", width: 20 },
            { header: "Status", key: "status", width: 20 },

            { header: "Resolved By", key: "resolvedBy", width: 25 },
            { header: "Resolved At", key: "resolvedAt", width: 20 },
            { header: "Supervisor", key: "supervisor", width: 25 },
            { header: "Remarks (TL/PM)", key: "tlRemark", width: 35 },

        ];

        // ── Style header ───────────────────────────────────────────────
        worksheet.getRow(1).font = { bold: true };

        // ── Add rows ───────────────────────────────────────────────────
        tasks.forEach(task => {
            const row = worksheet.addRow({
                employeeId: task.assignedTo?.employeeId,
                employeeName: `${task.assignedTo?.firstName || ""} ${task.assignedTo?.lastName || ""}`,
                department: task.assignedTo?.department,

                team: task.team?.teamName || "N/A",
                taskId: task.taskId,
                title: task.title,
                description: task.description,
                priority: task.priority,

                assignedBy: task.assignedBy
                    ? ` ${task.assignedBy.firstName} ${task.assignedBy.lastName}`
                    : "N/A",
                createdAt: task.createdAt,

                deadline: task.deadline,
                startedAt: task.startedAt ?? "Not Started Yet",
                status: task.status,

                resolvedBy: task.resolvedBy
                    ? `${task.resolvedBy.firstName} ${task.resolvedBy.lastName}`
                    : "N/A",

                resolvedAt: task.resolvedAt ?? "N/A",
                supervisor: task.supervisedBy
                    ? `${task.supervisedBy.firstName} ${task.supervisedBy.lastName}`
                    : "N/A",
                tlRemark: task.tlRemark || "—",
            });

            // ── Apply row color based on status ─────────────────────────────
            let bgColor = null;

            switch (task.status) {
                case "pending":
                    bgColor = "FFFF0000"; // Red
                    break;
                case "revoked":
                    bgColor = "FFFFA500"; // Orange
                    break;
                case "in_progress":
                    bgColor = "FF0070C0"; // Blue
                    break;
            }

            if (bgColor) {
                row.eachCell((cell) => {
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: bgColor },
                    };

                    // Optional: make text white for readability
                    cell.font = {
                        color: { argb: "FFFFFFFF" },
                    };
                });
            }
        });

        const now = new Date();
        const today = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
        // ── Response headers ───────────────────────────────────────────
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename=task-report-${today}.xlsx`
        );

        // ── Send file ──────────────────────────────────────────────────
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("exportTaskReport:", err);
        res.status(500).json({
            success: false,
            message: "Failed to export report",
        });
    }
};



export const exportPerformanceReport = async (req, res) => {
    try {
        let {
            employeeId, employeeIds,
            createdStart, createdEnd,
            startedStart, startedEnd,
            resolvedStart, resolvedEnd,
        } = req.query;

        const filter = {};

        const parseIds = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val.map(id => id.trim()).filter(Boolean);
            try {
                const parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed.map(id => id.trim()).filter(Boolean) : [val.trim()];
            } catch {
                return val.split(",").map(id => id.trim()).filter(Boolean);
            }
        };

        let empIds = [...new Set([...parseIds(employeeId), ...parseIds(employeeIds)])];

        if (empIds.length > 0) {
            filter.assignedTo = { $in: empIds.map(id => new mongoose.Types.ObjectId(id)) };
        }

        if (createdStart || createdEnd) {
            filter.createdAt = {};
            if (createdStart) filter.createdAt.$gte = new Date(createdStart);
            if (createdEnd) { const e = new Date(createdEnd); e.setHours(23, 59, 59, 999); filter.createdAt.$lte = e; }
        }
        if (startedStart || startedEnd) {
            filter.startedAt = {};
            if (startedStart) filter.startedAt.$gte = new Date(startedStart);
            if (startedEnd) { const e = new Date(startedEnd); e.setHours(23, 59, 59, 999); filter.startedAt.$lte = e; }
        }
        if (resolvedStart || resolvedEnd) {
            filter.resolvedAt = {};
            if (resolvedStart) filter.resolvedAt.$gte = new Date(resolvedStart);
            if (resolvedEnd) { const e = new Date(resolvedEnd); e.setHours(23, 59, 59, 999); filter.resolvedAt.$lte = e; }
        }

        const tasks = await Task.find(filter)
            .populate("assignedTo", "firstName lastName employeeId department designation profileImage")
            .lean();

        // ── Build per-employee performance ────────────────────────────────────────
        const empMap = {};
        tasks.forEach((task) => {
            const emp = task.assignedTo;
            if (!emp) return;
            const key = emp._id.toString();
            if (!empMap[key]) {
                empMap[key] = {
                    employeeId: emp.employeeId,
                    name: `${emp.firstName} ${emp.lastName}`,
                    department: emp.department,
                    designation: emp.designation,
                    counts: {
                        total: 0, completed: 0, completedOnTime: 0, completedLate: 0,
                        pending: 0, inProgress: 0, overtime: 0, revoked: 0,
                        incomplete: 0, awaitingReview: 0
                    },
                };
            }
            const c = empMap[key].counts;
            c.total++;
            switch (task.status) {
                case "completed":
                    c.completed++;
                    if (task.resolvedAt && task.deadline &&
                        new Date(task.resolvedAt) <= new Date(task.deadline)) c.completedOnTime++;
                    else c.completedLate++;
                    break;
                case "pending": c.pending++; break;
                case "in_progress": c.inProgress++; break;
                case "overtime": c.overtime++; break;
                case "revoked": c.revoked++; break;
                case "incomplete": c.incomplete++; break;
                case "completed_by_employee": c.awaitingReview++; break;
            }
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Performance Report");

        worksheet.columns = [
            { header: "Employee ID", key: "employeeId", width: 15 },
            { header: "Name", key: "name", width: 25 },
            { header: "Department", key: "department", width: 20 },
            { header: "Designation", key: "designation", width: 20 },
            { header: "Total Tasks", key: "total", width: 12 },
            { header: "Effective Tasks", key: "effective", width: 15 },
            { header: "Completed", key: "completed", width: 12 },
            { header: "Completed On Time", key: "onTime", width: 18 },
            { header: "Completed Late", key: "late", width: 15 },
            { header: "Pending", key: "pending", width: 12 },
            { header: "In Progress", key: "inProgress", width: 13 },
            { header: "Overtime", key: "overtime", width: 12 },
            { header: "Revoked", key: "revoked", width: 12 },
            { header: "Incomplete", key: "incomplete", width: 12 },
            { header: "Awaiting Review", key: "awaitingReview", width: 16 },
            { header: "Completion Rate", key: "completionRate", width: 16 },
            { header: "On-Time Rate", key: "onTimeRate", width: 14 },
        ];

        // Header styling
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002B38" } };
        headerRow.alignment = { vertical: "middle", horizontal: "center" };
        headerRow.height = 22;

        Object.values(empMap).forEach((e) => {
            const c = e.counts;
            const effective = c.total - c.revoked;
            const completionRate = effective > 0 ? Math.round((c.completed / effective) * 100) : 0;
            const onTimeRate = c.completed > 0 ? Math.round((c.completedOnTime / c.completed) * 100) : 0;

            const row = worksheet.addRow({
                employeeId: e.employeeId,
                name: e.name,
                department: e.department,
                designation: e.designation,
                total: c.total,
                effective,
                completed: c.completed,
                onTime: c.completedOnTime,
                late: c.completedLate,
                pending: c.pending,
                inProgress: c.inProgress,
                overtime: c.overtime,
                revoked: c.revoked,
                incomplete: c.incomplete,
                awaitingReview: c.awaitingReview,
                completionRate: `${completionRate}%`,
                onTimeRate: `${onTimeRate}%`,
            });

            // Color code by completion rate
            const bgColor =
                completionRate >= 80 ? "FFD4EDDA" :   // green — good
                    completionRate >= 50 ? "FFFFF3CD" :   // yellow — average
                        "FFF8D7DA";    // red — poor

            row.eachCell((cell) => {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
                cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
                cell.alignment = { vertical: "middle" };
            });
        });

        const now = new Date();
        const today = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
        res.setHeader("Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=performance-report-${today}.xlsx`
        );

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("exportPerformanceReport:", err);
        res.status(500).json({ success: false, message: "Failed to export performance report" });
    }
};