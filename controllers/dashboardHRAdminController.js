/**
 * dashboardHRAdminController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Professional HR / Admin dashboard for KIAQ HRMS.
 *
 * Exposes three endpoints:
 *   GET /api/dashboard/stats              → all KPI cards, charts & widget data
 *   GET /api/dashboard/onboarding-progress → paginated onboarding tracker
 *   GET /api/dashboard/recent-activity    → unified activity timeline
 *
 * Aggregates from EVERY module:
 *   Employees, Documents, Tickets, Assets, Leaves, Permissions, Attendance,
 *   Announcements, Payroll (PayrollRelease), Projects, Teams, Tasks, Phases,
 *   Schedules, ActivityLogPhaseSchedule.
 *
 * Heavy use of $facet aggregations and Promise.all parallelism so the entire
 * dashboard payload is built in a small, predictable number of round-trips.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Employee from '../model/Employee.js';
import EmployerUser from '../model/EmployerUser.js';
import Document from '../model/Document.js';
import Ticket from '../model/Ticket.js';
import Asset from '../model/Asset.js';
import Leave from '../model/Leave.js';
import Permission from '../model/Permission.js';
import Attendance from '../model/Attendance.js';
import Announcements from '../model/Announcements.js';
import PayrollRelease from '../model/Payrollrelease.js';
import Projects from '../model/Projects.js';
import Team from '../model/Team.js';
import Task from '../model/Task.js';
import Phase from '../model/Phase.js';
import Schedule from '../model/Schedule.js';
import ActivityLogPhaseSchedule from '../model/ActivityLogPhaseSchedule.js';
import Notification from '../model/Notification.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { getNow } from '../utils/trueTime.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const IST = 'Asia/Kolkata';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const safeDiv = (a, b) => (b > 0 ? a / b : 0);
const pct = (a, b) => `${(safeDiv(a, b) * 100).toFixed(1)}%`;
const roleGuard = (req, res) => {
    if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
        res.status(403).json({ success: false, message: 'Only ADMIN or HR can access this resource' });
        return false;
    }
    return true;
};

const errorOut = (res, err, ctx) => {
    console.error(`${ctx} error:`, err);
    return res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
};

// ────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/stats
// One-shot endpoint that returns everything the dashboard renders.
// ────────────────────────────────────────────────────────────────────────────

export const getDashboardStats = async (req, res) => {
    try {
        if (!roleGuard(req, res)) return;

        const todayStr = getNow().date;                              // "YYYY-MM-DD" IST
        const todayStart = dayjs.tz(todayStr, IST).startOf('day').toDate();
        const todayEnd = dayjs.tz(todayStr, IST).endOf('day').toDate();
        const last7 = dayjs.utc().subtract(7, 'day').toDate();
        const last30 = dayjs.utc().subtract(30, 'day').toDate();
        const yearStart = dayjs.utc(`${dayjs.utc().year()}-01-01`).toDate();

        // ── Run independent aggregations in parallel ────────────────────────
        const [
            employeeStats,
            documentStats,
            ticketStats,
            assetStats,
            leaveStats,
            permissionStats,
            attendanceToday,
            announcementStats,
            payrollStats,
            projectStats,
            teamStats,
            taskStats,
            phaseScheduleStats,
            onboardingFunnel,
            departmentDistribution,
            designationDistribution,
            attendanceTrend7d,
            ticketTrend30d,
            leaveTrend30d,
            taskCompletionTrend30d,
            recentJoiners,
            upcomingBirthdays,
            criticalAlerts,
        ] = await Promise.all([
            aggEmployees(todayStart, last30),
            aggDocuments(),
            aggTickets(),
            aggAssets(),
            aggLeaves(yearStart),
            aggPermissions(),
            aggAttendanceToday(todayStr),
            aggAnnouncements(),
            aggPayroll(),
            aggProjects(),
            aggTeams(),
            aggTasks(),
            aggPhaseSchedules(),
            aggOnboardingFunnel(),
            aggDepartmentDistribution(),
            aggDesignationDistribution(),
            aggAttendanceTrend(7, todayStr),
            aggTicketTrend(30),
            aggLeaveTrend(30),
            aggTaskCompletionTrend(30),
            aggRecentJoiners(),
            aggUpcomingBirthdays(),
            aggCriticalAlerts(todayStr),
        ]);

        return res.status(200).json({
            success: true,
            message: 'Dashboard statistics retrieved successfully',
            generatedAt: new Date(),
            data: {
                // ── Top KPI cards (8 primary tiles) ─────────────────────────
                kpis: {
                    totalEmployees: employeeStats.total,
                    activeEmployees: employeeStats.active,
                    pendingTickets: ticketStats.open + ticketStats.inProgress,
                    pendingDocuments: documentStats.pendingEmployees,
                    pendingLeaves: leaveStats.pending,
                    pendingPermissions: permissionStats.pending,
                    presentToday: attendanceToday.present,
                    activeAssets: assetStats.assigned,
                },

                // ── Module-level breakdowns ─────────────────────────────────
                employees: employeeStats,
                documents: documentStats,
                tickets: ticketStats,
                assets: assetStats,
                leaves: leaveStats,
                permissions: permissionStats,
                attendance: attendanceToday,
                announcements: announcementStats,
                payroll: payrollStats,
                projects: projectStats,
                teams: teamStats,
                tasks: taskStats,
                phaseSchedules: phaseScheduleStats,

                // ── Onboarding 3-step funnel (kept for backward-compat) ─────
                onboardingProgressOverview: onboardingFunnel,

                // ── Charts ──────────────────────────────────────────────────
                charts: {
                    departmentDistribution,
                    designationDistribution,
                    attendanceTrend7d,
                    ticketTrend30d,
                    leaveTrend30d,
                    taskCompletionTrend30d,
                },

                // ── Side widgets ────────────────────────────────────────────
                widgets: {
                    recentJoiners,
                    upcomingBirthdays,
                    criticalAlerts,
                },
            },
        });
    } catch (err) {
        return errorOut(res, err, 'getDashboardStats');
    }
};

// ────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/onboarding-progress
// Paginated employee-by-employee onboarding tracker with filters.
// Query: ?page=1&limit=10&step=1|2|3&department=
// ────────────────────────────────────────────────────────────────────────────

export const getOnboardingProgress = async (req, res) => {
    try {
        if (!roleGuard(req, res)) return;

        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
        const skip = (page - 1) * limit;
        const { step, department, search } = req.query;

        const empFilter = {};
        if (department) empFilter.department = department;
        if (search) {
            empFilter.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { employeeId: { $regex: search, $options: 'i' } },
                { officialEmail: { $regex: search, $options: 'i' } },
            ];
        }

        // Pull the full set first so we can compute step on each then page.
        // For large tenants you'd push step calc into aggregation, but the
        // overall count is bounded (single company HRMS).
        const employees = await Employee.find(empFilter)
            .select('employeeId firstName lastName department designation status isUpdated profileImage createdAt lastUpdatedAt isActive')
            .sort({ createdAt: -1 })
            .lean();

        const empIds = employees.map((e) => e._id);
        const docs = await Document.find({ employee: { $in: empIds } })
            .select('employee overallStatus verificationProgress totalDocuments verifiedDocuments')
            .lean();

        const docMap = {};
        for (const d of docs) docMap[d.employee.toString()] = d;

        const withProgress = employees.map((emp) => {
            const doc = docMap[emp._id.toString()];

            let stepNum = 1;
            let stepLabel = 'Profile Pending';

            if (emp.isUpdated) {
                stepNum = 2;
                stepLabel = 'Documents Pending';
                if (doc) {
                    if (doc.overallStatus === 'completed') {
                        stepNum = 3;
                        stepLabel = 'Verification Completed';
                    } else if (doc.overallStatus === 'in_progress') {
                        stepNum = 2;
                        stepLabel = 'Documents In Progress';
                    }
                }
            }

            const totalDocs = doc?.totalDocuments ?? 0;
            const verifiedDocs = doc?.verifiedDocuments ?? 0;
            const progressPct = totalDocs > 0
                ? Math.round((verifiedDocs / totalDocs) * 100)
                : (emp.isUpdated ? 33 : 0);

            return {
                _id: emp._id,
                employeeId: emp.employeeId,
                name: `${emp.firstName} ${emp.lastName}`,
                department: emp.department,
                designation: emp.designation,
                profileImage: emp.profileImage ?? null,
                status: emp.status,
                isActive: emp.isActive,
                isUpdated: emp.isUpdated,
                step: stepNum,
                stepLabel,
                stepProgress: `${stepNum}/3`,
                progressPct,
                documentStatus: doc?.overallStatus ?? 'pending',
                verificationProgress: doc?.verificationProgress ?? '0/0',
                joinedAt: emp.createdAt,
                lastUpdatedAt: emp.lastUpdatedAt,
            };
        });

        // Apply step filter post-calc
        const filtered = step
            ? withProgress.filter((e) => e.step === parseInt(step))
            : withProgress;

        const total = filtered.length;
        const paged = filtered.slice(skip, skip + limit);

        const summary = {
            step1: withProgress.filter((e) => e.step === 1).length,
            step2: withProgress.filter((e) => e.step === 2).length,
            step3: withProgress.filter((e) => e.step === 3).length,
            totalEmployees: withProgress.length,
            completionRate: pct(
                withProgress.filter((e) => e.step === 3).length,
                withProgress.length,
            ),
        };

        const totalPages = Math.max(Math.ceil(total / limit), 1);

        return res.status(200).json({
            success: true,
            message: 'Onboarding progress retrieved successfully',
            data: {
                onboardingProgress: paged,
                summary,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: total,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
            },
        });
    } catch (err) {
        return errorOut(res, err, 'getOnboardingProgress');
    }
};

// ────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/recent-activity
// Unified timeline pulled from every meaningful module.
// Query: ?limit=20&type=TICKET|DOCUMENT|LEAVE|PROFILE|ASSET|ANNOUNCEMENT|TASK|PHASE
// ────────────────────────────────────────────────────────────────────────────

export const getRecentActivity = async (req, res) => {
    try {
        if (!roleGuard(req, res)) return;

        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const typeFilter = req.query.type ? new Set(req.query.type.split(',')) : null;
        const perSource = Math.max(Math.ceil(limit / 4), 5);

        const [
            tickets,
            docs,
            leaves,
            permissions,
            profiles,
            assets,
            announcements,
            tasks,
            phaseLogs,
            joiners,
        ] = await Promise.all([
            Ticket.find({}).populate('raisedBy', 'firstName lastName employeeId')
                .sort({ updatedAt: -1 }).limit(perSource).lean(),
            Document.find({ updatedAt: { $exists: true } })
                .populate('employee', 'firstName lastName employeeId')
                .populate('lastVerifiedBy', 'firstName lastName')
                .sort({ updatedAt: -1 }).limit(perSource).lean(),
            Leave.find({}).sort({ appliedAt: -1 }).limit(perSource)
                .populate('employee', 'firstName lastName employeeId').lean(),
            Permission.find({}).sort({ appliedAt: -1 }).limit(perSource).lean(),
            Employee.find({ isUpdated: true, lastUpdatedAt: { $ne: null } })
                .select('employeeId firstName lastName department lastUpdatedAt')
                .sort({ lastUpdatedAt: -1 }).limit(perSource).lean(),
            Asset.find({}).sort({ updatedAt: -1 }).limit(perSource)
                .populate('assignedTo', 'firstName lastName employeeId').lean(),
            Announcements.find({}).sort({ createdAt: -1 }).limit(perSource)
                .populate('createdBy', 'firstName lastName').lean(),
            Task.find({}).sort({ updatedAt: -1 }).limit(perSource)
                .populate('assignedTo', 'firstName lastName').lean(),
            ActivityLogPhaseSchedule.find({}).sort({ createdAt: -1 }).limit(perSource)
                .populate('performedBy', 'firstName lastName').lean(),
            Employee.find({}).sort({ createdAt: -1 }).limit(perSource)
                .select('employeeId firstName lastName department createdAt').lean(),
        ]);

        const activity = [];

        // ── Tickets ────────────────────────────────────────────────────────
        for (const t of tickets) {
            activity.push({
                type: 'TICKET',
                action: t.status === 'RESOLVED'
                    ? `Ticket resolved: ${t.subject}`
                    : `Ticket ${t.status.toLowerCase()}: ${t.subject}`,
                details: {
                    ticketId: t.ticketId,
                    priority: t.priority,
                    category: t.category,
                    status: t.status,
                    raisedBy: t.raisedBy ? `${t.raisedBy.firstName} ${t.raisedBy.lastName}` : 'Unknown',
                },
                timestamp: t.updatedAt ?? t.createdAt,
            });
        }

        // ── Documents ──────────────────────────────────────────────────────
        for (const d of docs) {
            activity.push({
                type: 'DOCUMENT',
                action: d.overallStatus === 'completed'
                    ? 'Document verification completed'
                    : 'Document submission updated',
                details: {
                    employee: d.employee ? `${d.employee.firstName} ${d.employee.lastName}` : 'Unknown',
                    employeeId: d.employee?.employeeId ?? null,
                    progress: d.verificationProgress,
                    verifiedBy: d.lastVerifiedBy
                        ? `${d.lastVerifiedBy.firstName} ${d.lastVerifiedBy.lastName}` : null,
                },
                timestamp: d.updatedAt,
            });
        }

        // ── Leaves ─────────────────────────────────────────────────────────
        for (const l of leaves) {
            activity.push({
                type: 'LEAVE',
                action: `Leave ${l.status.toLowerCase()} – ${l.leaveType}`,
                details: {
                    requestId: l.requestId,
                    employee: l.employeeName,
                    employeeId: l.employeeId,
                    totalDays: l.totalDays,
                    leaveType: l.leaveType,
                    status: l.status,
                },
                timestamp: l.appliedAt ?? l.createdAt,
            });
        }

        // ── Permissions ────────────────────────────────────────────────────
        for (const p of permissions) {
            activity.push({
                type: 'PERMISSION',
                action: `Permission ${p.status.toLowerCase()} – ${p.durationText}`,
                details: {
                    requestId: p.requestId,
                    employee: p.employeeName,
                    employeeId: p.employeeId,
                    duration: p.durationText,
                    fromTime: p.fromTime,
                    toTime: p.toTime,
                    status: p.status,
                },
                timestamp: p.appliedAt ?? p.createdAt,
            });
        }

        // ── Profile updates ────────────────────────────────────────────────
        for (const e of profiles) {
            activity.push({
                type: 'PROFILE',
                action: 'Employee profile updated',
                details: {
                    employeeId: e.employeeId,
                    name: `${e.firstName} ${e.lastName}`,
                    department: e.department,
                },
                timestamp: e.lastUpdatedAt,
            });
        }

        // ── Assets ─────────────────────────────────────────────────────────
        for (const a of assets) {
            activity.push({
                type: 'ASSET',
                action: a.status === 'ASSIGNED' && a.assignedTo
                    ? `Asset assigned: ${a.assetName ?? a.assetId}`
                    : `Asset updated: ${a.assetName ?? a.assetId}`,
                details: {
                    assetId: a.assetId,
                    name: a.assetName,
                    status: a.status,
                    condition: a.condition,
                    assignedTo: a.assignedTo
                        ? `${a.assignedTo.firstName} ${a.assignedTo.lastName}` : null,
                },
                timestamp: a.updatedAt ?? a.createdAt,
            });
        }

        // ── Announcements ──────────────────────────────────────────────────
        for (const an of announcements) {
            activity.push({
                type: 'ANNOUNCEMENT',
                action: `New announcement: ${an.title ?? 'Untitled'}`,
                details: {
                    audience: an.audience,
                    createdBy: an.createdBy
                        ? `${an.createdBy.firstName} ${an.createdBy.lastName}` : null,
                    attachmentCount: an.attachments?.length ?? 0,
                },
                timestamp: an.createdAt,
            });
        }

        // ── Tasks ──────────────────────────────────────────────────────────
        for (const tk of tasks) {
            activity.push({
                type: 'TASK',
                action: `Task ${tk.status} – ${tk.title}`,
                details: {
                    taskId: tk.taskId,
                    title: tk.title,
                    priority: tk.priority,
                    status: tk.status,
                    assignedTo: tk.assignedTo
                        ? `${tk.assignedTo.firstName} ${tk.assignedTo.lastName}` : null,
                },
                timestamp: tk.updatedAt ?? tk.createdAt,
            });
        }

        // ── Phase/Schedule activity logs ───────────────────────────────────
        for (const log of phaseLogs) {
            activity.push({
                type: 'PHASE',
                action: log.message ?? log.action,
                details: {
                    entity: log.entity,
                    action: log.action,
                    performedBy: log.performedBy
                        ? `${log.performedBy.firstName} ${log.performedBy.lastName}` : 'System',
                },
                timestamp: log.createdAt,
            });
        }

        // ── New hires ──────────────────────────────────────────────────────
        for (const j of joiners) {
            activity.push({
                type: 'JOINER',
                action: 'New employee onboarded',
                details: {
                    employeeId: j.employeeId,
                    name: `${j.firstName} ${j.lastName}`,
                    department: j.department,
                },
                timestamp: j.createdAt,
            });
        }

        // Filter by type, sort, slice
        let filtered = typeFilter
            ? activity.filter((a) => typeFilter.has(a.type))
            : activity;

        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const limited = filtered.slice(0, limit);

        // Counts per type for the timeline filter chips
        const counts = filtered.reduce((acc, a) => {
            acc[a.type] = (acc[a.type] ?? 0) + 1;
            return acc;
        }, {});

        return res.status(200).json({
            success: true,
            message: 'Recent activity retrieved successfully',
            data: {
                recentActivity: limited,
                activityCounts: { ...counts, total: limited.length },
            },
        });
    } catch (err) {
        return errorOut(res, err, 'getRecentActivity');
    }
};

// ════════════════════════════════════════════════════════════════════════════
// Aggregation helpers — each does one bounded query/aggregation.
// ════════════════════════════════════════════════════════════════════════════

async function aggEmployees(todayStart, last30) {
    const agg = await Employee.aggregate([
        {
            $facet: {
                total: [{ $count: 'c' }],
                active: [{ $match: { isActive: true } }, { $count: 'c' }],
                inactive: [{ $match: { isActive: false } }, { $count: 'c' }],

                // ── Permanent: must be active AND explicitly permanent ───────────────
                permanent: [
                    { $match: { isActive: true, isPermanentEmp: true } },
                    { $count: 'c' }
                ],

                // ── Probation: active, but not permanent. Handle missing/null too. ───
                probation: [
                    {
                        $match: {
                            isActive: true,
                            $or: [
                                { isPermanentEmp: false },
                                { isPermanentEmp: null },
                                { isPermanentEmp: { $exists: false } },
                            ],
                        },
                    },
                    { $count: 'c' },
                ],

                // ── Resigned: inactive employees, regardless of permanent flag ───────
                resigned: [{ $match: { isActive: false } }, { $count: 'c' }],
                updated: [{ $match: { isUpdated: true } }, { $count: 'c' }],
                pendingUpdate: [{ $match: { isUpdated: false, isActive: true } }, { $count: 'c' }],
                updateRequests: [{ $match: { updateRequested: true } }, { $count: 'c' }],
                tlCount: [{ $match: { role: 'TL', isActive: true } }, { $count: 'c' }],
                newJoinersLast30: [{ $match: { createdAt: { $gte: last30 } } }, { $count: 'c' }],
                joinedToday: [{ $match: { createdAt: { $gte: todayStart } } }, { $count: 'c' }],
                resignedLast30: [
                    { $match: { isActive: false, updatedAt: { $gte: last30 } } },
                    { $count: 'c' },
                ],
                byStatus: [
                    { $group: { _id: '$status', count: { $sum: 1 } } },
                ],
                byGender: [
                    { $match: { gender: { $exists: true, $nin: [null, ''] } } },
                    { $group: { _id: '$gender', count: { $sum: 1 } } },
                ],
            },
        },
    ]);

    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;

    return {
        total: pick('total'),
        active: pick('active'),
        inactive: pick('inactive'),
        permanent: pick('permanent'),
        probation: pick('probation'),
        resigned: pick('resigned'),          // ← NEW
        profileUpdated: pick('updated'),
        profilePending: pick('pendingUpdate'),
        updateRequests: pick('updateRequests'),
        teamLeads: pick('tlCount'),
        newJoinersLast30d: pick('newJoinersLast30'),
        joinedToday: pick('joinedToday'),
        resignedLast30d: pick('resignedLast30'),
        byStatus: r.byStatus.map((x) => ({ status: x._id ?? 'unknown', count: x.count })),
        byGender: r.byGender.map((x) => ({ gender: x._id, count: x.count })),
    };
}

async function aggDocuments() {
    const agg = await Document.aggregate([
        {
            $facet: {
                total: [{ $count: 'c' }],
                pending: [{ $match: { overallStatus: 'pending' } }, { $count: 'c' }],
                inProgress: [{ $match: { overallStatus: 'in_progress' } }, { $count: 'c' }],
                completed: [{ $match: { overallStatus: 'completed' } }, { $count: 'c' }],
                docTotals: [
                    {
                        $group: {
                            _id: null,
                            totalDocs: { $sum: { $ifNull: ['$totalDocuments', 0] } },
                            verifiedDocs: { $sum: { $ifNull: ['$verifiedDocuments', 0] } },
                        },
                    },
                ],
            },
        },
    ]);

    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;
    const totalDocs = r.docTotals?.[0]?.totalDocs ?? 0;
    const verifiedDocs = r.docTotals?.[0]?.verifiedDocs ?? 0;

    return {
        pendingEmployees: pick('pending') + pick('inProgress'),
        completedEmployees: pick('completed'),
        totalEmployees: pick('total'),
        totalDocuments: totalDocs,
        verifiedDocuments: verifiedDocs,
        pendingDocuments: Math.max(totalDocs - verifiedDocs, 0),
        verificationPct: pct(verifiedDocs, totalDocs),
        byStatus: {
            pending: pick('pending'),
            inProgress: pick('inProgress'),
            completed: pick('completed'),
        },
    };
}

async function aggTickets() {
    const agg = await Ticket.aggregate([
        {
            $facet: {
                total: [{ $count: 'c' }],
                open: [{ $match: { status: 'OPEN' } }, { $count: 'c' }],
                inProgress: [{ $match: { status: 'IN_PROGRESS' } }, { $count: 'c' }],
                resolved: [{ $match: { status: 'RESOLVED' } }, { $count: 'c' }],
                byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
                byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
                avgResolution: [
                    { $match: { resolvedAt: { $ne: null } } },
                    {
                        $project: {
                            hours: {
                                $divide: [
                                    { $subtract: ['$resolvedAt', '$createdAt'] },
                                    1000 * 60 * 60,
                                ],
                            },
                        },
                    },
                    { $group: { _id: null, avgHours: { $avg: '$hours' } } },
                ],
                highPriorityOpen: [
                    { $match: { priority: 'HIGH', status: { $ne: 'RESOLVED' } } },
                    { $count: 'c' },
                ],
            },
        },
    ]);

    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;
    const avgHrs = r.avgResolution?.[0]?.avgHours ?? 0;

    return {
        total: pick('total'),
        open: pick('open'),
        inProgress: pick('inProgress'),
        resolved: pick('resolved'),
        highPriorityOpen: pick('highPriorityOpen'),
        avgResolutionHours: Number(avgHrs.toFixed(1)),
        byCategory: r.byCategory.reduce((a, x) => ({ ...a, [x._id]: x.count }), {}),
        byPriority: r.byPriority.reduce((a, x) => ({ ...a, [x._id]: x.count }), {}),
    };
}

async function aggAssets() {
    const agg = await Asset.aggregate([
        {
            $facet: {
                total: [{ $match: { isActive: true } }, { $count: 'c' }],
                available: [{ $match: { status: 'AVAILABLE', isActive: true } }, { $count: 'c' }],
                assigned: [{ $match: { status: 'ASSIGNED', isActive: true } }, { $count: 'c' }],
                repair: [{ $match: { status: 'REPAIR', isActive: true } }, { $count: 'c' }],
                byCategory: [
                    { $match: { isActive: true } },
                    { $group: { _id: '$category', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                ],
                byCondition: [
                    { $match: { isActive: true } },
                    { $group: { _id: '$condition', count: { $sum: 1 } } },
                ],
            },
        },
    ]);

    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;
    const total = pick('total');
    const assigned = pick('assigned');

    return {
        total,
        available: pick('available'),
        assigned,
        repair: pick('repair'),
        utilizationRate: pct(assigned, total),
        byCategory: r.byCategory.map((x) => ({ category: x._id, count: x.count })),
        byCondition: r.byCondition.reduce((a, x) => ({ ...a, [x._id]: x.count }), {}),
    };
}

async function aggLeaves(yearStart) {
    const agg = await Leave.aggregate([
        {
            $facet: {
                total: [{ $match: { appliedAt: { $gte: yearStart } } }, { $count: 'c' }],
                pending: [{ $match: { status: 'PENDING' } }, { $count: 'c' }],
                approved: [
                    { $match: { status: 'APPROVED', appliedAt: { $gte: yearStart } } },
                    { $count: 'c' },
                ],
                rejected: [
                    { $match: { status: 'REJECTED', appliedAt: { $gte: yearStart } } },
                    { $count: 'c' },
                ],
                cancelled: [
                    { $match: { status: 'CANCELLED', appliedAt: { $gte: yearStart } } },
                    { $count: 'c' },
                ],
                onLeaveToday: [
                    {
                        $match: {
                            status: 'APPROVED',
                            startDate: { $lte: new Date() },
                            endDate: { $gte: new Date() },
                        },
                    },
                    { $count: 'c' },
                ],
                byType: [
                    { $match: { appliedAt: { $gte: yearStart } } },
                    { $group: { _id: '$leaveType', count: { $sum: 1 } } },
                ],
                totalDaysApproved: [
                    { $match: { status: 'APPROVED', appliedAt: { $gte: yearStart } } },
                    { $group: { _id: null, days: { $sum: '$totalDays' } } },
                ],
                lopDaysYTD: [
                    { $match: { appliedAt: { $gte: yearStart }, status: 'APPROVED' } },
                    { $group: { _id: null, days: { $sum: { $ifNull: ['$lopDays', 0] } } } },
                ],
            },
        },
    ]);

    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;

    return {
        totalYTD: pick('total'),
        pending: pick('pending'),
        approvedYTD: pick('approved'),
        rejectedYTD: pick('rejected'),
        cancelledYTD: pick('cancelled'),
        onLeaveToday: pick('onLeaveToday'),
        totalDaysApprovedYTD: r.totalDaysApproved?.[0]?.days ?? 0,
        lopDaysYTD: r.lopDaysYTD?.[0]?.days ?? 0,
        approvalRate: pct(pick('approved'), pick('approved') + pick('rejected')),
        byType: r.byType.reduce((a, x) => ({ ...a, [x._id]: x.count }), {}),
    };
}

async function aggPermissions() {
    const agg = await Permission.aggregate([
        {
            $facet: {
                total: [{ $count: 'c' }],
                pending: [{ $match: { status: 'PENDING' } }, { $count: 'c' }],
                approved: [{ $match: { status: 'APPROVED' } }, { $count: 'c' }],
                rejected: [{ $match: { status: 'REJECTED' } }, { $count: 'c' }],
            },
        },
    ]);

    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;
    return {
        total: pick('total'),
        pending: pick('pending'),
        approved: pick('approved'),
        rejected: pick('rejected'),
    };
}

async function aggAttendanceToday(todayStr) {
    const [todayLogs, totalEmployees, onLeaveToday] = await Promise.all([
        Attendance.find({ date: todayStr }).select('clockIn clockOut breaks lateLogin').lean(),
        Employee.countDocuments({ isActive: true }),
        Leave.countDocuments({
            status: 'APPROVED',
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() },
        }),
    ]);

    const present = todayLogs.filter((l) => l.clockIn).length;
    const completed = todayLogs.filter((l) => l.clockIn && l.clockOut).length;
    const active = todayLogs.filter((l) => l.clockIn && !l.clockOut).length;
    const onBreak = todayLogs.filter((l) => l.breaks?.some((b) => b.start && !b.end)).length;
    const late = todayLogs.filter((l) => l.lateLogin === true).length;
    const absent = Math.max(totalEmployees - present - onLeaveToday, 0);

    return {
        date: todayStr,
        totalEmployees,
        present,
        completed,
        active,
        onBreak,
        late,
        onLeave: onLeaveToday,
        absent,
        attendanceRate: pct(present, totalEmployees),
    };
}

async function aggAnnouncements() {
    const now = new Date();
    const last7 = dayjs.utc().subtract(7, 'day').toDate();
    const agg = await Announcements.aggregate([
        {
            $facet: {
                total: [{ $count: 'c' }],
                active: [
                    {
                        $match: {
                            status: 'active',
                            $or: [
                                { expiryDate: { $exists: false } },
                                { expiryDate: null },
                                { expiryDate: { $gte: now } },
                            ],
                        },
                    },
                    { $count: 'c' },
                ],
                pinned: [{ $match: { isPinned: true } }, { $count: 'c' }],
                last7d: [{ $match: { createdAt: { $gte: last7 } } }, { $count: 'c' }],
                byAudience: [{ $group: { _id: '$audience', count: { $sum: 1 } } }],
            },
        },
    ]);
    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;
    return {
        total: pick('total'),
        active: pick('active'),
        pinned: pick('pinned'),
        last7d: pick('last7d'),
        byAudience: r.byAudience.reduce((a, x) => ({ ...a, [x._id]: x.count }), {}),
    };
}

async function aggPayroll() {
    const currentMonth = dayjs.utc().format('YYYY-MM');
    const release = await PayrollRelease.findOne({ month: currentMonth }).lean();

    let releasedCount = 0;
    let publishedCount = 0;
    if (release) {
        if (release.released) {
            const totalActive = await Employee.countDocuments({ isActive: true });
            releasedCount = totalActive;
        } else {
            releasedCount = (release.empState ?? []).filter((s) => s.released).length;
        }
        publishedCount = (release.empState ?? []).filter((s) => s.published).length;
    }

    return {
        currentMonth,
        released: !!release?.released,
        releasedAt: release?.releasedAt ?? null,
        releasedEmployees: releasedCount,
        publishedEmployees: publishedCount,
    };
}

async function aggProjects() {
    const agg = await Projects.aggregate([
        {
            $facet: {
                total: [{ $count: 'c' }],
                active: [{ $match: { status: 'active' } }, { $count: 'c' }],
                completed: [{ $match: { status: 'completed' } }, { $count: 'c' }],
                onHold: [{ $match: { status: 'on_hold' } }, { $count: 'c' }],
                cancelled: [{ $match: { status: 'cancelled' } }, { $count: 'c' }],
                planning: [{ $match: { status: 'planning' } }, { $count: 'c' }],
            },
        },
    ]);
    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;
    return {
        total: pick('total'),
        active: pick('active'),
        completed: pick('completed'),
        onHold: pick('onHold'),
        cancelled: pick('cancelled'),
        planning: pick('planning'),
    };
}

async function aggTeams() {
    const agg = await Team.aggregate([
        {
            $facet: {
                total: [{ $count: 'c' }],
                active: [{ $match: { isActive: true } }, { $count: 'c' }],
            },
        },
    ]);
    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;
    return { total: pick('total'), active: pick('active') };
}

async function aggTasks() {
    const agg = await Task.aggregate([
        {
            $facet: {
                total: [{ $count: 'c' }],
                pending: [{ $match: { status: 'pending' } }, { $count: 'c' }],
                inProgress: [{ $match: { status: 'in_progress' } }, { $count: 'c' }],
                awaitingReview: [{ $match: { status: 'completed_by_employee' } }, { $count: 'c' }],
                completed: [{ $match: { status: 'completed' } }, { $count: 'c' }],
                revoked: [{ $match: { status: 'revoked' } }, { $count: 'c' }],
                incomplete: [{ $match: { status: 'incomplete' } }, { $count: 'c' }],
                overtime: [{ $match: { isOvertime: true, status: { $in: ['pending', 'in_progress'] } } }, { $count: 'c' }],
                byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
            },
        },
    ]);
    const r = agg[0];
    const pick = (k) => r[k]?.[0]?.c ?? 0;
    const total = pick('total');
    const completed = pick('completed');
    return {
        total,
        pending: pick('pending'),
        inProgress: pick('inProgress'),
        awaitingReview: pick('awaitingReview'),
        completed,
        revoked: pick('revoked'),
        incomplete: pick('incomplete'),
        overtime: pick('overtime'),
        completionRate: pct(completed, total),
        byPriority: r.byPriority.reduce((a, x) => ({ ...a, [x._id]: x.count }), {}),
    };
}

async function aggPhaseSchedules() {
    const [phases, schedules] = await Promise.all([
        Phase.countDocuments({ isDeleted: false }),
        Schedule.countDocuments({ isDeleted: false }),
    ]);
    return { activePhases: phases, activeSchedules: schedules };
}

async function aggOnboardingFunnel() {
    const [step1, step2, step3, totalEmployees] = await Promise.all([
        Employee.countDocuments({ isUpdated: true }),
        Document.countDocuments({ overallStatus: { $in: ['pending', 'in_progress'] } }),
        Document.countDocuments({ overallStatus: 'completed' }),
        Employee.countDocuments({}),
    ]);

    return {
        step1: { name: 'Basic Info', description: 'Employees who updated their profile', count: step1 },
        step2: { name: 'Documents Pending', description: 'Employees with pending documents', count: step2 },
        step3: { name: 'Verification', description: 'Employees with verified documents', count: step3 },
        totalEmployees,
        completionRate: pct(step3, totalEmployees),
    };
}

async function aggDepartmentDistribution() {
    const rows = await Employee.aggregate([
        { $match: { isActive: true } },
        {
            $group: {
                _id: '$department',
                count: { $sum: 1 },
            },
        },
        { $sort: { count: -1 } },
    ]);
    const total = rows.reduce((s, r) => s + r.count, 0);
    return {
        total,
        distribution: rows.map((r) => ({
            department: r._id ?? 'Unassigned',
            count: r.count,
            percentage: pct(r.count, total),
        })),
    };
}

async function aggDesignationDistribution() {
    const rows = await Employee.aggregate([
        { $match: { isActive: true, designation: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$designation', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
    ]);
    return rows.map((r) => ({ designation: r._id, count: r.count }));
}

async function aggAttendanceTrend(days, todayStr) {
    // Build the date list (oldest → newest, IST)
    const dateList = [];
    for (let i = days - 1; i >= 0; i--) {
        dateList.push(dayjs.tz(todayStr, IST).subtract(i, 'day').format('YYYY-MM-DD'));
    }

    const [rows, totalActive] = await Promise.all([
        Attendance.aggregate([
            { $match: { date: { $in: dateList } } },
            {
                $group: {
                    _id: '$date',
                    present: { $sum: { $cond: [{ $ifNull: ['$clockIn', false] }, 1, 0] } },
                    late: { $sum: { $cond: [{ $eq: ['$lateLogin', true] }, 1, 0] } },
                },
            },
        ]),
        Employee.countDocuments({ isActive: true }),
    ]);

    const map = {};
    for (const r of rows) map[r._id] = r;

    return dateList.map((d) => ({
        date: d,
        label: dayjs.tz(d, IST).format('DD MMM'),
        present: map[d]?.present ?? 0,
        late: map[d]?.late ?? 0,
        absent: Math.max(totalActive - (map[d]?.present ?? 0), 0),
    }));
}

async function aggTicketTrend(days) {
    const start = dayjs.utc().subtract(days, 'day').startOf('day').toDate();

    const rows = await Ticket.aggregate([
        { $match: { createdAt: { $gte: start } } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                created: { $sum: 1 },
                resolved: { $sum: { $cond: [{ $eq: ['$status', 'RESOLVED'] }, 1, 0] } },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    return rows.map((r) => ({
        date: r._id,
        label: dayjs.utc(r._id).format('DD MMM'),
        created: r.created,
        resolved: r.resolved,
    }));
}

async function aggLeaveTrend(days) {
    const start = dayjs.utc().subtract(days, 'day').startOf('day').toDate();
    const rows = await Leave.aggregate([
        { $match: { appliedAt: { $gte: start } } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$appliedAt' } },
                applied: { $sum: 1 },
                approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
                rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    return rows.map((r) => ({
        date: r._id,
        label: dayjs.utc(r._id).format('DD MMM'),
        applied: r.applied,
        approved: r.approved,
        rejected: r.rejected,
    }));
}

async function aggTaskCompletionTrend(days) {
    const start = dayjs.utc().subtract(days, 'day').startOf('day').toDate();
    const rows = await Task.aggregate([
        { $match: { createdAt: { $gte: start } } },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                created: { $sum: 1 },
                completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    return rows.map((r) => ({
        date: r._id,
        label: dayjs.utc(r._id).format('DD MMM'),
        created: r.created,
        completed: r.completed,
    }));
}

async function aggRecentJoiners() {
    return Employee.find({})
        .select('employeeId firstName lastName department designation profileImage createdAt doj')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
}

async function aggUpcomingBirthdays() {
    // Pull all active employees with a DOB, compute next occurrence client-side.
    // (Mongo $month/$dayOfMonth on dates also works, but this is simpler and
    // the active employee set is bounded.)
    const employees = await Employee.find({
        isActive: true,
        dateOfBirth: { $exists: true, $ne: null },
    })
        .select('employeeId firstName lastName department designation profileImage dateOfBirth')
        .lean();

    const today = dayjs.tz(getNow().date, IST).startOf('day');
    const horizon = today.add(30, 'day');

    const upcoming = [];
    for (const e of employees) {
        const dob = dayjs.utc(e.dateOfBirth);
        if (!dob.isValid()) continue;

        let next = dob.year(today.year());
        if (next.isBefore(today)) next = next.add(1, 'year');

        if (next.isAfter(horizon)) continue;

        upcoming.push({
            employeeId: e.employeeId,
            name: `${e.firstName} ${e.lastName}`,
            department: e.department,
            designation: e.designation,
            profileImage: e.profileImage ?? null,
            birthday: next.format('YYYY-MM-DD'),
            daysAway: next.diff(today, 'day'),
        });
    }

    upcoming.sort((a, b) => a.daysAway - b.daysAway);
    return upcoming.slice(0, 5);
}

async function aggCriticalAlerts(todayStr) {
    const alerts = [];

    const [
        highPriorityTickets,
        pendingLeaves,
        pendingPermissions,
        updateRequests,
        overdueDocs,
        overdueTasks,
        unassignedAssets,
    ] = await Promise.all([
        Ticket.countDocuments({ priority: 'HIGH', status: { $ne: 'RESOLVED' } }),
        Leave.countDocuments({ status: 'PENDING' }),
        Permission.countDocuments({ status: 'PENDING' }),
        Employee.countDocuments({ updateRequested: true }),
        Document.countDocuments({
            overallStatus: { $in: ['pending', 'in_progress'] },
            updatedAt: { $lt: dayjs.utc().subtract(7, 'day').toDate() },
        }),
        Task.countDocuments({
            status: { $in: ['pending', 'in_progress'] },
            deadline: { $lt: new Date() },
        }),
        Asset.countDocuments({ status: 'REPAIR', isActive: true }),
    ]);

    if (highPriorityTickets > 0)
        alerts.push({ level: 'critical', module: 'Tickets', message: `${highPriorityTickets} high-priority ticket(s) open`, count: highPriorityTickets });
    if (pendingLeaves > 0)
        alerts.push({ level: 'warning', module: 'Leaves', message: `${pendingLeaves} leave request(s) awaiting approval`, count: pendingLeaves });
    if (pendingPermissions > 0)
        alerts.push({ level: 'warning', module: 'Permissions', message: `${pendingPermissions} permission(s) awaiting approval`, count: pendingPermissions });
    if (updateRequests > 0)
        alerts.push({ level: 'info', module: 'Profile', message: `${updateRequests} profile update request(s)`, count: updateRequests });
    if (overdueDocs > 0)
        alerts.push({ level: 'warning', module: 'Documents', message: `${overdueDocs} document set(s) idle for 7+ days`, count: overdueDocs });
    if (overdueTasks > 0)
        alerts.push({ level: 'critical', module: 'Tasks', message: `${overdueTasks} overdue task(s) past deadline`, count: overdueTasks });
    if (unassignedAssets > 0)
        alerts.push({ level: 'info', module: 'Assets', message: `${unassignedAssets} asset(s) in repair`, count: unassignedAssets });

    return alerts;
}