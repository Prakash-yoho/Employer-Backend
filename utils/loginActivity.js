import LoginHistory from "../model/LoginHistory.js";
import Employee from "../model/Employee.js";
import EmployerUser from "../model/EmployerUser.js";

const EMPLOYEE_ROLES = ["Employee", "TL"];

const getClientIp = (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return forwarded.split(",")[0].trim();
    return req.socket?.remoteAddress || req.ip || null;
};

const modelForRole = (role) =>
    EMPLOYEE_ROLES.includes(role) ? Employee : EmployerUser;

/**
 * Call right after a login succeeds & the JWT has been generated.
 * Opens a new "active" session and refreshes the cached status on the user doc.
 */
export const recordLogin = async (req, { userId, userModel, role, name, email, employeeId, token }) => {
    try {
        await LoginHistory.create({
            userId,
            userModel,
            role,
            name: name || null,
            email: email || null,
            employeeId: employeeId || null,
            token,
            ipAddress: getClientIp(req),
            userAgent: req.headers["user-agent"] || null,
            loginAt: new Date(),
            status: "active",
        });

        const Model = modelForRole(role);
        await Model.updateOne(
            { _id: userId },
            { loginStatus: "Online", lastLoginAt: new Date() }
        );
    } catch (error) {
        // Login-activity tracking should never break the login/logout flow itself
        console.error("recordLogin error:", error);
    }
};

/**
 * Call right after a logout blacklists the token.
 * Closes the matching "active" session (matched by the raw token) and
 * refreshes the cached status on the user doc using the decoded JWT payload.
 */
export const recordLogout = async (token, decoded) => {
    try {
        const now = new Date();

        await LoginHistory.findOneAndUpdate(
            { token, status: "active" },
            { logoutAt: now, status: "logged_out" },
            { sort: { loginAt: -1 } }
        );

        if (decoded?._id && decoded?.role) {
            const Model = modelForRole(decoded.role);
            await Model.updateOne(
                { _id: decoded._id },
                { loginStatus: "Offline", lastLogoutAt: now }
            );
        }
    } catch (error) {
        console.error("recordLogout error:", error);
    }
};
