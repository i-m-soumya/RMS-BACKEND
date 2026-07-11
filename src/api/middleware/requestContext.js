import { randomUUID } from 'crypto';

export const assignRequestId = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};
