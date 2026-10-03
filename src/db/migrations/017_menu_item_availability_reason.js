import db from '../connection.js';

export const MIGRATION_ID = '017_menu_item_availability_reason';

export async function up() {
  if (await db.schema.hasColumn('menu_item_availability_log', 'reason')) return;

  await db.schema.alterTable('menu_item_availability_log', (table) => {
    table.string('reason', 255).nullable().after('new_value');
  });
}