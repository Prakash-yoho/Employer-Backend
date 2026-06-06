// services/salaryViolationReportService.js

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

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtMin = (m) => {
  if (m == null) return '—';
  const mins = Math.round(m);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
};

const BREAK_LABEL = { MORNING: 'Morning', LUNCH: 'Lunch', EVENING: 'Evening' };

/**
 * Generate a Salary Violation Report PDF for ONE employee.
 *
 * @param {Object} payload
 * @param {Object} payload.employee     - aggregated violation object (byEmployee item)
 * @param {Object} payload.cycle        - { label, startDate, endDate, startDay }
 * @param {Object} payload.officeTiming - { startTime, endTime, graceMinutes }
 * @param {Object} payload.gracePolicy  - { loginGraceMinutes, logoutGraceMinutes, breakGrace }
 * @param {Object} payload.meta         - { refNo, letterDate, hrName, hrTitle }
 *
 * @returns {Promise<Buffer>}
 */
export const generateSalaryViolationReport = (payload) => {
  return new Promise((resolve, reject) => {
    try {
      const {
        employee,
        cycle = {},
        officeTiming = {},
        gracePolicy = {},
        meta = {},
      } = payload;

      const letterheadPath = path.join(process.cwd(), 'public', 'letterhead.png');
      const signaturePath  = path.join(process.cwd(), 'public', 'HazeenaSignature.png');

      const doc = new PDFDocument({
        size: 'A4', margin: 50, bufferPages: true,
        info: {
          Title:   `Salary Violation Report - ${employee.name}`,
          Author:  'KIAQ Technologies Pvt Ltd',
          Subject: `Salary Violation Report for ${employee.name} (${cycle.label ?? ''})`,
        },
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        // Apply letterhead to every buffered page
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          addLetterheadToPage(doc, letterheadPath);
        }
        resolve(Buffer.concat(buffers));
      });
      doc.on('error', reject);

      addLetterheadToPage(doc, letterheadPath);

      // ── Layout constants (match relieving letter) ──────────────────────────
      const leftMargin   = 70;
      const rightMargin  = 525;
      const topMargin    = 130;
      const contentWidth = rightMargin - leftMargin;

      const {
        refNo      = 'K000000',
        letterDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
        hrName     = process.env.HR_NAME  || 'Hazeena Begum A',
        hrTitle    = process.env.HR_TITLE || 'SR Executive - Human Resource',
      } = meta;

      let currentY = topMargin;

      // ── Ref + date ─────────────────────────────────────────────────────────
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
        .text(`HR/Salary Violation Report/${refNo}`, leftMargin, currentY);
      currentY = doc.y + 4;
      doc.font('Helvetica').text(letterDate, leftMargin, currentY);
      currentY = doc.y + 16;

      // ── Title ──────────────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#002B38')
        .text('SALARY VIOLATION REPORT', leftMargin, currentY, { width: contentWidth, align: 'center' });
      currentY = doc.y + 4;
      doc.font('Helvetica').fontSize(9.5).fillColor('#555555')
        .text(`Salary Cycle: ${cycle.label ?? '—'}`, leftMargin, currentY, { width: contentWidth, align: 'center' });
      currentY = doc.y + 16;

      // ── Employee meta block ──────────────────────────────────────────────────
      doc.fillColor('#000000').fontSize(10);
      doc.font('Helvetica').text('Name: ', leftMargin, currentY, { continued: true })
        .font('Helvetica-Bold').text(employee.name);
      currentY = doc.y + 4;
      doc.font('Helvetica').text('Employee ID: ', leftMargin, currentY, { continued: true })
        .font('Helvetica-Bold').text(employee.employeeId);
      currentY = doc.y + 4;
      if (employee.designation) {
        doc.font('Helvetica').text('Designation: ', leftMargin, currentY, { continued: true })
          .font('Helvetica-Bold').text(employee.designation);
        currentY = doc.y + 4;
      }
      if (employee.department) {
        doc.font('Helvetica').text('Department: ', leftMargin, currentY, { continued: true })
          .font('Helvetica-Bold').text(employee.department);
        currentY = doc.y + 4;
      }
      currentY = doc.y + 12;

      // ── Policy reference (explanation of thresholds) ─────────────────────────
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#002B38')
        .text('Applied Thresholds', leftMargin, currentY);
      currentY = doc.y + 6;

      doc.font('Helvetica').fontSize(9).fillColor('#333333');
      const bg = gracePolicy.breakGrace ?? {};
      const policyLines = [
        `Office hours: ${officeTiming.startTime ?? '—'} to ${officeTiming.endTime ?? '—'}.`,
        `Late login grace: ${gracePolicy.loginGraceMinutes ?? 0} min after start time before a salary violation applies.`,
        `Early logout grace: ${gracePolicy.logoutGraceMinutes ?? 0} min before end time before a salary violation applies.`,
        `Break grace (over allowed): Morning ${bg.MORNING ?? 0}m, Lunch ${bg.LUNCH ?? 0}m, Evening ${bg.EVENING ?? 0}m.`,
        `"Late By" / "Early By" are measured from the office start / end time. Grace decides whether each event is counted as a violation.`,
      ];
      policyLines.forEach((line) => {
        doc.text(`•  ${line}`, leftMargin, currentY, { width: contentWidth, align: 'left' });
        currentY = doc.y + 3;
      });
      currentY = doc.y + 10;

      // ── Summary block ────────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#002B38')
        .text('Violation Summary', leftMargin, currentY);
      currentY = doc.y + 6;

      const summaryRows = [
        ['Late logins',          `${employee.lateCount ?? 0}`],
        ['Early logouts',        `${employee.earlyLogoutCount ?? 0}`],
        ['Break violations',     `${employee.breakViolationCount ?? 0}`],
        ['Missed clock-outs',    `${employee.missedClockOutCount ?? 0}`],
        ['Not marked attendance',`${employee.notMarkedCount ?? 0}`],
        ['Total violation days', `${employee.totalViolationDays ?? 0}`],
        ['Total violations',     `${employee.totalViolations ?? 0}`],
      ];

      // Simple table: 2 columns
      const col1 = leftMargin;
      const col2 = leftMargin + 280;
      const rowH = 16;

      // Header
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#002B38');
      doc.text('Violation Type', col1, currentY);
      doc.text('Count',          col2, currentY);
      currentY += rowH - 2;
      doc.moveTo(leftMargin, currentY).lineTo(rightMargin, currentY).strokeColor('#cccccc').stroke();
      currentY += 4;

      doc.font('Helvetica').fontSize(9).fillColor('#333333');
      summaryRows.forEach(([type, count]) => {
        doc.text(type,  col1, currentY, { width: 270 });
        doc.text(count, col2, currentY, { width: rightMargin - col2 });
        currentY += rowH;
      });
      currentY += 8;

      // ── Day-by-day detail ─────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#002B38')
        .text('Day-by-Day Detail', leftMargin, currentY);
      currentY = doc.y + 8;

      const days = employee.days ?? [];
      if (days.length === 0) {
        doc.font('Helvetica').fontSize(9).fillColor('#777777')
          .text('No violations recorded in this cycle.', leftMargin, currentY, { width: contentWidth });
        currentY = doc.y + 8;
      }

      // Each day → readable explanation lines
      days.forEach((d) => {
        // Page-break guard — leave room for at least a few lines
        if (currentY > 720) {
          doc.addPage();
          currentY = topMargin;
        }

        // Date header
        const dateLabel = new Date(d.date).toLocaleDateString('en-GB', {
          weekday: 'long', day: '2-digit', month: 'short', year: 'numeric',
        });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000')
          .text(dateLabel, leftMargin, currentY);
        currentY = doc.y + 3;

        doc.font('Helvetica').fontSize(9).fillColor('#333333');

        // Late
        if (d.isLate) {
          doc.text(
            `• Late login — clocked in at ${d.clockIn}. Late by ${fmtMin(d.lateByMinutes)} from the office start time.`,
            leftMargin + 8, currentY, { width: contentWidth - 8, align: 'left' }
          );
          currentY = doc.y + 3;
        }

        // Early
        if (d.isEarlyLogout) {
          doc.text(
            `• Early logout — clocked out at ${d.clockOut}. Left ${fmtMin(d.earlyByMinutes)} before the office end time.`,
            leftMargin + 8, currentY, { width: contentWidth - 8, align: 'left' }
          );
          currentY = doc.y + 3;
        }

        // Breaks
        if (d.hasBreakViolation && Array.isArray(d.breakViolations)) {
          d.breakViolations.forEach((b) => {
            const lbl = BREAK_LABEL[b.breakType] ?? b.breakType;
            doc.text(
              `• ${lbl} break overrun — took ${fmtMin(b.takenMinutes)} (allowed ${fmtMin(b.allowedMinutes)}), ` +
              `over by ${fmtMin(b.overByMinutes)}.`,
              leftMargin + 8, currentY, { width: contentWidth - 8, align: 'left' }
            );
            currentY = doc.y + 3;
          });
        }

        // Missed clock-out
        if (d.isMissedClockOut) {
          doc.text(
            `• Missed clock-out — clocked in at ${d.clockIn} but no clock-out was recorded for the day.`,
            leftMargin + 8, currentY, { width: contentWidth - 8, align: 'left' }
          );
          currentY = doc.y + 3;
        }

        // Not marked attendance
        if (d.isNotMarked) {
          doc.text(
            `• Not marked — no attendance recorded and no approved leave for this working day.`,
            leftMargin + 8, currentY, { width: contentWidth - 8, align: 'left' }
          );
          currentY = doc.y + 3;
        }

        currentY = doc.y + 8;
      });

      // ── Closing + signature ──────────────────────────────────────────────────
      if (currentY > 690) {
        doc.addPage();
        currentY = topMargin;
      }

      currentY += 6;
      doc.font('Helvetica').fontSize(9).fillColor('#333333')
        .text(
          'This report summarises the attendance violations recorded for the salary cycle above, ' +
          'as per the company attendance policy.',
          leftMargin, currentY, { width: contentWidth, align: 'justify' }
        );
      currentY = doc.y + 16;

      doc.font('Helvetica').fontSize(10).fillColor('#000000')
        .text('For Kiaq Technologies Pvt Ltd,', leftMargin, currentY);
      currentY = doc.y + 8;

      if (fs.existsSync(signaturePath)) {
        doc.image(signaturePath, leftMargin, currentY, { width: 110, height: 45 });
        currentY += 52;
      } else {
        currentY += 44;
      }

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