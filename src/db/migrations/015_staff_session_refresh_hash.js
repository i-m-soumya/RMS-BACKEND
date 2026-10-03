import db from '../connection.js';

export const MIGRATION_ID = '015_staff_session_refresh_hash';

export async function up() {
  if (!(await db.schema.hasTable('staff_sessions'))) {
    return;
  }

  if (!(await db.schema.hasColumn('staff_sessions', 'refresh_token_hash'))) {
    await db.schema.alterTable('staff_sessions', (table) => {
      table.string('refresh_token_hash', 64).nullable().after('token_hash');
      table.index(['staff_id', 'status'], 'idx_staff_sessions_staff_status');
    });
  }
}
