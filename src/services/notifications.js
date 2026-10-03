import { randomUUID } from 'node:crypto';
import db from '../db/connection.js';
import { resolveNotificationTargets, roleRoomName } from '../socket/notificationRooms.js';

export { resolveNotificationTargets, roleRoomName, canJoinTenantRoom } from '../socket/notificationRooms.js';

export const NOTIFICATION_EVENT_TYPES = Object.freeze([
  'order:new',
  'order:confirmed',
  'order:rejected',
  'order:item_preparing',
  'order:item_ready',
  'bill:requested',
  'item:out_of_stock',
]);

export function buildNotificationSinceCursor(rawSince) {
  if (rawSince === null || rawSince === undefined || rawSince === '') {
    return null;
  }

  if (typeof rawSince === 'number' && Number.isFinite(rawSince)) {
    return { kind: 'id', value: rawSince };
  }

  if (rawSince instanceof Date) {
    if (Number.isNaN(rawSince.getTime())) {
      return null;
    }
    return { kind: 'date', value: rawSince.toISOString() };
  }

  const value = String(rawSince).trim();
  if (!value) {
    return null;
  }

  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && String(numericValue) === value) {
    return { kind: 'id', value: numericValue };
  }

  const parsedDate = new Date(value);
  if (!Number.isNaN(parsedDate.getTime())) {
    return { kind: 'date', value: parsedDate.toISOString() };
  }

  return null;
}

async function getNotificationColumns() {
  const columns = await db('notifications').columnInfo();
  const usesLegacyColumns = Boolean(columns.staff_id);
  return {
    recipientColumn: usesLegacyColumns ? 'staff_id' : 'recipient_staff_id',
    roleColumn: usesLegacyColumns ? 'role' : 'recipient_type',
    typeColumn: usesLegacyColumns ? 'event_type' : 'type',
    payloadColumn: usesLegacyColumns ? 'payload' : 'body',
    titleColumn: usesLegacyColumns ? null : 'title',
    readAtColumn: usesLegacyColumns ? null : 'read_at',
  };
}

function parseNotificationPayload(rawPayload, fallbackMessage) {
  if (rawPayload === null || rawPayload === undefined) {
    return { message: fallbackMessage };
  }

  if (typeof rawPayload === 'string') {
    try {
      const parsed = JSON.parse(rawPayload);
      return parsed && typeof parsed === 'object' ? parsed : { message: fallbackMessage };
    } catch {
      return { message: rawPayload || fallbackMessage };
    }
  }

  if (typeof rawPayload === 'object') {
    return rawPayload;
  }

  return { message: String(rawPayload || fallbackMessage) };
}

function normalizeNotificationRecord(row) {
  const payload = parseNotificationPayload(row.payload ?? row.body, row.title || row.type || row.event_type || 'Notification');
  const message = row.message || row.body || row.title || payload.message || row.type || row.event_type || 'Notification';

  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    staff_id: row.recipient_staff_id ?? row.staff_id ?? null,
    role: row.recipient_type ?? row.role ?? null,
    event_type: row.type ?? row.event_type ?? 'in_app',
    payload: payload && typeof payload === 'object' ? payload : { message },
    is_read: Boolean(row.is_read),
    created_at: row.created_at,
    message,
    title: row.title || row.type || row.event_type || 'Notification',
    read_at: row.read_at ?? null,
  };
}

export async function getRestaurantStaff(restaurantId, role = null) {
  const query = db('staff')
    .where({ restaurant_id: restaurantId })
    .andWhere('deleted_at', null)
    .andWhere('access', 'active')
    .select('id', 'role');

  if (role) {
    query.andWhere('role', role);
  }

  return query;
}

export async function listNotificationsForStaff({ restaurantId, staffId, since = null }) {
  const columns = await getNotificationColumns();
  const query = db('notifications')
    .where({ restaurant_id: restaurantId, [columns.recipientColumn]: staffId })
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc');

  const cursor = buildNotificationSinceCursor(since);
  if (cursor) {
    if (cursor.kind === 'date') {
      query.andWhere('created_at', '>', cursor.value);
    } else {
      query.andWhere('id', '>', cursor.value);
    }
  }

  const rows = await query.select('*');
  return rows.map(normalizeNotificationRecord);
}

export async function markNotificationRead({ restaurantId, staffId, notificationId }) {
  const columns = await getNotificationColumns();
  return db('notifications')
    .where({ id: notificationId, restaurant_id: restaurantId, [columns.recipientColumn]: staffId })
    .update({ is_read: 1, read_at: new Date(), updated_at: new Date() });
}

export async function markAllNotificationsRead({ restaurantId, staffId }) {
  const columns = await getNotificationColumns();
  return db('notifications')
    .where({ restaurant_id: restaurantId, [columns.recipientColumn]: staffId, is_read: 0 })
    .update({ is_read: 1, read_at: new Date(), updated_at: new Date() });
}

export async function getUnreadNotificationCount({ restaurantId, staffId }) {
  const columns = await getNotificationColumns();
  const [row] = await db('notifications')
    .where({ restaurant_id: restaurantId, [columns.recipientColumn]: staffId, is_read: 0 })
    .count({ total: '*' });

  return Number(row?.total || 0);
}

export async function persistNotificationRecipients({
  restaurantId,
  eventType,
  payload = {},
  targetRole = null,
  targetStaffId = null,
  targetCustomerId = null,
}) {
  const eventName = String(eventType || '');
  if (!NOTIFICATION_EVENT_TYPES.includes(eventName)) {
    throw new Error(`Unsupported notification event type: ${eventName}`);
  }

  let recipientRows = [];

  if (targetCustomerId) {
    recipientRows = [{ id: targetCustomerId, role: 'customer' }];
  } else if (targetStaffId) {
    const [staff] = await db('staff')
      .where({ id: targetStaffId, restaurant_id: restaurantId })
      .andWhere('deleted_at', null)
      .andWhere('access', 'active')
      .select('id', 'role')
      .limit(1);

    if (staff) {
      recipientRows = [staff];
    }
  } else if (targetRole) {
    recipientRows = await getRestaurantStaff(restaurantId, targetRole);
  } else {
    recipientRows = await getRestaurantStaff(restaurantId);
  }

  if (!recipientRows.length) {
    return [];
  }

  const storedEventType = eventName
    .replace('order:item_preparing', 'order_item_preparing')
    .replace('order:item_ready', 'order_item_ready')
    .replace(':', '_');

  const rowsToInsert = recipientRows.map((staffMember) => ({
    id: randomUUID(),
    restaurant_id: restaurantId,
    recipient_staff_id: staffMember.role === 'customer' ? null : staffMember.id,
    recipient_customer_id: staffMember.role === 'customer' ? staffMember.id : null,
    recipient_type: staffMember.role === 'customer' ? 'customer' : 'staff',
    type: storedEventType,
    title: payload?.title || eventName,
    body: typeof payload === 'string' ? payload : JSON.stringify({
      ...payload,
      message: payload?.message || payload?.title || eventName,
    }),
    status: 'pending',
    channel: 'in_app',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    is_read: 0,
    read_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  }));

  await db('notifications').insert(rowsToInsert);

  return rowsToInsert.map((row) => ({
    ...row,
    staff_id: row.recipient_staff_id,
    role: row.recipient_type,
    event_type: row.type,
    payload: parseNotificationPayload(row.body, row.title || row.type || eventName),
    is_read: Boolean(row.is_read),
    created_at: row.created_at,
  }));
}

export async function emitNotification({
  restaurantId,
  eventType,
  payload = {},
  targetRole = null,
  targetStaffId = null,
  targetCustomerId = null,
  ioOverride = globalThis.__rmsSocketServer,
  persistFn = persistNotificationRecipients,
}) {
  const io = ioOverride;
  const persisted = await persistFn({
    restaurantId,
    eventType,
    payload,
    targetRole,
    targetStaffId,
    targetCustomerId,
  });

  if (!io || !persisted.length) {
    return persisted;
  }

  const emitEventName = 'notification:new';
  const shouldEmitToRoleRoom = ['order:new', 'bill:requested', 'item:out_of_stock'].includes(eventType);

  for (const record of persisted) {
    const normalizedRecord = {
      id: record.id,
      restaurant_id: record.restaurant_id,
      staff_id: record.recipient_staff_id ?? record.staff_id ?? null,
      role: record.recipient_type ?? record.role ?? null,
      event_type: record.type ?? record.event_type ?? eventType,
      payload: parseNotificationPayload(record.payload ?? record.body, record.title || record.type || eventType),
      is_read: Boolean(record.is_read),
      created_at: record.created_at,
      customer_id: record.recipient_customer_id ?? null,
    };

    const targets = resolveNotificationTargets({
      restaurantId,
      staffId: normalizedRecord.staff_id,
      role: normalizedRecord.role,
      eventType,
    });

    const notification = {
      id: normalizedRecord.id,
      restaurant_id: normalizedRecord.restaurant_id,
      staff_id: normalizedRecord.staff_id,
      role: normalizedRecord.role,
      event_type: normalizedRecord.event_type,
      payload: normalizedRecord.payload,
      is_read: normalizedRecord.is_read,
      created_at: normalizedRecord.created_at,
    };

    if (normalizedRecord.customer_id) {
      io.to(`customer:${normalizedRecord.customer_id}`).emit(emitEventName, notification);
    } else if (targets.restaurantRoom && !shouldEmitToRoleRoom && !targetStaffId) {
      io.to(targets.restaurantRoom).emit(emitEventName, notification);
    }

    if (targets.roleRoom && shouldEmitToRoleRoom) {
      io.to(targets.roleRoom).emit(emitEventName, notification);
    }

    if (targets.personalRoom && !shouldEmitToRoleRoom) {
      io.to(targets.personalRoom).emit(emitEventName, notification);
    }

    if (targets.personalRoom && shouldEmitToRoleRoom && targetStaffId) {
      io.to(targets.personalRoom).emit(emitEventName, notification);
    }

    if (targetRole && roleRoomName(restaurantId, targetRole)) {
      io.to(roleRoomName(restaurantId, targetRole)).emit(emitEventName, notification);
    }
  }

  return persisted;
}
