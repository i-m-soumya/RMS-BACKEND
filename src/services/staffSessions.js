import { createHash, randomUUID } from 'crypto';
import db from '../db/connection.js';
import { STAFF_SESSION_IDLE_TIMEOUT_DAYS } from '../config/auth.js';

const SESSION_TOUCH_THROTTLE_MS = 5 * 60 * 1000;

function sessionExpiry() {
  return new Date(Date.now() + STAFF_SESSION_IDLE_TIMEOUT_DAYS * 24 * 60 * 60 * 1000);
}

export function hashStaffToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function ensureStaffSessionRefreshHashColumn() {
  const hasTable = await db.schema.hasTable('staff_sessions');
  if (!hasTable) {
    return;
  }

  const hasColumn = await db.schema.hasColumn('staff_sessions', 'refresh_token_hash');
  if (!hasColumn) {
    await db.schema.alterTable('staff_sessions', (table) => {
      table.string('refresh_token_hash', 64).nullable();
    });
  }
}

export async function createStaffSession({ staffId, token, refreshToken, req, sessionId = randomUUID() }) {
  await ensureStaffSessionRefreshHashColumn();

  const insertData = {
    id: sessionId,
    staff_id: staffId,
    token_hash: hashStaffToken(token),
    device_info: req.get('user-agent')?.slice(0, 500) || null,
    ip_address: req.ip || null,
    status: 'active',
    expires_at: sessionExpiry(),
  };

  if (refreshToken) {
    const hasColumn = await db.schema.hasColumn('staff_sessions', 'refresh_token_hash');
    if (hasColumn) {
      insertData.refresh_token_hash = hashStaffToken(refreshToken);
    }
  }

  await db('staff_sessions').insert(insertData);

  return sessionId;
}

export async function findActiveStaffSession(token) {
  const tokenHash = hashStaffToken(token);
  const [session] = await db('staff_sessions')
    .where({ token_hash: tokenHash, status: 'active' })
    .where('expires_at', '>', db.fn.now())
    .limit(1);

  return session || null;
}

export async function findActiveStaffSessionByRefreshToken(refreshToken) {
  const tokenHash = hashStaffToken(refreshToken);
  const [session] = await db('staff_sessions')
    .where({ refresh_token_hash: tokenHash, status: 'active' })
    .where('expires_at', '>', db.fn.now())
    .limit(1);

  return session || null;
}

export async function touchStaffSession(session) {
  const remainingMs = new Date(session.expires_at).getTime() - Date.now();
  const timeoutMs = STAFF_SESSION_IDLE_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

  if (remainingMs > timeoutMs - SESSION_TOUCH_THROTTLE_MS) {
    return;
  }

  await db('staff_sessions')
    .where({ id: session.id, status: 'active' })
    .update({ expires_at: sessionExpiry() });
}

export async function rotateStaffSessionToken(sessionId, newToken, newRefreshToken) {
  const [session] = await db('staff_sessions')
    .where({ id: sessionId, status: 'active' })
    .where('expires_at', '>', db.fn.now())
    .limit(1);

  if (!session) {
    return false;
  }

  const updateData = {
    token_hash: hashStaffToken(newToken),
    expires_at: sessionExpiry(),
  };

  const hasRefreshHashColumn = await db.schema.hasColumn('staff_sessions', 'refresh_token_hash');
  if (hasRefreshHashColumn) {
    updateData.refresh_token_hash = newRefreshToken ? hashStaffToken(newRefreshToken) : session.refresh_token_hash;
  }

  await db('staff_sessions').where({ id: sessionId }).update(updateData);
  return true;
}

export async function logoutStaffSession(token) {
  await ensureStaffSessionRefreshHashColumn();

  const updateData = {
    status: 'logged_out',
    invalidated_at: db.fn.now(),
  };

  const hasRefreshHashColumn = await db.schema.hasColumn('staff_sessions', 'refresh_token_hash');
  if (hasRefreshHashColumn) {
    updateData.refresh_token_hash = null;
  }

  const updated = await db('staff_sessions')
    .where({ token_hash: hashStaffToken(token), status: 'active' })
    .update(updateData);

  return updated > 0;
}

export async function logoutStaffSessionByRefreshToken(refreshToken) {
  await ensureStaffSessionRefreshHashColumn();

  const updateData = {
    status: 'logged_out',
    invalidated_at: db.fn.now(),
  };

  const hasRefreshHashColumn = await db.schema.hasColumn('staff_sessions', 'refresh_token_hash');
  if (hasRefreshHashColumn) {
    updateData.refresh_token_hash = null;
  }

  const updated = await db('staff_sessions')
    .where({ refresh_token_hash: hashStaffToken(refreshToken), status: 'active' })
    .update(updateData);

  return updated > 0;
}