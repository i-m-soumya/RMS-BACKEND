export const notFoundHandler = (req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    requestId: req.requestId
  });
};
