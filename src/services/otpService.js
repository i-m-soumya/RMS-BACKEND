import { randomUUID } from 'crypto';

const OTP_VALUE = '0000';
const OTP_TTL_MS = 10 * 60 * 1000;
const otpRecords = new Map();

function normalizeMobile(mobile) {
  return String(mobile || '').replace(/\D/g, '');
}

export function requestOtp(mobile) {
  const normalizedMobile = normalizeMobile(mobile);
  if (!/^\d{10}$/.test(normalizedMobile)) {
    const error = new Error('A valid 10-digit mobile number is required');
    error.status = 422;
    error.code = 'INVALID_MOBILE';
    throw error;
  }

  otpRecords.set(normalizedMobile, {
    otp: OTP_VALUE,
    expiresAt: Date.now() + OTP_TTL_MS,
    verificationToken: null,
  });

  console.log(`[OTP] Mobile ${normalizedMobile}: ${OTP_VALUE}`);
  return { mobile: normalizedMobile, expiresInSeconds: OTP_TTL_MS / 1000 };
}

export function verifyOtp(mobile, otp) {
  const normalizedMobile = normalizeMobile(mobile);
  const record = otpRecords.get(normalizedMobile);
  if (!record || record.expiresAt < Date.now() || String(otp) !== record.otp) {
    const error = new Error('Invalid or expired OTP');
    error.status = 422;
    error.code = 'INVALID_OTP';
    throw error;
  }

  const verificationToken = randomUUID();
  record.verificationToken = verificationToken;
  return { mobile: normalizedMobile, verificationToken };
}

export function assertOtpVerified(mobile, verificationToken) {
  const normalizedMobile = normalizeMobile(mobile);
  const record = otpRecords.get(normalizedMobile);
  if (!record || record.expiresAt < Date.now() || record.verificationToken !== verificationToken) {
    const error = new Error('Mobile OTP verification is required before placing an order');
    error.status = 422;
    error.code = 'OTP_VERIFICATION_REQUIRED';
    throw error;
  }
}
