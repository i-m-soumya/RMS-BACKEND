import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import db from '../db/connection.js';
import authRoutes from '../api/routes/auth.js';
import { createPlatformRouter } from '../api/routes/platform.js';
import restaurantRoutes from '../api/routes/restaurants.js';

const restaurantId = '44444444-4444-4444-8444-444444444444';
const staffId = '55555555-5555-4555-8555-555555555555';
const platformAdminId = 'e84eff68-3977-402c-aacb-a2f0f2062aa5';
const password = 'Correct horse battery staple';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/restaurants', restaurantRoutes);
  app.use('/api/platform', createPlatformRouter({
    authenticateToken: (req, res, next) => {
      req.user = { id: 'platform-admin-test', role: 'platform_admin' };
      next();
    },
  }));
  return app;
}

async function removeTestRows() {
  await db('staff_sessions').where({ staff_id: staffId }).delete();
  await db('staff').where({ id: staffId }).delete();
  await db('restaurants').where({ id: restaurantId }).delete();
}

async function seedRestaurant(status = 'active', deletedAt = null) {
  await removeTestRows();
  const seededAt = new Date(Date.now() - 5000);
  await db('restaurants').insert({
    id: restaurantId,
    slug: `suspension-test-${Date.now()}`,
    name: 'Suspension Test Restaurant',
    legal_name: 'Suspension Test Restaurant',
    address: '123 Test Street',
    contact_email: 'suspension-test@example.com',
    city: 'Mumbai',
    country: 'India',
    state: 'Maharashtra',
    pincode: '400001',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    status,
    deleted_at: deletedAt,
    created_at: seededAt,
    updated_at: seededAt,
  });
  return db('restaurants').where({ id: restaurantId }).first();
}

async function seedStaff() {
  await db('staff').insert({
    id: staffId,
    restaurant_id: restaurantId,
    name: 'Suspension Test Admin',
    email: 'suspension-staff@example.com',
    password_hash: await bcrypt.hash(password, 10),
    role: 'restaurant_admin',
    access: 'active',
    created_by_platform_admin_id: platformAdminId,
    created_by_staff_id: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
}

async function setStatus(status) {
  return request(buildApp())
    .post(`/api/platform/restaurants/${restaurantId}/${status === 'active' ? 'reactivate' : 'suspend'}`);
}

async function staffLogin() {
  return request(buildApp())
    .post('/api/auth/staff-login')
    .send({ email: 'suspension-staff@example.com', password });
}

test.afterEach(async () => {
  await removeTestRows();
});

test('suspend changes database status and updated_at', async () => {
  await seedRestaurant();
  const beforeSuspend = (await db.raw('select CURRENT_TIMESTAMP as beforeSuspend'))[0][0].beforeSuspend;
  const response = await setStatus('suspended');
  const updated = await db('restaurants').where({ id: restaurantId }).first();
  const [timestampCheck] = await db('restaurants')
    .where({ id: restaurantId })
    .select(db.raw('updated_at >= ? as timestamp_not_older', [beforeSuspend]));

  assert.equal(response.status, 200);
  assert.equal(updated.status, 'suspended');
  assert.equal(Number(timestampCheck.timestamp_not_older), 1);
});

test('reactivate changes database status', async () => {
  await seedRestaurant('suspended');
  const response = await setStatus('active');
  const updated = await db('restaurants').where({ id: restaurantId }).first();

  assert.equal(response.status, 200);
  assert.equal(updated.status, 'active');
});

test('suspension blocks staff login and reactivation restores it', async () => {
  const restaurant = await seedRestaurant();
  await seedStaff();

  assert.equal((await staffLogin()).status, 200);
  assert.equal((await setStatus('suspended')).status, 200);

  const blocked = await staffLogin();
  assert.equal(blocked.status, 403);
  assert.deepEqual(blocked.body, {
    error: 'Restaurant access is suspended',
    code: 'RESTAURANT_SUSPENDED',
    reason: 'restaurant_suspended',
  });

  assert.equal((await setStatus('active')).status, 200);
  assert.equal((await staffLogin()).status, 200);
  assert.ok(restaurant.slug);
});

test('suspension makes the customer entry point unavailable and reactivation restores it', async () => {
  const restaurant = await seedRestaurant();
  const app = buildApp();
  const path = `/api/restaurants/${restaurant.slug}`;

  assert.equal((await request(app).get(path)).status, 200);
  assert.equal((await setStatus('suspended')).status, 200);

  const unavailable = await request(app).get(path);
  assert.equal(unavailable.status, 410);
  assert.deepEqual(unavailable.body, {
    code: 'RESTAURANT_UNAVAILABLE',
    message: 'Restaurant is currently unavailable',
  });

  assert.equal((await setStatus('active')).status, 200);
  assert.equal((await request(app).get(path)).status, 200);
});

test('status changes are idempotent, missing restaurants return 404, and soft-deleted rows can be suspended', async () => {
  await seedRestaurant('suspended');
  assert.equal((await setStatus('suspended')).status, 200);

  await db('restaurants').where({ id: restaurantId }).update({ status: 'active', deleted_at: null });
  assert.equal((await setStatus('active')).status, 200);

  const missing = await request(buildApp()).post('/api/platform/restaurants/66666666-6666-4666-8666-666666666666/suspend');
  assert.equal(missing.status, 404);

  await seedRestaurant('active', new Date());
  const softDeleted = await setStatus('suspended');
  assert.equal(softDeleted.status, 200);
  assert.equal((await db('restaurants').where({ id: restaurantId }).first()).status, 'suspended');
});

test.after(async () => {
  await removeTestRows();
  await db.destroy();
});