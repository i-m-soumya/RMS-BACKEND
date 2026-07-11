export const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(422).json({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: result.error.issues,
        requestId: req.requestId
      });
    }

    req[source] = result.data;
    next();
  };
};
