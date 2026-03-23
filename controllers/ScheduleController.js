import Schedule from "../model/Schedule.js";
import Phase from "../model/Phase.js";
import Employee from "../model/Employee.js";
import mongoose from "mongoose";
import ActivityLogPhaseSchedule from "../model/ActivityLogPhaseSchedule.js";
import { createScheduleValidation, updateScheduleValidation } from "../validations/ScheduleValidation.js";
import NotificationService from "../services/notificationService.js";

const log = async ({ entity, entityId, action, meta = {}, message, performedBy = null, phaseId = null }) => {
  await ActivityLogPhaseSchedule.create({ entity, entityId, action, meta, message, performedBy, phaseId });
};

// An employee is "busy" (unavailable) if:
//   - their entry is active (not manually removed), AND
//   - the schedule has NOT yet expired (toDate >= today)
// This covers BOTH currently-active AND upcoming schedules so an employee
// cannot be double-booked into two future/active schedules simultaneously.
const isBusy = (entry, scheduleFromDate, scheduleToDate) => {
  if (!entry.isActive) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const to = new Date(scheduleToDate);
  to.setHours(23, 59, 59, 999);
  // Busy as long as the schedule hasn't ended yet (active or upcoming)
  return today <= to;
};

const hasOverlap = (newFrom, newTo, existingFrom, existingTo) => {
  return newFrom <= existingTo && newTo >= existingFrom;
};

// Returns true when a schedule's toDate has already passed today.
// Expired schedules are read-only — employees cannot be added or removed.
const isScheduleExpired = (toDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const to = new Date(toDate);
  to.setHours(23, 59, 59, 999);
  return today > to;
};

// Returns true if the schedule is currently active (started and not yet ended).
// Only active schedules should overwrite currentSchedule on the Employee doc.
// Future (upcoming) schedules should NOT overwrite currentSchedule — the midnight
// cron (clearExpiredAssignments) promotes them when their fromDate arrives.
const isScheduleActiveToday = (fromDate, toDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(fromDate);
  const to = new Date(toDate);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return today >= from && today <= to;
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE SCHEDULE
// ─────────────────────────────────────────────────────────────────────────────
export const createSchedule = async (req, res) => {
  try {
    const { error, value } = createScheduleValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((d) => d.message),
      });
    }

    const { fromDate, toDate } = value;
    const newFrom = new Date(fromDate);
    const newTo = new Date(toDate);
    // newFrom.setHours(0, 0, 0, 0);
    newTo.setHours(23, 59, 59, 999);

    const existingSchedules = await Schedule.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$scheduleGroupId", fromDate: { $first: "$fromDate" }, toDate: { $first: "$toDate" }, name: { $first: "$scheduleName" } } },
    ]);

    const overlapping = existingSchedules.filter((s) =>
      hasOverlap(newFrom, newTo, new Date(s.fromDate), new Date(s.toDate))
    );

    if (overlapping.length > 0) {
      const latestEnd = existingSchedules.reduce((max, s) => {
        const d = new Date(s.toDate);
        return d > max ? d : max;
      }, new Date(0));
      const nextValidStart = new Date(latestEnd);
      nextValidStart.setDate(nextValidStart.getDate() + 1);
      const nextValidStr = nextValidStart.toISOString().slice(0, 10);
      return res.status(400).json({
        success: false,
        message: `Schedule dates overlap. Next valid start date is ${nextValidStr}.`,
        overlappingSchedules: overlapping.map((s) => ({
          scheduleName: s.name,
          from: new Date(s.fromDate).toISOString().slice(0, 10),
          to: new Date(s.toDate).toISOString().slice(0, 10),
        })),
        nextValidStartDate: nextValidStr,
      });
    }

    const phases = await Phase.find({ isDeleted: false });
    if (phases.length === 0) {
      return res.status(400).json({ success: false, message: "No active phases found. Please create a phase first." });
    }

    const scheduleGroupId = new mongoose.Types.ObjectId();
    const maxDoc = await Schedule.findOne({ isDeleted: false }).sort({ scheduleNumber: -1 });
    const nextNumber = maxDoc ? maxDoc.scheduleNumber + 1 : 1;
    const scheduleName = `SCH-${nextNumber}`;

    const docs = phases.map((phase) => ({
      scheduleGroupId,
      scheduleName,
      scheduleNumber: nextNumber,
      phase: phase._id,
      fromDate: newFrom,
      toDate: newTo,
      employees: [],
      isDeleted: false,
      deletedAt: null,
    }));

    const inserted = await Schedule.insertMany(docs);

    await log({
      entity: "Schedule",
      entityId: scheduleGroupId,
      action: "SCHEDULE_GROUP_CREATED",
      meta: { scheduleName, fromDate, toDate, phaseCount: phases.length },
      message: `Schedule "${scheduleName}" created across ${phases.length} phase(s) from ${fromDate} to ${toDate}.`,
      performedBy: req.user?._id,
    });

    await Promise.all(
      inserted.map((s, i) =>
        log({
          entity: "Schedule",
          entityId: s._id,
          action: "SCHEDULE_CREATED",
          meta: { scheduleName, phaseId: phases[i]._id, phaseName: phases[i].phaseName },
          message: `Schedule "${scheduleName}" created in phase "${phases[i].phaseName}".`,
          performedBy: req.user?._id,
          phaseId: phases[i]._id,
        })
      )
    );

    return res.status(201).json({
      success: true,
      message: `Schedule "${scheduleName}" created in ${phases.length} phase(s).`,
      data: {
        scheduleGroupId,
        scheduleName,
        scheduleNumber: nextNumber,
        fromDate,
        toDate,
        phases: phases.map((p, i) => ({
          phaseId: p._id,
          phaseName: p.phaseName,
          scheduleId: inserted[i]._id,
        })),
      },
    });
  } catch (err) {
    console.error("createSchedule error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL SCHEDULES GROUPED
// ─────────────────────────────────────────────────────────────────────────────
export const getAllSchedulesGrouped = async (req, res) => {
  try {
    const filter = req.query.includeDeleted === "true" ? {} : { isDeleted: false };

    const schedules = await Schedule.find(filter)
      .populate("phase", "phaseName location address")
      .populate("Employee", "firstName lastName employeeId department designation profileImage")
      .sort({ scheduleNumber: 1 });

    const groupMap = new Map();

    schedules.forEach((s) => {
      const key = s.scheduleGroupId.toString();

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          scheduleGroupId: s.scheduleGroupId,
          scheduleName: s.scheduleName,
          scheduleNumber: s.scheduleNumber,
          fromDate: s.fromDate,
          toDate: s.toDate,
          phases: [],
        });
      }

      const group = groupMap.get(key);
      const activeEmployees = s.employees.filter((e) => e.isActive);

      group.phases.push({
        scheduleId: s._id,
        phaseId: s.phase._id,
        phaseName: s.phase.phaseName,
        location: s.phase.location,
        address: s.phase.address,
        employeeCount: activeEmployees.length,
        employees: activeEmployees.map((e) => ({
          employee: e.employee,
          addedAt: e.addedAt,
          currentlyBusy: isBusy(e, s.fromDate, s.toDate),
        })),
      });
    });

    const result = Array.from(groupMap.values())
      .sort((a, b) => a.scheduleNumber - b.scheduleNumber)
      .map((g) => ({
        ...g,
        totalPhases: g.phases.length,
        totalEmployeesAssigned: g.phases.reduce((sum, p) => sum + p.employeeCount, 0),
      }));

    return res.status(200).json({ success: true, count: result.length, data: result });
  } catch (err) {
    console.error("getAllSchedulesGrouped error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE SCHEDULE GROUP DATES
// ─────────────────────────────────────────────────────────────────────────────
export const updateScheduleGroupDates = async (req, res) => {
  try {
    const { groupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid group ID." });
    }

    const { error, value } = updateScheduleValidation.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((d) => d.message),
      });
    }

    const { fromDate, toDate } = value;
    const resolvedFrom = new Date(fromDate);
    const resolvedTo = new Date(toDate);
    // resolvedFrom.setHours(0, 0, 0, 0);
    resolvedTo.setHours(23, 59, 59, 999);

    if (resolvedFrom >= resolvedTo) {
      return res.status(400).json({ success: false, message: "fromDate must be before toDate." });
    }

    // Guard 1: new dates cannot be in the past.
    // fromDate must be today or future. toDate must be after today.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (resolvedFrom < today) {
      return res.status(400).json({
        success: false,
        message: "fromDate cannot be set to a past date.",
      });
    }
    if (resolvedTo < today) {
      return res.status(400).json({
        success: false,
        message: "toDate cannot be set to a past date.",
      });
    }

    const anyDoc = await Schedule.findOne({ scheduleGroupId: groupId, isDeleted: false });
    if (!anyDoc) return res.status(404).json({ success: false, message: "Schedule group not found." });

    // Guard 2: cannot edit a schedule that has already expired.
    // If the schedule's current toDate is in the past, it is read-only.
    if (isScheduleExpired(anyDoc.toDate)) {
      const expiredOn = new Date(anyDoc.toDate).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      });
      return res.status(400).json({
        success: false,
        message: `Schedule "${anyDoc.scheduleName}" has expired (ended on ${expiredOn}). Dates cannot be modified on an expired schedule.`,
        scheduleExpired: true,
        toDate: anyDoc.toDate,
      });
    }

    // Guard 3: cannot edit a schedule that is currently active (started but not yet ended).
    // Once a schedule has started (fromDate <= today), its dates are locked.
    // Only future schedules (fromDate > today) can have their dates changed.
    if (isScheduleActiveToday(anyDoc.fromDate, anyDoc.toDate)) {
      const startedOn = new Date(anyDoc.fromDate).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      });
      const endsOn = new Date(anyDoc.toDate).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      });
      return res.status(400).json({
        success: false,
        message: `Schedule "${anyDoc.scheduleName}" is currently active (${startedOn} → ${endsOn}). Dates cannot be modified while a schedule is in progress.`,
        scheduleActive: true,
        fromDate: anyDoc.fromDate,
        toDate: anyDoc.toDate,
      });
    }

    const existingSchedules = await Schedule.aggregate([
      { $match: { isDeleted: false, scheduleGroupId: { $ne: new mongoose.Types.ObjectId(groupId) } } },
      { $group: { _id: "$scheduleGroupId", fromDate: { $first: "$fromDate" }, toDate: { $first: "$toDate" }, name: { $first: "$scheduleName" } } },
    ]);

    const overlapping = existingSchedules.filter((s) =>
      hasOverlap(resolvedFrom, resolvedTo, new Date(s.fromDate), new Date(s.toDate))
    );

    if (overlapping.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Updated dates overlap with another existing schedule.",
        overlappingSchedules: overlapping.map((s) => ({
          scheduleName: s.name,
          from: new Date(s.fromDate).toISOString().slice(0, 10),
          to: new Date(s.toDate).toISOString().slice(0, 10),
        })),
      });
    }

    await Schedule.updateMany(
      { scheduleGroupId: groupId, isDeleted: false },
      { $set: { fromDate: resolvedFrom, toDate: resolvedTo } }
    );

    const allPhaseDocs = await Schedule.find({ scheduleGroupId: groupId, isDeleted: false });
    const assignedEmployeeIds = [
      ...new Set(
        allPhaseDocs.flatMap((s) =>
          s.employees.filter((e) => e.isActive).map((e) => e.employee.toString())
        )
      ),
    ];

    if (assignedEmployeeIds.length > 0) {
      await Employee.updateMany(
        { _id: { $in: assignedEmployeeIds } },
        { $set: { "currentSchedule.fromDate": resolvedFrom, "currentSchedule.toDate": resolvedTo } }
      );
    }

    await log({
      entity: "Schedule",
      entityId: anyDoc._id,
      action: "SCHEDULE_UPDATED",
      meta: {
        scheduleGroupId: groupId,
        scheduleName: anyDoc.scheduleName,
        fromDate: resolvedFrom,
        toDate: resolvedTo,
        employeesSynced: assignedEmployeeIds.length,
      },
      message: `Schedule "${anyDoc.scheduleName}" dates updated across all phases. ${assignedEmployeeIds.length} employee(s) synced.`,
      performedBy: req.user?._id,
    });

    return res.status(200).json({
      success: true,
      message: `Schedule "${anyDoc.scheduleName}" dates updated for all phases.`,
      updatedDates: { fromDate: resolvedFrom, toDate: resolvedTo },
      employeesSynced: assignedEmployeeIds.length,
    });
  } catch (err) {
    console.error("updateScheduleGroupDates error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE EMPLOYEES IN A SPECIFIC PHASE OF A SCHEDULE
// FIX: Use soft-remove (isActive: false + removedAt) instead of $pull
//      so the employee entry is preserved for history in getMySchedule.
// ─────────────────────────────────────────────────────────────────────────────
export const updateEmployeesInPhaseSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeIds } = req.body;

    if (!Array.isArray(employeeIds)) {
      return res.status(400).json({ success: false, message: "employeeIds must be an array (can be empty to remove all)." });
    }

    const sanitizedIds = employeeIds.filter(
      (eid) => eid && typeof eid === "string" && mongoose.Types.ObjectId.isValid(eid)
    );

    const schedule = await Schedule.findOne({ _id: id, isDeleted: false })
      .populate("phase", "phaseName location address");
    if (!schedule) return res.status(404).json({ success: false, message: "Schedule not found." });
    if (isScheduleExpired(schedule.toDate)) {
      return res.status(400).json({
        success: false,
        message: `Schedule "${schedule.scheduleName}" has expired (ended on ${new Date(schedule.toDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}). Employee assignments cannot be modified on expired schedules.`,
        scheduleExpired: true,
        toDate: schedule.toDate,
      });
    }

    let validEmployees = [];
    if (sanitizedIds.length > 0) {
      validEmployees = await Employee.find({ _id: { $in: sanitizedIds }, isActive: true })
        .select("_id firstName lastName employeeId department designation");

      if (validEmployees.length !== sanitizedIds.length) {
        const foundIds = validEmployees.map((e) => e._id.toString());
        const missing = sanitizedIds.filter((eid) => !foundIds.includes(eid));
        return res.status(400).json({
          success: false,
          message: "One or more employee IDs are invalid or inactive.",
          invalidIds: missing,
        });
      }
    }

    // Only consider currently ACTIVE entries for add/remove diff
    const currentActiveIds = schedule.employees
      .filter((e) => e.isActive)
      .map((e) => e.employee.toString());

    const toAdd = sanitizedIds.filter((eid) => !currentActiveIds.includes(eid));
    const toRemove = currentActiveIds.filter((eid) => !sanitizedIds.includes(eid));

    // Busy check — only for employees being newly added
    if (toAdd.length > 0) {
      // ✅ FIX in updateEmployeesInPhaseSchedule — date overlap check:
      const newFrom = new Date(schedule.fromDate);
      const newTo = new Date(schedule.toDate);

      const allOtherSchedules = await Schedule.find({
        isDeleted: false,
        _id: { $ne: schedule._id },
      }).populate("phase", "phaseName");

      const busyMap = new Map();
      allOtherSchedules.forEach((s) => {
        const existFrom = new Date(s.fromDate);
        const existTo = new Date(s.toDate);
        const overlaps = newFrom <= existTo && newTo >= existFrom;
        if (overlaps) {
          s.employees.forEach((e) => {
            if (e.isActive) {
              busyMap.set(e.employee.toString(), {
                phaseName: s.phase?.phaseName || "—",
                scheduleName: s.scheduleName,
                from: s.fromDate,
                to: s.toDate,
              });
            }
          });
        }
      });
    }

    const removedAt = new Date();

    // ── SOFT-REMOVE: set isActive=false + removedAt (preserve for history) ────
    if (toRemove.length > 0) {
      await Schedule.updateOne(
        { _id: schedule._id },
        {
          $set: toRemove.reduce((acc, eid, i) => {
            // We need to find the array index of each employee to use positional updates.
            // Use arrayFilters for clarity.
            return acc;
          }, {}),
        }
      );

      // Use arrayFilters to soft-remove each employee by their ObjectId
      await Schedule.updateOne(
        { _id: schedule._id },
        {
          $set: {
            "employees.$[elem].isActive": false,
            "employees.$[elem].removedAt": removedAt,
          },
        },
        {
          arrayFilters: [
            {
              "elem.employee": { $in: toRemove.map((eid) => new mongoose.Types.ObjectId(eid)) },
              "elem.isActive": true,
            },
          ],
        }
      );

      // Clear currentSchedule + isAssigned on removed employees
      await Employee.updateMany(
        { _id: { $in: toRemove } },
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

      const removedEmps = await Employee.find({ _id: { $in: toRemove } }).select("_id firstName lastName");

      await Promise.all(
        removedEmps.map((emp) =>
          NotificationService.createScheduleRemovedNotification(emp, schedule, schedule.phase, req.user)
        )
      );

      await Promise.all(
        removedEmps.map((emp) =>
          log({
            entity: "Schedule",
            entityId: schedule._id,
            phaseId: schedule.phase._id,
            action: "EMPLOYEE_REMOVED",
            meta: {
              employeeId: emp._id,
              employeeName: `${emp.firstName} ${emp.lastName}`,
              scheduleName: schedule.scheduleName,
              phaseName: schedule.phase.phaseName,
              reason: "Removed via employee list update",
            },
            message: `${emp.firstName} ${emp.lastName} was removed from "${schedule.scheduleName}" in phase "${schedule.phase.phaseName}".`,
            performedBy: req.user?._id,
          })
        )
      );
    }

    // ── Add new employees ─────────────────────────────────────────────────────
    if (toAdd.length > 0) {
      await Schedule.findByIdAndUpdate(id, {
        $push: {
          employees: {
            $each: toAdd.map((eid) => ({
              employee: new mongoose.Types.ObjectId(eid),
              addedAt: new Date(),
              isActive: true,
            })),
          },
        },
      });

      // Only overwrite currentSchedule if the schedule is active TODAY.
      // If it's a future/upcoming schedule, leave currentSchedule as-is —
      // the midnight cron will promote it when fromDate arrives.
      if (isScheduleActiveToday(schedule.fromDate, schedule.toDate)) {
        await Employee.updateMany(
          { _id: { $in: toAdd } },
          {
            $set: {
              isAssigned: true,
              currentSchedule: {
                scheduleId: schedule._id,
                scheduleGroupId: schedule.scheduleGroupId,
                scheduleName: schedule.scheduleName,
                phaseId: schedule.phase._id,
                phaseName: schedule.phase.phaseName,
                fromDate: schedule.fromDate,
                toDate: schedule.toDate,
                assignedAt: new Date(),
              },
            },
          }
        );
      } else {
        // Future schedule: just mark isAssigned=true so employee shows as unavailable,
        // but do NOT overwrite currentSchedule (they may still be in an active schedule).
        await Employee.updateMany(
          { _id: { $in: toAdd }, isAssigned: false },
          { $set: { isAssigned: true } }
        );
      }

      const addedEmps = validEmployees.filter((e) => toAdd.includes(e._id.toString()));

      await Promise.all(
        addedEmps.map((emp) =>
          NotificationService.createScheduleAssignedNotification(emp, schedule, schedule.phase, req.user)
        )
      );

      await Promise.all(
        addedEmps.map((emp) =>
          log({
            entity: "Schedule",
            entityId: schedule._id,
            phaseId: schedule.phase._id,
            action: "EMPLOYEE_ADDED",
            meta: {
              employeeId: emp._id,
              employeeName: `${emp.firstName} ${emp.lastName}`,
              scheduleName: schedule.scheduleName,
              phaseName: schedule.phase.phaseName,
            },
            message: `${emp.firstName} ${emp.lastName} was added to "${schedule.scheduleName}" in phase "${schedule.phase.phaseName}".`,
            performedBy: req.user?._id,
          })
        )
      );
    }

    return res.status(200).json({
      success: true,
      message: `Employees updated in "${schedule.scheduleName}" — phase "${schedule.phase.phaseName}".`,
      changes: {
        added: toAdd.length,
        removed: toRemove.length,
        unchanged: sanitizedIds.length - toAdd.length,
        finalCount: sanitizedIds.length,
      },
      scheduleId: schedule._id,
      scheduleName: schedule.scheduleName,
      phase: { phaseId: schedule.phase._id, phaseName: schedule.phase.phaseName },
    });
  } catch (err) {
    console.error("updateEmployeesInPhaseSchedule error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SCHEDULES BY PHASE
// ─────────────────────────────────────────────────────────────────────────────
export const getSchedulesByPhase = async (req, res) => {
  try {
    const { phaseId } = req.params;
    const phase = await Phase.findOne({ _id: phaseId, isDeleted: false });
    if (!phase) return res.status(404).json({ success: false, message: "Phase not found." });

    const schedules = await Schedule.find({ phase: phaseId, isDeleted: false })
      .populate("employees.employee", "firstName lastName employeeId personalEmail department designation profileImage")
      .sort({ scheduleNumber: 1 });

    const today = new Date();

    const enriched = schedules.map((s) => {
      const doc = s.toObject();
      const expired = isScheduleExpired(s.toDate);
      const scheduleStatus = isScheduleActiveToday(s.fromDate, s.toDate)
        ? "active"
        : expired
          ? "expired"
          : "upcoming";

      const current = [];  // isActive: true — assigned right now
      const removed = [];  // isActive: false — was removed

      // Sort all entries oldest → newest by addedAt
      const sorted = [...doc.employees].sort(
        (a, b) => new Date(a.addedAt) - new Date(b.addedAt)
      );

      // The FIRST entry (earliest addedAt) is the original assignment.
      // Everything added AFTER that first entry is "newly added".
      // Find the earliest addedAt across all entries to identify the original batch.
      const firstAddedAt = sorted.length > 0 ? new Date(sorted[0].addedAt).getTime() : null;

      // Group entries added at the same time as the first entry = "original"
      // All entries added strictly after = "added" (new additions)
      const added = [];  // only newly added after initial assignment

      sorted.forEach((e) => {
        const entry = {
          employee: e.employee,
          addedAt: e.addedAt,
          removedAt: e.removedAt || null,
          currentlyBusy: isBusy(e, s.fromDate, s.toDate),
        };

        const isOriginal = new Date(e.addedAt).getTime() === firstAddedAt;

        if (e.isActive) {
          current.push(entry);
          // Only push to added if it was added AFTER the original batch
          if (!isOriginal) {
            added.push(entry);
          }
        } else {
          removed.push(entry);
        }
      });

      return {
        ...doc,
        isExpired: expired,
        scheduleStatus,
        current,
        added,
        removed,
        currentCount: current.length,
        addedCount: added.length,
        removedCount: removed.length,
        employees: undefined,
      };
    });

    return res.status(200).json({
      success: true,
      phase: { id: phase._id, phaseName: phase.phaseName },
      count: enriched.length,
      data: enriched,
    });
  } catch (err) {
    console.error("getSchedulesByPhase error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE SCHEDULE
// ─────────────────────────────────────────────────────────────────────────────
export const getScheduleById = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await Schedule.findOne({ _id: id, isDeleted: false })
      .populate("phase", "phaseName location address")
      .populate("employees.employee", "firstName lastName employeeId personalEmail department designation");

    if (!schedule) return res.status(404).json({ success: false, message: "Schedule not found." });

    const expired = new Date(schedule.toDate) < new Date();
    const doc = schedule.toObject();
    doc.employees = doc.employees.map((e) => ({
      ...e,
      scheduleExpired: expired,
      currentlyBusy: isBusy(e, schedule.fromDate, schedule.toDate),
    }));

    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    console.error("getScheduleById error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  SCHEDULE (single phase-doc, by _id)
// FIX: Also soft-remove all active employees before soft-deleting.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;

    // Find by _id only (no isDeleted filter — handles already-soft-deleted too)
    const schedule = await Schedule.findById(id).populate("phase", "phaseName");
    if (!schedule) return res.status(404).json({ success: false, message: "Schedule not found." });

    const scheduleName = schedule.scheduleName;
    const groupId = schedule.scheduleGroupId;

    // Fetch ALL phase-docs in this group (regardless of isDeleted)
    const allGroupDocs = await Schedule.find({ scheduleGroupId: groupId }).populate("phase", "phaseName");

    // ✅ Soft-remove employees (clears isAssigned + currentSchedule on Employee)
    //    then HARD DELETE the schedule docs
    await Promise.all(
      allGroupDocs.map((s) => _softRemoveEmployeesFromSchedule(s, req.user?._id, "Schedule permanently deleted"))
    );

    // ✅ HARD DELETE all phase-docs in this group
    await Schedule.deleteMany({ scheduleGroupId: groupId });

    await log({
      entity: "Schedule",
      entityId: new mongoose.Types.ObjectId(groupId),
      action: "SCHEDULE_DELETED",
      meta: { scheduleName },
      message: `Schedule "${scheduleName}" permanently deleted from all phases.`,
      performedBy: req.user?._id,
    });

    return res.status(200).json({
      success: true,
      message: `Schedule "${scheduleName}" permanently deleted from all phases.`,
    });
  } catch (err) {
    console.error("deleteSchedule error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  SCHEDULE GROUP (by groupId)
// FIX: Soft-remove all active employees in ALL phase-docs of the group first.
// ─────────────────────────────────────────────────────────────────────────────
export const deleteScheduleGroup = async (req, res) => {
  try {
    const { groupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: "Invalid schedule group ID." });
    }

    // Fetch ALL docs in group (regardless of isDeleted)
    const schedules = await Schedule.find({ scheduleGroupId: groupId }).populate("phase", "phaseName");

    if (schedules.length === 0) {
      return res.status(404).json({ success: false, message: "Schedule group not found." });
    }

    const scheduleName = schedules[0].scheduleName;

    // ✅ Soft-remove employees from every phase-doc first
    await Promise.all(
      schedules.map((s) => _softRemoveEmployeesFromSchedule(s, req.user?._id, "Schedule group permanently deleted"))
    );

    // ✅ HARD DELETE all docs in this group
    await Schedule.deleteMany({ scheduleGroupId: groupId });

    await log({
      entity: "Schedule",
      entityId: new mongoose.Types.ObjectId(groupId),
      action: "SCHEDULE_GROUP_DELETED",
      meta: { scheduleName },
      message: `Schedule "${scheduleName}" permanently deleted from all phases.`,
      performedBy: req.user?._id,
    });

    return res.status(200).json({
      success: true,
      message: `Schedule "${scheduleName}" permanently deleted from all phases.`,
      scheduleGroupId: groupId,
    });
  } catch (err) {
    console.error("deleteScheduleGroup error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// RESTORE SCHEDULE GROUP
// ─────────────────────────────────────────────────────────────────────────────
export const restoreSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await Schedule.findOne({ _id: id, isDeleted: true });
    if (!schedule) return res.status(404).json({ success: false, message: "Deleted schedule not found." });

    await Schedule.updateMany(
      { scheduleGroupId: schedule.scheduleGroupId, isDeleted: true },
      { isDeleted: false, deletedAt: null }
    );

    await log({
      entity: "Schedule",
      entityId: schedule._id,
      action: "SCHEDULE_RESTORED",
      meta: { scheduleName: schedule.scheduleName },
      message: `Schedule "${schedule.scheduleName}" restored across all phases.`,
      performedBy: req.user?._id,
    });

    return res.status(200).json({ success: true, message: `Schedule "${schedule.scheduleName}" restored.` });
  } catch (err) {
    console.error("restoreSchedule error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET AVAILABLE EMPLOYEES FOR A SCHEDULE-PHASE
// ─────────────────────────────────────────────────────────────────────────────
// export const getAvailableEmployees = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const schedule = await Schedule.findOne({ _id: id, isDeleted: false }).populate("phase", "phaseName location");
//     if (!schedule) return res.status(404).json({ success: false, message: "Schedule not found." });

//     const allActiveSchedules = await Schedule.find({ isDeleted: false }).populate("phase", "phaseName");
//     const busyMap = new Map();
//     allActiveSchedules.forEach((s) => {
//       s.employees.forEach((e) => {
//         if (isBusy(e, s.fromDate, s.toDate)) {
//           busyMap.set(e.employee.toString(), {
//             phaseName: s.phase?.phaseName || "—",
//             scheduleName: s.scheduleName,
//             from: s.fromDate,
//             to: s.toDate,
//           });
//         }
//       });
//     });

//     const allEmployees = await Employee.find({ isActive: true })
//       .select("firstName lastName employeeId personalEmail department designation");

//     const result = allEmployees.map((emp) => {
//       const busyIn = busyMap.get(emp._id.toString());
//       return { ...emp.toObject(), availabilityStatus: busyIn ? "busy" : "available", busyIn: busyIn || null };
//     });

//     return res.status(200).json({
//       success: true,
//       scheduleId: id,
//       scheduleName: schedule.scheduleName,
//       phase: { id: schedule.phase._id, phaseName: schedule.phase.phaseName },
//       scheduleWindow: { fromDate: schedule.fromDate, toDate: schedule.toDate },
//       summary: {
//         total: result.length,
//         available: result.filter((e) => e.availabilityStatus === "available").length,
//         busy: result.filter((e) => e.availabilityStatus === "busy").length,
//       },
//       data: result,
//     });
//   } catch (err) {
//     console.error("getAvailableEmployees error:", err);
//     return res.status(500).json({ success: false, message: "Internal server error." });
//   }
// };
export const getAvailableEmployees = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await Schedule.findOne({ _id: id, isDeleted: false })
      .populate("phase", "phaseName location");
    if (!schedule) {
      return res.status(404).json({ success: false, message: "Schedule not found." });
    }

    const newFrom = new Date(schedule.fromDate);
    const newTo = new Date(schedule.toDate);

    // All OTHER schedules (exclude current schedule being edited/added to)
    const allOtherSchedules = await Schedule.find({
      isDeleted: false,
      _id: { $ne: id },
    }).populate("phase", "phaseName");

    // Build busy map using DATE OVERLAP
    const busyMap = new Map();
    allOtherSchedules.forEach((s) => {
      const existFrom = new Date(s.fromDate);
      const existTo = new Date(s.toDate);
      const overlaps = newFrom <= existTo && newTo >= existFrom;

      if (overlaps) {
        s.employees.forEach((e) => {
          if (e.isActive) {
            busyMap.set(e.employee.toString(), {
              scheduleName: s.scheduleName,
              phaseName: s.phase?.phaseName || "—",
              from: s.fromDate,
              to: s.toDate,
            });
          }
        });
      }
    });

    const allEmployees = await Employee.find({ isActive: true })
      .select("firstName lastName employeeId personalEmail department designation profileImage");

    // Get IDs already active in THIS schedule
    const alreadyInThisSchedule = new Set(
      schedule.employees
        .filter((e) => e.isActive)
        .map((e) => e.employee.toString())
    );

    const result = allEmployees.map((emp) => {
      const empId = emp._id.toString();
      const busyIn = busyMap.get(empId);
      const isCurrentlyInThisSchedule = alreadyInThisSchedule.has(empId);

      return {
        ...emp.toObject(),
        availabilityStatus: isCurrentlyInThisSchedule
          ? "assigned"           // already in this schedule
          : busyIn
            ? "busy"             // in another overlapping schedule
            : "available",       // free for this date range
        busyIn: busyIn || null,
        isCurrentlyInThisSchedule,
      };
    });

    return res.status(200).json({
      success: true,
      scheduleId: id,
      scheduleName: schedule.scheduleName,
      scheduleWindow: { fromDate: schedule.fromDate, toDate: schedule.toDate },
      summary: {
        total: result.length,
        available: result.filter((e) => e.availabilityStatus === "available").length,
        assigned: result.filter((e) => e.availabilityStatus === "assigned").length,
        busy: result.filter((e) => e.availabilityStatus === "busy").length,
      },
      data: result,
    });
  } catch (err) {
    console.error("getAvailableEmployees error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ONLY AVAILABLE EMPLOYEES (no schedule context needed)
// Returns all active employees who are NOT currently busy in any
// active or upcoming schedule. Useful for assignment dropdowns/pickers
// where you only want to show who can actually be assigned.
//
// Optional query params:
//   ?department=Engineering   — filter by department
//   ?designation=Manager      — filter by designation
//   ?search=john              — search by name or employeeId
// ─────────────────────────────────────────────────────────────────────────────
export const getOnlyAvailableEmployees = async (req, res) => {
  try {
    // Build the busy map — same logic as getAvailableEmployees
    const allSchedules = await Schedule.find({ isDeleted: false });
    const busyEmployeeIds = new Set();

    allSchedules.forEach((s) => {
      s.employees.forEach((e) => {
        if (isBusy(e, s.fromDate, s.toDate)) {
          busyEmployeeIds.add(e.employee.toString());
        }
      });
    });

    // Build employee filter
    const empFilter = {
      isActive: true,
      _id: { $nin: Array.from(busyEmployeeIds).map((id) => new mongoose.Types.ObjectId(id)) },
    };

    // Optional filters from query params
    if (req.query.department) {
      empFilter.department = { $regex: req.query.department, $options: "i" };
    }
    if (req.query.designation) {
      empFilter.designation = { $regex: req.query.designation, $options: "i" };
    }
    if (req.query.search) {
      const s = req.query.search;
      empFilter.$or = [
        { firstName: { $regex: s, $options: "i" } },
        { lastName: { $regex: s, $options: "i" } },
        { employeeId: { $regex: s, $options: "i" } },
      ];
    }

    const availableEmployees = await Employee.find(empFilter).select(
      "firstName lastName employeeId personalEmail department designation profileImage"
    );

    return res.status(200).json({
      success: true,
      count: availableEmployees.length,
      data: availableEmployees,
    });
  } catch (err) {
    console.error("getOnlyAvailableEmployees error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADD EMPLOYEES TO A SCHEDULE-PHASE
// ─────────────────────────────────────────────────────────────────────────────
export const addEmployeesToSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeIds } = req.body;

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: "employeeIds must be a non-empty array." });
    }

    const schedule = await Schedule.findOne({ _id: id, isDeleted: false })
      .populate("phase", "phaseName location address");
    if (!schedule) return res.status(404).json({ success: false, message: "Schedule not found." });
    if (isScheduleExpired(schedule.toDate)) {
      return res.status(400).json({
        success: false,
        message: `Schedule "${schedule.scheduleName}" has expired. Employee assignments cannot be modified.`,
        scheduleExpired: true,
        toDate: schedule.toDate,
      });
    }

    const employees = await Employee.find({ _id: { $in: employeeIds }, isActive: true })
      .select("_id firstName lastName employeeId department designation");

    if (employees.length !== employeeIds.length) {
      const foundIds = employees.map((e) => e._id.toString());
      const missing = employeeIds.filter((eid) => !foundIds.includes(eid));
      return res.status(400).json({
        success: false,
        message: "One or more employee IDs are invalid or inactive.",
        invalidIds: missing,
      });
    }

    // ✅ FIX: Use DATE OVERLAP instead of isBusy (today-based)
    const newFrom = new Date(schedule.fromDate);
    const newTo = new Date(schedule.toDate);

    // Get all OTHER schedules (exclude the current one)
    const allOtherSchedules = await Schedule.find({
      isDeleted: false,
      _id: { $ne: id },
    }).populate("phase", "phaseName");

    const busyMap = new Map();
    allOtherSchedules.forEach((s) => {
      const existFrom = new Date(s.fromDate);
      const existTo = new Date(s.toDate);
      // Check if date ranges overlap
      const overlaps = newFrom <= existTo && newTo >= existFrom;
      if (overlaps) {
        s.employees.forEach((e) => {
          if (e.isActive) {
            busyMap.set(e.employee.toString(), {
              phaseName: s.phase?.phaseName || "—",
              scheduleName: s.scheduleName,
              from: s.fromDate,
              to: s.toDate,
            });
          }
        });
      }
    });

    const alreadyBusy = employeeIds.filter((eid) => busyMap.has(eid.toString()));
    if (alreadyBusy.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Some employees are busy in an overlapping schedule.",
        busyEmployees: alreadyBusy.map((eid) => ({
          employeeId: eid,
          currentAssignment: busyMap.get(eid),
        })),
      });
    }

    // ── rest of the function stays exactly the same ──
    schedule.employees.push(
      ...employeeIds.map((eid) => ({
        employee: new mongoose.Types.ObjectId(eid),
        addedAt: new Date(),
        isActive: true,
      }))
    );
    await schedule.save();

    await Promise.all(
      employees.map((emp) =>
        NotificationService.createScheduleAssignedNotification(emp, schedule, schedule.phase, req.user)
      )
    );

    if (isScheduleActiveToday(schedule.fromDate, schedule.toDate)) {
      await Employee.updateMany(
        { _id: { $in: employeeIds } },
        {
          $set: {
            isAssigned: true,
            currentSchedule: {
              scheduleId: schedule._id,
              scheduleGroupId: schedule.scheduleGroupId,
              scheduleName: schedule.scheduleName,
              phaseId: schedule.phase._id,
              phaseName: schedule.phase.phaseName,
              fromDate: schedule.fromDate,
              toDate: schedule.toDate,
              assignedAt: new Date(),
            },
          },
        }
      );
    } else {
      await Employee.updateMany(
        { _id: { $in: employeeIds }, isAssigned: false },
        { $set: { isAssigned: true } }
      );
    }

    const empNames = employees.map((e) => `${e.firstName} ${e.lastName}`).join(", ");
    await log({
      entity: "Schedule",
      entityId: schedule._id,
      phaseId: schedule.phase._id,
      action: "EMPLOYEE_ADDED",
      meta: {
        employeeIds,
        scheduleName: schedule.scheduleName,
        phaseId: schedule.phase._id,
        phaseName: schedule.phase.phaseName,
      },
      message: `${employees.length} employee(s) [${empNames}] added to "${schedule.scheduleName}" in phase "${schedule.phase.phaseName}".`,
      performedBy: req.user?._id,
    });

    return res.status(200).json({
      success: true,
      message: `${employees.length} employee(s) successfully assigned.`,
      assignedTo: {
        scheduleId: schedule._id,
        scheduleName: schedule.scheduleName,
        phase: { phaseId: schedule.phase._id, phaseName: schedule.phase.phaseName },
        engagementPeriod: { from: schedule.fromDate, to: schedule.toDate },
      },
      employees: employees.map((e) => ({
        id: e._id,
        name: `${e.firstName} ${e.lastName}`,
        employeeId: e.employeeId,
        department: e.department,
        designation: e.designation,
      })),
    });
  } catch (err) {
    console.error("addEmployeesToSchedule error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE SINGLE EMPLOYEE FROM A SCHEDULE-PHASE
// FIX: Use soft-remove (isActive=false + removedAt) instead of $pull
//      so the entry remains in history for getMySchedule.
// ─────────────────────────────────────────────────────────────────────────────
export const removeEmployeeFromSchedule = async (req, res) => {
  try {
    const { id, employeeId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "Invalid employee ID." });
    }

    const schedule = await Schedule.findOne({ _id: id, isDeleted: false })
      .populate("phase", "phaseName");
    if (!schedule) return res.status(404).json({ success: false, message: "Schedule not found." });
    if (isScheduleExpired(schedule.toDate)) {
      return res.status(400).json({
        success: false,
        message: `Schedule "${schedule.scheduleName}" has expired (ended on ${new Date(schedule.toDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}). Employee assignments cannot be modified on expired schedules.`,
        scheduleExpired: true,
        toDate: schedule.toDate,
      });
    }

    const entry = schedule.employees.find(
      (e) => e.employee.toString() === employeeId && e.isActive
    );
    if (!entry) {
      return res.status(404).json({ success: false, message: "Active employee not found in this schedule." });
    }

    // Soft-remove: keep the array entry but mark as inactive
    await Schedule.updateOne(
      { _id: schedule._id },
      {
        $set: {
          "employees.$[elem].isActive": false,
          "employees.$[elem].removedAt": new Date(),
        },
      },
      {
        arrayFilters: [
          { "elem.employee": new mongoose.Types.ObjectId(employeeId), "elem.isActive": true },
        ],
      }
    );

    const removedEmp = await Employee.findById(employeeId).select("_id firstName lastName");
    const empName = removedEmp ? `${removedEmp.firstName} ${removedEmp.lastName}` : employeeId;

    if (removedEmp) {
      await NotificationService.createScheduleRemovedNotification(
        removedEmp, schedule, schedule.phase, req.user
      );
    }

    // Clear assignment on employee document
    await Employee.findByIdAndUpdate(employeeId, {
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
    });

    await log({
      entity: "Schedule",
      entityId: schedule._id,
      phaseId: schedule.phase._id,
      action: "EMPLOYEE_REMOVED",
      meta: {
        employeeId,
        employeeName: empName,
        scheduleName: schedule.scheduleName,
        phaseName: schedule.phase.phaseName,
        reason: "Manually removed by admin",
      },
      message: `${empName} was removed from "${schedule.scheduleName}" in phase "${schedule.phase.phaseName}".`,
      performedBy: req.user?._id,
    });

    return res.status(200).json({
      success: true,
      message: `Employee "${empName}" removed and is now available.`,
      removedFrom: {
        scheduleId: schedule._id,
        scheduleName: schedule.scheduleName,
        phaseId: schedule.phase._id,
        phaseName: schedule.phase.phaseName,
      },
    });
  } catch (err) {
    console.error("removeEmployeeFromSchedule error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET MY SCHEDULE (Employee)
// FIX: Include isDeleted:true schedules so deleted phase/schedule history shows.
//      An employee's history must survive even if the schedule was deleted.
// ─────────────────────────────────────────────────────────────────────────────
export const getMySchedule = async (req, res) => {
  try {
    const employeeId = req.user._id;

    // ── CHANGED: removed isDeleted:false so soft-deleted schedules still appear in history
    const allSchedules = await Schedule.find({ "employees.employee": employeeId })
      .populate("phase", "phaseName location address")
      .populate("employees.employee", "firstName lastName employeeId department designation");

    if (allSchedules.length === 0) {
      return res.status(200).json({
        success: true,
        message: "You have not been assigned to any schedule yet.",
        current: null,
        upcoming: [],
        history: [],
      });
    }

    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    let current = null;
    const upcoming = [];
    const history = [];

    allSchedules.forEach((s) => {
      // Get the most recent entry for this employee (could have been re-added)
      const entry = s.employees
        .slice()
        .reverse()
        .find((e) => e.employee._id.toString() === employeeId.toString());

      if (!entry) return;

      const fromUTC = Date.UTC(
        new Date(s.fromDate).getUTCFullYear(),
        new Date(s.fromDate).getUTCMonth(),
        new Date(s.fromDate).getUTCDate()
      );
      const toUTC = Date.UTC(
        new Date(s.toDate).getUTCFullYear(),
        new Date(s.toDate).getUTCMonth(),
        new Date(s.toDate).getUTCDate()
      );

      const isExpired = toUTC < todayUTC;
      const isNotStartedYet = fromUTC > todayUTC;
      const isActiveToday = fromUTC <= todayUTC && toUTC >= todayUTC;
      const isManuallyRemoved = !entry.isActive;
      const isScheduleDeleted = s.isDeleted;

      let status;
      if (isManuallyRemoved) {
        // Removed by admin before schedule ended — always history
        status = "removed";
      } else if (isScheduleDeleted) {
        // The schedule/phase was deleted — treat as removed
        status = "removed";
      } else if (isExpired) {
        status = "completed";
      } else if (isNotStartedYet) {
        status = "upcoming";
      } else {
        status = "active";
      }

      const info = {
        scheduleId: s._id,
        scheduleGroupId: s.scheduleGroupId,
        scheduleName: s.scheduleName,
        scheduleNumber: s.scheduleNumber,
        isScheduleDeleted: s.isDeleted,
        employee: {
          _id: entry.employee._id,
          firstName: entry.employee.firstName,
          lastName: entry.employee.lastName,
          employeeId: entry.employee.employeeId,
          department: entry.employee.department,
          designation: entry.employee.designation,
        },
        phase: s.phase
          ? {
            phaseId: s.phase._id,
            phaseName: s.phase.phaseName,
            location: s.phase.location,
            address: s.phase.address,
          }
          : null,
        period: { fromDate: s.fromDate, toDate: s.toDate },
        assignedAt: entry.addedAt,
        removedAt: entry.removedAt || null,
        status,
      };

      if (status === "removed" || status === "completed") {
        history.push(info);
      } else if (status === "active") {
        current = info;
      } else if (status === "upcoming") {
        upcoming.push(info);
      }
    });

    upcoming.sort((a, b) => new Date(a.period.fromDate) - new Date(b.period.fromDate));
    history.sort((a, b) => new Date(b.period.toDate) - new Date(a.period.toDate));

    return res.status(200).json({
      success: true,
      employeeId,
      summary: {
        totalAssignments: allSchedules.length,
        currentlyActive: current ? 1 : 0,
        upcoming: upcoming.length,
        completed: history.filter((h) => h.status === "completed").length,
        removed: history.filter((h) => h.status === "removed").length,
      },
      current,
      upcoming,
      history,
    });
  } catch (err) {
    console.error("getMySchedule error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ACTIVITY LOGS (paginated)
// ─────────────────────────────────────────────────────────────────────────────
export const getActivityLogs = async (req, res) => {
  try {
    const { entity, action, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (entity) filter.entity = entity;
    if (action) filter.action = action;

    const total = await ActivityLogPhaseSchedule.countDocuments(filter);
    const logs = await ActivityLogPhaseSchedule.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("performedBy", "name email");

    return res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      data: logs,
    });
  } catch (err) {
    console.error("getActivityLogs error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET RECENT ACTIVITY LOGS (latest 10 — dashboard widget)
// ─────────────────────────────────────────────────────────────────────────────
export const getRecentActivityLogs = async (req, res) => {
  try {
    const logs = await ActivityLogPhaseSchedule.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("performedBy", "firstName lastName email role");

    return res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    console.error("getRecentActivityLogs error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ACTIVITY LOGS FOR A SPECIFIC PHASE
// ─────────────────────────────────────────────────────────────────────────────
export const getActivityLogsByPhase = async (req, res) => {
  try {
    const { phaseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(phaseId)) {
      return res.status(400).json({ success: false, message: "Invalid phase ID." });
    }

    const phase = await Phase.findById(phaseId).select("phaseName location address isDeleted");
    if (!phase) {
      return res.status(404).json({ success: false, message: "Phase not found." });
    }

    const { action, page = 1, limit = 20 } = req.query;

    const filter = {
      $or: [
        { phaseId: new mongoose.Types.ObjectId(phaseId) },
        { entity: "Phase", entityId: new mongoose.Types.ObjectId(phaseId) },
      ],
    };
    if (action) filter.action = action;

    const total = await ActivityLogPhaseSchedule.countDocuments(filter);
    const logs = await ActivityLogPhaseSchedule.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("performedBy", "firstName lastName email role")
      .populate("phaseId", "phaseName location");

    return res.status(200).json({
      success: true,
      phase: {
        _id: phase._id,
        phaseName: phase.phaseName,
        location: phase.location,
        address: phase.address,
        isDeleted: phase.isDeleted,
      },
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      data: logs,
    });
  } catch (err) {
    console.error("getActivityLogsByPhase error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPER
// Soft-removes all currently active employees from a schedule-phase doc.
// Sets isActive=false + removedAt, clears Employee.currentSchedule,
// and writes an EMPLOYEE_REMOVED activity log for each one.
// ─────────────────────────────────────────────────────────────────────────────
async function _softRemoveEmployeesFromSchedule(schedule, performedById, reason = "Schedule deleted") {
  const activeEntries = schedule.employees.filter((e) => e.isActive);
  if (activeEntries.length === 0) return;

  const activeIds = activeEntries.map((e) => e.employee.toString());

  // ✅ Clear isAssigned + currentSchedule on each employee (makes them available)
  await Employee.updateMany(
    { _id: { $in: activeIds } },
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

  // Write an EMPLOYEE_REMOVED activity log per employee
  const phaseName = schedule.phase?.phaseName || "Unknown Phase";
  const phaseId = schedule.phase?._id || null;
  const employeeDocs = await Employee.find({ _id: { $in: activeIds } }).select("firstName lastName");

  await Promise.all(
    employeeDocs.map((emp) =>
      log({
        entity: "Schedule",
        entityId: schedule._id,
        phaseId,
        action: "EMPLOYEE_REMOVED",
        meta: {
          employeeId: emp._id,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          scheduleName: schedule.scheduleName,
          phaseName,
          reason,
        },
        message: `${emp.firstName} ${emp.lastName} was removed from "${schedule.scheduleName}" in phase "${phaseName}" — reason: ${reason}.`,
        performedBy: performedById,
      })
    )
  );
}