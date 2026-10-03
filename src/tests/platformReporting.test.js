import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import db from '../db/connection.js';
import { createPlatformRouter } from '../api/routes/platform.js';

const adminId = 'e84eff68-3977-402c-aacb-a2f0f2062aa5';
const restaurantIds = ['81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000004'];
const staffId = '82000000-0000-4000-8000-000000000001';
const customerId = '83000000-0000-4000-8000-000000000001';
const sessionId = '84000000-0000-4000-8000-000000000001';
const floorId = '84100000-0000-4000-8000-000000000001';
const tableId = '84200000-0000-4000-8000-000000000001';
const ids = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);

function app() {
	const server = express(); server.use(express.json());
	server.use('/api/platform', createPlatformRouter({ authenticateToken: (req, res, next) => { req.user = { id: adminId, role: 'platform_admin' }; next(); } }));
	return server;
}

async function cleanup() {
	await db('saas_registrations').whereIn('id', ids('89000000', 4)).delete();
	await db('bills').where({ id: ids('85000000', 2)[1] }).delete();
	await db('bills').where({ id: ids('85000000', 2)[0] }).delete();
	await db('orders').whereIn('id', ids('86000000', 3)).delete();
	await db('sessions').whereIn('id', [sessionId]).delete();
	await db('tables').whereIn('id', [tableId]).delete();
	await db('floors').whereIn('id', [floorId]).delete();
	await db('customers').whereIn('id', [customerId]).delete();
	await db('staff').whereIn('id', [staffId]).delete();
	await db('restaurants').whereIn('id', restaurantIds).delete();
	await db('saas_website_views').whereIn('id', ids('87000000', 5)).delete();
	await db('saas_contact_queries').whereIn('id', ids('88000000', 2)).delete();
}

async function restaurant(id, status = 'active') {
	await db('restaurants').insert({ id, name: id, legal_name: id, slug: id, address: 'Test', contact_email: `${id}@test.local`, city: 'Mumbai', country: 'India', state: 'Maharashtra', pincode: '400001', status, onboarded_by: adminId });
}

async function commerceParents() {
	await restaurant(restaurantIds[0]);
	await db('staff').insert({ id: staffId, restaurant_id: restaurantIds[0], name: 'Reporting Staff', email: 'reporting@test.local', password_hash: 'hash', role: 'restaurant_admin', access: 'active', created_by_platform_admin_id: adminId });
	await db('customers').insert({ id: customerId, name: 'Reporting Customer' });
	await db('floors').insert({ id: floorId, restaurant_id: restaurantIds[0], name: 'Ground', display_order: 1, is_active: 1 });
	await db('tables').insert({ id: tableId, restaurant_id: restaurantIds[0], floor_id: floorId, table_number: '1', capacity: 4, seating_capacity: 4, status: 'available', is_active: 1 });
	await db('sessions').insert({ id: sessionId, restaurant_id: restaurantIds[0], table_id: tableId, opened_by_staff_id: staffId });
}

test.beforeEach(async () => { await cleanup(); });
test.afterEach(async () => { await cleanup(); });
test.after(async () => { await db.destroy(); });

test('revenue excludes superseded bill versions and reports billed and collected separately', async () => {
	await commerceParents();
	await db('bills').insert([
		{ id: ids('85000000', 2)[0], restaurant_id: restaurantIds[0], session_id: sessionId, bill_version: 1, is_active: 0, generated_by_staff_id: staffId, invoice_number: 'INV-REPORT-1', financial_year: '2026-27', restaurant_name_snapshot: 'Test', restaurant_address_snapshot: 'Test', subtotal: 1000, total_amount: 1000, payment_status: 'paid' },
		{ id: ids('85000000', 2)[1], restaurant_id: restaurantIds[0], session_id: sessionId, parent_bill_id: ids('85000000', 2)[0], bill_version: 2, is_active: 1, generated_by_staff_id: staffId, invoice_number: 'INV-REPORT-2', financial_year: '2026-27', restaurant_name_snapshot: 'Test', restaurant_address_snapshot: 'Test', subtotal: 1200, total_amount: 1200, payment_status: 'paid' },
	]);
	const response = await request(app()).get('/api/platform/analytics/orders-revenue');
	assert.equal(response.status, 200); assert.equal(response.body.data.billed_revenue, 1200); assert.equal(response.body.data.collected_revenue, 1200); assert.equal(response.body.data.active_bills, 1);
});

test('website views exclude spam only when excludeSpam is enabled', async () => {
	const pageSlug = `addon-test-${Date.now()}`;
	await db('saas_website_views').insert(ids('87000000', 5).map((id, index) => ({ id, page_slug: pageSlug, referrer: 'google', city: 'Mumbai', device_type: 'desktop', is_spam: index > 2 ? 1 : 0, created_at: new Date() })));
	let response = await request(app()).get(`/api/platform/analytics/website-views?page_slug=${encodeURIComponent(pageSlug)}`);
	assert.equal(response.status, 200); assert.equal(Number(response.body.data.periods.reduce((sum, period) => sum + Number(period.views), 0)), 3);
	response = await request(app()).get(`/api/platform/analytics/website-views?excludeSpam=false&page_slug=${encodeURIComponent(pageSlug)}`);
	assert.equal(Number(response.body.data.periods.reduce((sum, period) => sum + Number(period.views), 0)), 5);
});

test('churn signals include active restaurants with no recent order and exclude recent or suspended restaurants', async () => {
	await Promise.all(restaurantIds.map((id, index) => restaurant(id, index === 3 ? 'suspended' : 'active')));
	await db('staff').insert({ id: staffId, restaurant_id: restaurantIds[0], name: 'Reporting Staff', email: 'churn@test.local', password_hash: 'hash', role: 'restaurant_admin', access: 'active', created_by_platform_admin_id: adminId });
	await db('customers').insert({ id: customerId, name: 'Churn Customer' });
	await db('floors').insert({ id: floorId, restaurant_id: restaurantIds[1], name: 'Ground', display_order: 1, is_active: 1 });
	await db('tables').insert({ id: tableId, restaurant_id: restaurantIds[1], floor_id: floorId, table_number: '1', capacity: 4, seating_capacity: 4, status: 'available', is_active: 1 });
	await db('sessions').insert({ id: sessionId, restaurant_id: restaurantIds[1], table_id: tableId, opened_by_staff_id: staffId });
	await db('orders').insert([{ id: ids('86000000', 3)[0], restaurant_id: restaurantIds[1], session_id: sessionId, customer_id: customerId, placed_by: 'customer', table_label: '1', created_at: new Date(Date.now() - 45 * 86400000) }, { id: ids('86000000', 3)[1], restaurant_id: restaurantIds[2], session_id: sessionId, customer_id: customerId, placed_by: 'customer', table_label: '1', created_at: new Date(Date.now() - 5 * 86400000) }]);
	const response = await request(app()).get('/api/platform/analytics/churn-signals');
	assert.equal(response.status, 200); const result = response.body.data;
	assert.ok(result.some((row) => row.id === restaurantIds[0])); assert.ok(result.some((row) => row.id === restaurantIds[1])); assert.ok(!result.some((row) => row.id === restaurantIds[2])); assert.ok(!result.some((row) => row.id === restaurantIds[3]));
});

test('contact resolve and spam actions maintain independent state semantics', async () => {
	await db('saas_contact_queries').insert(ids('88000000', 2).map((id, index) => ({ id, name: `Contact ${index}`, email: `contact${index}@test.local`, message: 'Message', is_spam: 0, is_resolved: index })));
	let response = await request(app()).post(`/api/platform/contact-queries/${ids('88000000', 2)[0]}/resolve`); assert.equal(response.status, 200); assert.equal(response.body.data.is_resolved, 1); assert.equal(response.body.data.is_spam, 0);
	response = await request(app()).post(`/api/platform/contact-queries/${ids('88000000', 2)[1]}/spam`); assert.equal(response.status, 200); assert.equal(response.body.data.is_spam, 1); assert.equal(response.body.data.is_resolved, 0);
});

test('registration conversion rate is based on restaurant_id linkage', async () => {
	await restaurant(restaurantIds[0]); await restaurant(restaurantIds[1]);
	await db('saas_registrations').insert(ids('89000000', 4).map((id, index) => ({ id, restaurant_name: `Lead ${index}`, email: `lead${index}@test.local`, plan_interest: 'pro', converted: index === 3 ? 1 : 0, restaurant_id: index < 2 ? restaurantIds[index] : null })));
	const from = new Date(Date.now() - 60_000).toISOString();
	const to = new Date(Date.now() + 60_000).toISOString();
	const response = await request(app()).get(`/api/platform/registrations/conversion-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
	assert.equal(response.status, 200); assert.deepEqual(response.body.data, { total: 4, converted: 2, rate: 0.5 });
});
