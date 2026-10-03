import assert from 'node:assert/strict';
import test from 'node:test';
import { isRestaurantAccessAllowed } from '../api/middleware/auth.js';
import { getPublicRestaurantAvailability } from '../api/controllers/restaurantController.js';

test('auth restaurant access rejects a suspended restaurant', () => {
  assert.equal(isRestaurantAccessAllowed('active'), true);
  assert.equal(isRestaurantAccessAllowed('suspended'), false);
});

test('public restaurant GET contract returns 410 RESTAURANT_UNAVAILABLE when suspended', () => {
  assert.deepEqual(getPublicRestaurantAvailability('suspended'), {
    available: false,
    status: 410,
    code: 'RESTAURANT_UNAVAILABLE',
  });
  assert.deepEqual(getPublicRestaurantAvailability('active'), { available: true });
});