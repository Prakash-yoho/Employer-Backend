import jwt from 'jsonwebtoken';
import { startTrail, getAuditedRoles } from '../config/auditTrail.js';
import { isIgnoredPath, isTrackedRead } from '../utils/auditCatalog.js';
import { buildAuditLog, saveAuditLog } from '../services/auditLogService.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records every action performed by HR / IT / Project-Manager users.
 *
 * Mount it ONCE, right after `auditContextMiddleware` and the body parsers
 * and before any router:
 *
 *     app.use(auditContextMiddleware);
 *     app.use(auditLogMiddleware);
 *
 * What it does
 *   1. Decides if the request is worth tracking (all POST/PUT/PATCH/DELETE,
 *      plus GET downloads / previews / exports listed in the catalog).
 *   2. Switches on record-level capture (auditTrailPlugin) when the caller's
 *      token belongs to an audited role.
 *   3. When the response is finished, builds ONE readable log row and saves
 *      it — after the response has been sent, so it never slows the user.
 *
 * Failures here are swallowed on purpose: logging must never break the app.
 */
export const auditLogMiddleware = (req, res, next) => {
    try {
        const path = req.originalUrl.split('?')[0];
        const tracked = MUTATING.has(req.method)
            ? !isIgnoredPath(path)
            : req.method === 'GET' && isTrackedRead(path);
        if (!tracked) return next();

        const trail = startTrail(req);

        // Cheap pre-check (no DB): is this token from an audited role?
        // The real identity is verified later; this only switches on capture.
        const token = req.header('Authorization')?.replace(/^Bearer\s+/i, '');
        const claimedRole = token ? jwt.decode(token)?.role : null;
        trail.enabled = Boolean(claimedRole && getAuditedRoles().has(claimedRole));

        // Capture the response body (message / login user) without altering it
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            try {
                trail.response = {
                    success: body?.success,
                    message: body?.message,
                    errors: body?.errors,
                    data: body?.data?.user ? { user: body.data.user } : undefined,
                };
            } catch { /* ignore */ }
            return originalJson(body);
        };

        res.once('finish', () => {
            // Login requests carry no token, so they are checked after the fact
            setImmediate(async () => {
                try {
                    const data = await buildAuditLog(req, res, trail);
                    if (data) await saveAuditLog(data);
                } catch (err) {
                    console.error('[AUDIT] could not write audit log:', err.message);
                }
            });
        });
    } catch (err) {
        console.error('[AUDIT] middleware error:', err.message);
    }
    return next();
};

export default auditLogMiddleware;
