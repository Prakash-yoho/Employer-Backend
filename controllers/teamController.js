// controllers/teamController.js
import mongoose from "mongoose";
import { createTeamValidator, updateTeamValidator } from "../validations/projectmanagementValidation.js";
import Employee from "../model/Employer/Employee.js";
import Projects from "../model/Projects.js";
import Team from "../model/Team.js";

// ── CREATE TEAM ───────────────────────────────────────────────────────────────
// teamLead is optional. teamId is auto-generated (TEAM001, TEAM002 …)
export const createTeam = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { error, value } = createTeamValidator.validate(req.body, { abortEarly: false });
        if (error) {
            await session.abortTransaction();
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }

        const { teamName, description, project, teamLead, members } = value;

        // ── Validate TL (only if provided) ────────────────────────────────────
        if (teamLead) {
            const tl = await Employee.findOne({ _id: teamLead, role: "TL", isTL: true }).session(session);
            if (!tl) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: "Provided team lead is not a valid TL" });
            }
        }

        // ── Validate project (if provided) ────────────────────────────────────
        if (project) {
            const proj = await Projects.findById(project).session(session);
            if (!proj) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: "Project not found" });
            }
        }

        // ── Validate members ──────────────────────────────────────────────────
        const memberIds = members ? [...new Set(members)] : [];

        if (teamLead && memberIds.includes(teamLead)) {
            await session.abortTransaction();
            return res.status(400).json({ success: false, message: "Team lead cannot also be listed as a member" });
        }

        if (memberIds.length > 0) {
            const employees = await Employee.find({ _id: { $in: memberIds }, isActive: true }).session(session);
            if (employees.length !== memberIds.length) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: "One or more member IDs are invalid or inactive" });
            }
            const alreadyInTeam = employees.filter((e) => e.currentTeam?.teamId != null);
            if (alreadyInTeam.length > 0) {
                await session.abortTransaction();
                return res.status(400).json({
                    success: false,
                    message: "Some members are already assigned to a team",
                    conflicts: alreadyInTeam.map((e) => ({
                        _id: e._id,
                        name: `${e.firstName} ${e.lastName}`,
                        currentTeam: e.currentTeam.teamName,
                    })),
                });
            }
        }

        // ── Create team (new + save so pre("save") hook fires for teamId) ──────
        const team = new Team({
            teamName,
            description,
            project: project || null,
            teamLead: teamLead || null,
            members: memberIds,
            createdBy: req.user._id,
        });
        await team.save({ session });

        // ── Set currentTeam on each member ────────────────────────────────────
        if (memberIds.length > 0) {
            await Employee.updateMany(
                { _id: { $in: memberIds } },
                {
                    $set: {
                        "currentTeam.teamId": team._id,
                        "currentTeam.teamName": teamName,
                        "currentTeam.joinedAt": new Date(),
                    }
                },
                { session }
            );
        }

        await session.commitTransaction();

        const populated = await Team.findById(team._id)
            .populate("teamLead", "firstName lastName employeeId department designation")
            .populate("members", "firstName lastName employeeId department designation")
            .populate("project", "projectId projectName status");

        return res.status(201).json({ success: true, message: "Team created successfully", data: populated });
    } catch (err) {
        await session.abortTransaction();
        console.error("createTeam:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    } finally {
        session.endSession();
    }
};
// ── GET ALL TEAMS ─────────────────────────────────────────────────────────────
// No pagination. Query: search, project, isActive, showDeleted
export const getAllTeams = async (req, res) => {
    try {
        const { search, project, isActive, showDeleted = "false" } = req.query;
        const filter = {};

        if (search) filter.teamName = { $regex: search, $options: "i" };
        if (project) filter.project = project;
        if (isActive !== undefined && isActive !== "") filter.isActive = isActive === "true";

        const queryOptions = showDeleted === "true" ? { includeDeleted: true } : {};
        if (showDeleted === "true") filter.isDeleted = true;

        const teams = await Team.find(filter, null, queryOptions)
            .populate("teamLead", "firstName lastName employeeId department designation profileImage")
            .populate("members", "firstName lastName employeeId department designation profileImage")
            .populate("project", "projectId projectName status startDate endDate")
            .populate("createdBy", "firstName lastName email")
            .populate("deletedBy", "firstName lastName email")
            .sort({ createdAt: -1 });

        // ── STATISTICS ──────────────────────────────────────────────────────
        const uniqueProjects = new Set(
            teams
                .filter((t) => t.project)
                .map((t) => t.project._id.toString())
        );

        const uniqueTeamLeads = new Set(
            teams
                .filter((t) => t.teamLead)
                .map((t) => t.teamLead._id.toString())
        );

        const uniqueMembers = new Set(
            teams.flatMap((t) =>
                (t.members || []).map((m) => m._id.toString())
            )
        );

        const activeTeams  = teams.filter((t) => t.isActive).length;
        const deletedTeams = teams.filter((t) => t.isDeleted).length;

        const stats = {
            totalTeams      : teams.length,
            activeTeams,
            inactiveTeams   : teams.length - activeTeams - deletedTeams,
            deletedTeams,
            totalProjects   : uniqueProjects.size,
            totalTeamLeads  : uniqueTeamLeads.size,
            totalMembers    : uniqueMembers.size,
        };
        // ────────────────────────────────────────────────────────────────────

        return res.status(200).json({ success: true, stats, total: teams.length, data: teams });
    } catch (err) {
        console.error("getAllTeams:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ── GET SINGLE TEAM ───────────────────────────────────────────────────────────
export const getTeamById = async (req, res) => {
    try {
        const team = await Team.findById(req.params.id)
            .populate("teamLead", "firstName lastName employeeId department designation profileImage officialEmail")
            .populate("members", "firstName lastName employeeId department designation profileImage officialEmail")
            .populate("project", "projectId projectName description status startDate endDate budget client")
            .populate("createdBy", "firstName lastName email")
            .populate("deletedBy", "firstName lastName email");

        if (!team) return res.status(404).json({ success: false, message: "Team not found" });

        return res.status(200).json({ success: true, data: team });
    } catch (err) {
        console.error("getTeamById:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ── UPDATE TEAM ───────────────────────────────────────────────────────────────
// members[] = full new list (diff auto-computed; omitted members get removed)
// teamLead: null = remove TL
export const updateTeam = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { error, value } = updateTeamValidator.validate(req.body, { abortEarly: false });
        if (error) {
            await session.abortTransaction();
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map((d) => d.message),
            });
        }

        const team = await Team.findById(req.params.id).session(session);
        if (!team) {
            await session.abortTransaction();
            return res.status(404).json({ success: false, message: "Team not found" });
        }

        if (team.isDeleted) {
            await session.abortTransaction();
            return res.status(400).json({ success: false, message: "Cannot update a deleted team. Restore it first." });
        }

        const { teamName, description, project, teamLead, members, isActive } = value;

        // ── Handle teamLead ────────────────────────────────────────────────────
        if (teamLead !== undefined) {
            if (teamLead === null || teamLead === "") {
                team.teamLead = null;
            } else if (teamLead !== team.teamLead?.toString()) {
                const newTL = await Employee.findOne({ _id: teamLead, role: "TL", isTL: true }).session(session);
                if (!newTL) {
                    await session.abortTransaction();
                    return res.status(400).json({ success: false, message: "Provided team lead is not a valid TL" });
                }
                team.teamLead = teamLead;
            }
        }

        // ── Handle members ─────────────────────────────────────────────────────
        if (members !== undefined) {
            const newMemberIds = [...new Set(members)];
            const currentMemberIds = team.members.map((m) => m.toString());
            const addedIds = newMemberIds.filter((id) => !currentMemberIds.includes(id));
            const removedIds = currentMemberIds.filter((id) => !newMemberIds.includes(id));

            if (addedIds.length > 0) {
                const addedEmployees = await Employee.find({ _id: { $in: addedIds }, isActive: true }).session(session);
                if (addedEmployees.length !== addedIds.length) {
                    await session.abortTransaction();
                    return res.status(400).json({ success: false, message: "One or more new member IDs are invalid or inactive" });
                }
                const conflicts = addedEmployees.filter((e) => e.currentTeam?.teamId != null);
                if (conflicts.length > 0) {
                    await session.abortTransaction();
                    return res.status(400).json({
                        success: false,
                        message: "Some new members are already in another team",
                        conflicts: conflicts.map((e) => ({
                            _id: e._id,
                            name: `${e.firstName} ${e.lastName}`,
                            currentTeam: e.currentTeam.teamName,
                        })),
                    });
                }
                await Employee.updateMany(
                    { _id: { $in: addedIds } },
                    {
                        $set: {
                            "currentTeam.teamId": team._id,
                            "currentTeam.teamName": teamName ?? team.teamName,
                            "currentTeam.joinedAt": new Date(),
                        }
                    },
                    { session }
                );
            }

            if (removedIds.length > 0) {
                await Employee.updateMany(
                    { _id: { $in: removedIds } },
                    {
                        $set: {
                            "currentTeam.teamId": null,
                            "currentTeam.teamName": null,
                            "currentTeam.joinedAt": null,
                        }
                    },
                    { session }
                );
            }

            team.members = newMemberIds;
        }

        // Sync teamName on members' currentTeam if name changed
        if (teamName && teamName !== team.teamName) {
            await Employee.updateMany(
                { "currentTeam.teamId": team._id },
                { $set: { "currentTeam.teamName": teamName } },
                { session }
            );
        }

        if (teamName !== undefined) team.teamName = teamName;
        if (description !== undefined) team.description = description;
        if (project !== undefined) team.project = project || null;
        if (isActive !== undefined) team.isActive = isActive;

        await team.save({ session });
        await session.commitTransaction();

        const populated = await Team.findById(team._id)
            .populate("teamLead", "firstName lastName employeeId department designation")
            .populate("members", "firstName lastName employeeId department designation")
            .populate("project", "projectId projectName status");

        return res.status(200).json({ success: true, message: "Team updated successfully", data: populated });
    } catch (err) {
        await session.abortTransaction();
        console.error("updateTeam:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    } finally {
        session.endSession();
    }
};

// ── SOFT DELETE TEAM ──────────────────────────────────────────────────────────
// Marks isDeleted: true — team is hidden but recoverable
// Also clears currentTeam on all members
export const softDeleteTeam = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const team = await Team.findById(req.params.id).session(session);
        if (!team) {
            await session.abortTransaction();
            return res.status(404).json({ success: false, message: "Team not found" });
        }

        if (team.isDeleted) {
            await session.abortTransaction();
            return res.status(400).json({ success: false, message: "Team is already deleted" });
        }

        // Clear currentTeam from all members
        if (team.members.length > 0) {
            await Employee.updateMany(
                { "currentTeam.teamId": team._id },
                {
                    $set: {
                        "currentTeam.teamId": null,
                        "currentTeam.teamName": null,
                        "currentTeam.joinedAt": null,
                    }
                },
                { session }
            );
        }

        team.isDeleted = true;
        team.deletedAt = new Date();
        team.deletedBy = req.user._id;
        team.isActive = false;
        await team.save({ session });

        await session.commitTransaction();
        return res.status(200).json({ success: true, message: "Team soft deleted successfully" });
    } catch (err) {
        await session.abortTransaction();
        console.error("softDeleteTeam:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    } finally {
        session.endSession();
    }
};

// ── RESTORE TEAM ──────────────────────────────────────────────────────────────
export const restoreTeam = async (req, res) => {
    try {
        const team = await Team.findById(req.params.id, null, { includeDeleted: true });
        if (!team) return res.status(404).json({ success: false, message: "Team not found" });

        if (!team.isDeleted) {
            return res.status(400).json({ success: false, message: "Team is not deleted" });
        }

        team.isDeleted = false;
        team.deletedAt = null;
        team.deletedBy = null;
        team.isActive = true;
        await team.save();

        return res.status(200).json({ success: true, message: "Team restored successfully", data: team });
    } catch (err) {
        console.error("restoreTeam:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};

// ── HARD DELETE TEAM ──────────────────────────────────────────────────────────
// Permanently removes the team regardless of soft-delete state.
// Clears currentTeam on all members and TL reference is naturally gone with the team.
export const hardDeleteTeam = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        // includeDeleted: true so it works even if already soft-deleted
        const team = await Team.findById(req.params.id, null, { includeDeleted: true }).session(session);
        if (!team) {
            await session.abortTransaction();
            return res.status(404).json({ success: false, message: "Team not found" });
        }

        // Clear currentTeam from all members of this team
        if (team.members.length > 0) {
            await Employee.updateMany(
                { "currentTeam.teamId": team._id },
                {
                    $set: {
                        "currentTeam.teamId": null,
                        "currentTeam.teamName": null,
                        "currentTeam.joinedAt": null,
                    },
                },
                { session }
            );
        }

        await team.deleteOne({ session });
        await session.commitTransaction();

        return res.status(200).json({ success: true, message: "Team permanently deleted" });
    } catch (err) {
        await session.abortTransaction();
        console.error("hardDeleteTeam:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    } finally {
        session.endSession();
    }
};

// ── GET TEAMS BY TL ───────────────────────────────────────────────────────────
export const getTeamsByTL = async (req, res) => {
    try {
        const { tlId } = req.params;

        const tl = await Employee.findOne({ _id: tlId, role: "TL" })
            .select("firstName lastName employeeId department");
        if (!tl) return res.status(404).json({ success: false, message: "Team Lead not found" });

        const teams = await Team.find({ teamLead: tlId })
            .populate("members", "firstName lastName employeeId department designation profileImage")
            .populate("project", "projectId projectName status startDate endDate");

        return res.status(200).json({
            success: true,
            data: { tl, totalTeams: teams.length, teams },
        });
    } catch (err) {
        console.error("getTeamsByTL:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// PM / ADMIN / HR: Get all employees not assigned to any team
// GET /api/pm/employees/unassigned
// Query: ?search=&department=
// ─────────────────────────────────────────────────────────────────────────────
export const getUnassignedEmployees = async (req, res) => {
    try {
        const { search, department } = req.query;

        const filter = {
            isActive: true,
            isTL: false,
            "currentTeam.teamId": null,
        };

        if (department) filter.department = department;
        if (search) {
            filter.$or = [
                { firstName: { $regex: search, $options: "i" } },
                { lastName: { $regex: search, $options: "i" } },
                { employeeId: { $regex: search, $options: "i" } },
                { officialEmail: { $regex: search, $options: "i" } },
            ];
        }

        const employees = await Employee.find(filter)
            .select("firstName lastName employeeId officialEmail department designation profileImage role isTL currentTeam")
            .sort({ firstName: 1 });

        return res.status(200).json({
            success: true,
            total: employees.length,
            data: employees,
        });
    } catch (err) {
        console.error("getUnassignedEmployees:", err);
        return res.status(500).json({ success: false, message: "Server error", error: err.message });
    }
};