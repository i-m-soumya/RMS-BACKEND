import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import test from 'node:test';
import db from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { requireRoles } from '../api/middleware/roles.js';
import { amendBill, getBillVersions, recordBillPayment } from '../api/controllers/billController.js';

let bill;
let restaurantId;
let waiter;
let admin;
let chef;
let originalBill;
let originalLineItems;
let originalAddons;
let originalBillOrders;
let fixtureCreated = false;
let fixtureRestaurantId;
let fixtureFloorId;
let fixtureTableId;
let fixtureSessionId;
let fixtureStaffIds = [];
const createdBillIds = [];

function app(role, selectedRestaurantId = restaurantId, staffId = role === 'waiter' ? waiter?.id : role === 'chef' ? chef?.id : admin?.id) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.user = { id: staffId, role, restaurantId: selectedRestaurantId }; next(); });
  server.post('/bills/:bill_id/payment', requireRoles(['waiter', 'restaurant_admin']), recordBillPayment);
  server.post('/bills/:bill_id/amend', requireRoles(['waiter', 'restaurant_admin']), amendBill);
  server.get('/bills/:bill_id/versions', requireRoles(['waiter', 'restaurant_admin']), getBillVersions);
  return server;
}

async function chooseFixture() {
  bill = await db('bills').where({ is_active: 1 }).orderBy('created_at', 'desc').first();
  if (!bill) {
    let session = await db('sessions').join('restaurants', 'restaurants.id', 'sessions.restaurant_id').whereIn('sessions.status', ['active', 'closed']).select('sessions.id as session_id', 'sessions.restaurant_id', 'restaurants.name', 'restaurants.legal_name', 'restaurants.address', 'restaurants.registered_address', 'restaurants.gstin', 'restaurants.sac_code').first();
    let staff = session ? await db('staff').where({ restaurant_id: session.restaurant_id, role: 'waiter', access: 'active' }).first() : null;
    if (!session || !staff) {
      const platformAdmin = await db('platform_admins').first();
      assert.ok(platformAdmin, 'live DB needs a platform admin fixture');
      fixtureRestaurantId = uuidv4(); fixtureFloorId = uuidv4(); fixtureTableId = uuidv4(); fixtureSessionId = uuidv4();
      await db('restaurants').insert({ id: fixtureRestaurantId, name: 'Billing Test Restaurant', legal_name: 'Billing Test Restaurant', slug: `billing-test-${Date.now()}`, contact_email: `billing-${Date.now()}@test.local`, address: 'Test address', city: 'Test City', country: 'India', state: 'Test State', pincode: '400001', timezone: 'UTC', currency: 'INR', status: 'active', created_at: new Date(), updated_at: new Date() });
      await db('floors').insert({ id: fixtureFloorId, restaurant_id: fixtureRestaurantId, name: 'Test Floor', display_order: 1, created_at: new Date(), updated_at: new Date() });
      await db('tables').insert({ id: fixtureTableId, restaurant_id: fixtureRestaurantId, floor_id: fixtureFloorId, table_number: 'T1', capacity: 4, seating_capacity: 4, status: 'available', is_active: 1, created_at: new Date(), updated_at: new Date() });
      for (const role of ['waiter', 'restaurant_admin', 'chef']) { const id = uuidv4(); fixtureStaffIds.push(id); await db('staff').insert({ id, restaurant_id: fixtureRestaurantId, name: `Billing ${role}`, email: `billing-${role}-${id}@test.local`, password_hash: 'test', role, access: 'active', created_by_platform_admin_id: platformAdmin.id, created_at: new Date(), updated_at: new Date() }); }
      await db('sessions').insert({ id: fixtureSessionId, restaurant_id: fixtureRestaurantId, table_id: fixtureTableId, opened_by_staff_id: fixtureStaffIds[0], status: 'active', join_code: String(Math.floor(1000 + Math.random() * 8999)), created_at: new Date(), updated_at: new Date() });
      session = { session_id: fixtureSessionId, restaurant_id: fixtureRestaurantId, name: 'Billing Test Restaurant', legal_name: 'Billing Test Restaurant', address: 'Test address' };
      staff = { id: fixtureStaffIds[0] }; waiter = { id: fixtureStaffIds[0] }; admin = { id: fixtureStaffIds[1] }; chef = { id: fixtureStaffIds[2] };
    }
    bill = { id: uuidv4(), restaurant_id: session.restaurant_id, session_id: session.session_id, bill_version: 1, invoice_number: `TEST-${Date.now()}`, generated_by_staff_id: staff.id, restaurant_name_snapshot: session.name, restaurant_legal_name_snapshot: session.legal_name, restaurant_address_snapshot: session.registered_address || session.address || 'Test address', restaurant_gstin_snapshot: session.gstin, restaurant_sac_code_snapshot: session.sac_code, subtotal: 100, total_amount: 100, payment_status: 'pending', is_active: 1 };
    await db('bills').insert({ ...bill, parent_bill_id: null, financial_year: '26-27', gst_rate_snapshot: 0, cgst_rate_snapshot: 0, sgst_rate_snapshot: 0, igst_rate_snapshot: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_tax_amount: 0, created_at: new Date(), updated_at: new Date() });
    fixtureCreated = true;
  }
  restaurantId = bill.restaurant_id;
  waiter = await db('staff').where({ restaurant_id: restaurantId, role: 'waiter', access: 'active' }).first();
  admin = await db('staff').where({ restaurant_id: restaurantId, role: 'restaurant_admin', access: 'active' }).first();
  chef = await db('staff').where({ restaurant_id: restaurantId, role: 'chef', access: 'active' }).first();
  assert.ok(waiter && admin && chef, 'live DB needs waiter, admin, and chef fixtures');
  originalBill = { ...bill };
  originalLineItems = await db('bill_line_items').where({ bill_id: bill.id }).orderBy('id');
  originalAddons = originalLineItems.length ? await db('bill_line_item_addons').whereIn('bill_line_item_id', originalLineItems.map((row) => row.id)).orderBy('id') : [];
  originalBillOrders = await db('bill_orders').where({ bill_id: bill.id }).orderBy('id');
  await db('bills').where({ id: bill.id }).update({ payment_status: 'pending', payment_method: null, paid_at: null, is_active: 1 });
}

async function restoreFixture() {
  if (!bill) return;
  if (createdBillIds.length) {
    const createdLines = await db('bill_line_items').whereIn('bill_id', createdBillIds).select('id');
    if (createdLines.length) await db('bill_line_item_addons').whereIn('bill_line_item_id', createdLines.map((row) => row.id)).delete();
    await db('bill_line_items').whereIn('bill_id', createdBillIds).delete();
    await db('bill_orders').whereIn('bill_id', createdBillIds).delete();
  }
  await db('bill_line_item_addons').whereIn('bill_line_item_id', originalLineItems.map((row) => row.id)).delete();
  await db('bill_line_items').where({ bill_id: bill.id }).delete();
  await db('bill_orders').where({ bill_id: bill.id }).delete();
  await db('bills').whereIn('id', createdBillIds).delete();
  if (fixtureCreated) {
    await db('bills').where({ id: bill.id }).delete();
    await db('sessions').where({ id: fixtureSessionId }).delete();
    await db('staff').whereIn('id', fixtureStaffIds).delete();
    await db('tables').where({ id: fixtureTableId }).delete();
    await db('floors').where({ id: fixtureFloorId }).delete();
    await db('restaurants').where({ id: fixtureRestaurantId }).delete();
    await db.destroy();
    return;
  }
  await db('bills').where({ id: bill.id }).update({ ...originalBill, updated_at: new Date() });
  if (originalLineItems.length) await db('bill_line_items').insert(originalLineItems);
  if (originalAddons.length) await db('bill_line_item_addons').insert(originalAddons);
  if (originalBillOrders.length) await db('bill_orders').insert(originalBillOrders);
  await db.destroy();
}

test.before(chooseFixture);
test.after(restoreFixture);

test('1 records cash payment on an active unpaid bill', async () => {
  const response = await request(app('waiter')).post(`/bills/${bill.id}/payment`).send({ paymentMethod: 'cash' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const row = await db('bills').where({ id: bill.id }).first();
  assert.equal(row.payment_status, 'paid'); assert.equal(row.payment_method, 'cash'); assert.ok(row.paid_at);
  await db('bills').where({ id: bill.id }).update({ payment_status: 'pending', payment_method: null, paid_at: null });
});

test('2 accepts confirmed UPI payment values', async () => { const response = await request(app('restaurant_admin')).post(`/bills/${bill.id}/payment`).send({ paymentMethod: 'upi' }); assert.equal(response.status, 200); await db('bills').where({ id: bill.id }).update({ payment_status: 'pending', payment_method: null, paid_at: null }); });
test('3 accepts confirmed card payment values', async () => { const response = await request(app('waiter')).post(`/bills/${bill.id}/payment`).send({ paymentMethod: 'card' }); assert.equal(response.status, 200); await db('bills').where({ id: bill.id }).update({ payment_status: 'pending', payment_method: null, paid_at: null }); });
test('4 rejects an invalid payment method', async () => { assert.equal((await request(app('waiter')).post(`/bills/${bill.id}/payment`).send({ paymentMethod: 'Cheque' })).status, 400); });
test('5 rejects double payment without overwriting paid_at', async () => { await db('bills').where({ id: bill.id }).update({ payment_status: 'paid', payment_method: 'cash', paid_at: new Date('2026-01-01') }); const response = await request(app('waiter')).post(`/bills/${bill.id}/payment`).send({ paymentMethod: 'upi' }); assert.equal(response.status, 409); const row = await db('bills').where({ id: bill.id }).first(); assert.equal(String(row.payment_method), 'cash'); assert.equal(new Date(row.paid_at).toISOString(), '2026-01-01T00:00:00.000Z'); await db('bills').where({ id: bill.id }).update({ payment_status: 'pending', payment_method: null, paid_at: null }); });
test('6 rejects payment against an inactive bill', async () => { await db('bills').where({ id: bill.id }).update({ is_active: 0 }); assert.equal((await request(app('waiter')).post(`/bills/${bill.id}/payment`).send({ paymentMethod: 'cash' })).status, 409); await db('bills').where({ id: bill.id }).update({ is_active: 1 }); });
test('7 rejects unknown bills in the tenant', async () => { assert.equal((await request(app('waiter')).post(`/bills/${uuidv4()}/payment`).send({ paymentMethod: 'cash' })).status, 404); });
test('8 rejects chef payment access', async () => { assert.equal((await request(app('chef')).post(`/bills/${bill.id}/payment`).send({ paymentMethod: 'cash' })).status, 403); });
test('9 rejects foreign-tenant payment access', async () => { const other = await db('restaurants').whereNot({ id: restaurantId }).first(); if (!other) return; assert.equal((await request(app('waiter', other.id)).post(`/bills/${bill.id}/payment`).send({ paymentMethod: 'cash' })).status, 404); });

test('10 amends an active unpaid bill into version 2', async () => { const response = await request(app('waiter')).post(`/bills/${bill.id}/amend`).send({ included_order_ids: originalBillOrders.filter((row) => row.inclusion_status === 'included').map((row) => row.order_id) }); assert.equal(response.status, 201, JSON.stringify(response.body)); createdBillIds.push(response.body.data.bill_id); const next = await db('bills').where({ id: response.body.data.bill_id }).first(); const previous = await db('bills').where({ id: bill.id }).first(); assert.equal(previous.is_active, 0); assert.equal(next.is_active, 1); assert.equal(next.bill_version, Number(originalBill.bill_version) + 1); assert.equal(next.parent_bill_id, bill.id); });
test('11 blocks amendment of a paid bill', async () => { await db('bills').where({ id: bill.id }).update({ is_active: 1, payment_status: 'paid' }); const response = await request(app('waiter')).post(`/bills/${bill.id}/amend`).send({}); assert.equal(response.status, 409); await db('bills').where({ id: bill.id }).update({ payment_status: 'pending' }); });
test('12 blocks amendment of an inactive bill', async () => { await db('bills').where({ id: bill.id }).update({ is_active: 0 }); assert.equal((await request(app('waiter')).post(`/bills/${bill.id}/amend`).send({})).status, 409); await db('bills').where({ id: bill.id }).update({ is_active: 1 }); });
test('13 preserves original bill snapshots after amendment', async () => { const before = { lineItems: await db('bill_line_items').where({ bill_id: bill.id }).orderBy('id'), addons: await db('bill_line_item_addons').whereIn('bill_line_item_id', originalLineItems.map((row) => row.id)).orderBy('id'), orders: await db('bill_orders').where({ bill_id: bill.id }).orderBy('id') }; assert.deepEqual(before.lineItems, originalLineItems); assert.deepEqual(before.addons, originalAddons); assert.deepEqual(before.orders, originalBillOrders); });
test('14 exposes version history with parent links', async () => { const response = await request(app('restaurant_admin')).get(`/bills/${bill.id}/versions`); assert.equal(response.status, 200); assert.ok(response.body.data.some((row) => row.id === bill.id)); });
test('15 amendment invoice number is explicitly versioned', async () => { const versioned = await db('bills').where({ parent_bill_id: bill.id }).first(); if (!versioned) return; assert.equal(versioned.invoice_number, `${bill.invoice_number}-V${versioned.bill_version}`.slice(0, 30)); });
test('16 blocks chef amendment access', async () => { assert.equal((await request(app('chef')).post(`/bills/${bill.id}/amend`).send({})).status, 403); });
