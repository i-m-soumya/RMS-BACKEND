import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import db from '../db/connection.js';
import { setItemAvailabilitySchema, setItemRatingsVisibilitySchema } from '../api/validators/admin.js';

const controllerSource = await fs.readFile(new URL('../api/controllers/adminController.js', import.meta.url), 'utf8');
const routeSource = await fs.readFile(new URL('../api/routes/admin.js', import.meta.url), 'utf8');
const migrationSource = await fs.readFile(new URL('../db/migrations/017_menu_item_availability_reason.js', import.meta.url), 'utf8');

test.after(async () => { await db.destroy(); });

test('1 category deletion guard counts active primary items', () => {
  assert.match(controllerSource, /is_primary_category.*1/);
  assert.match(controllerSource, /countDistinct/);
});
test('2 category deletion permits non-primary mappings', () => assert.match(controllerSource, /is_primary_category.*1/));
test('3 category deletion ignores soft-deleted items', () => assert.match(controllerSource, /mi\.deleted_at/));
test('4 category deletion is tenant scoped', () => assert.match(controllerSource, /restaurant_id: restaurantId/));
test('5 availability reason is mandatory', () => {
  assert.equal(setItemAvailabilitySchema.safeParse({ is_available: true }).success, false);
  assert.equal(setItemAvailabilitySchema.safeParse({ is_available: true, reason: '  ' }).success, false);
});
test('6 availability logging records the manual transition fields', () => {
  assert.match(controllerSource, /trigger_type: 'manual'/);
  assert.match(controllerSource, /reason: reason\.trim\(\)/);
  assert.match(controllerSource, /previous_value: previousState/);
  assert.match(controllerSource, /new_value: nextState/);
});
test('7 availability route allows all confirmed staff roles', () => assert.match(routeSource, /restaurant_admin', 'waiter', 'chef/));
test('8 ratings visibility is admin-only', () => assert.match(routeSource, /show-ratings.*restaurant_admin/));
test('9 ratings endpoint only updates show_ratings', () => {
  assert.match(controllerSource, /update\(\{ show_ratings:/);
  assert.doesNotMatch(controllerSource, /setMenuItemRatingsVisibility[\s\S]*average_rating/);
});
test('10 item deletion is a soft delete', () => assert.match(controllerSource, /deleted_at: now/));
test('11 item reads filter deleted items', () => assert.match(controllerSource, /whereNull\('mi\.deleted_at'\)/));
test('12 item deletion is tenant scoped', () => assert.match(controllerSource, /where\(\{ id, restaurant_id: restaurantId \}\)/));
test('13 already deleted items return not found', () => assert.match(controllerSource, /Menu item not found/));
test('14 ratings payload validates a boolean', () => {
  assert.equal(setItemRatingsVisibilitySchema.safeParse({ show_ratings: true }).success, true);
  assert.equal(setItemRatingsVisibilitySchema.safeParse({ show_ratings: 'yes' }).success, false);
});
test('15 availability log is reusable and newest-first', async () => {
  assert.match(routeSource, /availability-log/);
  assert.match(controllerSource, /orderBy\('log\.created_at', 'desc'\)/);
  assert.match(migrationSource, /reason/);
});
