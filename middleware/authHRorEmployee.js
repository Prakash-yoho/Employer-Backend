// middleware/authHRorEmployee.js
//
// Combined guard for routes BOTH HR/Admin and employees can hit
// (payslip download, violation-report download).
//
// HR tokens  → role EMPLOYER_HR / EMPLOYER_ADMIN, user in EmployerUser
// Emp tokens → role Employee / TL, user in Employee (has .employeeId)
//
// Both token types share JWT_SECRET and carry { _id, role }.
// After this runs, req.user always has `.role`; employees also have `.employeeId`.

import jwt from "jsonwebtoken";
import BlacklistedToken from "../model/BlacklistedToken.js";
import EmployerUser from "../model/EmployerUser.js";
import Employee from "../model/Employee.js";

const HR_ROLES  = ["EMPLOYER_HR", "EMPLOYER_ADMIN"];
const EMP_ROLES = ["Employee", "TL"];

export const authenticateHRorEmployee = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ success: false, message: "No authentication token, access denied" });
    }

    // Shared blacklist check (HR path uses it; harmless for employees)
    const blacklisted = await BlacklistedToken.findOne({ token });
    if (blacklisted) {
      return res.status(401).json({ success: false, message: "Token invalidated" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === "TokenExpiredError")
        return res.status(401).json({ success: false, message: "Token expired" });
      return res.status(401).json({ success: false, message: "Token is invalid" });
    }

    // ── HR / Admin branch ──
    if (HR_ROLES.includes(decoded.role)) {
      const user = await EmployerUser.findById(decoded._id).select("-password");
      if (!user)        return res.status(401).json({ success: false, message: "User not found" });
      if (!user.isActive) return res.status(401).json({ success: false, message: "User account is deactivated" });
      req.user = user; // has .role
      return next();
    }

    // ── Employee / TL branch ──
    if (EMP_ROLES.includes(decoded.role)) {
      const employee = await Employee.findById(decoded._id).select("-officialPassword");
      if (!employee)        return res.status(404).json({ success: false, message: "Employee not found" });
      if (!employee.isActive) return res.status(400).json({ success: false, message: "Your account has been deactivated. Please contact HR/Admin." });
      req.user = employee; // has .employeeId; .role is "Employee"/"TL"
      return next();
    }

    return res.status(403).json({ success: false, message: "Access denied" });
  } catch (error) {
    console.error("authenticateHRorEmployee error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};