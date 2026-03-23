import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET, S3_BASE_URL } from "../config/s3.js";
import mime from "mime-types";
import sharp from "sharp";

export const saveOfferLetterInS3 = async (pdfBuffer, applicationId) => {
    try {
        const filename = `offer_letters/offer_${applicationId}_${Date.now()}.pdf`;

        const command = new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: filename,
            Body: pdfBuffer,
            ContentType: mime.lookup("pdf") || "application/pdf"
        });

        await s3.send(command);

        // Return public URL
        return `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
    } catch (err) {
        console.error("S3 upload error:", err);
        throw new Error("Failed to upload offer letter to S3");
    }
};

export const saveResumeInS3 = async (fileBuffer, userId, mimeType) => {
    try {
        const filename = `resumes/resume_${userId}_${Date.now()}`;

        const command = new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: filename,
            Body: fileBuffer,
            ContentType: mimeType
        });

        await s3.send(command);

        return `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;

    } catch (err) {
        console.error("S3 resume upload error:", err);
        throw new Error("Failed to upload resume to S3");
    }
};

export const uploadImageToS3 = async (buffer, employeeId, originalName) => {
    try {
        // Generate unique filename
        const timestamp = Date.now();
        const extension = originalName.split('.').pop().toLowerCase();
        const filename = `profile_${timestamp}.${extension}`;
        const key = `employee-profiles/${employeeId}/${filename}`;

        // Optimize image with sharp
        let optimizedBuffer;
        if (extension === 'png') {
            optimizedBuffer = await sharp(buffer)
                .resize(500, 500, {
                    fit: 'cover',
                    position: 'center'
                })
                .png({ quality: 80 })
                .toBuffer();
        } else {
            optimizedBuffer = await sharp(buffer)
                .resize(500, 500, {
                    fit: 'cover',
                    position: 'center'
                })
                .jpeg({ quality: 80 })
                .toBuffer();
        }

        // Upload to S3
        const uploadParams = {
            Bucket: S3_BUCKET,
            Key: key,
            Body: optimizedBuffer,
            ContentType: `image/${extension === 'png' ? 'png' : 'jpeg'}`,
            Metadata: {
                'employee-id': employeeId,
                'uploaded-at': timestamp.toString()
            }
        };

        await s3.send(new PutObjectCommand(uploadParams));

        // Construct public URL
        const imageUrl = `${S3_BASE_URL}/${key}`;

        return {
            key,
            url: imageUrl,
            filename,
            size: optimizedBuffer.length
        };
    } catch (error) {
        console.error('S3 upload error:', error);
        throw new Error(`Failed to upload image to S3: ${error.message}`);
    }
};

export const deleteImageFromS3 = async (key) => {
    try {
        if (!key) return true;

        const deleteParams = {
            Bucket: S3_BUCKET,
            Key: key
        };

        await s3.send(new DeleteObjectCommand(deleteParams));
        return true;
    } catch (error) {
        console.error('S3 delete error:', error);
        throw new Error(`Failed to delete image from S3: ${error.message}`);
    }
};

export const uploadDocumentToS3 = async (buffer, employeeId, documentType, originalName) => {
    try {
        // Generate unique filename
        const timestamp = Date.now();
        const extension = originalName.split('.').pop().toLowerCase();
        const safeDocumentType = documentType.replace(/[^a-zA-Z0-9]/g, '-');
        const filename = `${safeDocumentType}_${timestamp}.${extension}`;
        const key = `employee-documents/${employeeId}/${filename}`;

        // Determine content type
        let contentType;
        if (extension === 'pdf') {
            contentType = 'application/pdf';
        } else if (extension === 'png') {
            contentType = 'image/png';
        } else {
            contentType = 'image/jpeg';
        }

        // Upload to S3
        const uploadParams = {
            Bucket: S3_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        };

        await s3.send(new PutObjectCommand(uploadParams));

        // Construct public URL
        const fileUrl = `${S3_BASE_URL}/${key}`;

        return {
            key,
            url: fileUrl,
            filename: originalName,
            size: buffer.length,
            mimeType: contentType
        };
    } catch (error) {
        console.error('S3 document upload error:', error);
        throw new Error(`Failed to upload document to S3: ${error.message}`);
    }
};

export const deleteDocumentFromS3 = async (key) => {
    try {
        if (!key) return true;

        const deleteParams = {
            Bucket: S3_BUCKET,
            Key: key
        };

        await s3.send(new DeleteObjectCommand(deleteParams));
        return true;
    } catch (error) {
        console.error('S3 document delete error:', error);
        throw new Error(`Failed to delete document from S3: ${error.message}`);
    }
};

// Batch upload multiple documents
export const uploadMultipleDocuments = async (files, employeeId, documentType) => {
    const uploadPromises = files.map(file =>
        uploadDocumentToS3(file.buffer, employeeId, documentType, file.originalname)
    );

    return Promise.all(uploadPromises);
};