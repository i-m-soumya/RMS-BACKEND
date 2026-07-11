import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'rms-dev-secret-change-in-prod';
const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY = '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
