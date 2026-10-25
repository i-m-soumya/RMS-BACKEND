import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import signupRoutes from '../api/routes/signup.js';
import { appConfig } from '../config/app.config.js';
import { createContactNotificationEmail, createOtpEmail, createWelcomeEmail } from '../mailer/templates.js';
import { DummyPaymentProvider, DummySmsProvider } from '../services/signupProviders.js';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/signup', signupRoutes);
  return server;
}

test('signup plan exposes the committed three-month trial and test-provider flags', async () => {
  const response = await request(app()).get('/api/signup/plan');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    trialMonths: 3,
    trialPriceInr: 0,
    standardPriceInr: 599,
    gst: 'as applicable',
    testMode: { sms: true, payment: true },
  });
  assert.equal(appConfig.features.stock, false);
});

test('signup validation errors use the API error envelope without querying account data', async () => {
  const response = await request(app()).post('/api/signup/start').send({ email: 'invalid' });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(typeof response.body.error.message, 'string');
});

test('the signup honeypot rejects filled values before persistence', async () => {
  const response = await request(app()).post('/api/signup/start').send({
    ownerName: 'Test Owner',
    restaurantName: 'Test Restaurant',
    email: 'signup-test@example.test',
    mobile: '9000000000',
    consent: true,
    policyVersion: appConfig.policyVersion,
    utm: {},
    referrer: '',
    hp: 'bot',
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_REQUEST');
});

test('dummy providers accept only the documented mobile code and can simulate payment failure', async () => {
  const sms = new DummySmsProvider();
  assert.equal(await sms.verify({ code: '0000' }), true);
  assert.equal(await sms.verify({ code: '0001' }), false);
  const payment = new DummyPaymentProvider();
  assert.equal((await payment.createSubscription({ simulate: 'success' })).success, true);
  assert.equal((await payment.createSubscription({ simulate: 'fail' })).success, false);
});

test('verification and welcome templates include text and safe branded HTML', () => {
  const otp = createOtpEmail({ ownerName: '<Test>', code: '123456', expiresMinutes: 10 });
  assert.equal(otp.subject, 'Your Restro360 verification code: 123456');
  assert.match(otp.text, /expires in 10 minutes/);
  assert.match(otp.html, /&lt;Test&gt;/);
  assert.match(otp.html, /support@restro360\.tech/);

  const welcome = createWelcomeEmail({ ownerName: 'Owner', restaurantName: 'Cafe' });
  assert.match(welcome.text, /Next steps/);
  assert.match(welcome.html, /console\.restro360\.tech/);
  assert.doesNotMatch(welcome.text, /password:/i);
});

test('contact notification email escapes submitted content for HTML', () => {
  const email = createContactNotificationEmail({
    name: '<Owner>',
    email: 'owner@example.test',
    restaurantName: '<Cafe>',
    message: '<script>alert(1)</script>',
  });
  assert.match(email.subject, /<Cafe>/);
  assert.match(email.text, /<script>alert\(1\)<\/script>/);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
});
