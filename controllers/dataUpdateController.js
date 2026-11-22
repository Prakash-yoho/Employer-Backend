import crypto from 'crypto';
import DataUpdateAccess from '../model/DataUpdateAccess.js';
import Employee from '../model/Employee.js';
import Notification from '../model/Notification.js';
import {
    FIELD_MAP, publicCatalog, publicField, currentValueFor, displayValue, validateGrantValues,
} from '../utils/editableFields.js';

const fullName = (e) => `${e.firstName || ''} ${e.lastName || ''}`.trim();
const hrName = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
const newBatchId = () => `DUA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

/* ═══════════════════════ HR / ADMIN ═══════════════════════ */

// GET /api/data-updates/fields
export const getEditableFields = (_req, res) =>
    res.json({ success: true, data: publicCatalog() });

// GET /api/data-updates/employees  – compact list for the picker
export const getEmployeeOptions = async (_req, res) => {
    try {
        const list = await Employee.find({ isActive: true })
            .select('employeeId firstName lastName department designation')
            .sort({ firstName: 1 }).lean();
        return res.json({
            success: true,
            data: list.map((e) => ({
                _id: e._id, employeeId: e.employeeId, name: fullName(e),
                department: e.department, designation: e.designation,
            })),
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// POST /api/data-updates   { fields:[], scope:'ALL'|'SELECTED', employeeIds:[], note? }
export const createDataUpdateAccess = async (req, res) => {
    try {
        const { scope, note } = req.body || {};
        const fields = [...new Set(Array.isArray(req.body?.fields) ? req.body.fields : [])];
        const employeeIds = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : [];

        if (!fields.length) return res.status(400).json({ success: false, message: 'Select at least one field' });
        const bad = fields.filter((k) => !FIELD_MAP.has(k));
        if (bad.length) return res.status(400).json({ success: false, message: `Unknown field(s): ${bad.join(', ')}` });
        if (!['ALL', 'SELECTED'].includes(scope)) return res.status(400).json({ success: false, message: 'scope must be ALL or SELECTED' });
        if (scope === 'SELECTED' && !employeeIds.length) return res.status(400).json({ success: false, message: 'Select at least one employee' });

        const filter = scope === 'ALL' ? { isActive: true } : { _id: { $in: employeeIds }, isActive: true };
        const employees = await Employee.find(filter).select('employeeId firstName lastName').lean();
        if (!employees.length) return res.status(404).json({ success: false, message: 'No matching active employees' });

        // fields already open for an employee are not granted twice
        const open = await DataUpdateAccess.find({ employee: { $in: employees.map((e) => e._id) }, status: 'PENDING' })
            .select('employee fields').lean();
        const openMap = new Map();
        open.forEach((g) => {
            const s = openMap.get(String(g.employee)) || new Set();
            g.fields.forEach((k) => s.add(k));
            openMap.set(String(g.employee), s);
        });

        const batchId = newBatchId();
        const grantedBy = { userId: req.user._id, email: req.user.email, name: hrName(req.user) };
        const docs = [];
        const skipped = [];
        for (const e of employees) {
            const already = openMap.get(String(e._id)) || new Set();
            const give = fields.filter((k) => !already.has(k));
            if (!give.length) {
                skipped.push({ employeeId: e.employeeId, name: fullName(e), reason: 'All selected fields are already open for this employee' });
                continue;
            }
            docs.push({
                batchId, scope, note: note || '', employee: e._id, employeeId: e.employeeId,
                employeeName: fullName(e), fields: give, grantedBy,
            });
        }
        if (!docs.length) {
            return res.status(409).json({ success: false, message: 'Nothing to grant – the selected fields are already open for every selected employee', data: { skipped } });
        }
        const created = await DataUpdateAccess.insertMany(docs);

        // In-app notification (best-effort)
        try {
            await Notification.insertMany(created.map((g) => ({
                title: 'Please update your details',
                description: `HR has asked you to update ${g.fields.length} field${g.fields.length > 1 ? 's' : ''}. Open "Data Updates" to complete it.`,
                type: 'DATA_UPDATE_REQUEST',
                recipientType: 'EMPLOYEE',
                recipientId: g.employee,
                recipientModel: 'Employee',
                senderId: req.user._id,
                senderModel: 'EmployerUser',
                relatedEntityType: 'Employee',
                relatedEntityId: g.employee,
                priority: 'high',
                metadata: { batchId, fields: g.fields },
            })));
        } catch (nErr) {
            console.error('[data-updates] notification failed:', nErr.message);
        }

        return res.status(201).json({
            success: true,
            message: `Edit access given to ${created.length} employee${created.length > 1 ? 's' : ''}`,
            data: { batchId, granted: created.length, skipped },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// GET /api/data-updates/batches?page&limit&status
export const getBatches = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

        const [stage, totals] = await Promise.all([
            DataUpdateAccess.aggregate([
                { $sort: { createdAt: 1 } },
                {
                    $group: {
                        _id: '$batchId',
                        scope: { $first: '$scope' },
                        note: { $first: '$note' },
                        grantedBy: { $first: '$grantedBy' },
                        createdAt: { $first: '$createdAt' },
                        fields: { $first: '$fields' },
                        total: { $sum: 1 },
                        completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
                        pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
                        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
                    },
                },
                { $sort: { createdAt: -1 } },
                {
                    $facet: {
                        rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
                        count: [{ $count: 'n' }],
                    },
                },
            ]),
            DataUpdateAccess.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        ]);

        const rows = (stage[0]?.rows || []).map((b) => ({
            batchId: b._id, scope: b.scope, note: b.note, grantedBy: b.grantedBy, createdAt: b.createdAt,
            fields: b.fields, fieldLabels: b.fields.map((k) => FIELD_MAP.get(k)?.label || k),
            total: b.total, completed: b.completed, pending: b.pending, cancelled: b.cancelled,
        }));
        const totalCount = stage[0]?.count?.[0]?.n || 0;
        const sum = Object.fromEntries(totals.map((t) => [t._id, t.n]));

        return res.json({
            success: true,
            data: {
                batches: rows,
                summary: {
                    given: (sum.PENDING || 0) + (sum.COMPLETED || 0) + (sum.CANCELLED || 0),
                    completed: sum.COMPLETED || 0,
                    pending: sum.PENDING || 0,
                    cancelled: sum.CANCELLED || 0,
                },
                pagination: { page, limit, total: totalCount, totalPages: Math.max(1, Math.ceil(totalCount / limit)) },
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// GET /api/data-updates/batches/:batchId  – per-employee status
export const getBatchDetail = async (req, res) => {
    try {
        const grants = await DataUpdateAccess.find({ batchId: req.params.batchId }).sort({ employeeName: 1 }).lean();
        if (!grants.length) return res.status(404).json({ success: false, message: 'Batch not found' });
        return res.json({
            success: true,
            data: {
                batchId: req.params.batchId, scope: grants[0].scope, note: grants[0].note,
                grantedBy: grants[0].grantedBy, createdAt: grants[0].createdAt,
                grants: grants.map((g) => ({
                    grantId: g._id, employeeId: g.employeeId, employeeName: g.employeeName, status: g.status,
                    fields: g.fields, fieldLabels: g.fields.map((k) => FIELD_MAP.get(k)?.label || k),
                    completedAt: g.completedAt, cancelledAt: g.cancelledAt,
                })),
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// PATCH /api/data-updates/batches/:batchId/cancel   (optional body.grantId → cancel one employee)
export const cancelDataUpdateAccess = async (req, res) => {
    try {
        const filter = { batchId: req.params.batchId, status: 'PENDING' };
        if (req.body?.grantId) filter._id = req.body.grantId;
        const r = await DataUpdateAccess.updateMany(filter, {
            $set: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: { userId: req.user._id, email: req.user.email } },
        });
        if (!r.modifiedCount) return res.status(404).json({ success: false, message: 'No pending access to cancel' });
        return res.json({ success: true, message: `Cancelled ${r.modifiedCount} pending request${r.modifiedCount > 1 ? 's' : ''}` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

/* ═══════════════════════ EMPLOYEE ═══════════════════════ */

const grantView = (g, employeeObj) => ({
    grantId: g._id, batchId: g.batchId, note: g.note, createdAt: g.createdAt,
    grantedBy: g.grantedBy?.name || g.grantedBy?.email || 'HR',
    fields: g.fields.map((k) => {
        const spec = publicField(k);
        return spec ? { ...spec, value: currentValueFor(FIELD_MAP.get(k), employeeObj) } : null;
    }).filter(Boolean),
});

// GET /api/data-updates/me
export const getMyDataUpdates = async (req, res) => {
    try {
        const [emp, pending, done] = await Promise.all([
            Employee.findById(req.user._id).lean(),
            DataUpdateAccess.find({ employee: req.user._id, status: 'PENDING' }).sort({ createdAt: -1 }).lean(),
            DataUpdateAccess.find({ employee: req.user._id, status: 'COMPLETED' }).sort({ completedAt: -1 }).limit(20).lean(),
        ]);
        return res.json({
            success: true,
            data: {
                pending: pending.map((g) => grantView(g, emp)),
                history: done.map((g) => ({
                    grantId: g._id, completedAt: g.completedAt, grantedBy: g.grantedBy?.name || g.grantedBy?.email || 'HR',
                    fieldLabels: g.fields.map((k) => FIELD_MAP.get(k)?.label || k),
                })),
            },
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// POST /api/data-updates/me/:grantId/submit   { values: { "<field key>": value } }
export const submitMyDataUpdate = async (req, res) => {
    try {
        const grant = await DataUpdateAccess.findOne({ _id: req.params.grantId, employee: req.user._id });
        if (!grant) return res.status(404).json({ success: false, message: 'Request not found' });
        if (grant.status !== 'PENDING') {
            return res.status(409).json({ success: false, message: grant.status === 'CANCELLED' ? 'HR has cancelled this request' : 'Already completed' });
        }

        const v = validateGrantValues(grant.fields, req.body?.values || {});
        if (!v.ok) {
            return res.status(400).json({ success: false, message: 'Please correct the highlighted fields', errors: v.errors });
        }

        const emp = await Employee.findById(req.user._id);
        if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

        if (v.values.personalEmail && v.values.personalEmail !== emp.personalEmail) {
            const dup = await Employee.exists({ personalEmail: v.values.personalEmail, _id: { $ne: emp._id } });
            if (dup) return res.status(400).json({ success: false, message: 'Please correct the highlighted fields', errors: { personalEmail: 'This e-mail is already used by another employee' } });
        }

        const before = emp.toObject();
        const changes = [];
        for (const key of grant.fields) {
            const spec = FIELD_MAP.get(key);
            emp.set(key, v.values[key]);
            changes.push({
                key, label: spec.label,
                from: currentValueFor(spec, before), to: displayValue(spec, v.values[key]),
            });
        }
        emp.lastUpdatedAt = new Date();
        await emp.save({ validateModifiedOnly: true });

        grant.status = 'COMPLETED';
        grant.completedAt = new Date();
        grant.changes = changes;
        await grant.save();

        return res.json({ success: true, message: 'Details updated successfully', data: { grantId: grant._id } });
    } catch (err) {
        if (err.name === 'ValidationError') {
            const errors = {};
            Object.values(err.errors || {}).forEach((e) => { errors[e.path] = e.message; });
            return res.status(400).json({ success: false, message: 'Please correct the highlighted fields', errors });
        }
        return res.status(500).json({ success: false, message: err.message });
    }
};
