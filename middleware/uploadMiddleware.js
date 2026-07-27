import multer from "multer";

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only JPG, PNG, WEBP images or PDF files are allowed"), false);
    }
};

const ticketAttachmentsUpload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB per file
        files: 5,                  // max 5 attachments per ticket
    },
}).array("attachments", 5);

// Wraps multer so its errors come back as normal JSON responses instead of crashing the request
export const handleTicketAttachmentUpload = (req, res, next) => {
    ticketAttachmentsUpload(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                success: false,
                message: err.message || "File upload error"
            });
        }
        next();
    });
};