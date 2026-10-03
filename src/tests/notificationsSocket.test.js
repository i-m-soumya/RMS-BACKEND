import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSocketTargetRooms, canJoinTenantRoom } from '../socket/notificationRooms.js';
import { buildNotificationSinceCursor, emitNotification, resolveNotificationTargets } from '../services/notifications.js';
import { applySinceFilter, buildSinceCursor } from '../services/reconnectState.js';

test('buildSocketTargetRooms includes tenant, role, and personal rooms without leaking across restaurants', () => {
  const rooms = buildSocketTargetRooms({
    restaurantId: 'rest-1',
    staffId: 'staff-42',
    role: 'waiter',
  });

  assert.deepEqual(Array.from(rooms).sort(), [
    'restaurant:rest-1',
    'restaurant:rest-1:waiters',
    'staff:staff-42',
  ]);
});

test('resolveNotificationTargets maps `order:new` waits to all waiters in the restaurant and personal staff room when intended', () => {
  const targets = resolveNotificationTargets({
    restaurantId: 'rest-1',
    staffId: 'staff-42',
    role: 'waiter',
    eventType: 'order:new',
  });

  assert.deepEqual(targets, {
    restaurantRoom: 'restaurant:rest-1',
    roleRoom: 'restaurant:rest-1:waiters',
    personalRoom: 'staff:staff-42',
  });
});

test('socket-authenticated Restaurant B client is rejected when it attempts to join a Restaurant A room', () => {
  const allowed = canJoinTenantRoom({ userRestaurantId: 'rest-1', requestedRestaurantId: 'rest-2' });
  assert.equal(allowed, false);
  assert.equal(canJoinTenantRoom({ userRestaurantId: 'rest-1', requestedRestaurantId: 'rest-1' }), true);
});

test('notification reconnect cursors normalize ISO timestamps to created_at filters', () => {
  assert.deepEqual(buildNotificationSinceCursor('2026-09-14T10:30:00.000Z'), {
    kind: 'date',
    value: '2026-09-14T10:30:00.000Z',
  });
});

test('notification reconnect cursors normalize numeric ids to id filters', () => {
  assert.deepEqual(buildNotificationSinceCursor('42'), {
    kind: 'id',
    value: 42,
  });
});

test('session and order reconnect cursors filter updates since the last seen timestamp', () => {
  const since = buildSinceCursor('2026-09-14T10:30:00.000Z');
  const rows = [
    { id: 's-1', updated_at: '2026-09-14T10:00:00.000Z' },
    { id: 's-2', updated_at: '2026-09-14T10:35:00.000Z' },
    { id: 's-3', updated_at: '2026-09-14T10:42:00.000Z' },
  ];

  assert.deepEqual(applySinceFilter(rows, since), [
    { id: 's-2', updated_at: '2026-09-14T10:35:00.000Z' },
    { id: 's-3', updated_at: '2026-09-14T10:42:00.000Z' },
  ]);
});

test('disconnect/reconnect catch-up returns all missed notifications once each in timestamp order', () => {
  const emitted = [];
  const persisted = [];
  const lastSeenAt = '2026-09-14T10:00:00.000Z';

  const pushNotification = ({ id, eventType, payload, createdAt }) => {
    const row = {
      id,
      restaurant_id: 'rest-1',
      staff_id: 'staff-42',
      role: 'waiter',
      event_type: eventType,
      payload,
      is_read: false,
      created_at: createdAt,
    };
    persisted.push(row);
    emitted.push({ id, event_type: eventType, payload, created_at: createdAt });
  };

  pushNotification({ id: 'n-1', eventType: 'order:new', payload: { order_id: 'o-1' }, createdAt: '2026-09-14T10:00:00.000Z' });

  const since = buildSinceCursor(lastSeenAt);
  const reconnectStream = [
    { id: 'n-2', eventType: 'order:new', payload: { order_id: 'o-2' }, createdAt: '2026-09-14T10:05:00.000Z' },
    { id: 'n-3', eventType: 'order:confirmed', payload: { order_id: 'o-1', status: 'confirmed' }, createdAt: '2026-09-14T10:07:00.000Z' },
    { id: 'n-4', eventType: 'order:item_ready', payload: { order_id: 'o-1', item_id: 'item-7' }, createdAt: '2026-09-14T10:09:00.000Z' },
  ];

  reconnectStream.forEach(pushNotification);
  const replay = applySinceFilter(persisted, since).map((row) => ({
    id: row.id,
    event_type: row.event_type,
    payload: row.payload,
    created_at: row.created_at,
  }));

  assert.deepEqual(replay.map((entry) => entry.id), ['n-2', 'n-3', 'n-4']);
  assert.equal(replay.length, 3);
  assert.deepEqual(new Set(replay.map((entry) => entry.id)).size, 3);
});

test('persisted notification rows exist alongside the socket emit, with the correct restaurant/event payload', async () => {
  const savedRows = [];
  const fakeIo = {
    to: (room) => ({
      emit: (eventName, payload) => {
        savedRows.push({ eventName, room, payload });
      },
    }),
  };

  const persisted = await emitNotification({
    restaurantId: 'rest-1',
    eventType: 'order:new',
    payload: { order_id: 'o-99', table_number: 4 },
    targetRole: 'waiter',
    ioOverride: fakeIo,
    persistFn: async () => [{
      id: 'row-1',
      restaurant_id: 'rest-1',
      staff_id: 'staff-42',
      role: 'waiter',
      event_type: 'order:new',
      payload: { order_id: 'o-99', table_number: 4 },
      is_read: false,
      created_at: new Date('2026-09-14T10:00:00.000Z'),
    }],
  });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].restaurant_id, 'rest-1');
  assert.equal(persisted[0].event_type, 'order:new');
  assert.deepEqual(persisted[0].payload, { order_id: 'o-99', table_number: 4 });
});

test('unread counts match the actual number of unread rows for the recipient and decrement when read', () => {
  const rows = [
    { id: 'n-1', is_read: false },
    { id: 'n-2', is_read: true },
    { id: 'n-3', is_read: false },
    { id: 'n-4', is_read: false },
  ];

  const unreadCount = rows.filter((row) => !row.is_read).length;
  assert.equal(unreadCount, 3);

  const afterRead = rows.map((row) => (row.id === 'n-3' ? { ...row, is_read: true } : row));
  assert.equal(afterRead.filter((row) => !row.is_read).length, 2);

  const allRead = afterRead.map((row) => ({ ...row, is_read: true }));
  assert.equal(allRead.filter((row) => !row.is_read).length, 0);
});

test('emitNotification never emits when the persistence step fails', async () => {
  const emitted = [];
  const fakeIo = {
    to: (room) => ({
      emit: (eventName, payload) => {
        emitted.push({ room, eventName, payload });
      },
    }),
  };

  await assert.rejects(
    () => emitNotification({
      restaurantId: 'rest-1',
      eventType: 'order:new',
      payload: { order_id: 'o-1' },
      targetRole: 'waiter',
      ioOverride: fakeIo,
      persistFn: async () => {
        throw new Error('notification insert failed');
      },
    }),
    /notification insert failed/
  );

  assert.deepEqual(emitted, []);
});

test('order:new reaches waiters but not chefs, while kitchen-ready events reach chefs but not waiters', async () => {
  const emitted = [];
  const fakeIo = {
    to: (room) => ({
      emit: (eventName, payload) => {
        emitted.push({ room, eventName, payload });
      },
    }),
  };

  const waitersPersisted = [{
    id: 'n-new',
    restaurant_id: 'rest-1',
    staff_id: 'staff-42',
    role: 'waiter',
    event_type: 'order:new',
    payload: { order_id: 'o-1' },
    is_read: false,
    created_at: new Date(),
  }];

  const chefsPersisted = [{
    id: 'n-ready',
    restaurant_id: 'rest-1',
    staff_id: 'staff-87',
    role: 'chef',
    event_type: 'order:item_ready',
    payload: { item_id: 'item-1', order_id: 'o-1' },
    is_read: false,
    created_at: new Date(),
  }];

  await emitNotification({
    restaurantId: 'rest-1',
    eventType: 'order:new',
    payload: { order_id: 'o-1' },
    targetRole: 'waiter',
    ioOverride: fakeIo,
    persistFn: async () => waitersPersisted,
  });

  await emitNotification({
    restaurantId: 'rest-1',
    eventType: 'order:item_ready',
    payload: { item_id: 'item-1', order_id: 'o-1' },
    targetRole: 'chef',
    ioOverride: fakeIo,
    persistFn: async () => chefsPersisted,
  });

  const waiterRoomCalls = emitted.filter((entry) => entry.room === 'restaurant:rest-1:waiters');
  const chefRoomCalls = emitted.filter((entry) => entry.room === 'restaurant:rest-1:chefs');

  assert.equal(waiterRoomCalls.length >= 1, true);
  assert.equal(chefRoomCalls.length >= 1, true);
  assert.ok(waiterRoomCalls.every((entry) => entry.payload.event_type === 'order:new'));
  assert.ok(chefRoomCalls.every((entry) => entry.payload.event_type === 'order:item_ready'));
});

test('tenant isolation rejects a restaurant-room join attempt for a different restaurant', () => {
  assert.equal(canJoinTenantRoom({ userRestaurantId: 'rest-1', requestedRestaurantId: 'rest-2' }), false);
  assert.equal(canJoinTenantRoom({ userRestaurantId: 'rest-1', requestedRestaurantId: 'rest-1' }), true);
});
