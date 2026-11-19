import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
    },
});

const S3_BUCKET = process.env.AWS_S3_BUCKET;
const FOLDER = "ticket-attachments";

// Uploads a single multer file buffer to S3, returns the sub-doc to push into ticket.attachments
export const uploadTicketAttachmentToS3 = async (file) => {
    const ext = path.extname(file.originalname);
    const key = `${FOLDER}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;

    await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
    }));

    return {
        key,
        url: `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        uploadedAt: new Date(),
    };
};

export const deleteTicketAttachmentFromS3 = async (key) => {
    if (!key) return;
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    } catch (error) {
        console.error("Error deleting ticket attachment from S3:", error.message);
    }
};

// Private-bucket friendly preview URL (use this if the bucket doesn't allow public reads)
export const getTicketAttachmentPresignedUrl = async (key) => {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    return await getSignedUrl(s3, command, { expiresIn: 300 });
};