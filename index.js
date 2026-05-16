import express from 'express'
import dotenv from 'dotenv'
import { connectDB } from './config/db.js'
// import jobRoutes from './routes/jobRoutes.js'
// import userRoutes from './routes/userRoutes.js'
// import otpRoutes from './routes/otpRoutes.js'
// import applicationRoutes from './routes/applicationRoutes.js'
// import dashboardRoutes from './routes/dashboardRoutes.js'
// import adminRoutes from './routes/adminRoutes.js'
// import resumeRoutes from './routes/resumeRoutes.js'
import employerRoutes from './routes/employerUserRoutes.js'
import employeeRoutes from './routes/employeeRoutes.js'
import documentRoutes from './routes/documentRoutes.js'
import ticketRoutes from './routes/ticketRoutes.js'
import dashboardHRAdminRoutes from './routes/dashboardHRAdminRoutes.js'
import assetRoutes from './routes/assetRoutes.js'
import itDashboardRoutes from './routes/itDashboardRoutes.js'
import notificationRoutes from './routes/notificationRoutes.js'
import employeeDashboardRoutes from './routes/employeeDashboardRoutes.js'
import leaveRoutes from './routes/leaveRoutes.js'
import OfficeTimingRoutes from './routes/Officetimingroutes.js'
import PhaseScheduleRoutes from './routes/PhaseScheduleRoutes.js'
import projectRoutes from './routes/projectmanagementRoute.js'
import cors from 'cors'
import cron from "node-cron"
import { clearExpiredAssignments } from './utils/clearExpiredAssignments.js'
import { sendScheduleExpiryReminders } from './utils/Sendscheduleexpiryreminders.js'
import defaultDocsRoutes from './routes/defaultDocsRoutes.js'
import attendanceRoutes from './routes/attendanceRoutes.js'

import announcementRoutes from './routes/announcementRoutes.js'
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
        'http://localhost:5176'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['*'],
    credentials: true,
}));


app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Job portal Routes
// app.use("/api/jobs", jobRoutes);
// app.use("/api/users", userRoutes);
// app.use("/api/otp", otpRoutes);
// app.use("/api/applications", applicationRoutes);
// app.use("/api/dashboard", dashboardRoutes)
// app.use("/api/admin", adminRoutes);
// app.use("/api/resume", resumeRoutes);



app.use("/public", express.static("public"));
app.use("/api", defaultDocsRoutes);

// Employer Routes
app.use("/api/employer", employerRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/leaves', leaveRoutes)
app.use('/api/office-timing', OfficeTimingRoutes)
app.use("/api/admin/attendance", attendanceRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use('/api/employer/dashboard', dashboardHRAdminRoutes);
app.use('/api/it-dashboard', itDashboardRoutes);
app.use('/api/employee/dashboard', employeeDashboardRoutes);
app.use('/api/phases-schedules', PhaseScheduleRoutes);
app.use("/api/projects",projectRoutes)
app.use("/api/announcements",announcementRoutes)

// ─── CRON JOBS ────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`Server is running on PORT: ${PORT}`)
})