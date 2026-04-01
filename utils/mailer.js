// import dotenv from 'dotenv'
// dotenv.config()
// import Brevo from "@getbrevo/brevo";
// import { offerLetterEmailTemplate, offerStatusUpdateTemplate } from './emailTemplates.js';

// const apiInstance = new Brevo.TransactionalEmailsApi();

// apiInstance.setApiKey(
//     Brevo.TransactionalEmailsApiApiKeys.apiKey,
//     process.env.BREVO_API_KEY
// );

// export const sendMail = async ({ to, subject, html }) => {
//     try {
//         const emailData = {
//             sender: {
//                 name: "Prakash",
//                 email: process.env.MAIL_FROM
//             },
//             to: [{ email: to }],
//             subject,
//             htmlContent: html,
//         };

//         await apiInstance.sendTransacEmail(emailData);

//     } catch (error) {
//         console.log("BREVO ERROR:", error.response?.body || error);
//         return error
//     }
// };

// export const sendOfferEmail = async (candidate, application, pdfBuffer) => {
//     try {
//         const htmlContent = offerLetterEmailTemplate(candidate, application, application.offerDetails);

//         const emailData = {
//             sender: {
//                 name: process.env.COMPANY_NAME || "HR Department",
//                 email: process.env.MAIL_FROM
//             },
//             to: [
//                 {
//                     email: candidate.email,
//                     name: candidate.fullName
//                 }
//             ],
//             subject: `Offer of Employment - ${application.job.title} - ${application.job.department}`,
//             htmlContent: htmlContent,
//             attachment: [
//                 {
//                     name: `Offer_Letter_${application.job.title.replace(/\s+/g, '_')}.pdf`,
//                     content: pdfBuffer.toString('base64')
//                 }
//             ]
//         };

//         const result = await apiInstance.sendTransacEmail(emailData);
//         return result;

//     } catch (error) {
//         console.error('Error sending offer email via Brevo:', error.response?.body || error);
//         return error
//     }
// };

// export const sendOfferStatusEmail = async (candidate, application, status) => {
//     try {
//         const htmlContent = offerStatusUpdateTemplate(candidate, application, status);

//         const emailData = {
//             sender: {
//                 name: process.env.COMPANY_NAME || "HR Department",
//                 email: process.env.MAIL_FROM
//             },
//             to: [
//                 {
//                     email: candidate.email,
//                     name: candidate.fullName
//                 }
//             ],
//             subject: `Offer Update - ${application.job.title}`,
//             htmlContent: htmlContent
//         };

//         const result = await apiInstance.sendTransacEmail(emailData);
//         return result;

//     } catch (error) {
//         console.error('Error sending offer status email via Brevo:', error.response?.body || error);
//         return error
//     }
// };

import dotenv from "dotenv";
dotenv.config();
import nodemailer from "nodemailer";
import Mailjet from 'node-mailjet';
import { appointmentLetterEmailTemplate } from "./emailTemplates.js";

// Create SMTP transporter (Gmail)
// const transporter = nodemailer.createTransport({
//     service: "gmail",
//     auth: {
//         user: process.env.MAIL_FROM,
//         pass: process.env.MAIL_PASS, // Gmail App Password
//     },
// });

// const transporter = nodemailer.createTransport({
//     host: "mail.kiaq.in",
//     port: 587,
//     secure: false,
//     auth: {
//         user: process.env.MAIL_FROM,
//         pass: process.env.MAIL_PASS,
//     },
// });

export const SendMailJet = async ({ to, subject, html, attachments = [] }) => {
    const mailjet = Mailjet.apiConnect(
        process.env.MAILJET_API_KEY,
        process.env.MAILJET_SECRET_KEY
    );
    try {
        const response = await mailjet
            .post('send', { version: 'v3.1' })
            .request({
                Messages: [
                    {
                        From: { Email: process.env.MAIL_FROM, Name: 'KIAQ CAREER' },
                        To: [{ Email: to }],
                        Subject: subject,
                        HTMLPart: html,
                        Attachments: attachments,
                    },
                ],
            })
        return response.body;

    } catch (err) {
        console.log("Mailjet Error:", err?.statusCode, err?.message);
    }
}

// ----------------------------
// 1. GENERAL EMAIL SENDER
// ----------------------------
export const sendMail = async ({ to, subject, html }) => {
    try {
        // const mailOptions = {
        //     from: `"KIAQ TECHNOLOGIES PRIVATE LIMITED" <${process.env.MAIL_FROM}>`,
        //     to,
        //     subject,
        //     html,
        // };

        // await transporter.sendMail(mailOptions);
        await SendMailJet({ to, subject, html });
        return { success: true };

    } catch (error) {
        console.log("NODEMAILER ERROR:", error);
        return { success: false, error: error?.message };
    }
};





export const sendAppointmentEmail = async (employee, pdfBuffer) => {
  try {
    const htmlContent = appointmentLetterEmailTemplate(employee);

    const subject = `LETTER OF APPOINTMENT - WELCOME TO ${process.env.COMPANY_NAME}`;

    const attachment = [
      {
        ContentType: "application/pdf",
        Filename: `${employee.firstName}_AppointmentLetter.pdf`,
        Base64Content: pdfBuffer.toString("base64"),
      }
    ];

    await SendMailJet({
  to: employee.officialEmail,
  subject: subject,
  html: htmlContent,
  attachments: [
    {
      ContentType: "application/pdf",
      Filename: `${employee.firstName}_AppointmentLetter.pdf`,
      Base64Content: pdfBuffer.toString("base64"),
    }
  ],
});

    // return result;

  } catch (error) {
    console.log("Appointment Email Error:", error);
    return error;
  }
};