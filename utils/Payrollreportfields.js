// utils/payrollReportFields.js
//
// Single source of truth for payroll report fields. Both the field-picker UI
// and the Excel/PDF generators reference these keys so they never drift.
//
// Each field: { key, label, group, get(emp) }  where emp is a buildPayroll()
// per-employee object. `get` returns the display value (string/number).

const money = (n) => (n == null ? "" : Number(n).toFixed(2));

// Fields whose values should be summed in a totals row (money + day counts).
// `num(emp)` returns the raw number for totalling; display still uses `get`.
export const REPORT_FIELD_GROUPS = [
  {
    group: "Employee Information",
    fields: [
      { key: "employeeId",   label: "Employee ID",        get: (e) => e.employeeId },
      { key: "name",         label: "Employee Name",      get: (e) => e.name },
      { key: "designation",  label: "Designation",        get: (e) => e.designation },
      { key: "joiningDate",  label: "Date of Joining",    get: (e) => e.joiningDate },
      { key: "department",   label: "Department",         get: (e) => e.department },
      { key: "location",     label: "Location",           get: (e) => e.location },
      { key: "workedDays",   label: "Effective Work Days",get: (e) => e.pay?.workedDays, sum: true, num: (e) => e.pay?.workedDays ?? 0 },
    ],
  },
  {
    group: "Bank Details",
    fields: [
      { key: "bankName",      label: "Bank Name",      get: (e) => e.bankName },
      { key: "accountNumber", label: "Account Number", get: (e) => e.accountNumber },
      { key: "pan",           label: "PAN",            get: (e) => e.pan },
      { key: "uanNo",         label: "UAN No",         get: (e) => e.uanNo },
    ],
  },
  {
    group: "Earnings",
    fields: [
      { key: "basic",        label: "Basic",          get: (e) => money(e.pay?.proratedEarnings?.basic),       sum: true, num: (e) => e.pay?.proratedEarnings?.basic ?? 0 },
      { key: "hra",          label: "HRA",            get: (e) => money(e.pay?.proratedEarnings?.hra),         sum: true, num: (e) => e.pay?.proratedEarnings?.hra ?? 0 },
      { key: "conveyance",   label: "Conveyance",     get: (e) => money(e.pay?.proratedEarnings?.conveyance),  sum: true, num: (e) => e.pay?.proratedEarnings?.conveyance ?? 0 },
      { key: "medical",      label: "Medical",        get: (e) => money(e.pay?.proratedEarnings?.medical),     sum: true, num: (e) => e.pay?.proratedEarnings?.medical ?? 0 },
      { key: "lta",          label: "LTA",            get: (e) => money(e.pay?.proratedEarnings?.lta),         sum: true, num: (e) => e.pay?.proratedEarnings?.lta ?? 0 },
      { key: "performance",  label: "Performance",    get: (e) => money(e.pay?.proratedEarnings?.performance), sum: true, num: (e) => e.pay?.proratedEarnings?.performance ?? 0 },
      { key: "special",      label: "Special Allowance", get: (e) => money(e.pay?.proratedEarnings?.special),  sum: true, num: (e) => e.pay?.proratedEarnings?.special ?? 0 },
    ],
  },
  {
    group: "Deductions",
    fields: [
      { key: "pfEmployee",      label: "PF Employee",      get: (e) => money(e.pay?.deductions?.pfEmployee), sum: true, num: (e) => e.pay?.deductions?.pfEmployee ?? 0 },
      { key: "pfEmployer",      label: "PF Employer",      get: (e) => money(e.pay?.deductions?.pfEmployer), sum: true, num: (e) => e.pay?.deductions?.pfEmployer ?? 0 },
      { key: "gratuity",        label: "Gratuity",         get: (e) => money(e.pay?.deductions?.gratuity),   sum: true, num: (e) => e.pay?.deductions?.gratuity ?? 0 },
      { key: "totalDeduction",  label: "Total Deductions", get: (e) => money(e.pay?.totalDeduction),         sum: true, num: (e) => e.pay?.totalDeduction ?? 0 },
      { key: "lopDays",         label: "LOP",              get: (e) => e.pay?.lopDays,                        sum: true, num: (e) => e.pay?.lopDays ?? 0 },
    ],
  },
  {
    group: "Net Pay",
    fields: [
      { key: "netSalary",     label: "Net Pay for the Month", get: (e) => money(e.pay?.netSalary),            sum: true, num: (e) => e.pay?.netSalary ?? 0 },
      { key: "ctcMonthly",    label: "CTC",                   get: (e) => money(e.ctcMonthly),                sum: true, num: (e) => e.ctcMonthly ?? 0 },
      { key: "totalEarnings", label: "Total Earnings",        get: (e) => money(e.pay?.proratedTotalEarnings),sum: true, num: (e) => e.pay?.proratedTotalEarnings ?? 0 },
    ],
  },
];

// Flat lookup: key → field def
export const FIELD_MAP = {};
for (const g of REPORT_FIELD_GROUPS) for (const f of g.fields) FIELD_MAP[f.key] = { ...f, group: g.group };

// Resolve an ordered list of field defs from selected keys (preserves catalog order)
export function resolveFields(selectedKeys) {
  const set = new Set(selectedKeys);
  const out = [];
  for (const g of REPORT_FIELD_GROUPS) for (const f of g.fields) if (set.has(f.key)) out.push({ ...f, group: g.group });
  return out;
}