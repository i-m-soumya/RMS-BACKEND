import db from '../connection.js';
import { MIGRATION_ID as PLATFORM_ONBOARDING_MIGRATION_ID, up as migratePlatformOnboarding } from './002_platform_onboarding_schema.js';
import { MIGRATION_ID as RESTAURANTS_COUNTRY_MANAGER_NAME_MIGRATION_ID, up as migrateRestaurantsCountryManagerName } from './004_restaurants_country_manager_name.js';
import { MIGRATION_ID as FLOORS_FLOOR_ORDER_MIGRATION_ID, up as migrateFloorsFloorOrder } from './005_floors_floor_order.js';
import { MIGRATION_ID as TABLES_CAPACITY_MIGRATION_ID, up as migrateTablesCapacity } from './006_tables_capacity.js';
import { MIGRATION_ID as TABLES_NAME_MIGRATION_ID, up as migrateTablesName } from './007_tables_name.js';
import { MIGRATION_ID as STAFF_SESSIONS_MIGRATION_ID, up as migrateStaffSessions } from './008_staff_sessions.js';
import { MIGRATION_ID as ADDON_MAP_REPOINT_MIGRATION_ID, up as migrateAddonMapRepoint } from './009_menu_item_addon_map_repoint_items.js';
import { MIGRATION_ID as CUSTOMER_SELF_SERVICE_SESSIONS_MIGRATION_ID, up as migrateCustomerSelfServiceSessions } from './010_customer_self_service_sessions.js';
import { MIGRATION_ID as ORDER_ITEM_ADDONS_REPOINT_ITEMS_MIGRATION_ID, up as migrateOrderItemAddonsRepointItems } from './012_order_item_addons_repoint_items.js';
import { MIGRATION_ID as ORDER_ITEMS_SPICE_LEVEL_MIGRATION_ID, up as migrateOrderItemsSpiceLevel } from './011_order_items_spice_level.js';
import { MIGRATION_ID as STAFF_LOGIN_LOCKOUT_MIGRATION_ID, up as migrateStaffLoginLockout } from './014_staff_login_lockout.js';
import { MIGRATION_ID as STAFF_SESSION_REFRESH_HASH_MIGRATION_ID, up as migrateStaffSessionRefreshHash } from './015_staff_session_refresh_hash.js';
import { MIGRATION_ID as NOTIFICATIONS_PIPELINE_MIGRATION_ID, up as migrateNotificationsPipeline } from './016_notifications_pipeline.js';
import { MIGRATION_ID as MENU_ITEM_AVAILABILITY_REASON_MIGRATION_ID, up as migrateMenuItemAvailabilityReason } from './017_menu_item_availability_reason.js';
import { MIGRATION_ID as MENU_ADDON_MAP_REFERENCE_MIGRATION_ID, up as migrateMenuAddonMapReference } from './018_menu_addon_map_reference.js';
import { MIGRATION_ID as MENU_ADDON_MAP_REFERENCE_REPAIR_MIGRATION_ID, up as migrateMenuAddonMapReferenceRepair } from './019_menu_addon_map_reference_repair.js';

async function ensureMigrationsTable() {
  const exists = await db.schema.hasTable('schema_migrations');
  if (!exists) {
    await db.schema.createTable('schema_migrations', (table) => {
      table.string('id', 120).primary();
      table.datetime('applied_at').notNullable().defaultTo(db.fn.now());
    });
  }
}

async function hasAppliedMigration(id) {
  const [row] = await db('schema_migrations').where({ id }).select('id').limit(1);
  return Boolean(row);
}

async function applyMigration(id, fn) {
  const alreadyApplied = await hasAppliedMigration(id);
  if (alreadyApplied) {
    console.log(`Skipping ${id} (already applied)`);
    return;
  }

  console.log(`Applying ${id}...`);
  await fn();
  await db('schema_migrations').insert({ id });
  console.log(`Applied ${id}`);
}

async function applyContactEmailMigration() {
  const id = '003_contact_email_restaurant_table';
  const alreadyApplied = await hasAppliedMigration(id);
  if (alreadyApplied) {
    console.log(`Skipping ${id} (already applied)`);
    return;
  }

  console.log(`Applying ${id}...`);

  if (!(await db.schema.hasColumn('restaurants', 'contact_email'))) {
    await db.schema.alterTable('restaurants', (table) => {
      table.string('contact_email', 150).nullable().after('slug');
    });
  }

  await db.raw(`
    UPDATE restaurants
    SET contact_email = CONCAT('hello@', slug, '.local')
    WHERE contact_email IS NULL OR contact_email = ''
  `);

  await db.raw('ALTER TABLE restaurants MODIFY contact_email VARCHAR(150) NOT NULL');
  await db('schema_migrations').insert({ id });
  console.log(`Applied ${id}`);
}

async function run() {
  try {
    await ensureMigrationsTable();

    await applyMigration(PLATFORM_ONBOARDING_MIGRATION_ID, migratePlatformOnboarding);
    await applyContactEmailMigration();
    await applyMigration(RESTAURANTS_COUNTRY_MANAGER_NAME_MIGRATION_ID, migrateRestaurantsCountryManagerName);
    await applyMigration(FLOORS_FLOOR_ORDER_MIGRATION_ID, migrateFloorsFloorOrder);
    await applyMigration(TABLES_CAPACITY_MIGRATION_ID, migrateTablesCapacity);
    await applyMigration(TABLES_NAME_MIGRATION_ID, migrateTablesName);
    await applyMigration(STAFF_SESSIONS_MIGRATION_ID, migrateStaffSessions);
    await applyMigration(ADDON_MAP_REPOINT_MIGRATION_ID, migrateAddonMapRepoint);
    await applyMigration(CUSTOMER_SELF_SERVICE_SESSIONS_MIGRATION_ID, migrateCustomerSelfServiceSessions);
    await applyMigration(ORDER_ITEM_ADDONS_REPOINT_ITEMS_MIGRATION_ID, migrateOrderItemAddonsRepointItems);
    await applyMigration(ORDER_ITEMS_SPICE_LEVEL_MIGRATION_ID, migrateOrderItemsSpiceLevel);
    await applyMigration(STAFF_LOGIN_LOCKOUT_MIGRATION_ID, migrateStaffLoginLockout);
    await applyMigration(STAFF_SESSION_REFRESH_HASH_MIGRATION_ID, migrateStaffSessionRefreshHash);
    await applyMigration(NOTIFICATIONS_PIPELINE_MIGRATION_ID, migrateNotificationsPipeline);
    await applyMigration(MENU_ITEM_AVAILABILITY_REASON_MIGRATION_ID, migrateMenuItemAvailabilityReason);
    await applyMigration(MENU_ADDON_MAP_REFERENCE_MIGRATION_ID, migrateMenuAddonMapReference);
    await applyMigration(MENU_ADDON_MAP_REFERENCE_REPAIR_MIGRATION_ID, migrateMenuAddonMapReferenceRepair);

    console.log('Migrations complete.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

await run();
