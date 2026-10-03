import multer from 'multer';

const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!acceptedMimeTypes.has(file.mimetype)) {
      const error = new Error('Unsupported image format. Use JPG, PNG, or WebP.');
      error.status = 400;
      error.code = 'INVALID_IMAGE_FORMAT';
      callback(error);
      return;
    }
    callback(null, true);
  },
});