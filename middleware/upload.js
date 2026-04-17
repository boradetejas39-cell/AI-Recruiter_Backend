const multer = require('multer');
const path = require('path');
const fs = require('fs');

/**
 * File Upload Middleware
 * Handles resume file uploads with validation and storage
 */

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with timestamp and original name
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// File filter for allowed file types
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and DOCX files are allowed.'), false);
  }
};

// Configure multer upload
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
    files: 1 // Only allow one file at a time
  }
});

/**
 * Single file upload middleware for resumes
 */
const uploadResume = upload.single('resume');

/**
 * Wrapper to handle multer errors and provide consistent error format
 */
const handleUploadError = (req, res, next) => {
  console.log('🚀 Upload request received');
  console.log('📁 Request headers:', req.headers);
  console.log('📁 Request body keys:', Object.keys(req.body));
  console.log('📁 File info:', req.file ? {
    originalname: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  } : 'No file');
  
  upload(req, res, (err) => {
    console.log('📤 Upload completed, error:', err);
    if (err) {
      console.error('❌ Multer error:', err);
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    
    console.log('✅ File uploaded successfully:', req.file ? req.file.originalname : 'No file');
    
    // Check if file was actually uploaded
    if (!req.file) {
      console.log('❌ No file in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a file to upload.'
      });
    }
    
    // Pass control to next middleware
    next();
  });
};

/**
 * Clean up uploaded file on error
 */
const cleanupOnError = (req, res, next) => {
  // Store original file path for cleanup
  const originalFilePath = req.file ? req.file.path : null;
  
  // Override res.json to cleanup on error responses
  const originalJson = res.json;
  res.json = function(data) {
    // If this is an error response and we have a file, clean it up
    if (!data.success && originalFilePath && fs.existsSync(originalFilePath)) {
      try {
        fs.unlinkSync(originalFilePath);
        console.log('Cleaned up file:', originalFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Validate uploaded file metadata
 */
const validateFile = (req, res, next) => {
  console.log('🔍 Validating uploaded file...');
  
  if (!req.file) {
    console.log('❌ No file found in request');
    return res.status(400).json({
      success: false,
      message: 'No file uploaded.'
    });
  }

  console.log('📁 File details:', {
    originalname: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });

  const file = req.file;
  const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024;
  
  // Additional validation
  if (file.size === 0) {
    console.log('❌ File is empty');
    return res.status(400).json({
      success: false,
      message: 'Uploaded file is empty.'
    });
  }

  // Check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.pdf', '.docx', '.doc'];
  
  if (!allowedExts.includes(ext)) {
    console.log('❌ Invalid file extension:', ext);
    return res.status(400).json({
      success: false,
      message: 'Invalid file extension. Only PDF and DOCX files are allowed.'
    });
  }

  // Add file type info to request
  req.fileType = ext === '.pdf' ? 'pdf' : 'docx';
  console.log('✅ File validation passed, fileType:', req.fileType);
  
  next();
};

module.exports = {
  uploadResume: [handleUploadError, cleanupOnError, validateFile],
  upload,
  fileFilter
};
