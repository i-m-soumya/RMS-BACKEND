import db from '../connection.js';

export const MIGRATION_ID = '019_menu_addon_map_reference_repair';

export async function up() {
  const rows = await db('information_schema.KEY_COLUMN_USAGE')
    .where({ TABLE_SCHEMA: db.client.database(), TABLE_NAME: 'menu_item_addon_map', COLUMN_NAME: 'addon_id' })
    .whereNotNull('REFERENCED_TABLE_NAME')
    .select('CONSTRAINT_NAME', 'REFERENCED_TABLE_NAME');
  const addonForeignKey = rows.find((row) => row.CONSTRAINT_NAME === 'fk_addon_map_addon');
  if (addonForeignKey?.REFERENCED_TABLE_NAME === 'menu_addons') return;
  if (addonForeignKey) await db.schema.alterTable('menu_item_addon_map', (table) => table.dropForeign('addon_id', 'fk_addon_map_addon'));
  await db.raw(`
    INSERT INTO menu_addons (id, restaurant_id, name, price, is_available, display_order, created_at, updated_at, deleted_at)
    SELECT item.id, item.restaurant_id, item.name, item.price, item.is_available, item.display_order, item.created_at, item.updated_at, item.deleted_at
    FROM menu_items item
    WHERE item.item_type = 'addon_only'
      AND NOT EXISTS (SELECT 1 FROM menu_addons addon WHERE addon.id = item.id)
  `);
  await db.schema.alterTable('menu_item_addon_map', (table) => table.foreign('addon_id', 'fk_addon_map_addon').references('id').inTable('menu_addons').onDelete('RESTRICT'));
}