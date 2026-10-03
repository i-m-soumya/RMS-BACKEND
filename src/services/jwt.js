import jwt from 'jsonwebtoken';
import { STAFF_SESSION_IDLE_TIMEOUT_DAYS } from '../config/auth.js';
import { getJwtSecret } from '../config/runtime.js';

const JWT_SECRET = getJwtSecret();
const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY = `${STAFF_SESSION_IDLE_TIMEOUT_DAYS}d`;
const CUSTOMER_EXPIRY = '30d';

function ensureSecret() {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required. Set it in the environment before starting the app.');
  }

  return JWT_SECRET;
}

export function signToken(payload) {
  return jwt.sign(payload, ensureSecret(), { expiresIn: ACCESS_EXPIRY });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, ensureSecret(), { expiresIn: REFRESH_EXPIRY });
}

export function signCustomerToken(payload) {
  return jwt.sign({ ...payload, role: 'customer' }, ensureSecret(), { expiresIn: CUSTOMER_EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, ensureSecret());
}
