// controllers/tlController.js

import Employee from "../model/Employee.js";
import Team from "../model/Team.js";
import { assignTLValidator, removeTLValidator } from "../validations/projectmanagementValidation.js";

// ── ASSIGN TL(s) ──────────────────────────────────────────────────────────────
// Accepts single employeeId (string) OR employeeIds (array) — both work
export const assignTL = async (req, res) => {
    try {
        const { error, value } = assignTLValidator.validate(req.body, { abortEarly: false });
        if (error) {
            const messages = error.details.map((d) => d.message);
            return res.status(400).json({ success: false, message: "Validation failed", errors: messages });
        }

        const raw = value.employeeIds ?? value.employeeId;
        const employeeIds = Array.isArray(raw) ? raw : [raw];

        if (!employeeIds.length || employeeIds.some((id) => !id)) {
            return res.status(400).json({
                success: false,
                message: "employeeId (string) or employeeIds (array) is required",
            });
        }

        const employees = await Employee.find({ _id: { $in: employeeIds } });

        if (employees.length !== employeeIds.length) {
            const foundIds = employees.map((e) => e._id.toString());
            const missing = employeeIds.filter((id) => !foundIds.includes(id));
            return res.status(404).json({
                success: false,
                message: "One or more employees not found",
                missingIds: missing,
            });
        }

        const alreadyTL = employees.filter((e) => e.role === "TL");
        const toPromote = employees.filter((e) => e.role !== "TL");

        if (toPromote.length === 0) {
            return res.status(400).json({
                success: false,
                message: "All selected employees are already Team Leads",
                alreadyTL: alreadyTL.map((e) => ({
                    _id: e._id,
                    name: `${e.firstName} ${e.lastName}`,
                    employeeId: e.employeeId,
                })),
            });
        }

        await Employee.updateMany(
            { _id: { $in: toPromote.map((e) => e._id) } },
            { $set: { role: "TL", isTL: true } }
        );

        const promoted = toPromote.map((e) => ({
            _id: e._id,
            employeeId: e.employeeId,
            name: `${e.firstName} ${e.lastName}`,
            role: "TL",
            isTL: true,
        }));

        return res.status(200).json({
            success: true,
            message: `${toPromote.length} employee(s) assigned as Team Lead`,
            promoted,
            ...(alreadyTL.length > 0 && {
                skipped: {
                    reason: "Already a Team Lead",
                    employees: alreadyTL.map((e) => ({
                        _id: e._id,
                        name: `${e.firstName} ${e.lastName}`,
                        employeeId: e.employeeId,
                    })),
                },
            }),
        });
    } catch (err) {
        console.error("assignTL:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ── REMOVE TL ─────────────────────────────────────────────────────────────────
export const removeTL = async (req, res) => {
    try {
        const { error, value } = removeTLValidator.validate(req.body, { abortEarly: false });
        if (error) {
            const messages = error.details.map((d) => d.message);
            return res.status(400).json({ success: false, message: "Validation failed", errors: messages });
        }

        const { employeeId } = value;

        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        if (employee.role !== "TL") {
            return res.status(400).json({ success: false, message: "Employee is not a Team Lead" });
        }

        // ── Block if TL has teams linked to active projects ───────────────────
        const teamsWithActiveProjects = await Team.find({ teamLead: employee._id, isActive: true })
            .populate("project", "projectName status")
            .select("_id teamName project");

        const blockedTeams = teamsWithActiveProjects.filter(
            (t) => t.project && t.project.status === "active"
        );

        if (blockedTeams.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot remove TL — they are leading ${blockedTeams.length} team(s) with active projects. Reassign or complete those projects first.`,
                blockedTeams: blockedTeams.map((t) => ({
                    _id: t._id,
                    teamName: t.teamName,
                    projectName: t.project.projectName,
                    projectStatus: t.project.status,
                })),
            });
        }

        // ── Remove TL from all their teams (set teamLead → null) ──────────────
        const allLeadingTeams = await Team.find({ teamLead: employee._id });

        if (allLeadingTeams.length > 0) {
            await Team.updateMany(
                { teamLead: employee._id },
                { $set: { teamLead: null } }
            );
        }

        // ── Demote employee ───────────────────────────────────────────────────
        employee.role = "Employee";
        employee.isTL = false;
        await employee.save();

        return res.status(200).json({
            success: true,
            message: `${employee.firstName} ${employee.lastName} has been removed as Team Lead`,
            teamsUpdated: allLeadingTeams.length,
            data: {
                _id: employee._id,
                employeeId: employee.employeeId,
                name: `${employee.firstName} ${employee.lastName}`,
                role: employee.role,
                isTL: employee.isTL,
            },
        });
    } catch (err) {
        console.error("removeTL:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ── GET ALL TLs ───────────────────────────────────────────────────────────────
// No pagination — returns all TLs with their teams[] and projects[]
export const getAllTLs = async (req, res) => {
    try {
        const { search } = req.query;

        const filter = { role: "TL", isTL: true };
        if (search) {
            filter.$or = [
                { firstName: { $regex: search, $options: "i" } },
                { lastName: { $regex: search, $options: "i" } },
                { employeeId: { $regex: search, $options: "i" } },
            ];
        }

        const tls = await Employee.find(filter)
            .select("_id employeeId firstName lastName officialEmail department designation profileImage currentTeam isTL role")
            .sort({ firstName: 1 });

        const tlIds = tls.map((t) => t._id);
        const allTeams = await Team.find({ teamLead: { $in: tlIds } })
            .select("_id teamName description project isActive members teamLead")
            .populate("project", "projectId projectName status")
            .populate("members", "firstName lastName employeeId");

        const dataMap = {};
        allTeams.forEach((team) => {
            const key = team.teamLead.toString();
            if (!dataMap[key]) dataMap[key] = { teams: [], projects: [] };

            dataMap[key].teams.push({
                _id: team._id,
                teamName: team.teamName,
                description: team.description,
                isActive: team.isActive,
                memberCount: team.members.length,
                members: team.members,
            });

            if (team.project) {
                const alreadyAdded = dataMap[key].projects.some(
                    (p) => p._id.toString() === team.project._id.toString()
                );
                if (!alreadyAdded) dataMap[key].projects.push(team.project);
            }
        });

        const result = tls.map((tl) => {
            const entry = dataMap[tl._id.toString()] ?? { teams: [], projects: [] };
            return {
                ...tl.toObject(),
                teams: entry.teams,
                totalTeams: entry.teams.length,
                projects: entry.projects,
                totalProjects: entry.projects.length,
            };
        });

        return res.status(200).json({
            success: true,
            total: result.length,
            data: result,
        });
    } catch (err) {
        console.error("getAllTLs:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ── GET SINGLE TL ─────────────────────────────────────────────────────────────
export const getTLById = async (req, res) => {
    try {
        const tl = await Employee.findOne({ _id: req.params.id, role: "TL" })
            .select("_id employeeId firstName lastName officialEmail department designation profileImage currentTeam isTL role");
        if (!tl) return res.status(404).json({ success: false, message: "Team Lead not found" });

        const teams = await Team.find({ teamLead: tl._id })
            .populate("project", "projectId projectName status startDate endDate")
            .populate("members", "firstName lastName employeeId department designation profileImage");

        const projectsMap = {};
        teams.forEach((t) => {
            if (t.project) projectsMap[t.project._id.toString()] = t.project;
        });

        return res.status(200).json({
            success: true,
            data: {
                ...tl.toObject(),
                teams: teams.map((t) => ({
                    _id: t._id,
                    teamName: t.teamName,
                    description: t.description,
                    isActive: t.isActive,
                    members: t.members,
                    memberCount: t.members.length,
                    project: t.project ?? null,
                })),
                totalTeams: teams.length,
                projects: Object.values(projectsMap),
                totalProjects: Object.keys(projectsMap).length,
            },
        });
    } catch (err) {
        console.error("getTLById:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ── GET MY DASHBOARD (TL self) ────────────────────────────────────────────────
// Called by the logged-in TL — returns their own profile, all teams they lead,
// members per team, and the project assigned to each team.
// Route: GET /api/pm/tl/me   (authenticateEmployee, authorize(["TL"]))
export const getMyTLDashboard = async (req, res) => {
    try {
        const tl = req.user;

        if (!tl || tl.role !== "TL") {
            return res.status(403).json({ success: false, message: "Access denied. You are not a Team Lead." });
        }

        const teams = await Team.find({ teamLead: tl._id })
            .populate("project", "projectId projectName status startDate endDate description client budget")
            .populate("members", "firstName lastName employeeId department designation profileImage officialEmail");

        // Collect unique projects
        const projectsMap = {};
        teams.forEach((t) => {
            if (t.project) projectsMap[t.project._id.toString()] = t.project;
        });

        return res.status(200).json({
            success: true,
            data: {
                // Only TL identity fields — no personal/sensitive data
                _id: tl._id,
                employeeId: tl.employeeId,
                firstName: tl.firstName,
                lastName: tl.lastName,
                officialEmail: tl.officialEmail,
                department: tl.department,
                designation: tl.designation,
                profileImage: tl.profileImage,
                role: tl.role,

                teams: teams.map((t) => ({
                    _id: t._id,
                    teamId: t.teamId,
                    teamName: t.teamName,
                    description: t.description,
                    isActive: t.isActive,
                    memberCount: t.members.length,
                    members: t.members,
                    project: t.project ?? null,
                })),
                totalTeams: teams.length,
                projects: Object.values(projectsMap),
                totalProjects: Object.keys(projectsMap).length,
            },
        });
    } catch (err) {
        console.error("getMyTLDashboard:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};


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
        // Cover all cases: field is null, undefined, missing, or never set
        const employees = await Employee.find({
            isActive: true,
            $or: [
                { "currentTeam.teamId": null },
                { "currentTeam.teamId": { $exists: false } },
                { currentTeam: null },
                { currentTeam: { $exists: false } },
            ],
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