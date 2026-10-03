import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import db from '../db/connection.js';
import { createPlatformRouter } from '../api/routes/platform.js';

const adminId = 'e84eff68-3977-402c-aacb-a2f0f2062aa5';
const restaurantA = '71000000-0000-4000-8000-000000000001';
const restaurantB = '71000000-0000-4000-8000-000000000002';
const floorA = '72000000-0000-4000-8000-000000000001';
const staffA = '73000000-0000-4000-8000-000000000001';
const requestA = '74000000-0000-4000-8000-000000000001';
const passwordHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

function app() {
  const server = express(); server.use(express.json());
  server.use('/api/platform', createPlatformRouter({ authenticateToken: (req, res, next) => { req.user = { id: adminId, role: 'platform_admin' }; next(); } }));
  return server;
}

async function cleanup() {
  await db('notifications').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('change_requests').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('table_qr_codes').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('qr_code_history').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('tables').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('floors').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('staff').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('restaurants').whereIn('id', [restaurantA, restaurantB]).delete();
}

async function restaurant(id, slug, count = 0) {
  await db('restaurants').insert({ id, slug, name: slug, legal_name: slug, address: 'Test', contact_email: `${slug}@test.local`, city: 'Mumbai', country: 'India', state: 'Maharashtra', pincode: '400001', timezone: 'Asia/Kolkata', currency: 'INR', status: 'active', table_count: count, onboarded_by: adminId });
}

async function staff(restaurantId = restaurantB) {
  await db('staff').insert({ id: staffA, restaurant_id: restaurantId, name: 'Requester', email: 'requester@test.local', password_hash: passwordHash, role: 'restaurant_admin', access: 'active', created_by_platform_admin_id: adminId, created_by_staff_id: null });
}

async function change(type, currentValue, requestedValue, id = requestA, restaurantId = restaurantB) {
  if (!await db('staff').where({ id: staffA }).first()) await staff(restaurantId);
  await db('change_requests').insert({ id, restaurant_id: restaurantId, requested_by_staff_id: staffA, request_type: type, current_value: currentValue, requested_value: requestedValue, reason: 'Test request', status: 'pending' });
}

test.beforeEach(async () => { await cleanup(); });
test.afterEach(async () => { await cleanup(); });
test.after(async () => { await db.destroy(); });

test('slug approval revalidates collisions and applies a unique slug', async () => {
  await restaurant(restaurantA, 'existing-slug'); await restaurant(restaurantB, 'restaurant-b');
  await change('slug_change', 'restaurant-b', 'existing-slug');
  let response = await request(app()).post(`/api/platform/change-requests/${requestA}/approve`);
  assert.equal(response.status, 409); assert.equal((await db('restaurants').where({ id: restaurantB }).first()).slug, 'restaurant-b'); assert.equal((await db('change_requests').where({ id: requestA }).first()).status, 'pending');
  await db('change_requests').where({ id: requestA }).update({ requested_value: 'new-restaurant-b' });
  response = await request(app()).post(`/api/platform/change-requests/${requestA}/approve`);
  assert.equal(response.status, 200); const updated = await db('change_requests').where({ id: requestA }).first(); assert.equal((await db('restaurants').where({ id: restaurantB }).first()).slug, 'new-restaurant-b'); assert.equal(updated.status, 'approved'); assert.ok(updated.reviewed_at); assert.equal(updated.reviewed_by, adminId); assert.ok(updated.actioned_at);
});

test('table decrease removes only available or inactive tables and rejects insufficient capacity', async () => {
  await restaurant(restaurantB, 'decrease-test', 4); await db('floors').insert({ id: floorA, restaurant_id: restaurantB, name: 'Ground', display_order: 1, is_active: 1 });
  const ids = ['75000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000002', '75000000-0000-4000-8000-000000000003', '75000000-0000-4000-8000-000000000004'];
  await db('tables').insert(ids.map((id, index) => ({ id, restaurant_id: restaurantB, floor_id: floorA, table_number: String(index + 1), capacity: 4, seating_capacity: 4, status: ['available', 'available', 'occupied', 'reserved'][index], is_active: 1 })));
  await change('table_count_decrease', '4', '2'); const response = await request(app()).post(`/api/platform/change-requests/${requestA}/approve`); assert.equal(response.status, 200);
  const rows = await db('tables').whereIn('id', ids); assert.equal(rows.filter((row) => row.deleted_at).length, 2); assert.deepEqual(rows.filter((row) => row.deleted_at).map((row) => row.status), ['available', 'available']); assert.equal((await db('restaurants').where({ id: restaurantB }).first()).table_count, 2);
  await restaurant(restaurantA, 'insufficient-test', 1); await change('table_count_decrease', '1', '2', '74000000-0000-4000-8000-000000000002', restaurantA); const insufficient = await request(app()).post('/api/platform/change-requests/74000000-0000-4000-8000-000000000002/approve'); assert.equal(insufficient.status, 409); assert.equal((await db('restaurants').where({ id: restaurantA }).first()).table_count, 1);
});

test('table increase changes only the target count', async () => {
  await restaurant(restaurantB, 'increase-test', 5); await db('floors').insert({ id: floorA, restaurant_id: restaurantB, name: 'Ground', display_order: 1, is_active: 1 });
  await db('tables').insert(Array.from({ length: 5 }, (_, index) => ({ id: `76000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, restaurant_id: restaurantB, floor_id: floorA, table_number: String(index + 1), capacity: 4, seating_capacity: 4, status: 'available', is_active: 1 })));
  await change('table_count_increase', '5', '2'); const response = await request(app()).post(`/api/platform/change-requests/${requestA}/approve`); assert.equal(response.status, 200); assert.equal((await db('restaurants').where({ id: restaurantB }).first()).table_count, 7); assert.equal(await db('tables').where({ restaurant_id: restaurantB }).count('*').first().then((row) => Number(row['count(*)'])), 5);
});

test('QR approval creates a new code and invalidates the old one', async () => {
  await restaurant(restaurantB, 'qr-test', 1); await db('floors').insert({ id: floorA, restaurant_id: restaurantB, name: 'Ground', display_order: 1, is_active: 1 }); const tableId = '77000000-0000-4000-8000-000000000001'; await db('tables').insert({ id: tableId, restaurant_id: restaurantB, floor_id: floorA, table_number: '1', capacity: 4, seating_capacity: 4, status: 'available', is_active: 1, qr_code_url: 'old-payload' }); await db('table_qr_codes').insert({ id: '78000000-0000-4000-8000-000000000001', restaurant_id: restaurantB, table_id: tableId, payload: 'old-payload', generated_at: new Date('2025-01-01'), created_by_platform_admin_id: adminId }); await change('qr_regeneration', 'old-payload', tableId);
  const response = await request(app()).post(`/api/platform/change-requests/${requestA}/approve`); assert.equal(response.status, 200); const codes = await db('table_qr_codes').where({ table_id: tableId }).orderBy('generated_at'); assert.equal(codes.length, 2); assert.notEqual(codes[0].payload, codes[1].payload); assert.equal(codes[1].created_by_platform_admin_id, adminId); const history = await db('qr_code_history').where({ table_id: tableId }); assert.equal(history.length, 1); assert.ok(history[0].invalidated_at); const table = await db('tables').where({ id: tableId }).first(); assert.equal(table.qr_code_url, codes[1].payload);
});

test('reject requires a reason and cannot be actioned again', async () => {
  await restaurant(restaurantB, 'reject-test'); await change('slug_change', 'reject-test', 'rejected-test'); let response = await request(app()).post(`/api/platform/change-requests/${requestA}/reject`).send({}); assert.equal(response.status, 400); response = await request(app()).post(`/api/platform/change-requests/${requestA}/reject`).send({ rejection_reason: 'Needs clarification' }); assert.equal(response.status, 200); const rejected = await db('change_requests').where({ id: requestA }).first(); assert.equal(rejected.status, 'rejected'); assert.equal(rejected.rejection_reason, 'Needs clarification'); assert.ok(rejected.reviewed_at); assert.equal((await request(app()).post(`/api/platform/change-requests/${requestA}/approve`)).status, 409); assert.equal((await request(app()).post(`/api/platform/change-requests/${requestA}/reject`).send({ rejection_reason: 'Again' })).status, 409);
});

test('approval and rejection create staff notifications', async () => {
  await restaurant(restaurantB, 'notify-test'); await change('slug_change', 'notify-test', 'notify-approved'); assert.equal((await request(app()).post(`/api/platform/change-requests/${requestA}/approve`)).status, 200); let notification = await db('notifications').where({ recipient_staff_id: staffA, type: 'change_request_approved' }).first(); assert.ok(notification);
  const second = '74000000-0000-4000-8000-000000000003'; await change('slug_change', 'notify-approved', 'notify-rejected', second); assert.equal((await request(app()).post(`/api/platform/change-requests/${second}/reject`).send({ rejection_reason: 'No' })).status, 200); notification = await db('notifications').where({ recipient_staff_id: staffA, type: 'change_request_rejected' }).first(); assert.ok(notification);
});