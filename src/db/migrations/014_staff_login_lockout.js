import db from '../connection.js';

export const MIGRATION_ID = '014_staff_login_lockout';

export async function up() {
  if (await db.schema.hasTable('staff_login_security')) {
    return;
  }

  await db.schema.createTable('staff_login_security', (table) => {
    table.string('id', 36).primary();
    table.string('staff_id', 36).notNullable().unique();
    table.integer('failed_attempts').notNullable().defaultTo(0);
    table.dateTime('lockout_until').nullable();
    table.dateTime('last_failed_at').nullable();
    table.dateTime('locked_at').nullable();
    table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
    table.dateTime('updated_at').notNullable().defaultTo(db.fn.now());
    table.index(['staff_id', 'lockout_until'], 'idx_staff_login_security_staff_lockout');
  });

  await db.raw('ALTER TABLE staff_login_security ADD CONSTRAINT fk_staff_login_security_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE');
}
