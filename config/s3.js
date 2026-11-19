import https from "https";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

export const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
    },
});

export const S3_BUCKET = process.env.AWS_S3_BUCKET;
export const S3_BASE_URL = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;

/**
 * Extract the Date header from any AWS SDK response/error payload,
 * regardless of casing or where it's nested.
 */
const extractDateHeader = (obj) => {
    const candidates = [
        obj?.$metadata?.httpHeaders,
        obj?.$response?.headers,
        obj?.response?.headers,
    ];
    for (const headers of candidates) {
        if (!headers) continue;
        const value = headers.date || headers.Date || headers.DATE;
        if (value) return value;
    }
    return null;
};


/**
 * Performs a raw HTTPS HEAD against S3 and reads the `Date` response header.
 * Bypasses the AWS SDK, auth, and clock skew entirely — S3 always returns
 * a Date header even on a 403, which is exactly what we need.
 */
const fetchS3HttpDate = () =>
    new Promise((resolve, reject) => {
        const req = https.request(
            S3_BASE_URL,
            { method: "HEAD", timeout: 5000 },
            (res) => {
                res.resume(); // drain so the socket can close
                const dateHeader = res.headers?.date;
                if (dateHeader) resolve(new Date(dateHeader));
                else reject(new Error("No Date header on S3 response"));
            }
        );
        req.on("timeout", () => req.destroy(new Error("S3 HEAD timeout")));
        req.on("error", reject);
        req.end();
    });

/**
 * Returns S3's wall-clock time, used as `signingDate` for presigned URLs.
 * Falls back to local clock if S3 is unreachable.
 */
export const getS3ServerDate = async () => {
    try {
        const d = await fetchS3HttpDate();
        console.log("[getS3ServerDate] using S3 server date:", d.toISOString());
        return d;
    } catch (err) {
        console.warn("[getS3ServerDate] HEAD failed, falling back to local:", err.message);
        return new Date();
    }
};