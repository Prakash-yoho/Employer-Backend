// services/appraisalLetterService.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { calculateSalaryFromCTC } from "../utils/salarypfcalculations.js";

function addLetterheadToPage(doc, letterheadPath) {
    if (fs.existsSync(letterheadPath)) {
        doc.image(letterheadPath, 0, 0, { width: 595.28, height: 841.89 });
    }
}

function formatDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${day}-${monthNames[date.getMonth()]}-${date.getFullYear()}`;
}

function formatLongDate(date) {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * empData = {
 *   fullName, employeeId, designation, department,
 *   previousAnnualSalary, newAnnualSalary, percentageIncrement,
 *   effectiveDate, letterDate, refNo, hrName, hrTitle
 * }
 */
export const generateAppraisalLetter = async (empData) => {
    return new Promise((resolve, reject) => {
        try {
            const letterheadPath = path.join(process.cwd(), "public", "letterhead.png");
            const signaturePath = path.join(process.cwd(), "public", "HazeenaSignature.png");

            const doc = new PDFDocument({
                margin: 50,
                size: "A4",
                bufferPages: true,
                info: {
                    Title: `Appraisal Letter - ${empData.fullName}`,
                    Author: process.env.COMPANY_NAME || "Kiaq Technologies Pvt Ltd",
                    Subject: `Salary Appraisal for ${empData.fullName}`,
                },
            });

            const buffers = [];
            doc.on("data", buffers.push.bind(buffers));
            doc.on("end", () => {
                const range = doc.bufferedPageRange();
                for (let i = range.start; i < range.start + range.count; i++) {
                    doc.switchToPage(i);
                    addLetterheadToPage(doc, letterheadPath);
                }
                resolve(Buffer.concat(buffers));
            });

            addLetterheadToPage(doc, letterheadPath);

            const leftMargin = 70;
            const rightMargin = 525;
            const topMargin = 130;
            const contentWidth = rightMargin - leftMargin;
            let currentY = topMargin;

            // Ref + date
            doc.fontSize(9).font("Helvetica-Bold")
                .text(`Ref : ${empData.refNo || `KIAQ/APR/${empData.employeeId}`}`, leftMargin, currentY);
            currentY += 11;
            doc.text(`Date : ${empData.letterDate ? formatDate(new Date(empData.letterDate)) : formatDate(new Date())}`, leftMargin, currentY);
            currentY += 20;

            doc.fontSize(9).font("Helvetica-Bold").text(`${empData.fullName},`, leftMargin, currentY);
            currentY += 11;
            doc.text(`Employee ID: ${empData.employeeId}`, leftMargin, currentY);
            currentY += 20;

            doc.fontSize(10).font("Helvetica-Bold")
                .text("Letter of Salary Appraisal", leftMargin, currentY, { width: contentWidth, align: "center" });
            currentY += 20;

            doc.fontSize(9).font("Helvetica")
                .text("Dear ", leftMargin, currentY, { continued: true })
                .font("Helvetica-Bold").text(empData.fullName, { continued: true })
                .font("Helvetica").text(",");
            currentY = doc.y + 11;

            doc.text("We are pleased to inform you that, in recognition of your performance and contribution at ", leftMargin, currentY, {
                width: contentWidth, align: "justify", continued: true,
            });
            doc.font("Helvetica-Bold").text(`${process.env.COMPANY_NAME || "Kiaq Technologies Pvt Ltd"}`, { continued: true });
            doc.font("Helvetica").text(", your compensation has been revised effective ", { continued: true });
            doc.font("Helvetica-Bold").text(`${formatLongDate(new Date(empData.effectiveDate))}`, { continued: true });
            doc.font("Helvetica").text(".");
            currentY = doc.y + 11;

            doc.text("Your revised ", leftMargin, currentY, { continued: true, width: contentWidth, align: "justify" });
            doc.font("Helvetica-Bold").text(`Annual CTC will be INR ${Number(empData.newAnnualSalary).toLocaleString("en-IN")}.00`, { continued: true });
            doc.font("Helvetica").text(`, an increase of `, { continued: true });
            doc.font("Helvetica-Bold").text(`${Number(empData.percentageIncrement)} % `, { continued: true });
            doc.font("Helvetica").text(` over your previous Annual CTC of INR ${Number(empData.previousAnnualSalary).toLocaleString("en-IN")}.00. A detailed compensation breakup is enclosed as Annexure to this letter.`);
            currentY = doc.y + 11;

            doc.text("This revision is in recognition of your continued dedication, and we look forward to your sustained contribution in the period ahead. All other terms and conditions of your employment remain unchanged.", leftMargin, currentY, { width: contentWidth, align: "justify" });
            currentY = doc.y + 11;

            doc.text("We congratulate you on this achievement and wish you continued success.", leftMargin, currentY, { width: contentWidth, align: "justify" });
            currentY = doc.y + 30;

            doc.text("Warm regards,", leftMargin, currentY);
            currentY = doc.y + 10;
            if (fs.existsSync(signaturePath)) {
                doc.image(signaturePath, leftMargin, currentY, { width: 120, height: 50 });
            }
            currentY += 65;
            doc.font("Helvetica-Bold").text(empData.hrName || process.env.HR_NAME || "Hazeena Begum A", leftMargin, currentY);
            currentY = doc.y + 6;
            doc.text(empData.hrTitle || process.env.HR_TITLE || "SR Executive - Human Resource", leftMargin, currentY);
            currentY = doc.y + 6;
            doc.text(process.env.COMPANY_NAME || "Kiaq Technologies Pvt Ltd", leftMargin, currentY);

            // ---------------- ANNEXURE PAGE ----------------
            doc.addPage();
            addLetterheadToPage(doc, letterheadPath);
            currentY = topMargin;

            doc.font("Helvetica-Bold").fontSize(11)
                .text("ANNEXURE - REVISED COMPENSATION DETAILS", leftMargin, currentY, { width: contentWidth, align: "center" });
            currentY = doc.y + 15;

            const monthlyCTC = empData.newAnnualSalary / 12;
            const salaryData = calculateSalaryFromCTC(monthlyCTC);

            const tableTop = currentY;
            const col1X = leftMargin;
            const col2X = leftMargin + 250;
            const col3X = leftMargin + 360;
            const rowHeight = 20;
            const tableWidth = col3X + 95 - col1X;

            const drawCols = (y) => {
                doc.moveTo(col1X + 25, y).lineTo(col1X + 25, y + rowHeight).stroke();
                doc.moveTo(col2X, y).lineTo(col2X, y + rowHeight).stroke();
                doc.moveTo(col3X, y).lineTo(col3X, y + rowHeight).stroke();
                doc.moveTo(col1X + tableWidth, y).lineTo(col1X + tableWidth, y + rowHeight).stroke();
            };

            doc.lineWidth(1.2);
            doc.rect(col1X, tableTop, tableWidth, rowHeight).stroke();
            doc.font("Helvetica-Bold").fontSize(9);
            doc.text("Sr.", col1X + 8, tableTop + 5);
            doc.text("Particulars", col1X + 35, tableTop + 5);
            doc.text("Monthly (Rs.)", col2X - 30, tableTop + 5, { width: 110, align: "right" });
            doc.text("Annual (Rs.)", col3X - 25, tableTop + 5, { width: 95, align: "right" });
            drawCols(tableTop);

            currentY = tableTop + rowHeight;
            doc.lineWidth(1).font("Helvetica").fontSize(9);

            const rows = [
                { sr: "1", label: "Basic", monthly: salaryData.monthly.basic, annual: salaryData.annual.basic },
                { sr: "2", label: "HRA", monthly: salaryData.monthly.hra, annual: salaryData.annual.hra },
                { sr: "3", label: "Conveyance Allowance", monthly: salaryData.monthly.conveyance, annual: salaryData.annual.conveyance },
                { sr: "4", label: "Medical Reimbursement", monthly: salaryData.monthly.medical, annual: salaryData.annual.medical },
                { sr: "5", label: "Leave Travel Allowance", monthly: salaryData.monthly.lta, annual: salaryData.annual.lta },
                { sr: "6", label: "Performance Bonus", monthly: salaryData.monthly.performance, annual: salaryData.annual.performance },
                { sr: "7", label: "Special Allowance", monthly: salaryData.monthly.special, annual: salaryData.annual.special },
            ];

            rows.forEach((row) => {
                doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
                doc.text(row.sr, col1X + 8, currentY + 5);
                doc.text(row.label, col1X + 35, currentY + 5);
                doc.text(row.monthly, col2X + 8, currentY + 5, { width: 110, align: "left" });
                doc.text(row.annual, col3X + 8, currentY + 5, { width: 95, align: "left" });
                drawCols(currentY);
                currentY += rowHeight;
            });

            const netMonthly =
                Number(salaryData.monthly.basic) + Number(salaryData.monthly.hra) +
                Number(salaryData.monthly.conveyance) + Number(salaryData.monthly.medical) +
                Number(salaryData.monthly.lta) + Number(salaryData.monthly.performance) +
                Number(salaryData.monthly.special);
            const netAnnual = netMonthly * 12;

            doc.font("Helvetica-Bold");
            doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
            doc.text("Net Salary", col1X + 35, currentY + 5);
            doc.text(netMonthly.toFixed(2), col2X + 8, currentY + 5, { width: 110, align: "left" });
            doc.text(netAnnual.toFixed(2), col3X + 8, currentY + 5, { width: 95, align: "left" });
            drawCols(currentY);
            currentY += rowHeight;

            doc.font("Helvetica");
            doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
            doc.text("8", col1X + 8, currentY + 5);
            doc.text("PF Contribution by Employee", col1X + 35, currentY + 5);
            doc.text(salaryData.monthly.pfEmployee, col2X + 8, currentY + 5, { width: 110, align: "left" });
            doc.text(salaryData.annual.pfEmployee, col3X + 8, currentY + 5, { width: 95, align: "left" });
            drawCols(currentY);
            currentY += rowHeight;

            const grossMonthly = netMonthly + Number(salaryData.monthly.pfEmployee);
            const grossAnnual = grossMonthly * 12;
            doc.font("Helvetica-Bold");
            doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
            doc.text("Gross Salary", col1X + 35, currentY + 5);
            doc.text(grossMonthly.toFixed(2), col2X + 8, currentY + 5, { width: 110, align: "left" });
            doc.text(grossAnnual.toFixed(2), col3X + 8, currentY + 5, { width: 95, align: "left" });
            drawCols(currentY);
            currentY += rowHeight;

            doc.font("Helvetica");
            doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
            doc.text("9", col1X + 8, currentY + 5);
            doc.text("PF Contribution by Employer", col1X + 35, currentY + 5);
            doc.text(salaryData.monthly.pfEmployer, col2X + 8, currentY + 5, { width: 110, align: "left" });
            doc.text(salaryData.annual.pfEmployer, col3X + 8, currentY + 5, { width: 95, align: "left" });
            drawCols(currentY);
            currentY += rowHeight;

            doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
            doc.text("10", col1X + 8, currentY + 5);
            doc.text("Gratuity", col1X + 35, currentY + 5);
            doc.text(salaryData.monthly.gratuity, col2X + 8, currentY + 5, { width: 110, align: "left" });
            doc.text(salaryData.annual.gratuity, col3X + 8, currentY + 5, { width: 95, align: "left" });
            drawCols(currentY);
            currentY += rowHeight;

            const totalStatMonthly = Number(salaryData.monthly.pfEmployer) + Number(salaryData.monthly.gratuity);
            const totalStatAnnual = totalStatMonthly * 12;
            doc.font("Helvetica-Bold");
            doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
            doc.text("Total Statutory Contributions", col1X + 35, currentY + 5);
            doc.text(totalStatMonthly.toFixed(2), col2X + 8, currentY + 5, { width: 110, align: "left" });
            doc.text(totalStatAnnual.toFixed(2), col3X + 8, currentY + 5, { width: 95, align: "left" });
            drawCols(currentY);
            currentY += rowHeight;

            doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
            doc.text("Cost To Company (CTC)", col1X + 35, currentY + 5);
            doc.text(salaryData.monthly.ctc, col2X + 8, currentY + 5, { width: 110, align: "left" });
            doc.text(salaryData.annual.ctc, col3X + 8, currentY + 5, { width: 95, align: "left" });
            drawCols(currentY);
            currentY += rowHeight;

            currentY += 15;
            doc.fontSize(9).font("Helvetica")
                .text("Note: This salary structure supersedes any previous compensation structure communicated to you, and is subject to applicable statutory deductions and company policy.", leftMargin, currentY, { width: contentWidth, align: "justify" });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};