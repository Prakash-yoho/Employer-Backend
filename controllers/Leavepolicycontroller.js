/**
 * leavePolicyController.js
 * Handles: leave policy CRUD (HR/Admin only).
 */

import LeavePolicy from '../model/LeavePolicy.js';
import { validate } from './leaveController.js';
import { createLeavePolicyValidation, updateLeavePolicyValidation } from '../validations/leaveValidation.js';

export const createLeavePolicy = async (req, res) => {
    try {
        const v = validate(createLeavePolicyValidation, req.body);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });

        const existing = await LeavePolicy.findOne({ isActive: true });
        if (existing) return res.status(400).json({ success: false, message: 'An active policy already exists. Update it instead.' });

        const policy = await new LeavePolicy({ ...v.data, createdBy: req.user._id }).save();
        return res.status(201).json({ success: true, message: 'Leave policy created', data: policy });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const getLeavePolicy = async (req, res) => {
    try {
        const policy = await LeavePolicy.findOne({ isActive: true }).lean();
        if (!policy) return res.status(404).json({ success: false, message: 'No active leave policy found' });
        return res.json({ success: true, data: policy });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const updateLeavePolicy = async (req, res) => {
    try {
        const v = validate(updateLeavePolicyValidation, req.body);
        if (!v.ok) return res.status(400).json({ success: false, message: 'Validation failed', errors: v.errors });

        const policy = await LeavePolicy.findByIdAndUpdate(
            req.params.id,
            { ...v.data, updatedBy: req.user._id },
            { new: true, runValidators: true }
        );
        if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });
        return res.json({ success: true, message: 'Leave policy updated', data: policy });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

export const deleteLeavePolicy = async (req, res) => {
    try {
        const policy = await LeavePolicy.findByIdAndDelete(req.params.id);
        if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });
        return res.json({ success: true, message: 'Leave policy deleted' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};