import rateLimit from 'express-rate-limit';

export const signupStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many signup attempts. Try again later.', retryAfter: 3600 } },
});

export const handoffLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many handoff attempts. Try again later.', retryAfter: 900 } },
});
