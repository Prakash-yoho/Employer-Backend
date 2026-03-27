import { PutObjectCommand } from "@aws-sdk/client-s3";
import mime from "mime-types";
import { s3, S3_BUCKET } from "../config/s3.js"; // adjust path

export const saveAppointmentLetterInS3 = async (pdfBuffer, employeeName) => {
  try {
    // Clean filename (remove spaces & special chars)
    const safeName = employeeName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");

    const filename = `appointment_letters/appointment_${safeName}_${Date.now()}.pdf`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: filename,
      Body: pdfBuffer,
      ContentType: mime.lookup("pdf") || "application/pdf",
    });

    await s3.send(command);

    // Return public URL
    return `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
  } catch (err) {
    console.error("S3 upload error:", err);
    throw new Error("Failed to upload appointment letter to S3");
  }
};