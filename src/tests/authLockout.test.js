import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_FAILED_LOGINS,
  LOCKOUT_DURATION_MS,
  getNextFailedAttemptState,
  getFailedAttemptStatus,
  resetStaffLoginLockout,
} from '../services/staffLoginSecurity.js';

test('exact 5th consecutive failure triggers lockout at the boundary', () => {
  const now = new Date('2024-01-01T00:00:00Z');
  const boundaryFailure = getNextFailedAttemptState(4, now);

  assert.equal(boundaryFailure.failedAttempts, 5);
  assert.equal(boundaryFailure.remainingAttempts, 0);
  assert.equal(boundaryFailure.isLocked, true);
  assert.equal(boundaryFailure.lockoutUntil instanceof Date, true);
  assert.equal(boundaryFailure.lockoutUntil.getTime() - now.getTime(), LOCKOUT_DURATION_MS);

  const status = getFailedAttemptStatus({ failedAttempts: 4, lockoutUntil: null, now });
  assert.equal(status.remainingAttempts, 1);
  assert.equal(status.isLocked, false);
});

test('failed attempts before lockout include a warning message', () => {
  const now = new Date('2024-01-01T00:00:00Z');
  const afterThreeFailures = getNextFailedAttemptState(2, now);
  const beforeLockout = getFailedAttemptStatus({ failedAttempts: 4, lockoutUntil: null, now });

  assert.equal(afterThreeFailures.failedAttempts, 3);
  assert.equal(afterThreeFailures.remainingAttempts, 2);
  assert.equal(afterThreeFailures.isLocked, false);
  assert.match(afterThreeFailures.warning, /2 attempts remaining/i);

  assert.equal(beforeLockout.failedAttempts, 4);
  assert.equal(beforeLockout.remainingAttempts, 1);
  assert.equal(beforeLockout.isLocked, false);
  assert.match(beforeLockout.warning, /final attempt/i);
});

test('successful login in the middle of a sequence resets the failed-attempt counter', () => {
  const now = new Date('2024-01-01T00:00:00Z');
  const afterOneFailure = getNextFailedAttemptState(0, now);
  const afterTwoFailures = getNextFailedAttemptState(afterOneFailure.failedAttempts, now);
  const afterSuccessfulLogin = resetStaffLoginLockout();
  const nextFailureAfterReset = getNextFailedAttemptState(afterSuccessfulLogin.failedAttempts, now);

  assert.equal(afterOneFailure.failedAttempts, 1);
  assert.equal(afterTwoFailures.failedAttempts, 2);
  assert.equal(afterSuccessfulLogin.failedAttempts, 0);
  assert.equal(afterSuccessfulLogin.remainingAttempts, MAX_FAILED_LOGINS);
  assert.equal(afterSuccessfulLogin.isLocked, false);
  assert.equal(nextFailureAfterReset.failedAttempts, 1);
  assert.equal(nextFailureAfterReset.remainingAttempts, MAX_FAILED_LOGINS - 1);
  assert.equal(nextFailureAfterReset.isLocked, false);
});
