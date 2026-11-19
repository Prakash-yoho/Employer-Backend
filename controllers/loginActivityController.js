import Employee from '../model/Employee.js';
import EmployerUser from '../model/EmployerUser.js';
import LoginHistory from '../model/LoginHistory.js';

const EMPLOYEE_ROLES = ['Employee', 'TL'];
const EMPLOYER_ROLES = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT', 'PROJECT_MANAGER'];

const toIntOr = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// GET /api/employer/login-activity/users
// List every user (Employees + EmployerUsers) with their current login status,
// filterable by role, status (online/offline) and a name/email/employeeId search.
export const getLoginActivityUsers = async (req, res) => {
    try {
        const { search = '', role = 'all', status = 'all', page = 1, limit = 10 } = req.query;

        const pageNum = toIntOr(page, 1);
        const limitNum = toIntOr(limit, 10);
        const searchRegex = search && search.trim() ? new RegExp(search.trim(), 'i') : null;
        const statusFilter = status !== 'all' ? (status === 'online' ? 'Online' : 'Offline') : null;

        let employees = [];
        if (role === 'all' || EMPLOYEE_ROLES.includes(role)) {
            const empFilter = {};
            if (EMPLOYEE_ROLES.includes(role)) empFilter.role = role;
            if (statusFilter) empFilter.loginStatus = statusFilter;
            if (searchRegex) {
                empFilter.$or = [
                    { firstName: searchRegex },
                    { lastName: searchRegex },
                    { officialEmail: searchRegex },
                    { employeeId: searchRegex },
                ];
            }
            const emps = await Employee.find(empFilter)
                .select('employeeId firstName lastName officialEmail role isActive loginStatus lastLoginAt lastLogoutAt lastLoginIp')
                .lean();

            employees = emps.map((e) => ({
                userId: e._id,
                userModel: 'Employee',
                employeeId: e.employeeId,
                name: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
                email: e.officialEmail,
                role: e.role,
                isActive: e.isActive,
                status: e.loginStatus || 'Offline',
                lastLoginAt: e.lastLoginAt || null,
                lastLogoutAt: e.lastLogoutAt || null,
                lastLoginIp: e.lastLoginIp || null,
            }));
        }

        let employerUsers = [];
        if (role === 'all' || EMPLOYER_ROLES.includes(role)) {
            const euFilter = {};
            if (EMPLOYER_ROLES.includes(role)) euFilter.role = role;
            if (statusFilter) euFilter.loginStatus = statusFilter;
            if (searchRegex) {
                euFilter.$or = [
                    { firstName: searchRegex },
                    { lastName: searchRegex },
                    { email: searchRegex },
                ];
            }
            const eus = await EmployerUser.find(euFilter)
                .select('firstName lastName email role isActive loginStatus lastLoginAt lastLogoutAt lastLoginIp')
                .lean();

            employerUsers = eus.map((u) => ({
                userId: u._id,
                userModel: 'EmployerUser',
                employeeId: null,
                name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
                email: u.email,
                role: u.role,
                isActive: u.isActive,
                status: u.loginStatus || 'Offline',
                lastLoginAt: u.lastLoginAt || null,
                lastLogoutAt: u.lastLogoutAt || null,
                lastLoginIp: u.lastLoginIp || null,
            }));
        }

        const combined = [...employees, ...employerUsers].sort((a, b) => {
            const at = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
            const bt = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
            return bt - at;
        });

        const total = combined.length;
        const onlineCount = combined.filter((u) => u.status === 'Online').length;
        const start = (pageNum - 1) * limitNum;
        const paginated = combined.slice(start, start + limitNum);

        return res.status(200).json({
            success: true,
            data: paginated,
            meta: {
                total,
                onlineCount,
                offlineCount: total - onlineCount,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1,
            },
        });
    } catch (error) {
        console.error('getLoginActivityUsers error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

// GET /api/employer/login-activity/users/:userModel/:userId/history
// Full paginated login/logout history for a single user.
export const getUserLoginHistory = async (req, res) => {
    try {
        const { userModel, userId } = req.params;
        if (!['Employee', 'EmployerUser'].includes(userModel)) {
            return res.status(400).json({ success: false, message: 'Invalid user type' });
        }

        const { page = 1, limit = 20, from, to } = req.query;
        const pageNum = toIntOr(page, 1);
        const limitNum = toIntOr(limit, 20);

        const filter = { userId, userModel };
        if (from || to) {
            filter.loginAt = {};
            if (from) filter.loginAt.$gte = new Date(from);
            if (to) filter.loginAt.$lte = new Date(to);
        }

        const userDocPromise =
            userModel === 'Employee'
                ? Employee.findById(userId).select('employeeId firstName lastName officialEmail role loginStatus').lean()
                : EmployerUser.findById(userId).select('firstName lastName email role loginStatus').lean();

        const [records, total, userDoc] = await Promise.all([
            LoginHistory.find(filter).sort({ loginAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
            LoginHistory.countDocuments(filter),
            userDocPromise,
        ]);

        if (!userDoc) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const history = records.map((r) => ({
            _id: r._id,
            loginAt: r.loginAt,
            logoutAt: r.logoutAt,
            status: r.status,
            ipAddress: r.ipAddress,
            userAgent: r.userAgent,
            durationMs: r.logoutAt ? new Date(r.logoutAt).getTime() - new Date(r.loginAt).getTime() : null,
        }));

        return res.status(200).json({
            success: true,
            data: {
                user: {
                    userId,
                    userModel,
                    name: `${userDoc.firstName || ''} ${userDoc.lastName || ''}`.trim(),
                    email: userModel === 'Employee' ? userDoc.officialEmail : userDoc.email,
                    employeeId: userModel === 'Employee' ? userDoc.employeeId : null,
                    role: userDoc.role,
                    status: userDoc.loginStatus || 'Offline',
                },
                history,
            },
            meta: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1,
            },
        });
    } catch (error) {
        console.error('getUserLoginHistory error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

// GET /api/employer/login-activity/history
// Flat, filterable feed of every login/logout session across all users.
export const getAllLoginHistory = async (req, res) => {
    try {
        const { search = '', role = 'all', status = 'all', from, to, page = 1, limit = 20 } = req.query;
        const pageNum = toIntOr(page, 1);
        const limitNum = toIntOr(limit, 20);

        const filter = {};
        if (role !== 'all') filter.role = role;
        if (status !== 'all') filter.status = status === 'active' ? 'active' : 'logged_out';
        if (from || to) {
            filter.loginAt = {};
            if (from) filter.loginAt.$gte = new Date(from);
            if (to) filter.loginAt.$lte = new Date(to);
        }
        if (search && search.trim()) {
            const re = new RegExp(search.trim(), 'i');
            filter.$or = [{ name: re }, { email: re }, { employeeId: re }];
        }

        const [records, total] = await Promise.all([
            LoginHistory.find(filter).sort({ loginAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
            LoginHistory.countDocuments(filter),
        ]);

        const data = records.map((r) => ({
            _id: r._id,
            userId: r.userId,
            userModel: r.userModel,
            role: r.role,
            name: r.name,
            email: r.email,
            employeeId: r.employeeId,
            ipAddress: r.ipAddress,
            userAgent: r.userAgent,
            loginAt: r.loginAt,
            logoutAt: r.logoutAt,
            status: r.status,
            durationMs: r.logoutAt ? new Date(r.logoutAt).getTime() - new Date(r.loginAt).getTime() : null,
        }));

        return res.status(200).json({
            success: true,
            data,
            meta: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1,
            },
        });
    } catch (error) {
        console.error('getAllLoginHistory error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};
