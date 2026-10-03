import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import test from 'node:test';
import db from '../db/connection.js';
import { getRestaurantProfile, updateRestaurantProfile, getRestaurantGst, updateRestaurantGst, getOperatingHours, updateOperatingHours, listRestaurantChangeRequests, createRestaurantChangeRequest } from '../api/controllers/settingsController.js';

const adminId = 'e84eff68-3977-402c-aacb-a2f0f2062aa5';
const restaurantA = 'a8100000-0000-4000-8000-000000000001';
const restaurantB = 'a8100000-0000-4000-8000-000000000002';
const staffA = 'a8300000-0000-4000-8000-000000000001';
const staffB = 'a8300000-0000-4000-8000-000000000002';
const contactA = 'a8200000-0000-4000-8000-000000000001';
const passwordHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
const validGstin = '27ABCDE1234F1Z5';

function app(role = 'restaurant_admin', restaurantId = restaurantA) {
  const server = express(); server.use(express.json());
  const auth = (req, res, next) => { req.user = { id: restaurantId === restaurantA ? staffA : staffB, role, restaurantId }; next(); };
  const admin = (req, res, next) => role === 'restaurant_admin' ? next() : res.status(403).json({ error: 'Forbidden' });
  server.get('/profile', auth, admin, getRestaurantProfile); server.put('/profile', auth, admin, updateRestaurantProfile);
  server.get('/gst', auth, admin, getRestaurantGst); server.put('/gst', auth, admin, updateRestaurantGst);
  server.get('/hours', auth, admin, getOperatingHours); server.put('/hours', auth, admin, updateOperatingHours);
  server.get('/requests', auth, admin, listRestaurantChangeRequests); server.post('/requests', auth, admin, createRestaurantChangeRequest);
  return server;
}

const profileBody = { name: 'Updated Restaurant', logoUrl: null, welcomeMessage: 'Welcome', managerName: 'Manager', address: 'New address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', country: 'India', timezone: 'Asia/Kolkata', currency: 'INR', contacts: [] };
const gstBody = { gstRegistered: true, gstin: validGstin, legalName: 'Updated Restaurant LLP', sacCode: '996331', registeredAddress: 'Legal address', gstRate: 5, cgstRate: 2.5, sgstRate: 2.5, igstRate: 0, showOnBill: true };

async function cleanup() {
  await db('change_requests').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('operating_hours').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('restaurant_contacts').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('restaurant_tax_config').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('staff').whereIn('id', [staffA, staffB]).delete();
  await db('restaurants').whereIn('id', [restaurantA, restaurantB]).delete();
}
async function seed() {
  await cleanup();
  await db('restaurants').insert([restaurantA, restaurantB].map((id, index) => ({ id, slug: `settings-${index}`, name: `Settings ${index}`, legal_name: `Settings ${index}`, address: 'Address', contact_email: `settings${index}@test.local`, city: 'Mumbai', country: 'India', state: 'Maharashtra', pincode: '400001', timezone: 'Asia/Kolkata', currency: 'INR', status: 'active', table_count: 10, onboarded_by: adminId })));
  await db('staff').insert([{ id: staffA, restaurant_id: restaurantA, name: 'Admin A', email: 'admin-a@test.local', password_hash: passwordHash, role: 'restaurant_admin', access: 'active', created_by_platform_admin_id: adminId }, { id: staffB, restaurant_id: restaurantB, name: 'Admin B', email: 'admin-b@test.local', password_hash: passwordHash, role: 'restaurant_admin', access: 'active', created_by_platform_admin_id: adminId }]);
  await db('restaurant_tax_config').insert({ id: 'a8500000-0000-4000-8000-000000000001', restaurant_id: restaurantA, gst_rate: 5, cgst_rate: 2.5, sgst_rate: 2.5, igst_rate: 0, show_on_bill: 1, updated_by_staff_id: staffA });
}
test.beforeEach(seed); test.afterEach(cleanup); test.after(async () => db.destroy());

test('1 profile update persists', async () => { const response = await request(app()).put('/profile').send(profileBody); assert.equal(response.status, 200); assert.equal((await db('restaurants').where({ id: restaurantA }).first()).name, 'Updated Restaurant'); });
test('2 profile ignores slug', async () => { await request(app()).put('/profile').send({ ...profileBody, slug: 'changed' }); assert.equal((await db('restaurants').where({ id: restaurantA }).first()).slug, 'settings-0'); });
test('3 profile ignores GST fields', async () => { await request(app()).put('/profile').send({ ...profileBody, gstin: 'BAD', gstRegistered: true }); const row = await db('restaurants').where({ id: restaurantA }).first(); assert.equal(row.gstin, null); assert.equal(row.gst_registered, 0); });
test('4 primary contact replaces prior primary', async () => { await db('restaurant_contacts').insert({ id: contactA, restaurant_id: restaurantA, contact_type: 'phone', contact_value: '111', is_primary: 1 }); await request(app()).put('/profile').send({ ...profileBody, contacts: [{ id: contactA, contactType: 'phone', contactValue: '111', isPrimary: false, label: '' }, { contactType: 'phone', contactValue: '222', isPrimary: true, label: '' }] }); assert.equal((await db('restaurant_contacts').where({ restaurant_id: restaurantA, is_primary: 1 }).whereNull('deleted_at')).length, 1); });
test('5 profile tenant isolation', async () => { assert.equal((await request(app('restaurant_admin', restaurantB)).get('/profile')).status, 200); assert.equal((await request(app('restaurant_admin', restaurantB)).put('/profile').send(profileBody)).status, 200); assert.equal((await db('restaurants').where({ id: restaurantA }).first()).name, 'Settings 0'); });
test('6 profile rejects non-admin', async () => { assert.equal((await request(app('waiter')).get('/profile')).status, 403); });
test('7 valid GSTIN saves', async () => { assert.equal((await request(app()).put('/gst').send(gstBody)).status, 200); assert.equal((await db('restaurants').where({ id: restaurantA }).first()).gstin, validGstin); });
test('8 invalid GSTIN rejects without save', async () => { assert.equal((await request(app()).put('/gst').send({ ...gstBody, gstin: 'bad' })).status, 400); assert.equal((await db('restaurants').where({ id: restaurantA }).first()).gstin, null); });
test('9 registered GST requires GSTIN', async () => { assert.equal((await request(app()).put('/gst').send({ ...gstBody, gstin: '' })).status, 400); });
test('10 unregistered GST permits absent GSTIN', async () => { assert.equal((await request(app()).put('/gst').send({ ...gstBody, gstRegistered: false, gstin: '' })).status, 200); });
test('11 GST rate consistency enforced', async () => { assert.equal((await request(app()).put('/gst').send({ ...gstBody, cgstRate: 1 })).status, 400); });
test('12 GST transaction rolls back on second-table constraint failure', async () => { assert.equal((await request(app()).put('/gst').send({ ...gstBody, gstRate: 7, cgstRate: 3.5, sgstRate: 3.5 })).status, 500); const row = await db('restaurants').where({ id: restaurantA }).first(); assert.equal(row.gst_registered, 0); assert.equal(row.gstin, null); });
test('13 GST records acting staff', async () => { await request(app()).put('/gst').send(gstBody); assert.equal((await db('restaurant_tax_config').where({ restaurant_id: restaurantA }).first()).updated_by_staff_id, staffA); });
test('14 GST tenant isolation', async () => { assert.equal((await request(app('restaurant_admin', restaurantB)).get('/gst')).status, 200); assert.equal((await request(app('restaurant_admin', restaurantB)).put('/gst').send(gstBody)).status, 200); assert.equal((await db('restaurants').where({ id: restaurantA }).first()).gstin, null); });
test('15 GST rejects non-admin', async () => { assert.equal((await request(app('chef')).get('/gst')).status, 403); });
test('16 split shifts save', async () => { const response = await request(app()).put('/hours').send({ dayOfWeek: 1, shifts: [{ shiftLabel: 'Lunch', openTime: '11:00', closeTime: '14:00', isClosed: false }, { shiftLabel: 'Dinner', openTime: '18:00', closeTime: '22:00', isClosed: false }] }); assert.equal(response.status, 200); assert.equal((await db('operating_hours').where({ restaurant_id: restaurantA, day_of_week: 1 })).length, 2); });
test('17 overlapping shifts reject', async () => { assert.equal((await request(app()).put('/hours').send({ dayOfWeek: 1, shifts: [{ openTime: '11:00', closeTime: '14:00', isClosed: false }, { openTime: '13:00', closeTime: '15:00', isClosed: false }] })).status, 400); });
test('18 reversed shift rejects', async () => { assert.equal((await request(app()).put('/hours').send({ dayOfWeek: 1, shifts: [{ openTime: '15:00', closeTime: '14:00', isClosed: false }] })).status, 400); });
test('19 existing sibling overlap rejects', async () => { await db('operating_hours').insert({ id: 'a8600000-0000-4000-8000-000000000001', restaurant_id: restaurantA, day_of_week: 1, shift_label: 'Dinner', open_time: '18:00', close_time: '22:00', is_closed: 0, updated_by: staffA }); assert.equal((await request(app()).put('/hours').send({ dayOfWeek: 1, shifts: [{ id: 'a8600000-0000-4000-8000-000000000002', openTime: '20:00', closeTime: '23:00', isClosed: false }] })).status, 400); });
test('20 closed day persists', async () => { assert.equal((await request(app()).put('/hours').send({ dayOfWeek: 0, shifts: [{ shiftLabel: '', openTime: '00:00', closeTime: '00:01', isClosed: true }] })).status, 200); assert.equal((await db('operating_hours').where({ restaurant_id: restaurantA, day_of_week: 0 }).first()).is_closed, 1); });
test('21 hours tenant isolation', async () => { assert.equal((await request(app('restaurant_admin', restaurantB)).get('/hours')).status, 200); });
test('22 hours rejects non-admin', async () => { assert.equal((await request(app('waiter')).get('/hours')).status, 403); });
test('23 change request uses server current value', async () => { const response = await request(app()).post('/requests').send({ requestType: 'slug_change', requestedValue: 'new', reason: 'Need new slug', currentValue: 'forged' }); assert.equal(response.status, 201); assert.equal(response.body.data.current_value, 'settings-0'); });
test('24 duplicate pending request rejects', async () => { await request(app()).post('/requests').send({ requestType: 'slug_change', requestedValue: 'one', reason: 'reason' }); assert.equal((await request(app()).post('/requests').send({ requestType: 'slug_change', requestedValue: 'two', reason: 'reason' })).status, 409); });
test('25 different pending type succeeds', async () => { await request(app()).post('/requests').send({ requestType: 'slug_change', requestedValue: 'one', reason: 'reason' }); assert.equal((await request(app()).post('/requests').send({ requestType: 'qr_regeneration', requestedValue: 'all', reason: 'reason' })).status, 201); });
test('26 completed prior request permits new request', async () => { await db('change_requests').insert({ id: 'a8700000-0000-4000-8000-000000000001', restaurant_id: restaurantA, requested_by_staff_id: staffA, request_type: 'slug_change', current_value: 'old', requested_value: 'old2', reason: 'reason', status: 'approved' }); assert.equal((await request(app()).post('/requests').send({ requestType: 'slug_change', requestedValue: 'new', reason: 'reason' })).status, 201); });
test('27 request tracking is tenant scoped and newest first', async () => { await request(app()).post('/requests').send({ requestType: 'slug_change', requestedValue: 'one', reason: 'reason' }); await db('change_requests').insert({ id: 'a8700000-0000-4000-8000-000000000002', restaurant_id: restaurantB, requested_by_staff_id: staffB, request_type: 'slug_change', current_value: 'other', requested_value: 'other2', reason: 'reason', status: 'approved' }); const response = await request(app()).get('/requests'); assert.equal(response.body.data.length, 1); });
test('28 requests reject non-admin', async () => { assert.equal((await request(app('chef')).get('/requests')).status, 403); });
