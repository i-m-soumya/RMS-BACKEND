import db from '../connection.js';

const MIGRATION_ID = '002_platform_onboarding_schema';

async function hasColumn(tableName, columnName) {
  return db.schema.hasColumn(tableName, columnName);
}

async function addColumnIfMissing(tableName, columnName, createColumn) {
  const exists = await hasColumn(tableName, columnName);
  if (!exists) {
    await db.schema.alterTable(tableName, (table) => {
      createColumn(table);
    });
  }
}

async function addIndexIfMissing(indexName, sql) {
  const [rows] = await db.raw(
    'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name = ?',
    [indexName],
  );

  if (Number(rows[0]?.count || 0) === 0) {
    await db.raw(sql);
  }
}

async function addForeignKeyIfMissing(constraintName, sql) {
  const [rows] = await db.raw(
    'SELECT COUNT(*) AS count FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND constraint_name = ?',
    [constraintName],
  );

  if (Number(rows[0]?.count || 0) === 0) {
    await db.raw(sql);
  }
}

export async function up() {
  await addColumnIfMissing('restaurants', 'legal_name', (table) => table.string('legal_name', 200).nullable());
  await addColumnIfMissing('restaurants', 'address', (table) => table.string('address', 255).nullable());
  await addColumnIfMissing('restaurants', 'state', (table) => table.string('state', 100).nullable());
  await addColumnIfMissing('restaurants', 'pincode', (table) => table.string('pincode', 16).nullable());
  await addColumnIfMissing('restaurants', 'currency', (table) => table.string('currency', 10).notNullable().defaultTo('INR'));
  await addColumnIfMissing('restaurants', 'onboarded_by', (table) => table.string('onboarded_by', 36).nullable());
  await addColumnIfMissing('restaurants', 'table_count', (table) => table.integer('table_count').notNullable().defaultTo(0));

  await addForeignKeyIfMissing(
    'fk_restaurants_onboarded_by',
    'ALTER TABLE restaurants ADD CONSTRAINT fk_restaurants_onboarded_by FOREIGN KEY (onboarded_by) REFERENCES platform_admins(id) ON DELETE SET NULL',
  );

  await addColumnIfMissing('floors', 'display_order', (table) => table.integer('display_order').nullable());
  await addColumnIfMissing('floors', 'is_active', (table) => table.boolean('is_active').notNullable().defaultTo(1));

  await addColumnIfMissing('tables', 'seating_capacity', (table) => table.integer('seating_capacity').nullable());
  await addColumnIfMissing('tables', 'is_active', (table) => table.boolean('is_active').notNullable().defaultTo(1));

  const hasQrTable = await db.schema.hasTable('table_qr_codes');
  if (!hasQrTable) {
    await db.schema.createTable('table_qr_codes', (table) => {
      table.string('id', 36).primary();
      table.string('restaurant_id', 36).notNullable();
      table.string('table_id', 36).notNullable();
      table.text('payload').notNullable();
      table.datetime('generated_at').notNullable().defaultTo(db.fn.now());
      table.string('created_by_platform_admin_id', 36).nullable();
      table.datetime('created_at').notNullable().defaultTo(db.fn.now());

      table.foreign('restaurant_id', 'fk_table_qr_codes_restaurant').references('id').inTable('restaurants').onDelete('CASCADE');
      table.foreign('table_id', 'fk_table_qr_codes_table').references('id').inTable('tables').onDelete('CASCADE');
      table
        .foreign('created_by_platform_admin_id', 'fk_table_qr_codes_platform_admin')
        .references('id')
        .inTable('platform_admins')
        .onDelete('SET NULL');
    });
  }

  await addIndexIfMissing(
    'idx_table_qr_codes_restaurant_table',
    'CREATE INDEX idx_table_qr_codes_restaurant_table ON table_qr_codes(restaurant_id, table_id)',
  );

  await addIndexIfMissing(
    'idx_table_qr_codes_generated_at',
    'CREATE INDEX idx_table_qr_codes_generated_at ON table_qr_codes(generated_at)',
  );

  const hasEmailLogs = await db.schema.hasTable('email_logs');
  if (!hasEmailLogs) {
    await db.schema.createTable('email_logs', (table) => {
      table.string('id', 36).primary();
      table.string('restaurant_id', 36).nullable();
      table.string('staff_id', 36).nullable();
      table.string('recipient_email', 150).notNullable();
      table.string('subject', 255).notNullable();
      table.enu('status', ['sent', 'failed']).notNullable();
      table.string('provider', 50).nullable();
      table.string('provider_message_id', 255).nullable();
      table.text('error_message').nullable();
      table.datetime('sent_at').nullable();
      table.datetime('created_at').notNullable().defaultTo(db.fn.now());

      table.foreign('restaurant_id', 'fk_email_logs_restaurant').references('id').inTable('restaurants').onDelete('SET NULL');
      table.foreign('staff_id', 'fk_email_logs_staff').references('id').inTable('staff').onDelete('SET NULL');
    });
  }

  await addIndexIfMissing('idx_email_logs_recipient', 'CREATE INDEX idx_email_logs_recipient ON email_logs(recipient_email)');
  await addIndexIfMissing('idx_email_logs_created_at', 'CREATE INDEX idx_email_logs_created_at ON email_logs(created_at)');

  await db.raw('UPDATE tables SET seating_capacity = capacity WHERE seating_capacity IS NULL');
  await db.raw('UPDATE restaurants r SET r.table_count = (SELECT COUNT(*) FROM tables t WHERE t.restaurant_id = r.id)');
}

export { MIGRATION_ID };
