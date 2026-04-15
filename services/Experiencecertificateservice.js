// services/experienceCertificateService.js

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function addLetterheadToPage(doc, letterheadPath) {
    if (fs.existsSync(letterheadPath)) {
        doc.image(letterheadPath, 0, 0, { width: 595.28, height: 841.89 });
    }
}

export const generateExperienceCertificate = (employee) => {
    return new Promise((resolve, reject) => {
        try {
            const letterheadPath = path.join(process.cwd(), 'public', 'letterhead.png');
            const signaturePath  = path.join(process.cwd(), 'public', 'HazeenaSignature.png');

            const doc = new PDFDocument({
                size: 'A4', margin: 50, bufferPages: true,
                info: {
                    Title:   `Experience Certificate - ${employee.fullName}`,
                    Author:  'KIAQ Technologies Pvt Ltd',
                    Subject: `Experience Certificate for ${employee.fullName}`,
                },
            });

            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const range = doc.bufferedPageRange();
                for (let i = range.start; i < range.start + range.count; i++) {
                    doc.switchToPage(i);
                    addLetterheadToPage(doc, letterheadPath);
                }
                resolve(Buffer.concat(buffers));
            });
            doc.on('error', reject);

            addLetterheadToPage(doc, letterheadPath);

            const leftMargin   = 70;
            const rightMargin  = 525;
            const topMargin    = 130;
            const contentWidth = rightMargin - leftMargin;

            const {
                fullName    = 'Employee Name',
                employeeId  = 'KXXXXXX',
                designation = 'Software Engineer',
                department  = 'Engineering',
                joiningDate = '01-Jan-2025',
                leavingDate = '31-Mar-2026',
                refNo       = 'K000000',
                letterDate  = '09th April 2026',
                hrName      = process.env.HR_NAME  || 'Hazeena Begum A',
                hrTitle     = process.env.HR_TITLE || 'SR Executive - Human Resource',
            } = employee;

            const firstName = fullName.split(' ')[0];
            let currentY = topMargin;

            // Ref + date
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
                .text(`HR/Experience Certificate/${refNo}`, leftMargin, currentY);
            currentY = doc.y + 4;
            doc.font('Helvetica').text(letterDate, leftMargin, currentY);
            currentY = doc.y + 16;

            // Employee meta
            doc.font('Helvetica')
                .text('Name: ', leftMargin, currentY, { continued: true })
                .font('Helvetica-Bold').text(fullName);
            currentY = doc.y + 4;
            doc.font('Helvetica')
                .text('Employee ID: ', leftMargin, currentY, { continued: true })
                .font('Helvetica-Bold').text(employeeId);
            currentY = doc.y + 16;

            // Subject
            doc.font('Helvetica-Bold').fontSize(10.5)
                .text('Subject: Experience Certificate', leftMargin, currentY, { width: contentWidth });
            currentY = doc.y + 12;

            // Salutation
            doc.font('Helvetica').fontSize(10)
                .text('To Whom It May Concern,', leftMargin, currentY);
            currentY = doc.y + 12;

            // Body para 1
            doc.font('Helvetica')
                .text('This is to certify that ', leftMargin, currentY, { continued: true, width: contentWidth })
                .font('Helvetica-Bold').text(fullName, { continued: true })
                .font('Helvetica').text(' was employed with ', { continued: true })
                .font('Helvetica-Bold').text('Kiaq Technologies Private Limited', { continued: true })
                .font('Helvetica').text(' from ', { continued: true })
                .font('Helvetica-Bold').text(joiningDate, { continued: true })
                .font('Helvetica').text(' to ', { continued: true })
                .font('Helvetica-Bold').text(leavingDate, { continued: true })
                .font('Helvetica').text(' in the capacity of ', { continued: true })
                .font('Helvetica-Bold').text(designation, { continued: true })
                .font('Helvetica').text(' in the ', { continued: true })
                .font('Helvetica-Bold').text(department, { continued: true })
                .font('Helvetica').text(' department.', { width: contentWidth, align: 'justify' });
            currentY = doc.y + 12;

            // Body para 2
            doc.font('Helvetica')
                .text(
                    `During the period of employment, ${firstName} demonstrated a high level of ` +
                    `professionalism, technical competence, and commitment. ` +
                    `${firstName} was a dedicated team member and contributed positively to the ` +
                    `growth and objectives of the organisation.`,
                    leftMargin, currentY, { width: contentWidth, align: 'justify' }
                );
            currentY = doc.y + 12;

            // Body para 3
            doc.font('Helvetica')
                .text(`We wish ${firstName} all the best in future endeavours.`, leftMargin, currentY, { width: contentWidth });
            currentY = doc.y + 14;

            // Sign-off
            doc.text('Yours Sincerely', leftMargin, currentY);
            currentY = doc.y + 4;
            doc.font('Helvetica-Bold').text('For Kiaq Technologies Pvt Ltd,', leftMargin, currentY);
            currentY = doc.y + 8;

            // ── Signature image ──────────────────────────────────────────────
            if (fs.existsSync(signaturePath)) {
                doc.image(signaturePath, leftMargin, currentY, { width: 110, height: 45 });
                currentY += 52;
            } else {
                currentY += 44;
            }

            // Signatory name + title
            doc.font('Helvetica').fontSize(10).fillColor('#000000')
                .text(hrName, leftMargin, currentY);
            currentY = doc.y + 2;
            doc.fontSize(8.5).fillColor('#555555').text(hrTitle, leftMargin, currentY);

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};