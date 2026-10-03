import assert from 'node:assert/strict';
import test from 'node:test';
import { validate } from '../api/middleware/validate.js';
import { restaurantTableParamSchema } from '../api/validators/restaurants.js';

test('restaurant table param validation preserves tableNumber in request params', () => {
  const parsed = restaurantTableParamSchema.safeParse({ slug: 'burger-co', tableNumber: '1' });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.slug, 'burger-co');
  assert.equal(parsed.data.tableNumber, '1');

  const req = { params: { slug: 'burger-co', tableNumber: '1' } };
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  let nextCalled = false;
  validate(restaurantTableParamSchema, 'params')(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.params.slug, 'burger-co');
  assert.equal(req.params.tableNumber, '1');
});

test('session_members inserts match the live schema and omit non-existent timestamp columns', () => {
  const insertPayload = {
    id: 'd36aa5b8-ec30-4267-9b09-1b02b82d246f',
    session_id: '731b7d87-280c-4fbc-8256-5832953e4d00',
    restaurant_id: '58c73809-4c89-4bda-89b3-817074926244',
    customer_id: '66158466-bbde-4cd2-a033-f892cee57a7f',
    is_registered: 0,
    joined_at: '2026-08-31T13:22:56.536Z',
  };

  assert.deepEqual(Object.keys(insertPayload).sort(), ['customer_id', 'id', 'is_registered', 'joined_at', 'restaurant_id', 'session_id']);
  assert.equal('created_at' in insertPayload, false);
  assert.equal('updated_at' in insertPayload, false);
});
