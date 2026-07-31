import db from '../connection.js';

const MIGRATION_ID = '005_floors_floor_order';

async function ensureColumnExists(tableName, columnName, builder) {
  if (await db.schema.hasColumn(tableName, columnName)) {
    return;
  }

  await db.schema.alterTable(tableName, (table) => {
    builder(table);
  });
}

export async function up() {
  await ensureColumnExists('floors', 'floor_order', (table) => table.integer('floor_order').nullable().after('name'));

  await db.raw(`
    UPDATE floors
    SET floor_order = display_order
    WHERE floor_order IS NULL
  `);
}

export { MIGRATION_ID };