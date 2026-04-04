import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to add letterhead to each page
function addLetterheadToPage(doc, letterheadPath) {
  if (fs.existsSync(letterheadPath)) {
    doc.image(letterheadPath, 0, 0, { width: 595.28, height: 841.89 });
  }
}

export const generateAppointmentLetter = async (employee) => {
  return new Promise((resolve, reject) => {
    try {
      const letterheadPath = path.join(
        process.cwd(),
        "public",
        "letterhead.png"
      );

      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        bufferPages: true,
        info: {
          Title: `Appointment Letter - ${employee.user.fullName}`,
          Author: "KIAQ Technologies Pvt Ltd",
          Subject: `Letter of Appointment for ${employee.user.fullName}`,
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

      // Add letterhead to first page
      addLetterheadToPage(doc, letterheadPath);

      // Content margins (same as offer letter)
      const leftMargin = 70;
      const rightMargin = 525;
      const topMargin = 130;
      const contentWidth = rightMargin - leftMargin;

      let currentY = topMargin;

      // ─── PAGE 1 ────────────────────────────────────────────────────────────

      // Date (right-aligned, bold)
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text(
          formatLongDate2(new Date()),
          leftMargin,
          currentY,
          { width: contentWidth, align: "right" }
        );

      currentY = doc.y + 15;

      // Salutation
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text(`Dear  ${employee.user.fullName},`, leftMargin, currentY);

      currentY = doc.y + 20;

      // Title
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Letter of Appointment", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "You will be issued a formal Letter of Appointment upon successful completion of all joining formalities, in accordance with the company's policies and procedures.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Terms and Conditions
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Terms and Conditions", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "The terms and conditions outlined herein are applicable specifically to your employment in India. These conditions are subject to change in the event of your deputation to an international assignment, in which case the applicable terms will be communicated separately and will govern your employment during such deputation.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Employment in India
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Employment in India", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "If you are not a citizen of India, this offer is contingent upon your obtaining a valid work permit and any other necessary approvals or documentation as required by the Government of India for permanent employment with KIAQ.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Rules and Regulations
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Rules and Regulations of the Company", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "Your appointment will be governed by the company's policies, rules, regulations, practices, processes, and procedures, as applicable to your role. These may be amended from time to time at the company's discretion, and you will be expected to adhere to all such changes.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Background Check
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Background Check", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "Your employment is subject to a background verification process, in accordance with the company's background check policy. This process will be conducted by a designated third-party agency and may include both internal and external verifications. Typically, the background check is completed within six months of your date of joining.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text(
        "This offer of employment is conditional upon the assurance that you have not been convicted of, or found guilty of, any criminal offense in the past.",
        leftMargin,
        currentY,
        { width: contentWidth, align: "justify" }
      );

      currentY = doc.y + 10;

      doc.text(
        "If the background check reveals any adverse findings or discrepancies in the information provided by you, the company reserves the right to withdraw this offer or terminate your employment without notice.",
        leftMargin,
        currentY,
        { width: contentWidth, align: "justify" }
      );

      currentY = doc.y + 16;

      // International Deputation Agreement
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("International Deputation Agreement", leftMargin, currentY);

      currentY = doc.y + 8;

      // Mixed bold/regular paragraph
      doc
        .fontSize(10)
        .font("Helvetica")
        .text("You will be required to sign the ", leftMargin, currentY, {
          continued: true,
        });
      doc
        .font("Helvetica-Bold")
        .text("Master International Deputation Agreement (MIDA)", {
          continued: true,
        });
      doc
        .font("Helvetica")
        .text(
          ", a one-time agreement applicable for the entire duration of your employment with the company. As per this agreement, you must serve KIAQ for a ",
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("minimum of 90 days", { continued: true });
      doc
        .font("Helvetica")
        .text(
          " following the completion of any ",
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("overseas deputation exceeding 30 days.", {
          width: contentWidth,
          align: "justify",
        });

      // ─── PAGE 2 ────────────────────────────────────────────────────────────
      doc.addPage();
      addLetterheadToPage(doc, letterheadPath);
      currentY = topMargin;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "This requirement ensures that the knowledge and experience acquired during such deputation is effectively transferred and shared with the company and its employees in India. This knowledge transfer is critical to maintaining the company's service quality and supporting its clients and customers.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "In addition, if you are deputed internationally for ",
          leftMargin,
          currentY,
          { continued: true }
        );
      doc.font("Helvetica-Bold").text("training purposes", { continued: true });
      doc
        .font("Helvetica")
        .text(
          ", you will be required to sign a separate agreement committing to serve the company for a ",
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("minimum of 90 days", { continued: true });
      doc
        .font("Helvetica")
        .text(" upon completion of each such training program.", {
          width: contentWidth,
          align: "justify",
        });

      currentY = doc.y + 16;

      // Place of Posting
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Place of Posting", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("Your initial place of posting will be at the ", leftMargin, currentY, {
          continued: true,
        });
      doc.font("Helvetica-Bold").text("Chennai Office", { continued: true });
      doc
        .font("Helvetica")
        .text(
          ". You are expected to perform the duties assigned to you at this location and undertake any additional responsibilities or assignments as may be entrusted to you by the management from time to time.",
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Mobility
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Mobility", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "The Company reserves the right to transfer or utilize your services, at its sole discretion, to any of its offices, project sites, associate or affiliate entities—whether currently existing or established in the future—within India or abroad. Such transfers will be governed by the terms and conditions applicable to you at the time of transfer.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text(
        "Failure to report to the assigned location within the stipulated period may result in the termination of your employment. This is without prejudice to the Company's right to initiate disciplinary action under the ",
        leftMargin,
        currentY,
        { continued: true, width: contentWidth, align: "justify" }
      );
      doc
        .font("Helvetica-Bold")
        .text("Industrial Employment (Standing Orders) Act, 1946.", {
          width: contentWidth,
          align: "justify",
        });

      currentY = doc.y + 16;

      // Work From Home Policy
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Work From Home (WFH) Policy", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "The KIAQ may, at its sole discretion and subject to business requirements, permit employees to work from home (WFH), either on a temporary or long-term basis. Approval for WFH is governed by the Company's internal ",
          leftMargin,
          currentY,
          { continued: true }
        );
      doc.font("Helvetica-Bold").text("Work From Home Policy", { continued: true });
      doc
        .font("Helvetica")
        .text(
          ", which may vary based on role, department, project needs, and management discretion.",
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      // WFH bullet points
      const wfhPoints = [
        {
          bold: "Eligibility:",
          text: " Only roles deemed suitable for remote work are eligible for WFH. Approval must be obtained from your reporting manager and HR.",
        },
        {
          bold: "Working Hours & Availability:",
          text: " While working from home, you are expected to adhere to regular working hours and remain accessible via official communication channels.",
        },
        {
          bold: "Confidentiality & Data Security:",
          text: " You must strictly comply with all confidentiality, data protection, and IT usage policies during WFH. Any misuse or data breach may lead to disciplinary action.",
        },
        {
          bold: "Assets & Infrastructure:",
          text: " The Company may provide or require use of certain equipment (e.g., laptop, VPN access) for WFH. Employees are responsible for maintaining a safe and productive work environment at home.",
        },
        {
          bold: "Discretionary Nature:",
          text: " WFH is not an entitlement. The KIAQ reserves the right to modify, suspend, or withdraw the WFH option at any time without prior notice.",
        },
      ];

      wfhPoints.forEach((point) => {
        doc.fontSize(10).font("Helvetica").text("•", leftMargin, currentY);
        doc
          .font("Helvetica-Bold")
          .text(point.bold, leftMargin + 15, currentY, { continued: true });
        doc
          .font("Helvetica")
          .text(point.text, { width: contentWidth - 15, align: "justify" });
        currentY = doc.y + 6;
      });

      currentY = doc.y + 4;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "This policy is subject to change and will be reviewed periodically to align with evolving business and regulatory requirements.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // WFH Misuse
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Work From Home (WFH) – Misuse or Underperformance", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "Work From Home (WFH) is provided at the sole discretion of the Company and is subject to performance, compliance, and business needs.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text("If an employee is found to be:", leftMargin, currentY, {
        width: contentWidth,
      });

      currentY = doc.y + 6;

      // ─── PAGE 3 ────────────────────────────────────────────────────────────
      doc.addPage();
      addLetterheadToPage(doc, letterheadPath);
      currentY = topMargin;

      // Misuse bullets
      doc.fontSize(10).font("Helvetica").text("•", leftMargin, currentY);
      doc
        .font("Helvetica-Bold")
        .text("Misusing the WFH facility", leftMargin + 15, currentY, {
          continued: true,
        });
      doc
        .font("Helvetica")
        .text(
          ", including but not limited to unauthorized absence during work hours, non-adherence to company policies, or breach of confidentiality or IT security protocols; or",
          { width: contentWidth - 15, align: "justify" }
        );

      currentY = doc.y + 6;

      doc.font("Helvetica").text("•", leftMargin, currentY);
      doc
        .font("Helvetica-Bold")
        .text(
          "Failing to deliver expected levels of output or productivity",
          leftMargin + 15,
          currentY,
          { continued: true }
        );
      doc
        .font("Helvetica")
        .text(
          " while working remotely, the Company reserves the right to ",
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("immediately withdraw WFH privileges without prior notice", {
          continued: true,
        });
      doc
        .font("Helvetica")
        .text(
          " and may require the employee to report to the designated office location. Further disciplinary action may be initiated as deemed appropriate by the management.",
          { width: contentWidth - 15, align: "justify" }
        );

      currentY = doc.y + 16;

      // Working Hours
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Working Hours", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "You may be required to work in shifts and/or beyond regular working hours, as permitted under applicable laws. Your work schedule will be determined based on business requirements and project needs.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Leave
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Leave", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "You will be entitled to leave in accordance with the Company's Leave Policy, as applicable to your role and location. The policy may be revised from time to time at the Company's discretion.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Increments and Promotions
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Increments and Promotions", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("Salary increments and promotions will be governed by the ", leftMargin, currentY, {
          continued: true,
        });
      doc
        .font("Helvetica-Bold")
        .text("Company's Compensation and Promotion Policy", { continued: true });
      doc
        .font("Helvetica")
        .text(
          " and will not be automatic. Key considerations will include your merit, individual performance, contribution to the Company, attendance, behavior, and overall conduct during the review period, along with the Company's performance.",
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "All decisions regarding increments and promotions will be made at the sole discretion of the Company and in accordance with applicable policies, which may be amended from time to time.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Alternate Employment
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Alternate Employment", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("As a full-time associate of ", leftMargin, currentY, {
          continued: true,
        });
      doc.font("Helvetica-Bold").text("KIAQ", { continued: true });
      doc
        .font("Helvetica")
        .text(
          ", you are not permitted to engage in any other employment, business activity, or assume any public or private office—whether honorary or remunerative—without the prior written approval of the Company.",
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Confidentiality Agreement
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Confidentiality Agreement", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "As part of the joining formalities, you will be required to sign a ",
          leftMargin,
          currentY,
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("Confidentiality Agreement ", { continued: true });
      doc
        .font("Helvetica")
        .text(
          " to safeguard the intellectual property, proprietary information, and business interests of the Company and its clients. You are expected to maintain strict confidentiality during and after your tenure with the Company.",
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Pay for Performance
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Pay for Performance/Services", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "The salary and benefits provided to you are in consideration of the services you are expected to perform for and on behalf of the Company. You are required to devote your full attention, dedication, and commitment to your assigned duties and responsibilities at all times during your employment.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text(
        "You are expected to complete all tasks with sincerity and consistently deliver work of a high standard. Failure to meet performance expectations or deadlines may be treated as an act of indiscipline, incapacity, or both, and may invite disciplinary action as per Company policy.",
        leftMargin,
        currentY,
        { width: contentWidth, align: "justify" }
      );

      // ─── PAGE 4 ────────────────────────────────────────────────────────────
      doc.addPage();
      addLetterheadToPage(doc, letterheadPath);
      currentY = topMargin;

      // Values, Integrity
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Values, Integrity, Honesty and Ethics", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("During the course of your employment with ", leftMargin, currentY, {
          continued: true,
        });
      doc.font("Helvetica-Bold").text("KIAQ", { continued: true });
      doc
        .font("Helvetica")
        .text(
          ", you are expected to uphold the values, integrity, and ethical standards of the organization, as well as those of society at large.",
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "If, at any time during or after your employment, it is found, reported, or established that you have willfully violated these principles—whether by direct action, by supporting or concealing such violations, or by failing to report acts that were within your knowledge—it will be considered a serious breach of this clause.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text(
        "Any such violation will be dealt with strictly and may result in disciplinary action, including termination, as deemed appropriate by the management based on the severity of the breach.",
        leftMargin,
        currentY,
        { width: contentWidth, align: "justify" }
      );

      currentY = doc.y + 16;

      // Confidentiality of Information
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Confidentiality of Information and Privileges", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "a. During your employment, you may be granted specific rights and privileges—either by the Company or by its clients—based on the requirements of your role. These are strictly for professional use and must only be exercised for the purposes intended. Under no circumstances should these rights or privileges be used for personal gain or to confer undue advantage to any third party.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text(
        "b. Your salary package has been determined based on multiple factors, including your educational qualifications, industry experience, assessed skill levels, and suitability for the role. Therefore, it is unique and personal to you. Any comparisons with the compensation of other employees based solely on years of experience may be inaccurate, misleading, and inappropriate.",
        leftMargin,
        currentY,
        { width: contentWidth, align: "justify" }
      );

      currentY = doc.y + 10;

      doc.text(
        "c. If deputed to a client location, you are expected to maintain complete confidentiality regarding your salary, allowances, and any other remuneration. Such details should not be discussed with or disclosed to any client personnel, in order to preserve ethical and professional business relations.",
        leftMargin,
        currentY,
        { width: contentWidth, align: "justify" }
      );

      currentY = doc.y + 16;

      // Secrecy
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Secrecy", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "While performing your duties, you may have access to confidential or proprietary information, including trade secrets and sensitive documents related to KIAQ, its employees, clients, partners, or business associates.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text(
        "You are strictly prohibited from disclosing such information—either directly or indirectly, in any form—to any unauthorized individual or entity, both during and after your employment, unless explicitly permitted by the Management of KIAQ.",
        leftMargin,
        currentY,
        { width: contentWidth, align: "justify" }
      );

      currentY = doc.y + 16;

      // Specialized Training
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Specialized Training / Learning Opportunities", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "If you are provided with any specialized training by KIAQ including on-the-job training related to technology, domain knowledge, or process areas you may be required to sign a training bond. This bond will specify a minimum period of continued employment with the Company, ensuring that both you and the organization derive mutual benefit from the investment made in your professional development.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // Company-Provided Assets
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Company-Provided Assets", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "You may be issued various assets, documents, or equipment by the Company or its clients to support the execution of your project, assignment, or role. These assets are strictly intended for official use and must be used solely by you.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      // ─── PAGE 5 ────────────────────────────────────────────────────────────
      doc.addPage();
      addLetterheadToPage(doc, letterheadPath);
      currentY = topMargin;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "Under no circumstances should these assets be shared, transferred, or handed over to any third party without the ",
          leftMargin,
          currentY,
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("prior written approval of KIAQ management.", {
          width: contentWidth,
          align: "justify",
        });

      currentY = doc.y + 16;

      // General Conduct
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("General Conduct, Rules & Regulations", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "During your employment with the Company, you will be subject to all applicable Company policies and rules, including but not limited to those governing attendance, leave, disciplinary actions, Provident Fund, Gratuity, Group Medical Insurance Scheme, and any other policies or procedures in effect or introduced from time to time.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text(
        "If, in the opinion of the Management, you are found guilty of misconduct, including but not limited to dishonesty, negligence, indiscipline, or violation of any terms of this appointment letter or Company policies, your services may be terminated ",
        leftMargin,
        currentY,
        { continued: true, width: contentWidth }
      );
      doc
        .font("Helvetica-Bold")
        .text("without notice or compensation.", {
          width: contentWidth,
          align: "justify",
        });

      currentY = doc.y + 16;

      // Undertaking on Non-Criminality
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Undertaking on Non-Criminality", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "This offer of employment is extended to you in good faith, based on your assurance during the selection process that:",
          leftMargin,
          currentY,
          { width: contentWidth }
        );

      currentY = doc.y + 8;

      const nonCriminalityPoints = [
        { bold: "not facing any criminal charges", prefix: "You are ", suffix: " in India or abroad." },
        { bold: "not been convicted", prefix: "You have ", suffix: " of any criminal offense by a Court of Law in any jurisdiction." },
        { bold: "not associated with or a member of any banned organization(s)", prefix: "You are ", suffix: ", nor involved in any activity detrimental to the interests of any government, nation, society, or community." },
      ];

      nonCriminalityPoints.forEach((point) => {
        doc.fontSize(10).font("Helvetica").text("•", leftMargin, currentY);
        doc
          .font("Helvetica")
          .text(point.prefix, leftMargin + 15, currentY, { continued: true });
        doc.font("Helvetica-Bold").text(point.bold, { continued: true });
        doc
          .font("Helvetica")
          .text(point.suffix, { width: contentWidth - 15, align: "justify" });
        currentY = doc.y + 6;
      });

      currentY = doc.y + 8;

      // a. Unauthorised Absence
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("a.   Unauthorised Absence", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "If you remain absent from work for a continuous period of ",
          leftMargin,
          currentY,
          { continued: true }
        );
      doc.font("Helvetica-Bold").text("five (5) days", { continued: true });
      doc
        .font("Helvetica")
        .text(
          " or more without approved leave or without obtaining your reporting manager's consent, you shall be deemed to have ",
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("voluntarily abandoned your employment", { continued: true });
      doc
        .font("Helvetica")
        .text(", and your services may be terminated without notice.", {
          width: contentWidth,
          align: "justify",
        });

      currentY = doc.y + 16;

      // b. Probation
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("b.   Probation", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("You will be on probation for an initial period of ", leftMargin, currentY, {
          continued: true,
        });
      doc.font("Helvetica-Bold").text("180 days", { continued: true });
      doc
        .font("Helvetica")
        .text(
          " from the date of joining. Your confirmation as a permanent employee will be subject to satisfactory performance and will be ",
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("communicated in writing", { continued: true });
      doc
        .font("Helvetica")
        .text(
          ". The Company reserves the right to confirm your employment earlier or extend the probation period at its discretion.",
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 16;

      // c. Misrepresentation
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("c.   Misrepresentation of Information", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "If at any time it is discovered that information provided by you—whether in your application or during the selection process—is ",
          leftMargin,
          currentY,
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("false, misleading, or incomplete", { continued: true });
      doc
        .font("Helvetica")
        .text(", or if you have ", { continued: true });
      doc
        .font("Helvetica-Bold")
        .text("suppressed any material", { continued: true });
      doc
        .font("Helvetica")
        .text(
          " information regarding your qualifications or experience, your services may be terminated ",
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("without notice or compensation.", {
          width: contentWidth,
          align: "justify",
        });

      currentY = doc.y + 16;

      // d. Termination Post-Confirmation
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("d.   Termination Post-Confirmation", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "After confirmation of your employment, either you or the Company may terminate the employment by providing the required notice as per Company policy. However, due to business exigencies, the Company reserves the right to:",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 8;

      doc.fontSize(10).font("Helvetica").text("•", leftMargin, currentY);
      doc
        .font("Helvetica")
        .text("Reject salary in lieu of notice and require you to ", leftMargin + 15, currentY, {
          continued: true,
        });
      doc
        .font("Helvetica-Bold")
        .text("serve the full or partial notice period", {
          width: contentWidth - 15,
        });
      currentY = doc.y + 6;

      doc.font("Helvetica").text("•", leftMargin, currentY);
      doc
        .font("Helvetica")
        .text("Consider you relieved only upon issuance of a formal ", leftMargin + 15, currentY, {
          continued: true,
        });
      doc
        .font("Helvetica-Bold")
        .text("relieving letter", { continued: true });
      doc.font("Helvetica").text(" by the Company.", { width: contentWidth - 15 });

      currentY = doc.y + 10;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("In case of ", leftMargin, currentY, { continued: true });
      doc
        .font("Helvetica-Bold")
        .text("relieving without serving the notice period", { continued: true });
      doc.font("Helvetica").text(", your ", { continued: true });
      doc.font("Helvetica-Bold").text("final settlement", { continued: true });
      doc
        .font("Helvetica")
        .text(" will be processed ", { continued: true });
      doc.font("Helvetica-Bold").text("within three (3) months", { continued: true });
      doc
        .font("Helvetica")
        .text(" from the date of termination or relieving.", {
          width: contentWidth,
          align: "justify",
        });

      // ─── PAGE 6 ────────────────────────────────────────────────────────────
      doc.addPage();
      addLetterheadToPage(doc, letterheadPath);
      currentY = topMargin;

      // Law and Jurisdiction
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Law and Jurisdiction", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "This appointment shall be governed by the laws of ",
          leftMargin,
          currentY,
          { continued: true }
        );
      doc.font("Helvetica-Bold").text("India", { continued: true });
      doc
        .font("Helvetica")
        .text(
          ", and any disputes or legal proceedings arising out of or in connection with your employment shall be subject to the ",
          { continued: true }
        );
      doc
        .font("Helvetica-Bold")
        .text("exclusive jurisdiction of the courts located in Chennai.", {
          width: contentWidth,
          align: "justify",
        });

      currentY = doc.y + 16;

      // Acknowledgement and Acceptance
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Acknowledgement and Acceptance", leftMargin, currentY);

      currentY = doc.y + 8;

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          "Please read this letter carefully. If the terms and conditions outlined herein are acceptable to you, kindly sign and return the duplicate copy as a token of your understanding and acceptance.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 10;

      doc.text(
        "We welcome you to ",
        leftMargin,
        currentY,
        { continued: true }
      );
      doc.font("Helvetica-Bold").text("KIAQ", { continued: true });
      doc
        .font("Helvetica")
        .text(
          " and look forward to your valuable contribution. We wish you a rewarding and successful career with us.",
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 40;

      // Declaration and Acceptance
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Declaration and Acceptance", leftMargin, currentY);

      currentY = doc.y + 16;

      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text(
          "I, the undersigned, have read, understood, and hereby accept all the terms and conditions outlined in this letter of appointment. I agree to abide by the company's policies, rules, and regulations as amended from time to time.",
          leftMargin,
          currentY,
          { width: contentWidth, align: "justify" }
        );

      currentY = doc.y + 50;

      // Signature line
      doc.fontSize(10).font("Helvetica");
      doc.text("Employee Signature :", leftMargin, currentY);
      doc.text("Employee Name :", leftMargin + 190, currentY);
      doc.text("Date :", leftMargin + 390, currentY);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

export const saveAppointmentLetter = async (pdfBuffer, employeeName) => {
  const uploadsDir = path.join(__dirname, "../uploads/appointment-letters");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const filename = `appointment_${employeeName}_${Date.now()}.pdf`;
  const filepath = path.join(uploadsDir, filename);
  await fs.promises.writeFile(filepath, pdfBuffer);
  return filename;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatLongDate2(date) {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const day = date.getDate();
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}