import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import test from 'node:test';
import customerRoutes from '../api/routes/customers.js';

test('OTP request endpoint is mounted at the frontend API path', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/customers', customerRoutes);

  const response = await request(app)
    .post('/api/customers/otp/request')
    .send({ mobile: '9999999999' });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.mobile, '9999999999');
});