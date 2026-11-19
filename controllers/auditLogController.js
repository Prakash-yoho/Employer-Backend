import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import AuditLog from '../model/AuditLog.js';
import EmployerUser from '../model/EmployerUser.js';
import { getAuditedRoles } from '../config/auditTrail.js';
import { ACTION_LABELS, MODULES } from '../utils/auditCatalog.js';

const ROLE_LABELS = {
    EMPLOYER_HR: 'HR',
    EMPLOYER_IT: 'IT Support',
    PROJECT_MANAGER: 'Project Manager',
    EMPLOYER_ADMIN: 'Admin',
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const csv = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const validDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Builds the Mongo filter from the query string.
 *
 *   search      free text (action sentence, person, employee, record, ...)
 *   role        EMPLOYER_HR,EMPLOYER_IT,PROJECT_MANAGER   (comma separated)
 *   userId      one or more staff user ids                 (comma separated)
 *   module      module names                               (comma separated)
 *   action      action types, e.g. APPROVE,DELETE          (comma separated)
 *   outcome     SUCCESS,FAILED,DENIED                      (comma separated)
 *   employee    employee code or name the action was FOR
 *   targetType  record type, e.g. "Leave request"
 *   from / to   ISO date-times (inclusive)
 */
const buildFilter = (q) => {
    const filter = {};
    const and = [];

    const roles = csv(q.role).filter((r) => getAuditedRoles().has(r));
    if (roles.length) filter['actor.role'] = { $in: roles };

    const userIds = csv(q.userId).filter((id) => mongoose.isValidObjectId(id));
    if (userIds.length) filter['actor.userId'] = { $in: userIds };

    const modules = csv(q.module);
    if (modules.length) filter.module = { $in: modules };

    const actions = csv(q.action).map((a) => a.toUpperCase());
    if (actions.length) filter.action = { $in: actions };

    const outcomes = csv(q.outcome).map((o) => o.toUpperCase());
    if (outcomes.length) filter.outcome = { $in: outcomes };

    if (q.targetType) filter['target.type'] = String(q.targetType);

    if (q.employee) {
        const re = new RegExp(escapeRegex(String(q.employee).trim()), 'i');
        and.push({ $or: [{ 'affectedEmployees.employeeId': re }, { 'affectedEmployees.name': re }] });
    }

    const from = validDate(q.from);
    const to = validDate(q.to);
    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = from;
        if (to) filter.createdAt.$lte = to;
    }

    if (q.search && String(q.search).trim()) {
        const re = new RegExp(escapeRegex(String(q.search).trim()), 'i');
        and.push({
            $or: [
                { description: re },
                { title: re },
                { module: re },
                { 'actor.name': re },
                { 'actor.email': re },
                { 'target.name': re },
                { 'affectedEmployees.name': re },
                { 'affectedEmployees.employeeId': re },
                { 'entities.label': re },
                { changedFields: re },
            ],
        });
    }

    if (and.length) filter.$and = and;
    return filter;
};

// ── GET /api/audit-logs ────────────────────────────────────────────────────
export const getAuditLogs = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
        const sortDir = req.query.sort === 'asc' ? 1 : -1;
        const filter = buildFilter(req.query);

        const [rows, total] = await Promise.all([
            AuditLog.find(filter)
                // list view stays light — full payload / field changes load on demand
                .select('-request -entities.changes -userAgent')
                .sort({ createdAt: sortDir, _id: sortDir })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            AuditLog.countDocuments(filter),
        ]);

        return res.status(200).json({
            success: true,
            data: rows,
            pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
        });
    } catch (error) {
        console.error('getAuditLogs error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
    }
};

// ── GET /api/audit-logs/:id ────────────────────────────────────────────────
export const getAuditLogById = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid audit log id' });
        }
        const log = await AuditLog.findById(req.params.id).lean();
        if (!log) return res.status(404).json({ success: false, message: 'Audit log not found' });
        return res.status(200).json({ success: true, data: log });
    } catch (error) {
        console.error('getAuditLogById error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch audit log' });
    }
};

// ── GET /api/audit-logs/stats ──────────────────────────────────────────────
export const getAuditLogStats = async (req, res) => {
    try {
        const filter = buildFilter(req.query);
        const group = (by, extra = {}) => AuditLog.aggregate([
            { $match: filter },
            { $group: { _id: by, count: { $sum: 1 }, ...extra } },
            { $sort: { count: -1 } },
            { $limit: 50 },
        ]);

        const [byOutcome, byRole, byModule, byUser] = await Promise.all([
            group('$outcome'),
            group('$actor.role'),
            group('$module'),
            group('$actor.userId'),
        ]);

        const people = await EmployerUser.find({ _id: { $in: byUser.map((u) => u._id).filter(Boolean) } })
            .select('firstName lastName role').lean();
        const nameOf = new Map(people.map((p) => [String(p._id), { name: `${p.firstName} ${p.lastName}`.trim(), role: p.role }]));

        const outcome = Object.fromEntries(byOutcome.map((o) => [o._id, o.count]));
        return res.status(200).json({
            success: true,
            data: {
                total: byOutcome.reduce((n, o) => n + o.count, 0),
                success: outcome.SUCCESS || 0,
                failed: outcome.FAILED || 0,
                denied: outcome.DENIED || 0,
                activeUsers: byUser.length,
                byRole: Object.fromEntries(byRole.map((r) => [r._id, r.count])),
                topModules: byModule.slice(0, 6).map((m) => ({ module: m._id, count: m.count })),
                topUsers: byUser.slice(0, 5).map((u) => ({ userId: u._id, ...(nameOf.get(String(u._id)) || {}), count: u.count })),
            },
        });
    } catch (error) {
        console.error('getAuditLogStats error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch audit stats' });
    }
};

// ── GET /api/audit-logs/filters ────────────────────────────────────────────
export const getAuditLogFilters = async (_req, res) => {
    try {
        const audited = [...getAuditedRoles()];
        const [users, targetTypes] = await Promise.all([
            EmployerUser.find({ role: { $in: audited } })
                .select('firstName lastName email role isActive')
                .sort({ firstName: 1 })
                .lean(),
            AuditLog.distinct('target.type'),
        ]);

        return res.status(200).json({
            success: true,
            data: {
                roles: audited.map((r) => ({ value: r, label: ROLE_LABELS[r] || r })),
                users: users.map((u) => ({
                    value: String(u._id),
                    label: `${u.firstName} ${u.lastName}`.trim(),
                    role: u.role,
                    email: u.email,
                    isActive: u.isActive,
                })),
                modules: MODULES,
                actions: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
                outcomes: [
                    { value: 'SUCCESS', label: 'Successful' },
                    { value: 'FAILED', label: 'Failed' },
                    { value: 'DENIED', label: 'Blocked (no permission)' },
                ],
                targetTypes: targetTypes.filter(Boolean).sort(),
            },
        });
    } catch (error) {
        console.error('getAuditLogFilters error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch filter options' });
    }
};

// ── GET /api/audit-logs/export ─────────────────────────────────────────────
const EXPORT_LIMIT = 10000;
const ist = (d) =>
    new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });

export const exportAuditLogs = async (req, res) => {
    try {
        const filter = buildFilter(req.query);
        const rows = await AuditLog.find(filter)
            .select('-userAgent')
            .sort({ createdAt: -1 })
            .limit(EXPORT_LIMIT)
            .lean();

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Audit Logs');
        ws.columns = [
            { header: 'Date & Time (IST)', key: 'when', width: 24 },
            { header: 'Done By', key: 'who', width: 24 },
            { header: 'Role', key: 'role', width: 16 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Module', key: 'module', width: 22 },
            { header: 'Action', key: 'action', width: 14 },
            { header: 'What They Did', key: 'what', width: 70 },
            { header: 'Done For (Employees)', key: 'forWhom', width: 34 },
            { header: 'Record', key: 'record', width: 34 },
            { header: 'Changes (Old → New)', key: 'changes', width: 70 },
            { header: 'Result', key: 'outcome', width: 12 },
            { header: 'Message', key: 'message', width: 36 },
            { header: 'IP Address', key: 'ip', width: 16 },
            { header: 'Device', key: 'device', width: 22 },
        ];
        ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0F14' } };
        ws.views = [{ state: 'frozen', ySplit: 1 }];

        for (const r of rows) {
            const changes = (r.entities || [])
                .flatMap((e) => (e.changes || []).map((c) =>
                    `${e.type || e.model} · ${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`))
                .join('\n');
            ws.addRow({
                when: ist(r.createdAt),
                who: r.actor?.name,
                role: ROLE_LABELS[r.actor?.role] || r.actor?.role,
                email: r.actor?.email,
                module: r.module,
                action: ACTION_LABELS[r.action] || r.action,
                what: r.description,
                forWhom: (r.affectedEmployees || []).map((e) => `${e.name}${e.employeeId ? ` (${e.employeeId})` : ''}`).join(', '),
                record: r.target?.name ? `${r.target.type}: ${r.target.name}` : '',
                changes,
                outcome: r.outcome,
                message: r.message,
                ip: r.ip,
                device: r.device,
            });
        }
        ws.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('exportAuditLogs error:', error);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: 'Failed to export audit logs' });
        }
    }
};
