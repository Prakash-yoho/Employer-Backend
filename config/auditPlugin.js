import mongoose from 'mongoose';
import { getAuditActor } from './auditContext.js';

/**
 * GLOBAL AUDIT PLUGIN
 * -------------------
 * Automatically records WHO (HR / Admin) created or last updated every
 * document, with their full details:
 *   { userId, name, email, role, phoneNumber, at }
 *
 * Field naming:
 *   - `createdBy` / `updatedBy` are added when the schema does not
 *     already define them.
 *   - If a schema ALREADY has its own `createdBy` / `updatedBy`
 *     (e.g. Asset, Holiday, LeavePolicy, Projects, Team, Employee, ...)
 *     those existing fields are left 100% untouched, and the detailed
 *     audit object is stored in `createdByDetails` / `updatedByDetails`
 *     instead — so no existing functionality changes.
 *
 * Stamping only happens when the acting user is HR or Admin
 * (EMPLOYER_HR / EMPLOYER_ADMIN / admin). Employee actions, cron jobs
 * and public routes are never stamped.
 *
 * NOTE: this file must be imported BEFORE any model is compiled
 * (it is the first import in index.js).
 */
const auditPlugin = (schema) => {
    const hasPath = (p) =>
        Boolean(schema.path(p) || (schema.nested && schema.nested[p]));

    // Pick non-conflicting field names per schema
    const createdField = hasPath('createdBy') ? 'createdByDetails' : 'createdBy';
    const updatedField = hasPath('updatedBy') ? 'updatedByDetails' : 'updatedBy';

    const toAdd = {};
    if (!hasPath(createdField)) {
        toAdd[createdField] = { type: mongoose.Schema.Types.Mixed, default: undefined };
    }
    if (!hasPath(updatedField)) {
        toAdd[updatedField] = { type: mongoose.Schema.Types.Mixed, default: undefined };
    }
    if (Object.keys(toAdd).length) schema.add(toAdd);

    // ── Document creates & saves (Model.create / new Model().save / doc.save) ──
    schema.pre('save', function () {
        try {
            const actor = getAuditActor();
            if (actor) {
                if (this.isNew) {
                    if (!this.get(createdField)) this.set(createdField, actor);
                } else if (this.isModified()) {
                    this.set(updatedField, actor);
                }
            }
        } catch {
            /* never block the actual operation */
        }
    });

    // ── Bulk creates (Model.insertMany) ──
    schema.pre('insertMany', function (next, docs) {
        try {
            const actor = getAuditActor();
            if (actor && Array.isArray(docs)) {
                for (const d of docs) {
                    if (d && typeof d === 'object' && !d[createdField]) {
                        d[createdField] = actor;
                    }
                }
            }
        } catch {
            /* never block the actual operation */
        }
        next();
    });

    // ── Query updates (findByIdAndUpdate / findOneAndUpdate / updateOne / updateMany) ──
    schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function () {
        try {
            const actor = getAuditActor();
            const update = this.getUpdate();
            // Skip aggregation-pipeline style updates (arrays) — rare & unsafe to mutate
            if (actor && update && !Array.isArray(update)) {
                this.set(updatedField, actor);
            }
        } catch {
            /* never block the actual operation */
        }
    });
};

// Register globally — applies to every schema compiled after this line.
mongoose.plugin(auditPlugin);

export default auditPlugin;
