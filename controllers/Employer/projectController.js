
// import mongoose from "mongoose";
// import Projects from "../../model/Projects.js";
// import Team from "../../model/Team.js";
// import Employee from "../../model/Employee.js";
// import { createProjectValidator, updateProjectValidator } from "../../validations/projectmanagementValidation.js";

// // ── CREATE PROJECT ────────────────────────────────────────────────────────────
// export const createProject = async (req, res) => {
//     try {
//         const { error, value } = createProjectValidator.validate(req.body, { abortEarly: false });
//         if (error) {
//             const messages = error.details.map((d) => d.message);
//             return res.status(400).json({ success: false, message: "Validation failed", errors: messages });
//         }

//         // ── Check for duplicate project name (case-insensitive) ───────────────
//         const existing = await Projects.findOne({
//             projectName: { $regex: `^${value.projectName.trim()}$`, $options: "i" },
//         });
//         if (existing) {
//             return res.status(409).json({
//                 success: false,
//                 message: `A project named "${existing.projectName}" already exists`,
//             });
//         }
//         // ─────────────────────────────────────────────────────────────────────

//         const project = new Projects({
//             ...value,
//             createdBy: req.user._id,
//         });
//         await project.save();

//         return res.status(201).json({
//             success: true,
//             message: "Project created successfully",
//             data: project,
//         });
//     } catch (err) {
//         console.error("createProject:", err);
//         return res.status(500).json({ success: false, message: "Server error", error: err.message });
//     }
// };

// // ── GET ALL PROJECTS ──────────────────────────────────────────────────────────
// // Query: status, search, showDeleted
// export const getAllProjects = async (req, res) => {
//     try {
//         const { status, search, showDeleted = "false" } = req.query;
//         const filter = {};

//         if (status) filter.status = status;
//         if (search) {
//             filter.$or = [
//                 { projectName: { $regex: search, $options: "i" } },
//                 { projectId: { $regex: search, $options: "i" } },
//                 { client: { $regex: search, $options: "i" } },
//             ];
//         }

//         // showDeleted=true → show only soft-deleted records
//         const queryOptions = showDeleted === "true" ? { includeDeleted: true } : {};
//         if (showDeleted === "true") filter.isDeleted = true;

//         const projects = await Projects.find(filter, null, queryOptions)
//             .populate("createdBy", "firstName lastName email role")
//             .populate("deletedBy", "firstName lastName email")
//             .sort({ createdAt: -1 });

//         // ── STATISTICS ──────────────────────────────────────────────────────
//         const countByStatus = (s) => projects.filter((p) => p.status === s).length;

//         const stats = {
//             totalProjects: projects.length,
//             active: countByStatus("active"),
//             completed: countByStatus("completed"),
//             onHold: countByStatus("on_hold"),
//             cancelled: countByStatus("cancelled"),
//             planning: countByStatus("planning"),
//             deleted: projects.filter((p) => p.isDeleted).length,
//         };
//         // ────────────────────────────────────────────────────────────────────

//         return res.status(200).json({
//             success: true,
//             stats,
//             total: projects.length,
//             data: projects,
//         });
//     } catch (err) {
//         console.error("getAllProjects:", err);
//         return res.status(500).json({ success: false, message: "Server error", error: err.message });
//     }
// };

// // ── GET SINGLE PROJECT ────────────────────────────────────────────────────────
// export const getProjectById = async (req, res) => {
//     try {
//         const project = await Projects.findById(req.params.id)
//             .populate("createdBy", "firstName lastName email")
//             .populate("deletedBy", "firstName lastName email");

//         if (!project) return res.status(404).json({ success: false, message: "Project not found" });

//         return res.status(200).json({ success: true, data: project });
//     } catch (err) {
//         console.error("getProjectById:", err);
//         return res.status(500).json({ success: false, message: "Server error", error: err.message });
//     }
// };

// // ── UPDATE PROJECT ────────────────────────────────────────────────────────────
// export const updateProject = async (req, res) => {
//     try {
//         const { error, value } = updateProjectValidator.validate(req.body, { abortEarly: false });
//         if (error) {
//             const messages = error.details.map((d) => d.message);
//             return res.status(400).json({ success: false, message: "Validation failed", errors: messages });
//         }

//         const project = await Projects.findById(req.params.id);
//         if (!project) return res.status(404).json({ success: false, message: "Project not found" });

//         if (project.isDeleted) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Cannot update a deleted project. Restore it first.",
//             });
//         }

//         // ── Check duplicate name only if name is being changed ────────────────
//         if (value.projectName && value.projectName.trim().toLowerCase() !== project.projectName.toLowerCase()) {
//             const existing = await Projects.findOne({
//                 projectName: { $regex: `^${value.projectName.trim()}$`, $options: "i" },
//                 _id: { $ne: req.params.id }, // exclude current project
//             });
//             if (existing) {
//                 return res.status(409).json({
//                     success: false,
//                     message: `A project named "${existing.projectName}" already exists`,
//                 });
//             }
//         }
//         // ─────────────────────────────────────────────────────────────────────

//         const mergedStart = value.startDate ?? project.startDate;
//         const mergedEnd = value.endDate ?? project.endDate;
//         if (mergedStart && mergedEnd && new Date(mergedEnd) < new Date(mergedStart)) {
//             return res.status(400).json({ success: false, message: "End date must be after start date" });
//         }

//         Object.assign(project, value);
//         await project.save();

//         return res.status(200).json({ success: true, message: "Project updated successfully", data: project });
//     } catch (err) {
//         console.error("updateProject:", err);
//         return res.status(500).json({ success: false, message: "Server error", error: err.message });
//     }
// };

//  // Marks isDeleted: true — project is hidden but recoverable
// export const softDeleteProject = async (req, res) => {
//     try {
//         const project = await Projects.findById(req.params.id);
//         if (!project) return res.status(404).json({ success: false, message: "Project not found" });

//         if (project.isDeleted) {
//             return res.status(400).json({ success: false, message: "Project is already deleted" });
//         }

//         project.isDeleted = true;
//         project.deletedAt = new Date();
//         project.deletedBy = req.user._id;
//         await project.save();

//         return res.status(200).json({ success: true, message: "Project soft deleted successfully" });
//     } catch (err) {
//         console.error("softDeleteProject:", err);
//         return res.status(500).json({ success: false, message: "Server error", error: err.message });
//     }
// };

// // ── RESTORE PROJECT ───────────────────────────────────────────────────────────
// // Reverts a soft-deleted project back to active
// export const restoreProject = async (req, res) => {
//     try {
//         // Must bypass the pre-find hook to locate deleted project
//         const project = await Projects.findById(req.params.id, null, { includeDeleted: true });
//         if (!project) return res.status(404).json({ success: false, message: "Project not found" });

//         if (!project.isDeleted) {
//             return res.status(400).json({ success: false, message: "Project is not deleted" });
//         }

//         project.isDeleted = false;
//         project.deletedAt = null;
//         project.deletedBy = null;
//         await project.save();

//         return res.status(200).json({ success: true, message: "Project restored successfully", data: project });
//     } catch (err) {
//         console.error("restoreProject:", err);
//         return res.status(500).json({ success: false, message: "Server error", error: err.message });
//     }
// };

// // ── HARD DELETE PROJECT ───────────────────────────────────────────────────────
// // Permanently removes from DB — only works on already soft-deleted projects

// export const hardDeleteProject = async (req, res) => {
//     const session = await mongoose.startSession();
//     session.startTransaction();
//     try {
//         const project = await Projects.findById(req.params.id, null, { includeDeleted: true }).session(session);
//         if (!project) {
//             await session.abortTransaction();
//             return res.status(404).json({ success: false, message: "Project not found" });
//         }

//         // Find all teams linked to this project (active or deleted)
//         const linkedTeams = await Team.find({ project: project._id }, null, { includeDeleted: true }).session(session);

//         if (linkedTeams.length > 0) {
//             const teamIds = linkedTeams.map((t) => t._id);

//             // Clear currentTeam from all employees in those teams
//             await Employee.updateMany(
//                 { "currentTeam.teamId": { $in: teamIds } },
//                 {
//                     $set: {
//                         "currentTeam.teamId": null,
//                         "currentTeam.teamName": null,
//                         "currentTeam.joinedAt": null,
//                     },
//                 },
//                 { session }
//             );

//             // Hard delete all linked teams
//             await Team.deleteMany({ _id: { $in: teamIds } }, { session });
//         }

//         await project.deleteOne({ session });
//         await session.commitTransaction();

//         return res.status(200).json({
//             success: true,
//             message: "Project permanently deleted",
//             teamsDeleted: linkedTeams.length,
//         });
//     } catch (err) {
//         await session.abortTransaction();
//         console.error("hardDeleteProject:", err);
//         return res.status(500).json({ success: false, message: "Server error", error: err.message });
//     } finally {
//         session.endSession();
//     }
// };


