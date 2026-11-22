/**
 * EDITABLE FIELD CATALOG
 * ----------------------
 * Every employee-form field HR / Admin can "open for editing" for employees.
 * One source of truth used by:
 *   • HR picker           – GET /api/data-updates/fields
 *   • Employee tab        – renders inputs from the same metadata
 *   • Submit validation   – validateGrantValues()
 *
 * key      – dot path on the Employee document (e.g. "address.city")
 * type     – text | number | date | select | boolean | tags | list
 * HR-only data (annual salary, department, designation, official e-mail, DOJ …)
 * is intentionally NOT in this catalog. The salary ACCOUNT bank details are
 * included so HR can ask employees to fill them in.
 */

const CURRENT_YEAR = new Date().getFullYear();

const MOBILE = { pattern: /^[6-9]\d{9}$/, message: 'must be a valid 10-digit mobile number' };

const f = (key, label, section, type = 'text', extra = {}) => ({ key, label, section, type, ...extra });

const GENDERS = ['Male', 'Female', 'Other'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];

const eduSchool = (std, label) => [
    f(`education.${std}.schoolName`, `${label} – School name`, 'Education', 'text', { min: 2, max: 150 }),
    f(`education.${std}.board`, `${label} – Board`, 'Education', 'text', { min: 2, max: 100 }),
    f(`education.${std}.year`, `${label} – Year of passing`, 'Education', 'number', { integer: true, min: 1950, max: CURRENT_YEAR + 1 }),
    f(`education.${std}.percentage`, `${label} – Percentage`, 'Education', 'number', { min: 0, max: 100 }),
];

const H = 'education.higherEducation';

export const FIELD_CATALOG = [
    // ── Personal ───────────────────────────────────────────────────────────
    f('firstName', 'First name', 'Personal', 'text', { min: 2, max: 50 }),
    f('lastName', 'Last name', 'Personal', 'text', { min: 1, max: 50 }),
    f('nameAsPerAadhaar', 'Name as per Aadhaar', 'Personal', 'text', { min: 2, max: 100 }),
    f('gender', 'Gender', 'Personal', 'select', { options: GENDERS }),
    f('dateOfBirth', 'Date of birth', 'Personal', 'date', { past: true }),
    f('bloodGroup', 'Blood group', 'Personal', 'select', { options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] }),
    f('maritalStatus', 'Marital status', 'Personal', 'select', { options: MARITAL }),
    f('spouseName', 'Spouse name', 'Personal', 'text', { min: 2, max: 100 }),
    f('spouseDateOfBirth', 'Spouse date of birth', 'Personal', 'date', { past: true }),
    f('spouseOccupation', 'Spouse occupation', 'Personal', 'text', { min: 2, max: 100 }),
    f('nationality', 'Nationality', 'Personal', 'text', { min: 2, max: 60 }),
    f('motherTongue', 'Mother tongue', 'Personal', 'text', { min: 2, max: 60 }),
    f('languagesKnown', 'Languages known', 'Personal', 'tags'),
    f('placeOfBirth', 'Place of birth', 'Personal', 'text', { min: 2, max: 100 }),
    f('physicallyDisabled', 'Physically disabled', 'Personal', 'boolean'),
    f('disabilityType', 'Disability type', 'Personal', 'text', { min: 2, max: 100 }),

    // ── Contact & ID ───────────────────────────────────────────────────────
    f('personalEmail', 'Personal e-mail', 'Contact & ID', 'email'),
    f('personalMobile', 'Personal mobile', 'Contact & ID', 'text', MOBILE),
    f('alternateMobile', 'Alternate mobile', 'Contact & ID', 'text', MOBILE),
    f('whatsappNumber', 'WhatsApp number', 'Contact & ID', 'text', { ...MOBILE }),
    f('aadhaarNumber', 'Aadhaar number', 'Contact & ID', 'text', { pattern: /^\d{12}$/, message: 'must be a 12-digit Aadhaar number', strip: /\s/g }),
    f('panNumber', 'PAN number', 'Contact & ID', 'text', { pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: 'must be a valid PAN (e.g. ABCDE1234F)', upper: true }),
    f('passportNumber', 'Passport number', 'Contact & ID', 'text', { min: 6, max: 15, upper: true }),
    f('drivingLicenseAvailable', 'Driving license available', 'Contact & ID', 'boolean'),
    f('drivingLicenseNumber', 'Driving license number', 'Contact & ID', 'text', { min: 5, max: 25, upper: true }),

    // ── Current address ────────────────────────────────────────────────────
    f('address.currentAddressLine1', 'Address line 1', 'Current address', 'text', { min: 3, max: 200 }),
    f('address.currentAddressLine2', 'Address line 2', 'Current address', 'text', { min: 2, max: 200 }),
    f('address.city', 'City', 'Current address', 'text', { min: 2, max: 80 }),
    f('address.district', 'District', 'Current address', 'text', { min: 2, max: 80 }),
    f('address.state', 'State', 'Current address', 'text', { min: 2, max: 80 }),
    f('address.country', 'Country', 'Current address', 'text', { min: 2, max: 80 }),
    f('address.pincode', 'Pincode', 'Current address', 'number', { integer: true, min: 100000, max: 999999, message: 'must be a 6-digit pincode' }),
    f('address.landmark', 'Landmark', 'Current address', 'text', { min: 2, max: 120 }),
    f('address.residenceType', 'Residence type', 'Current address', 'select', { options: ['Owned', 'Rented', 'Other'] }),
    f('address.stayingSince', 'Staying here since', 'Current address', 'date', { past: true }),

    // ── Permanent address ──────────────────────────────────────────────────
    f('address.permanentAddressSameAsCurrent', 'Permanent address same as current', 'Permanent address', 'boolean'),
    f('address.permanentAddressLine1', 'Address line 1', 'Permanent address', 'text', { min: 3, max: 200 }),
    f('address.permanentAddressLine2', 'Address line 2', 'Permanent address', 'text', { min: 2, max: 200 }),
    f('address.permanentCity', 'City', 'Permanent address', 'text', { min: 2, max: 80 }),
    f('address.permanentDistrict', 'District', 'Permanent address', 'text', { min: 2, max: 80 }),
    f('address.permanentState', 'State', 'Permanent address', 'text', { min: 2, max: 80 }),
    f('address.permanentCountry', 'Country', 'Permanent address', 'text', { min: 2, max: 80 }),
    f('address.permanentPincode', 'Pincode', 'Permanent address', 'number', { integer: true, min: 100000, max: 999999, message: 'must be a 6-digit pincode' }),

    // ── Emergency contact ──────────────────────────────────────────────────
    f('emergencyContact.name', 'Contact name', 'Emergency contact', 'text', { min: 2, max: 100 }),
    f('emergencyContact.relationship', 'Relationship', 'Emergency contact', 'text', { min: 2, max: 60 }),
    f('emergencyContact.mobileNumber', 'Contact mobile', 'Emergency contact', 'text', MOBILE),
    f('emergencyContact.address', 'Contact address', 'Emergency contact', 'text', { min: 3, max: 200 }),

    // ── Family ─────────────────────────────────────────────────────────────
    f('fatherName', "Father's name", 'Family', 'text', { min: 2, max: 100 }),
    f('fatherDateOfBirth', "Father's date of birth", 'Family', 'date', { past: true }),
    f('fatherOccupation', "Father's occupation", 'Family', 'text', { min: 2, max: 100 }),
    f('fatherMobile', "Father's mobile", 'Family', 'text', MOBILE),
    f('motherName', "Mother's name", 'Family', 'text', { min: 2, max: 100 }),
    f('motherDateOfBirth', "Mother's date of birth", 'Family', 'date', { past: true }),
    f('motherOccupation', "Mother's occupation", 'Family', 'text', { min: 2, max: 100 }),
    f('motherMobile', "Mother's mobile", 'Family', 'text', MOBILE),
    f('hasSiblings', 'Has siblings', 'Family', 'boolean'),
    f('numberOfBrothers', 'Number of brothers', 'Family', 'number', { integer: true, min: 0, max: 20 }),
    f('numberOfSisters', 'Number of sisters', 'Family', 'number', { integer: true, min: 0, max: 20 }),
    f('siblings', 'Sibling details', 'Family', 'list', {
        itemLabel: 'Sibling',
        itemFields: [
            f('siblingName', 'Name', '', 'text', { min: 2, max: 100 }),
            f('relationship', 'Relationship', '', 'select', { options: ['Brother', 'Sister'] }),
            f('gender', 'Gender', '', 'select', { options: GENDERS }),
            f('dateOfBirth', 'Date of birth', '', 'date', { past: true }),
            f('maritalStatus', 'Marital status', '', 'select', { options: MARITAL }),
            f('education', 'Education', '', 'text', { min: 2, max: 100, optional: true }),
            f('occupation', 'Occupation', '', 'text', { min: 2, max: 100, optional: true }),
            f('companyName', 'Company name', '', 'text', { min: 2, max: 100, optional: true }),
            f('mobileNumber', 'Mobile', '', 'text', { ...MOBILE, optional: true }),
        ],
    }),

    // ── Education ──────────────────────────────────────────────────────────
    ...eduSchool('tenthStandard', '10th'),
    ...eduSchool('eleventhStandard', '11th'),
    ...eduSchool('twelfthStandard', '12th'),
    f(`${H}.highestQualification`, 'Highest qualification', 'Education', 'text', { min: 2, max: 100 }),
    f(`${H}.diplomaCompleted`, 'Diploma completed', 'Education', 'boolean'),
    f(`${H}.diplomaCourse`, 'Diploma – Course', 'Education', 'text', { min: 2, max: 100 }),
    f(`${H}.diplomaPercentage`, 'Diploma – Percentage', 'Education', 'number', { min: 0, max: 100 }),
    f(`${H}.diplomaGraduationYear`, 'Diploma – Year of passing', 'Education', 'number', { integer: true, min: 1950, max: CURRENT_YEAR + 1 }),
    f(`${H}.diplomaInstitution`, 'Diploma – Institution', 'Education', 'text', { min: 2, max: 150 }),
    f(`${H}.graduationCompleted`, 'Graduation completed', 'Education', 'boolean'),
    f(`${H}.degree`, 'Graduation – Degree', 'Education', 'text', { min: 2, max: 100 }),
    f(`${H}.graduationYear`, 'Graduation – Year of passing', 'Education', 'number', { integer: true, min: 1950, max: CURRENT_YEAR + 1 }),
    f(`${H}.percentage`, 'Graduation – Percentage', 'Education', 'number', { min: 0, max: 100 }),
    f(`${H}.college`, 'Graduation – College', 'Education', 'text', { min: 2, max: 150 }),
    f(`${H}.university`, 'Graduation – University', 'Education', 'text', { min: 2, max: 150 }),
    f(`${H}.postGraduationCompleted`, 'Post-graduation completed', 'Education', 'boolean'),
    f(`${H}.pgDegree`, 'Post-graduation – Degree', 'Education', 'text', { min: 2, max: 100 }),
    f(`${H}.pgPercentage`, 'Post-graduation – Percentage', 'Education', 'number', { min: 0, max: 100 }),
    f(`${H}.pgGraduationYear`, 'Post-graduation – Year of passing', 'Education', 'number', { integer: true, min: 1950, max: CURRENT_YEAR + 1 }),
    f(`${H}.pgCollege`, 'Post-graduation – College', 'Education', 'text', { min: 2, max: 150 }),
    f(`${H}.pgUniversity`, 'Post-graduation – University', 'Education', 'text', { min: 2, max: 150 }),
    f(`${H}.certificationsAvailable`, 'Certifications available', 'Education', 'boolean'),
    f(`${H}.certificationDetails`, 'Certification details', 'Education', 'text', { min: 2, max: 300 }),

    // ── Employment history ─────────────────────────────────────────────────
    f('employmentType', 'Employment type', 'Employment history', 'select', { options: ['Fresher', 'Experienced'] }),
    f('totalExperience', 'Total experience (years)', 'Employment history', 'number', { min: 0, max: 60 }),
    f('previousEmployers', 'Previous employers', 'Employment history', 'list', {
        itemLabel: 'Employer',
        itemFields: [
            f('companyName', 'Company name', '', 'text', { min: 2, max: 150 }),
            f('designation', 'Designation', '', 'text', { min: 2, max: 100 }),
            f('startDate', 'Start date', '', 'date', { past: true }),
            f('endDate', 'End date', '', 'date', { past: true }),
        ],
    }),

    // ── Personal bank details (the employee's own account) ──────────────────
    f('bankDetails.bankName', 'Bank name', 'Bank details', 'text', { min: 2, max: 100 }),
    f('bankDetails.accountNumber', 'Account number', 'Bank details', 'text', { pattern: /^\d{6,20}$/, message: 'must be 6–20 digits', strip: /\s/g }),
    f('bankDetails.branchName', 'Branch name', 'Bank details', 'text', { min: 2, max: 100 }),
    f('bankDetails.nameInBankAccount', 'Name in bank account', 'Bank details', 'text', { min: 2, max: 100 }),
    f('bankDetails.ifscCode', 'IFSC code', 'Bank details', 'text', { pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: 'must be a valid IFSC code', upper: true }),
    f('bankDetails.pfApplicable', 'PF applicable', 'Bank details', 'boolean'),
    f('bankDetails.uanNumber', 'UAN number', 'Bank details', 'text', { pattern: /^\d{12}$/, message: 'must be a 12-digit UAN', strip: /\s/g }),

    // ── Salary account (where salary is credited). Normally HR-only; employees can
    //    fill it only when HR opens these fields for them here. ───────────────
    f('salaryAccountDetails.bankName', 'Bank name', 'Salary account details', 'text', { min: 2, max: 100 }),
    f('salaryAccountDetails.accountNumber', 'Account number', 'Salary account details', 'text', { pattern: /^\d{6,20}$/, message: 'must be 6–20 digits', strip: /\s/g }),
    f('salaryAccountDetails.branchName', 'Branch name', 'Salary account details', 'text', { min: 2, max: 100 }),
    f('salaryAccountDetails.nameInBankAccount', 'Name in bank account', 'Salary account details', 'text', { min: 2, max: 100 }),
    f('salaryAccountDetails.ifscCode', 'IFSC code', 'Salary account details', 'text', { pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: 'must be a valid IFSC code', upper: true }),
];

export const FIELD_MAP = new Map(FIELD_CATALOG.map((x) => [x.key, x]));

// ── Serialisation for the UI (RegExp → source string) ─────────────────────
const toPublic = (x) => {
    const { pattern, strip, itemFields, ...rest } = x;
    return {
        ...rest,
        ...(pattern ? { pattern: pattern.source } : {}),
        ...(strip ? { strip: true } : {}),
        ...(itemFields ? { itemFields: itemFields.map(toPublic) } : {}),
    };
};
export const publicField = (key) => (FIELD_MAP.has(key) ? toPublic(FIELD_MAP.get(key)) : null);
export const publicCatalog = () => FIELD_CATALOG.map(toPublic);

// ── Path helpers ──────────────────────────────────────────────────────────
export const getByPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const ymd = (d) => {
    if (!d) return '';
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
};

/** Current value of a field in the shape the UI expects (dates → YYYY-MM-DD) */
export const currentValueFor = (spec, employeeObj) => displayValue(spec, getByPath(employeeObj, spec.key));

/** Any stored / validated value → UI shape (dates → YYYY-MM-DD, lists → rows) */
export const displayValue = (spec, raw) => {
    if (spec.type === 'date') return ymd(raw);
    if (spec.type === 'list') {
        return (Array.isArray(raw) ? raw : []).map((row) => {
            const out = {};
            for (const sub of spec.itemFields) out[sub.key] = sub.type === 'date' ? ymd(row?.[sub.key]) : (row?.[sub.key] ?? '');
            return out;
        });
    }
    if (spec.type === 'tags') return Array.isArray(raw) ? raw : [];
    if (spec.type === 'boolean') return raw === true || raw === false ? raw : null;
    return raw ?? '';
};

// ── Validation ────────────────────────────────────────────────────────────
const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** → { ok:true, value } | { ok:false, error } */
export const validateValue = (spec, raw, { allowBlankOptional = false } = {}) => {
    const label = spec.label;
    if (isBlank(raw) && !(spec.type === 'boolean' && typeof raw === 'boolean')) {
        if (allowBlankOptional && spec.optional) return { ok: true, value: undefined };
        return { ok: false, error: `${label} is required` };
    }

    switch (spec.type) {
        case 'boolean': {
            if (raw === true || raw === 'true') return { ok: true, value: true };
            if (raw === false || raw === 'false') return { ok: true, value: false };
            return { ok: false, error: `${label} must be Yes or No` };
        }
        case 'number': {
            const n = Number(raw);
            if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
            if (spec.integer && !Number.isInteger(n)) return { ok: false, error: `${label} must be a whole number` };
            if (spec.min !== undefined && n < spec.min) return { ok: false, error: spec.message ? `${label} ${spec.message}` : `${label} must be at least ${spec.min}` };
            if (spec.max !== undefined && n > spec.max) return { ok: false, error: spec.message ? `${label} ${spec.message}` : `${label} cannot exceed ${spec.max}` };
            return { ok: true, value: n };
        }
        case 'date': {
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) return { ok: false, error: `${label} must be a valid date` };
            if (spec.past && d.getTime() > Date.now()) return { ok: false, error: `${label} cannot be in the future` };
            if (d.getFullYear() < 1900) return { ok: false, error: `${label} is not a valid date` };
            return { ok: true, value: d };
        }
        case 'select': {
            const v = String(raw).trim();
            if (!spec.options.includes(v)) return { ok: false, error: `${label} must be one of: ${spec.options.join(', ')}` };
            return { ok: true, value: v };
        }
        case 'email': {
            const v = String(raw).trim().toLowerCase();
            if (!/^\S+@\S+\.\S+$/.test(v)) return { ok: false, error: `${label} must be a valid e-mail` };
            return { ok: true, value: v };
        }
        case 'tags': {
            const arr = (Array.isArray(raw) ? raw : String(raw).split(','))
                .map((s) => String(s).trim()).filter(Boolean);
            if (!arr.length) return { ok: false, error: `${label} needs at least one entry` };
            if (arr.length > 20 || arr.some((s) => s.length > 40)) return { ok: false, error: `${label} has too many / too long entries` };
            return { ok: true, value: [...new Set(arr)] };
        }
        case 'list': {
            if (!Array.isArray(raw)) return { ok: false, error: `${label} must be a list` };
            if (raw.length > 30) return { ok: false, error: `${label} has too many rows` };
            const rows = [];
            for (let i = 0; i < raw.length; i++) {
                const row = {};
                for (const sub of spec.itemFields) {
                    const r = validateValue(sub, raw[i]?.[sub.key], { allowBlankOptional: true });
                    if (!r.ok) return { ok: false, error: `${spec.itemLabel || 'Row'} ${i + 1}: ${r.error}` };
                    if (r.value !== undefined) row[sub.key] = r.value;
                }
                if (spec.key === 'previousEmployers' && row.startDate && row.endDate && row.endDate < row.startDate) {
                    return { ok: false, error: `${spec.itemLabel} ${i + 1}: End date cannot be before start date` };
                }
                rows.push(row);
            }
            return { ok: true, value: rows };
        }
        default: {
            // text
            let v = String(raw);
            if (spec.strip) v = v.replace(spec.strip, '');
            v = v.trim();
            if (spec.upper) v = v.toUpperCase();
            if (spec.pattern && !spec.pattern.test(v)) return { ok: false, error: `${label} ${spec.message || 'is invalid'}` };
            if (spec.min !== undefined && v.length < spec.min) return { ok: false, error: `${label} must be at least ${spec.min} character${spec.min > 1 ? 's' : ''}` };
            if (spec.max !== undefined && v.length > spec.max) return { ok: false, error: `${label} cannot exceed ${spec.max} characters` };
            return { ok: true, value: v };
        }
    }
};

/**
 * Validates the values an employee submitted for a grant.
 * Every granted field is MANDATORY.
 * → { ok:true, values:{key:cleanValue} } | { ok:false, errors:{key:message} }
 */
export const validateGrantValues = (fields, submitted) => {
    const values = {};
    const errors = {};
    for (const key of fields) {
        const spec = FIELD_MAP.get(key);
        if (!spec) { errors[key] = 'Field is not editable'; continue; }
        const sub = submitted?.[key];
        // an empty list is a valid answer ("no siblings"); every row must be complete
        const r = validateValue(spec, sub);
        if (r.ok) values[key] = r.value; else errors[key] = r.error;
    }
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
};
