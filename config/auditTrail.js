import { auditStorage } from './auditContext.js';

/**
 * AUDIT TRAIL — shared helpers
 * ----------------------------
 * Powers the Admin "Audit Logs" feature. One AuditLog row is written per
 * user action (HTTP request). While that request runs, the mongoose plugin
 * (auditTrailPlugin.js) pushes every record that was created / changed /
 * deleted into `req.auditTrail.entities`, and the express middleware
 * (middleware/auditLogMiddleware.js) turns it all into a single readable log.
 *
 * IMPORTANT: this file must NOT import any mongoose model — it is loaded
 * before models are compiled (the plugin has to be registered first).
 */

// ── Which roles are audited ────────────────────────────────────────────────
// Read lazily: dotenv.config() runs AFTER imports in index.js.
export const getAuditedRoles = () => {
    const roles = new Set(['EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER']);
    if (process.env.AUDIT_INCLUDE_ADMIN === 'true') roles.add('EMPLOYER_ADMIN');
    return roles;
};

export const MAX_ENTITIES_PER_ACTION = 60;   // records kept per action
export const MAX_BULK_LOOKUP = 20;           // docs inspected for updateMany / deleteMany
export const MAX_CHANGES_PER_ENTITY = 40;

// Models whose writes are never part of an audit entry (noise / the log itself)
export const SKIP_MODELS = new Set([
    'AuditLog',
    'Notification',
    'BlacklistedToken',
    'Counter',
    'ActivityLog',
    'LoginHistory',
]);

// ── Per-request trail ──────────────────────────────────────────────────────
export const startTrail = (req) => {
    req.auditTrail = {
        enabled: false,
        entities: [],
        dropped: 0,
        startedAt: Date.now(),
    };
    return req.auditTrail;
};

/** Returns the active trail for the current request, or null when auditing is off. */
export const getTrail = () => {
    try {
        const trail = auditStorage.getStore()?.req?.auditTrail;
        return trail && trail.enabled ? trail : null;
    } catch {
        return null;
    }
};

export const recordEntity = (entity) => {
    const trail = getTrail();
    if (!trail || !entity) return;

    // Merge repeated writes to the same record inside one action
    const existing = trail.entities.find(
        (e) => e.model === entity.model && e.id && e.id === entity.id && e.op === entity.op
    );
    if (existing) {
        const byField = new Map(existing.changes.map((c) => [c.field, c]));
        for (const c of entity.changes || []) {
            const prev = byField.get(c.field);
            if (prev) prev.to = c.to;
            else existing.changes.push(c);
        }
        return;
    }

    if (trail.entities.length >= MAX_ENTITIES_PER_ACTION) {
        trail.dropped += 1;
        return;
    }
    trail.entities.push(entity);
};

// ── Value helpers ──────────────────────────────────────────────────────────
const SENSITIVE_KEY =
    /(pass(word|code)?$|^otp|secret|token|descriptor|aadhaar|aadhar|pannumber|passportnumber|accountnumber|ifsc|drivinglicensenumber|faceimage|cvv)/i;

export const isSensitiveKey = (key = '') => SENSITIVE_KEY.test(String(key).split('.').pop());

const IGNORED_FIELDS = new Set([
    '_id', '__v', 'createdAt', 'updatedAt',
    'createdBy', 'updatedBy', 'createdByDetails', 'updatedByDetails',
]);
export const isIgnoredField = (field) => IGNORED_FIELDS.has(String(field).split('.')[0]);

/** Convert mongoose docs / ObjectIds / Dates / Maps into plain JSON-safe values. */
export const plain = (v, depth = 0) => {
    if (v === null || v === undefined) return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'bigint') return String(v);
    if (Buffer.isBuffer(v)) return '[binary]';
    if (typeof v !== 'object') return v;
    if (v._bsontype) return String(v);                       // ObjectId, Decimal128, ...
    if (typeof v.toObject === 'function') {
        try { v = v.toObject({ depopulate: true, virtuals: false, getters: false }); } catch { /* keep */ }
    }
    if (v instanceof Map) v = Object.fromEntries(v);
    if (depth > 4) return '[…]';
    if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
    const out = {};
    for (const k of Object.keys(v)) out[k] = plain(v[k], depth + 1);
    return out;
};

/** Short, display-friendly value for the "from → to" columns. */
export const brief = (value, max = 160) => {
    const v = plain(value);
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…` : v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) {
        if (!v.length) return '(empty)';
        if (v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) {
            const s = v.join(', ');
            return s.length > max ? `${v.length} items` : s;
        }
        return `${v.length} item${v.length > 1 ? 's' : ''}`;
    }
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max)}…` : s;
};

export const getPath = (obj, path) => {
    if (obj == null) return undefined;
    let cur = obj;
    for (const part of String(path).split('.')) {
        if (cur == null) return undefined;
        cur = cur[part];
    }
    return cur;
};

const sameValue = (a, b) => {
    try { return JSON.stringify(plain(a)) === JSON.stringify(plain(b)); } catch { return false; }
};

export const makeChange = (field, from, to) => {
    if (isSensitiveKey(field)) {
        return { field, from: from == null ? null : '••••••', to: to == null ? null : '••••••', sensitive: true };
    }
    return { field, from: brief(from), to: brief(to) };
};

/** Field-level diff between two plain objects for the given (modified) paths. */
export const diffPaths = (before, after, paths) => {
    const changes = [];
    // keep only the deepest modified paths (drop parents of other modified paths)
    const deepest = paths.filter((p) => !paths.some((q) => q !== p && q.startsWith(`${p}.`)));
    for (const p of deepest) {
        if (isIgnoredField(p)) continue;
        const from = getPath(before, p);
        const to = getPath(after, p);
        if (sameValue(from, to)) continue;
        changes.push(makeChange(p, from, to));
        if (changes.length >= MAX_CHANGES_PER_ENTITY) break;
    }
    return changes;
};

/** Initial values of a newly created record (what was entered). */
export const snapshotChanges = (obj, limit = 20) => {
    const out = [];
    const src = plain(obj) || {};
    for (const key of Object.keys(src)) {
        if (isIgnoredField(key)) continue;
        const v = src[key];
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
        out.push(makeChange(key, null, v));
        if (out.length >= limit) break;
    }
    return out;
};

/** Translate a mongoose update document ($set / $inc / ...) into field changes. */
export const diffUpdate = (before, update) => {
    const changes = [];
    if (!update || typeof update !== 'object') return changes;

    const push = (field, from, to) => {
        if (isIgnoredField(field)) return;
        if (sameValue(from, to)) return;
        changes.push(makeChange(field, from, to));
    };

    const direct = {};
    for (const [k, v] of Object.entries(update)) {
        if (!k.startsWith('$')) direct[k] = v;
    }
    for (const [k, v] of Object.entries({ ...direct, ...(update.$set || {}) })) {
        push(k, getPath(before, k), v);
    }
    for (const [k, v] of Object.entries(update.$inc || {})) {
        const prev = Number(getPath(before, k)) || 0;
        push(k, prev, prev + Number(v));
    }
    for (const k of Object.keys(update.$unset || {})) push(k, getPath(before, k), null);
    for (const [k, v] of Object.entries(update.$push || {})) {
        const item = v && typeof v === 'object' && '$each' in v ? v.$each : v;
        push(k, getPath(before, k), `${brief(item)} (added)`);
    }
    for (const [k, v] of Object.entries(update.$addToSet || {})) {
        const item = v && typeof v === 'object' && '$each' in v ? v.$each : v;
        push(k, getPath(before, k), `${brief(item)} (added)`);
    }
    for (const [k, v] of Object.entries(update.$pull || {})) {
        push(k, getPath(before, k), `${brief(v)} (removed)`);
    }
    return changes.slice(0, MAX_CHANGES_PER_ENTITY);
};

// ── Request body sanitising ────────────────────────────────────────────────
export const sanitizePayload = (value, depth = 0) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
    if (typeof value !== 'object') return value;
    if (depth > 3) return '[…]';
    if (Array.isArray(value)) {
        const items = value.slice(0, 20).map((x) => sanitizePayload(x, depth + 1));
        if (value.length > 20) items.push(`… +${value.length - 20} more`);
        return items;
    }
    const out = {};
    for (const key of Object.keys(value).slice(0, 60)) {
        out[key] = isSensitiveKey(key) ? '••••••' : sanitizePayload(value[key], depth + 1);
    }
    return out;
};

// ── Human labels for records ───────────────────────────────────────────────
const MODEL_LABELS = {
    Employee: 'Employee',
    EmployerUser: 'Staff user',
    PreJoining: 'Pre-joining candidate',
    Document: 'Employee documents',
    Leave: 'Leave request',
    LeavePolicy: 'Leave policy',
    Permission: 'Permission request',
    Holiday: 'Holiday',
    OfficeTiming: 'Office timing',
    BreakPolicy: 'Break policy',
    ViolationGracePolicy: 'Salary / violation policy',
    PayrollRelease: 'Payroll month',
    PayslipHistory: 'Payslip',
    PerformanceAssessment: 'Trainee assessment',
    WarningMail: 'Warning mail',
    WarningMailTemplate: 'Warning mail template',
    Announcement: 'Announcement',
    Ticket: 'Ticket',
    Asset: 'Asset',
    Phase: 'Phase',
    Schedule: 'Schedule',
    Project: 'Project',
    Team: 'Team',
    Task: 'Task',
    Attendance: 'Attendance record',
};
export const friendlyModel = (name) => MODEL_LABELS[name] || name;

const fullName = (o) => [o?.firstName, o?.lastName].filter(Boolean).join(' ').trim();
const withCode = (name, code) => (name && code ? `${name} (${code})` : name || code || '');

const LABEL_FNS = {
    Employee: (o) => withCode(fullName(o), o.employeeId),
    EmployerUser: (o) => withCode(fullName(o), o.email),
    PreJoining: (o) => withCode(fullName(o), o.personalEmail),
    Document: (o) => (o.employeeId ? `Documents of ${o.employeeId}` : ''),
    Leave: (o) => {
        const d = (v) => (v ? String(v).slice(0, 10) : '');
        const type = o.leaveType ? `${String(o.leaveType).charAt(0)}${String(o.leaveType).slice(1).toLowerCase()} leave` : 'Leave';
        const range = o.startDate ? `, ${d(o.startDate)}${o.endDate && d(o.endDate) !== d(o.startDate) ? ` → ${d(o.endDate)}` : ''}` : '';
        return withCode(`${type}${range}`, o.requestId);
    },
    Permission: (o) => withCode(`Permission${o.date ? `, ${String(o.date).slice(0, 10)}` : ''}`, o.requestId),
    LeavePolicy: (o) => o.policyName,
    Holiday: (o) => o.name,
    Asset: (o) => withCode(o.assetName, o.assetId),
    Ticket: (o) => withCode(o.subject, o.ticketId),
    Announcement: (o) => o.title,
    Project: (o) => withCode(o.projectName, o.projectId),
    Team: (o) => withCode(o.teamName, o.teamId),
    Task: (o) => withCode(o.title, o.taskId),
    Phase: (o) => o.phaseName,
    Schedule: (o) => o.scheduleName,
    WarningMail: (o) => withCode(o.templateName, o.employeeSnapshot?.name),
    WarningMailTemplate: (o) => o.name,
    PerformanceAssessment: (o) => o.assessmentTitle,
    PayrollRelease: () => '',
    PayslipHistory: (o) => (o.month ? `Payslip ${o.month}${o.employeeId ? ` – ${o.employeeId}` : ''}` : ''),
    // single-record settings: the module + changed fields already say it all
    OfficeTiming: () => '',
    BreakPolicy: () => '',
    ViolationGracePolicy: () => '',
};

export const labelFor = (modelName, obj) => {
    try {
        const o = plain(obj) || {};
        const fn = LABEL_FNS[modelName];
        const label = fn ? fn(o) : '';
        if (label) return String(label).trim();
        const generic =
            o.name || o.title || o.subject || fullName(o) || o.requestId || o.employeeId;
        return generic ? String(generic) : '';
    } catch {
        return '';
    }
};

/** Which field of a record points at the employee it concerns. */
const EMPLOYEE_REF_FIELD = {
    Leave: 'employee',
    Permission: 'employee',
    Document: 'employee',
    PerformanceAssessment: 'employee',
    WarningMail: 'employee',
    Task: 'assignedTo',
    Ticket: 'raisedBy',
    Asset: 'assignedTo',
    PreJoining: 'employeeId',
    Attendance: 'employeeId',
    PayslipHistory: 'employeeId',
};

export const employeeRefFor = (modelName, obj) => {
    try {
        if (modelName === 'Employee') return String(obj?._id ?? '') || null;
        const field = EMPLOYEE_REF_FIELD[modelName];
        if (!field) return null;
        const v = plain(obj)?.[field];
        return v ? String(v) : null;
    } catch {
        return null;
    }
};
