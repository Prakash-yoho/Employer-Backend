
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
          <div><strong>Temporary Password:</strong> ${officialPassword}</div>
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

const formatDate = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};



export const leaveEmailTemplate = (type, data) => {
    let subject, title, message, details, actionText, actionUrl;

    console.log(type,data,"Email Template")

    switch (type) {
        case 'REQUEST_TO_HR':
            subject = `New Leave Request - ${data.employeeName}`;
            title = 'New Leave Request';
            message = `${data.employeeName} has submitted a leave request`;
            details = `
                <p><strong>Employee:</strong> ${data.employeeName}</p>
                <p><strong>Leave Type:</strong> ${data.leaveType}</p>
                <p><strong>Dates:</strong> ${formatDate(data.startDate)} - ${formatDate(data.endDate)}</p>
                <p><strong>Reason:</strong> ${data.reason}</p>
            `;
            actionText = 'Review Request';
            actionUrl = `${process.env.FRONTEND_EMPLOYER_HR}/leaves/${data.requestId}`;
            break;

        case 'APPROVED_TO_EMPLOYEE':
            subject = `Leave Request Approved - ${data.requestId}`;
            title = 'Leave Approved ✅';
            message = 'Your leave request has been approved';
            details = `
                <p><strong>Request ID:</strong> ${data.requestId}</p>
                <p><strong>Leave Type:</strong> ${data.leaveType}</p>
                <p><strong>Dates:</strong> ${formatDate(data.startDate)} - ${formatDate(data.endDate)}</p>
            `;
            actionText = 'View Details';
            actionUrl = `${process.env.FRONTEND_EMPLOYER_EMPLOYEE}/leaves/${data.requestId}`;
            break;

        case 'REJECTED_TO_EMPLOYEE':
            subject = `Leave Request Update - ${data.requestId}`;
            title = 'Leave Not Approved';
            message = 'Your leave request requires attention';
            details = `
                <p><strong>Request ID:</strong> ${data.requestId}</p>
                <p><strong>Leave Type:</strong> ${data.leaveType}</p>
                <p><strong>Dates:</strong> ${formatDate(data.startDate)} - ${formatDate(data.endDate)}</p>
                <p><strong>Reason:</strong> ${data.rejectedComments || 'Please contact HR'}</p>
            `;
            actionText = 'Apply Again';
            actionUrl = `${process.env.FRONTEND_EMPLOYER_EMPLOYEE}/leaves/new`;
            break;
    }

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f5f7fa;
      margin: 0;
      padding: 20px;
      color: #333;
      line-height: 1.6;
    }
    
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    .header {
      background: ${type === 'REQUEST_TO_HR' ? '#f59e0b' :
            type === 'APPROVED_TO_EMPLOYEE' ? '#10b981' : '#ef4444'};
      color: white;
      padding: 20px;
      text-align: center;
    }
    
    .title {
      font-size: 22px;
      font-weight: bold;
      margin: 10px 0;
    }
    
    .content {
      padding: 25px;
    }
    
    .message-box {
      background: #f8fafc;
      padding: 20px;
      border-radius: 6px;
      margin: 15px 0;
      border-left: 4px solid ${type === 'REQUEST_TO_HR' ? '#f59e0b' :
            type === 'APPROVED_TO_EMPLOYEE' ? '#10b981' : '#ef4444'};
    }
    
    .btn {
      display: inline-block;
      background: ${type === 'REQUEST_TO_HR' ? '#f59e0b' :
            type === 'APPROVED_TO_EMPLOYEE' ? '#10b981' : '#ef4444'};
      color: white;
      padding: 12px 25px;
      text-decoration: none;
      border-radius: 6px;
      font-weight: bold;
      margin: 15px 0;
    }
    
    .footer {
      text-align: center;
      padding: 20px;
      background: #1e293b;
      color: #cbd5e1;
      font-size: 12px;
    }
  </style>
</head>

<body>
  <div class="container">
    <div class="header">
      <div class="title">${title}</div>
      <div>${process.env.COMPANY_NAME || 'Leave Management'}</div>
    </div>
    
    <div class="content">
      <p>${message}</p>
      
      <div class="message-box">
        ${details}
      </div>
      
      <center>
        <a href="${actionUrl}" class="btn" target="_blank">${actionText}</a>
      </center>
      
      <p style="margin-top: 20px; font-size: 14px; color: #64748b;">
        This is an automated message. Please do not reply.
      </p>
    </div>
  </div>
</body>
</html>
`;
};