import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createPlatformRouter } from '../api/routes/platform.js';

function buildApp() {
  const app = express();
  app.use(express.json());

  const authMiddleware = (req, res, next) => {
    req.user = {
      id: 'platform-admin-1',
      role: req.headers['x-test-role'] || 'platform_admin',
    };
    next();
  };

  const handlers = {
    listRestaurants: (req, res) => res.json({ ok: true, route: 'list' }),
    createRestaurantBasicDetails: (req, res) => res.status(201).json({ ok: true, route: 'create-basic' }),
    updateRestaurantBasicDetails: (req, res) => res.json({ ok: true, route: 'update-basic' }),
    saveFloorsAndTables: (req, res) => res.json({ ok: true, route: 'save-floors-tables' }),
    generateRestaurantQRCodes: (req, res) => res.json({ ok: true, route: 'generate-qrs' }),
    getRestaurantQrBatch: (req, res) => res.json({ ok: true, route: 'batch-qrs' }),
    downloadRestaurantQrBatchZip: (req, res) => res.status(200).send('zip-content'),
    downloadTableQrCode: (req, res) => res.status(200).send('png-content'),
    createRestaurantAdminCredentials: (req, res) => res.status(201).json({ ok: true, route: 'create-admin' }),
    getRestaurantDetails: (req, res) => res.json({ ok: true, route: 'details' }),
    updateRestaurant: (req, res) => res.json({ ok: true, route: 'update' }),
    updateRestaurantBranding: (req, res) => res.json({ ok: true, route: 'branding' }),
    updateRestaurantGst: (req, res) => res.json({ ok: true, route: 'gst' }),
    resendRestaurantAdminCredentials: (req, res) => res.json({ data: { email: 'admin@cafe-one.in', role: 'restaurant_admin' } }),
    suspendRestaurant: (req, res) => res.json({ ok: true, route: 'suspend' }),
    reactivateRestaurant: (req, res) => res.json({ ok: true, route: 'reactivate' }),
  };

  app.use('/api/platform', createPlatformRouter({ authenticateToken: authMiddleware, handlers }));
  return app;
}

const validBasicDetailsBody = {
  name: 'Cafe One',
  slug: 'cafe-one',
  address: '123 Main Street',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  timezone: 'Asia/Kolkata',
  contactEmail: 'ops@cafe-one.in',
};

const validFloorsBody = {
  floors: [
    {
      name: 'Ground Floor',
      tables: [
        { tableNumber: '1', capacity: 4 },
      ],
    },
  ],
};

const validAdminCredentialsBody = {
  name: 'Restaurant Admin',
  email: 'admin@cafe-one.in',
};

test('platform onboarding routes deny non-platform roles (RBAC)', async () => {
  const app = buildApp();

  const cases = [
    { method: 'get', path: '/api/platform/restaurants' },
    { method: 'get', path: '/api/platform/restaurants/restaurant-1' },
    { method: 'post', path: '/api/platform/restaurants', body: validBasicDetailsBody },
    { method: 'patch', path: '/api/platform/restaurants/restaurant-1/basic-details', body: { city: 'Mumbai' } },
    { method: 'patch', path: '/api/platform/restaurants/restaurant-1', body: { city: 'Mumbai' } },
    { method: 'patch', path: '/api/platform/restaurants/restaurant-1/branding', body: { welcomeMessage: 'Welcome' } },
    { method: 'patch', path: '/api/platform/restaurants/restaurant-1/gst', body: { gstEnabled: false } },
    { method: 'put', path: '/api/platform/restaurants/restaurant-1/floors-and-tables', body: validFloorsBody },
    { method: 'post', path: '/api/platform/restaurants/restaurant-1/qr-codes/generate' },
    { method: 'get', path: '/api/platform/restaurants/restaurant-1/qr-codes/batch' },
    { method: 'get', path: '/api/platform/restaurants/restaurant-1/qr-codes/batch-download' },
    { method: 'get', path: '/api/platform/tables/table-1/qr' },
    { method: 'post', path: '/api/platform/restaurants/restaurant-1/admin-credentials', body: validAdminCredentialsBody },
    { method: 'post', path: '/api/platform/restaurants/restaurant-1/admin-credentials/resend' },
    { method: 'post', path: '/api/platform/restaurants/restaurant-1/suspend' },
    { method: 'post', path: '/api/platform/restaurants/restaurant-1/reactivate' },
  ];

  for (const entry of cases) {
    let req = request(app)[entry.method](entry.path).set('x-test-role', 'waiter');
    if (entry.body) {
      req = req.send(entry.body);
    }
    const response = await req;
    assert.equal(response.status, 403, `Expected 403 for ${entry.method.toUpperCase()} ${entry.path}`);
    assert.match(response.body.error, /Forbidden/i);
  }
});

test('platform onboarding routes allow platform_admin role', async () => {
  const app = buildApp();

  const responseList = await request(app)
    .get('/api/platform/restaurants')
    .set('x-test-role', 'platform_admin');
  assert.equal(responseList.status, 200);

  const responseCreate = await request(app)
    .post('/api/platform/restaurants')
    .set('x-test-role', 'platform_admin')
    .send(validBasicDetailsBody);
  assert.equal(responseCreate.status, 201);

  const responseFloors = await request(app)
    .put('/api/platform/restaurants/restaurant-1/floors-and-tables')
    .set('x-test-role', 'platform_admin')
    .send(validFloorsBody);
  assert.equal(responseFloors.status, 200);

  const responseBatchZip = await request(app)
    .get('/api/platform/restaurants/restaurant-1/qr-codes/batch-download')
    .set('x-test-role', 'platform_admin');
  assert.equal(responseBatchZip.status, 200);

  const responseAdmin = await request(app)
    .post('/api/platform/restaurants/restaurant-1/admin-credentials')
    .set('x-test-role', 'platform_admin')
    .send(validAdminCredentialsBody);
  assert.equal(responseAdmin.status, 201);

  const responseSuspend = await request(app)
    .post('/api/platform/restaurants/restaurant-1/suspend')
    .set('x-test-role', 'platform_admin');
  assert.equal(responseSuspend.status, 200);

  const responseReactivate = await request(app)
    .post('/api/platform/restaurants/restaurant-1/reactivate')
    .set('x-test-role', 'platform_admin');
  assert.equal(responseReactivate.status, 200);
});

test('platform onboarding routes validate request payloads', async () => {
  const app = buildApp();

  const invalidSlugBody = {
    ...validBasicDetailsBody,
    slug: 'INVALID Slug',
  };

  const response = await request(app)
    .post('/api/platform/restaurants')
    .set('x-test-role', 'platform_admin')
    .send(invalidSlugBody);

  assert.equal(response.status, 422);
  assert.equal(response.body.code, 'VALIDATION_ERROR');
});

test('general restaurant edit rejects immutable slug and table_count fields', async () => {
  const app = buildApp();

  for (const body of [{ slug: 'new-slug' }, { table_count: 99 }]) {
    const response = await request(app)
      .patch('/api/platform/restaurants/restaurant-1')
      .set('x-test-role', 'platform_admin')
      .send(body);
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
  }
});
