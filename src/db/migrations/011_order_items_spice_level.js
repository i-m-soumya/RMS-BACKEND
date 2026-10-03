import db from '../connection.js';

export const MIGRATION_ID = '011_order_items_spice_level';

// Waiter direct order entry needs the customer's chosen spice level per item, separate from
// menu_items.spice_level (the dish's own default/fixed attribute). Mirrors chk_menu_items_spice.
export async function up() {
  const hasColumn = await db.schema.hasColumn('order_items', 'spice_level');
  if (hasColumn) {
    return;
  }

  await db.raw(`
    ALTER TABLE \`order_items\`
      ADD COLUMN \`spice_level\` varchar(15) DEFAULT NULL AFTER \`notes\`
  `);

  await db.raw(`
    ALTER TABLE \`order_items\`
      ADD CONSTRAINT \`chk_order_items_spice\` CHECK ((
        (\`spice_level\` is null) or (\`spice_level\` in ('none','mild','medium','hot','extra_hot'))
      ))
  `);
}
