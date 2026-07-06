import mongoose from 'mongoose';
import Employee from '../model/Employee.js';
import Document from '../model/Document.js';
import { s3, S3_BUCKET, getS3ServerDate } from '../config/s3.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { idCardReportQuerySchema } from '../validations/identityCardValidation.js';


import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const MM_TO_PT = 2.83465;
const CARD_W = Math.round(53.98 * MM_TO_PT); // ~153pt
const CARD_H = Math.round(85.6 * MM_TO_PT);  // ~243pt

const PDF_NAVY = '#1E2A3A';
const PDF_RED = '#D3462F';
const PRINT_COMPANY_NAME = 'KIAQ Technologies Pvt. Ltd.';
const PRINT_COMPANY_EMAIL = 'info@kiaq.in';
const PRINT_COMPANY_WEBSITE = 'www.kiaq.in';
const PRINT_COMPANY_EMERGENCY_NO = '+91 89259 21401';
const PRINT_COMPANY_ADDRESS = [
    'M181, Cactus Corporate,',
    'G Floor, Block B, Tecci Park,',
    'OMR, Sholinganallur,',
    'Chennai 600 119.',
];

const requireHrOrAdmin = (req, res) => {
    if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
        res.status(403).json({
            success: false,
            message: 'Only ADMIN or HR can access identity card management'
        });
        return false;
    }
    return true;
};

const getSignedPhotoUrl = async (fileKey) => {
    if (!fileKey) return null;

    let key = fileKey;
    if (key.includes(`${S3_BUCKET}/`)) {
        key = key.replace(`${S3_BUCKET}/`, '');
    }
    if (key.includes('?')) {
        key = key.split('?')[0];
    }

    const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ResponseContentDisposition: 'inline',
    });

    const signingDate = await getS3ServerDate();

    return getSignedUrl(s3, command, { expiresIn: 60 * 5, signingDate });
};


const s3ObjectToBuffer = async (fileKey) => {
    let key = fileKey;
    if (key.includes(`${S3_BUCKET}/`)) key = key.replace(`${S3_BUCKET}/`, '');
    if (key.includes('?')) key = key.split('?')[0];

    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const response = await s3.send(command);
    const chunks = [];
    for await (const chunk of response.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
};

// Approximates the on-screen CardWave SVG using PDFKit bezier paths
const drawWaveBand = (doc, x, y, width, height, flip = false) => {
    doc.save();
    if (flip) {
        doc.translate(x, y + height).scale(1, -1);
    } else {
        doc.translate(x, y);
    }
    doc.moveTo(0, 0).lineTo(width, 0).lineTo(width, height * 0.3)
        .bezierCurveTo(width * 0.8, height, width * 0.65, 0, width * 0.5, height * 0.5)
        .bezierCurveTo(width * 0.35, height, width * 0.2, height * 0.2, 0, height * 0.6)
        .closePath()
        .fill(PDF_NAVY);
    doc.fillOpacity(0.85);
    doc.moveTo(0, height * 0.35).lineTo(width, height * 0.2).lineTo(width, height * 0.3)
        .bezierCurveTo(width * 0.8, height, width * 0.65, 0, width * 0.5, height * 0.5)
        .bezierCurveTo(width * 0.35, height, width * 0.2, height * 0.2, 0, height * 0.6)
        .closePath()
        .fill(PDF_RED);
    doc.fillOpacity(1);
    doc.restore();
};


// GET /api/identity-cards
export const getEmployeesForIdCard = async (req, res) => {
    try {
        if (!requireHrOrAdmin(req, res)) return;

        const employees = await Employee.find({})
            .select('firstName lastName employeeId officialEmail designation department isActive idCard resignationDate relievingDate createdAt')
            .sort({ firstName: 1 });

        const employeeIds = employees.map(e => e._id);

        const documents = await Document.find({ employee: { $in: employeeIds } })
            .select('employee passportPhoto');

        const photoMap = new Map(
            documents.map(doc => [String(doc.employee), doc.passportPhoto])
        );

        const data = await Promise.all(employees.map(async (emp) => {
            const photo = photoMap.get(String(emp._id));
            const isCardExpired = emp.idCard?.status === 'active' ? !emp.isActive : emp.idCard?.status === 'expired';

            // Only sign a photo URL when the card is actually generated & valid —
            // avoids signing 30+ S3 URLs on every list load for cards nobody's viewing.
            const shouldShowPhoto = emp.idCard?.status === 'active' && !isCardExpired && photo?.fileKey;
            const photoUrl = shouldShowPhoto ? await getSignedPhotoUrl(photo.fileKey) : null;

            return {
                ...emp.toObject(),
                hasPassportPhoto: Boolean(photo?.fileKey),
                passportPhotoStatus: photo?.status || 'pending',
                isCardExpired,
                photoUrl
            };
        }));

        return res.status(200).json({
            success: true,
            message: 'Employees retrieved successfully',
            data: { employees: data, total: data.length }
        });
    } catch (error) {
        console.error('Get employees for ID card error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /api/identity-cards/:id/preview
export const previewIdCard = async (req, res) => {
    try {
        if (!requireHrOrAdmin(req, res)) return;

        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid employee ID format' });
        }

        const employee = await Employee.findById(id).select('-officialPassword');
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        const document = await Document.findOne({ employee: id }).select('passportPhoto');
        const photo = document?.passportPhoto;

        if (!photo?.fileKey) {
            return res.status(404).json({
                success: false,
                message: 'Employee has not uploaded a passport photo yet'
            });
        }

        const photoUrl = await getSignedPhotoUrl(photo.fileKey);

        return res.status(200).json({
            success: true,
            message: 'ID card preview data retrieved successfully',
            data: {
                employee: {
                    _id: employee._id,
                    employeeId: employee.employeeId,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    designation: employee.designation,
                    department: employee.department,
                    bloodGroup: employee.bloodGroup,
                    personalMobile: employee.personalMobile,
                    officialEmail: employee.officialEmail,
                    doj: employee.doj || employee.createdAt,
                    isActive: employee.isActive
                },
                idCard: employee.idCard,
                photoUrl,
                photoStatus: photo.status,
                isExpired: employee.idCard?.status === 'active' ? !employee.isActive : employee.idCard?.status === 'expired'
            }
        });
    } catch (error) {
        console.error('Preview ID card error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// POST /api/identity-cards/:id/generate
export const generateIdCard = async (req, res) => {
    try {
        if (!requireHrOrAdmin(req, res)) return;

        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid employee ID format' });
        }

        const employee = await Employee.findById(id);
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        if (!employee.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Cannot generate an ID card for a resigned/inactive employee'
            });
        }

        const document = await Document.findOne({ employee: id }).select('passportPhoto');
        if (!document?.passportPhoto?.fileKey) {
            return res.status(400).json({
                success: false,
                message: 'Employee must upload a passport photo before an ID card can be generated'
            });
        }

        const idCardNumber = `${process.env.COMPANY_SHORT_CODE || 'EMP'}/ID/${employee.employeeId}`;
        const verificationToken = crypto.randomBytes(16).toString('hex');

        employee.idCard = {
            status: 'active',
            idCardNumber,
            verificationToken,
            issuedAt: new Date(),
            expiredAt: null,
            issuedBy: {
                userId: req.user._id,
                userEmail: req.user.email
            }
        };

        await employee.save();

        return res.status(200).json({
            success: true,
            message: 'ID card generated successfully',
            data: { idCard: employee.idCard }
        });
    } catch (error) {
        console.error('Generate ID card error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// POST /api/identity-cards/:id/revoke
export const revokeIdCard = async (req, res) => {
    try {
        if (!requireHrOrAdmin(req, res)) return;

        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid employee ID format' });
        }

        const employee = await Employee.findById(id);
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        if (employee.idCard?.status !== 'active') {
            return res.status(400).json({ success: false, message: 'ID card is not currently active' });
        }

        employee.idCard.status = 'expired';
        employee.idCard.expiredAt = new Date();
        await employee.save();

        return res.status(200).json({
            success: true,
            message: 'ID card revoked successfully',
            data: { idCard: employee.idCard }
        });
    } catch (error) {
        console.error('Revoke ID card error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /api/identity-cards/me  (employee self-service)
export const getMyIdCard = async (req, res) => {
    try {
        const employee = await Employee.findById(req.user._id).select('-officialPassword');
        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        const document = await Document.findOne({ employee: req.user._id }).select('passportPhoto');
        const photo = document?.passportPhoto;
        const photoUrl = photo?.fileKey ? await getSignedPhotoUrl(photo.fileKey) : null;

        const isExpired =
            employee.idCard?.status === 'active' ? !employee.isActive : employee.idCard?.status === 'expired';

        return res.status(200).json({
            success: true,
            message: 'ID card retrieved successfully',
            data: {
                employee: {
                    _id: employee._id,
                    employeeId: employee.employeeId,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    designation: employee.designation,
                    department: employee.department,
                    bloodGroup: employee.bloodGroup,
                    officialEmail: employee.officialEmail,
                    doj: employee.doj || employee.createdAt,
                    isActive: employee.isActive
                },
                idCard: employee.idCard,
                photoUrl,
                hasPassportPhoto: Boolean(photo?.fileKey),
                passportPhotoStatus: photo?.status || 'pending',
                isExpired
            }
        });
    } catch (error) {
        console.error('Get my ID card error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};






const computeCardStatus = (emp) => {
    if (!emp.idCard || emp.idCard.status === 'not_generated') return 'not_generated';
    if (emp.idCard.status === 'active') return emp.isActive ? 'active' : 'expired';
    return 'expired';
};

const buildReportFilter = (query) => {
    const { error, value } = idCardReportQuerySchema.validate(query);
    if (error) return { error: error.details.map(d => d.message).join(', ') };

    const { startDate, endDate, status, department } = value;
    const filter = {};

    if (startDate || endDate) {
        filter.doj = {};
        if (startDate) filter.doj.$gte = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            filter.doj.$lte = end;
        }
    }

    if (department) {
        filter.department = { $regex: department, $options: 'i' };
    }

    return { filter, status };
};

const fetchReportRows = async (filter, status) => {
    const employees = await Employee.find(filter)
        .select('firstName lastName employeeId officialEmail personalMobile designation department doj isActive idCard bloodGroup createdAt')
        .sort({ doj: 1 });

    const employeeIds = employees.map(e => e._id);
    const documents = await Document.find({ employee: { $in: employeeIds } }).select('employee passportPhoto');
    const photoMap = new Map(documents.map(d => [String(d.employee), Boolean(d.passportPhoto?.fileKey)]));

    let rows = employees.map(emp => ({
        _id: emp._id,
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        officialEmail: emp.officialEmail,
        personalMobile: emp.personalMobile,
        designation: emp.designation,
        department: emp.department,
        bloodGroup: emp.bloodGroup,
        doj: emp.doj || emp.createdAt,
        isActive: emp.isActive,
        idCard: emp.idCard,
        hasPassportPhoto: photoMap.get(String(emp._id)) || false,
        cardStatus: computeCardStatus(emp)
    }));

    if (status && status !== 'all') {
        rows = rows.filter(r => r.cardStatus === status);
    }

    return rows;
};

// GET /api/identity-cards/report
export const getIdCardReport = async (req, res) => {
    try {
        if (!requireHrOrAdmin(req, res)) return;

        const { error, filter, status } = buildReportFilter(req.query);
        if (error) {
            return res.status(400).json({ success: false, message: 'Validation error', errors: [error] });
        }

        const rows = await fetchReportRows(filter, status);

        return res.status(200).json({
            success: true,
            message: 'ID card report retrieved successfully',
            data: { employees: rows, total: rows.length }
        });
    } catch (error) {
        console.error('Get ID card report error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// GET /api/identity-cards/report/export
export const exportIdCardReport = async (req, res) => {
    try {
        if (!requireHrOrAdmin(req, res)) return;

        const { error, filter, status } = buildReportFilter(req.query);
        if (error) {
            return res.status(400).json({ success: false, message: 'Validation error', errors: [error] });
        }

        const rows = await fetchReportRows(filter, status);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('ID Card Report');

        const columns = [
            { header: 'S.No', key: 'sno', width: 6 },
            { header: 'Employee ID', key: 'employeeId', width: 14 },
            { header: 'Name', key: 'name', width: 24 },
            { header: 'Designation', key: 'designation', width: 20 },
            { header: 'Department', key: 'department', width: 18 },
            { header: 'Date of Joining', key: 'doj', width: 16 },
            { header: 'Employee Status', key: 'employeeStatus', width: 16 },
            { header: 'Card Status', key: 'cardStatus', width: 16 },
            { header: 'Card Number', key: 'cardNumber', width: 20 },
            { header: 'Issued Date', key: 'issuedDate', width: 16 },
            { header: 'Photo On File', key: 'hasPhoto', width: 14 },
            { header: 'Official Email', key: 'email', width: 28 },
        ];

        sheet.columns = columns;
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

        rows.forEach((r, index) => {
            sheet.addRow({
                sno: index + 1,
                employeeId: r.employeeId,
                name: `${r.firstName} ${r.lastName}`,
                designation: r.designation || '-',
                department: r.department || '-',
                doj: r.doj ? new Date(r.doj).toLocaleDateString('en-GB') : '-',
                employeeStatus: r.isActive ? 'Active' : 'Resigned',
                cardStatus: r.cardStatus.replace('_', ' '),
                cardNumber: r.idCard?.idCardNumber || '-',
                issuedDate: r.idCard?.issuedAt ? new Date(r.idCard.issuedAt).toLocaleDateString('en-GB') : '-',
                hasPhoto: r.hasPassportPhoto ? 'Yes' : 'No',
                email: r.officialEmail,
            });
        });

        // Dynamic column widths based on content, floor set by header width above
        sheet.columns.forEach((col) => {
            let maxLen = col.header ? col.header.length : 10;
            col.eachCell?.({ includeEmpty: true }, (cell) => {
                const len = cell.value ? String(cell.value).length : 0;
                if (len > maxLen) maxLen = len;
            });
            col.width = Math.min(Math.max(maxLen + 2, col.width || 10), 40);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="ID_Card_Report_${Date.now()}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Export ID card report error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};




// GET /api/identity-cards/verify/:token  (PUBLIC — no auth, scanned via QR)
export const verifyIdCardByToken = async (req, res) => {
    try {
        const { token } = req.params;
        console.log('Verify lookup for token:', token);
        if (!token) {
            return res.status(400).json({ success: false, message: 'Verification token required' });
        }

        const employee = await Employee.findOne({ 'idCard.verificationToken': token })
            .select('firstName lastName employeeId designation department doj isActive idCard bloodGroup');

        if (!employee) {
            return res.status(404).json({ success: false, message: 'Invalid or unrecognized ID card' });
        }

        const document = await Document.findOne({ employee: employee._id }).select('passportPhoto');
        const photoUrl = document?.passportPhoto?.fileKey
            ? await getSignedPhotoUrl(document.passportPhoto.fileKey)
            : null;

        const isExpired =
            employee.idCard?.status === 'active' ? !employee.isActive : employee.idCard?.status !== 'active';

        // Deliberately minimal payload — no email, no phone, nothing beyond what
        // a security guard checking the card at a gate would need.
        return res.status(200).json({
            success: true,
            message: 'Card verified',
            data: {
                employeeId: employee.employeeId,
                firstName: employee.firstName,
                lastName: employee.lastName,
                designation: employee.designation,
                department: employee.department,
                bloodGroup: employee.bloodGroup,
                doj: employee.doj,
                photoUrl,
                idCardNumber: employee.idCard?.idCardNumber,
                issuedAt: employee.idCard?.issuedAt,
                isExpired,
                isEmployeeActive: employee.isActive
            }
        });
    } catch (error) {
        console.error('Verify ID card by token error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};







// GET /api/identity-cards/report/export-pdf
// Generates a print-ready multi-page PDF: front, back, front, back... at exact CR80 size.
export const exportIdCardsPdf = async (req, res) => {
    try {
        if (!requireHrOrAdmin(req, res)) return;

        const { error, filter, status } = buildReportFilter(req.query);
        if (error) {
            return res.status(400).json({ success: false, message: 'Validation error', errors: [error] });
        }

        let rows = await fetchReportRows(filter, status);

        // Explicit selection (from "Print Selected") overrides the date/status filter
        const { employeeIds } = req.query;
        if (employeeIds) {
            const idSet = new Set(String(employeeIds).split(',').map(s => s.trim()).filter(Boolean));
            rows = rows.filter(r => idSet.has(String(r._id)));
        }

        // Only cards that are actually issued, valid, and have a photo can be printed
        const printable = rows.filter(r => r.cardStatus === 'active' && r.hasPassportPhoto);

        if (printable.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No printable cards found. Cards must be Active with a passport photo on file.'
            });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="ID_Cards_Print_${Date.now()}.pdf"`);

        const doc = new PDFDocument({ size: [CARD_W, CARD_H], margin: 0, autoFirstPage: false });
        doc.pipe(res);

        const logoPath = path.join(__dirname, '../public/companylogo.png');
        const logoExists = fs.existsSync(logoPath);
        const verifyBase = process.env.ID_VERIFY_BASE_URL || '';

        const skipped = [];

        for (const row of printable) {
            const employee = await Employee.findById(row._id)
                .select('firstName lastName employeeId doj bloodGroup officialEmail personalMobile idCard');
            const document = await Document.findOne({ employee: row._id }).select('passportPhoto');

            let photoBuffer = null;
            try {
                photoBuffer = await s3ObjectToBuffer(document.passportPhoto.fileKey);
            } catch (e) {
                console.error(`Photo fetch failed for ${employee.employeeId}:`, e.message);
                skipped.push(employee.employeeId);
            }

            let qrBuffer = null;
            if (employee.idCard?.verificationToken) {
                qrBuffer = await QRCode.toBuffer(
                    `${verifyBase}/${employee.idCard.verificationToken}`,
                    { type: 'png', width: 300, margin: 1 }
                );
            }

            // ── FRONT ──────────────────────────────────────────────
            doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });

            if (logoExists) {
                doc.image(logoPath, CARD_W / 2 - 20, 8, { width: 40 });
            } else {
                doc.fontSize(8).fillColor(PDF_NAVY).font('Helvetica-Bold')
                    .text('KIAQ TECHNOLOGIES', 0, 14, { width: CARD_W, align: 'center' });
            }
            drawWaveBand(doc, 0, 30, CARD_W, 8);

            const photoSize = 95;
            const photoX = (CARD_W - photoSize) / 2;
            const photoY = 46;
            doc.save();
            doc.roundedRect(photoX, photoY, photoSize, photoSize, 6).clip();
            if (photoBuffer) {
                doc.image(photoBuffer, photoX, photoY, {
                    width: photoSize,
                    height: photoSize,
                    cover: [photoSize, photoSize],
                    align: 'center',
                    valign: 'center',
                });
            } else {
                doc.rect(photoX, photoY, photoSize, photoSize).fill('#f0f0f0');
            }
            doc.restore();
            doc.roundedRect(photoX, photoY, photoSize, photoSize, 6).lineWidth(0.5).stroke('#e0e0e0');

            doc.fontSize(10).fillColor('#111827').font('Helvetica-Bold')
                .text(`${employee.firstName} ${employee.lastName}`.toUpperCase(), 6, photoY + photoSize + 8, { width: CARD_W - 12, align: 'center' });

            doc.fontSize(6).fillColor('#4b5563').font('Helvetica')
                .text(employee.officialEmail || PRINT_COMPANY_EMAIL, 6, photoY + photoSize + 21, { width: CARD_W - 12, align: 'center' })
                .text(PRINT_COMPANY_WEBSITE, 6, photoY + photoSize + 31, { width: CARD_W - 12, align: 'center' });

            drawWaveBand(doc, 0, CARD_H - 38, CARD_W, 8, true);
            doc.fontSize(5).fillColor('#9ca3af')
                .text(employee.idCard?.idCardNumber || '-', 0, CARD_H - 12, { width: CARD_W, align: 'center' });

            // ── BACK ───────────────────────────────────────────────
            doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });
            drawWaveBand(doc, 0, 0, CARD_W, 8);

            let cursorY = 16;
            const fieldRow = (value) => {
                doc.fontSize(7).fillColor('#374151').font('Helvetica')
                    .text(value || '-', 10, cursorY, { width: CARD_W - 20 });
                doc.moveTo(10, cursorY + 10).lineTo(CARD_W - 10, cursorY + 10).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
                cursorY += 14;
            };
            fieldRow(employee.employeeId);
            fieldRow(employee.doj ? dayjs(employee.doj).format('DD/MM/YYYY') : null);
            fieldRow(employee.bloodGroup);

            cursorY += 4;
            doc.rect(10, cursorY, CARD_W - 20, 14).fill(PDF_NAVY);
            doc.fontSize(6).fillColor('#ffffff').font('Helvetica-Bold')
                .text(`EMERGENCY: ${employee.personalMobile || PRINT_COMPANY_EMERGENCY_NO}`, 10, cursorY + 4, { width: CARD_W - 20, align: 'center' });
            cursorY += 22;

            doc.fontSize(6).fillColor('#4b5563').font('Helvetica')
                .text(PRINT_COMPANY_EMAIL, 10, cursorY, { width: CARD_W - 20 });
            cursorY += 8;
            doc.text(PRINT_COMPANY_WEBSITE, 10, cursorY, { width: CARD_W - 20 });
            cursorY += 8;
            doc.fontSize(5.5).text(PRINT_COMPANY_ADDRESS.join('\n'), 10, cursorY, { width: CARD_W - 20 });
            cursorY += 28;

            if (qrBuffer) {
                const qrSize = 46;
                doc.image(qrBuffer, (CARD_W - qrSize) / 2, cursorY, { width: qrSize, height: qrSize });
                doc.fontSize(5).fillColor('#9ca3af')
                    .text('Scan to verify', 0, cursorY + qrSize + 3, { width: CARD_W, align: 'center' });
            }

            drawWaveBand(doc, 0, CARD_H - 8, CARD_W, 8, true);
        }

        doc.end();

        if (skipped.length) {
            console.warn(`ID card PDF export: photo fetch failed for ${skipped.join(', ')}`);
        }
    } catch (error) {
        console.error('Export ID cards PDF error:', error);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: 'Server error generating print PDF',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
        res.end();
    }
};