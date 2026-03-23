import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calculateSalaryFromCTC } from "../utils/salary.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to add letterhead to each page
function addLetterheadToPage(doc, letterheadPath) {
  if (fs.existsSync(letterheadPath)) {
    doc.image(letterheadPath, 0, 0, { width: 595.28, height: 841.89 });
  }
}

export const generateOfferLetter = async (application, offerDetails) => {
  return new Promise((resolve, reject) => {
    try {
      const letterheadPath = path.join(
        process.cwd(),
        "public",
        "letterhead.png"
      );
      const signaturePath = path.join(process.cwd(), "public", "signature.png");

      const fontRegular = path.join(
        process.cwd(),
        "public",
        "fonts",
        "NotoSans-Regular.ttf"
      );
      const fontBold = path.join(
        process.cwd(),
        "public",
        "fonts",
        "NotoSans-Bold.ttf"
      );

      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        bufferPages: true,
        info: {
          Title: `Offer Letter - ${application.user.fullName}`,
          Author: "KIAQ Technologies Pvt Ltd",
          Subject: `Employment Offer for ${application.job.title}`,
        },
      });

      doc.registerFont("regular", fontRegular);
      doc.registerFont("bold", fontBold);

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

      // Add letterhead to first page
      addLetterheadToPage(doc, letterheadPath);

      // Content margins
      const leftMargin = 70;
      const rightMargin = 525;
      const topMargin = 130;
      const contentWidth = rightMargin - leftMargin;

      let currentY = topMargin;

      // Reference and Date (BOLD)
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(
          `Ref : ${offerDetails.offerRef || "KIAQ/XXXXXXXX/CHE/ASE"}`,
          leftMargin,
          currentY
        );

      currentY += 11;
      doc.text(
        `Date : ${
          offerDetails.offerDate
            ? formatDate(new Date(offerDetails.offerDate))
            : formatDate(new Date())
        }`,
        leftMargin,
        currentY
      );

      currentY += 20;

      // Candidate Address (BOLD)
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(
          `${application.user.gender === "Male" ? "Mr" : "Ms"}.${
            application.user.fullName
          },`,
          leftMargin,
          currentY
        );

      currentY += 11;
      doc.text(
        `C/O ${application.user.parentName || "Guardian Name"},`,
        leftMargin,
        currentY
      );

      currentY += 11;
      if (application.user.address1) {
        doc.text(application.user.address1, leftMargin, currentY);
        currentY += 11;
      }

      if (application.user.address2) {
        doc.text(application.user.address2, leftMargin, currentY);
        currentY += 11;
      }

      doc.text(`${application.user.city || "City"},`, leftMargin, currentY);
      currentY += 11;

      doc.text(
        `${application.user.state || "State"} – ${
          application.user.pincode || "XXXXXX"
        }.`,
        leftMargin,
        currentY
      );
      currentY += 20;

      // Title (CENTER ALIGNED)
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text(
          "Employment Offer and Joining Formalities",
          leftMargin,
          currentY,
          {
            width: contentWidth,
            align: "center",
          }
        );

      currentY += 20;

      // Salutation
      doc
        .fontSize(9)
        .font("Helvetica")
        .text(`Dear `, leftMargin, currentY, { continued: true })
        .font("Helvetica-Bold")
        .text(`${application.user.fullName || "Candidate"}`, {
          continued: true,
        })
        .font("Helvetica")
        .text(`,`);

      currentY += 20;

      const paragraphStart =
        "We are delighted to offer you the opportunity to join Kiaq Technologies as ";
      const jobTitle = application.job.title; // bold
      const paragraphEnd = ".";

      doc
        .fontSize(9)
        .font("Helvetica")
        .text(paragraphStart, leftMargin, currentY, {
          continued: true,
          align: "justify",
        });

      doc.font("Helvetica-Bold").text(jobTitle, {
        continued: true,
      });

      doc.font("Helvetica").text(paragraphEnd);

      currentY = doc.y + 11;

      // Paragraph 2 with BOLD highlights
      doc.text("You will receive an ", leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
        continued: true,
      });
      doc
        .font("Helvetica-Bold")
        .text(
          `Annual CTC of INR ${offerDetails.salary.toLocaleString("en-IN")}.00`,
          { continued: true }
        );
      doc
        .font("Helvetica")
        .text(
          `, subject to deductions as required by law and company policy. A detailed compensation structure is provided in the attached document for your review. You are hereby requested to report for duties at our `,
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text(`${application.job.location}`, { continued: true });
      doc.font("Helvetica").text(` Office on `, { continued: true });
      doc
        .font("Helvetica-Bold")
        .text(`${formatLongDate(new Date(offerDetails.joiningDate))}`, {
          continued: true,
        });
      doc.font("Helvetica").text(`.`);

      currentY = doc.y + 11;

      // Paragraph 3
      const paragraph3 = `At Kiaq Technologies, we are committed to fostering a professional environment that supports continuous learning, growth, and the opportunity to utilize your knowledge, experience, and dedication to achieve your highest potential. We view you as a valuable part of our team and are excited about the possibility of working together.`;
      doc.text(paragraph3, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      // Paragraph 4
      const paragraph4 = `It was a pleasure meeting you during the interview process. Following our recent discussions, we are pleased to formally extend this offer to you and look forward to your contributions in delivering innovation and excellence for our clients.`;
      doc.text(paragraph4, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      // Paragraph 5
      const paragraph5 = `Please review the attached documents, which provide a detailed overview of your offer, compensation, and associated benefits.`;
      doc.text(paragraph5, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      // Conditional section with bullet points
      doc
        .fontSize(9)
        .font("Helvetica")
        .text("This offer is conditional upon:", leftMargin, currentY);

      currentY = doc.y + 6;

      doc.fontSize(9).font("Helvetica");
      const bulletPoints = [
        "Your joining on the agreed-upon start date",
        "Successful completion of all pre-employment checks and verifications",
        "Timely submission of all required documents",
      ];

      bulletPoints.forEach((point) => {
        doc.text("•", leftMargin, currentY);
        doc.text(point, leftMargin + 15, currentY, {
          width: contentWidth - 15,
        });
        currentY = doc.y + 4;
      });

      currentY = doc.y + 7;

      const paragraph6 = `Please note that any misrepresentation, non-disclosure of material facts, or misconduct during the assessment or verification process may result in immediate revocation of this offer without any liability on the part of the company.`;
      doc.text(paragraph6, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      const paragraph7 = `Your performance will be reviewed on a regular basis. Based on these reviews, the terms of your engagement may be modified in line with company policies and your role expectations.`;
      doc.text(paragraph7, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      const paragraph8 = `Your compensation structure and other employment terms may be subject to change in accordance with company policy, procedural updates, or applicable legal requirements.`;
      doc.text(paragraph8, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      const paragraph9 = `This offer is valid for 7 days from the date of issue. If we do not receive your acceptance within this period, it will be considered declined and automatically revoked.`;
      doc.text(paragraph9, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      // Notes section (UNDERLINED title)
      doc.fontSize(9).font("Helvetica").text("Notes:", leftMargin, currentY);

      // Draw underline for "Notes:"
      const notesTextWidth = doc.widthOfString("Notes:");
      doc
        .moveTo(leftMargin, currentY + 10)
        .lineTo(leftMargin + notesTextWidth, currentY + 10)
        .stroke();

      currentY = doc.y + 6;

      doc.fontSize(9).font("Helvetica");
      const note1 = `1. The salary/allowance structure is liable for modification from time to time and all payments are subject to appropriate taxation as per the Income Tax laws.`;
      doc.text(note1, leftMargin + 10, currentY, {
        width: contentWidth - 10,
        align: "justify",
      });

      currentY = doc.y + 6;

      const note2 = `2. All payments would be as per company rules and regulations and administrative procedures/regulations. Individual components and amounts against each component may undergo modification from time to time depending on statutory regulations.`;
      doc.text(note2, leftMargin + 10, currentY, {
        width: contentWidth - 10,
        align: "justify",
      });

      currentY = doc.y + 15;

      // PAGE 2 - Joining and Documentation (CENTER ALIGNED)
      doc.addPage();
      addLetterheadToPage(doc, letterheadPath);
      currentY = topMargin;

      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Joining and Documentation", leftMargin, currentY, {
          width: contentWidth,
          align: "center",
        });

      currentY = doc.y + 20;

      doc.fontSize(9).font("Helvetica");
      const paragraph10 = `Upon successful completion of all joining formalities, you will receive a formal Letter of Appointment.`;
      doc.text(paragraph10, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      doc.font("Helvetica").text("Please note:", leftMargin, currentY);
      currentY = doc.y + 6;

      doc.font("Helvetica");
      const pleaseNotePoints = [
        "Submission of a valid PAN Card is mandatory. Failure to do so may delay your onboarding.",
        "Your employment is contingent upon legal eligibility to work in India, including possession of a valid work permit (if required) and no disqualification under any applicable law.",
      ];

      pleaseNotePoints.forEach((point) => {
        doc.text("•", leftMargin, currentY);
        doc.text(point, leftMargin + 15, currentY, {
          width: contentWidth - 15,
        });
        currentY = doc.y + 4;
      });

      currentY = doc.y + 7;

      doc.font("Helvetica").text("You are requested to:", leftMargin, currentY);
      currentY = doc.y + 6;

      doc.font("Helvetica");
      doc.text("1.", leftMargin, currentY);
      doc.text(
        "Confirm your acceptance of this offer within 24 hours of receipt.",
        leftMargin + 15,
        currentY,
        {
          width: contentWidth - 15,
        }
      );
      currentY = doc.y + 4;

      doc.text("2.", leftMargin, currentY);
      doc.text(
        "Submit the following documents on the date of joining or within a reasonable timeframe:",
        leftMargin + 15,
        currentY,
        {
          width: contentWidth - 15,
        }
      );
      currentY = doc.y + 11;

      doc.font("Helvetica").text("Required Documents", leftMargin, currentY);
      currentY = doc.y + 6;

      doc.font("Helvetica");
      doc.text("•", leftMargin, currentY);
      doc.text(
        "Recent passport-size photograph (scanned copy)",
        leftMargin + 15,
        currentY,
        {
          width: contentWidth - 15,
        }
      );
      currentY = doc.y + 4;

      doc.text("•", leftMargin, currentY);
      doc.text("Photocopies or scanned copies of:", leftMargin + 15, currentY, {
        width: contentWidth - 15,
      });
      currentY = doc.y + 4;

      const docList = [
        "Educational certificates and mark sheets (10th, 12th, Graduation, Post-Graduation if applicable)",
        "PAN Card",
        "Aadhaar Card or Driving License",
        "Experience certificates or relieving letters from previous employers (if applicable)",
        "Salary slips, bank statements, or other documents supporting your most recent compensation (if applicable)",
      ];

      docList.forEach((item) => {
        doc.text("o", leftMargin + 30, currentY);
        doc.text(item, leftMargin + 45, currentY, { width: contentWidth - 45 });
        currentY = doc.y + 4;
      });

      currentY = doc.y + 7;

      const paragraph11 = `You may also be requested to submit additional documents, if necessary, during or after the onboarding process.`;
      doc.text(paragraph11, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      const paragraph12 = `Your joining is also subject to successful background verification and reference checks. Please ensure all submitted documents are complete and accurate to avoid delays in onboarding.`;
      doc.text(paragraph12, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      const paragraph13 = `Once again, congratulations! We are excited about the prospect of you joining our team.`;
      doc.text(paragraph13, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      const paragraph14 = `If you have any questions or need further assistance, please feel free to reach out to our HR Department, at hr@kiaq.in.`;
      doc.text(paragraph14, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 11;

      doc.text(
        "Let's work together to deliver growth at the heart of change.",
        leftMargin,
        currentY,
        {
          width: contentWidth,
        }
      );

      currentY = doc.y + 20;

      // Warm regards
      doc.text("Warm regards,", leftMargin, currentY);
      currentY = doc.y + 10;

      // Add Signature Image (png)
      if (fs.existsSync(signaturePath)) {
        doc.image(signaturePath, leftMargin, currentY, {
          width: 120,
          height: 50,
        });
      }

      // Move pointer below the image
      currentY += 65;

      doc.font("Helvetica-Bold").text("Karthick R", leftMargin, currentY);
      currentY = doc.y + 6;

      doc.font("Helvetica-Bold").text("Sr.HR.Executive", leftMargin, currentY);
      currentY = doc.y + 6;

      doc
        .font("Helvetica-Bold")
        .text("Kiaq Technologies Pvt Ltd", leftMargin, currentY);

      // PAGE 3 - Compensation Details
      doc.addPage();
      addLetterheadToPage(doc, letterheadPath);
      currentY = topMargin;

      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("CONFIDENTIAL - COMPENSATION DETAILS", leftMargin, currentY, {
          width: contentWidth,
          align: "center",
        });

      currentY = doc.y + 9;

      // ----------------- SALARY CALC -----------------
      const monthlyCTC = offerDetails.salary / 12;
      const salaryData = calculateSalaryFromCTC(monthlyCTC);

      // ----------------- TABLE LAYOUT -----------------
      const tableTop = currentY;
      const col1X = leftMargin;
      const col2X = leftMargin + 250;
      const col3X = leftMargin + 360;
      const rowHeight = 20;
      const tableWidth = col3X + 95 - col1X;

      // ----------------- HEADER -----------------
      doc.lineWidth(1.2);
      doc.rect(col1X, tableTop, tableWidth, rowHeight).stroke();

      doc.font("bold").fontSize(9);
      doc.text("Sr.", col1X + 8, tableTop + 5);
      doc.text("Particulars", col1X + 97, tableTop + 5);
      doc.text("Monthly (₹)", col2X - 30, tableTop + 5, {
        width: 110,
        align: "right",
      });
      doc.text("Annual (₹)", col3X - 25, tableTop + 5, {
        width: 95,
        align: "right",
      });

      doc.lineWidth(1);
      doc
        .moveTo(col1X + 25, tableTop)
        .lineTo(col1X + 25, tableTop + rowHeight)
        .stroke();
      doc
        .moveTo(col2X, tableTop)
        .lineTo(col2X, tableTop + rowHeight)
        .stroke();
      doc
        .moveTo(col3X, tableTop)
        .lineTo(col3X, tableTop + rowHeight)
        .stroke();
      doc
        .moveTo(col1X + tableWidth, tableTop)
        .lineTo(col1X + tableWidth, tableTop + rowHeight)
        .stroke();

      currentY = tableTop + rowHeight;

      // ----------------- ROWS -----------------
      doc.font("regular").fontSize(9);

      const rows = [
        {
          sr: "1",
          label: "Basic",
          monthly: salaryData.monthly.basic,
          annual: salaryData.annual.basic,
        },
        {
          sr: "2",
          label: "HRA",
          monthly: salaryData.monthly.hra,
          annual: salaryData.annual.hra,
        },
        {
          sr: "3",
          label: "Conveyance Allowance",
          monthly: salaryData.monthly.conveyance,
          annual: salaryData.annual.conveyance,
        },
        {
          sr: "4",
          label: "Medical Reimbursement",
          monthly: salaryData.monthly.medical,
          annual: salaryData.annual.medical,
        },
        {
          sr: "5",
          label: "Leave Travel Allowance",
          monthly: salaryData.monthly.lta,
          annual: salaryData.annual.lta,
        },
        {
          sr: "6",
          label: "Performance Bonus",
          monthly: salaryData.monthly.performance,
          annual: salaryData.annual.performance,
        },
        {
          sr: "7",
          label: "Special Allowance",
          monthly: salaryData.monthly.special,
          annual: salaryData.annual.special,
        },
      ];

      rows.forEach((row) => {
        doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
        doc.text(row.sr, col1X + 8, currentY + 5);
        doc.text(row.label, col1X + 35, currentY + 5);
        doc.text(row.monthly, col2X + 8, currentY + 5, {
          width: 110,
          align: "left",
        });
        doc.text(row.annual, col3X + 8, currentY + 5, {
          width: 95,
          align: "left",
        });

        doc
          .moveTo(col1X + 25, currentY)
          .lineTo(col1X + 25, currentY + rowHeight)
          .stroke();
        doc
          .moveTo(col2X, currentY)
          .lineTo(col2X, currentY + rowHeight)
          .stroke();
        doc
          .moveTo(col3X, currentY)
          .lineTo(col3X, currentY + rowHeight)
          .stroke();
        doc
          .moveTo(col1X + tableWidth, currentY)
          .lineTo(col1X + tableWidth, currentY + rowHeight)
          .stroke();

        currentY += rowHeight;
      });

      // ----------------- NET SALARY -----------------
      const netMonthly =
        Number(salaryData.monthly.basic) +
        Number(salaryData.monthly.hra) +
        Number(salaryData.monthly.conveyance) +
        Number(salaryData.monthly.medical) +
        Number(salaryData.monthly.lta) +
        Number(salaryData.monthly.performance) +
        Number(salaryData.monthly.special);

      const netAnnual = netMonthly * 12;

      doc.font("bold");
      doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
      doc.text("Net Salary", col1X + 35, currentY + 5);
      doc.text(netMonthly.toFixed(2), col2X + 8, currentY + 5, {
        width: 110,
        align: "left",
      });
      doc.text(netAnnual.toFixed(2), col3X + 8, currentY + 5, {
        width: 95,
        align: "left",
      });

      doc
        .moveTo(col1X + 25, currentY)
        .lineTo(col1X + 25, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col2X, currentY)
        .lineTo(col2X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col3X, currentY)
        .lineTo(col3X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col1X + tableWidth, currentY)
        .lineTo(col1X + tableWidth, currentY + rowHeight)
        .stroke();

      currentY += rowHeight;

      // ----------------- PF EMPLOYEE -----------------
      doc.font("regular");
      doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
      doc.text("8", col1X + 8, currentY + 5);
      doc.text("PF Contribution by Employee", col1X + 35, currentY + 5);
      doc.text(salaryData.monthly.pfEmployee, col2X + 8, currentY + 5, {
        width: 110,
        align: "left",
      });
      doc.text(salaryData.annual.pfEmployee, col3X + 8, currentY + 5, {
        width: 95,
        align: "left",
      });

      doc
        .moveTo(col1X + 25, currentY)
        .lineTo(col1X + 25, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col2X, currentY)
        .lineTo(col2X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col3X, currentY)
        .lineTo(col3X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col1X + tableWidth, currentY)
        .lineTo(col1X + tableWidth, currentY + rowHeight)
        .stroke();

      currentY += rowHeight;

      // ----------------- GROSS SALARY -----------------
      const grossMonthly = netMonthly + Number(salaryData.monthly.pfEmployee);
      const grossAnnual = grossMonthly * 12;

      doc.font("bold");
      doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
      doc.text("Gross Salary", col1X + 35, currentY + 5);
      doc.text(grossMonthly.toFixed(2), col2X + 8, currentY + 5, {
        width: 110,
        align: "left",
      });
      doc.text(grossAnnual.toFixed(2), col3X + 8, currentY + 5, {
        width: 95,
        align: "left",
      });

      doc
        .moveTo(col1X + 25, currentY)
        .lineTo(col1X + 25, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col2X, currentY)
        .lineTo(col2X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col3X, currentY)
        .lineTo(col3X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col1X + tableWidth, currentY)
        .lineTo(col1X + tableWidth, currentY + rowHeight)
        .stroke();

      currentY += rowHeight;

      // ----------------- PF EMPLOYER -----------------
      doc.font("regular");
      doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
      doc.text("9", col1X + 8, currentY + 5);
      doc.text("PF Contribution by Employer", col1X + 35, currentY + 5);
      doc.text(salaryData.monthly.pfEmployer, col2X + 8, currentY + 5, {
        width: 110,
        align: "left",
      });
      doc.text(salaryData.annual.pfEmployer, col3X + 8, currentY + 5, {
        width: 95,
        align: "left",
      });

      doc
        .moveTo(col1X + 25, currentY)
        .lineTo(col1X + 25, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col2X, currentY)
        .lineTo(col2X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col3X, currentY)
        .lineTo(col3X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col1X + tableWidth, currentY)
        .lineTo(col1X + tableWidth, currentY + rowHeight)
        .stroke();

      currentY += rowHeight;

      // ----------------- GRATUITY -----------------
      doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
      doc.text("10", col1X + 8, currentY + 5);
      doc.text("Gratuity", col1X + 35, currentY + 5);
      doc.text(salaryData.monthly.gratuity, col2X + 8, currentY + 5, {
        width: 110,
        align: "left",
      });
      doc.text(salaryData.annual.gratuity, col3X + 8, currentY + 5, {
        width: 95,
        align: "left",
      });

      doc
        .moveTo(col1X + 25, currentY)
        .lineTo(col1X + 25, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col2X, currentY)
        .lineTo(col2X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col3X, currentY)
        .lineTo(col3X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col1X + tableWidth, currentY)
        .lineTo(col1X + tableWidth, currentY + rowHeight)
        .stroke();

      currentY += rowHeight;

      // ----------------- TOTAL STATUTORY -----------------
      const totalStatMonthly =
        Number(salaryData.monthly.pfEmployer) +
        Number(salaryData.monthly.gratuity);
      const totalStatAnnual = totalStatMonthly * 12;

      doc.font("bold");
      doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
      doc.text("Total Statutory Contributions", col1X + 35, currentY + 5);
      doc.text(totalStatMonthly.toFixed(2), col2X + 8, currentY + 5, {
        width: 110,
        align: "left",
      });
      doc.text(totalStatAnnual.toFixed(2), col3X + 8, currentY + 5, {
        width: 95,
        align: "left",
      });

      doc
        .moveTo(col1X + 25, currentY)
        .lineTo(col1X + 25, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col2X, currentY)
        .lineTo(col2X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col3X, currentY)
        .lineTo(col3X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col1X + tableWidth, currentY)
        .lineTo(col1X + tableWidth, currentY + rowHeight)
        .stroke();

      currentY += rowHeight;

      // ----------------- CTC -----------------
      doc.rect(col1X, currentY, tableWidth, rowHeight).stroke();
      doc.text("Cost To Company (CTC)", col1X + 35, currentY + 5);
      doc.text(salaryData.monthly.ctc, col2X + 8, currentY + 5, {
        width: 110,
        align: "left",
      });
      doc.text(salaryData.annual.ctc, col3X + 8, currentY + 5, {
        width: 95,
        align: "left",
      });

      doc
        .moveTo(col1X + 25, currentY)
        .lineTo(col1X + 25, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col2X, currentY)
        .lineTo(col2X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col3X, currentY)
        .lineTo(col3X, currentY + rowHeight)
        .stroke();
      doc
        .moveTo(col1X + tableWidth, currentY)
        .lineTo(col1X + tableWidth, currentY + rowHeight)
        .stroke();

      currentY += rowHeight;

      currentY = doc.y + 15;

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("COMPENSATION AND BENEFITS", leftMargin, currentY, {
          width: contentWidth,
        });

      // Draw underline for "compensation:"
      const compensationTextWidth = doc.widthOfString(
        "COMPENSATION AND BENEFITS"
      );
      doc
        .moveTo(leftMargin, currentY + 10)
        .lineTo(leftMargin + compensationTextWidth, currentY + 10)
        .stroke();

      currentY = doc.y + 6;

      doc
        .fontSize(9)
        .font("Helvetica")
        .text(
          "The details of your compensation and benefits are given below:",
          leftMargin,
          currentY
        );

      currentY = doc.y + 8;

      // FIXED COMPENSATION
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("FIXED COMPENSATION", leftMargin, currentY);

      // Draw underline for "fixed compensation:"
      const fixedcompensationTextWidth =
        doc.widthOfString("FIXED COMPENSATION");
      doc
        .moveTo(leftMargin, currentY + 10)
        .lineTo(leftMargin + fixedcompensationTextWidth, currentY + 10)
        .stroke();

      currentY = doc.y + 9;

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("Basic Salary:", leftMargin, currentY);
      currentY = doc.y + 5;

      doc.fontSize(9).font("Helvetica");
      const basicDesc = `Basic Salary is the fixed core component of an employee's salary structure. It serves as the foundation for calculating several other components such as House Rent Allowance (HRA), Provident Fund (PF), Gratuity, and various statutory allowances as per government norms and organizational policies. It is fully taxable and remains constant irrespective of performance-based or variable pay components. Your Basic Salary is 40% of CTC.`;
      doc.text(basicDesc, leftMargin, currentY, {
        width: contentWidth,
        align: "justify",
      });

      currentY = doc.y + 9;

      // BENEFITS
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("BENEFITS", leftMargin, currentY);

      // Draw underline for "BENEFITS:"
      const benefitsTextWidth = doc.widthOfString("BENEFITS");
      doc
        .moveTo(leftMargin, currentY + 10)
        .lineTo(leftMargin + benefitsTextWidth, currentY + 10)
        .stroke();

      currentY = doc.y + 9;

      // HRA
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("House Rent Allowance (HRA)", leftMargin, currentY);
      currentY = doc.y + 6;
      const hraDesc = `House Rent Allowance (HRA) is a salary component paid by employers to employees to help cover rental housing expenses. It is a partially tax-exempt allowance under Section 10(13A) of the Income Tax Act, 1961, if certain conditions are met. Your HRA is 50% of Basic Salary.`;
      doc
        .font("Helvetica")
        .text(hraDesc, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });
      currentY = doc.y + 9;

      // Conveyance
      doc
        .font("Helvetica-Bold")
        .text("Conveyance Allowance", leftMargin, currentY);
      currentY = doc.y + 6;
      const convDesc = `Conveyance Allowance is a salary component provided by employers to employees to cover travel expenses between home and office. It is also referred to as transport allowance in some cases. Your Conveyance Allowance is 25% of Basic Salary.`;
      doc
        .font("Helvetica")
        .text(convDesc, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });
      currentY = doc.y + 9;

      // LTA
      doc
        .font("Helvetica-Bold")
        .text("Leave Travel Allowance (LTA)", leftMargin, currentY);
      currentY = doc.y + 6;
      const ltaDesc = `Leave Travel Allowance (LTA) is a component of your salary package provided by employers to cover the cost of travel within India while you are on leave with your family or alone. It is partially tax-exempt under Section 10(5) of the Income Tax Act, 1961, subject to certain conditions. Your Leave Travel Allowance is 5% of Basic Salary.`;
      doc
        .font("Helvetica")
        .text(ltaDesc, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });

      // PAGE 4 - Benefits
      doc.addPage();
      addLetterheadToPage(doc, letterheadPath);
      currentY = topMargin;

      // Performance Bonus
      doc
        .font("Helvetica-Bold")
        .text("Performance Bonus", leftMargin, currentY);
      currentY = doc.y + 6;
      const perfDesc = `Performance Bonus is a variable component of an employee's salary that is paid based on their individual performance, team contribution, or company performance over a defined period — usually monthly, quarterly, half-yearly, or annually. It is not fixed and is often used as a tool to reward high performance, boost motivation, and align employees with organizational goals. Your performance bonus is 10% of basic salary.`;
      doc
        .font("Helvetica")
        .text(perfDesc, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });
      currentY = doc.y + 11;

      // Special Allowance
      doc
        .font("Helvetica-Bold")
        .text("Special Allowance", leftMargin, currentY);
      currentY = doc.y + 6;
      const specialDesc = `Special Allowance is a flexible salary component paid to employees as part of their Cost to Company (CTC) that does not fall under any other defined category such as HRA, Conveyance, or Medical Allowance. It is usually used to balance the salary structure after allocating fixed components. Your Special Allowance is 26.19% of Basic Salary.`;
      doc
        .font("Helvetica")
        .text(specialDesc, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });
      currentY = doc.y + 11;

      // SOCIAL SECURITY
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("SOCIAL SECURITY / RETIRALS BENEFIT", leftMargin, currentY);

      // Draw underline for "SOCIAL SECURITY / RETIRALS BENEFIT:"
      const socialTextWidth = doc.widthOfString(
        "SOCIAL SECURITY / RETIRALS BENEFIT"
      );
      doc
        .moveTo(leftMargin, currentY + 10)
        .lineTo(leftMargin + socialTextWidth, currentY + 10)
        .stroke();

      currentY = doc.y + 11;

      // Provident Fund
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("Provident Fund", leftMargin, currentY);
      currentY = doc.y + 6;
      const pfDesc1 = `You will be enrolled as a member of the Employees' Provident Fund (EPF) in accordance with the provisions of the Employees' Provident Fund and Miscellaneous Provisions Act, 1952.

Kiaq Technologies will contribute 12% of your basic salary each month towards the Provident Fund, as per statutory requirements. An equal contribution will be deducted from your salary and remitted to your EPF account. Kiaq includes the employer's contribution to the Provident Fund (PF) in the Cost to Company (CTC) structure for the following reasons:`;
      doc
        .font("Helvetica")
        .text(pfDesc1, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });
      currentY = doc.y + 11;

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(
          "It Is a Statutory Cost Borne by the Company",
          leftMargin,
          currentY
        );

      currentY = doc.y + 6;
      const pfDesc2 = `As per the Employees' Provident Fund & Miscellaneous Provisions Act, 1952, Kiaq contributes 12% of your Basic Salary toward your PF account. This is a mandatory expense the company incurs on your behalf.`;

      doc
        .font("Helvetica")
        .text(pfDesc2, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });
      currentY = doc.y + 11;

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(
          "It Is a Long-Term Financial Benefit to You",
          leftMargin,
          currentY
        );

      currentY = doc.y + 6;
      const pfDesc3 = `Although this amount is not directly credited to your take-home salary, it is deposited into your PF account monthly and contributes to your retirement corpus, making it a significant part of your total compensation package.`;

      doc
        .font("Helvetica")
        .text(pfDesc3, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });
      currentY = doc.y + 11;

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(
          "It Reflects the True Annual Cost of Employing You",
          leftMargin,
          currentY
        );

      currentY = doc.y + 6;
      const pfDesc4 = `Including employer PF contribution in the CTC ensures transparency in the full financial commitment made by the company. It gives you a clear picture of the total value of your compensation, beyond just monthly take-home pay. At the time of joining, you are required to:
            Provide your Universal Account Number (UAN), if already issued by a previous employer, or Submit your previous PF and/or Pension Account Number via the Declaration Form (Form 9).

            This will facilitate the linking of your existing UAN to your new PF account with Kiaq Technologies. If you do not have a UAN, a new one will be generated and communicated to you accordingly.`;

      doc
        .font("Helvetica")
        .text(pfDesc4, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });
      currentY = doc.y + 11;

      // Gratuity
      doc.font("Helvetica-Bold").text("Gratuity", leftMargin, currentY);
      currentY = doc.y + 6;
      const gratuityDesc = `Gratuity is a lump sum amount paid by an employer to an employee as a token of appreciation for their services, upon resignation, retirement, or death, provided the employee has served the organization for a minimum of 5 continuous years. It is governed by the payment of gratuity Act, 1972 in India. Gratuity is 4.81% of basic salary as per government norms.`;
      doc
        .font("Helvetica")
        .text(gratuityDesc, leftMargin, currentY, {
          width: contentWidth,
          align: "justify",
        });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatLongDate(date) {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const day = date.getDate();
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();

  return `${month} ${day}, ${year}`;
}

export const saveOfferLetter = async (pdfBuffer, applicationId) => {
  const uploadsDir = path.join(__dirname, "../uploads/offer-letters");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const filename = `offer_${applicationId}_${Date.now()}.pdf`;
  const filepath = path.join(uploadsDir, filename);
  await fs.promises.writeFile(filepath, pdfBuffer);
  return filename;
};
