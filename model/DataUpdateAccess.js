import mongoose, { Schema } from 'mongoose';

/**
 * One row = "HR opened these fields for THIS employee".
 * Rows created by the same HR action share a batchId (that is what the HR
 * history tab groups by).
 */
const changeSchema = new Schema({
    key: String,
    label: String,
    from: Schema.Types.Mixed,
    to: Schema.Types.Mixed,
}, { _id: false });

const dataUpdateAccessSchema = new Schema({
    batchId: { type: String, required: true, index: true },
    scope: { type: String, enum: ['ALL', 'SELECTED'], required: true },
    note: { type: String, trim: true, maxlength: 500, default: '' },

    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    employeeId: { type: String, required: true },
    employeeName: { type: String, default: '' },

    fields: { type: [String], required: true },          // dot-paths from utils/editableFields.js
    status: { type: String, enum: ['PENDING', 'COMPLETED', 'CANCELLED'], default: 'PENDING' },

    grantedBy: {
        userId: { type: Schema.Types.ObjectId, ref: 'EmployerUser' },
        email: String,
        name: String,
    },
    completedAt: { type: Date, default: null },
    changes: { type: [changeSchema], default: [] },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { userId: { type: Schema.Types.ObjectId, ref: 'EmployerUser' }, email: String },
}, { timestamps: true });

dataUpdateAccessSchema.index({ employee: 1, status: 1 });
dataUpdateAccessSchema.index({ batchId: 1, status: 1 });

export default mongoose.model('DataUpdateAccess', dataUpdateAccessSchema);
