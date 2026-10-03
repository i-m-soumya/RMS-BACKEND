import { randomUUID } from 'crypto';
import db from '../db/connection.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function ensureStaffLoginSecurityTable() {
  const exists = await db.schema.hasTable('staff_login_security');
  if (exists) {
    return;
  }

  await db.schema.createTable('staff_login_security', (table) => {
    table.string('id', 36).primary();
    table.string('staff_id', 36).notNullable().unique();
    table.integer('failed_attempts').notNullable().defaultTo(0);
    table.dateTime('lockout_until').nullable();
    table.dateTime('last_failed_at').nullable();
    table.dateTime('locked_at').nullable();
    table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
    table.dateTime('updated_at').notNullable().defaultTo(db.fn.now());
  });

  await db.raw('ALTER TABLE staff_login_security ADD CONSTRAINT fk_staff_login_security_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE');
}

export function getFailedAttemptWarning(failedAttempts) {
  const normalizedFailedAttempts = Math.max(0, Number(failedAttempts) || 0);

  if (normalizedFailedAttempts <= 0) {
    return null;
  }

  const attemptsRemaining = MAX_FAILED_LOGINS - normalizedFailedAttempts;
  if (attemptsRemaining <= 0) {
    return null;
  }

  if (attemptsRemaining === 1) {
    return 'Warning: Final attempt before your account is temporarily locked.';
  }

  return `Warning: ${attemptsRemaining} attempts remaining before your account is temporarily locked.`;
}

export function getFailedAttemptStatus({ failedAttempts, lockoutUntil, now = new Date() } = {}) {
  const normalizedFailedAttempts = Math.max(0, Number(failedAttempts) || 0);
  const normalizedLockoutUntil = lockoutUntil ? new Date(lockoutUntil) : null;
  const activeLockout = Boolean(normalizedLockoutUntil && normalizedLockoutUntil.getTime() > now.getTime());

  return {
    failedAttempts: normalizedFailedAttempts,
    remainingAttempts: activeLockout ? 0 : Math.max(0, MAX_FAILED_LOGINS - normalizedFailedAttempts),
    isLocked: activeLockout,
    lockoutUntil: activeLockout ? normalizedLockoutUntil : null,
    warning: activeLockout ? null : getFailedAttemptWarning(normalizedFailedAttempts),
  };
}

export function getNextFailedAttemptState(failedAttempts, now = new Date()) {
  const nextCount = Math.max(0, Number(failedAttempts) || 0) + 1;
  const isLocked = nextCount >= MAX_FAILED_LOGINS;
  const lockoutUntil = isLocked ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null;

  return {
    failedAttempts: nextCount,
    remainingAttempts: isLocked ? 0 : Math.max(0, MAX_FAILED_LOGINS - nextCount),
    isLocked,
    lockoutUntil,
    warning: isLocked ? null : getFailedAttemptWarning(nextCount),
  };
}

export function resetStaffLoginLockout() {
  return {
    failedAttempts: 0,
    remainingAttempts: MAX_FAILED_LOGINS,
    isLocked: false,
    lockoutUntil: null,
  };
}

export async function getStaffLoginSecurity(staffId) {
  const hasTable = await db.schema.hasTable('staff_login_security');
  if (!hasTable) {
    await ensureStaffLoginSecurityTable();
  }

  const [record] = await db('staff_login_security').where({ staff_id: staffId }).limit(1);
  return record || null;
}

export async function ensureStaffLoginSecurityRow(staffId) {
  const existing = await getStaffLoginSecurity(staffId);
  if (existing) return existing;

  await db('staff_login_security').insert({
    id: randomUUID(),
    staff_id: staffId,
    failed_attempts: 0,
    lockout_until: null,
    last_failed_at: null,
    locked_at: null,
  });

  return getStaffLoginSecurity(staffId);
}

export async function recordFailedLogin(staffId) {
  const security = await ensureStaffLoginSecurityRow(staffId);
  const now = new Date();
  const nextState = getNextFailedAttemptState(security.failed_attempts || 0, now);

  await db('staff_login_security')
    .where({ staff_id: staffId })
    .update({
      failed_attempts: nextState.failedAttempts,
      last_failed_at: now,
      lockout_until: nextState.isLocked ? nextState.lockoutUntil : null,
      locked_at: nextState.isLocked ? now : null,
      updated_at: now,
    });

  return {
    ...nextState,
    failedAttempts: nextState.failedAttempts,
    remainingAttempts: nextState.remainingAttempts,
  };
}

export async function resetFailedLoginAttempts(staffId) {
  await db('staff_login_security')
    .where({ staff_id: staffId })
    .update({
      failed_attempts: 0,
      lockout_until: null,
      last_failed_at: null,
      locked_at: null,
      updated_at: new Date(),
    });

  return resetStaffLoginLockout();
}

export async function isStaffLocked(staffId, now = new Date()) {
  const security = await getStaffLoginSecurity(staffId);
  if (!security || !security.lockout_until) {
    return false;
  }

  const lockoutUntil = new Date(security.lockout_until);
  if (lockoutUntil.getTime() <= now.getTime()) {
    await db('staff_login_security')
      .where({ staff_id: staffId })
      .update({
        failed_attempts: 0,
        lockout_until: null,
        locked_at: null,
        updated_at: now,
      });
    return false;
  }

  return true;
}
