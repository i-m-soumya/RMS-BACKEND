import db from '../connection.js';

export const MIGRATION_ID = '020_self_signup';

export async function up() {
  if (!(await db.schema.hasColumn('restaurants', 'source'))) {
    await db.schema.alterTable('restaurants', (table) => {
      table.string('source', 32).notNullable().defaultTo('platform-admin');
    });
  }

  if (!(await db.schema.hasColumn('staff', 'mobile'))) {
    await db.schema.alterTable('staff', (table) => {
      table.string('mobile', 10).nullable();
      table.unique(['mobile'], 'uq_staff_mobile');
    });
  }

  if (!(await db.schema.hasTable('pending_signups'))) {
    await db.schema.createTable('pending_signups', (table) => {
      table.string('token', 64).primary();
      table.string('owner_name', 100).notNullable();
      table.string('restaurant_name', 150).notNullable();
      table.string('email', 150).notNullable().unique('uq_pending_signups_email');
      table.string('mobile', 10).notNullable().unique('uq_pending_signups_mobile');
      table.dateTime('consent_at').notNullable();
      table.string('policy_version', 40).notNullable();
      table.text('utm_json').nullable();
      table.string('referrer', 500).nullable();
      table.enu('step', ['email_otp', 'mobile_otp', 'password', 'trial', 'done']).notNullable().defaultTo('email_otp');
      table.string('password_hash', 255).nullable();
      table.dateTime('email_verified_at').nullable();
      table.dateTime('mobile_verified_at').nullable();
      table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
      table.dateTime('expires_at').notNullable();
      table.index(['expires_at'], 'idx_pending_signups_expires');
    });
  }

  if (!(await db.schema.hasTable('subscriptions'))) {
    await db.schema.createTable('subscriptions', (table) => {
      table.string('id', 36).primary();
      table.string('signup_id', 64).notNullable().unique('uq_subscriptions_signup');
      table.string('restaurant_id', 36).notNullable().unique('uq_subscriptions_restaurant');
      table.string('plan_code', 40).notNullable();
      table.enu('status', ['trial', 'active', 'past_due', 'cancelled']).notNullable();
      table.decimal('trial_price', 10, 2).notNullable().defaultTo(0);
      table.decimal('standard_price', 10, 2).notNullable();
      table.dateTime('trial_end').notNullable();
      table.dateTime('next_billing_date').notNullable();
      table.string('provider', 40).notNullable();
      table.string('provider_customer_id', 150).nullable();
      table.string('provider_subscription_id', 150).nullable();
      table.string('idempotency_key', 128).notNullable();
      table.dateTime('autopay_consent_at').notNullable();
      table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
      table.dateTime('updated_at').notNullable().defaultTo(db.fn.now());
      table.foreign('signup_id', 'fk_subscriptions_signup').references('token').inTable('pending_signups').onDelete('CASCADE');
      table.foreign('restaurant_id', 'fk_subscriptions_restaurant').references('id').inTable('restaurants').onDelete('CASCADE');
    });
  }

  if (!(await db.schema.hasTable('onboarding_progress'))) {
    await db.schema.createTable('onboarding_progress', (table) => {
      table.string('id', 36).primary();
      table.string('restaurant_id', 36).notNullable();
      table.string('staff_id', 36).notNullable();
      table.string('step_key', 40).notNullable();
      table.boolean('required').notNullable().defaultTo(false);
      table.enu('status', ['pending', 'done', 'skipped']).notNullable().defaultTo('pending');
      table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
      table.dateTime('updated_at').notNullable().defaultTo(db.fn.now());
      table.unique(['restaurant_id', 'step_key'], 'uq_onboarding_progress_restaurant_step');
      table.foreign('restaurant_id', 'fk_onboarding_progress_restaurant').references('id').inTable('restaurants').onDelete('CASCADE');
      table.foreign('staff_id', 'fk_onboarding_progress_staff').references('id').inTable('staff').onDelete('CASCADE');
    });
  }

  if (!(await db.schema.hasTable('handoff_codes'))) {
    await db.schema.createTable('handoff_codes', (table) => {
      table.string('signup_id', 64).primary();
      table.string('code_hash', 64).notNullable().unique('uq_handoff_codes_hash');
      table.string('idempotency_key', 128).notNullable();
      table.string('code_nonce', 32).notNullable();
      table.dateTime('expires_at').notNullable();
      table.dateTime('consumed_at').nullable();
      table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
      table.foreign('signup_id', 'fk_handoff_codes_signup').references('token').inTable('pending_signups').onDelete('CASCADE');
      table.index(['expires_at'], 'idx_handoff_codes_expires');
    });
  }
}
