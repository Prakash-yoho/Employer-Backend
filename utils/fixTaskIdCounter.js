// utils/fixTaskIdCounter.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);

// Define Counter inline — same schema as inside Task.js
const Counter = mongoose.models.Counter || mongoose.model('Counter', new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
}));

// Define Task inline — just need taskId field
const Task = mongoose.models.Task || mongoose.model('Task', new mongoose.Schema({
    taskId: { type: String }
}));

const tasks = await Task.find({ taskId: { $exists: true } }).select('taskId').lean();

const maxSeq = tasks.reduce((max, t) => {
    const num = parseInt(t.taskId?.replace('TASK', '') ?? '0', 10);
    return num > max ? num : max;
}, 0);

await Counter.findByIdAndUpdate(
    'taskId',
    { $max: { seq: maxSeq } },
    { upsert: true, setDefaultsOnInsert: true }
);

await mongoose.disconnect();