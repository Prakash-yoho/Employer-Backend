
export const otpSendTemplate = (user, otp) => `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf3eb;padding:40px 0;font-family:Arial, sans-serif;">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">

        <!-- Header -->
        <tr>
          <td style="background:#FC8019;padding:22px;text-align:center;color:#ffffff;font-size:22px;font-weight:bold;">
            🔐 Email Verification OTP
          </td>
        </tr>

        <!-- Content -->
        <tr>
          <td style="padding:35px;">
            <p style="font-size:17px;color:#111827;margin:0;">
              Hello <strong>${user?.fullName}</strong>,
            </p>

            <p style="font-size:15px;color:#4b5563;margin:18px 0;">
              Please use the verification code below to complete your email verification process on 
              <strong>Job Portal</strong>.
            </p>

            <!-- OTP Box -->
            <div style="margin:30px 0;text-align:center;">
              <p style="
                display:inline-block;
                background:#fff7f2;
                padding:18px 30px;
                font-size:30px;
                font-weight:bold;
                color:#FC8019;
                border:2px dashed #FC8019;
                border-radius:10px;
                letter-spacing:6px;
              ">
                ${otp}
              </p>
            </div>

            <p style="font-size:15px;color:#4b5563;margin-top:10px;">
              ⚠️ This OTP is valid for <strong>3 minutes</strong>.
            </p>

            <p style="font-size:15px;color:#4b5563;margin-top:12px;">
              If you did not request this code, please ignore this email.
            </p>

            <p style="font-size:16px;color:#111827;margin-top:30px;">
              Regards,<br />
              <strong>Job Portal</strong>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
`;

export const forgotPasswordOtpTemplate = (user, otp) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #ffffff;
      padding: 0;
      margin: 0;
      color: #111111;
    }
    .container {
      max-width: 620px;
      margin: 0 auto;
      padding: 20px;
    }
    p {
      font-size: 15px;
      line-height: 1.6;
      margin: 10px 0;
    }
    .otp-box {
      font-size: 28px;
      font-weight: bold;
      letter-spacing: 6px;
      text-align: center;
      margin: 30px 0;
      padding: 15px 0;
      border: 1px solid #cccccc;
      border-radius: 6px;
    }
  </style>
</head>

<body>
  <div class="container">

    <p>Dear <strong>${user?.fullName}</strong>,</p>

    <p>
      You recently initiated a request to reset the password for your account on the 
      <strong>KIAQ Career Portal</strong>. To verify your identity and proceed with the password
      reset, please use the One-Time Password (OTP) provided below.
    </p>

    <div class="otp-box">
      ${otp}
    </div>

    <p>
      This OTP is valid for 2 minutes. Please do not share this code with anyone.
    </p>

    <p>
      If you did not request a password reset, you may safely ignore this email. Your account will remain secure.
    </p>

    <p>
      Regards,<br />
      <strong>${process.env.COMPANY_NAME}</strong>
    </p>

    <p style="font-size: 12px; color: #555; margin-top: 25px;">
      This is an automated email. Please do not reply to this message.
    </p>

  </div>
</body>
</html>
`;


export const offerLetterEmailTemplate = (candidate, application) => {

  return `
  <!DOCTYPE html>
  <html>
  <head>
      <style>
          body {
              font-family: Arial, Helvetica, sans-serif;
              background: #ffffff;
              margin: 0;
              padding: 0;
              color: #111111;
          }
          .container {
              max-width: 620px;
              margin: 0 auto;
              padding: 20px;
          }
          p {
              line-height: 1.6;
              font-size: 15px;
          }
          .details-section {
              margin: 20px 0;
              padding: 15px 0;
              border-top: 1px solid #ddd;
              border-bottom: 1px solid #ddd;
          }
          .detail-item {
              margin: 8px 0;
          }
      </style>
  </head>

  <body>
      <div class="container">

          <p>Dear <strong>${candidate.fullName}</strong>,</p>

          <p>
            We are pleased to offer you the position of 
            <strong>${application.job.title}</strong> at 
            <strong>${process.env.COMPANY_NAME || "our organization"}</strong>.
          </p>

          <p>
            Attached, you will find your official offer letter outlining the compensation
            details, joining information, and other relevant terms.
          </p>

          <p>
            We are excited to welcome you to our team and look forward to your contributions 
            as we continue to grow together. Your skills and experience will be a valuable 
            addition to our organization.
          </p>

          <p>
            Should you have any questions or need clarification, feel free to contact us at 
            <strong>${process.env.COMPANY_EMAIL || "hr@kiaq.in"}</strong>.
          </p>

          <p>
            Once again, welcome to ${process.env.COMPANY_NAME || "career@kiaq.in"}.  
            We look forward to working with you.
          </p>

          <p style="font-size: 12px; color: #555; margin-top: 20px;">
              This is an automated email. Please do not reply to this message.
          </p>

      </div>
  </body>
  </html>
  `;
};


export const appointmentLetterEmailTemplate = (employee) => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8" />
      <style>
          body {
              font-family: Arial, Helvetica, sans-serif;
              background: #ffffff;
              margin: 0;
              padding: 0;
              color: #111111;
          }
          .container {
              max-width: 620px;
              margin: 0 auto;
              padding: 20px;
          }
          p {
              font-size: 15px;
              line-height: 1.6;
              margin: 12px 0;
          }
          h2 {
              font-size: 18px;
              margin-bottom: 10px;
          }
          ul {
              margin: 10px 0 20px 20px;
          }
          .footer-text {
              font-size: 12px;
              color: #555555;
              margin-top: 30px;
              text-align: left;
          }
      </style>
  </head>

  <body>
      <div class="container">

          <p>Dear <strong>${employee.firstName} ${employee.lastName}</strong>,</p>

          <p>We are delighted to officially welcome you to <strong>${process.env.COMPANY_NAME}</strong>.</p>

          <p>Your <strong>Appointment Letter</strong> has been issued and is attached to this email.</p>

          <h2>Employee Details</h2>
          <p><strong>Employee ID:</strong> ${employee.employeeId}</p>
          <p><strong>Designation:</strong> ${employee.designation}</p>
          <p><strong>Department:</strong> ${employee.department}</p>

          <h2>Steps to Accept Your Appointment Letter</h2>
          <p>Please follow the steps below to acknowledge your appointment letter in the portal:</p>
          <ul>
              <li>Log in to the company portal using your credentials.</li>
              <li>Navigate to the <strong>Company Policies</strong> tab.</li>
              <li>Click on <strong>Appointment Letter</strong> to view the document.</li>
              <li>Review the details carefully and click <strong>Accept and Sign</strong> to acknowledge.</li>
          </ul>

          <p>We look forward to your valuable contribution and wish you a successful career with us.</p>

          <p>Best Regards,<br />
          <strong>${process.env.COMPANY_NAME}</strong>
          </p>

          <p class="footer-text">
              This is an automated email. Please do not reply to this message.
          </p>

      </div>
  </body>
  </html>
  `;
};


export const offerStatusUpdateTemplate = (candidate, application, status) => {
  const statusMessages = {
    "offer accepted": {
      title: "Offer Accepted",
      message: "We are pleased to confirm that you have accepted the offer."
    },
    "offer rejected": {
      title: "Offer Declined",
      message: "We acknowledge that you have declined the offer."
    }
  };

  const data = statusMessages[status] || {
    title: "Offer Status Updated",
    message: "Your offer status has been updated."
  };

  return `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8" />
      <style>
          body {
              font-family: Arial, Helvetica, sans-serif;
              background: #ffffff;
              margin: 0;
              padding: 0;
              color: #111111;
          }
          .container {
              max-width: 620px;
              margin: 0 auto;
              padding: 20px;
          }
          p {
              font-size: 15px;
              line-height: 1.6;
              margin: 12px 0;
          }
          .section-title {
              font-size: 20px;
              font-weight: bold;
              margin-bottom: 20px;
          }
          .footer-text {
              font-size: 12px;
              color: #555555;
              margin-top: 30px;
              text-align: left;
          }
      </style>
  </head>

  <body>
      <div class="container">

          <p>Dear <strong>${candidate.fullName}</strong>,</p>

          <p>${data.message}</p>

          <p><strong>Position:</strong> ${application.job.title}</p>
          <p><strong>Department:</strong> ${application.job.department}</p>

          ${status === "offer accepted"
      ? `<p>Our HR team will connect with you shortly regarding the onboarding process.</p>`
      : ``
    }

          <p>Regards,<br />
          <strong>${process.env.COMPANY_NAME}</strong>
          </p>

          <p class="footer-text">
              This is an automated email. Please do not reply to this message.
          </p>

      </div>
  </body>
  </html>
  `;
};


export const newHrCreationEmailTemplate = (hrUser, plainPassword) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #ffffff;
      margin: 0;
      padding: 0;
      color: #111111;
    }

    .container {
      max-width: 620px;
      margin: 0 auto;
      padding: 20px;
    }

    p {
      font-size: 15px;
      line-height: 1.6;
      margin: 12px 0;
    }

    .section-title {
      font-size: 20px;
      font-weight: bold;
      margin-bottom: 20px;
    }

    .cred-item {
      margin: 4px 0;
      font-size: 15px;
    }

    .footer-text {
      font-size: 12px;
      color: #555555;
      margin-top: 30px;
    }
  </style>
</head>

<body>
  <div class="container">

    <p>Dear <strong>${hrUser.fullName}</strong>,</p>

    <p>
      Your HR account has been successfully created for
      <strong>${process.env.COMPANY_NAME || "Our Company"}</strong>.
    </p>

    <p>Please use the credentials below to access the HR portal:</p>

    <p class="cred-item"><strong>Email:</strong> ${hrUser.email}</p>
    <p class="cred-item"><strong>Password:</strong> ${plainPassword}</p>

    <p style="margin-top: 20px;">
      HR Portal: <a href="${process.env.FRONTEND_HR_URL || "#"}" target="_blank">
        ${process.env.FRONTEND_HR_URL || "Login Link"}
      </a>
    </p>

    <p class="footer-text">
      This is an automated email. Please do not reply.
    </p>

  </div>
</body>
</html>
`;


export const interviewScheduledEmailTemplate = (candidate, application, interview) => {

  const isOnline = interview.mode === "online";

  const formattedDate = (() => {
    const d = new Date(interview.date);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const year = d.getUTCFullYear();
    return `${day}-${month}-${year}`;
  })();



  const formattedTime = new Date(interview.time).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });


  return `
  <!DOCTYPE html>
  <html>
  <head>
      <style>
          body {
              font-family: Arial, Helvetica, sans-serif;
              background: #ffffff;
              margin: 0;
              padding: 0;
              color: #111111;
          }
          .container {
              max-width: 620px;
              margin: 0 auto;
              padding: 20px;
          }
          p, li {
              line-height: 1.6;
              font-size: 15px;
          }
          .details-box {
              margin: 20px 0;
              padding: 15px 0;
              border-top: 1px solid #ddd;
              border-bottom: 1px solid #ddd;
          }
          .detail-item {
              margin: 8px 0;
          }
      </style>
  </head>

  <body>
      <div class="container">

          <p>Dear <strong>${candidate.fullName}</strong>,</p>

          <p>
            Awesome news — we’d love to move you forward to the interview stage for the role of 
            <strong>${application.job.title}</strong>!
          </p>

          <p>Here’s what’s next:</p>

          <div class="details-box">

              <div class="detail-item">
                  <strong>When:</strong> ${formattedDate} / ${formattedTime}
              </div>

              ${isOnline
      ? `
                    <div class="detail-item">
                        <strong>Interview Mode:</strong> Online
                    </div>

                    <div class="detail-item">
                        <strong>Meeting Link:</strong> <a href="${interview.meetingLink}" target="_blank">${interview.meetingLink}</a>
                    </div>

                    ${interview.instructions
        ? `<div class="detail-item"><strong>Instructions:</strong> ${interview.instructions}</div>`
        : ""
      }
                  `
      : `
                    <div class="detail-item">
                        <strong>Interview Mode:</strong> Offline (In-Person)
                    </div>

                    <div class="detail-item">
                        <strong>Venue:</strong><br>
                        ${process.env.COMPANY_NAME}<br>
                        ${interview.venue}
                    </div>

                    <div class="detail-item">
                        <strong>Required Document:</strong> Aadhar Card Xerox
                    </div>

                    <div class="detail-item">
                        <strong>Dress Code:</strong> Formal attire is mandatory
                    </div>
                  `
    }

          </div>

          <p>
            During this discussion, we’ll talk about your projects, your approach to problem-solving, and learn more about you.
          </p>

          <p>
            Please confirm your availability for the scheduled time.  
            Looking forward to connecting!
          </p>

          <p>
            Regards,<br>
            ${process.env.COMPANY_NAME || "Company Name"}
          </p>

          <p style="font-size: 12px; color: #555; margin-top: 15px;">
              This is an automated email. Please do not reply to this message.
          </p>

      </div>
  </body>
  </html>
  `;
};

export const interviewRescheduledEmailTemplate = (candidate, application, interview) => {
  const isOnline = interview.mode === "online";

  // Format new date
  const formattedDate = (() => {
    const d = new Date(interview.date);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const year = d.getUTCFullYear();
    return `${day}-${month}-${year}`;
  })();

  // Format new time
  const formattedTime = new Date(interview.time).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

  return `
  <!DOCTYPE html>
  <html>
  <head>
      <style>
          body {
              font-family: 'Segoe UI', Tahoma, sans-serif;
              background: #f5f5f5;
              margin: 0;
              padding: 20px;
              color: #111827;
          }
          .container {
              max-width: 620px;
              margin: 0 auto;
              background: #ffffff;
              border-radius: 8px;
              border: 1px solid #e5e7eb;
          }
          .header {
              background: #1f2937;
              color: white;
              padding: 18px 25px;
          }
          .content {
              padding: 30px;
              font-size: 15px;
              line-height: 1.6;
          }
          .info-box {
              border: 1px solid #d1d5db;
              padding: 18px;
              margin: 20px 0;
              background: #fafafa;
              border-radius: 6px;
          }
          .info-title {
              font-weight: bold;
              margin-bottom: 10px;
              font-size: 15px;
              color: #1f2937;
          }
          .info-item {
              margin-bottom: 10px;
              font-size: 15px;
              color: #333;
          }
          .label {
              font-weight: 600;
              color: #111827;
          }
          .btn {
              display: inline-block;
              background: #1f2937;
              color: white !important;
              padding: 12px 28px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: 600;
              margin-top: 25px;
          }
          .footer {
              background: #1f2937;
              color: #ffffff;
              padding: 20px;
              text-align: center;
              font-size: 12px;
              border-radius: 0 0 8px 8px;
          }
      </style>
  </head>

  <body>
      <div class="container">

          <div class="content">
              <p>Dear <strong>${candidate.fullName}</strong>,</p>

              <p>
                This is to inform you that your interview for the position of 
                <strong>${application.job.title}</strong> has been rescheduled.
              </p>

              <!-- New Details -->
              <div class="info-box">
                  <div class="info-title">Updated Schedule</div>

                  <div class="info-item"><span class="label">New Date:</span> ${formattedDate}</div>
                  <div class="info-item"><span class="label">New Time:</span> ${formattedTime}</div>
                  <div class="info-item"><span class="label">Mode:</span> ${interview.mode.toUpperCase()}</div>

                  ${isOnline
      ? `<div class="info-item"><span class="label">Meeting Link:</span> <a href="${interview.meetingLink}" target="_blank">${interview.meetingLink}</a></div>`
      : `<div class="info-item"><span class="label">Venue:</span> ${interview.venue}</div>`
    }

                  ${interview.instructions
      ? `<div class="info-item"><span class="label">Instructions:</span> ${interview.instructions}</div>`
      : ""
    }
              </div>

              <p>
                Kindly ensure your availability for the updated schedule.  
                For any further information, our HR team will connect with you.
              </p>
          </div>

          <div class="footer">
            <p>Regards,<br>
              ${process.env.COMPANY_NAME || "Company Name"}</p>

              <p style="opacity:0.8; margin-top: 10px;">
                This is an automated email. Please do not reply.
              </p>
          </div>

      </div>
  </body>
  </html>
  `;
};


export const applicationSubmittedEmailTemplate = (candidate, job) => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8" />
      <style>
          body {
              font-family: Arial, Helvetica, sans-serif;
              background: #ffffff;
              margin: 0;
              padding: 0;
              color: #111111;
          }
          .container {
              max-width: 620px;
              margin: 0 auto;
              padding: 20px;
          }
          p {
              font-size: 15px;
              line-height: 1.6;
              margin: 12px 0;
          }
          .section-title {
              font-size: 20px;
              font-weight: bold;
              margin-bottom: 20px;
          }
          .footer-text {
              font-size: 12px;
              color: #555555;
              margin-top: 30px;
          }
      </style>
  </head>

  <body>
      <div class="container">

          <p>Dear <strong>${candidate.fullName}</strong>,</p>

          <p>
              Thank you for your interest in 
              <strong>${process.env.COMPANY_NAME || "Our Company"}</strong> 
              and for applying for the position of 
              <strong>${job.title}</strong>.
          </p>

          <p>
              Our Talent Acquisition team will review your application. If your 
              profile is shortlisted, we will contact you regarding the next steps 
              in the selection process.
          </p>
          
          <p>
              Note: To check the current status or updates regarding your application, please visit the Application Portal and review your Timeline
          </p>

          <p>
              If you do not receive any communication from us within 30 days, 
              please consider that your application was not selected for the next stage. 
              However, your details will remain in our database for future opportunities 
              in accordance with our privacy policy.
          </p>

          <p style="margin-top: 25px;">
              Regards,<br />
              <strong>${process.env.COMPANY_NAME || "Company Name"}</strong>
          </p>

          <p class="footer-text">
              This is an automated email. Please do not reply to this message.
          </p>

      </div>
  </body>
  </html>
  `;
};


export const interviewSelectedEmailTemplate = (candidate, job) => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
      <style>
          body {
              font-family: Arial, Helvetica, sans-serif;
              background: #ffffff;
              margin: 0;
              padding: 0;
              color: #111111;
          }
          .container {
              max-width: 620px;
              margin: 0 auto;
              padding: 20px;
          }
          p {
              line-height: 1.6;
              font-size: 15px;
          }
      </style>
  </head>

  <body>
      <div class="container">

          <p>Dear <strong>${candidate.fullName}</strong>,</p>

          <p>
            Thank you once again for taking the time to interview with us for the position of 
            <strong>${job.title}</strong> at 
            <strong>${process.env.COMPANY_NAME || "KIAQ TECHNOLOGIES PRIVATE LIMITED"}</strong>.
          </p>

          <p>
            We are pleased to inform you that you have been selected for the role.
            Your skills, experience, and positive attitude make you an excellent fit for our team.
          </p>

          <p>
            You will receive your official offer letter within the next 48 hours. It will include complete details regarding your compensation, benefits, start date, and other essential information.
          </p>

          <p>
            If you have any questions in the meantime, please feel free to reach out to us directly.
          </p>

          <p>
            We look forward to welcoming you onboard and working together.
          </p>

          <p>
            Kind Regards,<br>
            ${process.env.COMPANY_NAME || "KIAQ TECHNOLOGIES PRIVATE LIMITED"}
          </p>

          <p style="font-size: 12px; color: #555; margin-top: 20px;">
            This is an automated email. Please do not reply to this message.
          </p>

      </div>
  </body>
  </html>
  `;
};


export const interviewRejectedEmailTemplate = (candidate, job) => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
      <style>
          body {
              font-family: Arial, Helvetica, sans-serif;
              background: #ffffff;
              margin: 0;
              padding: 0;
              color: #111111;
          }
          .container {
              max-width: 620px;
              margin: 0 auto;
              padding: 20px;
          }
          p {
              line-height: 1.6;
              font-size: 15px;
          }
      </style>
  </head>

  <body>
      <div class="container">

          <p>Dear <strong>${candidate.fullName}</strong>,</p>

          <p>
            Thank you for taking the time to interview with us for the position of 
            <strong>${job.title}</strong> at 
            <strong>${process.env.COMPANY_NAME || "KIAQ TECHNOLOGIES PRIVATE LIMITED"}</strong>.
          </p>

          <p>
            We truly appreciate your interest in joining our team and the effort you put into your application and interview process.
          </p>

          <p>
            After careful consideration, we regret to inform you that we will not be moving forward with your application at this time.
            This decision was not easy, as we had the opportunity to meet many talented candidates.
          </p>

          <p>
            We encourage you to apply for future opportunities with us that align with your skills and experience, and we wish you every success in your job search and professional journey.
          </p>

          <p>
            Thank you once again for your interest in 
            <strong>${process.env.COMPANY_NAME || "KIAQ TECHNOLOGIES PRIVATE LIMITED"}</strong>.
          </p>

          <p>
            Kind Regards,<br>
            ${process.env.COMPANY_NAME || "KIAQ TECHNOLOGIES PRIVATE LIMITED"}
          </p>

          <p style="font-size: 12px; color: #555; margin-top: 20px;">
            This is an automated email. Please do not reply to this message.
          </p>

      </div>
  </body>
  </html>
  `;
};
