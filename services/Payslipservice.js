// services/payslipService.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import dayjs from "dayjs";

const fmt2 = (n) => (Math.round((n ?? 0) * 100) / 100).toFixed(2);

/**
 * Generate a payslip PDF matching the exact KIAQ template.
 *
 * @param {Object} args - { employee, month: "YYYY-MM" }
 *   employee = buildPayroll() per-employee object (has slip meta + pay).
 *
 * Earnings/deductions show PRORATED amounts (by worked days) — identical to
 * the HR list and the employee on-screen slip. NET SALARY = prorated earnings
 * − prorated deductions.
 */
export const generatePayslip = ({ employee, month }) => {
  return new Promise((resolve, reject) => {
    try {
      const monthLabel = dayjs(`${month}-01`).format("MMM-YYYY");
      const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true,
        info: { Title: `Payslip ${employee.name} ${monthLabel}`, Author: "KIAQ Technologies Pvt Ltd" },
      });

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const PAGE_W = 595.28;
      const L = 56;
      const R = PAGE_W - 56;
      const W = R - L;

      // ── Header: logo + company ──
      const logoPath = path.join(process.cwd(), "public", "companylogo.png");
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, L, 40, { width: 90 });
      }
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(15)
        .text("KIAQ TECHNOLOGIES PRIVATE LIMITED", L + 85, 42, { width: W - 85, align: "center" });
      doc.font("Helvetica").fontSize(9).fillColor("#222")
        .text("M181, Cactus, 7th Floor, Block B, TECCI PARK,", L + 85, 62, { width: W - 85, align: "center" })
        .text("Rajiv Gandhi Salai, Elcot Sez, Sholinganallur,", L + 85, doc.y, { width: W - 85, align: "center" })
        .text("Chennai, Tamil Nadu 600119.", L + 85, doc.y, { width: W - 85, align: "center" });

      // ── Title ──
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#000")
        .text(`Pay Slip for the Month of ${monthLabel}`, L, 118, { width: W, align: "center" });

      const pay = employee.pay;

      // ── Meta box ──
      let boxY = 165;
      const boxH = 132;
      doc.lineWidth(0.8).strokeColor("#000").rect(L, boxY, W, boxH).stroke();

      const metaLeft = [
        ["NAME", employee.name],
        ["DESIGNATION", employee.designation || "—"],
        ["DEPARTMENT", employee.department || "—"],
        ["LOCATION", employee.location || "Chennai"],
        ["EFFECTIVE WORK DAYS", `${pay.workedDays}`],
        ["LOP", `${pay.lopDays}`],
      ];
      const metaRight = [
        ["EMPLOYEE ID", employee.employeeId],
        ["JOINING DATE", employee.joiningDate || "—"],
        ["BANK NAME", employee.bankName || "—"],
        ["ACCOUNT NUMBER", employee.accountNumber || "—"],
        ["PAN", employee.pan || "—"],
        ["UAN NO", employee.uanNo || "—"],
      ];

      const rowH = 19;
      const startY = boxY + 14;
      const labelX_L = L + 16,  valueX_L = L + 150;
      const labelX_R = L + 285, valueX_R = L + 410;

      doc.fontSize(8.5);
      metaLeft.forEach(([k, v], i) => {
        const y = startY + i * rowH;
        doc.font("Helvetica").fillColor("#555").text(k, labelX_L, y, { width: 130 });
        doc.font("Helvetica").fillColor("#000").fontSize(8).text(String(v), valueX_L, y + 0.5, { width: 130 });
        doc.fontSize(8.5);
      });
      metaRight.forEach(([k, v], i) => {
        const y = startY + i * rowH;
        doc.font("Helvetica").fillColor("#555").text(k, labelX_R, y, { width: 120 });
        doc.font("Helvetica").fillColor("#000").fontSize(8).text(String(v), valueX_R, y + 0.5, { width: 125 });
        doc.fontSize(8.5);
      });

      // ── Earnings / Deduction table ──
      let tY = boxY + boxH + 28;
      const c1 = L;
      const c2 = L + W * 0.30;
      const c3 = L + W * 0.46;
      const c4 = L + W * 0.84;

      const headH = 22;
      doc.lineWidth(0.8).strokeColor("#000").rect(L, tY, W, headH).stroke();
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
      doc.text("EARNINGS",  c1 + 8, tY + 6);
      doc.text("AMOUNT",    c2 + 8, tY + 6);
      doc.text("DEDUCTION", c3 + 8, tY + 6);
      doc.text("AMOUNT",    c4 + 8, tY + 6);

      // PRORATED component amounts — same figures the on-screen slip shows.
      const pe = pay.proratedEarnings;
      const earnRows = [
        ["BASIC",                  pe.basic],
        ["HRA",                    pe.hra],
        ["CONVEYANCE ALLOWANCE",   pe.conveyance],
        ["MEDICAL REIMBURSEMENT",  pe.medical],
        ["LEAVE TRAVEL ALLOWANCE", pe.lta],
        ["PERFORMANCE BONUS",      pe.performance],
        ["SPECIAL ALLOWANCE",      pe.special],
      ];
      const dedRows = [
        ["PF CONTRIBUTION BY EMPLOYEE", pay.deductions.pfEmployee],
        ["PF CONTRIBUTION BY EMPLOYER", pay.deductions.pfEmployer],
        ["GRATUITY",                    pay.deductions.gratuity],
        ["", null], ["", null], ["", null], ["", null],
      ];

      let bodyY = tY + headH;
      const lineH = 19;
      const nRows = earnRows.length;
      doc.font("Helvetica").fontSize(9).fillColor("#000");
      for (let i = 0; i < nRows; i++) {
        const ry = bodyY + i * lineH;
        doc.text(earnRows[i][0], c1 + 8, ry + 5, { width: c2 - c1 - 12 });
        doc.text(fmt2(earnRows[i][1]), c2 + 8, ry + 5, { width: c3 - c2 - 12 });
        if (dedRows[i][0]) {
          doc.text(dedRows[i][0], c3 + 8, ry + 5, { width: c4 - c3 - 12 });
          doc.text(fmt2(dedRows[i][1]), c4 + 8, ry + 5, { width: R - c4 - 12 });
        }
      }
      const bodyBottom = bodyY + nRows * lineH;

      doc.lineWidth(0.8).strokeColor("#000");
      doc.rect(L, tY, W, bodyBottom - tY).stroke();
      [c2, c3, c4].forEach((x) => doc.moveTo(x, tY).lineTo(x, bodyBottom).stroke());

      // ── Footer totals (all prorated, consistent with UI) ──
      const totalEarnings  = pay.proratedTotalEarnings;
      const totalDeduction = pay.totalDeduction;
      const netSalary      = pay.netSalary;

      const footH = 20;
      let fY = bodyBottom;
      const footRows = [
        ["NET SALARY", fmt2(netSalary), "TOTAL DEDUCTION", fmt2(totalDeduction)],
        ["COST TO COMPANY (CTC)", fmt2(employee.ctcMonthly), "TOTAL EARNINGS", fmt2(totalEarnings)],
      ];
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
      footRows.forEach((row) => {
        doc.rect(L, fY, W, footH).stroke();
        [c2, c3, c4].forEach((x) => doc.moveTo(x, fY).lineTo(x, fY + footH).stroke());
        doc.text(row[0], c1 + 8, fY + 6, { width: c2 - c1 - 12 });
        doc.text(row[1], c2 + 8, fY + 6, { width: c3 - c2 - 12 });
        doc.text(row[2], c3 + 8, fY + 6, { width: c4 - c3 - 12 });
        doc.text(row[3], c4 + 8, fY + 6, { width: R - c4 - 12 });
        fY += footH;
      });

      // ── Footer note ──
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#555")
        .text("This is a computer generated document, hence no signature is required",
          L, fY + 26, { width: W, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};