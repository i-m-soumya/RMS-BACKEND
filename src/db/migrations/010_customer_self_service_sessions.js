import db from '../connection.js';

export const MIGRATION_ID = '010_customer_self_service_sessions';

// Allows a customer to open a session directly (no waiter required) and lets multiple
// concurrent sessions per table share a join code so other members of that party can join.
// Reverses the previous "waiter opens all sessions" constraint (opened_by_staff_id was NOT NULL).
export async function up() {
  const hasCustomerOwnerColumn = await db.schema.hasColumn('sessions', 'opened_by_customer_id');

  if (!hasCustomerOwnerColumn) {
    await db.raw(`
      ALTER TABLE \`sessions\`
        MODIFY COLUMN \`opened_by_staff_id\` char(36) NULL,
        ADD COLUMN \`opened_by_customer_id\` char(36) NULL AFTER \`opened_by_staff_id\`
    `);

    await db.raw(`
      ALTER TABLE \`sessions\`
        ADD KEY \`fk_sessions_customer\` (\`opened_by_customer_id\`),
        ADD CONSTRAINT \`fk_sessions_customer\` FOREIGN KEY (\`opened_by_customer_id\`) REFERENCES \`customers\` (\`id\`)
    `);

    // Exactly one owner type must be set — mirrors the existing chk_tax_config_updated_by pattern
    await db.raw(`
      ALTER TABLE \`sessions\`
        ADD CONSTRAINT \`chk_sessions_opened_by\` CHECK ((
          (\`opened_by_staff_id\` IS NOT NULL AND \`opened_by_customer_id\` IS NULL)
          OR
          (\`opened_by_staff_id\` IS NULL AND \`opened_by_customer_id\` IS NOT NULL)
        ))
    `);
  }

  const hasJoinCodeColumn = await db.schema.hasColumn('sessions', 'join_code');

  if (!hasJoinCodeColumn) {
    await db.raw(`
      ALTER TABLE \`sessions\`
        ADD COLUMN \`join_code\` char(4) DEFAULT NULL AFTER \`opened_by_customer_id\`
    `);

    // Scoped uniqueness while the session is joinable (mirrors tables.table_number_active pattern:
    // a generated column that's NULL outside the "must be unique" window, so the unique index only
    // applies where it matters and the code is free to be reused once a session closes)
    await db.raw(`
      ALTER TABLE \`sessions\`
        ADD COLUMN \`join_code_active\` varchar(45)
          GENERATED ALWAYS AS (
            (CASE WHEN (\`status\` <> 'closed') THEN CONCAT(\`restaurant_id\`, '||', \`join_code\`) ELSE NULL END)
          ) STORED,
        ADD UNIQUE KEY \`uq_sessions_join_code_active\` (\`join_code_active\`)
    `);
  }
}
