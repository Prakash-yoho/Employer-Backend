/**
 * employeeDashboardController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Professional employee-facing dashboard for KIAQ HRMS.
 *
 * The employee dashboard now surfaces everything an employee actually checks
 * day-to-day:
 *
 *   • Live today-attendance state (clocked in / on break / completed)
 *   • Leave balances (CL/SL/Maternity/Paternity) + LOP YTD
 *   • Permission cycle usage
 *   • Pending leaves / permissions / tickets / tasks
 *   • Upcoming task deadlines + overdue
 *   • Current schedule + phase + team assignment
 *   • Upcoming holidays
 *   • Latest payslip availability
 *   • Active announcements targeted at the employee
 *   • Onboarding 3-step progress (preserved, backward-compatible)
 *
 * Endpoints:
 *   GET /api/dashboard/             → getEmployeeDashboard
 *   GET /api/dashboard/employer     → getEmployerDashboard (kept as-is, lean)
 *   GET /api/dashboard/admin/overview → getAdminOverview (kept as-is)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Employee from '../model/Employee.js';
import Document from '../model/Document.js';
import Asset from '../model/Asset.js';
import Ticket from '../model/Ticket.js';
import Notification from '../model/Notification.js';
import Leave from '../model/Leave.js';
import Permission from '../model/Permission.js';
import Attendance from '../model/Attendance.js';
import Holiday from '../model/Holiday.js';
import OfficeTiming from '../model/Officetiming.js';
import BreakPolicy from '../model/BreakPolicy.js';
import LeavePolicy from '../model/LeavePolicy.js';
import Task from '../model/Task.js';
import Schedule from '../model/Schedule.js';
import Team from '../model/Team.js';
import Announcements from '../model/Announcements.js';
import PayrollRelease from '../model/Payrollrelease.js';
import { calculateLeaveBalance } from '../utils/leaveBalanceHelper.js';
import { getNow } from '../utils/trueTime.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const IST = 'Asia/Kolkata';

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

const calcDurationMinutes = (start, end) => {
    if (!start || !end) return null;
    const toSec = (t) => {
        const parts = t.trim().split(' ');
        const [time, periodRaw] = parts;
        const period = (periodRaw || '').toUpperCase();
        let [h, m, s] = time.split(':').map(Number);
        if (period === 'PM' && h !== 12) h += 12;
        if (period === 'AM' && h === 12) h = 0;
        return h * 3600 + m * 60 + (s || 0);
    };
    let diff = toSec(end) - toSec(start);
    if (diff < 0) diff += 24 * 3600;
    return Math.floor(diff / 60);
};

const fmtMins = (mins) => {
    if (mins == null || mins < 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
};

const computePermissionCycle = (sDay, ref = dayjs.utc()) => {
    const refD = dayjs.utc(ref);
    const start = refD.date() >= sDay
        ? refD.date(sDay).startOf('day')
        : refD.subtract(1, 'month').date(sDay).startOf('day');
    const end = start.add(1, 'month').subtract(1, 'day').endOf('day');
    return { start: start.toDate(), end: end.toDate(), label: `${start.format('DD MMM')} – ${end.format('DD MMM')}` };
};

// ════════════════════════════════════════════════════════════════════════════
// MAIN: GET /api/dashboard
// ════════════════════════════════════════════════════════════════════════════

export const getEmployeeDashboard = async (req, res) => {
    try {
        const user = req.user;
        const employeeMongoId = user._id;

        const employee = await Employee.findById(employeeMongoId)
            .select('firstName lastName employeeId status isUpdated department designation profileImage isPermanentEmp doj dateOfBirth officialEmail')
            .lean();

        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        const employeeIdStr = employee.employeeId;
        const todayStr = getNow().date;                                  // IST date
        const nowDate = new Date();
        const yearStart = dayjs.utc().startOf('year').toDate();
        const next30 = dayjs.utc().add(30, 'day').toDate();

        // ── Parallel fetch — every module ────────────────────────────────────
        const [
            documentData,
            todayAtt,
            officeTiming,
            breakPolicy,
            leavePolicy,
            leaveBalanceResult,
            pendingLeavesCount,
            recentLeaves,
            onLeaveTodayDoc,
            upcomingApprovedLeavesCount,
            recentPermissions,
            pendingPermissionsCount,
            myTasks,
            myTickets,
            recentTickets,
            assignedAssetsList,
            upcomingHolidays,
            announcementsRaw,
            payrollRelease,
            currentSchedule,
            currentTeamMembership,
            recentNotifications,
            totalUnreadNotifications,
        ] = await Promise.all([
            // Documents
            Document.findOne({ employee: employeeMongoId })
                .select('overallStatus totalDocuments submittedDocuments verifiedDocuments pendingDocuments')
                .lean(),

            // Today's attendance row
            Attendance.findOne({ employeeId: employeeIdStr, date: todayStr }).lean(),

            // Singleton policies for context
            OfficeTiming.findOne({ key: 'default' }).lean(),
            BreakPolicy.findOne({ key: 'default' }).lean(),
            LeavePolicy.findOne({ isActive: true }).lean(),

            // Leave balance (delegates to existing helper — handles CL accrual)
            calculateLeaveBalance(employeeMongoId, !!employee.isPermanentEmp, dayjs.utc().year())
                .catch((err) => { console.warn('leaveBalance failed:', err.message); return null; }),

            Leave.countDocuments({ employee: employeeMongoId, status: 'PENDING' }),
            Leave.find({ employee: employeeMongoId })
                .sort({ appliedAt: -1 }).limit(5)
                .select('requestId leaveType status startDate endDate totalDays leaveDuration appliedAt')
                .lean(),
            Leave.findOne({
                employee: employeeMongoId,
                status: 'APPROVED',
                startDate: { $lte: nowDate },
                endDate: { $gte: nowDate },
            }).select('requestId leaveType startDate endDate totalDays').lean(),
            Leave.countDocuments({
                employee: employeeMongoId,
                status: 'APPROVED',
                startDate: { $gt: nowDate },
            }),

            // Permissions
            Permission.find({ employee: employeeMongoId })
                .sort({ appliedAt: -1 }).limit(5)
                .select('requestId date fromTime toTime durationText status appliedAt')
                .lean(),
            Permission.countDocuments({ employee: employeeMongoId, status: 'PENDING' }),

            // Tasks
            Task.find({ assignedTo: employeeMongoId })
                .select('taskId title status priority deadline startedAt')
                .lean(),

            // Tickets — full set so we can compute counts + show recents
            Ticket.find({ raisedBy: employeeMongoId })
                .select('ticketId subject category priority status createdAt updatedAt resolvedAt')
                .lean(),
            Ticket.find({ raisedBy: employeeMongoId })
                .sort({ updatedAt: -1 }).limit(3)
                .select('ticketId subject category priority status updatedAt')
                .lean(),

            // Assets
            Asset.find({ assignedTo: employeeMongoId, status: 'ASSIGNED', isActive: true })
                .select('assetId assetName category brand model condition assignedDate')
                .lean(),

            // Upcoming holidays (next 30 days)
            Holiday.find({ date: { $gte: dayjs.utc().startOf('day').toDate(), $lte: next30 } })
                .sort({ date: 1 }).limit(5)
                .select('name date type description').lean(),

            // Announcements targeted at this employee, currently active
            Announcements.find({
                status: 'active',
                employeeIds: employeeMongoId,
                $or: [
                    { expiryDate: { $exists: false } },
                    { expiryDate: null },
                    { expiryDate: { $gte: nowDate } },
                ],
            })
                .sort({ isPinned: -1, createdAt: -1 }).limit(5)
                .select('title description isPinned createdAt expiryDate attachments')
                .lean(),

            // Latest payroll month with this employee's slip PUBLISHED
            PayrollRelease.findOne({
                empState: { $elemMatch: { employeeId: employeeIdStr, published: true } },
            })
                .sort({ month: -1 })
                .select('month empState releasedAt').lean(),

            // Current/upcoming schedule assignment
            Schedule.findOne({
                isDeleted: false,
                'employees.employee': employeeMongoId,
                toDate: { $gte: new Date() },
            })
                .populate('phase', 'phaseName location address')
                .sort({ fromDate: 1 })
                .select('scheduleName scheduleNumber fromDate toDate phase employees')
                .lean(),

            // Current team
            Team.findOne({
                isActive: true,
                $or: [
                    { members: employeeMongoId },
                    { teamLead: employeeMongoId },
                ],
            })
                .populate('teamLead', 'firstName lastName employeeId')
                .populate('project', 'projectId projectName status')
                .select('teamId teamName teamLead project members')
                .lean(),

            // Notifications
            Notification.find({
                $or: [
                    { recipientType: 'EMPLOYEE', recipientId: employeeMongoId },
                    { recipientType: 'ALL' },
                ],
            })
                .sort({ createdAt: -1 }).limit(5)
                .select('title description type status createdAt updatedAt').lean(),

            Notification.countDocuments({
                $or: [
                    { recipientType: 'EMPLOYEE', recipientId: employeeMongoId, status: 'unread' },
                    { recipientType: 'ALL', status: 'unread' },
                ],
            }),
        ]);

        // ── Onboarding (backward-compatible 3-step structure) ────────────────
        const onboardingProgress = calculateOnboardingProgress(employee, documentData);

        // ── Today's attendance summary ───────────────────────────────────────
        const todayAttendance = buildTodayAttendance({ todayAtt, todayStr, officeTiming, breakPolicy });

        // ── Leave summary ────────────────────────────────────────────────────
        const leaveSummary = buildLeaveSummary({
            balance: leaveBalanceResult,
            pending: pendingLeavesCount,
            upcoming: upcomingApprovedLeavesCount,
            onLeaveToday: onLeaveTodayDoc,
            recent: recentLeaves,
        });

        // ── Permission cycle summary ─────────────────────────────────────────
        const permissionSummary = await buildPermissionSummary({
            employeeMongoId, leavePolicy, pendingCount: pendingPermissionsCount, recent: recentPermissions,
        });

        // ── Task summary ─────────────────────────────────────────────────────
        const taskSummary = buildTaskSummary(myTasks);

        // ── Ticket summary ───────────────────────────────────────────────────
        const ticketSummary = buildTicketSummary(myTickets, recentTickets);

        // ── Asset summary ────────────────────────────────────────────────────
        const assetSummary = {
            count: assignedAssetsList.length,
            items: assignedAssetsList.map((a) => ({
                assetId: a.assetId,
                name: a.assetName,
                category: a.category,
                brand: a.brand,
                model: a.model,
                condition: a.condition,
                assignedDate: a.assignedDate,
            })),
        };

        // ── Current assignment (schedule + phase + team) ─────────────────────
        const currentAssignment = buildCurrentAssignment({ currentSchedule, currentTeamMembership, employeeMongoId });

        // ── Payroll availability ─────────────────────────────────────────────
        const payrollSummary = buildPayrollSummary({ payrollRelease, employeeIdStr });

        // ── Holidays ─────────────────────────────────────────────────────────
        const holidays = upcomingHolidays.map((h) => ({
            name: h.name,
            date: dayjs.utc(h.date).format('YYYY-MM-DD'),
            label: dayjs.utc(h.date).format('DD MMM, ddd'),
            type: h.type,
            description: h.description,
            daysAway: Math.max(dayjs.utc(h.date).startOf('day').diff(dayjs.utc().startOf('day'), 'day'), 0),
        }));

        // ── Announcements ────────────────────────────────────────────────────
        const announcements = announcementsRaw.map((a) => ({
            id: a._id,
            title: a.title,
            description: a.description,
            isPinned: !!a.isPinned,
            createdAt: a.createdAt,
            expiryDate: a.expiryDate,
            attachmentCount: a.attachments?.length ?? 0,
            time: formatTimeAgo(a.createdAt),
        }));

        // ── Recent notifications (kept compatible with existing frontend) ────
        const formattedNotifications = recentNotifications.map((n) => ({
            id: n._id,
            title: n.title,
            description: n.description,
            type: n.type,
            status: n.status,
            time: formatTimeAgo(n.updatedAt ?? n.createdAt),
            isNew: isNotificationNew(n.createdAt),
        }));

        // ── Stat cards (kept identical so existing frontend still renders) ───
        const statsCards = {
            pendingDocuments: documentData?.pendingDocuments ?? 0,
            assignedAssets: assetSummary.count,
            openTickets: ticketSummary.open + ticketSummary.inProgress,
            notifications: totalUnreadNotifications,
        };

        // ── Quick action flags — drives the quick-action panel ───────────────
        const quickActions = {
            canClockIn: !todayAtt?.clockIn,
            canClockOut: !!todayAtt?.clockIn && !todayAtt?.clockOut,
            canTakeBreak: !!todayAtt?.clockIn && !todayAtt?.clockOut &&
                !todayAtt?.breaks?.some((b) => b.start && !b.end),
            canEndBreak: !!todayAtt?.breaks?.some((b) => b.start && !b.end),
            hasPendingDocs: (documentData?.pendingDocuments ?? 0) > 0,
            profilePending: !employee.isUpdated,
        };

        return res.json({
            success: true,
            message: 'Dashboard data fetched successfully',
            data: {
                employee: {
                    id: employee._id,
                    employeeId: employee.employeeId,
                    name: `${employee.firstName} ${employee.lastName}`,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    department: employee.department,
                    designation: employee.designation,
                    profileStatus: employee.status,
                    profileImage: employee.profileImage ?? null,
                    isPermanentEmp: !!employee.isPermanentEmp,
                    doj: employee.doj,
                    email: employee.officialEmail,
                },
                onboarding: onboardingProgress,
                stats: statsCards,
                recentNotifications: formattedNotifications,

                // ── Rich payload ──
                todayAttendance,
                leaves: leaveSummary,
                permissions: permissionSummary,
                tasks: taskSummary,
                tickets: ticketSummary,
                assets: assetSummary,
                currentAssignment,
                payroll: payrollSummary,
                upcomingHolidays: holidays,
                announcements,
                quickActions,
                generatedAt: new Date(),
            },
        });

    } catch (error) {
        console.error('Error fetching dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard data',
            error: error.message,
        });
    }
};

// ════════════════════════════════════════════════════════════════════════════
// Section builders
// ════════════════════════════════════════════════════════════════════════════

function buildTodayAttendance({ todayAtt, todayStr, officeTiming, breakPolicy }) {
    const officeStart = officeTiming?.startTime ?? '09:00';
    const officeEnd   = officeTiming?.endTime   ?? '18:00';

    if (!todayAtt) {
        return {
            date: todayStr,
            status: 'not_clocked_in',
            statusLabel: 'Not Clocked In',
            clockIn: null,
            clockOut: null,
            workMinutes: null,
            breakMinutes: 0,
            netWorkMinutes: null,
            onBreakNow: false,
            activeBreakType: null,
            breaksUsed: [],
            lateLogin: false,
            lateByMinutes: null,
            officeTiming: { startTime: officeStart, endTime: officeEnd },
            availableBreaks: (breakPolicy?.slots ?? []).filter((s) => s.isActive).map((s) => ({
                type: s.type, label: s.label, allowedMinutes: s.allowedMinutes,
            })),
        };
    }

    const activeBreak = todayAtt.breaks?.find((b) => b.start && !b.end);
    const onBreakNow = !!activeBreak;

    const workMinutes = calcDurationMinutes(todayAtt.clockIn, todayAtt.clockOut);
    const breakMinutes = (todayAtt.breaks ?? []).reduce(
        (acc, b) => acc + (calcDurationMinutes(b.start, b.end) || 0), 0,
    );
    const netWorkMinutes = workMinutes != null ? workMinutes - breakMinutes : null;

    let status, statusLabel;
    if (!todayAtt.clockIn) { status = 'not_clocked_in'; statusLabel = 'Not Clocked In'; }
    else if (todayAtt.clockOut) { status = 'completed'; statusLabel = 'Day Completed'; }
    else if (onBreakNow) { status = 'on_break'; statusLabel = `On ${activeBreak.breakType?.toLowerCase()} break`; }
    else { status = 'active'; statusLabel = 'Working'; }

    const usedBreakTypes = new Set(
        (todayAtt.breaks ?? []).filter((b) => b.end).map((b) => b.breakType),
    );
    const availableBreaks = (breakPolicy?.slots ?? [])
        .filter((s) => s.isActive && !usedBreakTypes.has(s.type))
        .map((s) => ({ type: s.type, label: s.label, allowedMinutes: s.allowedMinutes }));

    return {
        date: todayStr,
        status,
        statusLabel,
        clockIn: todayAtt.clockIn,
        clockOut: todayAtt.clockOut ?? null,
        workMinutes,
        workFormatted: fmtMins(workMinutes),
        breakMinutes,
        breakFormatted: fmtMins(breakMinutes),
        netWorkMinutes,
        netFormatted: fmtMins(netWorkMinutes),
        onBreakNow,
        activeBreakType: activeBreak?.breakType ?? null,
        activeBreakStart: activeBreak?.start ?? null,
        breaksUsed: (todayAtt.breaks ?? []).map((b) => ({
            type: b.breakType,
            start: b.start,
            end: b.end,
            duration: calcDurationMinutes(b.start, b.end),
            isViolation: !!b.isBreakViolation,
            overByMinutes: b.overByMinutes ?? null,
        })),
        lateLogin: !!todayAtt.lateLogin,
        lateByMinutes: todayAtt.lateByMinutes ?? null,
        earlyLogout: !!todayAtt.earlyLogout,
        earlyByMinutes: todayAtt.earlyByMinutes ?? null,
        officeTiming: { startTime: officeStart, endTime: officeEnd },
        availableBreaks,
    };
}

function buildLeaveSummary({ balance, pending, upcoming, onLeaveToday, recent }) {
    // calculateLeaveBalance returns:
    //   casual:    { annualPool, earnedToDate, usedToDate, availableNow, annualRemaining, ... }
    //   sick:      { total, used, remaining }   (only when isPermanentEmp)
    //   maternity: { total, used, remaining }
    //   paternity: { total, used, remaining }
    //   lop:       { daysThisYear }
    //
    // Normalise to a single shape the frontend can render the same way the
    // Leave Management page does (available / total, e.g. "2 / 8").

    const casual = balance?.casual
        ? {
            available:       balance.casual.availableNow   ?? 0,  // ← big number ("2")
            total:           balance.casual.annualPool     ?? 0,  // ← denominator ("8")
            used:            balance.casual.usedToDate     ?? 0,
            earned:          balance.casual.earnedToDate   ?? 0,
            annualRemaining: balance.casual.annualRemaining ?? 0,
        }
        : { available: 0, total: 0, used: 0, earned: 0, annualRemaining: 0 };

    const normPerm = (b) => b
        ? {
            available: b.remaining ?? 0,
            total:     b.total     ?? 0,
            used:      b.used      ?? 0,
            earned:    b.total     ?? 0,   // permanent buckets are fully earned up-front
          }
        : { available: 0, total: 0, used: 0, earned: 0 };

    return {
        balance: {
            casual,
            sick:      normPerm(balance?.sick),
            maternity: normPerm(balance?.maternity),
            paternity: normPerm(balance?.paternity),
        },
        lopYTD: balance?.lop?.daysThisYear ?? 0,
        pending,
        upcomingApproved: upcoming,
        onLeaveToday: onLeaveToday
            ? {
                requestId: onLeaveToday.requestId,
                leaveType: onLeaveToday.leaveType,
                startDate: dayjs.utc(onLeaveToday.startDate).format('YYYY-MM-DD'),
                endDate:   dayjs.utc(onLeaveToday.endDate).format('YYYY-MM-DD'),
                totalDays: onLeaveToday.totalDays,
            }
            : null,
        recent: recent.map((l) => ({
            requestId:     l.requestId,
            leaveType:     l.leaveType,
            leaveDuration: l.leaveDuration,
            status:        l.status,
            startDate:     dayjs.utc(l.startDate).format('YYYY-MM-DD'),
            endDate:       dayjs.utc(l.endDate).format('YYYY-MM-DD'),
            totalDays:     l.totalDays,
            appliedAt:     l.appliedAt,
            time:          formatTimeAgo(l.appliedAt),
        })),
    };
}

async function buildPermissionSummary({ employeeMongoId, leavePolicy, pendingCount, recent }) {
    const maxHours = leavePolicy?.permissionLeave?.hoursPerMonth ?? 2;
    const sDay     = leavePolicy?.salaryCycle?.startDay ?? 21;
    const cycle    = computePermissionCycle(sDay);

    const inCycle = await Permission.find({
        employee: employeeMongoId,
        date: { $gte: cycle.start, $lte: cycle.end },
        status: { $in: ['PENDING', 'APPROVED'] },
    }).select('durationHours').lean();

    const usedHours = +inCycle.reduce((s, p) => s + (p.durationHours ?? 0), 0).toFixed(2);
    const remainingHours = +(Math.max(maxHours - usedHours, 0)).toFixed(2);

    return {
        cycleLabel: cycle.label,
        maxHours,
        usedHours,
        usedMinutes: Math.round(usedHours * 60),
        remainingHours,
        remainingMinutes: Math.round(remainingHours * 60),
        usagePct: Math.min(Math.round((usedHours / maxHours) * 100), 100),
        pending: pendingCount,
        recent: recent.map((p) => ({
            requestId: p.requestId,
            date: dayjs.utc(p.date).format('YYYY-MM-DD'),
            fromTime: p.fromTime,
            toTime: p.toTime,
            duration: p.durationText,
            status: p.status,
            appliedAt: p.appliedAt,
            time: formatTimeAgo(p.appliedAt),
        })),
    };
}

function buildTaskSummary(myTasks) {
    const now = new Date();
    let pending = 0, inProgress = 0, awaitingReview = 0, completed = 0, overdue = 0;

    for (const t of myTasks) {
        if (t.status === 'pending') pending++;
        else if (t.status === 'in_progress') inProgress++;
        else if (t.status === 'completed_by_employee') awaitingReview++;
        else if (t.status === 'completed') completed++;

        if (['pending', 'in_progress'].includes(t.status) && t.deadline && new Date(t.deadline) < now) {
            overdue++;
        }
    }

    // Upcoming deadlines (next 5 still-active tasks)
    const upcoming = myTasks
        .filter((t) => ['pending', 'in_progress'].includes(t.status) && t.deadline)
        .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
        .slice(0, 5)
        .map((t) => ({
            taskId: t.taskId,
            title: t.title,
            priority: t.priority,
            status: t.status,
            deadline: t.deadline,
            isOverdue: new Date(t.deadline) < now,
            daysToDeadline: Math.ceil((new Date(t.deadline) - now) / (1000 * 60 * 60 * 24)),
        }));

    return {
        total: myTasks.length,
        pending,
        inProgress,
        awaitingReview,
        completed,
        overdue,
        upcomingDeadlines: upcoming,
    };
}

function buildTicketSummary(myTickets, recent) {
    let open = 0, inProgress = 0, resolved = 0;
    for (const t of myTickets) {
        if (t.status === 'OPEN') open++;
        else if (t.status === 'IN_PROGRESS') inProgress++;
        else if (t.status === 'RESOLVED') resolved++;
    }
    return {
        total: myTickets.length,
        open,
        inProgress,
        resolved,
        recent: recent.map((t) => ({
            ticketId: t.ticketId,
            subject: t.subject,
            category: t.category,
            priority: t.priority,
            status: t.status,
            time: formatTimeAgo(t.updatedAt),
        })),
    };
}

function buildCurrentAssignment({ currentSchedule, currentTeamMembership, employeeMongoId }) {
    const out = { schedule: null, phase: null, team: null };

    if (currentSchedule) {
        const myEntry = (currentSchedule.employees ?? []).find(
            (e) => e.employee?.toString() === employeeMongoId.toString() && e.isActive,
        );
        if (myEntry) {
            out.schedule = {
                scheduleId: currentSchedule._id,
                scheduleName: currentSchedule.scheduleName,
                scheduleNumber: currentSchedule.scheduleNumber,
                fromDate: currentSchedule.fromDate,
                toDate: currentSchedule.toDate,
                assignedAt: myEntry.addedAt,
                isActive: dayjs.utc().isAfter(dayjs.utc(currentSchedule.fromDate).startOf('day')) &&
                          dayjs.utc().isBefore(dayjs.utc(currentSchedule.toDate).endOf('day')),
            };
            if (currentSchedule.phase) {
                out.phase = {
                    phaseId: currentSchedule.phase._id,
                    phaseName: currentSchedule.phase.phaseName,
                    location: currentSchedule.phase.location,
                    address: currentSchedule.phase.address,
                };
            }
        }
    }

    if (currentTeamMembership) {
        const isLead = currentTeamMembership.teamLead?._id?.toString() === employeeMongoId.toString();
        out.team = {
            teamId: currentTeamMembership.teamId,
            teamName: currentTeamMembership.teamName,
            memberCount: currentTeamMembership.members?.length ?? 0,
            isTeamLead: isLead,
            teamLead: currentTeamMembership.teamLead
                ? `${currentTeamMembership.teamLead.firstName} ${currentTeamMembership.teamLead.lastName}`
                : null,
            project: currentTeamMembership.project
                ? {
                    projectId: currentTeamMembership.project.projectId,
                    projectName: currentTeamMembership.project.projectName,
                    status: currentTeamMembership.project.status,
                }
                : null,
        };
    }

    return out;
}

function buildPayrollSummary({ payrollRelease, employeeIdStr }) {
    if (!payrollRelease) {
        return { available: false, latestMonth: null, publishedAt: null };
    }
    const myState = (payrollRelease.empState ?? []).find((s) => s.employeeId === employeeIdStr);
    return {
        available: !!myState?.published,
        latestMonth: payrollRelease.month,
        publishedAt: myState?.publishedAt ?? payrollRelease.releasedAt ?? null,
    };
}

// ════════════════════════════════════════════════════════════════════════════
// Onboarding (unchanged — preserves the contract the current frontend uses)
// ════════════════════════════════════════════════════════════════════════════

function calculateOnboardingProgress(employee, documentData) {
    const steps = [
        {
            step: 1,
            title: 'Basic Information',
            description: 'Complete your profile details',
            status: 'pending',
            completed: false,
            unlocked: true,
        },
        {
            step: 2,
            title: 'Upload Documents',
            description: 'Submit required documents',
            status: 'pending',
            completed: false,
            unlocked: false,
        },
        {
            step: 3,
            title: 'Document Verification',
            description: 'HR verification of documents',
            status: 'pending',
            completed: false,
            unlocked: false,
        },
    ];

    if (employee.isUpdated && employee.status !== 'pending') {
        steps[0].status = 'completed';
        steps[0].completed = true;
        steps[1].unlocked = true;
    }

    if (documentData) {
        if ((documentData.submittedDocuments ?? 0) > 0) {
            steps[1].status = 'completed';
            steps[1].completed = true;
            steps[2].unlocked = true;
        } else {
            steps[1].status = 'pending';
        }
    }

    if (documentData) {
        if (documentData.overallStatus === 'completed') {
            steps[2].status = 'completed';
            steps[2].completed = true;
        } else if (documentData.overallStatus === 'in_progress') {
            steps[2].status = 'in_progress';
        } else {
            steps[2].status = 'pending';
        }
    }

    const completedSteps = steps.filter((s) => s.completed).length;
    const progressPercentage = Math.round((completedSteps / steps.length) * 100);

    return {
        steps,
        completedSteps,
        totalSteps: steps.length,
        progressPercentage,
        overallStatus: steps[2].completed ? 'completed' : 'in_progress',
    };
}

// ════════════════════════════════════════════════════════════════════════════
// Time helpers
// ════════════════════════════════════════════════════════════════════════════

function formatTimeAgo(date) {
    if (!date) return '';
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    return new Date(date).toLocaleDateString();
}

function isNotificationNew(createdAt) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return new Date(createdAt) > oneDayAgo;
}

// ════════════════════════════════════════════════════════════════════════════
// LEGACY ENDPOINTS — kept as-is for backwards compatibility
// ════════════════════════════════════════════════════════════════════════════

export const getEmployerDashboard = async (req, res) => {
    try {
        const user = req.user;
        const userId = user._id;
        const userRole = user.role;

        const [
            totalEmployees,
            pendingDocuments,
            openTickets,
            recentNotifications,
            totalUnreadNotifications,
            pendingOnboarding,
        ] = await Promise.all([
            Employee.countDocuments({ isActive: true }),
            Document.aggregate([
                {
                    $project: {
                        pendingCount: {
                            $size: {
                                $filter: {
                                    input: { $objectToArray: '$$ROOT' },
                                    as: 'field',
                                    cond: {
                                        $and: [
                                            { $ne: ['$$field.k', '_id'] },
                                            { $ne: ['$$field.k', 'employee'] },
                                            { $ne: ['$$field.k', 'employeeId'] },
                                            { $ne: ['$$field.k', 'overallStatus'] },
                                            { $ne: ['$$field.k', 'createdAt'] },
                                            { $ne: ['$$field.k', 'updatedAt'] },
                                            { $eq: ['$$field.v.status', 'doc_submitted'] },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                { $group: { _id: null, totalPending: { $sum: '$pendingCount' } } },
            ]),
            Ticket.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }),
            Notification.find({
                $or: [
                    { recipientType: userRole, recipientId: userId },
                    { recipientType: 'ALL' },
                ],
            }).sort({ createdAt: -1 }).limit(5).select('title description type status createdAt').lean(),
            Notification.countDocuments({
                $or: [
                    { recipientType: userRole, recipientId: userId, status: 'unread' },
                    { recipientType: 'ALL', status: 'unread' },
                ],
            }),
            Employee.countDocuments({ isActive: true, status: { $ne: 'verified' } }),
        ]);

        let statsCards = {};
        if (userRole === 'EMPLOYER_HR' || userRole === 'EMPLOYER_ADMIN') {
            statsCards = {
                totalEmployees,
                pendingDocuments: pendingDocuments[0]?.totalPending ?? 0,
                pendingOnboarding,
                openTickets,
                notifications: totalUnreadNotifications,
            };
        } else if (userRole === 'EMPLOYER_IT') {
            statsCards = {
                assignedTickets: await Ticket.countDocuments({
                    assignedTo: userId, status: { $in: ['OPEN', 'IN_PROGRESS'] },
                }),
                totalOpenTickets: openTickets,
                assignedAssets: await Asset.countDocuments({
                    assignedTo: { $ne: null }, status: 'ASSIGNED',
                }),
                notifications: totalUnreadNotifications,
            };
        }

        const formattedNotifications = recentNotifications.map((n) => ({
            id: n._id, title: n.title, description: n.description, type: n.type,
            status: n.status, time: formatTimeAgo(n.updatedAt ?? n.createdAt),
            isNew: isNotificationNew(n.createdAt),
        }));

        return res.json({
            success: true,
            message: 'Dashboard data fetched successfully',
            data: {
                user: { id: user._id, name: `${user.firstName} ${user.lastName}`, role: userRole, email: user.email },
                stats: statsCards,
                recentNotifications: formattedNotifications,
            },
        });

    } catch (error) {
        console.error('Error fetching employer dashboard:', error);
        return res.status(500).json({
            success: false, message: 'Error fetching dashboard data', error: error.message,
        });
    }
};

export const getAdminOverview = async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== 'EMPLOYER_ADMIN') {
            return res.status(403).json({ success: false, message: 'Access denied. Admin only.' });
        }

        const [
            totalEmployees, activeEmployees, pendingVerification,
            totalDocuments, verifiedDocuments,
            totalTickets, resolvedTickets,
            totalAssets, assignedAssets,
        ] = await Promise.all([
            Employee.countDocuments({}),
            Employee.countDocuments({ isActive: true }),
            Employee.countDocuments({ status: { $ne: 'verified' } }),
            Document.countDocuments({}),
            Document.countDocuments({ overallStatus: 'completed' }),
            Ticket.countDocuments({}),
            Ticket.countDocuments({ status: 'RESOLVED' }),
            Asset.countDocuments({}),
            Asset.countDocuments({ status: 'ASSIGNED' }),
        ]);

        const verificationRate = totalEmployees > 0
            ? Math.round(((totalEmployees - pendingVerification) / totalEmployees) * 100) : 0;
        const documentCompletionRate = totalDocuments > 0
            ? Math.round((verifiedDocuments / totalDocuments) * 100) : 0;
        const ticketResolutionRate = totalTickets > 0
            ? Math.round((resolvedTickets / totalTickets) * 100) : 0;
        const assetAssignmentRate = totalAssets > 0
            ? Math.round((assignedAssets / totalAssets) * 100) : 0;

        const recentActivities = await Promise.all([
            Employee.find().sort({ createdAt: -1 }).limit(5)
                .select('firstName lastName employeeId department createdAt').lean(),
            Document.find({ overallStatus: 'completed' }).sort({ completedAt: -1 }).limit(5)
                .populate('employee', 'firstName lastName employeeId')
                .select('employee overallStatus completedAt').lean(),
            Ticket.find({ status: 'RESOLVED' }).sort({ resolvedAt: -1 }).limit(5)
                .populate('raisedBy', 'firstName lastName')
                .select('ticketId subject category resolvedAt').lean(),
        ]);

        return res.json({
            success: true,
            message: 'Admin overview fetched successfully',
            data: {
                statistics: {
                    employees: {
                        total: totalEmployees, active: activeEmployees,
                        pendingVerification, verificationRate: `${verificationRate}%`,
                    },
                    documents: { total: totalDocuments, verified: verifiedDocuments, completionRate: `${documentCompletionRate}%` },
                    tickets: { total: totalTickets, resolved: resolvedTickets, resolutionRate: `${ticketResolutionRate}%` },
                    assets: { total: totalAssets, assigned: assignedAssets, assignmentRate: `${assetAssignmentRate}%` },
                },
                recentActivities: {
                    newEmployees: recentActivities[0],
                    verifiedDocuments: recentActivities[1],
                    resolvedTickets: recentActivities[2],
                },
            },
        });

    } catch (error) {
        console.error('Error fetching admin overview:', error);
        return res.status(500).json({
            success: false, message: 'Error fetching admin overview', error: error.message,
        });
    }
};