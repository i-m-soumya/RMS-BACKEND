import db from '../connection.js';

export const MIGRATION_ID = '008_staff_sessions';

export async function up() {
  if (await db.schema.hasTable('staff_sessions')) {
    return;
  }

  await db.schema.createTable('staff_sessions', (table) => {
    table.uuid('id').primary();
    table.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    table.string('token_hash', 64).notNullable().unique();
    table.string('device_info', 500).nullable();
    table.string('ip_address', 45).nullable();
    table.enum('status', ['active', 'kicked', 'expired', 'logged_out', 'revoked']).notNullable().defaultTo('active');
    table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
    table.dateTime('expires_at').notNullable();
    table.dateTime('invalidated_at').nullable();
    table.index(['staff_id', 'status']);
    table.index(['expires_at', 'status']);
  });
}