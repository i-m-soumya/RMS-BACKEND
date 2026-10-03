import db from '../connection.js';

export const MIGRATION_ID = '016_notifications_pipeline';

export async function up() {
  const hasTable = await db.schema.hasTable('notifications');
  if (hasTable) {
    return;
  }

  await db.schema.createTable('notifications', (table) => {
    table.string('id', 36).primary();
    table.string('restaurant_id', 36).notNullable();
    table.string('staff_id', 36).nullable();
    table.enum('role', ['restaurant_admin', 'waiter', 'chef']).nullable();
    table.enum('event_type', [
      'order:new',
      'order:confirmed',
      'order:rejected',
      'order:item_preparing',
      'order:item_ready',
      'bill:requested',
      'item:out_of_stock',
    ]).notNullable();
    table.json('payload').notNullable();
    table.boolean('is_read').notNullable().defaultTo(false);
    table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
    table.dateTime('updated_at').nullable();

    table.index(['restaurant_id', 'staff_id', 'is_read', 'created_at'], 'idx_notifications_staff_scope');
    table.index(['restaurant_id', 'role', 'is_read', 'created_at'], 'idx_notifications_role_scope');
    table.foreign('restaurant_id').references('id').inTable('restaurants').onDelete('CASCADE');
    table.foreign('staff_id').references('id').inTable('staff').onDelete('CASCADE');
  });
}
