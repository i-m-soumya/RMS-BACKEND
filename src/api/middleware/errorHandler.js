import { logger } from '../../config/logger.js';

export const errorHandler = (err, req, res, next) => {
  logger.error({
    err: {
      message: err.message,
      code: err.code,
      status: err.status || err.statusCode,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    },
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method
  }, 'Request failed');

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.code === 'LIMIT_FILE_SIZE'
    ? 400
    : (err.status || err.statusCode || 500);
  const message = err.code === 'LIMIT_FILE_SIZE'
    ? 'Image is too large. Maximum size is 1MB.'
    : (err.message || 'Request failed');
  res.status(statusCode).json({
    code: err.code || 'INTERNAL_ERROR',
    message: statusCode < 500 ? message : 'Internal Server Error',
    requestId: req.requestId,
    ...(Array.isArray(err.details) && { details: err.details }),
    ...(process.env.NODE_ENV === 'development' && {
      debug: {
        originalMessage: err.message
      }
    })
  });
};
