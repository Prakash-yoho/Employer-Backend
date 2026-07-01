export const newAdminUserTemplate = (adminUser, plainPassword, role) => {
  const roleDisplay =
    role === 'EMPLOYER_HR' ? 'HR' :
      role === 'EMPLOYER_IT' ? 'IT Support' :
        'Administrator';

  const portalName =
    role === 'EMPLOYER_HR' ? 'HR Portal' :
      role === 'EMPLOYER_IT' ? 'IT Support Portal' :
        'Admin Portal';

  const portalUrl =
    role === 'EMPLOYER_HR' ? process.env.FRONTEND_EMPLOYER_HR :
      role === 'EMPLOYER_IT' ? process.env.FRONTEND_EMPLOYER_IT :
        process.env.FRONTEND_EMPLOYER_ADMIN || process.env.FRONTEND_EMPLOYER_HR;

  const companyName = process.env.COMPANY_NAME || 'Company Name';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Account Access Details</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #000000;
      background-color: #ffffff;
      line-height: 1.5;
    }

    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 24px;
    }

    .header {
      border-bottom: 1px solid #dddddd;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }

    .header h1 {
      font-size: 20px;
      margin: 0;
      font-weight: bold;
    }

    .content p {
      font-size: 14px;
      margin: 0 0 16px;
    }

    .section {
      margin-top: 20px;
    }

    .section-title {
      font-size: 15px;
      font-weight: bold;
      margin-bottom: 8px;
    }

    .credentials {
      font-size: 14px;
    }

    .credentials div {
      margin-bottom: 6px;
    }

    .button-wrapper {
      margin: 24px 0;
    }

    .button {
      display: inline-block;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: bold;
      color: #ffffff;
      background-color: #dfbf0e;
      text-decoration: none;
      border-radius: 3px;
    }

    .link {
      font-size: 13px;
      margin-top: 8px;
      word-break: break-all;
    }

    .notice {
      margin-top: 24px;
      font-size: 13px;
      color: #333333;
    }

    .footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #dddddd;
      font-size: 12px;
      color: #666666;
    }
  </style>
</head>

<body>
  <div class="container">

    <div class="header">
      <h1>${companyName}</h1>
    </div>

    <div class="content">
      <p>
        Dear ${adminUser?.firstName} ${adminUser?.lastName},
      </p>

      <p>
        Your account has been created and you have been granted
        <strong>${roleDisplay}</strong> access to the ${portalName}.
      </p>

      <div class="section">
        <div class="section-title">Login Information</div>
        <div class="credentials">
          <div><strong>Email:</strong> ${adminUser.email}</div>
          <div><strong>Password:</strong> ${plainPassword}</div>
          <div><strong>Role:</strong> ${roleDisplay}</div>
        </div>
      </div>

      <div class="section">
  <div class="section-title">Portal Access</div>

  <p style="font-size:14px; margin-bottom:14px;">
    Click the button below to securely access the ${portalName}.
  </p>

  <div class="button-wrapper" style="margin: 16px 0;">
    <a
      href="${portalUrl || '#'}"
      target="_blank"
      class="button"
      aria-label="Access ${portalName}"
    >
      Access ${portalName}
    </a>
  </div>


  <p class="link" style="font-size:12px; color:#000000; word-break:break-all;">
    ${portalUrl || 'Portal URL will be provided separately'}
  </p>
</div>


      
    </div>

    <div class="footer">
      <p>This is an automated message. Please do not reply.</p>
      <p>&copy; ${new Date().getFullYear()} ${companyName}</p>
    </div>

  </div>
</body>
</html>
`;
};


export const newEmployeeTemplate = (employee, officialPassword) => {
  const companyName = process.env.COMPANY_NAME || 'Company Name';
  const portalUrl =
    process.env.FRONTEND_EMPLOYER_EMPLOYEE || '#';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Employee Account Information</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      background-color: #ffffff;
      color: #000000;
      line-height: 1.5;
    }

    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 24px;
    }

    .header {
      border-bottom: 1px solid #dddddd;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }

    .header h1 {
      font-size: 20px;
      margin: 0;
      font-weight: bold;
    }

    .header p {
      font-size: 14px;
      margin: 6px 0 0;
      color: #333333;
    }

    .content p {
      font-size: 14px;
      margin: 0 0 14px;
    }

    .section {
      margin-top: 22px;
    }

    .section-title {
      font-size: 15px;
      font-weight: bold;
      margin-bottom: 8px;
    }

    .details {
      font-size: 14px;
    }

    .details div {
      margin-bottom: 6px;
    }

    .credentials {
      margin-top: 16px;
      padding: 14px;
      border: 1px solid #dddddd;
      font-size: 14px;
    }

    .credentials div {
      margin-bottom: 8px;
    }

    .button-wrapper {
      margin: 22px 0;
    }

    .button {
      display: inline-block;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: bold;
      color: #ffffff;
      background-color: #000000;
      text-decoration: none;
      border-radius: 3px;
    }

    .link {
      font-size: 12px;
      margin-top: 8px;
      word-break: break-all;
    }

    .notice {
      margin-top: 20px;
      font-size: 13px;
      color: #333333;
    }

    .footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #dddddd;
      font-size: 12px;
      color: #666666;
    }
  </style>
</head>

<body>
  <div class="container">

    <div class="header">
      <h1>${companyName}</h1>
      <p>Employee Account Information</p>
    </div>

    <div class="content">
      <p>
        Dear ${employee.firstName} ${employee.lastName},
      </p>

      <p>
        Welcome to ${companyName}. Your employee account has been created.
        Please find your details below.
      </p>

      <div class="section">
        <div class="section-title">Employee Details</div>
        <div class="details">
          <div><strong>Name:</strong> ${employee.firstName} ${employee.lastName}</div>
          <div><strong>Employee ID:</strong> ${employee.employeeId}</div>
          <div><strong>Department:</strong> ${employee.department}</div>
          <div><strong>Designation:</strong> ${employee.designation}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Login Credentials</div>
        <div class="credentials">
          <div><strong>Official Email:</strong> ${employee.officialEmail}</div>
          <div><strong>Official Password:</strong> ${officialPassword}</div>
        </div>
      </div>


      <div class="section">
        <div class="section-title">Employee Portal Access</div>

        <div class="button-wrapper">
          <a href="${portalUrl}" class="button" target="_blank">
            Access Employee Portal
          </a>
        </div>

        <div class="link">
          ${portalUrl}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Support</div>
        <p>
          If you have any questions, please contact the HR department at
          ${process.env.COMPANY_EMAIL || 'hr@company.com'}.
        </p>
      </div>
    </div>

    <div class="footer">
      <p>This is an automated message. Please do not reply.</p>
      <p>&copy; ${new Date().getFullYear()} ${companyName}</p>
    </div>

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


/**
 * Relieving letter email template
 * Matches the same dark-teal + orange brand style as appointmentLetterEmailTemplate
 */
export const relievingLetterEmailTemplate = (employee) => {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #111111; }
        .container { max-width: 600px; margin: 10px auto; padding: 15px; }
        p { font-size: 15px; line-height: 1.6; margin: 12px 0; color: #333333; }
        .greeting { font-size: 16px; font-weight: bold; margin-bottom: 16px; }
        .highlight { margin: 16px 0; font-size: 14px; }
        .highlight strong { font-weight: bold; }
        .note { font-size: 13px; color: #555555; font-style: italic; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <p class="greeting">Dear ${employee.firstName} ${employee.lastName},</p>

        <p>
            This is to confirm that your resignation has been accepted, and you have been formally relieved 
            from your duties at <strong>KIAQ Technologies Private Limited</strong>.
        </p>

        <p>
            Please find your <strong>Relieving Letter</strong> attached to this email.
        </p>

        <div class="highlight">
            <p><strong>Employee Name:</strong> ${employee.firstName} ${employee.lastName}</p>
            <p><strong>Employee ID:</strong> ${employee.employeeId}</p>
            <p><strong>Designation:</strong> ${employee.designation || '—'}</p>
            <p><strong>Department:</strong> ${employee.department || '—'}</p>
        </div>

        <p>
            We sincerely appreciate your contributions during your tenure with us and wish you all the very best 
            in your future endeavors.
        </p>

        <p class="note">
            This is an automated email. Please do not reply to this message.
        </p>
    </div>
</body>
</html>
    `;
};

/**
 * Experience certificate email template
 * Same dark-teal + orange brand style
 */
export const experienceCertificateEmailTemplate = (employee) => {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        body { margin: 0; padding: 0; background: #f4f4f4; font-family: Arial, Helvetica, sans-serif; color: #111111; }
        .wrap { max-width: 620px; margin: 30px auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
        .top-bar { background: #002B38; padding: 20px 32px; }
        .brand { font-size: 22px; font-weight: bold; color: #ffffff; }
        .brand span { color: #E05C1A; }
        .orange-line { height: 4px; background: #E05C1A; }
        .body { padding: 32px; }
        p { font-size: 15px; line-height: 1.7; margin: 10px 0; color: #333333; }
        .greeting { font-size: 16px; color: #002B38; font-weight: bold; margin-bottom: 14px; }
        .highlight {
            background: #fff7f2; border-left: 4px solid #E05C1A;
            padding: 14px 18px; border-radius: 4px; margin: 20px 0; font-size: 14px; color: #333;
        }
        .highlight strong { color: #002B38; }
        .note { font-size: 13px; color: #555555; font-style: italic; margin-top: 20px; }
        .footer { background: #002B38; padding: 16px 32px; text-align: center; }
        .footer p { color: #aaaaaa; font-size: 11px; margin: 0; line-height: 1.7; }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="top-bar">
            <div class="brand">KIAQ<span> TECHNOLOGIES</span></div>
        </div>
        <div class="orange-line"></div>
        <div class="body">
            <div class="greeting">Dear ${employee.firstName} ${employee.lastName},</div>
            <p>
                We are pleased to issue your <strong>Experience Certificate</strong> from
                <strong>Kiaq Technologies Private Limited</strong>. Please find the document attached.
            </p>
            <div class="highlight">
                <strong>Employee Name:</strong> ${employee.firstName} ${employee.lastName}<br/>
                <strong>Employee ID:</strong> ${employee.employeeId}<br/>
                <strong>Designation:</strong> ${employee.designation || '—'}<br/>
                <strong>Department:</strong> ${employee.department || '—'}
            </div>
            <p>
                It has been a pleasure having you as part of our team. We deeply value your
                contributions and wish you continued success in all your future endeavours.
            </p>
            <p class="note">
                This is an automated email. Please do not reply to this message.
            </p>
        </div>
        <div class="footer">
            <p>
                KIAQ TECHNOLOGIES PRIVATE LIMITED<br/>
                M181, Cactus, Ground Floor, Block B, TECCI Park, Rajiv Gandhi Salai,<br/>
                Elcot SEZ, Sholinganallur, Chennai – 600119, Tamil Nadu, India<br/>
                Email: hr@kiaq.in  |  Website: www.kiaq.in
            </p>
        </div>
    </div>
</body>
</html>
    `;
};



const formatDate = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};


/**
 * Leave email template — redesigned to match the same dark-teal + orange
 * brand identity as the other employee documents (appointment letter,
 * relieving letter, experience certificate), instead of a solid color block.
 * The status color is now used only as a small accent (badge, left border,
 * button) rather than as a full background, which reads as far more
 * professional in an inbox.
 */
export const leaveEmailTemplate = (type, data) => {
  let subject, title, message, details, actionText, actionUrl;
  let reasonLabel = null;
  let reasonText = null;

  switch (type) {
    case 'REQUEST_TO_HR':
      subject = `New Leave Request - ${data.employeeName}`;
      title = 'New Leave Request';
      message = `A new leave request has been submitted.`;

      details = `
  <p>
    This is to inform you that <strong>${data.employeeName}</strong>
    (${data.employeeId})
    has submitted a request for <strong>${data.leaveType}</strong> leave
    ${formatDate(data.startDate) === formatDate(data.endDate)
          ? `on <strong>${formatDate(data.startDate)}</strong>`
          : `from <strong>${formatDate(data.startDate)}</strong> to <strong>${formatDate(data.endDate)}</strong>`
        }.
  </p>
`;
      reasonLabel = 'Reason for Leave';
      reasonText = data.reason;
      actionText = 'Review Request';
      actionUrl = `${process.env.FRONTEND_EMPLOYER_HR}/leavemanagement`;
      break;

    case 'APPROVED_TO_EMPLOYEE':
      subject = `Leave Approved – ${data.requestId}`;
      title = 'Leave Approved';

      message = `
Hi <strong>${data.employeeName}</strong> (${data.employeeId}),
`;;

      details = `
    <p>
      This is to inform you that your <strong>${data.leaveType}</strong>
      leave request has been approved
      ${formatDate(data.startDate) === formatDate(data.endDate)
          ? `for <strong>${formatDate(data.startDate)}</strong>`
          : `from <strong>${formatDate(data.startDate)}</strong> to <strong>${formatDate(data.endDate)}</strong>`
        }.
    </p>
  `;

      actionText = 'View Details';
      actionUrl = `${process.env.FRONTEND_EMPLOYER_EMPLOYEE}/leavemanagement`;
      break;

    case 'REJECTED_TO_EMPLOYEE':
      subject = `Leave Request Update – ${data.requestId}`;
      title = 'Leave Not Approved';

      message = `
    Hi <strong>${data.employeeName}</strong> (${data.employeeId}),
  `;

      details = `
    <p>
      This is to inform you that your <strong>${data.leaveType}</strong>
      leave request
      ${formatDate(data.startDate) === formatDate(data.endDate)
          ? `on <strong>${formatDate(data.startDate)}</strong>`
          : `from <strong>${formatDate(data.startDate)}</strong> to <strong>${formatDate(data.endDate)}</strong>`
        }
      has not been approved.
    </p>
  `;

      reasonLabel = 'Reason for Rejection';
      reasonText = data.rejectedComments || 'Please contact HR for more information.';

      actionText = 'Apply Again';
      actionUrl = `${process.env.FRONTEND_EMPLOYER_EMPLOYEE}/leavemanagement`;
      break;

    case 'CANCELLED_TO_HR':
      subject = `Leave Cancelled – ${data.employeeName}`;
      title = 'Leave Cancelled';

      message = 'A leave request has been cancelled.';

      details = `
 <p>
  This is to inform you that <strong>${data.employeeName}</strong>
  ${data.employeeId ? `(<strong>${data.employeeId}</strong>)` : ''}
  has cancelled their <strong>${data.leaveType}</strong> leave
  ${formatDate(data.startDate) === formatDate(data.endDate)
          ? `on <strong>${formatDate(data.startDate)}</strong>`
          : `from <strong>${formatDate(data.startDate)}</strong> to <strong>${formatDate(data.endDate)}</strong>`
        }.
</p>
  `;

      reasonLabel = 'Cancellation Reason';
      reasonText = data.cancelReason || 'No reason provided.';

      actionText = 'View Leave Management';
      actionUrl = `${process.env.FRONTEND_EMPLOYER_HR}/leavemanagement`;
      break;

    case 'CANCELLED_TO_EMPLOYEE':
      subject = `Leave Cancellation Confirmed – ${data.requestId}`;
      title = 'Leave Cancelled';

      message = 'Your leave cancellation has been processed successfully.';

      details = `
    <p>
      Your <strong>${data.leaveType}</strong> leave
      ${formatDate(data.startDate) === formatDate(data.endDate)
          ? `on <strong>${formatDate(data.startDate)}</strong>`
          : `from <strong>${formatDate(data.startDate)}</strong> to <strong>${formatDate(data.endDate)}</strong>`
        }
      has been cancelled successfully.
    </p>
  `;

      actionText = 'View Leave History';
      actionUrl = `${process.env.FRONTEND_EMPLOYER_EMPLOYEE}/leavemanagement`;
      break;
  }

  // Accent color: used only for the status badge, the details left-border,
  // and the button — never as a full-page background.
  const accentColor = type === 'APPROVED_TO_EMPLOYEE' ? '#10b981'
    : type === 'REJECTED_TO_EMPLOYEE' ? '#ef4444'
      : type === 'CANCELLED_TO_HR' ? '#ef4444'
        : type === 'CANCELLED_TO_EMPLOYEE' ? '#64748b'
          : '#E05C1A';                                                 // REQUEST_TO_HR / fallback — brand orange

  const badgeLabel = type === 'APPROVED_TO_EMPLOYEE' ? 'Approved'
    : type === 'REJECTED_TO_EMPLOYEE' ? 'Action Needed'
      : type === 'CANCELLED_TO_HR' ? 'Cancelled'
        : type === 'CANCELLED_TO_EMPLOYEE' ? 'Cancelled'
          : 'Pending Review';

  const companyName = process.env.COMPANY_NAME || 'KIAQ Technologies Private Limited';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: #f4f4f4; font-family: Arial, Helvetica, sans-serif; color: #111111; }
    .wrap { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
    .top-bar { background: #002B38; padding: 20px 32px; }
    .brand { font-size: 20px; font-weight: bold; color: #ffffff; }
    .brand span { color: #E05C1A; }
    .orange-line { height: 4px; background: #E05C1A; }
    .body { padding: 32px; }
    .badge {
      display: inline-block; font-size: 11px; font-weight: bold; letter-spacing: .5px;
      text-transform: uppercase; color: ${accentColor}; border: 1px solid ${accentColor};
      border-radius: 4px; padding: 4px 10px; margin-bottom: 16px;
    }
    h2.title { font-size: 19px; color: #002B38; margin: 0 0 12px; }
    p { font-size: 14px; line-height: 1.7; margin: 8px 0; color: #333333; }
  .details {
  padding: 0;
  margin: 16px 0;
  font-size: 14px;
}
    .details p { margin: 6px 0; }
    .reason-block { margin: 18px 0 6px; }
    .reason-label {
  font-size: 18px;
  font-weight: 900;
  color: #002B38;
  margin-bottom: 8px;
}
    }
    .reason-text {
      background: #fafafa; border: 1px solid #e8e8e8; border-radius: 4px;
      padding: 14px 16px; margin: 0; font-size: 14px; line-height: 1.7;
      color: #333333; white-space: pre-wrap;
    }
    .btn-wrap { margin: 26px 0 18px; }
  .btn {
  display: inline-block;
  background: #E05C1A;
  color: #ffffff !important;
  padding: 12px 24px;
  text-decoration: none !important;
  border-radius: 6px;
  font-weight: bold;
  font-size: 14px;
}
    .note { font-size: 12px; color: #777777; font-style: italic; margin-top: 22px; }
    .footer { background: #002B38; padding: 16px 32px; text-align: center; }
    .footer p { color: #9aa7ad; font-size: 11px; margin: 0; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="wrap">
 
    <div class="body">

    <h2 class="title">${title}</h2>
      <p>${message}</p>
      <div class="details">${details}</div>
      ${reasonText ? `
      <div class="reason-block">
<div class="reason-label">
  <strong>${reasonLabel}</strong>
</div>
        <p class="reason-text">${reasonText}</p>
      </div>` : ''}
      <div class="btn-wrap">
<a
  href="${actionUrl}"
  target="_blank"
  style="
    background:#E05C1A;
    color:#ffffff;
    text-decoration:none;
    padding:12px 24px;
    border-radius:6px;
    display:inline-block;
    font-weight:bold;
  "
>
  ${actionText}
</a>
      </div>
<div
  style="
    margin-top:30px;
    text-align:center;
    color:#666666;
    font-size:13px;
    font-style:italic;
  "
>
  This is an automated message. Please do not reply.
</div>
    </div>
  </div>
</body>
</html>
`;
};


export const permissionEmailTemplate = (type, data) => {
  let subject, title, message, details, actionText, actionUrl;
  let reasonLabel = null;
  let reasonText = null;

  switch (type) {
    case 'REQUEST_TO_HR':
      subject = `New Permission Request - ${data.employeeName}`;
      title   = 'New Permission Request';
      message = 'A new permission request has been submitted.';
      details = `
        <p>
          This is to inform you that <strong>${data.employeeName}</strong>
          (${data.employeeId})
          has submitted a permission request on
          <strong>${formatDate(data.date)}</strong> from
          <strong>${data.fromTime}</strong> to <strong>${data.toTime}</strong>
          (<strong>${data.durationText}</strong>).
        </p>
      `;
      reasonLabel = 'Reason for Permission';
      reasonText  = data.reason;
      actionText  = 'Review Request';
      actionUrl   = `${process.env.FRONTEND_EMPLOYER_HR}/permissions`;
      break;

    case 'APPROVED_TO_EMPLOYEE':
      subject = `Permission Approved – ${data.requestId}`;
      title   = 'Permission Approved';
      message = `Hi <strong>${data.employeeName}</strong> (${data.employeeId}),`;
      details = `
        <p>
          This is to inform you that your permission request on
          <strong>${formatDate(data.date)}</strong> from
          <strong>${data.fromTime}</strong> to <strong>${data.toTime}</strong>
          (<strong>${data.durationText}</strong>) has been approved.
        </p>
      `;
      if (data.approvedComments) {
        reasonLabel = 'HR Comment';
        reasonText  = data.approvedComments;
      }
      actionText = 'View Details';
      actionUrl  = `${process.env.FRONTEND_EMPLOYER_EMPLOYEE}/permissions-management`;
      break;

    case 'REJECTED_TO_EMPLOYEE':
      subject = `Permission Request Update – ${data.requestId}`;
      title   = 'Permission Not Approved';
      message = `Hi <strong>${data.employeeName}</strong> (${data.employeeId}),`;
      details = `
        <p>
          This is to inform you that your permission request on
          <strong>${formatDate(data.date)}</strong> from
          <strong>${data.fromTime}</strong> to <strong>${data.toTime}</strong>
          has not been approved.
        </p>
      `;
      reasonLabel = 'Reason for Rejection';
      reasonText  = data.rejectedComments || 'Please contact HR for more information.';
      actionText  = 'Apply Again';
      actionUrl   = `${process.env.FRONTEND_EMPLOYER_EMPLOYEE}/permissions-management`;
      break;

    case 'CANCELLED_TO_HR':
      subject = `Permission Cancelled – ${data.employeeName}`;
      title   = 'Permission Cancelled';
      message = 'A permission request has been cancelled.';
      details = `
        <p>
          This is to inform you that <strong>${data.employeeName}</strong>
          ${data.employeeId ? `(<strong>${data.employeeId}</strong>)` : ''}
          has cancelled their permission on
          <strong>${formatDate(data.date)}</strong> from
          <strong>${data.fromTime}</strong> to <strong>${data.toTime}</strong>.
        </p>
      `;
      reasonLabel = 'Cancellation Reason';
      reasonText  = data.cancelReason || 'No reason provided.';
      actionText  = 'View Permissions';
      actionUrl   = `${process.env.FRONTEND_EMPLOYER_HR}/permissions`;
      break;
  }

  const accentColor = type === 'APPROVED_TO_EMPLOYEE' ? '#10b981'
    : type === 'REJECTED_TO_EMPLOYEE' ? '#ef4444'
      : type === 'CANCELLED_TO_HR' ? '#ef4444'
        : '#E05C1A';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin:0; padding:0; background:#f4f4f4; font-family:Arial,Helvetica,sans-serif; color:#111; }
    .wrap { max-width:600px; margin:30px auto; background:#fff; border-radius:8px; overflow:hidden; }
    .body { padding:32px; }
    h2.title { font-size:19px; color:#002B38; margin:0 0 12px; }
    p { font-size:14px; line-height:1.7; margin:8px 0; color:#333; }
    .details { padding:0; margin:16px 0; font-size:14px; }
    .reason-block { margin:18px 0 6px; }
    .reason-label { font-size:18px; font-weight:900; color:#002B38; margin-bottom:8px; }
    .reason-text {
      background:#fafafa; border:1px solid #e8e8e8; border-radius:4px;
      padding:14px 16px; margin:0; font-size:14px; line-height:1.7;
      color:#333; white-space:pre-wrap;
    }
    .btn-wrap { margin:26px 0 18px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="body">
      <h2 class="title">${title}</h2>
      <p>${message}</p>
      <div class="details">${details}</div>
      ${reasonText ? `
      <div class="reason-block">
        <div class="reason-label"><strong>${reasonLabel}</strong></div>
        <p class="reason-text">${reasonText}</p>
      </div>` : ''}
      <div class="btn-wrap">
        <a href="${actionUrl}" target="_blank"
           style="background:${accentColor};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:bold;">
          ${actionText}
        </a>
      </div>
      <div style="margin-top:30px;text-align:center;color:#666;font-size:13px;font-style:italic;">
        This is an automated message. Please do not reply.
      </div>
    </div>
  </div>
</body>
</html>
`;
};


export const passwordChangedByAdminTemplate = (employee, newPassword) => {
  const companyName = process.env.COMPANY_NAME || 'Company';
  const portalUrl = process.env.FRONTEND_EMPLOYER_EMPLOYEE || '#';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #111111;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    h2 {
      font-size: 20px;
      font-weight: bold;
      margin: 0 0 16px;
      color: #111111;
    }
    h3 {
      font-size: 16px;
      font-weight: bold;
      margin: 22px 0 8px;
      color: #111111;
    }
    p {
      font-size: 14px;
      line-height: 1.7;
      margin: 10px 0;
      color: #333333;
    }
    .btn {
      display: inline-block;
      background: #E05C1A;
      color: #ffffff !important;
      padding: 12px 26px;
      text-decoration: none !important;
      border-radius: 6px;
      font-weight: bold;
      font-size: 14px;
      margin-top: 18px;
    }
    .note {
      margin-top: 28px;
      font-size: 13px;
      color: #888888;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="container">

    <h2>Password Reset</h2>

    <p>Your account password has been updated.</p>

    <p>
      This is to inform you that <strong>${employee.firstName} ${employee.lastName}</strong>
      (<strong>${employee.employeeId}</strong>), your account password for the
      <strong>${companyName}</strong> Employee Portal has been reset by HR / Admin.
      Please use the new credentials below to log in.
    </p>

    <h3>Login Credentials</h3>

    <p>
      <strong>Employee ID:</strong> ${employee.employeeId}<br/>
      <strong>Official Email:</strong> ${employee.officialEmail}<br/>
      <strong>New Password:</strong> ${newPassword}
    </p>

    <h3>Important Note</h3>

    <p>
      Please <strong>keep this password safe</strong>. For security reasons, this
      password will not be regenerated or resent frequently. Store it in a secure
      place and do not share it with anyone.
    </p>

    <a href="${portalUrl}" target="_blank" class="btn">Login to Portal</a>

    <p class="note">This is an automated message. Please do not reply.</p>

  </div>
</body>
</html>
  `;
};





// add to utils/emailTemplates.js

export const appraisalLetterEmailTemplate = (employee, appraisal) => {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        body { margin: 0; padding: 0; background: #f4f4f4; font-family: Arial, Helvetica, sans-serif; color: #111111; }
        .wrap { max-width: 620px; margin: 30px auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
        .top-bar { background: #002B38; padding: 20px 32px; }
        .brand { font-size: 22px; font-weight: bold; color: #ffffff; }
        .brand span { color: #E05C1A; }
        .orange-line { height: 4px; background: #E05C1A; }
        .body { padding: 32px; }
        p { font-size: 15px; line-height: 1.7; margin: 10px 0; color: #333333; }
        .greeting { font-size: 16px; color: #002B38; font-weight: bold; margin-bottom: 14px; }
        .highlight {
            background: #fff7f2; border-left: 4px solid #E05C1A;
            padding: 14px 18px; border-radius: 4px; margin: 20px 0; font-size: 14px; color: #333;
        }
        .highlight strong { color: #002B38; }
        .note { font-size: 13px; color: #555555; font-style: italic; margin-top: 20px; }
        .footer { background: #002B38; padding: 16px 32px; text-align: center; }
        .footer p { color: #aaaaaa; font-size: 11px; margin: 0; line-height: 1.7; }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="top-bar">
            <div class="brand">KIAQ<span> TECHNOLOGIES</span></div>
        </div>
        <div class="orange-line"></div>
        <div class="body">
            <div class="greeting">Dear ${employee.firstName} ${employee.lastName},</div>
            <p>
                Congratulations! We are pleased to share your <strong>revised compensation letter</strong>
                following your performance appraisal. Please find the letter and the revised compensation
                annexure attached to this email.
            </p>
            <div class="highlight">
                <strong>Employee Name:</strong> ${employee.firstName} ${employee.lastName}<br/>
                <strong>Employee ID:</strong> ${employee.employeeId}<br/>
                <strong>Previous Annual CTC:</strong> ₹${Number(appraisal.previousAnnualSalary).toLocaleString('en-IN')}<br/>
                <strong>Revised Annual CTC:</strong> ₹${Number(appraisal.newAnnualSalary).toLocaleString('en-IN')}<br/>
                <strong>Increment:</strong> ${Number(appraisal.percentageIncrement).toFixed(2)}%<br/>
                <strong>Effective From:</strong> ${new Date(appraisal.effectiveDate).toLocaleDateString('en-GB')}
            </div>
            <p>
                Thank you for your continued dedication and hard work. We look forward to your ongoing
                contribution to the team.
            </p>
            <p class="note">
                This is an automated email. Please do not reply to this message.
            </p>
        </div>
        <div class="footer">
            <p>
                KIAQ TECHNOLOGIES PRIVATE LIMITED<br/>
                M181, Cactus, Ground Floor, Block B, TECCI Park, Rajiv Gandhi Salai,<br/>
                Elcot SEZ, Sholinganallur, Chennai – 600119, Tamil Nadu, India<br/>
                Email: hr@kiaq.in  |  Website: www.kiaq.in
            </p>
        </div>
    </div>
</body>
</html>
  `;
};