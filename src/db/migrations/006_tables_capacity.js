import db from '../connection.js';

const MIGRATION_ID = '006_tables_capacity';

async function ensureColumnExists(tableName, columnName, builder) {
  if (await db.schema.hasColumn(tableName, columnName)) {
    return;
  }

  await db.schema.alterTable(tableName, (table) => {
    builder(table);
  });
}

export async function up() {
  await ensureColumnExists('tables', 'capacity', (table) => table.integer('capacity').nullable().after('table_number'));

  await db.raw(`
    UPDATE tables
    SET capacity = seating_capacity
    WHERE capacity IS NULL
  `);

  await db.raw('ALTER TABLE tables MODIFY capacity INT NOT NULL');
}

export { MIGRATION_ID };