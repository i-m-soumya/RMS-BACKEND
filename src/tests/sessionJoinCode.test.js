import assert from 'node:assert/strict';
import test from 'node:test';
import { generateJoinCode, resolveJoinCodeForSession } from '../api/controllers/sessionController.js';

test('generateJoinCode produces a 4-digit numeric code', () => {
  const code = generateJoinCode();
  assert.match(code, /^\d{4}$/);
});

test('resolveJoinCodeForSession falls back to a generated 4-digit code when the stored code is missing', () => {
  const session = { id: 'session-1', join_code: null };
  const code = resolveJoinCodeForSession(session);
  assert.match(code, /^\d{4}$/);
  assert.notEqual(code, 'null');
});
