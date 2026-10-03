import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import db from '../db/connection.js';
import restaurantRoutes from '../api/routes/restaurants.js';
import sessionRoutes from '../api/routes/sessions.js';

async function createTestRestaurantTable() {
  const restaurantId = '11111111-1111-4111-8111-111111111111';
  const tableId = '22222222-2222-4222-8222-222222222222';
  const slug = `guest-open-${Date.now()}`;

  const floorId = '33333333-3333-4333-8333-333333333333';
  await db('customer_guest_tokens').whereIn('session_id', db('sessions').where({ table_id: tableId }).select('id')).delete();
  await db('session_members').whereIn('session_id', db('sessions').where({ table_id: tableId }).select('id')).delete();
  await db('sessions').where({ table_id: tableId }).delete();
  await db('tables').where({ id: tableId }).delete();
  await db('floors').where({ id: floorId }).delete();
  await db('saas_registrations').where({ restaurant_id: restaurantId }).delete();
  await db('restaurants').where({ id: restaurantId }).delete();

  await db('restaurants').insert({
    id: restaurantId,
    slug,
    name: 'Guest Open Test',
    legal_name: 'Guest Open Test',
    address: '123 Test Street',
    contact_email: 'guest-open@example.com',
    city: 'Mumbai',
    country: 'India',
    state: 'Maharashtra',
    pincode: '400001',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await db('floors').insert({
    id: floorId,
    restaurant_id: restaurantId,
    name: 'Test Floor',
    display_order: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });

  await db('tables').insert({
    id: tableId,
    restaurant_id: restaurantId,
    floor_id: floorId,
    table_number: '101',
    capacity: 4,
    seating_capacity: 4,
    capacity_enforcement: 'soft_warn',
    status: 'available',
    is_active: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { slug, tableNumber: '101', restaurantId, tableId };
}

const app = express();
app.use(express.json());
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/sessions', sessionRoutes);

test('customer guest endpoints require a waiter-opened session and do not create one', async () => {
  const { slug, tableNumber, tableId, restaurantId } = await createTestRestaurantTable();

  const guestTokenResponse = await request(app)
    .post(`/api/restaurants/${slug}/table/${tableNumber}/guest-token`)
    .send({});
  const joinResponse = await request(app)
    .post(`/api/sessions/table/${tableId}/join`)
    .send({});

  assert.equal(guestTokenResponse.status, 409, JSON.stringify(guestTokenResponse.body));
  assert.equal(guestTokenResponse.body.code, 'TABLE_SESSION_NOT_OPEN');
  assert.equal(joinResponse.status, 409, JSON.stringify(joinResponse.body));
  assert.equal(joinResponse.body.code, 'TABLE_SESSION_NOT_OPEN');

  const sessions = await db('sessions').where({ table_id: tableId, restaurant_id: restaurantId });
  const guestTokens = await db('customer_guest_tokens').where({ restaurant_id: restaurantId });
  assert.equal(sessions.length, 0, 'Customer browsing must not open a session');
  assert.equal(guestTokens.length, 0, 'No guest token should be issued without an open session');
});

process.on('exit', async () => {
  await db.destroy();
});
