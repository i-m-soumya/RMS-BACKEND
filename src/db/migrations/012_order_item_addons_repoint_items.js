import db from '../connection.js';

export const MIGRATION_ID = '012_order_item_addons_repoint_items';

export async function up() {
  if (!(await db.schema.hasTable('order_item_addons'))) {
    return;
  }

  const [foreignKey] = await db('information_schema.KEY_COLUMN_USAGE')
    .where({
      TABLE_SCHEMA: db.client.database(),
      TABLE_NAME: 'order_item_addons',
      CONSTRAINT_NAME: 'fk_order_item_addons_addon',
    })
    .select('REFERENCED_TABLE_NAME');

  if (foreignKey?.REFERENCED_TABLE_NAME === 'menu_items') {
    return;
  }

  await db.schema.alterTable('order_item_addons', (table) => {
    table.dropForeign('addon_id', 'fk_order_item_addons_addon');
  });

  await db.schema.alterTable('order_item_addons', (table) => {
    table.foreign('addon_id', 'fk_order_item_addons_addon').references('id').inTable('menu_items').onDelete('RESTRICT');
  });
}
