import db from '../connection.js';

const MIGRATION_ID = '007_tables_name';

async function ensureColumnExists(tableName, columnName, builder) {
  if (await db.schema.hasColumn(tableName, columnName)) {
    return;
  }

  await db.schema.alterTable(tableName, (table) => {
    builder(table);
  });
}

export async function up() {
  await ensureColumnExists('tables', 'name', (table) => table.string('name', 100).nullable().after('floor_id'));

  await db.raw(`
    UPDATE tables
    SET name = CONCAT('Table ', table_number)
    WHERE name IS NULL OR name = ''
  `);
}

export { MIGRATION_ID };