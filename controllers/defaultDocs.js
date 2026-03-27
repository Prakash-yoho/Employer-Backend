export const getDefaultDocuments = (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const documents = [
      {
        name: "Hr Policy",
        url: `${baseUrl}/public/docs/HR POLICY.pdf`,
      },
      {
        name: "Posh",
        url: `${baseUrl}/public/docs/POSH_KIAQ.pdf`,
      },
      {
        name: "Holiday Calendar",
        url: `${baseUrl}/public/docs/HOLIDAY_CALENDER_2026.pdf`,
      },
    {
      name: "Official Mails and its Purpose",
      url: `${baseUrl}/public/docs/OFFICIAL MAIL AND ITS PURPOSE IN KIAQ TECHNOLOGIES.pdf`,
    },
    {
      name: "Jibble Registeration - KIAQ Attendance System",
      url: `${baseUrl}/public/docs/JIBBLE.pdf`,
    },
    {
      name: "UAN - Activation/EPFO Submission",
      url: `${baseUrl}/public/docs/UAN-EPFO.pdf`,
    },
  ];

  res.status(200).json({
    success: true,
    data: documents,
  });
};