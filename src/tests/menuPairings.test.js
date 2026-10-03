import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import test from 'node:test';
import db from '../db/connection.js';
import { createMenuItemPairing, deleteMenuItemPairing, listMenuItemPairings } from '../api/controllers/adminController.js';
import adminRoutes from '../api/routes/admin.js';

const restaurantA = '91000000-0000-4000-8000-000000000001';
const restaurantB = '91000000-0000-4000-8000-000000000002';
const itemA = '92000000-0000-4000-8000-000000000001';
const itemB = '92000000-0000-4000-8000-000000000002';
const itemC = '92000000-0000-4000-8000-000000000003';
const foreignItem = '92000000-0000-4000-8000-000000000004';

function app(restaurantId = restaurantA) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.user = { id: '93000000-0000-4000-8000-000000000001', role: 'restaurant_admin', restaurantId }; next(); });
  server.get('/items/:itemId/pairings', listMenuItemPairings);
  server.post('/items/:itemId/pairings', createMenuItemPairing);
  server.delete('/pairings/:pairingId', deleteMenuItemPairing);
  return server;
}

async function cleanup() {
  await db('menu_item_pairings').whereIn('restaurant_id', [restaurantA, restaurantB]).delete();
  await db('menu_items').whereIn('id', [itemA, itemB, itemC, foreignItem]).delete();
  await db('restaurants').whereIn('id', [restaurantA, restaurantB]).delete();
}

async function seed() {
  await cleanup();
  await db('restaurants').insert([restaurantA, restaurantB].map((id) => ({ id, slug: id, name: id, legal_name: id, address: 'Test', contact_email: `${id}@test.local`, city: 'Mumbai', country: 'India', state: 'Maharashtra', pincode: '400001', timezone: 'Asia/Kolkata', currency: 'INR', status: 'active' })));
  await db('menu_items').insert([itemA, itemB, itemC].map((id, index) => ({ id, restaurant_id: restaurantA, name: `Pairing ${index}`, mrp: 100, price: 80, dietary_type: 'veg', item_type: 'regular', is_available: 1 })));
  await db('menu_items').insert({ id: foreignItem, restaurant_id: restaurantB, name: 'Foreign', mrp: 100, price: 80, dietary_type: 'veg', item_type: 'regular', is_available: 1 });
}

test.beforeEach(seed);
test.after(async () => { await cleanup(); await db.destroy(); });

test('creates a same-tenant pairing and reads it bidirectionally', async () => {
  const created = await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemB });
  assert.equal(created.status, 201);
  const fromA = await request(app()).get(`/items/${itemA}/pairings`);
  const fromB = await request(app()).get(`/items/${itemB}/pairings`);
  assert.equal(fromA.body.data[0].pairedItem.id, itemB);
  assert.equal(fromB.body.data[0].pairedItem.id, itemA);
  assert.equal((await db('menu_item_pairings').where({ restaurant_id: restaurantA })).length, 1);
});

test('rejects self, same-direction, reverse-direction, deleted, and foreign targets', async () => {
  assert.equal((await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemA })).status, 400);
  assert.equal((await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemB })).status, 201);
  assert.equal((await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemB })).status, 409);
  assert.equal((await request(app()).post(`/items/${itemB}/pairings`).send({ pairedItemId: itemA })).status, 409);
  await db('menu_items').where({ id: itemC }).update({ deleted_at: new Date() });
  assert.equal((await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemC })).status, 400);
  assert.equal((await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: foreignItem })).status, 400);
  assert.equal((await db('menu_item_pairings').where({ restaurant_id: restaurantA })).length, 1);
});

test('excludes deleted paired items and orders by display order', async () => {
  await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemB, displayOrder: 20 });
  await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemC, displayOrder: 10 });
  let response = await request(app()).get(`/items/${itemA}/pairings`);
  assert.deepEqual(response.body.data.map((entry) => entry.pairedItem.id), [itemC, itemB]);
  await db('menu_items').where({ id: itemC }).update({ deleted_at: new Date() });
  response = await request(app()).get(`/items/${itemA}/pairings`);
  assert.deepEqual(response.body.data.map((entry) => entry.pairedItem.id), [itemB]);
});

test('deletes by pairing id from the reverse direction and isolates tenants', async () => {
  const created = await request(app()).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemB });
  const reverse = await request(app()).get(`/items/${itemB}/pairings`);
  assert.equal(reverse.body.data[0].pairingId, created.body.data.id);
  assert.equal((await request(app(restaurantB)).delete(`/pairings/${created.body.data.id}`)).status, 404);
  assert.equal((await request(app()).delete(`/pairings/${reverse.body.data[0].pairingId}`)).status, 200);
  assert.equal((await request(app()).get(`/items/${itemA}/pairings`)).body.data.length, 0);
  assert.equal((await request(app()).get(`/items/${itemB}/pairings`)).body.data.length, 0);
  assert.equal((await db('menu_item_pairings').where({ id: created.body.data.id }).first()).deleted_at !== null, true);
});

test('tenant isolation rejects item reads and creates', async () => {
  assert.equal((await request(app(restaurantB)).get(`/items/${itemA}/pairings`)).status, 404);
  assert.equal((await request(app(restaurantB)).post(`/items/${itemA}/pairings`).send({ pairedItemId: itemB })).status, 400);
});

test('pairing routes are admin-only and frontend excludes current/already-paired items', async () => {
  const routeSource = await fs.readFile(new URL('../api/routes/admin.js', import.meta.url), 'utf8');
  const menuSource = await fs.readFile(new URL('../../../console/src/console/components/views/restaurant/MenuScreen.tsx', import.meta.url), 'utf8');
  assert.match(routeSource, /menu\/items\/:itemId\/pairings.*restaurant_admin/);
  assert.match(routeSource, /menu\/pairings\/:pairingId.*restaurant_admin/);
  assert.match(menuSource, /new Set\(\[item\.id, \.\.\.savedPairings\.map\(\(pairing\) => pairing\.pairedItem\.id\)\]\)/);
  assert.match(menuSource, /!excluded\.has\(option\.id\)/);
  assert.equal(typeof adminRoutes, 'function');
});
