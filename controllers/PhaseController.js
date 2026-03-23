import Phase from "../model/Phase.js";
import Schedule from "../model/Schedule.js";
import Employee from "../model/Employer/Employee.js";
import ActivityLogPhaseSchedule from "../model/ActivityLogPhaseSchedule.js";
import { createPhaseValidation, updatePhaseValidation } from "../validations/PhaseValidation.js";

// ─── helper ──────────────────────────────────────────────────────────────────
const log = async ({ entity, entityId, action, meta = {}, message, performedBy = null, phaseId = null }) => {
    await ActivityLogPhaseSchedule.create({ entity, entityId, action, meta, message, performedBy, phaseId });
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE PHASE
// ─────────────────────────────────────────────────────────────────────────────
export const createPhase = async (req, res) => {
    try {
        const { error, value } = createPhaseValidation.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation error",
                errors: error.details.map((d) => d.message),
            });
        }

        const { phaseName, location, address } = value;
        const phase = await Phase.create({ phaseName, location, address });

        await log({
            entity: "Phase",
            entityId: phase._id,
            action: "PHASE_CREATED",
            meta: { phaseName, location },
            message: `Phase "${phaseName}" was created.`,
            performedBy: req.user?._id,
            phaseId: phase._id,
        });

        const existingGroups = await Schedule.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: "$scheduleGroupId",
                    fromDate: { $first: "$fromDate" },
                    toDate: { $first: "$toDate" },
                    scheduleNumber: { $first: "$scheduleNumber" },
                    scheduleName: { $first: "$scheduleName" },
                },
            },
            { $sort: { scheduleNumber: 1 } },
        ]);

        const copies = existingGroups.map((g) => ({
            scheduleGroupId: g._id,
            scheduleName: g.scheduleName,
            scheduleNumber: g.scheduleNumber,
            phase: phase._id,
            fromDate: g.fromDate,
            toDate: g.toDate,
            employees: [],
        }));

        if (copies.length > 0) {
            const inserted = await Schedule.insertMany(copies);

            await Promise.all(
                inserted.map((s) =>
                    log({
                        entity: "Schedule",
                        entityId: s._id,
                        action: "SCHEDULE_CREATED",
                        meta: { scheduleName: s.scheduleName, phaseId: phase._id, phaseName },
                        message: `Schedule "${s.scheduleName}" auto-created in new phase "${phaseName}".`,
                        performedBy: req.user?._id,
                        phaseId: phase._id,
                    })
                )
            );
        }

        return res.status(201).json({
            success: true,
            message: `Phase "${phaseName}" created successfully${copies.length > 0 ? ` with ${copies.length} existing schedule(s).` : "."}`,
            data: phase,
        });
    } catch (err) {
        console.error("createPhase error:", err);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL PHASES
// ─────────────────────────────────────────────────────────────────────────────
export const getAllPhases = async (req, res) => {
    try {
        const filter = req.query.includeDeleted === "true" ? {} : { isDeleted: false };
        const phases = await Phase.find(filter).sort({ createdAt: -1 });
        return res.status(200).json({ success: true, count: phases.length, data: phases });
    } catch (err) {
        console.error("getAllPhases error:", err);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL PHASES WITH SCHEDULES
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GET ALL PHASES WITH SCHEDULES  (drop-in replacement)
// Now includes a `stats` block used by the home-page stat cards:
//   stats.activePhaseCount          → "TOTAL PHASES"
//   stats.totalEmployees            → "TOTAL EMPLOYEES"
//   stats.totalAvailableEmployees   → "TOTAL AVAILABLE EMPLOYEES"
//   stats.recentChangesCount        → "RECENT CHANGES"
// ─────────────────────────────────────────────────────────────────────────────
export const getAllPhasesWithSchedules = async (req, res) => {
    try {
        const includeDeleted = req.query.includeDeleted === "true";
        const phaseFilter = includeDeleted ? {} : { isDeleted: false };
        const scheduleFilter = includeDeleted ? {} : { isDeleted: false };

        // ── Date helpers ──────────────────────────────────────────────────────
        const REMINDER_DAYS_BEFORE = 3;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const reminderWindowEnd = new Date(today);
        reminderWindowEnd.setDate(today.getDate() + REMINDER_DAYS_BEFORE);
        reminderWindowEnd.setHours(23, 59, 59, 999);

        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);

        const formatDate = (date) =>
            new Date(date).toLocaleDateString("en-GB", {
                day: "2-digit", month: "short", year: "numeric",
            }).replace(/ /g, "-");

        // ── 1. Phases ─────────────────────────────────────────────────────────
        const phases = await Phase.find(phaseFilter).sort({ createdAt: -1 });
        const phaseIds = phases.map((p) => p._id);

        // ── 2. Schedules (populated) ──────────────────────────────────────────
        const schedules = await Schedule.find({ phase: { $in: phaseIds }, ...scheduleFilter })
            .populate(
                "employees.employee",
                "firstName lastName employeeId personalEmail department designation profileImage",
            )
            .sort({ scheduleNumber: 1 });

        // ── 3. Group schedules by phase ───────────────────────────────────────
        const schedulesByPhase = schedules.reduce((acc, s) => {
            const key = s.phase.toString();
            if (!acc[key]) acc[key] = [];

            const doc = s.toObject();
            const activeEmployees = doc.employees.filter((e) => e.isActive);
            const removedEmployees = doc.employees.filter((e) => !e.isActive);

            acc[key].push({
                ...doc,
                employees: activeEmployees,
                removedEmployees,
                activeCount: activeEmployees.length,
                removedCount: removedEmployees.length,
            });
            return acc;
        }, {});

        // ── 4. Latest global schedule group (for expiry warning) ──────────────
        const latestGlobalGroup = await Schedule.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: "$scheduleGroupId",
                    scheduleName: { $first: "$scheduleName" },
                    toDate: { $first: "$toDate" },
                    fromDate: { $first: "$fromDate" },
                },
            },
            { $sort: { toDate: -1 } },
            { $limit: 1 },
        ]);

        let scheduleWarning = null;
        if (latestGlobalGroup.length > 0) {
            const latest = latestGlobalGroup[0];
            const latestToDate = new Date(latest.toDate);
            latestToDate.setHours(23, 59, 59, 999);

            const isExpiringSoon = latestToDate >= today && latestToDate <= reminderWindowEnd;
            if (isExpiringSoon) {
                const daysLeft = Math.ceil((latestToDate - today) / (1000 * 60 * 60 * 24));
                scheduleWarning = {
                    hasWarning: true,
                    scheduleName: latest.scheduleName,
                    expiryDate: formatDate(latest.toDate),
                    daysLeft,
                    message: `Schedule "${latest.scheduleName}" ends on ${formatDate(latest.toDate)} (${daysLeft} day${daysLeft !== 1 ? "s" : ""} left). No upcoming schedule exists. Please create a new schedule.`,
                };
            }
        }

        // ── 5. Build per-phase response with currentSchedule ─────────────────
        const data = phases.map((phase) => {
            const phaseSchedules = schedulesByPhase[phase._id.toString()] || [];

            const currentSchedule = phaseSchedules.find((s) => {
                const from = new Date(s.fromDate); from.setHours(0, 0, 0, 0);
                const to = new Date(s.toDate); to.setHours(23, 59, 59, 999);
                return today >= from && today <= to;
            }) || null;

            // ✅ Count only the active employees in the CURRENT schedule for this phase.
            //    Falls back to 0 if no schedule is active today.
            const currentActiveEmployeeCount = currentSchedule?.activeCount ?? 0;

            return {
                ...phase.toObject(),
                schedules: phaseSchedules,
                currentSchedule,
                currentActiveEmployeeCount,   // ← NEW: used by phase card "Employees" stat box
                scheduleWarning,
            };
        });

        // ── 6. STATS ──────────────────────────────────────────────────────────

        // 6a. Active phase count
        const activePhaseCount = phases.length; // already filtered by isDeleted: false

        // 6b. Employee counts — read directly from the Employee collection so
        //     the numbers always reflect real assignment state, independent of
        //     how many employees the front-end pagination loaded.
        const [totalEmployees, totalAvailableEmployees] = await Promise.all([
            Employee.countDocuments({ isActive: true }),
            Employee.countDocuments({ isActive: true, isAssigned: false }),
        ]);


        // 6c. Recent changes — count ALL activity-log entries across every phase
        //     created in the last 7 days so the home-page card shows a
        //     meaningful, up-to-date number without opening any phase.
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentChangesCount = await ActivityLogPhaseSchedule.countDocuments({
            createdAt: { $gte: sevenDaysAgo },
        });
        const stats = {
            activePhaseCount,           // "TOTAL PHASES"
            totalEmployees,             // "TOTAL EMPLOYEES"
            totalAvailableEmployees,    // "TOTAL AVAILABLE EMPLOYEES"
            recentChangesCount,         // "RECENT CHANGES"
        };

        // ── 7. Response ───────────────────────────────────────────────────────
        return res.status(200).json({
            success: true,
            count: data.length,
            scheduleWarning,
            stats,          // ← consumed by the four stat cards on the home page
            data,
        });

    } catch (err) {
        console.error("getAllPhasesWithSchedules error:", err);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE PHASE BY ID
// ─────────────────────────────────────────────────────────────────────────────
export const getPhaseById = async (req, res) => {
    try {
        const { id } = req.params;
        const phase = await Phase.findOne({ _id: id, isDeleted: false });
        if (!phase) return res.status(404).json({ success: false, message: "Phase not found." });

        const schedules = await Schedule.find({ phase: id, isDeleted: false })
            .populate("employees.employee", "firstName lastName employeeId personalEmail department designation")
            .sort({ scheduleNumber: 1 });

        return res.status(200).json({ success: true, data: { phase, schedules } });
    } catch (err) {
        console.error("getPhaseById error:", err);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE PHASE
// ─────────────────────────────────────────────────────────────────────────────
export const updatePhase = async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = updatePhaseValidation.validate(req.body, { abortEarly: false });
        if (error) {
            return res.status(400).json({
                success: false,
                message: "Validation error",
                errors: error.details.map((d) => d.message),
            });
        }

        const { phaseName, location, address } = value;
        const phase = await Phase.findOne({ _id: id, isDeleted: false });
        if (!phase) return res.status(404).json({ success: false, message: "Phase not found." });

        const changes = {};
        if (phaseName) changes.phaseName = phaseName;
        if (location) changes.location = location;
        if (address) changes.address = address;

        Object.assign(phase, changes);
        await phase.save();

        await log({
            entity: "Phase",
            entityId: phase._id,
            action: "PHASE_UPDATED",
            meta: changes,
            message: `Phase "${phase.phaseName}" was updated.`,
            performedBy: req.user?._id,
            phaseId: phase._id,
        });

        return res.status(200).json({ success: true, message: "Phase updated successfully.", data: phase });
    } catch (err) {
        console.error("updatePhase error:", err);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SOFT DELETE PHASE
// When a phase is deleted:
//   1. Find all active schedules in the phase
//   2. Soft-remove every active employee from each schedule
//      (isActive=false, removedAt set) — preserves history for getMySchedule
//   3. Clear currentSchedule / isAssigned on each affected employee
//   4. Write EMPLOYEE_REMOVED log per employee (with reason: phase deleted)
// ─────────────────────────────────────────────────────────────────────────────
export const deletePhase = async (req, res) => {
    try {
        const { id } = req.params;

        // Find phase (no isDeleted filter — works with or without soft-delete)
        const phase = await Phase.findById(id);
        if (!phase) return res.status(404).json({ success: false, message: "Phase not found." });

        // Find ALL schedules for this phase (no isDeleted filter)
        const schedules = await Schedule.find({ phase: id });

        const removedAt = new Date();
        const removedEmployeeIds = [];

        for (const schedule of schedules) {
            const activeEntries = schedule.employees.filter((e) => e.isActive);
            if (activeEntries.length === 0) continue;

            const idsInThisSchedule = activeEntries.map((e) => e.employee.toString());
            removedEmployeeIds.push(...idsInThisSchedule);

            // Log each removal before hard delete
            const employeeDocs = await Employee.find({ _id: { $in: idsInThisSchedule } }).select("firstName lastName");
            await Promise.all(
                employeeDocs.map((emp) =>
                    log({
                        entity: "Schedule",
                        entityId: schedule._id,
                        phaseId: phase._id,
                        action: "EMPLOYEE_REMOVED",
                        meta: {
                            employeeId: emp._id,
                            employeeName: `${emp.firstName} ${emp.lastName}`,
                            scheduleName: schedule.scheduleName,
                            phaseName: phase.phaseName,
                            reason: "Phase permanently deleted",
                        },
                        message: `${emp.firstName} ${emp.lastName} was removed from "${schedule.scheduleName}" in phase "${phase.phaseName}" because the phase was permanently deleted.`,
                        performedBy: req.user?._id,
                    })
                )
            );
        }

        // ✅ Clear isAssigned + currentSchedule on all affected employees
        const uniqueRemovedIds = [...new Set(removedEmployeeIds)];
        if (uniqueRemovedIds.length > 0) {
            await Employee.updateMany(
                { _id: { $in: uniqueRemovedIds } },
                {
                    $set: {
                        isAssigned: false,
                        currentSchedule: {
                            scheduleId: null,
                            scheduleGroupId: null,
                            scheduleName: null,
                            phaseId: null,
                            phaseName: null,
                            fromDate: null,
                            toDate: null,
                            assignedAt: null,
                        },
                    },
                }
            );
        }

        // ✅ HARD DELETE all schedules in this phase
        await Schedule.deleteMany({ phase: id });

        // ✅ HARD DELETE the phase
        await Phase.deleteOne({ _id: id });

        await log({
            entity: "Phase",
            entityId: phase._id,
            action: "PHASE_DELETED",
            meta: {
                phaseName: phase.phaseName,
                schedulesDeleted: schedules.length,
                employeesCleared: uniqueRemovedIds.length,
            },
            message: `Phase "${phase.phaseName}" permanently deleted along with ${schedules.length} schedule(s). ${uniqueRemovedIds.length} employee(s) made available.`,
            performedBy: req.user?._id,
            phaseId: phase._id,
        });

        return res.status(200).json({
            success: true,
            message: `Phase "${phase.phaseName}" permanently deleted.`,
            summary: {
                schedulesDeleted: schedules.length,
                employeesCleared: uniqueRemovedIds.length,
            },
        });
    } catch (err) {
        console.error("deletePhase error:", err);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE PHASE
// ─────────────────────────────────────────────────────────────────────────────
export const restorePhase = async (req, res) => {
    try {
        const { id } = req.params;

        const phase = await Phase.findOne({ _id: id, isDeleted: true });
        if (!phase) return res.status(404).json({ success: false, message: "Deleted phase not found." });

        phase.isDeleted = false;
        phase.deletedAt = null;
        await phase.save();

        await Schedule.updateMany(
            { phase: id, isDeleted: true },
            { isDeleted: false, deletedAt: null }
        );

        await log({
            entity: "Phase",
            entityId: phase._id,
            action: "PHASE_RESTORED",
            meta: { phaseName: phase.phaseName },
            message: `Phase "${phase.phaseName}" was restored.`,
            performedBy: req.user?._id,
            phaseId: phase._id,
        });

        return res.status(200).json({
            success: true,
            message: `Phase "${phase.phaseName}" restored successfully.`,
        });
    } catch (err) {
        console.error("restorePhase error:", err);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
};