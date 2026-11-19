import jwt from 'jsonwebtoken';
import AuditLog from '../model/AuditLog.js';
import Employee from '../model/Employee.js';
import EmployerUser from '../model/EmployerUser.js';
import { auditStorage } from '../config/auditContext.js';
import { getAuditedRoles, getPath, sanitizePayload, friendlyModel } from '../config/auditTrail.js';
import { matchRule, fallbackRule, resolve } from '../utils/auditCatalog.js';
import { getDisplayName } from '../utils/displayName.js';

const OID = /^[0-9a-fA-F]{24}$/;

// ── Actor ──────────────────────────────────────────────────────────────────
const actorCache = new Map(); // userId -> { at, actor }
const ACTOR_TTL_MS = 5 * 60 * 1000;

const toActor = (u) => ({
    userId: u._id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
    email: u.email,
    role: u.role,
    phoneNumber: u.phoneNumber,
});

/**
 * Who performed this request?
 *  1. `req.user` set by `authenticate` (normal case)
 *  2. the user returned by a successful login response
 *  3. a verified JWT — for routes that forgot to call `authenticate`
 *     (e.g. announcements), so those actions are still attributed.
 */
export const resolveActor = async (req, loginUser) => {
    const roles = getAuditedRoles();

    const u = req.user;
    if (u && u.role) return roles.has(u.role) ? toActor(u) : null;

    if (loginUser?._id && roles.has(loginUser.role)) return toActor(loginUser);

    try {
        const token = req.header('Authorization')?.replace(/^Bearer\s+/i, '');
        if (!token) return null;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded?._id || !roles.has(decoded.role)) return null;

        const hit = actorCache.get(String(decoded._id));
        if (hit && Date.now() - hit.at < ACTOR_TTL_MS) return hit.actor;

        const user = await EmployerUser.findById(decoded._id).select('-password').lean();
        if (!user || !roles.has(user.role)) return null;
        const actor = toActor(user);
        actorCache.set(String(decoded._id), { at: Date.now(), actor });
        return actor;
    } catch {
        return null;
    }
};

// ── Employees the action was done for ──────────────────────────────────────
const collectRefs = (value, out) => {
    if (value == null) return;
    if (Array.isArray(value)) return value.forEach((v) => collectRefs(v, out));
    if (typeof value === 'object') {
        return collectRefs(value._id ?? value.employeeId ?? value.id ?? value.employee, out);
    }
    const s = String(value).trim();
    if (s) out.add(s);
};

const resolveEmployees = async (refs) => {
    if (!refs.size) return [];
    const ids = [];
    const codes = [];
    for (const r of refs) (OID.test(r) ? ids : codes).push(r);
    try {
        const or = [];
        if (ids.length) or.push({ _id: { $in: ids } });
        if (codes.length) or.push({ employeeId: { $in: codes } });
        const rows = await Employee.find({ $or: or })
            .select('firstName lastName nameAsPerAadhaar employeeId department designation')
            .limit(50)
            .lean();
        return rows.map((e) => ({
            id: e._id,
            employeeId: e.employeeId,
            name: getDisplayName(e),
            department: e.department,
            designation: e.designation,
        }));
    } catch {
        return [];
    }
};

// ── Text helpers ───────────────────────────────────────────────────────────
const humanize = (field) =>
    String(field)
        .split('.')
        .filter((p) => !/^\d+$/.test(p))
        .map((p) => p.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()))
        .join(' › ');

const withCode = (name, code) => (name && code ? `${name} (${code})` : name || code || '');

const parseDevice = (ua = '') => {
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} on ${os}` : browser;
};

const clientIp = (req) => {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return (fwd || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
};

const messageFrom = (response) => {
    if (!response) return undefined;
    if (response.message) return String(response.message).slice(0, 300);
    if (Array.isArray(response.errors)) return response.errors.map((e) => e?.message || e).join('; ').slice(0, 300);
    return undefined;
};

// ── Main builder ───────────────────────────────────────────────────────────
export const buildAuditLog = async (req, res, trail) => {
    const response = trail.response || {};
    const loginUser = response?.data?.user;

    const path = req.originalUrl.split('?')[0];
    const method = req.method;
    const hit = matchRule(method, path);
    const rule = hit?.rule || fallbackRule(method, path);
    const params = { ...(hit?.params || {}), ...(req.params || {}) };

    const isLogin = rule.action === 'LOGIN';
    const status = res.statusCode;
    const failedBody = response.success === false;

    let actor = await resolveActor(req, status < 400 ? loginUser : null);

    // Failed login by a known staff account → still worth recording
    let loginAttemptFor = null;
    if (!actor && isLogin && req.body?.email) {
        try {
            const u = await EmployerUser.findOne({ email: String(req.body.email).toLowerCase().trim() })
                .select('-password').lean();
            if (u && getAuditedRoles().has(u.role)) { actor = toActor(u); loginAttemptFor = u; }
        } catch { /* ignore */ }
    }
    if (!actor) return null;

    // Never log 401s (invalid / expired token) — the actor is not really known
    if (status === 401 && !loginAttemptFor) return null;

    const outcome = status === 403 ? 'DENIED' : status >= 400 || failedBody ? 'FAILED' : 'SUCCESS';

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ctx = { body, params, query: req.query || {}, entities: trail.entities };

    const action = resolve(rule.action, ctx) || 'OTHER';
    let title = resolve(rule.title, ctx) || 'Performed an action';
    if (isLogin && outcome !== 'SUCCESS') title = 'Failed login attempt';

    // ── entities / target ──
    const entities = trail.entities.map((e) => ({
        model: e.model, type: e.type, op: e.op, id: e.id, label: e.label, bulk: e.bulk,
        changes: e.changes,
    }));

    let primary = null;
    if (rule.entity) {
        primary = trail.entities.find((e) => e.model === rule.entity && !e.bulk) || null;
    } else {
        primary = trail.entities.find((e) => e.model !== 'Employee' && !e.bulk) || null;
    }

    // ── employees this action was for ──
    const refs = new Set();
    for (const e of trail.entities) if (e.employeeRef && !e.bulk) refs.add(e.employeeRef);
    for (const p of rule.emp || []) {
        collectRefs(getPath({ body, params, query: req.query || {} }, p), refs);
    }
    // The acting user is never "the employee it was done for"
    const affectedEmployees = await resolveEmployees(refs);

    let target;
    if (primary && primary.label) {
        target = { type: primary.type, id: primary.id, name: primary.label };
    } else if (affectedEmployees.length) {
        const e = affectedEmployees[0];
        target = { type: 'Employee', id: String(e.id), name: withCode(e.name, e.employeeId) };
    } else if (rule.entity && Object.values(params)[0]) {
        target = { type: friendlyModel(rule.entity), id: String(Object.values(params)[0]), name: String(Object.values(params)[0]) };
    }

    // ── changed fields ──
    const changedFields = [
        ...new Set(
            trail.entities.filter((e) => (e.op === 'update' || e.upsert) && !e.bulk).flatMap((e) => e.changes.map((c) => c.field))
        ),
    ];

    // ── readable sentence ──
    const empLabel = (e) => withCode(e.name, e.employeeId);
    let description = title;
    const quoteEmployee = action === 'CREATE' && rule.entity === 'Employee';
    if (target?.name && (target.type !== 'Employee' || quoteEmployee)) description += ` “${target.name}”`;
    if (affectedEmployees.length && !quoteEmployee) {
        const shown = affectedEmployees.slice(0, 3).map(empLabel).join(', ');
        const more = affectedEmployees.length > 3 ? ` and ${affectedEmployees.length - 3} more` : '';
        description += ` for ${shown}${more}`;
    }
    const detail = [];
    const note = rule.note ? rule.note(ctx) : '';
    if (note) detail.push(note);
    if (action === 'UPDATE' && changedFields.length && !rule.note) {
        const names = changedFields.slice(0, 4).map(humanize).join(', ');
        detail.push(`Changed: ${names}${changedFields.length > 4 ? ` +${changedFields.length - 4} more` : ''}`);
    }
    if (detail.length) description += ` — ${detail.join(' · ')}`;

    const message = messageFrom(response);
    if (outcome === 'DENIED') description = `Blocked (no permission) — ${description}`;
    else if (outcome === 'FAILED') description = `Failed attempt — ${description}`;

    const files = [
        ...(req.file ? [req.file.originalname] : []),
        ...(Array.isArray(req.files) ? req.files.map((f) => f.originalname) : []),
    ].filter(Boolean);

    return {
        actor,
        module: rule.module || 'Other',
        action,
        title,
        description,
        changedFields,
        entities,
        droppedEntities: trail.dropped || 0,
        target,
        affectedEmployees,
        outcome,
        statusCode: status,
        message: outcome === 'SUCCESS' ? undefined : message,
        request: {
            method,
            path,
            params: sanitizePayload(params),
            query: sanitizePayload(req.query || {}),
            body: sanitizePayload(body),
            files,
        },
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        device: parseDevice(req.headers['user-agent'] || ''),
        durationMs: Date.now() - trail.startedAt,
    };
};

export const saveAuditLog = (data) =>
    // Run outside the request's async context so the older createdBy/updatedBy
    // stamping plugin never touches the log row itself.
    auditStorage.exit(() => AuditLog.create(data));
