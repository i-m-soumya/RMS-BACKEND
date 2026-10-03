import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRestaurantTableParams } from '../api/controllers/restaurantController.js';
import { tableParamSchema, restaurantTableParamSchema } from '../api/validators/restaurants.js';

test('table lookup resolves restaurant UUID and table number route params', () => {
  const params = {
    id: '58c73809-4c89-4bda-89b3-817074926244',
    tableId: '2',
  };

  assert.equal(tableParamSchema.safeParse(params).success, true);
  assert.deepEqual(resolveRestaurantTableParams(params), {
    restaurantKey: params.id,
    tableNumber: '2',
  });
});

test('table lookup continues to resolve slug and tableNumber route params', () => {
  const params = { slug: 'burger-co', tableNumber: '2' };

  assert.equal(restaurantTableParamSchema.safeParse(params).success, true);
  assert.deepEqual(resolveRestaurantTableParams(params), {
    restaurantKey: 'burger-co',
    tableNumber: '2',
  });
});