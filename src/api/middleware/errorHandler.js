export const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    code: err.code || 'INTERNAL_ERROR',
    message: err.expose ? err.message : (statusCode < 500 ? err.message : 'Internal Server Error'),
    requestId: req.requestId,
    ...(process.env.NODE_ENV === 'development' && {
      debug: {
        stack: err.stack,
        originalMessage: err.message
      }
    })
  });
};
