import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

import { parseCorsOrigins, resolveRuntimeHealth } from '../config/runtime.js';
import { getSocketUserFromToken, resolveSocketRestaurantId } from '../socket/index.js';

test('health checks return ok only when both database and redis are healthy', async () => {
  const healthy = await resolveRuntimeHealth({
    dbPing: async () => 'OK',
    redisPing: async () => 'PONG'
  });

  assert.deepEqual(healthy, { ok: true });

  const redisDown = await resolveRuntimeHealth({
    dbPing: async () => 'OK',
    redisPing: async () => {
      throw new Error('Redis down');
    }
  });

  assert.deepEqual(redisDown, { ok: false });

  const mysqlDown = await resolveRuntimeHealth({
    dbPing: async () => {
      throw new Error('DB down');
    },
    redisPing: async () => 'PONG'
  });

  assert.deepEqual(mysqlDown, { ok: false });
});

test('socket auth only trusts the verified JWT restaurant_id', () => {
  const payload = { id: 'staff-1', role: 'waiter', restaurantId: 'restaurant-42' };
  const token = jwt.sign(payload, 'test-secret');

  const verified = getSocketUserFromToken(token, 'test-secret');
  assert.equal(verified.id, payload.id);
  assert.equal(verified.role, payload.role);
  assert.equal(verified.restaurantId, payload.restaurantId);

  const allowed = resolveSocketRestaurantId({ verifiedUser: verified, clientRestaurantId: 'restaurant-99' });
  assert.equal(allowed, 'restaurant-42');

  const rejected = resolveSocketRestaurantId({ verifiedUser: { ...verified, restaurantId: undefined }, clientRestaurantId: 'restaurant-99' });
  assert.equal(rejected, null);
});

test('CORS parsing tolerates missing or malformed values safely', () => {
  assert.deepEqual(parseCorsOrigins('https://app.example.com, https://console.example.com'), [
    'https://app.example.com',
    'https://console.example.com'
  ]);
  assert.deepEqual(parseCorsOrigins(''), true);
  assert.deepEqual(parseCorsOrigins('https://good.example.com, , bad value'), [
    'https://good.example.com',
    'bad value'
  ]);
});
