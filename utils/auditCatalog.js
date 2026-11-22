/**
 * AUDIT CATALOG
 * -------------
 * Maps every tracked endpoint to a Module, an Action type and a plain-language
 * title, so the Admin sees "Approved leave request" instead of
 * "PATCH /api/leaves/LV-0012/status".
 *
 * Rule fields
 *   module  – section of the portal (used for the Module filter)
 *   action  – action type (string, or fn(ctx) → string)  → Action filter
 *   title   – readable verb phrase (string, or fn(ctx) → string)
 *   entity  – primary record type the action is about (picks the "target")
 *   emp     – where to find the employee(s) the action is FOR
 *             ('params.id', 'body.employeeId', 'body.employeeIds', ...)
 *   note    – extra detail appended to the sentence (fn(ctx) → string)
 *   read    – GET endpoints that are tracked because they expose / export
 *             sensitive data (downloads, previews, reports)
 *
 * ctx = { body, params, query, entities }
 *
 * Any mutating request that is NOT listed here is still logged through the
 * generic fallback at the bottom — nothing slips through.
 */

// ── Action vocabulary (value → label) — also served to the filter dropdown ──
export const ACTION_LABELS = {
    CREATE: 'Created',
    UPDATE: 'Updated',
    DELETE: 'Deleted',
    RESTORE: 'Restored',
    APPROVE: 'Approved',
    REJECT: 'Rejected',
    VERIFY: 'Verified',
    REVIEW: 'Reviewed',
    ASSIGN: 'Assigned',
    UNASSIGN: 'Unassigned',
    FORWARD: 'Forwarded',
    RESOLVE: 'Resolved',
    QUESTION: 'Asked a question',
    SEND: 'Sent',
    GENERATE: 'Generated',
    REVOKE: 'Revoked',
    ACTIVATE: 'Activated',
    DEACTIVATE: 'Deactivated',
    RELEASE: 'Released',
    PUBLISH: 'Published',
    PASSWORD_CHANGE: 'Changed password',
    EXPORT: 'Exported',
    DOWNLOAD: 'Downloaded',
    VIEW: 'Viewed',
    LOGIN: 'Logged in',
    LOGOUT: 'Logged out',
    OTHER: 'Other',
};

export const MODULES = [
    'Authentication',
    'My Profile',
    'Staff Users',
    'Employees',
    'Documents',
    'Identity Cards',
    'Appointment Letters',
    'Experience / Relieving Letters',
    'Appraisals',
    'Leave Management',
    'Permissions',
    'Data Update Access',
    'Leave Policy',
    'Holidays',
    'Office Timings',
    'Break Policy',
    'Salary Policy',
    'Payroll',
    'Announcements',
    'Tickets',
    'Assets',
    'Seat Allotment',
    'Projects',
    'Teams',
    'Team Leads',
    'Tasks',
    'Other',
];

// ── rule registry ──────────────────────────────────────────────────────────
const RULES = [];

const toRegex = (path) =>
    new RegExp(`^${path.replace(/:([A-Za-z]+)/g, '(?<$1>[^/]+)')}/?$`);

const add = (method, path, def) => RULES.push({ method, path, re: toRegex(path), ...def });

const monthNote = (c) => {
    const m = c.body?.month || c.query?.month;
    return m ? `Month: ${m}` : '';
};
const quote = (s) => (s ? `“${String(s).slice(0, 160)}”` : '');

// ── Authentication / profile ───────────────────────────────────────────────
add('POST', '/api/employer/employer/login', { module: 'Authentication', action: 'LOGIN', title: 'Logged in' });
add('POST', '/api/employer/projectmanager/login', { module: 'Authentication', action: 'LOGIN', title: 'Logged in' });
add('POST', '/api/employer/logout', { module: 'Authentication', action: 'LOGOUT', title: 'Logged out' });
add('PUT', '/api/employer/profile/me', { module: 'My Profile', action: 'UPDATE', title: 'Updated own profile', entity: 'EmployerUser' });

// ── Staff users (HR / IT / Project Manager / Admin accounts) ───────────────
add('POST', '/api/employer', { module: 'Staff Users', action: 'CREATE', title: 'Created staff user', entity: 'EmployerUser' });
add('PUT', '/api/employer/:id', { module: 'Staff Users', action: 'UPDATE', title: 'Updated staff user', entity: 'EmployerUser' });
add('DELETE', '/api/employer/:id/hard', { module: 'Staff Users', action: 'DELETE', title: 'Permanently deleted staff user', entity: 'EmployerUser' });
add('DELETE', '/api/employer/:id', { module: 'Staff Users', action: 'DEACTIVATE', title: 'Deactivated staff user', entity: 'EmployerUser' });
add('PATCH', '/api/employer/:id/reactivate', { module: 'Staff Users', action: 'ACTIVATE', title: 'Reactivated staff user', entity: 'EmployerUser' });

// ── Employees ──────────────────────────────────────────────────────────────
add('POST', '/api/employees', { module: 'Employees', action: 'CREATE', title: 'Created employee', entity: 'Employee' });
add('POST', '/api/employees/:id/change-password', { module: 'Employees', action: 'PASSWORD_CHANGE', title: 'Changed employee login password', entity: 'Employee', emp: ['params.id'] });
add('PATCH', '/api/employees/:id/status', {
    module: 'Employees',
    action: (c) => (c.body?.isActive === false ? 'DEACTIVATE' : 'ACTIVATE'),
    title: (c) => (c.body?.isActive === false ? 'Deactivated employee' : 'Activated employee'),
    entity: 'Employee', emp: ['params.id'],
});
add('PUT', '/api/employees/:id/admin-update', { module: 'Employees', action: 'UPDATE', title: 'Updated employee details', entity: 'Employee', emp: ['params.id'] });
add('POST', '/api/employees/:id/reset-update', { module: 'Employees', action: 'UPDATE', title: 'Reset employee profile-update request', entity: 'Employee', emp: ['params.id'] });
add('PUT', '/api/employees/:id/profile-image', { module: 'Employees', action: 'UPDATE', title: 'Changed employee profile photo', entity: 'Employee', emp: ['params.id'] });
add('DELETE', '/api/employees/:id/profile-image', { module: 'Employees', action: 'DELETE', title: 'Removed employee profile photo', entity: 'Employee', emp: ['params.id'] });


// ── Documents ──────────────────────────────────────────────────────────────
add('PUT', '/api/documents/verify/:employeeId', {
    module: 'Documents',
    action: (c) => ({ verified: 'VERIFY', doc_rejected: 'REJECT' }[c.body?.status] || 'UPDATE'),
    title: (c) => ({
        verified: 'Verified employee document',
        doc_rejected: 'Rejected employee document',
        doc_submitted: 'Moved employee document back to “awaiting review”',
    }[c.body?.status] || 'Updated employee document status'),
    entity: 'Document', emp: ['params.employeeId'],
    note: (c) => [c.body?.documentType && `Document: ${c.body.documentType}`, c.body?.remark && `Remark: ${quote(c.body.remark)}`].filter(Boolean).join(' · '),
});
add('GET', '/api/documents/employee/:employeeId/preview/:documentType', { module: 'Documents', action: 'VIEW', title: 'Viewed employee document', emp: ['params.employeeId'], read: true, note: (c) => `Document: ${c.params?.documentType}` });
add('GET', '/api/documents/employee/:employeeId/download/:documentType', { module: 'Documents', action: 'DOWNLOAD', title: 'Downloaded employee document', emp: ['params.employeeId'], read: true, note: (c) => `Document: ${c.params?.documentType}` });

// ── Identity cards ─────────────────────────────────────────────────────────
add('POST', '/api/identity-cards/:id/generate', { module: 'Identity Cards', action: 'GENERATE', title: 'Generated ID card', entity: 'Employee', emp: ['params.id'] });
add('POST', '/api/identity-cards/:id/revoke', { module: 'Identity Cards', action: 'REVOKE', title: 'Revoked ID card', entity: 'Employee', emp: ['params.id'] });
add('GET', '/api/identity-cards/:id/preview', { module: 'Identity Cards', action: 'VIEW', title: 'Previewed ID card', emp: ['params.id'], read: true });
add('GET', '/api/identity-cards/report/export', { module: 'Identity Cards', action: 'EXPORT', title: 'Exported ID card report', read: true });
add('GET', '/api/identity-cards/report/export-pdf', { module: 'Identity Cards', action: 'EXPORT', title: 'Exported ID cards as PDF', read: true });

// ── Letters & certificates ─────────────────────────────────────────────────
add('POST', '/api/employees/profile/send-appointmentletter', { module: 'Appointment Letters', action: 'SEND', title: 'Sent appointment letter', emp: ['body.employeeId', 'body.id'] });
add('GET', '/api/documents/employee/:employeeId/preview-appointment-letter', { module: 'Appointment Letters', action: 'VIEW', title: 'Previewed appointment letter', emp: ['params.employeeId'], read: true });
add('GET', '/api/documents/employee/:employeeId/download-appointment-letter', { module: 'Appointment Letters', action: 'DOWNLOAD', title: 'Downloaded appointment letter', emp: ['params.employeeId'], read: true });

add('POST', '/api/employees/generate-relieving-letter', { module: 'Experience / Relieving Letters', action: 'GENERATE', title: 'Generated relieving letter', emp: ['body.employeeId'] });
add('POST', '/api/employees/generate-experience-certificate', { module: 'Experience / Relieving Letters', action: 'GENERATE', title: 'Generated experience certificate', emp: ['body.employeeId'] });
add('POST', '/api/employees/:id/send-relieving-letter', { module: 'Experience / Relieving Letters', action: 'SEND', title: 'Sent relieving letter', entity: 'Employee', emp: ['params.id'] });
add('POST', '/api/employees/:id/send-experience-certificate', { module: 'Experience / Relieving Letters', action: 'SEND', title: 'Sent experience certificate', entity: 'Employee', emp: ['params.id'] });
add('GET', '/api/employees/:id/preview-relieving-letter', { module: 'Experience / Relieving Letters', action: 'VIEW', title: 'Previewed relieving letter', emp: ['params.id'], read: true });
add('GET', '/api/employees/:id/preview-experience-certificate', { module: 'Experience / Relieving Letters', action: 'VIEW', title: 'Previewed experience certificate', emp: ['params.id'], read: true });

add('POST', '/api/employees/:id/send-appraisal-letter', {
    module: 'Appraisals', action: 'SEND', title: 'Sent appraisal letter', entity: 'Employee', emp: ['params.id'],
    note: (c) => [c.body?.newAnnualSalary && 'Salary revision included', c.body?.percentageIncrement && `Increment: ${c.body.percentageIncrement}%`, c.body?.effectiveDate && `Effective: ${c.body.effectiveDate}`].filter(Boolean).join(' · '),
});
add('GET', '/api/employees/:id/preview-appraisal-letter/:appraisalId', { module: 'Appraisals', action: 'VIEW', title: 'Previewed appraisal letter', emp: ['params.id'], read: true });

// ── Leave / permission ─────────────────────────────────────────────────────
const decision = (c) => (c.body?.status === 'REJECTED' ? 'REJECT' : 'APPROVE');
add('PATCH', '/api/leaves/:leaveRequestId/status', {
    module: 'Leave Management', action: decision,
    title: (c) => `${c.body?.status === 'REJECTED' ? 'Rejected' : 'Approved'} leave request`,
    entity: 'Leave', note: (c) => (c.body?.comments ? `Comment: ${quote(c.body.comments)}` : ''),
});
add('PATCH', '/api/permissions/updatestatus/:requestId', {
    module: 'Permissions', action: decision,
    title: (c) => `${c.body?.status === 'REJECTED' ? 'Rejected' : 'Approved'} permission request`,
    entity: 'Permission', note: (c) => (c.body?.comments ? `Comment: ${quote(c.body.comments)}` : ''),
});

// ── Data update access (HR opens fields for employees to edit) ──────────────
add('POST', '/api/data-updates', {
    module: 'Data Update Access', action: 'ASSIGN', title: 'Gave employees access to update selected details',
    entity: 'DataUpdateAccess', emp: ['body.employeeIds'],
    note: (c) => [c.body?.scope === 'ALL' ? 'All employees' : `${(c.body?.employeeIds || []).length} employee(s)`, `${(c.body?.fields || []).length} field(s)`].join(' · '),
});
add('PATCH', '/api/data-updates/batches/:batchId/cancel', { module: 'Data Update Access', action: 'REVOKE', title: 'Cancelled pending data-update access', entity: 'DataUpdateAccess' });

// ── Policies / settings ────────────────────────────────────────────────────
add('POST', '/api/leavepolicy/createpolicy', { module: 'Leave Policy', action: 'CREATE', title: 'Created leave policy', entity: 'LeavePolicy' });
add('PATCH', '/api/leavepolicy/update/:id', { module: 'Leave Policy', action: 'UPDATE', title: 'Updated leave policy', entity: 'LeavePolicy' });
add('DELETE', '/api/leavepolicy/delete/:id', { module: 'Leave Policy', action: 'DELETE', title: 'Deleted leave policy', entity: 'LeavePolicy' });

add('POST', '/api/holidays/createholidays', { module: 'Holidays', action: 'CREATE', title: 'Added holiday', entity: 'Holiday' });
add('PUT', '/api/holidays/updateholidays/:id', { module: 'Holidays', action: 'UPDATE', title: 'Updated holiday', entity: 'Holiday' });
add('DELETE', '/api/holidays/deleteholidays/:id', { module: 'Holidays', action: 'DELETE', title: 'Deleted holiday', entity: 'Holiday' });

add('PUT', '/api/office-timing', { module: 'Office Timings', action: 'UPDATE', title: 'Updated office timing', entity: 'OfficeTiming' });
add('PUT', '/api/break-policy', { module: 'Break Policy', action: 'UPDATE', title: 'Updated break policy', entity: 'BreakPolicy' });
add('PUT', '/api/salaryviolations/violation-grace-policy', { module: 'Salary Policy', action: 'UPDATE', title: 'Updated salary / violation grace policy', entity: 'ViolationGracePolicy' });
add('GET', '/api/salaryviolations/violations/salary/:employeeId/report', { module: 'Salary Policy', action: 'DOWNLOAD', title: 'Downloaded salary violation report', emp: ['params.employeeId'], read: true });

// ── Payroll ────────────────────────────────────────────────────────────────
const PAY = '/api/payslips/payroll';
const payEmp = ['body.employeeId', 'body.employeeIds'];
add('PUT', `${PAY}/skip`, { module: 'Payroll', action: 'UPDATE', title: 'Skipped violations in payroll', emp: payEmp, entity: 'PayrollRelease', note: monthNote });
add('PUT', `${PAY}/skip-all`, { module: 'Payroll', action: 'UPDATE', title: 'Skipped all violations in payroll', entity: 'PayrollRelease', note: monthNote });
add('POST', `${PAY}/release`, { module: 'Payroll', action: 'RELEASE', title: 'Released payroll', emp: payEmp, entity: 'PayrollRelease', note: monthNote });
add('POST', `${PAY}/unrelease`, { module: 'Payroll', action: 'REVOKE', title: 'Reverted released payroll', emp: payEmp, entity: 'PayrollRelease', note: monthNote });
add('POST', `${PAY}/publish`, { module: 'Payroll', action: 'PUBLISH', title: 'Published payslips', emp: payEmp, entity: 'PayrollRelease', note: monthNote });
add('POST', `${PAY}/unpublish`, { module: 'Payroll', action: 'REVOKE', title: 'Unpublished payslips', emp: payEmp, entity: 'PayrollRelease', note: monthNote });
add('PUT', `${PAY}/manual-days`, { module: 'Payroll', action: 'UPDATE', title: 'Set manual worked days', emp: payEmp, entity: 'PayrollRelease', note: (c) => [monthNote(c), c.body?.workedDays != null && `Worked days: ${c.body.workedDays}`].filter(Boolean).join(' · ') });
add('POST', `${PAY}/manual-bulk`, { module: 'Payroll', action: 'UPDATE', title: 'Bulk-updated manual payroll entries', entity: 'PayrollRelease', note: monthNote });
add('POST', `${PAY}/manual-violation`, { module: 'Payroll', action: 'CREATE', title: 'Added manual violation', emp: payEmp, entity: 'PayrollRelease', note: (c) => [monthNote(c), c.body?.message && `Reason: ${quote(c.body.message)}`].filter(Boolean).join(' · ') });
add('DELETE', `${PAY}/manual-violation`, { module: 'Payroll', action: 'DELETE', title: 'Removed manual violation', emp: payEmp, entity: 'PayrollRelease', note: monthNote });
add('POST', `${PAY}/manual-violation/remove`, { module: 'Payroll', action: 'DELETE', title: 'Removed manual violation', emp: payEmp, entity: 'PayrollRelease', note: monthNote });
add('POST', `${PAY}/report`, { module: 'Payroll', action: 'EXPORT', title: 'Generated payroll report', note: monthNote });
add('GET', `${PAY}/slip/:employeeId`, { module: 'Payroll', action: 'DOWNLOAD', title: 'Downloaded payslip', emp: ['params.employeeId'], read: true, note: monthNote });
add('GET', `${PAY}/violation-report/:employeeId`, { module: 'Payroll', action: 'DOWNLOAD', title: 'Downloaded violation report', emp: ['params.employeeId'], read: true, note: monthNote });
add('GET', `${PAY}/history/:historyId/slip`, { module: 'Payroll', action: 'DOWNLOAD', title: 'Downloaded historical payslip', read: true });
add('GET', `${PAY}/history/:historyId/violation-report`, { module: 'Payroll', action: 'DOWNLOAD', title: 'Downloaded historical violation report', read: true });


// ── Announcements ──────────────────────────────────────────────────────────
add('POST', '/api/announcements/createAnnouncement', { module: 'Announcements', action: 'CREATE', title: 'Published announcement', entity: 'Announcement' });
add('PUT', '/api/announcements/updateAnnouncement/:id', { module: 'Announcements', action: 'UPDATE', title: 'Updated announcement', entity: 'Announcement' });
add('DELETE', '/api/announcements/deleteAnnouncement/:id', { module: 'Announcements', action: 'DELETE', title: 'Deleted announcement', entity: 'Announcement' });

// ── Tickets ────────────────────────────────────────────────────────────────
add('PUT', '/api/tickets/:ticketId', { module: 'Tickets', action: 'UPDATE', title: 'Updated ticket', entity: 'Ticket' });
add('POST', '/api/tickets/:ticketId/forward', { module: 'Tickets', action: 'FORWARD', title: 'Forwarded ticket to IT support', entity: 'Ticket', note: (c) => (c.body?.comment ? `Comment: ${quote(c.body.comment)}` : '') });
add('POST', '/api/tickets/:ticketId/question', { module: 'Tickets', action: 'QUESTION', title: 'Asked a question on ticket', entity: 'Ticket', note: (c) => (c.body?.question ? quote(c.body.question) : '') });
add('POST', '/api/tickets/:ticketId/answer', { module: 'Tickets', action: 'RESOLVE', title: 'Answered a ticket question', entity: 'Ticket', note: (c) => (c.body?.answer ? quote(c.body.answer) : '') });
add('POST', '/api/tickets/:ticketId/resolve', { module: 'Tickets', action: 'RESOLVE', title: 'Resolved ticket', entity: 'Ticket', note: (c) => (c.body?.resolvedComment ? `Comment: ${quote(c.body.resolvedComment)}` : '') });

// ── Assets ─────────────────────────────────────────────────────────────────
add('POST', '/api/assets', { module: 'Assets', action: 'CREATE', title: 'Added asset', entity: 'Asset' });
add('PUT', '/api/assets/:assetId', { module: 'Assets', action: 'UPDATE', title: 'Updated asset', entity: 'Asset' });
add('POST', '/api/assets/:assetId/assign', { module: 'Assets', action: 'ASSIGN', title: 'Assigned asset to employee', entity: 'Asset', emp: ['body.employeeId'], note: (c) => (c.body?.notes ? `Notes: ${quote(c.body.notes)}` : '') });
add('POST', '/api/assets/:assetId/unassign', { module: 'Assets', action: 'UNASSIGN', title: 'Took back asset from employee', entity: 'Asset', note: (c) => (c.body?.notes ? `Notes: ${quote(c.body.notes)}` : '') });
add('DELETE', '/api/assets/:assetId/delete', { module: 'Assets', action: 'DELETE', title: 'Deleted asset', entity: 'Asset' });


// ── Phases & schedules (Seat Allotment) ────────────────────────────────────
const PS = '/api/phases-schedules';
add('POST', `${PS}/phase/create`, { module: 'Seat Allotment', action: 'CREATE', title: 'Created phase', entity: 'Phase' });
add('PUT', `${PS}/phases/:id`, { module: 'Seat Allotment', action: 'UPDATE', title: 'Updated phase', entity: 'Phase' });
add('DELETE', `${PS}/phases/:id`, { module: 'Seat Allotment', action: 'DELETE', title: 'Deleted phase', entity: 'Phase' });
add('PATCH', `${PS}/phases/:id/restore`, { module: 'Seat Allotment', action: 'RESTORE', title: 'Restored phase', entity: 'Phase' });
add('POST', `${PS}/schedules/create`, { module: 'Seat Allotment', action: 'CREATE', title: 'Created schedule', entity: 'Schedule' });
add('PUT', `${PS}/schedules/group/:groupId`, { module: 'Seat Allotment', action: 'UPDATE', title: 'Updated schedule dates', entity: 'Schedule' });
add('DELETE', `${PS}/schedules/group/:groupId`, { module: 'Seat Allotment', action: 'DELETE', title: 'Deleted schedule group', entity: 'Schedule' });
add('DELETE', `${PS}/schedules/:id`, { module: 'Seat Allotment', action: 'DELETE', title: 'Deleted schedule', entity: 'Schedule' });
add('PATCH', `${PS}/schedules/:id/restore`, { module: 'Seat Allotment', action: 'RESTORE', title: 'Restored schedule', entity: 'Schedule' });
add('POST', `${PS}/schedules/:id/employees`, { module: 'Seat Allotment', action: 'ASSIGN', title: 'Added employees to schedule', entity: 'Schedule', emp: ['body.employeeIds', 'body.employees'] });
add('PUT', `${PS}/schedules/:id/employees`, { module: 'Seat Allotment', action: 'UPDATE', title: 'Updated schedule employees', entity: 'Schedule', emp: ['body.employeeIds', 'body.employees'] });
add('DELETE', `${PS}/schedules/:id/employees/:employeeId`, { module: 'Seat Allotment', action: 'UNASSIGN', title: 'Removed employee from schedule', entity: 'Schedule', emp: ['params.employeeId'] });

// ── Projects / teams / team leads / tasks ──────────────────────────────────
const PM = '/api/projects';
add('POST', `${PM}/projects`, { module: 'Projects', action: 'CREATE', title: 'Created project', entity: 'Project' });
add('PUT', `${PM}/projects/:id`, { module: 'Projects', action: 'UPDATE', title: 'Updated project', entity: 'Project' });
add('DELETE', `${PM}/projects/:id/harddelete`, { module: 'Projects', action: 'DELETE', title: 'Permanently deleted project', entity: 'Project' });
add('DELETE', `${PM}/projects/:id`, { module: 'Projects', action: 'DELETE', title: 'Deleted project', entity: 'Project' });
add('PATCH', `${PM}/projects/:id/restore`, { module: 'Projects', action: 'RESTORE', title: 'Restored project', entity: 'Project' });

add('POST', `${PM}/teams`, { module: 'Teams', action: 'CREATE', title: 'Created team', entity: 'Team' });
add('PUT', `${PM}/teams/:id`, { module: 'Teams', action: 'UPDATE', title: 'Updated team', entity: 'Team' });
add('DELETE', `${PM}/teams/:id/harddelete`, { module: 'Teams', action: 'DELETE', title: 'Permanently deleted team', entity: 'Team' });
add('DELETE', `${PM}/teams/:id`, { module: 'Teams', action: 'DELETE', title: 'Deleted team', entity: 'Team' });
add('PATCH', `${PM}/teams/:id/restore`, { module: 'Teams', action: 'RESTORE', title: 'Restored team', entity: 'Team' });

add('POST', `${PM}/tl/assign`, { module: 'Team Leads', action: 'ASSIGN', title: 'Assigned team lead role', entity: 'Employee', emp: ['body.employeeId', 'body.employeeIds'] });
add('POST', `${PM}/tl/remove`, { module: 'Team Leads', action: 'UNASSIGN', title: 'Removed team lead role', entity: 'Employee', emp: ['body.employeeId'] });

add('POST', `${PM}/tasks`, { module: 'Tasks', action: 'CREATE', title: 'Created task', entity: 'Task' });
add('PUT', `${PM}/tasks/update/:id`, { module: 'Tasks', action: 'UPDATE', title: 'Updated task', entity: 'Task' });
add('DELETE', `${PM}/tasks/delete/:id`, { module: 'Tasks', action: 'DELETE', title: 'Deleted task', entity: 'Task' });
add('PATCH', `${PM}/tasks/:id/review`, {
    module: 'Tasks',
    action: (c) => (c.body?.action === 'completed' ? 'APPROVE' : c.body?.action === 'revoked' ? 'REVOKE' : 'REVIEW'),
    title: (c) => ({
        completed: 'Marked task as completed',
        need_correction: 'Sent task back for correction',
        revoked: 'Revoked task',
        incomplete: 'Marked task as incomplete',
    }[c.body?.action] || 'Reviewed task'),
    entity: 'Task', note: (c) => (c.body?.reason ? `Reason: ${quote(c.body.reason)}` : ''),
});
add('POST', `${PM}/tl/tasks/assign`, { module: 'Tasks', action: 'CREATE', title: 'Team lead created task', entity: 'Task' });
add('PUT', `${PM}/tl/tasks/update/:id`, { module: 'Tasks', action: 'UPDATE', title: 'Team lead updated task', entity: 'Task' });
add('DELETE', `${PM}/tl/tasks/delete/:id`, { module: 'Tasks', action: 'DELETE', title: 'Team lead deleted task', entity: 'Task' });
add('PATCH', `${PM}/tl/tasks/:id/review`, {
    module: 'Tasks',
    action: (c) => (c.body?.action === 'completed' ? 'APPROVE' : c.body?.action === 'revoked' ? 'REVOKE' : 'REVIEW'),
    title: (c) => ({
        completed: 'Marked task as completed',
        need_correction: 'Sent task back for correction',
        revoked: 'Revoked task',
        incomplete: 'Marked task as incomplete',
    }[c.body?.action] || 'Reviewed task'),
    entity: 'Task', note: (c) => (c.body?.reason ? `Reason: ${quote(c.body.reason)}` : ''),
});
add('GET', `${PM}/tasks/report/export`, { module: 'Tasks', action: 'EXPORT', title: 'Exported task report', read: true });
add('GET', `${PM}/tasks/performance/export`, { module: 'Tasks', action: 'EXPORT', title: 'Exported performance report', read: true });

// ── Requests that are never logged (high-volume, no business meaning) ─────
const IGNORED = [/^\/api\/notifications(\/|$)/];

export const isIgnoredPath = (path) => IGNORED.some((re) => re.test(path));

// ── Lookup ─────────────────────────────────────────────────────────────────
export const matchRule = (method, path) => {
    const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
    for (const rule of RULES) {
        if (rule.method !== method) continue;
        const m = rule.re.exec(clean);
        if (m) return { rule, params: { ...(m.groups || {}) } };
    }
    return null;
};

/** True for GET requests that are worth logging (downloads, previews, exports). */
export const isTrackedRead = (path) => Boolean(matchRule('GET', path)?.rule.read);

// ── Generic fallback for any mutating endpoint not in the catalog ──────────
const SEGMENT_MODULE = {
    employees: 'Employees', documents: 'Documents', 'identity-cards': 'Identity Cards',
    tickets: 'Tickets', assets: 'Assets', leaves: 'Leave Management', leavepolicy: 'Leave Policy',
    holidays: 'Holidays', permissions: 'Permissions', 'data-updates': 'Data Update Access', 'office-timing': 'Office Timings',
    'break-policy': 'Break Policy', salaryviolations: 'Salary Policy', payslips: 'Payroll',
    announcements: 'Announcements',
    'phases-schedules': 'Seat Allotment', projects: 'Projects',
    employer: 'Staff Users',
};

export const fallbackRule = (method, path) => {
    const seg = path.split('/').filter(Boolean)[1] || 'other';
    const action = method === 'DELETE' ? 'DELETE' : method === 'POST' ? 'CREATE' : 'UPDATE';
    const verb = { CREATE: 'Created / submitted', UPDATE: 'Updated', DELETE: 'Deleted' }[action];
    const area = (SEGMENT_MODULE[seg] || 'Other');
    return { module: area, action, title: `${verb} data in ${area}` };
};

export const resolve = (def, ctx) => (typeof def === 'function' ? def(ctx) : def);
