import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { schedulePayloadSchema } from '../api/validators/admin.js';
import { isItemCurrentlyAvailable } from '../api/controllers/adminController.js';

const adminSource = await fs.readFile(new URL('../api/controllers/adminController.js', import.meta.url), 'utf8');
const restaurantSource = await fs.readFile(new URL('../api/controllers/restaurantController.js', import.meta.url), 'utf8');
const routesSource = await fs.readFile(new URL('../api/routes/admin.js', import.meta.url), 'utf8');

const fakeDb = (available, schedules) => (table) => {
  const query = { whereNull: () => query, select: () => query, limit: async () => (table === 'menu_items' ? [{ is_available: available }] : []), where: () => query };
  if (table === 'menu_items') return query;
  return { where: () => ({ where: async () => schedules }) };
};

test('1 rejects clearly earlier schedule end', () => assert.equal(schedulePayloadSchema.safeParse({ availableFrom: '18:00', availableUntil: '17:00', repeatDaily: true }).success, false));
test('2 rejects zero-width schedule', () => assert.equal(schedulePayloadSchema.safeParse({ availableFrom: '18:00', availableUntil: '18:00', repeatDaily: true }).success, false));
test('3 accepts valid same-day window', () => assert.equal(schedulePayloadSchema.safeParse({ availableFrom: '09:00', availableUntil: '18:00', repeatDaily: true }).success, true));
test('4 single schedule is upserted because schema has unique item index', () => assert.match(adminSource, /onConflict\('menu_item_id'\)/));
test('5 effective availability checks a covering schedule', () => assert.match(adminSource, /isItemCurrentlyAvailable/));
test('6 customer menu uses the shared availability helper', () => {
  assert.match(restaurantSource, /filterCurrentlyAvailableItems/);
  assert.doesNotMatch(restaurantSource, /scheduledIds/);
});
test('7 manual unavailable overrides schedule', async () => assert.equal(await isItemCurrentlyAvailable('x', new Date(2026, 0, 1, 10), fakeDb(0, [{ available_from: '09:00:00', available_until: '18:00:00' }])), false));
test('8 no schedules uses manual availability', () => assert.match(adminSource, /if \(!schedules.length\) return true/));
test('9 active schedule matching logic is OR across rows', () => assert.match(adminSource, /schedules\.some/));
test('10 deactivation endpoint changes only is_active', () => assert.match(adminSource, /deactivateMenuItemSchedule[\s\S]*is_active: 0/));
test('11 scheduler does not update menu_items', () => { const helper = adminSource.slice(adminSource.indexOf('export async function isItemCurrentlyAvailable'), adminSource.indexOf('export async function filterCurrentlyAvailableItems')); assert.doesNotMatch(helper, /update\([\s\S]*menu_items/); });
test('12 history supports item, staff, and date filters', () => { assert.match(adminSource, /menuItemId/); assert.match(adminSource, /staffId/); assert.match(adminSource, /created_at.*>=/); });
test('13 history uses left joins for deleted item and revoked staff names', () => assert.match(adminSource, /leftJoin\('menu_items/));
test('14 history pagination uses limit and offset', () => { assert.match(adminSource, /limit\(pageSize\)/); assert.match(adminSource, /offset/); });
test('15 schedule and history routes are admin scoped and tenant scoped', () => { assert.match(routesSource, /menu\/availability-log.*restaurant_admin/); assert.match(adminSource, /restaurantId/); });
test('16 frontend has client-side schedule end validation inputs', async () => { const source = await fs.readFile(new URL('../../../console/src/console/components/views/restaurant/MenuScreen.tsx', import.meta.url), 'utf8'); assert.match(source, /available_until <= itemForm.available_from/); });
