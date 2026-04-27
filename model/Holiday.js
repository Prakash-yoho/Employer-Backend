import mongoose, { Schema } from "mongoose";

const holidaySchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    date: {
        type: Date,
        required: true
    },
    type: {
        type: String,
        enum: ['GOVERNMENT', 'OPTIONAL', 'COMPANY'],
        default: 'GOVERNMENT'
    },
    year: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        trim: true
    },
    isRecurring: {
        type: Boolean,
        default: false
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerUser' }
}, { timestamps: true });

holidaySchema.index({ date: 1, year: 1 });

export default mongoose.model("Holiday", holidaySchema);