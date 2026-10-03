import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import db from '../db/connection.js';
import publicMarketingRoutes from '../api/routes/publicMarketing.js';

const viewReferrer = 'https://public-test.example';
const desktopViewReferrer = 'https://desktop-test.example';
const contactEmail = 'public-contact@example.test';
const registrationEmail = 'public-registration@example.test';

function app() {
  const server = express();
  server.set('trust proxy', 1);
  server.use(express.json());
  server.use('/api/public', publicMarketingRoutes);
  return server;
}

async function cleanup() {
  await db('saas_website_views').where({ referrer: viewReferrer }).delete();
  await db('saas_website_views').where({ referrer: desktopViewReferrer }).delete();
  await db('saas_contact_queries').where({ email: contactEmail }).delete();
  await db('saas_registrations').where({ email: registrationEmail }).delete();
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => { await db.destroy(); });

test('public endpoints persist mapped data and server-derived metadata', async () => {
  let response = await request(app()).post('/api/public/website-views').set('User-Agent', 'Mozilla/5.0 (iPhone)').set('CF-IPCountry', 'IN').set('CF-City', 'Mumbai').send({ page_slug: '/', referrer: viewReferrer, ip_address: '1.2.3.4' });
  assert.equal(response.status, 201);
  const view = await db('saas_website_views').where({ page_slug: '/' }).orderBy('created_at', 'desc').first();
  assert.equal(view.page_slug, '/'); assert.equal(view.country, 'IN'); assert.equal(view.city, 'Mumbai'); assert.equal(view.device_type, 'mobile'); assert.notEqual(view.ip_address, '1.2.3.4'); assert.equal(view.is_spam, 0);

  response = await request(app()).post('/api/public/contact-queries').send({ name: 'Public Contact', email: contactEmail, phone: '9000000000', restaurant_name: 'Public Kitchen', city: 'Pune', message: 'Please call me.' });
  assert.equal(response.status, 201); const contact = await db('saas_contact_queries').where({ email: contactEmail }).first(); assert.equal(contact.is_spam, 0); assert.equal(contact.is_resolved, 0);

  response = await request(app()).post('/api/public/registrations').send({ restaurant_name: 'Public Kitchen', city: 'Pune', email: registrationEmail, phone: '9000000000', plan_interest: 'pro' });
  assert.equal(response.status, 201); const registration = await db('saas_registrations').where({ email: registrationEmail }).first(); assert.equal(registration.converted, 0); assert.equal(registration.restaurant_id, null);
});

test('public endpoints validate plans and silently discard honeypots', async () => {
  let response = await request(app()).post('/api/public/registrations').send({ restaurant_name: 'Bot', email: registrationEmail, plan_interest: 'starter', website: '' });
  assert.equal(response.status, 400); assert.equal(await db('saas_registrations').where({ email: registrationEmail }).count('*').first().then((row) => Number(row['count(*)'])), 0);
  response = await request(app()).post('/api/public/contact-queries').send({ name: 'Bot', email: contactEmail, restaurant_name: 'Bot', message: 'Spam', website: 'filled' });
  assert.equal(response.status, 201); assert.equal(await db('saas_contact_queries').where({ email: contactEmail }).count('*').first().then((row) => Number(row['count(*)'])), 0);
  response = await request(app()).post('/api/public/registrations').send({ restaurant_name: 'Bot', email: registrationEmail, plan_interest: 'pro', website: 'filled' });
  assert.equal(response.status, 201); assert.equal(await db('saas_registrations').where({ email: registrationEmail }).count('*').first().then((row) => Number(row['count(*)'])), 0);
});

test('website views classify desktop devices and leave absent geolocation nullable', async () => {
  const response = await request(app()).post('/api/public/website-views').set('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36').send({ page_slug: '/pricing', referrer: desktopViewReferrer });
  assert.equal(response.status, 201);
  const view = await db('saas_website_views').where({ referrer: desktopViewReferrer }).first();
  assert.equal(view.page_slug, '/pricing'); assert.equal(view.device_type, 'desktop'); assert.equal(view.city, null); assert.equal(view.country, null);
});

test('website views tolerate bursts above the form limiter threshold', async () => {
  const responses = [];
  for (let index = 0; index < 65; index += 1) {
    responses.push(await request(app()).post('/api/public/website-views').send({ page_slug: `/burst-${index}`, referrer: desktopViewReferrer }));
  }
  assert.ok(responses.every((response) => response.status === 201));
});

test('public marketing rate limit rejects requests after the configured threshold', async () => {
  const responses = [];
  for (let index = 0; index < 65; index += 1) {
    responses.push(await request(app()).post('/api/public/contact-queries').send({ name: 'Rate Limit', email: `rate-${index}@example.test`, restaurant_name: 'Rate Limit Kitchen', message: 'Test', website: 'filled' }));
  }
  assert.ok(responses.some((response) => response.status === 429));
});
