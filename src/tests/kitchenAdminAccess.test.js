import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import test from 'node:test';
import db from '../db/connection.js';
import { requireRoles } from '../api/middleware/roles.js';
import { getKitchenQueue } from '../api/controllers/kitchenController.js';
import { updateOrderStatus } from '../api/controllers/orderController.js';
import { updateKitchenOrderItemStatus } from '../api/controllers/staffController.js';
import { v4 as uuidv4 } from 'uuid';

const root = new URL('../../../../', import.meta.url);
let restaurantId;
let order;
let secondOrder;
let item;
let secondItem;
let chef;
let secondChef;
let waiter;
let admin;
let originalOrder;
let originalItem;
let originalSecondItem;
let createdChefId;

function app(role, selectedRestaurantId = restaurantId, staffId = role === 'chef' ? chef?.id : role === 'waiter' ? waiter?.id : admin?.id) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.user = { id: staffId, role, restaurantId: selectedRestaurantId }; next(); });
  server.get('/queue', requireRoles(['chef', 'restaurant_admin']), getKitchenQueue);
  server.patch('/orders/:order_id/status', requireRoles(['chef']), updateOrderStatus);
  server.patch('/items/:id/status', requireRoles(['chef']), updateKitchenOrderItemStatus);
  return server;
}

async function chooseFixture() {
  const rows = await db('orders as o').join('order_items as oi', 'oi.order_id', 'o.id').join('staff as s', 's.restaurant_id', 'o.restaurant_id').whereIn('o.status', ['confirmed', 'preparing']).where({ 's.role': 'chef' }).select('o.id', 'o.restaurant_id', 'o.status', 'oi.id as item_id').first();
  assert.ok(rows, 'live DB needs an active kitchen order fixture');
  restaurantId = rows.restaurant_id;
  order = await db('orders').where({ id: rows.id }).first();
  item = await db('order_items').where({ id: rows.item_id }).first();
  chef = await db('staff').where({ restaurant_id: restaurantId, role: 'chef' }).first();
  secondChef = await db('staff').where({ restaurant_id: restaurantId, role: 'chef' }).whereNot({ id: chef.id }).first();
  if (!secondChef) {
    createdChefId = uuidv4();
    await db('staff').insert({ id: createdChefId, restaurant_id: restaurantId, name: 'Kitchen Test Chef', email: `kitchen-test-${createdChefId}@test.local`, password_hash: 'test', role: 'chef', access: 'active', created_by_platform_admin_id: (await db('platform_admins').first()).id });
    secondChef = await db('staff').where({ id: createdChefId }).first();
  }
  secondOrder = await db('orders as o').join('order_items as oi', 'oi.order_id', 'o.id').where('o.restaurant_id', restaurantId).whereNot({ 'o.id': order.id }).whereIn('oi.status', ['confirmed', 'preparing', 'ready']).select('o.*', 'oi.id as item_id').first();
  if (!secondOrder) secondOrder = await db('orders as o').join('order_items as oi', 'oi.order_id', 'o.id').where('o.restaurant_id', restaurantId).whereNot({ 'o.id': order.id }).select('o.*', 'oi.id as item_id').first();
  waiter = await db('staff').where({ restaurant_id: restaurantId, role: 'waiter' }).first();
  admin = await db('staff').where({ restaurant_id: restaurantId, role: 'restaurant_admin' }).first();
  assert.ok(chef && secondChef && secondOrder && waiter && admin, 'live DB needs two orders and all staff roles for the fixture');
  secondItem = await db('order_items').where({ id: secondOrder.item_id }).first();
  originalOrder = { status: order.status, rejected_by: order.rejected_by, rejected_by_staff_id: order.rejected_by_staff_id, rejection_reason: order.rejection_reason, rejected_at: order.rejected_at };
  originalItem = { status: item.status, preparing_by_staff_id: item.preparing_by_staff_id, ready_by_staff_id: item.ready_by_staff_id, rejected_by_staff_id: item.rejected_by_staff_id, rejection_reason: item.rejection_reason };
  originalSecondItem = { status: secondItem.status, preparing_by_staff_id: secondItem.preparing_by_staff_id, ready_by_staff_id: secondItem.ready_by_staff_id, rejected_by_staff_id: secondItem.rejected_by_staff_id, rejection_reason: secondItem.rejection_reason };
  await db('orders').where({ id: secondOrder.id }).update({ status: 'confirmed' });
  await db('order_items').where({ id: secondItem.id }).update({ status: 'confirmed' });
}

test.before(async () => { await chooseFixture(); });
test.after(async () => { await db('orders').where({ id: order.id }).update({ ...originalOrder, updated_at: new Date() }); await db('order_items').where({ id: item.id }).update({ ...originalItem, updated_at: new Date() }); await db('orders').where({ id: secondOrder.id }).update({ status: secondOrder.status, updated_at: new Date() }); await db('order_items').where({ id: secondItem.id }).update({ ...originalSecondItem, updated_at: new Date() }); if (createdChefId) await db('staff').where({ id: createdChefId }).delete(); await db.destroy(); });

test('1 admin fetches the tenant kitchen queue', async () => { const response = await request(app('restaurant_admin')).get('/queue'); assert.equal(response.status, 200); assert.ok(Array.isArray(response.body)); });
test('2 admin queue is tenant-wide across different chef assignments', async () => { await db('order_items').where({ id: item.id }).update({ preparing_by_staff_id: chef.id }); await db('order_items').where({ id: secondItem.id }).update({ ready_by_staff_id: secondChef.id }); const response = await request(app('restaurant_admin')).get('/queue'); assert.ok(response.body.some((entry) => entry.order_id === order.id)); assert.ok(response.body.some((entry) => entry.order_id === secondOrder.id)); });
test('3 admin is rejected on mark-preparing', async () => { assert.equal((await request(app('restaurant_admin')).patch(`/orders/${order.id}/status`).send({ status: 'preparing' })).status, 403); });
test('4 admin is rejected on mark-ready', async () => { assert.equal((await request(app('restaurant_admin')).patch(`/orders/${order.id}/status`).send({ status: 'ready' })).status, 403); });
test('5 admin cannot access the existing kitchen action endpoints', async () => { assert.equal((await request(app('restaurant_admin')).patch(`/items/${item.id}/status`).send({ status: 'preparing' })).status, 403); });
test('6 chef can use the existing order status endpoint', async () => { await db('orders').where({ id: order.id }).update({ status: 'confirmed' }); assert.equal((await request(app('chef', restaurantId, chef.id)).patch(`/orders/${order.id}/status`).send({ status: 'preparing' })).status, 200); assert.equal((await request(app('chef', restaurantId, chef.id)).patch(`/orders/${order.id}/status`).send({ status: 'ready' })).status, 200); });
test('7 waiter is rejected on kitchen actions', async () => { assert.equal((await request(app('waiter', restaurantId, waiter.id)).patch(`/orders/${order.id}/status`).send({ status: 'preparing' })).status, 403); assert.equal((await request(app('waiter', restaurantId, waiter.id)).patch(`/items/${item.id}/status`).send({ status: 'preparing' })).status, 403); });
test('8 admin tenant isolation is enforced by restaurant context', async () => { const other = await db('restaurants').whereNot({ id: restaurantId }).first(); if (!other) return; const response = await request(app('restaurant_admin', other.id, admin.id)).get('/queue'); assert.equal(response.status, 200); assert.ok(!response.body.some((entry) => entry.order_id === order.id)); });
test('9 read-only kitchen source omits action buttons and guards mutation', async () => { const source = await fs.readFile(new URL('../../../console/src/console/components/views/restaurant/KitchenScreen.tsx', import.meta.url), 'utf8'); assert.match(source, /readOnly/); assert.match(source, /!readOnly && status === 'confirmed'/); assert.match(source, /!readOnly && status === 'preparing'/); });
test('10 dashboard kitchen quick link targets the shared admin path and history is permitted', async () => { const dashboard = await fs.readFile(new URL('../../../console/src/console/components/views/restaurant/DashboardScreen.tsx', import.meta.url), 'utf8'); const shell = await fs.readFile(new URL('../../../console/src/consoleApp.tsx', import.meta.url), 'utf8'); assert.match(dashboard, /onNavigate\('kitchen'\)/); assert.match(dashboard, /Kitchen \(view-only\)/); assert.match(shell, /\/admin\/kitchen/); assert.match(shell, /'shift-history'/); });
