import db from '../connection.js';

export const MIGRATION_ID = '013_order_status_kitchen_flow';

export async function up() {
  if (!(await db.schema.hasTable('orders'))) {
    return;
  }

  const [statusMeta] = await db('information_schema.COLUMNS')
    .where({
      TABLE_SCHEMA: db.client.database(),
      TABLE_NAME: 'orders',
      COLUMN_NAME: 'status',
    })
    .select('COLUMN_TYPE')
    .limit(1);

  const columnType = statusMeta?.COLUMN_TYPE || '';
  const isUpdated = /preparing|ready|served|cancelled/i.test(columnType);

  if (isUpdated) {
    return;
  }

  await db.raw(`
    ALTER TABLE orders
    MODIFY status ENUM('pending','confirmed','preparing','ready','served','rejected','cancelled')
    NOT NULL DEFAULT 'pending'
  `);
}
