import db from '../connection.js';
import { MIGRATION_ID as PLATFORM_ONBOARDING_MIGRATION_ID, up as migratePlatformOnboarding } from './002_platform_onboarding_schema.js';

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

async function run() {
  try {
    await ensureMigrationsTable();

    await applyMigration(PLATFORM_ONBOARDING_MIGRATION_ID, migratePlatformOnboarding);

    console.log('Migrations complete.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

await run();
