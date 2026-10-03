import db from '../connection.js';

export const MIGRATION_ID = '009_menu_item_addon_map_repoint_items';

// menu_addons was never populated/wired up; addons are actually menu_items with item_type='addon_only'.
export async function up() {
  const hasTable = await db.schema.hasTable('menu_item_addon_map');
  if (!hasTable) {
    return;
  }

  const [fk] = await db('information_schema.KEY_COLUMN_USAGE')
    .where({
      TABLE_SCHEMA: db.client.database(),
      TABLE_NAME: 'menu_item_addon_map',
      CONSTRAINT_NAME: 'fk_addon_map_addon',
    })
    .select('REFERENCED_TABLE_NAME');

  if (fk && fk.REFERENCED_TABLE_NAME === 'menu_items') {
    return;
  }

  await db.schema.alterTable('menu_item_addon_map', (table) => {
    table.dropForeign('addon_id', 'fk_addon_map_addon');
  });

  await db.schema.alterTable('menu_item_addon_map', (table) => {
    table.foreign('addon_id', 'fk_addon_map_addon').references('id').inTable('menu_items').onDelete('CASCADE');
  });
}
