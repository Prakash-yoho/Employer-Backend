import Schedule from "../model/Schedule.js";
import Notification from "../model/Employer/Notification.js";
import EmployerUser from "../model/Employer/EmployerUser.js";

/**
 * Cron Job: Schedule Expiry Reminder (Schedule-level)
 *
 * Runs daily. Checks if the LATEST (most recent) schedule group is
 * expiring within REMINDER_DAYS_BEFORE days AND there is no newer
 * schedule group created after it. If so, notifies all HR/Admin users
 * to create a new schedule before this one ends.
 *
 * This is schedule-level — not per employee.
 * No senderId — fully automated system notification.
 */

const REMINDER_DAYS_BEFORE = 3;

export const sendScheduleExpiryReminders = async () => {
    try {
        console.log("[CRON] sendScheduleExpiryReminders: starting...");

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const reminderWindowEnd = new Date(today);
        reminderWindowEnd.setDate(today.getDate() + REMINDER_DAYS_BEFORE);
        reminderWindowEnd.setHours(23, 59, 59, 999);

        // ── Step 1: Get the latest schedule group by toDate ──
        // Aggregate to one entry per scheduleGroupId, pick the one with the latest toDate
        const latestGroup = await Schedule.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: "$scheduleGroupId",
                    scheduleName: { $first: "$scheduleName" },
                    scheduleNumber: { $first: "$scheduleNumber" },
                    fromDate: { $first: "$fromDate" },
                    toDate: { $first: "$toDate" },
                }
            },
            { $sort: { toDate: -1 } },
            { $limit: 1 }
        ]);

        if (latestGroup.length === 0) {
            console.log("[CRON] No schedules found in the system.");
            return;
        }

        const latest = latestGroup[0];
        const latestToDate = new Date(latest.toDate);
        latestToDate.setHours(23, 59, 59, 999);

        // ── Step 2: Check if the latest schedule's toDate is within the reminder window ──
        if (latestToDate < today || latestToDate > reminderWindowEnd) {
            console.log(
                `[CRON] Latest schedule "${latest.scheduleName}" ends on ${latestToDate.toDateString()} — outside reminder window. No reminder needed.`
            );
            return;
        }

        const daysLeft = Math.ceil((latestToDate - today) / (1000 * 60 * 60 * 24));

        const expiryDateStr = latestToDate.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }).replace(/ /g, '-'); // → "07-Mar-2026"

        console.log(
            `[CRON] Latest schedule "${latest.scheduleName}" ends on ${expiryDateStr} (${daysLeft} day(s) left) with no upcoming schedule. Sending reminders...`
        );

        // ── Step 3: Fetch all active HR and Admin users ──
        const hrAdminUsers = await EmployerUser.find({
            isActive: true,
            role: { $in: ["EMPLOYER_ADMIN", "EMPLOYER_HR"] },
        }).select("_id role");

        if (hrAdminUsers.length === 0) {
            console.log("[CRON] No active HR/Admin users found to notify.");
            return;
        }

        // ── Step 4: Send one notification per HR/Admin user ──
        const title = "⚠️ Schedule Ending Soon — Action Required";
        const description =
            `Schedule "${latest.scheduleName}" is ending on ${expiryDateStr} ` +
            `(${daysLeft} day${daysLeft !== 1 ? "s" : ""} left) and there is no upcoming schedule after it. ` +
            `Please create a new schedule to ensure continuity.`;

        let totalSent = 0;

        for (const hrUser of hrAdminUsers) {
            // Duplicate guard — skip if already sent today for this schedule
            const alreadySent = await Notification.findOne({
                type: "REMINDER",
                recipientId: hrUser._id,
                "metadata.reminderScheduleName": latest.scheduleName,
                createdAt: { $gte: today },
            });

            if (alreadySent) {
                console.log(
                    `[CRON] Reminder already sent today for schedule "${latest.scheduleName}" → ${hrUser._id}`
                );
                continue;
            }

            await Notification.create({
                title,
                description,
                type: "REMINDER",
                recipientType: hrUser.role,
                recipientId: hrUser._id,
                recipientModel: "EmployerUser",
                senderId: null,
                senderModel: "System",
                relatedEntityType: null,
                relatedEntityId: null,
                priority: "high",
                status: "unread",
                metadata: {
                    reminderScheduleName: latest.scheduleName,
                    reminderScheduleGroupId: latest._id.toString(),
                    reminderExpiryDate: latest.toDate,
                    daysUntilExpiry: daysLeft,
                    automatedReminder: true,
                },
            });

            totalSent++;
        }

        console.log(
            `[CRON] sendScheduleExpiryReminders: done. ${totalSent} reminder(s) sent for schedule "${latest.scheduleName}".`
        );
    } catch (error) {
        console.error("[CRON] sendScheduleExpiryReminders error:", error);
    }
};