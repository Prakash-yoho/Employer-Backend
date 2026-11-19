import mongoose from 'mongoose';
import {
    SKIP_MODELS,
    MAX_BULK_LOOKUP,
    getTrail,
    recordEntity,
    plain,
    labelFor,
    employeeRefFor,
    friendlyModel,
    diffPaths,
    diffUpdate,
    snapshotChanges,
} from './auditTrail.js';

/**
 * AUDIT TRAIL PLUGIN
 * ------------------
 * Records WHAT changed (which record, which fields, old → new value) whenever
 * an HR / IT / Project-Manager request creates, updates or deletes data.
 * Nothing is written here — entries are pushed to the current request's
 * trail and saved as ONE AuditLog row when the request finishes.
 *
 * - Costs nothing for requests that are not audited (employees, public
 *   routes, cron jobs): `getTrail()` returns null and every hook exits.
 * - Never throws: an audit failure must not break the real operation.
 * - Must be imported BEFORE any model is compiled (see index.js) and must
 *   not import any model itself.
 */

const modelNameOfDoc = (doc) => doc?.constructor?.modelName;
const modelNameOfQuery = (q) => q?.model?.modelName;
const skip = (name) => !name || SKIP_MODELS.has(name);

const mkEntity = (model, op, id, obj, changes = []) => ({
    model,
    type: friendlyModel(model),
    op,
    id: id ? String(id) : null,
    label: labelFor(model, obj),
    employeeRef: employeeRefFor(model, obj),
    changes,
});

/** Fetch the "before" state of the records a query is about to touch. */
const fetchBefore = async (query, limit) => {
    const opts = query.getOptions?.() || {};
    let q = query.model.find(query.getFilter()).limit(limit + 1).lean();
    if (opts.session) q = q.session(opts.session);
    return q.exec();
};

const auditTrailPlugin = (schema) => {
    if (schema.options?.skipAuditTrail) return;

    // ── doc.save() / Model.create() ──────────────────────────────────────
    schema.pre('save', async function () {
        try {
            if (this.$isSubdocument || this.$__parent) return;
            const trail = getTrail();
            const model = modelNameOfDoc(this);
            if (!trail || skip(model)) return;

            if (this.isNew) {
                recordEntity(mkEntity(model, 'create', this._id, this, snapshotChanges(this)));
                return;
            }

            const paths = this.modifiedPaths();
            if (!paths.length) return;

            let before = null;
            try {
                let q = this.constructor.findById(this._id).lean();
                const session = this.$session?.();
                if (session) q = q.session(session);
                before = await q.exec();
            } catch { /* fall through with empty before */ }

            const after = plain(this);
            const changes = diffPaths(plain(before), after, paths);
            if (!changes.length) return;
            recordEntity(mkEntity(model, 'update', this._id, after, changes));
        } catch { /* never block the real operation */ }
    });

    // ── Model.insertMany() ───────────────────────────────────────────────
    schema.post('insertMany', function (docs) {
        try {
            const trail = getTrail();
            const model = this?.modelName;
            if (!trail || skip(model) || !Array.isArray(docs)) return;
            for (const d of docs) {
                recordEntity(mkEntity(model, 'create', d?._id, d, snapshotChanges(d, 12)));
            }
        } catch { /* ignore */ }
    });

    // ── findOneAndUpdate / updateOne / updateMany ────────────────────────
    schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], async function () {
        try {
            const trail = getTrail();
            const model = modelNameOfQuery(this);
            if (!trail || skip(model)) return;

            const update = this.getUpdate();
            if (!update || Array.isArray(update)) return;

            const isMany = this.op === 'updateMany';
            const limit = isMany ? MAX_BULK_LOOKUP : 1;
            const found = await fetchBefore(this, limit);

            if (!found.length) {
                if (this.getOptions?.().upsert) {
                    recordEntity({
                        ...mkEntity(model, 'create', null, { ...this.getFilter(), ...(update.$set || {}) },
                            diffUpdate({}, update)),
                        upsert: true,
                    });
                }
                return;
            }

            // Cascade updates touching many records (e.g. clearing a schedule on
            // 200 employees) are summarised instead of listed one by one.
            if (found.length > limit) {
                const changes = diffUpdate({}, update);
                recordEntity({
                    ...mkEntity(model, 'update', null, {}, changes),
                    label: `${MAX_BULK_LOOKUP}+ ${friendlyModel(model).toLowerCase()} records`,
                    bulk: true,
                });
                return;
            }

            for (const doc of found.slice(0, limit)) {
                const changes = diffUpdate(doc, update);
                if (!changes.length) continue;
                recordEntity(mkEntity(model, 'update', doc._id, doc, changes));
            }
        } catch { /* ignore */ }
    });

    // ── doc.deleteOne() ──────────────────────────────────────────────────
    schema.pre('deleteOne', { document: true, query: false }, function () {
        try {
            const trail = getTrail();
            const model = modelNameOfDoc(this);
            if (!trail || skip(model)) return;
            recordEntity(mkEntity(model, 'delete', this._id, this));
        } catch { /* ignore */ }
    });

    // ── Query deletes: findOneAndDelete / deleteOne / deleteMany ─────────
    schema.pre(['findOneAndDelete', 'deleteOne', 'deleteMany'], { document: false, query: true }, async function () {
        try {
            const trail = getTrail();
            const model = modelNameOfQuery(this);
            if (!trail || skip(model)) return;

            const limit = this.op === 'deleteMany' ? MAX_BULK_LOOKUP : 1;
            const found = await fetchBefore(this, limit);
            if (found.length > limit) {
                recordEntity({
                    ...mkEntity(model, 'delete', null, {}),
                    label: `${MAX_BULK_LOOKUP}+ ${friendlyModel(model).toLowerCase()} records`,
                    bulk: true,
                });
                return;
            }
            for (const doc of found.slice(0, limit)) {
                recordEntity(mkEntity(model, 'delete', doc._id, doc));
            }
        } catch { /* ignore */ }
    });
};

// Register globally — applies to every schema compiled after this line.
mongoose.plugin(auditTrailPlugin);

export default auditTrailPlugin;
