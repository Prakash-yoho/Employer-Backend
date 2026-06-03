// utils/saveAnnouncementAttachmentsInS3.js
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { getS3ServerDate } from "../config/s3.js";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

export const uploadToS3 = async (file) => {
  const ext     = path.extname(file.originalname);
  const key     = `announcements/${uuidv4()}${ext}`;
  const isImage = file.mimetype.startsWith("image/");

  await s3.send(
    new PutObjectCommand({
      Bucket:      process.env.AWS_S3_BUCKET,
      Key:         key,
      Body:        file.buffer,
      ContentType: file.mimetype,
    })
  );

  return {
    key,
    // Store just the key — generate presigned URL on demand
    url:      null,
    filename: file.originalname,
    isImage,
  };
};

export const deleteFromS3 = async (key) => {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key:    key,
    })
  );
};

// Generate a presigned URL valid for 1 hour
export const getPresignedUrl = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key:    key,
  });

  // 🔑 Sign with S3's clock, not the server's local clock
  const signingDate = await getS3ServerDate();

  return getSignedUrl(s3, command, { expiresIn, signingDate });
};

// Generate presigned URL for download (forces download via Content-Disposition)
export const getPresignedDownloadUrl = async (key, filename, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket:                     process.env.AWS_S3_BUCKET,
    Key:                        key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });

  // 🔑 Sign with S3's clock, not the server's local clock
  const signingDate = await getS3ServerDate();

  return getSignedUrl(s3, command, { expiresIn, signingDate });
};