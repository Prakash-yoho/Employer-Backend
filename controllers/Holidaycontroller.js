/**
 * holidayController.js
 * Handles: holiday CRUD (HR/Admin create/update/delete, all employees read).
 */

import Holiday from '../model/Holiday.js';
import { validate, sanitize, toUTC } from './leaveController.js';
import { createHolidayValidation, updateHolidayValidation } from '../validations/leaveValidation.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

export const createHoliday = async (req, res) => {
    try {
        const v = validate(createHolidayValidation, req.body);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });

        const dateObj = toUTC(v.data.date);
        const holiday = await new Holiday({
            name:        sanitize(v.data.name),
            date:        dateObj,
            year:        dayjs.utc(dateObj).year(),
            type:        v.data.type        || 'GOVERNMENT',
            description: sanitize(v.data.description || ''),
            isRecurring: v.data.isRecurring || false,
            createdBy:   req.user._id,
        }).save();

        return res.status(201).json({ success: true, message: 'Holiday created', data: holiday });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getHolidays = async (req, res) => {
    try {
        const year     = parseInt(req.query.year) || dayjs.utc().year();
        const q        = { year };
        if (req.query.type) q.type = req.query.type;
        const holidays = await Holiday.find(q).sort({ date: 1 }).lean();
        return res.json({ success: true, data: holidays, total: holidays.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const updateHoliday = async (req, res) => {
    try {
        const v = validate(updateHolidayValidation, req.body);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });

        const update = { ...v.data, updatedBy: req.user._id };
        if (update.date) {
            update.date = toUTC(update.date);
            update.year = dayjs.utc(update.date).year();
        }
        if (update.name) update.name = sanitize(update.name);
        if (update.description) update.description = sanitize(update.description);

        const holiday = await Holiday.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!holiday) return res.status(404).json({ success: false, message: 'Holiday not found' });

        return res.json({ success: true, message: 'Holiday updated', data: holiday });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const deleteHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.findByIdAndDelete(req.params.id);
        if (!holiday) return res.status(404).json({ success: false, message: 'Holiday not found' });
        return res.json({ success: true, message: 'Holiday deleted' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};