import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import test from 'node:test';
import { createSessionOrdersAccess } from '../api/middleware/sessionOrdersAccess.js';
import orderRoutes from '../api/routes/orders.js';

const sessionId = 'session-a';
const restaurantId = 'restaurant-a';
const guestToken = 'guest-token-a';

function buildAccessApp({
  guestRecords = [],
  customerRecords = [],
  verifiedTokens = {},
} = {}) {
  const lookupGuestAccess = (token, requestedSessionId, now) => guestRecords.find((record) => (
    record.token === token
    && record.sessionId === requestedSessionId
    && record.expiresAt > now
    && record.restaurantId === restaurantId
  )) || null;
  const lookupCustomerAccess = (customerId, requestedSessionId, now) => customerRecords.find((record) => (
    record.customerId === customerId
    && record.sessionId === requestedSessionId
    && record.expiresAt > now
    && record.restaurantId === restaurantId
  )) || null;
  const authorize = createSessionOrdersAccess({
    findGuestSessionAccess: lookupGuestAccess,
    findCustomerSessionAccess: lookupCustomerAccess,
    verifyCustomerToken: (token) => {
      const user = verifiedTokens[token];
      if (!user) throw new Error('Invalid token');
      return user;
    },
  });
  const app = express();
  app.use(express.json());
  app.get('/api/sessions/:id/orders', authorize, (req, res) => res.json(req.sessionAccess));
  return app;
}

test('allows a guest token only for its own active tenant session', async () => {
  const app = buildAccessApp({
    guestRecords: [{
      token: guestToken,
      sessionId,
      restaurantId,
      expiresAt: new Date(Date.now() + 60_000),
    }],
  });

  const response = await request(app)
    .get(`/api/sessions/${sessionId}/orders`)
    .set('Authorization', `Bearer ${guestToken}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.sessionId, sessionId);
  assert.equal(response.body.restaurantId, restaurantId);
});

test('rejects missing, expired, and cross-session guest tokens', async () => {
  const app = buildAccessApp({
    guestRecords: [
      { token: 'expired-token', sessionId, restaurantId, expiresAt: new Date(Date.now() - 60_000) },
      { token: 'other-session-token', sessionId: 'session-b', restaurantId, expiresAt: new Date(Date.now() + 60_000) },
      { token: 'other-tenant-token', sessionId, restaurantId: 'restaurant-b', expiresAt: new Date(Date.now() + 60_000) },
    ],
  });

  const missing = await request(app).get(`/api/sessions/${sessionId}/orders`);
  const expired = await request(app).get(`/api/sessions/${sessionId}/orders`).set('Authorization', 'Bearer expired-token');
  const crossSession = await request(app).get(`/api/sessions/${sessionId}/orders`).set('Authorization', 'Bearer other-session-token');
  const crossTenant = await request(app).get(`/api/sessions/${sessionId}/orders`).set('Authorization', 'Bearer other-tenant-token');

  assert.equal(missing.status, 401);
  assert.equal(expired.status, 401);
  assert.equal(crossSession.status, 401);
  assert.equal(crossTenant.status, 401);
});

test('allows a signed-in customer only when a live guest membership binds them to the session', async () => {
  const app = buildAccessApp({
    customerRecords: [{
      customerId: 'customer-a',
      sessionId,
      restaurantId,
      expiresAt: new Date(Date.now() + 60_000),
    }],
    verifiedTokens: {
      'customer-jwt': { id: 'customer-a', role: 'customer' },
      'non-member-jwt': { id: 'customer-b', role: 'customer' },
      'staff-jwt': { id: 'staff-a', role: 'waiter' },
    },
  });

  const member = await request(app).get(`/api/sessions/${sessionId}/orders`).set('Authorization', 'Bearer customer-jwt');
  const nonMember = await request(app).get(`/api/sessions/${sessionId}/orders`).set('Authorization', 'Bearer non-member-jwt');
  const staff = await request(app).get(`/api/sessions/${sessionId}/orders`).set('Authorization', 'Bearer staff-jwt');

  assert.equal(member.status, 200);
  assert.equal(nonMember.status, 403);
  assert.equal(staff.status, 403);
});

test('guest tokens do not grant access to the protected staff order-status endpoint', async () => {
  const app = express();
  app.use('/api/orders', orderRoutes);

  const response = await request(app)
    .patch('/api/orders/order-a/status')
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ status: 'confirmed' });

  assert.equal(response.status, 403);
});