import rateLimit from 'express-rate-limit';

const standardHeaders = true;
const legacyHeaders = false;

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders,
  legacyHeaders,
  message: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Try again later.'
  }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders,
  legacyHeaders,
  message: {
    code: 'AUTH_RATE_LIMITED',
    message: 'Too many authentication attempts. Try again later.'
  }
});

export const joinSessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders,
  legacyHeaders,
  message: {
    code: 'SESSION_JOIN_RATE_LIMITED',
    message: 'Too many session join attempts. Try again later.'
  }
});

export const createOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders,
  legacyHeaders,
  message: {
    code: 'ORDER_RATE_LIMITED',
    message: 'Order submission rate exceeded. Try again shortly.'
  }
});
