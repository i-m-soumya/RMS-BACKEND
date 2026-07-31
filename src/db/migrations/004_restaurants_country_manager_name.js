import db from '../connection.js';

const MIGRATION_ID = '004_restaurants_country_manager_name';

async function ensureColumnExists(tableName, columnName, builder) {
  if (await db.schema.hasColumn(tableName, columnName)) {
    return;
  }

  await db.schema.alterTable(tableName, (table) => {
    builder(table);
  });
}

export async function up() {
  await ensureColumnExists('restaurants', 'manager_name', (table) => table.string('manager_name', 150).nullable().after('legal_name'));
  await ensureColumnExists('restaurants', 'country', (table) => table.string('country', 100).notNullable().defaultTo('India').after('city'));

  await db.raw(`
    UPDATE restaurants
    SET manager_name = name
    WHERE manager_name IS NULL OR manager_name = ''
  `);

  await db.raw(`
    UPDATE restaurants
    SET country = 'India'
    WHERE country IS NULL OR country = ''
  `);

  await db.raw('ALTER TABLE restaurants MODIFY country VARCHAR(100) NOT NULL DEFAULT \'India\'');
}

export { MIGRATION_ID };