import express from 'express'
import dotenv from 'dotenv'
import { connectDB } from './config/db.js'
import employerRoutes from './routes/employerUserRoutes.js'
import employeeRoutes from './routes/employeeRoutes.js'
import documentRoutes from './routes/documentRoutes.js'
import identitycardRoutes from './routes/identityCardRoutes.js'
import ticketRoutes from './routes/ticketRoutes.js'
import dashboardHRAdminRoutes from './routes/dashboardHRAdminRoutes.js'
import assetRoutes from './routes/assetRoutes.js'
import itDashboardRoutes from './routes/itDashboardRoutes.js'
import notificationRoutes from './routes/notificationRoutes.js'
import employeeDashboardRoutes from './routes/employeeDashboardRoutes.js'
import leaveRoutes from './routes/leaveRoutes.js'
import leavePolicyRoutes from './routes/leavepolicyRoutes.js'
import holidayRoutes from './routes/holidayRoutes.js'
import permissionRoutes from './routes/permissionRoutes.js'
import OfficeTimingRoutes from './routes/Officetimingroutes.js'
import PhaseScheduleRoutes from './routes/PhaseScheduleRoutes.js'
import projectRoutes from './routes/projectmanagementRoute.js'
import cors from 'cors'
import cron from "node-cron"
import { clearExpiredAssignments } from './utils/clearExpiredAssignments.js'
import { sendScheduleExpiryReminders } from './utils/Sendscheduleexpiryreminders.js'
import defaultDocsRoutes from './routes/defaultDocsRoutes.js'
import attendanceRoutes from './routes/attendanceRoutes.js'
import breakPolicyRoutes from "./routes/breakPolicyRoutes.js"
import Violationgracepolicyroutes from "./routes/Violationgracepolicyroutes.js"
import announcementRoutes from './routes/announcementRoutes.js'
import payrollRoutes from "./routes/payrollRoutes.js";
import "./cron/midnightSweep.js";
import { syncTrueTime } from './utils/trueTime.js';
import { getTimeStatus } from './utils/trueTime.js';

// ✅ Appraisal effective-date cron
import { applyEffectiveAppraisals } from './cron/appraisalEffectiveJob.js';

dotenv.config()
connectDB()

const PORT = process.env.PORT || 5000
const app = express()

app.use(cors({
    origin: [
        process.env.FRONTEND_CANDIDATE_URL,
        process.env.FRONTEND_HR_URL,
        process.env.FRONTEND_EMPLOYER_ADMIN,
        process.env.FRONTEND_EMPLOYER_HR,
        process.env.FRONTEND_EMPLOYER_IT,
        process.env.FRONTEND_EMPLOYER_EMPLOYEE,
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://localhost:5176',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['*'],
    credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use("/public", express.static("public"));
app.use("/api", defaultDocsRoutes);

app.get("/api/attendance/time-status", (req, res) => res.json(getTimeStatus()));

// Employer Routes
app.use("/api/employer", employerRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/identity-cards', identitycardRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/leaves', leaveRoutes)
app.use('/api/leavepolicy', leavePolicyRoutes)
app.use('/api/holidays', holidayRoutes)
app.use('/api/permissions', permissionRoutes)
app.use('/api/office-timing', OfficeTimingRoutes)
app.use("/api/admin/attendance", attendanceRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/break-policy", breakPolicyRoutes);
app.use('/api/employer/dashboard', dashboardHRAdminRoutes);
app.use('/api/it-dashboard', itDashboardRoutes);
app.use('/api/employee/dashboard', employeeDashboardRoutes);
app.use('/api/phases-schedules', PhaseScheduleRoutes);
app.use("/api/projects", projectRoutes)
app.use("/api/announcements", announcementRoutes)
app.use("/api/salaryviolations", Violationgracepolicyroutes);
app.use("/api/payslips", payrollRoutes);

// ─── CRON JOBS ────────────────────────────────────────────────────────────────

// Sync server clock with authoritative time API on startup, then every hour.
syncTrueTime();
cron.schedule("0 * * * *", () => {
    console.log("[CRON] Running syncTrueTime...");
    syncTrueTime();
});

// Runs at midnight every day — clears employees whose schedule toDate has passed
cron.schedule("0 0 * * *", () => {
    console.log("[CRON] Running clearExpiredAssignments...");
    clearExpiredAssignments();
});

// Runs every day at 8:00 AM — sends HR/Admin a reminder for employees
// whose current schedule expires in ≤3 days and have NO upcoming schedule
cron.schedule("0 8 * * *", () => {
    console.log("[CRON] Running sendScheduleExpiryReminders...");
    sendScheduleExpiryReminders();
});

// ✅ Runs every day at 00:05 IST — applies salary appraisals whose effectiveDate has arrived
cron.schedule("5 0 * * *", () => {
    applyEffectiveAppraisals();
}, {
    timezone: "Asia/Kolkata",
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT,'0.0.0.0', () => {
    console.log(`Server is running on PORT: ${PORT}`)
})