import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped storage so Mongoose hooks can know WHO (HR/Admin)
 * is performing the current database action — without changing any
 * controller code.
 */
export const auditStorage = new AsyncLocalStorage();

/**
 * Express middleware — wraps every request in an async context that
 * holds a reference to `req`. Auth middlewares later attach `req.user`,
 * and the mongoose audit plugin reads it from here at write time.
 */
export const auditContextMiddleware = (req, res, next) => {
    auditStorage.run({ req }, () => next());
};

// Only actions performed by HR / Admin are stamped.
const AUDIT_ROLES = new Set(['EMPLOYER_HR', 'EMPLOYER_ADMIN', 'admin', 'ADMIN']);

/**
 * Returns a plain details object for the current acting HR/Admin user,
 * or null when the action was not performed by HR/Admin (employee
 * actions, cron jobs, public routes, etc. are left untouched).
 */
export const getAuditActor = () => {
    try {
        const store = auditStorage.getStore();
        const user = store?.req?.user;
        if (!user || !user.role || !AUDIT_ROLES.has(user.role)) return null;

        const name =
            [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            user.name ||
            user.fullName ||
            undefined;

        const actor = {
            userId: user._id ?? user.userId ?? user.id ?? undefined,
            name,
            email: user.email ?? undefined,
            role: user.role,
            phoneNumber: user.phoneNumber ?? undefined,
            at: new Date()
        };

        // Strip undefined keys so we store a clean object
        Object.keys(actor).forEach((k) => actor[k] === undefined && delete actor[k]);
        return actor;
    } catch {
        return null;
    }
};
