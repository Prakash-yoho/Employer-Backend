import multer from 'multer';
import path from 'path';

// Configure memory storage
const storage = multer.memoryStorage();

// Enhanced file filter for images only
const fileFilter = (req, file, cb) => {
    try {
        // Get file extension
        const ext = path.extname(file.originalname).toLowerCase();

        // Check file extension
        const allowedExtensions = ['.jpg', '.jpeg', '.png'];

        // Check mime type
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];

        // Log for debugging
        console.log('File details:', {
            originalname: file.originalname,
            extension: ext,
            mimetype: file.mimetype,
            allowedExtensions,
            allowedMimeTypes
        });

        // Check both extension and mime type
        const isValidExtension = allowedExtensions.includes(ext);
        const isValidMimeType = allowedMimeTypes.includes(file.mimetype);

        if (isValidExtension && isValidMimeType) {
            console.log('File accepted:', file.originalname);
            return cb(null, true);
        } else {
            console.log('File rejected:', {
                extension: ext,
                mimetype: file.mimetype,
                isValidExtension,
                isValidMimeType
            });

            // Create a more descriptive error message
            const error = new Error('Invalid file type. Only JPG, JPEG, and PNG images are allowed.');
            error.code = 'INVALID_FILE_TYPE';
            return cb(error, false);
        }
    } catch (error) {
        console.error('Error in file filter:', error);
        cb(error, false);
    }
};

// Configure multer with error handling
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: fileFilter
});

// Error handling middleware for multer
export const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // A Multer error occurred when uploading
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size too large. Maximum size is 5MB.'
            });
        }

        return res.status(400).json({
            success: false,
            message: err.message
        });
    } else if (err) {
        // Custom error from fileFilter
        if (err.code === 'INVALID_FILE_TYPE') {
            return res.status(400).json({
                success: false,
                message: err.message
            });
        }

        // Other errors
        return res.status(500).json({
            success: false,
            message: 'Server error during file upload'
        });
    }

    // No error, continue
    next();
};

export default upload;