import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET, S3_BASE_URL } from "../config/s3.js"; // ✅ named imports
import { v4 as uuidv4 } from "uuid";

export const uploadFaceImage = async (base64Image, folder = "employees") => {
  // Convert base64 to buffer
  const buffer = Buffer.from(
    base64Image.replace(/^data:image\/\w+;base64,/, ""),
    "base64"
  );

  const fileName = `${folder}/${uuidv4()}.jpg`;

  // Upload to S3
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,  // ✅ use exported bucket
    Key: fileName,
    Body: buffer,
    ContentType: "image/jpeg",
  }));

  // Return full URL
  return `${S3_BASE_URL}/${fileName}`;
};