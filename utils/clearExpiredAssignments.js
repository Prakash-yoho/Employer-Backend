import Employee from "../model/Employee.js";
import Schedule from "../model/Schedule.js";

/**
 * Runs at midnight every day.
 *
 * Two jobs in one pass:
 *
 * 1. EXPIRE — For employees whose currentSchedule.toDate has passed AND
 *    they have no upcoming schedule starting today, clear isAssigned + currentSchedule.
 *
 * 2. PROMOTE — For employees whose currentSchedule is null/expired but who
 *    have an upcoming schedule whose fromDate is today, set isAssigned=true
 *    and write that schedule into currentSchedule.
 *
 * This means:
 *   - Employee in SCH-1 (ends 10/3) added to SCH-2 (starts 11/3):
 *       → currentSchedule stays as SCH-1 until midnight on 10/3
 *       → midnight cron on 11/3: promotes SCH-2 into currentSchedule ✅
 *   - Employee in SCH-1 (ends 10/3) with no next schedule:
 *       → midnight cron on 11/3: clears isAssigned + currentSchedule ✅
 */
export const clearExpiredAssignments = async () => {
  const now = new Date();
  // Use start-of-day so "today" is consistently defined
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  console.log(`[clearExpiredAssignments] Running for ${todayStart.toDateString()}...`);

  // ── STEP 1: Find all employees whose currentSchedule has expired ──────────
  // "Expired" means toDate < start of today
  const expiredEmployees = await Employee.find({
    isAssigned: true,
    "currentSchedule.toDate": { $lt: todayStart },
  }).select("_id currentSchedule");

  if (expiredEmployees.length === 0) {
    console.log("[clearExpiredAssignments] No expired assignments found.");
    return 0;
  }

  console.log(`[clearExpiredAssignments] Found ${expiredEmployees.length} employee(s) with expired assignments.`);

  let promoted = 0;
  let cleared = 0;

  for (const emp of expiredEmployees) {
    // ── STEP 2: Check if this employee has a schedule starting today ─────────
    // Look for a Schedule doc where:
    //   - the employee is actively listed (isActive: true)
    //   - fromDate is today (the schedule "promotes" today)
    //   - not deleted
    const upcomingSchedule = await Schedule.findOne({
      isDeleted: false,
      fromDate: { $gte: todayStart, $lte: todayEnd },
      employees: {
        $elemMatch: {
          employee: emp._id,
          isActive: true,
        },
      },
    }).populate("phase", "phaseName location address");

    if (upcomingSchedule) {
      // ── PROMOTE: switch currentSchedule to the new one ───────────────────
      await Employee.findByIdAndUpdate(emp._id, {
        $set: {
          isAssigned: true,
          currentSchedule: {
            scheduleId: upcomingSchedule._id,
            scheduleGroupId: upcomingSchedule.scheduleGroupId,
            scheduleName: upcomingSchedule.scheduleName,
            phaseId: upcomingSchedule.phase._id,
            phaseName: upcomingSchedule.phase.phaseName,
            fromDate: upcomingSchedule.fromDate,
            toDate: upcomingSchedule.toDate,
            assignedAt: upcomingSchedule.employees.find(
              (e) => e.employee.toString() === emp._id.toString()
            )?.addedAt || new Date(),
          },
        },
      });

      console.log(
        `[clearExpiredAssignments] PROMOTED employee ${emp._id} → "${upcomingSchedule.scheduleName}"`
      );
      promoted++;
    } else {
      // ── CLEAR: no upcoming schedule, free the employee ───────────────────
      await Employee.findByIdAndUpdate(emp._id, {
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

      console.log(`[clearExpiredAssignments] CLEARED employee ${emp._id} (no upcoming schedule).`);
      cleared++;
    }
  }

  console.log(
    `[clearExpiredAssignments] Done. Promoted: ${promoted}, Cleared: ${cleared}.`
  );
  return { promoted, cleared };
};