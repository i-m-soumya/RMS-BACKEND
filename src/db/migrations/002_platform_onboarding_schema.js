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

async function ensureColumnNullable(tableName, columnName) {
  const [rows] = await db.raw(
    `SELECT column_type AS columnType, is_nullable AS isNullable
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName],
  );

  const column = rows[0];
  if (!column || column.isNullable === 'YES') {
    return;
  }

  await db.raw(`ALTER TABLE \`${tableName}\` MODIFY \`${columnName}\` ${column.columnType} NULL`);
}

async function hasConstraint(tableName, constraintName) {
  const [rows] = await db.raw(
    `SELECT COUNT(*) AS count
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?`,
    [tableName, constraintName],
  );

  return Number(rows[0]?.count || 0) > 0;
}

async function ensureStaffActivityActionConstraint() {
  if (!(await db.schema.hasTable('staff_activity_log'))) {
    await db.raw(`
      CREATE TABLE staff_activity_log (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        staff_id CHAR(36) NOT NULL,
        action_type VARCHAR(64) NOT NULL,
        reference_type VARCHAR(64) NOT NULL,
        reference_id CHAR(36) NULL,
        notes TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_staff_activity_log_staff_created (staff_id, created_at),
        KEY idx_staff_activity_log_reference (reference_type, reference_id),
        CONSTRAINT fk_staff_activity_log_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
        CONSTRAINT chk_activity_log_action CHECK (action_type IN (
          'order_confirmed', 'order_rejected', 'order_item_rejected',
          'session_opened', 'session_reset', 'bill_generated', 'bill_amended',
          'payment_recorded', 'item_availability_toggled', 'direct_order_placed',
          'staff_created', 'staff_revoked', 'menu_item_created',
          'menu_item_updated', 'menu_item_deleted', 'order_item_preparing',
          'order_item_ready'
        )),
        CONSTRAINT chk_activity_log_reference_type CHECK (reference_type IN (
          'order', 'order_item', 'session', 'bill', 'menu_item', 'staff'
        ))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    return;
  }

  if (await hasConstraint('staff_activity_log', 'chk_activity_log_action')) {
    await db.raw('ALTER TABLE staff_activity_log DROP CHECK chk_activity_log_action');
  }

  await db.raw(`
    ALTER TABLE staff_activity_log
    ADD CONSTRAINT chk_activity_log_action CHECK (action_type IN (
      'order_confirmed', 'order_rejected', 'order_item_rejected',
      'session_opened', 'session_reset', 'bill_generated', 'bill_amended',
      'payment_recorded', 'item_availability_toggled', 'direct_order_placed',
      'staff_created', 'staff_revoked', 'menu_item_created',
      'menu_item_updated', 'menu_item_deleted', 'order_item_preparing',
      'order_item_ready'
    ))
  `);
}

export async function up() {
  await addColumnIfMissing('order_items', 'preparing_by_staff_id', (table) => table.string('preparing_by_staff_id', 36).nullable());
  await addColumnIfMissing('order_items', 'ready_by_staff_id', (table) => table.string('ready_by_staff_id', 36).nullable());
  await addIndexIfMissing(
    'fk_order_items_preparing_by',
    'CREATE INDEX fk_order_items_preparing_by ON order_items(preparing_by_staff_id)',
  );
  await addIndexIfMissing(
    'fk_order_items_ready_by',
    'CREATE INDEX fk_order_items_ready_by ON order_items(ready_by_staff_id)',
  );
  await addForeignKeyIfMissing(
    'fk_order_items_preparing_by',
    'ALTER TABLE order_items ADD CONSTRAINT fk_order_items_preparing_by FOREIGN KEY (preparing_by_staff_id) REFERENCES staff(id)',
  );
  await addForeignKeyIfMissing(
    'fk_order_items_ready_by',
    'ALTER TABLE order_items ADD CONSTRAINT fk_order_items_ready_by FOREIGN KEY (ready_by_staff_id) REFERENCES staff(id)',
  );
  await ensureStaffActivityActionConstraint();

  if (!(await db.schema.hasTable('menu_item_images'))) {
    await db.raw(`
      CREATE TABLE menu_item_images (
        id CHAR(36) NOT NULL,
        menu_item_id CHAR(36) NOT NULL,
        restaurant_id CHAR(36) NOT NULL,
        image_url VARCHAR(500) NOT NULL,
        display_order SMALLINT NOT NULL DEFAULT 0,
        is_primary TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_menu_item_images_item (menu_item_id, display_order, deleted_at),
        KEY idx_menu_item_images_restaurant (restaurant_id, deleted_at),
        CONSTRAINT fk_menu_item_images_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id),
        CONSTRAINT fk_menu_item_images_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.raw(`
      INSERT INTO menu_item_images
        (id, menu_item_id, restaurant_id, image_url, display_order, is_primary, created_at)
      SELECT UUID(), mi.id, mi.restaurant_id, mi.image_url, 0, 1, NOW()
      FROM menu_items mi
      WHERE mi.image_url IS NOT NULL
        AND mi.deleted_at IS NULL
    `);
  }

  await addColumnIfMissing('restaurants', 'legal_name', (table) => table.string('legal_name', 200).nullable());
  await addColumnIfMissing('restaurants', 'address', (table) => table.string('address', 255).nullable());
  await addColumnIfMissing('restaurants', 'state', (table) => table.string('state', 100).nullable());
  await addColumnIfMissing('restaurants', 'pincode', (table) => table.string('pincode', 16).nullable());
  await addColumnIfMissing('restaurants', 'currency', (table) => table.string('currency', 10).notNullable().defaultTo('INR'));
  await addColumnIfMissing('restaurants', 'onboarded_by', (table) => table.string('onboarded_by', 36).nullable());
  await addColumnIfMissing('restaurants', 'table_count', (table) => table.integer('table_count').notNullable().defaultTo(0));
  await ensureColumnNullable('restaurants', 'onboarded_by');

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

  if (await db.schema.hasColumn('tables', 'capacity')) {
    await db.raw('UPDATE tables SET seating_capacity = capacity WHERE seating_capacity IS NULL');
  }
  await db.raw('UPDATE restaurants r SET r.table_count = (SELECT COUNT(*) FROM tables t WHERE t.restaurant_id = r.id)');
}

export { MIGRATION_ID };
