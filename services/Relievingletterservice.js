// services/relievingLetterService.js

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

export const generateRelievingLetter = (employee) => {
    return new Promise((resolve, reject) => {
        try {
            const letterheadPath = path.join(process.cwd(), 'public', 'letterhead.png');
            const signaturePath  = path.join(process.cwd(), 'public', 'HazeenaSignature.png');

            const doc = new PDFDocument({
                size: 'A4', margin: 50, bufferPages: true,
                info: {
                    Title:   `Relieving Letter - ${employee.fullName}`,
                    Author:  'KIAQ Technologies Pvt Ltd',
                    Subject: `Relieving Letter for ${employee.fullName}`,
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
                fullName        = 'Employee Name',
                employeeId      = 'KXXXXXX',
                designation     = 'Software Engineer',
                joiningDate     = '01-Jan-2025',
                leavingDate     = '31-Mar-2026',
                resignationDate = '01-Mar-2026',
                refNo           = 'K000000',
                letterDate      = '09th April 2026',
                hrName          = process.env.HR_NAME  || 'Hazeena Begum A',
                hrTitle         = process.env.HR_TITLE || 'SR Executive - Human Resource',
            } = employee;

            let currentY = topMargin;

            // Ref + date
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
                .text(`HR/Relieving Letter/${refNo}`, leftMargin, currentY);
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
                .text('Subject: Relieving Letter / Experience Certificate', leftMargin, currentY, { width: contentWidth });
            currentY = doc.y + 12;

            // Salutation
            doc.font('Helvetica').fontSize(10)
                .text(`Dear ${fullName},`, leftMargin, currentY);
            currentY = doc.y + 12;

            // Body para 1
            doc.font('Helvetica')
                .text('This is with reference to your resignation letter dated ', leftMargin, currentY, {
                    continued: true, width: contentWidth,
                })
                .font('Helvetica-Bold').text(resignationDate, { continued: true })
                .font('Helvetica').text(
                    '. We hereby accept your resignation from employment with the company and relieve you ' +
                    'of your duties and responsibilities from the closing hours on ', { continued: true }
                )
                .font('Helvetica-Bold').text(`${leavingDate}.`, { width: contentWidth, align: 'justify' });
            currentY = doc.y + 12;

            // Service record
            doc.font('Helvetica')
                .text('Your service record with the company is as follows:', leftMargin, currentY, { width: contentWidth });
            currentY = doc.y + 10;
            doc.font('Helvetica-Bold')
                .text(`Date of joining: ${joiningDate}`, leftMargin, currentY);
            currentY = doc.y + 4;
            doc.text(`Date of leaving: ${leavingDate}`, leftMargin, currentY);
            currentY = doc.y + 4;
            doc.text(`Last held designation: ${designation}`, leftMargin, currentY);
            currentY = doc.y + 14;

            // Body para 2
            doc.font('Helvetica')
                .text(
                    'We draw your attention on your continuing obligation of confidentiality with respect to ' +
                    'proprietary and confidential information of the company that you may have had access to ' +
                    'during the course of the employment.',
                    leftMargin, currentY, { width: contentWidth, align: 'justify' }
                );
            currentY = doc.y + 14;

            // Closing
            doc.text('Wishing you the best.', leftMargin, currentY);
            currentY = doc.y + 14;
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