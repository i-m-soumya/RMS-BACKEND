import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import test from 'node:test';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection.js';
import { requireRoles } from '../api/middleware/roles.js';
import { validate } from '../api/middleware/validate.js';
import { setItemAvailabilitySchema } from '../api/validators/admin.js';
import { rejectChefOrder, rejectChefOrderItem, getChefShiftHistory } from '../api/controllers/staffController.js';
import { setMenuItemAvailability, listMenuItems } from '../api/controllers/adminController.js';
import { generateWaiterBill } from '../api/controllers/billController.js';

let restaurant; let otherRestaurant; let chef; let waiter; let admin; let menuItems; let session; let table;
const created = { orders: [], items: [], sessions: [], bills: [], staff: [], menuItems: [], customers: [], logs: [], notifications: [] };
let customer;

function app(role, restaurantId = restaurant.id, staffId = role === 'chef' ? chef.id : role === 'waiter' ? waiter.id : admin.id) {
  const server = express(); server.use(express.json());
  server.use((req, _res, next) => { req.user = { id: staffId, role, restaurantId }; next(); });
  server.post('/orders/:orderId/reject', requireRoles(['chef']), rejectChefOrder);
  server.post('/items/:orderItemId/reject', requireRoles(['chef']), rejectChefOrderItem);
  server.patch('/items/:id/availability', requireRoles(['restaurant_admin', 'waiter', 'chef']), validate(setItemAvailabilitySchema), setMenuItemAvailability);
  server.get('/menu/items', requireRoles(['restaurant_admin', 'chef']), listMenuItems);
  server.get('/shift-history', requireRoles(['chef', 'restaurant_admin']), getChefShiftHistory);
  server.post('/bills/:sessionId/generate', requireRoles(['waiter', 'restaurant_admin']), (req, res, next) => { req.params.session_id = req.params.sessionId; return generateWaiterBill(req, res, next); });
  return server;
}

async function fixture() {
  restaurant = await db('restaurants').first(); otherRestaurant = await db('restaurants').whereNot({ id: restaurant.id }).first();
  chef = await db('staff').where({ restaurant_id: restaurant.id, role: 'chef', access: 'active' }).first();
  waiter = await db('staff').where({ restaurant_id: restaurant.id, role: 'waiter', access: 'active' }).first();
  admin = await db('staff').where({ restaurant_id: restaurant.id, role: 'restaurant_admin', access: 'active' }).first();
  customer = await db('customers').first();
  if (!customer) { customer = { id: uuidv4() }; await db('customers').insert({ id: customer.id, name: 'Chef Test Customer', email: `chef-customer-${customer.id}@test.local`, is_registered: 0, created_at: new Date(), updated_at: new Date() }); created.customers.push(customer.id); }
  table = await db('tables').where({ restaurant_id: restaurant.id }).first();
  menuItems = await db('menu_items').where({ restaurant_id: restaurant.id }).whereNull('deleted_at').limit(3);
  const platformAdmin = await db('platform_admins').first();
  assert.ok(platformAdmin && table, 'DB needs a platform admin and table fixture');
  for (const role of ['chef', 'waiter', 'restaurant_admin']) {
    if (!await db('staff').where({ restaurant_id: restaurant.id, role }).first()) {
      const id = uuidv4();
      await db('staff').insert({ id, restaurant_id: restaurant.id, name: `Chef test ${role}`, email: `chef-test-${role}-${id}@test.local`, password_hash: 'test', role, access: 'active', created_by_platform_admin_id: platformAdmin.id, created_at: new Date(), updated_at: new Date() });
      created.staff.push(id);
    }
  }
  chef = await db('staff').where({ restaurant_id: restaurant.id, role: 'chef', access: 'active' }).first();
  waiter = await db('staff').where({ restaurant_id: restaurant.id, role: 'waiter', access: 'active' }).first();
  admin = await db('staff').where({ restaurant_id: restaurant.id, role: 'restaurant_admin', access: 'active' }).first();
  while (menuItems.length < 2) {
    const id = uuidv4();
    await db('menu_items').insert({ id, restaurant_id: restaurant.id, name: `Chef test item ${id.slice(0, 6)}`, description: 'Test item', mrp: 100, price: 100, discount_amount: 0, discount_percentage: 0, item_type: 'regular', dietary_type: 'veg', spice_level: 'none', is_available: 1, is_featured: 0, average_rating: 0, rating_count: 0, show_ratings: 0, min_ratings_to_show: 0, display_order: 1, created_at: new Date(), updated_at: new Date() });
    menuItems = await db('menu_items').where({ restaurant_id: restaurant.id }).whereNull('deleted_at').limit(3);
    created.menuItems.push(id);
  }
  assert.ok(restaurant && chef && waiter && admin && table && menuItems.length >= 2, 'DB needs restaurant, staff, table, and two menu items');
}

async function makeOrder({ statuses = ['confirmed', 'confirmed'], orderStatus = 'confirmed', reason = null, customerId = null, createdAt = new Date(), terminal = {} } = {}) {
  const orderId = uuidv4(); const sessionId = uuidv4(); const now = new Date(); customerId = customerId || customer.id;
  await db('sessions').insert({ id: sessionId, restaurant_id: restaurant.id, table_id: table.id, opened_by_staff_id: waiter.id, join_code: String(Math.floor(1000 + Math.random() * 8999)), status: 'active', opened_at: now, created_at: now, updated_at: now });
  created.sessions.push(sessionId);
  await db('orders').insert({ id: orderId, restaurant_id: restaurant.id, session_id: sessionId, customer_id: customerId, placed_by: 'waiter', placed_by_staff_id: waiter.id, status: orderStatus, rejection_reason: reason, table_label: 'Test table', is_direct_order: 0, created_at: createdAt, updated_at: now, ...terminal });
  created.orders.push(orderId);
  for (let index = 0; index < statuses.length; index += 1) { const itemId = uuidv4(); const item = menuItems[index % menuItems.length]; await db('order_items').insert({ id: itemId, order_id: orderId, menu_item_id: item.id, item_name_snapshot: item.name, mrp_snapshot: item.mrp, unit_price_snapshot: item.price, discount_amount_snapshot: item.discount_amount || 0, discount_percentage_snapshot: item.discount_percentage || 0, quantity: 1, notes: null, spice_level: null, status: statuses[index], subtotal: item.price, created_at: now, updated_at: now }); created.items.push(itemId); }
  return { orderId, sessionId, itemIds: created.items.slice(-statuses.length) };
}

async function clean() {
  if (created.bills.length) { const lines = await db('bill_line_items').whereIn('bill_id', created.bills).select('id'); if (lines.length) await db('bill_line_item_addons').whereIn('bill_line_item_id', lines.map((x) => x.id)).delete(); await db('bill_line_items').whereIn('bill_id', created.bills).delete(); await db('bill_orders').whereIn('bill_id', created.bills).delete(); await db('bills').whereIn('id', created.bills).delete(); }
  if (created.items.length) { await db('menu_item_availability_log').whereIn('order_item_id', created.items).delete(); await db('staff_activity_log').whereIn('reference_id', [...created.items, ...created.orders]).delete(); await db('order_items').whereIn('id', created.items).delete(); }
  if (created.orders.length) await db('orders').whereIn('id', created.orders).delete(); if (created.sessions.length) { const orphanBills = await db('bills').whereIn('session_id', created.sessions).select('id'); if (orphanBills.length) { const ids = orphanBills.map((row) => row.id); const lines = await db('bill_line_items').whereIn('bill_id', ids).select('id'); if (lines.length) await db('bill_line_item_addons').whereIn('bill_line_item_id', lines.map((row) => row.id)).delete(); await db('bill_line_items').whereIn('bill_id', ids).delete(); await db('bill_orders').whereIn('bill_id', ids).delete(); await db('bills').whereIn('id', ids).delete(); } await db('sessions').whereIn('id', created.sessions).delete(); } if (created.staff.length) await db('staff').whereIn('id', created.staff).delete();
  if (created.menuItems.length) await db('menu_items').whereIn('id', created.menuItems).delete(); await db('menu_items').whereIn('id', menuItems.map((x) => x.id)).update({ is_available: 1, updated_at: new Date() }); if (created.customers.length) await db('customers').whereIn('id', created.customers).delete(); await db.destroy();
}

test.before(async () => { await fixture(); });
test.after(async () => { await clean(); });

test('1 rejects active order and stores reason', async () => { const x = await makeOrder({ reason: null }); const r = await request(app('chef')).post(`/orders/${x.orderId}/reject`).send({ reason: 'Kitchen closed' }); assert.equal(r.status, 200); assert.equal((await db('orders').where({ id: x.orderId }).first()).rejection_reason, 'Kitchen closed'); assert.ok((await db('order_items').where({ order_id: x.orderId })).every((i) => i.status === 'rejected')); });
test('2 preserves served items', async () => { const x = await makeOrder({ statuses: ['served', 'confirmed'] }); await request(app('chef')).post(`/orders/${x.orderId}/reject`).send({}); const rows = await db('order_items').where({ order_id: x.orderId }); assert.equal(rows.find((i) => i.id === x.itemIds[0]).status, 'served'); assert.equal(rows.find((i) => i.id === x.itemIds[1]).status, 'rejected'); assert.equal((await db('orders').where({ id: x.orderId }).first()).rejection_reason, null); });
test('3 rejects pending order with 409', async () => { const x = await makeOrder({ orderStatus: 'pending' }); assert.equal((await request(app('chef')).post(`/orders/${x.orderId}/reject`)).status, 409); });
test('4 rejects served and rejected orders with 409', async () => { const served = await makeOrder({ orderStatus: 'served' }); const rejected = await makeOrder({ orderStatus: 'rejected' }); assert.equal((await request(app('chef')).post(`/orders/${served.orderId}/reject`)).status, 409); assert.equal((await request(app('chef')).post(`/orders/${rejected.orderId}/reject`)).status, 409); });
test('5 whole rejection does not change menu availability', async () => { const x = await makeOrder(); await db('menu_items').where({ id: menuItems[0].id }).update({ is_available: 1 }); await request(app('chef')).post(`/orders/${x.orderId}/reject`); assert.equal(Number((await db('menu_items').where({ id: menuItems[0].id }).first()).is_available), 1); });
test('6 admin and waiter cannot reject whole orders', async () => { const x = await makeOrder(); assert.equal((await request(app('restaurant_admin')).post(`/orders/${x.orderId}/reject`)).status, 403); assert.equal((await request(app('waiter')).post(`/orders/${x.orderId}/reject`)).status, 403); });
test('7 foreign restaurant cannot reject order', async () => { const x = await makeOrder(); if (!otherRestaurant) return; assert.equal((await request(app('chef', otherRestaurant.id, chef.id)).post(`/orders/${x.orderId}/reject`)).status, 404); });
test('8 item rejection writes auto-reject availability log', async () => { const x = await makeOrder({ statuses: ['confirmed', 'confirmed'] }); await db('menu_items').where({ id: menuItems[0].id }).update({ is_available: 1 }); assert.equal((await request(app('chef')).post(`/items/${x.itemIds[0]}/reject`).send({ reason: 'No stock' })).status, 200); const row = await db('menu_item_availability_log').where({ order_item_id: x.itemIds[0] }).first(); assert.equal(row.changed_by_role, 'chef'); assert.equal(row.trigger_type, 'auto_reject'); assert.equal(Number(row.previous_value), 1); assert.equal(Number(row.new_value), 0); });
test('9 forced transaction failure rolls back item and availability', async () => { const x = await makeOrder(); const original = db.transaction.bind(db); db.transaction = (handler) => original(async (trx) => handler({ ...trx, table: (name) => name === 'menu_item_availability_log' ? { insert: async () => { throw new Error('forced log failure'); } } : trx(name) })); try { const response = await request(app('chef')).post(`/items/${x.itemIds[0]}/reject`); assert.equal(response.status, 500); } finally { db.transaction = original; } assert.equal((await db('order_items').where({ id: x.itemIds[0] }).first()).status, 'confirmed'); assert.equal(Number((await db('menu_items').where({ id: menuItems[0].id }).first()).is_available), 1); });
test('10 sibling and order remain active after partial rejection', async () => { const x = await makeOrder(); await request(app('chef')).post(`/items/${x.itemIds[0]}/reject`); assert.equal((await db('order_items').where({ id: x.itemIds[1] }).first()).status, 'confirmed'); assert.equal((await db('orders').where({ id: x.orderId }).first()).status, 'confirmed'); });
test('11 last active item rejects order', async () => { const x = await makeOrder({ statuses: ['confirmed'] }); await request(app('chef')).post(`/items/${x.itemIds[0]}/reject`); assert.equal((await db('orders').where({ id: x.orderId }).first()).status, 'rejected'); });
test('12 double item rejection is 409 without duplicate log', async () => { const x = await makeOrder(); await request(app('chef')).post(`/items/${x.itemIds[0]}/reject`); const before = await db('menu_item_availability_log').where({ order_item_id: x.itemIds[0] }).count({ n: '*' }); assert.equal((await request(app('chef')).post(`/items/${x.itemIds[0]}/reject`)).status, 409); const after = await db('menu_item_availability_log').where({ order_item_id: x.itemIds[0] }).count({ n: '*' }); assert.equal(Number(after[0].n), Number(before[0].n)); });
test('13 already unavailable item creates no availability log', async () => { const x = await makeOrder(); await db('menu_items').where({ id: menuItems[0].id }).update({ is_available: 0 }); assert.equal((await request(app('chef')).post(`/items/${x.itemIds[0]}/reject`)).status, 200); assert.equal(await db('menu_item_availability_log').where({ order_item_id: x.itemIds[0] }).count({ n: '*' }).then((r) => Number(r[0].n)), 0); });
test('14 admin and waiter cannot reject items', async () => { const x = await makeOrder(); assert.equal((await request(app('restaurant_admin')).post(`/items/${x.itemIds[0]}/reject`)).status, 403); assert.equal((await request(app('waiter')).post(`/items/${x.itemIds[0]}/reject`)).status, 403); });
test('15 foreign restaurant cannot reject items', async () => { const x = await makeOrder(); if (!otherRestaurant) return; assert.equal((await request(app('chef', otherRestaurant.id, chef.id)).post(`/items/${x.itemIds[0]}/reject`)).status, 404); });
test('16 generated bill excludes rejected item and subtotal', async () => { const x = await makeOrder({ statuses: ['served', 'served'] }); await request(app('chef')).post(`/items/${x.itemIds[0]}/reject`); await db('orders').where({ id: x.orderId }).update({ status: 'served', served_at: new Date() }); const response = await request(app('waiter')).post(`/bills/${x.sessionId}/generate`).send({}); assert.equal(response.status, 201, JSON.stringify(response.body)); const bill = await db('bills').where({ id: response.body.data.bill_id }).first(); created.bills.push(bill.id); const lines = await db('bill_line_items').where({ bill_id: bill.id }); assert.ok(!lines.some((line) => line.order_item_id === x.itemIds[0])); assert.equal(Number(bill.subtotal), Number((await db('order_items').where({ id: x.itemIds[1] }).first()).subtotal)); });
test('17 chef can use shared availability PATCH', async () => { const item = menuItems[0]; const r = await request(app('chef')).patch(`/items/${item.id}/availability`).send({ is_available: false, reason: 'Prep shortage' }); assert.equal(r.status, 200); const log = await db('menu_item_availability_log').where({ menu_item_id: item.id }).orderBy('created_at', 'desc').first(); assert.equal(log.changed_by_role, 'chef'); assert.equal(log.trigger_type, 'manual'); });
test('18 availability reason is required', async () => { const item = menuItems[0]; const before = await db('menu_item_availability_log').where({ menu_item_id: item.id }).count({ n: '*' }); assert.equal((await request(app('chef')).patch(`/items/${item.id}/availability`).send({ is_available: true })).status, 400); const after = await db('menu_item_availability_log').where({ menu_item_id: item.id }).count({ n: '*' }); assert.equal(Number(after[0].n), Number(before[0].n)); });
test('19 chef menu list is tenant-scoped and excludes deleted items', async () => { const r = await request(app('chef')).get('/menu/items'); assert.equal(r.status, 200); assert.ok(r.body.data.every((item) => item.deleted_at === undefined || item.deleted_at === null)); assert.ok(r.body.data.every((item) => menuItems.some((fixtureItem) => fixtureItem.id === item.id))); });
test('20 shift history uses terminal records for today', async () => { const now = new Date(); const today = new Date(now); const yesterday = new Date(now.getTime() - 86400000); const a = await makeOrder({ orderStatus: 'served', statuses: ['served'], terminal: { served_at: today } }); const b = await makeOrder({ orderStatus: 'served', statuses: ['served'], terminal: { served_at: yesterday } }); const r = await request(app('chef')).get('/shift-history'); assert.equal(r.status, 200); assert.ok(r.body.entries.some((e) => e.id === a.orderId)); assert.ok(!r.body.entries.some((e) => e.id === b.orderId)); });
test('21 shift history excludes in-progress orders', async () => { const x = await makeOrder({ orderStatus: 'preparing' }); const r = await request(app('chef')).get('/shift-history'); assert.ok(!r.body.entries.some((e) => e.id === x.orderId)); });
test('22 shift history pagination metadata is coherent', async () => { const r = await request(app('chef')).get('/shift-history?page=1&pageSize=1'); assert.equal(r.status, 200); assert.equal(r.body.hasNextPage, Number(r.body.totalCount) > 1); });
test('23 revoked rejector remains visible by left join', async () => { const x = await makeOrder(); await request(app('chef')).post(`/orders/${x.orderId}/reject`); await db('staff').where({ id: chef.id }).update({ access: 'revoked' }); const r = await request(app('restaurant_admin')).get('/shift-history'); assert.ok(r.body.entries.some((e) => e.id === x.orderId && e.rejected_by_name)); await db('staff').where({ id: chef.id }).update({ access: 'active' }); });
test('24 admin reads history, waiter is forbidden, and tenant is isolated', async () => { assert.equal((await request(app('restaurant_admin')).get('/shift-history')).status, 200); assert.equal((await request(app('waiter')).get('/shift-history')).status, 403); if (otherRestaurant) assert.equal((await request(app('restaurant_admin', otherRestaurant.id, admin.id)).get('/shift-history')).status, 200); });
