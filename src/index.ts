import { initSentry, Sentry } from "./sentry";
initSentry();

import app from "./app";
import { PORT } from "./config";
import { startScheduledJobs } from "./jobs/scheduler";
import { getClient, pool } from "./services/dbClient";
import { logger } from "./utils/logger";

async function runMigrations() {
  const client = await getClient();
  try {
    // Advisory lock prevents concurrent DDL from multiple ECS tasks
    const lockId = 8675309; // arbitrary constant
    const { rows: lockResult } = await client.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`, [lockId]
    );
    if (!lockResult[0]?.acquired) {
      logger.info("Another instance is running migrations, skipping");
      return;
    }

    try {
    // Create tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        applied_at timestamptz DEFAULT now()
      )
    `);

    const migrations: { name: string; sql: string }[] = [
      {
        name: "018_phone_only_migration",
        sql: `
          -- users: make email truly optional
          ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
          ALTER TABLE users ALTER COLUMN email SET DEFAULT '';

          -- members: make email optional
          ALTER TABLE members ALTER COLUMN email DROP NOT NULL;
          ALTER TABLE members ALTER COLUMN email SET DEFAULT '';

          -- Drop old email+church unique constraint; add phone+church
          DROP INDEX IF EXISTS members_email_church_unique;
          CREATE UNIQUE INDEX IF NOT EXISTS members_phone_church_unique
            ON members(phone_number, church_id)
            WHERE deleted_at IS NULL AND phone_number IS NOT NULL AND phone_number != '';

          -- prayer_requests: make member_email optional, add member_phone
          ALTER TABLE prayer_requests ALTER COLUMN member_email DROP NOT NULL;
          ALTER TABLE prayer_requests ALTER COLUMN member_email SET DEFAULT '';
          DO $$ BEGIN
            ALTER TABLE prayer_requests ADD COLUMN member_phone text DEFAULT '';
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          -- membership_requests: make email optional, add phone
          ALTER TABLE membership_requests ALTER COLUMN email DROP NOT NULL;
          ALTER TABLE membership_requests ALTER COLUMN email SET DEFAULT '';
          DO $$ BEGIN
            ALTER TABLE membership_requests ADD COLUMN phone_number text;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          -- membership_requests: drop old email index, add phone index
          DROP INDEX IF EXISTS membership_requests_church_email_pending_idx;
          CREATE UNIQUE INDEX IF NOT EXISTS membership_requests_church_phone_pending_idx
            ON membership_requests(church_id, phone_number)
            WHERE status = 'pending' AND phone_number IS NOT NULL AND phone_number != '';

          -- admin_audit_log: add actor_phone
          DO $$ BEGIN
            ALTER TABLE admin_audit_log ADD COLUMN actor_phone text;
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;

          -- scheduled_reports: add recipient_phones
          DO $$ BEGIN
            ALTER TABLE scheduled_reports ADD COLUMN recipient_phones text[] NOT NULL DEFAULT '{}';
          EXCEPTION WHEN duplicate_column THEN NULL;
          END $$;
        `,
      },
      {
        name: "017_payments_fund_name",
        sql: `ALTER TABLE payments ADD COLUMN IF NOT EXISTS fund_name text;`,
      },
      {
        name: "016_donation_funds",
        sql: `
          CREATE TABLE IF NOT EXISTS donation_funds (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
            name text NOT NULL,
            description text,
            is_active boolean NOT NULL DEFAULT true,
            sort_order int NOT NULL DEFAULT 0,
            created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
          );
          CREATE INDEX IF NOT EXISTS idx_donation_funds_church ON donation_funds(church_id);
          CREATE INDEX IF NOT EXISTS idx_donation_funds_active ON donation_funds(church_id, is_active) WHERE is_active = true;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_donation_funds_name ON donation_funds(church_id, LOWER(name));
        `,
      },
      {
        name: "015_member_special_dates",
        sql: `
          CREATE TABLE IF NOT EXISTS member_special_dates (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
            occasion_type text NOT NULL CHECK (occasion_type IN ('birthday', 'anniversary')),
            occasion_date date NOT NULL,
            person_name text NOT NULL,
            spouse_name text,
            notes text,
            is_from_profile boolean NOT NULL DEFAULT false,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
          );
          CREATE INDEX IF NOT EXISTS idx_special_dates_church ON member_special_dates(church_id);
          CREATE INDEX IF NOT EXISTS idx_special_dates_member ON member_special_dates(member_id);
          CREATE INDEX IF NOT EXISTS idx_special_dates_church_date ON member_special_dates(church_id, occasion_date);
          CREATE INDEX IF NOT EXISTS idx_special_dates_month_day ON member_special_dates(church_id, (EXTRACT(MONTH FROM occasion_date)), (EXTRACT(DAY FROM occasion_date)));
          CREATE UNIQUE INDEX IF NOT EXISTS idx_special_dates_unique
            ON member_special_dates(member_id, occasion_type, occasion_date, person_name)
            WHERE is_from_profile = false;
        `,
      },
      {
        name: "014_missing_columns_fix",
        sql: `
          -- Fix: Ensure columns needed by adBannerService & engagementService exist
          -- (file-based migrations may have added these, but fresh deploys could miss them)
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image';
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS position text NOT NULL DEFAULT 'bottom';
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS start_date date DEFAULT NULL;
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS end_date date DEFAULT NULL;
          ALTER TABLE church_events ADD COLUMN IF NOT EXISTS image_url text;
          ALTER TABLE church_events ADD COLUMN IF NOT EXISTS updated_at timestamptz;
          ALTER TABLE church_notifications ADD COLUMN IF NOT EXISTS image_url text;
          ALTER TABLE church_notifications ADD COLUMN IF NOT EXISTS updated_at timestamptz;
        `,
      },
      {
        name: "013_refresh_tokens",
        sql: `
          CREATE TABLE IF NOT EXISTS refresh_tokens (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash text NOT NULL,
            expires_at timestamptz NOT NULL,
            revoked boolean NOT NULL DEFAULT false,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
          );
          CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
          CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE revoked = false;

          CREATE OR REPLACE FUNCTION update_updated_at_column()
          RETURNS TRIGGER AS $t$
          BEGIN NEW.updated_at = now(); RETURN NEW; END;
          $t$ LANGUAGE plpgsql;

          DROP TRIGGER IF EXISTS refresh_tokens_updated_at ON refresh_tokens;
          CREATE TRIGGER refresh_tokens_updated_at
            BEFORE UPDATE ON refresh_tokens
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `,
      },
      {
        name: "012_other_role_custom_fields",
        sql: `
          INSERT INTO leadership_roles (name, hierarchy_level, is_pastor_role, description)
          VALUES ('Other', 10, false, 'Custom role with user-defined name and level')
          ON CONFLICT (name) DO NOTHING;

          ALTER TABLE church_leadership ADD COLUMN IF NOT EXISTS custom_role_name text;
          ALTER TABLE church_leadership ADD COLUMN IF NOT EXISTS custom_hierarchy_level integer;
        `,
      },
      {
        name: "011_diocese_logos_array",
        sql: `ALTER TABLE dioceses ADD COLUMN IF NOT EXISTS logo_urls text[] NOT NULL DEFAULT '{}';`,
      },
      {
        name: "010_committee_sexton_roles",
        sql: `
          INSERT INTO leadership_roles (name, hierarchy_level, is_pastor_role, description)
          VALUES
            ('Committee Member', 8, false, 'Church Committee Member'),
            ('Sexton',           9, false, 'Church Sexton — Facility & Property Caretaker')
          ON CONFLICT (name) DO NOTHING;
        `,
      },
      {
        name: "009_diocese_media_and_ads",
        sql: `
          -- Diocese logo / banner
          ALTER TABLE dioceses ADD COLUMN IF NOT EXISTS logo_url text;
          ALTER TABLE dioceses ADD COLUMN IF NOT EXISTS banner_url text;

          -- Footer ad banners
          CREATE TABLE IF NOT EXISTS ad_banners (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            scope text NOT NULL CHECK (scope IN ('diocese', 'church')),
            scope_id uuid NOT NULL,
            image_url text NOT NULL,
            link_url text,
            sort_order int NOT NULL DEFAULT 0,
            is_active boolean NOT NULL DEFAULT true,
            created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
          );
          CREATE INDEX IF NOT EXISTS ad_banners_scope_idx ON ad_banners(scope, scope_id) WHERE is_active = true;

          -- Columns needed by adBannerService (were in file-based migrations)
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image';
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS position text NOT NULL DEFAULT 'bottom';
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS start_date date DEFAULT NULL;
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS end_date date DEFAULT NULL;

          -- Columns needed by engagementService (events/notifications CRUD)
          ALTER TABLE church_events ADD COLUMN IF NOT EXISTS image_url text;
          ALTER TABLE church_events ADD COLUMN IF NOT EXISTS updated_at timestamptz;
          ALTER TABLE church_notifications ADD COLUMN IF NOT EXISTS image_url text;
          ALTER TABLE church_notifications ADD COLUMN IF NOT EXISTS updated_at timestamptz;
        `,
      },
      {
        name: "008_diocese",
        sql: `
          -- Diocese groups
          CREATE TABLE IF NOT EXISTS dioceses (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            name text NOT NULL,
            created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
          );
          CREATE UNIQUE INDEX IF NOT EXISTS dioceses_name_unique ON dioceses(LOWER(name));

          -- Diocese ↔ Church mapping (each church belongs to at most one diocese)
          CREATE TABLE IF NOT EXISTS diocese_churches (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            diocese_id uuid NOT NULL REFERENCES dioceses(id) ON DELETE CASCADE,
            church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
            added_at timestamptz DEFAULT now(),
            UNIQUE(church_id)
          );
          CREATE INDEX IF NOT EXISTS diocese_churches_diocese_idx ON diocese_churches(diocese_id);

          -- Diocese-level leadership
          CREATE TABLE IF NOT EXISTS diocese_leadership (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            diocese_id uuid NOT NULL REFERENCES dioceses(id) ON DELETE CASCADE,
            role text NOT NULL,
            full_name text NOT NULL,
            phone_number text,
            email text,
            bio text,
            photo_url text,
            is_active boolean NOT NULL DEFAULT true,
            assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
          );
          CREATE INDEX IF NOT EXISTS diocese_leadership_diocese_active_idx
            ON diocese_leadership(diocese_id, is_active) WHERE is_active = true;
          CREATE UNIQUE INDEX IF NOT EXISTS diocese_leadership_unique_active_role
            ON diocese_leadership(diocese_id, role, full_name) WHERE is_active = true;
        `,
      },
      {
        name: "007_platform_config",
        sql: `
          CREATE TABLE IF NOT EXISTS platform_config (
            id text PRIMARY KEY DEFAULT 'default',
            razorpay_key_id text,
            razorpay_key_secret text,
            updated_at timestamptz DEFAULT now()
          );
          INSERT INTO platform_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
        `,
      },
      {
        name: "006_church_logo",
        sql: `ALTER TABLE churches ADD COLUMN IF NOT EXISTS logo_url text;`,
      },
      {
        name: "005_prayer_leadership",
        sql: `
          ALTER TABLE prayer_request_recipients ADD COLUMN IF NOT EXISTS leader_id uuid;
          ALTER TABLE prayer_request_recipients DROP CONSTRAINT IF EXISTS prayer_request_recipients_pastor_id_fkey;
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prayer_request_recipients_leader_id_fkey') THEN
              ALTER TABLE prayer_request_recipients
                ADD CONSTRAINT prayer_request_recipients_leader_id_fkey
                FOREIGN KEY (leader_id) REFERENCES church_leadership(id) ON DELETE CASCADE;
            END IF;
          END $$;
          ALTER TABLE prayer_request_recipients ALTER COLUMN pastor_id DROP NOT NULL;
          CREATE INDEX IF NOT EXISTS prayer_request_recipients_leader_idx ON prayer_request_recipients(leader_id);
        `,
      },
      {
        name: "003_qa_audit_fixes",
        sql: `
          -- CRIT-14: Make admin_audit_log INSERT-only
          DROP POLICY IF EXISTS allow_service_role_admin_audit_log ON admin_audit_log;
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'audit_log_insert_only' AND tablename = 'admin_audit_log') THEN
              CREATE POLICY audit_log_insert_only ON admin_audit_log FOR INSERT WITH CHECK (true);
            END IF;
          EXCEPTION WHEN OTHERS THEN NULL;
          END $$;
          CREATE OR REPLACE RULE audit_no_update AS ON UPDATE TO admin_audit_log DO INSTEAD NOTHING;
          CREATE OR REPLACE RULE audit_no_delete AS ON DELETE TO admin_audit_log DO INSTEAD NOTHING;

          -- CRIT-12: Add church_id to payments table
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'payments' AND column_name = 'church_id'
            ) THEN
              ALTER TABLE payments ADD COLUMN church_id UUID REFERENCES churches(id);
              UPDATE payments p SET church_id = m.church_id FROM members m WHERE p.member_id = m.id AND p.church_id IS NULL;
              CREATE INDEX IF NOT EXISTS payments_church_id_idx ON payments(church_id);
            END IF;
          END $$;

          -- CRIT-9: Unique email per church constraint
          -- Deduplicate existing records first
          WITH duplicates AS (
            SELECT id,
              ROW_NUMBER() OVER (PARTITION BY LOWER(email), church_id ORDER BY created_at ASC) AS rn
            FROM members
            WHERE deleted_at IS NULL AND email IS NOT NULL AND email != ''
          )
          UPDATE members SET deleted_at = NOW()
          WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

          CREATE UNIQUE INDEX IF NOT EXISTS members_email_church_unique
            ON members(LOWER(email), church_id)
            WHERE deleted_at IS NULL AND email IS NOT NULL AND email != '';

          -- Performance indexes
          CREATE INDEX IF NOT EXISTS payments_member_id_idx ON payments(member_id);
          CREATE INDEX IF NOT EXISTS family_members_member_id_idx ON family_members(member_id);
          CREATE INDEX IF NOT EXISTS sub_reminders_sub_type_sent_idx
            ON subscription_reminders(subscription_id, reminder_type, sent_at);

          -- Active subscription uniqueness per member+plan
          CREATE UNIQUE INDEX IF NOT EXISTS active_subscription_per_member_plan
            ON subscriptions(member_id, plan_name)
            WHERE status IN ('active', 'pending_first_payment');

          -- Data integrity constraints
          DO $$ BEGIN
            ALTER TABLE payment_refunds ADD CONSTRAINT refund_amount_positive CHECK (refund_amount > 0);
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE family_members ADD CONSTRAINT age_reasonable CHECK (age IS NULL OR (age >= 0 AND age <= 150));
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          DO $$ BEGIN
            ALTER TABLE subscriptions ADD CONSTRAINT dates_ordered CHECK (next_payment_date >= start_date);
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `,
      },
      {
        name: "004_rpc_subscription_update_guard",
        sql: `
          -- Fix: Add IF NOT FOUND guard to subscription UPDATE in batch payment RPC
          CREATE OR REPLACE FUNCTION process_subscription_payments_batch(
            p_member_id UUID,
            p_transaction_id TEXT,
            p_payment_date TIMESTAMPTZ,
            p_items JSONB
          )
          RETURNS JSONB
          LANGUAGE plpgsql
          AS $fn$
          DECLARE
            v_item JSONB;
            v_payment_id UUID;
            v_receipt TEXT;
            v_church_id UUID;
            v_results JSONB := '[]'::JSONB;
            v_sub_id UUID;
            v_amount NUMERIC;
            v_new_status TEXT;
            v_new_next TEXT;
            v_old_status TEXT;
            v_receipt_number TEXT;
            v_is_adjustment BOOLEAN;
            v_existing_id UUID;
            v_existing_receipt TEXT;
          BEGIN
            SELECT church_id INTO v_church_id FROM members WHERE id = p_member_id;

            FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
            LOOP
              v_sub_id        := (v_item->>'subscription_id')::UUID;
              v_amount        := (v_item->>'amount')::NUMERIC;
              v_receipt_number := v_item->>'receipt_number';
              v_new_status    := v_item->>'new_status';
              v_new_next      := v_item->>'new_next_payment_date';
              v_old_status    := v_item->>'old_status';
              v_is_adjustment := COALESCE((v_item->>'is_adjustment')::BOOLEAN, FALSE);

              SELECT id, receipt_number INTO v_existing_id, v_existing_receipt
              FROM payments
              WHERE transaction_id = p_transaction_id
                AND member_id = p_member_id
                AND subscription_id = v_sub_id
              LIMIT 1;

              IF v_existing_id IS NOT NULL THEN
                v_results := v_results || jsonb_build_object(
                  'payment_id', v_existing_id,
                  'receipt_number', v_existing_receipt,
                  'subscription_id', v_sub_id,
                  'already_existed', TRUE,
                  'next_payment_date', v_new_next
                );
                CONTINUE;
              END IF;

              INSERT INTO payments (
                member_id, subscription_id, church_id, amount, payment_method,
                transaction_id, payment_status, payment_date,
                receipt_number, receipt_generated_at
              ) VALUES (
                p_member_id, v_sub_id, v_church_id, v_amount, 'subscription_paynow',
                p_transaction_id, 'success', p_payment_date,
                v_receipt_number, NOW()
              )
              RETURNING id, receipt_number INTO v_payment_id, v_receipt;

              UPDATE subscriptions
              SET status = v_new_status,
                  next_payment_date = v_new_next::DATE
              WHERE id = v_sub_id
                AND member_id = p_member_id;

              IF NOT FOUND THEN
                RAISE EXCEPTION 'Subscription % not found or does not belong to member %', v_sub_id, p_member_id;
              END IF;

              INSERT INTO subscription_events (
                member_id, subscription_id, church_id, event_type,
                status_after, amount, source, metadata, event_at
              ) VALUES (
                p_member_id, v_sub_id, v_church_id, 'payment_recorded',
                'success', v_amount, 'payment_gateway',
                jsonb_build_object(
                  'payment_method', 'subscription_paynow',
                  'transaction_id', p_transaction_id,
                  'payment_date', p_payment_date::TEXT,
                  'receipt_number', COALESCE(v_receipt, v_receipt_number)
                ),
                NOW()
              );

              INSERT INTO subscription_events (
                member_id, subscription_id, church_id, event_type,
                status_before, status_after, amount, source, metadata, event_at
              ) VALUES (
                p_member_id, v_sub_id, v_church_id, 'subscription_due_paid',
                v_old_status, v_new_status, v_amount, 'payment_gateway',
                jsonb_build_object(
                  'paid_via', 'pay_now',
                  'next_payment_date', v_new_next,
                  'transaction_id', p_transaction_id,
                  'is_adjustment', v_is_adjustment
                ),
                NOW()
              );

              v_results := v_results || jsonb_build_object(
                'payment_id', v_payment_id,
                'receipt_number', COALESCE(v_receipt, v_receipt_number),
                'subscription_id', v_sub_id,
                'already_existed', FALSE,
                'next_payment_date', v_new_next
              );
            END LOOP;

            RETURN jsonb_build_object(
              'success', TRUE,
              'payment_count', jsonb_array_length(v_results),
              'results', v_results
            );
          END;
          $fn$;
        `,
      },
      {
        name: "019_public_donation_fee_config",
        sql: `
          ALTER TABLE platform_config
            ADD COLUMN IF NOT EXISTS public_donation_fee_percent numeric(5,2) NOT NULL DEFAULT 5.00;
        `,
      },
      {
        name: "020_subscription_monthly_ledger",
        sql: `
          CREATE TABLE IF NOT EXISTS subscription_monthly_dues (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
            member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
            due_month date NOT NULL,
            status text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'paid', 'imported_paid')),
            paid_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
            source text NOT NULL DEFAULT 'system',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (subscription_id, due_month)
          );
          CREATE INDEX IF NOT EXISTS idx_subscription_monthly_dues_subscription
            ON subscription_monthly_dues(subscription_id, due_month);
          CREATE INDEX IF NOT EXISTS idx_subscription_monthly_dues_member
            ON subscription_monthly_dues(member_id, due_month DESC);
          CREATE INDEX IF NOT EXISTS idx_subscription_monthly_dues_church
            ON subscription_monthly_dues(church_id, due_month DESC);
          CREATE INDEX IF NOT EXISTS idx_subscription_monthly_dues_pending
            ON subscription_monthly_dues(subscription_id, status, due_month)
            WHERE status = 'pending';

          CREATE TABLE IF NOT EXISTS payment_month_allocations (
            id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
            subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
            member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
            covered_month date NOT NULL,
            monthly_amount numeric NOT NULL,
            person_name text,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (subscription_id, covered_month),
            UNIQUE (payment_id, covered_month)
          );
          CREATE INDEX IF NOT EXISTS idx_payment_month_allocations_member
            ON payment_month_allocations(member_id, covered_month DESC);
          CREATE INDEX IF NOT EXISTS idx_payment_month_allocations_payment
            ON payment_month_allocations(payment_id);
          CREATE INDEX IF NOT EXISTS idx_payment_month_allocations_subscription
            ON payment_month_allocations(subscription_id, covered_month DESC);

          CREATE OR REPLACE FUNCTION update_subscription_monthly_dues_updated_at()
          RETURNS trigger AS $$
          BEGIN NEW.updated_at = now(); RETURN NEW; END;
          $$ LANGUAGE plpgsql;

          DROP TRIGGER IF EXISTS trg_subscription_monthly_dues_updated_at ON subscription_monthly_dues;
          CREATE TRIGGER trg_subscription_monthly_dues_updated_at
          BEFORE UPDATE ON subscription_monthly_dues
          FOR EACH ROW EXECUTE FUNCTION update_subscription_monthly_dues_updated_at();
        `,
      },
      {
        name: "021_payment_allocations_due_id",
        sql: `
          ALTER TABLE payment_month_allocations
            ADD COLUMN IF NOT EXISTS due_id uuid REFERENCES subscription_monthly_dues(id) ON DELETE SET NULL;
          CREATE INDEX IF NOT EXISTS idx_payment_month_allocations_due_id
            ON payment_month_allocations(due_id);
        `,
      },
      {
        name: "028_schema_hardening_razorpay_cleanup",
        sql: `
          -- Drop old per-church Razorpay API key columns (Razorpay Routes model replaces them)
          ALTER TABLE churches DROP COLUMN IF EXISTS razorpay_key_id;
          ALTER TABLE churches DROP COLUMN IF EXISTS razorpay_key_secret;

          -- RLS on payment_refunds
          ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS payment_refunds_tenant ON payment_refunds;
          CREATE POLICY payment_refunds_tenant ON payment_refunds
            USING (church_id::text = current_setting('app.church_id', true));

          -- Backfill payments.church_id NULLs then enforce NOT NULL
          UPDATE payments p
          SET church_id = m.church_id
          FROM members m
          WHERE p.member_id = m.id AND p.church_id IS NULL AND m.church_id IS NOT NULL;

          DO $$ BEGIN
            ALTER TABLE payments ALTER COLUMN church_id SET NOT NULL;
          EXCEPTION WHEN others THEN NULL;
          END $$;

          -- Partial unique: one active subscription per member+plan+church
          CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_active_member_plan
            ON subscriptions(member_id, plan_name, church_id)
            WHERE status NOT IN ('cancelled', 'expired');

          -- Per-church unique on pastors.email (replace broken global unique)
          DO $$ BEGIN
            ALTER TABLE pastors DROP CONSTRAINT IF EXISTS pastors_email_key;
          EXCEPTION WHEN others THEN NULL;
          END $$;
          DROP INDEX IF EXISTS pastors_email_key;
          CREATE UNIQUE INDEX IF NOT EXISTS uq_pastors_email_per_church
            ON pastors(church_id, email)
            WHERE email IS NOT NULL AND deleted_at IS NULL;

          -- Performance indexes
          CREATE INDEX IF NOT EXISTS idx_prayer_requests_church_created
            ON prayer_requests(church_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_announcements_church_created
            ON announcements(church_id, created_at DESC)
            WHERE deleted_at IS NULL;
          CREATE INDEX IF NOT EXISTS idx_payments_member_date
            ON payments(member_id, payment_date DESC);
          CREATE INDEX IF NOT EXISTS idx_payment_refunds_church
            ON payment_refunds(church_id);
          CREATE INDEX IF NOT EXISTS idx_payment_transfers_razorpay_id
            ON payment_transfers(razorpay_transfer_id)
            WHERE razorpay_transfer_id IS NOT NULL;
        `,
      },
      {
        name: "029_systemic_audit_fixes",
        sql: `
          -- Universal soft-delete: add deleted_at to entities that currently hard-delete
          ALTER TABLE dioceses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
          ALTER TABLE donation_funds ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
          ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
          ALTER TABLE church_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
          ALTER TABLE announcements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

          -- Partial indexes for soft-delete filtering
          CREATE INDEX IF NOT EXISTS idx_dioceses_not_deleted ON dioceses (id) WHERE deleted_at IS NULL;
          CREATE INDEX IF NOT EXISTS idx_donation_funds_not_deleted ON donation_funds (church_id) WHERE deleted_at IS NULL;
          CREATE INDEX IF NOT EXISTS idx_ad_banners_not_deleted ON ad_banners (scope, scope_id) WHERE deleted_at IS NULL;
          CREATE INDEX IF NOT EXISTS idx_church_events_not_deleted ON church_events (church_id) WHERE deleted_at IS NULL;
          CREATE INDEX IF NOT EXISTS idx_announcements_not_deleted ON announcements (church_id) WHERE deleted_at IS NULL;

          -- SaaS enforcement support
          ALTER TABLE churches ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT NULL;
          CREATE INDEX IF NOT EXISTS idx_churches_trial_ends_at ON churches (trial_ends_at) WHERE trial_ends_at IS NOT NULL AND deleted_at IS NULL;
          CREATE INDEX IF NOT EXISTS idx_church_subscriptions_enforcement ON church_subscriptions (status, next_payment_date) WHERE status IN ('active', 'overdue');
        `,
      },
      {
        name: "030_refund_webhook_support",
        sql: `
          ALTER TABLE payment_refunds
            ADD COLUMN IF NOT EXISTS razorpay_refund_id TEXT DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS refund_status TEXT DEFAULT 'processed';

          CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_refunds_razorpay_id
            ON payment_refunds(razorpay_refund_id)
            WHERE razorpay_refund_id IS NOT NULL;
        `,
      },
      {
        name: "031_saas_payment_hardening",
        sql: `
          CREATE UNIQUE INDEX IF NOT EXISTS church_subscription_payments_txn_unique
            ON church_subscription_payments(transaction_id)
            WHERE transaction_id IS NOT NULL;

          CREATE TABLE IF NOT EXISTS church_subscription_pending_orders (
            razorpay_order_id text PRIMARY KEY,
            church_subscription_id uuid NOT NULL REFERENCES church_subscriptions(id) ON DELETE CASCADE,
            church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
            expected_amount numeric(12,2) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            reconciled_at timestamptz
          );

          CREATE INDEX IF NOT EXISTS church_subscription_pending_orders_church_idx
            ON church_subscription_pending_orders(church_id, created_at DESC);

          CREATE TABLE IF NOT EXISTS web_handoff_tokens (
            jti uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            church_id uuid REFERENCES churches(id) ON DELETE SET NULL,
            purpose text NOT NULL,
            expires_at timestamptz NOT NULL,
            consumed_at timestamptz,
            consumed_ip text,
            created_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE INDEX IF NOT EXISTS web_handoff_tokens_user_idx
            ON web_handoff_tokens(user_id, created_at DESC);

          CREATE INDEX IF NOT EXISTS web_handoff_tokens_expiry_idx
            ON web_handoff_tokens(expires_at)
            WHERE consumed_at IS NULL;
        `,
      },
      {
        name: "032_native_push_tokens",
        sql: `
          ALTER TABLE push_subscriptions
            ADD COLUMN IF NOT EXISTS platform text DEFAULT 'web';

          DO $$ BEGIN
            ALTER TABLE push_subscriptions
              ADD CONSTRAINT push_subscriptions_platform_check
              CHECK (platform IN ('web', 'ios', 'android'));
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;

          ALTER TABLE push_subscriptions
            ALTER COLUMN p256dh DROP NOT NULL,
            ALTER COLUMN auth DROP NOT NULL;

          ALTER TABLE push_subscriptions
            ADD COLUMN IF NOT EXISTS app_id text;

          CREATE INDEX IF NOT EXISTS idx_push_subscriptions_platform
            ON push_subscriptions(platform)
            WHERE platform IN ('ios', 'android');
        `,
      },
      {
        name: "033_payment_uniqueness_and_indexes",
        sql: `
          -- 1) Payment uniqueness: replace single-col UNIQUE(transaction_id) with composite partials
          ALTER TABLE payments
            DROP CONSTRAINT IF EXISTS uq_payments_transaction_id;

          CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_txn_sub
            ON payments (transaction_id, subscription_id)
            WHERE transaction_id IS NOT NULL AND subscription_id IS NOT NULL;

          CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_txn_nosub
            ON payments (transaction_id)
            WHERE transaction_id IS NOT NULL AND subscription_id IS NULL;

          -- 2) Subscription reminder dedup (one per subscription+type per UTC day)
          -- date_trunc on timestamptz is STABLE; index expressions require IMMUTABLE.
          CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_reminders_daily
            ON subscription_reminders (subscription_id, reminder_type, ((sent_at AT TIME ZONE 'UTC')::date))
            WHERE subscription_id IS NOT NULL;

          -- 3) Membership request approval race
          CREATE INDEX IF NOT EXISTS ix_membership_requests_status
            ON membership_requests (status);

          -- 4) Scalability indexes
          CREATE INDEX IF NOT EXISTS ix_subscriptions_status_next_due
            ON subscriptions (status, next_payment_date)
            WHERE status IN ('active', 'overdue', 'pending_first_payment');

          CREATE INDEX IF NOT EXISTS ix_members_church_name
            ON members (church_id, full_name)
            WHERE deleted_at IS NULL;

          CREATE INDEX IF NOT EXISTS ix_payments_member_date
            ON payments (member_id, payment_date DESC);

          CREATE INDEX IF NOT EXISTS ix_audit_logs_church_time
            ON audit_logs (church_id, created_at DESC);

          -- 5) Job failures DLQ
          CREATE TABLE IF NOT EXISTS job_failures (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            job_name TEXT NOT NULL,
            job_type TEXT,
            payload JSONB,
            last_error TEXT,
            attempt_count INT NOT NULL DEFAULT 0,
            first_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at TIMESTAMPTZ,
            resolved_by UUID,
            resolution_note TEXT
          );

          CREATE INDEX IF NOT EXISTS ix_job_failures_unresolved
            ON job_failures (first_failed_at DESC)
            WHERE resolved_at IS NULL;

          -- 6) Account recovery email fallback
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS recovery_email TEXT,
            ADD COLUMN IF NOT EXISTS recovery_email_verified_at TIMESTAMPTZ;

          CREATE INDEX IF NOT EXISTS ix_users_recovery_email
            ON users (lower(recovery_email))
            WHERE recovery_email IS NOT NULL;

          -- 7) Trial grant history
          CREATE TABLE IF NOT EXISTS trial_grant_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
            trial_days INT NOT NULL,
            granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            granted_by UUID,
            expires_at TIMESTAMPTZ NOT NULL,
            reason TEXT
          );

          CREATE INDEX IF NOT EXISTS ix_trial_grant_history_church
            ON trial_grant_history (church_id, granted_at DESC);

          -- 8) Push notification idempotency
          ALTER TABLE church_notifications
            ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

          CREATE UNIQUE INDEX IF NOT EXISTS uq_church_notifications_idempotency
            ON church_notifications (idempotency_key)
            WHERE idempotency_key IS NOT NULL;

          ALTER TABLE notification_batches
            ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

          CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_batches_idempotency
            ON notification_batches (idempotency_key)
            WHERE idempotency_key IS NOT NULL;

          -- 9) Subscription paused status
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'subscriptions_status_check'
            ) THEN
              ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_status_check;
            END IF;
            ALTER TABLE subscriptions
              ADD CONSTRAINT subscriptions_status_check
              CHECK (status IN ('active', 'overdue', 'cancelled', 'expired', 'pending_first_payment', 'paused'));
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END $$;

          -- 10) OTP rate-limit table
          CREATE TABLE IF NOT EXISTS otp_rate_limits (
            key TEXT PRIMARY KEY,
            window_start TIMESTAMPTZ NOT NULL,
            request_count INT NOT NULL DEFAULT 0,
            last_request_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );

          CREATE INDEX IF NOT EXISTS ix_otp_rate_limits_window
            ON otp_rate_limits (window_start);

          -- 11) SaaS pending orders unique razorpay_order_id
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_indexes
              WHERE tablename = 'church_subscription_pending_orders'
                AND indexname = 'uq_saas_pending_order_id'
            ) THEN
              CREATE UNIQUE INDEX uq_saas_pending_order_id
                ON church_subscription_pending_orders (razorpay_order_id);
            END IF;
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END $$;

          -- 12) Church legal/tax fields for receipts
          ALTER TABLE churches
            ADD COLUMN IF NOT EXISTS legal_name TEXT,
            ADD COLUMN IF NOT EXISTS tax_80g_registration_number TEXT,
            ADD COLUMN IF NOT EXISTS pan_number TEXT,
            ADD COLUMN IF NOT EXISTS gstin TEXT,
            ADD COLUMN IF NOT EXISTS receipt_signatory_name TEXT,
            ADD COLUMN IF NOT EXISTS receipt_signatory_title TEXT,
            ADD COLUMN IF NOT EXISTS registered_address TEXT,
            ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

          -- 13) Refresh token suspicious flag
          ALTER TABLE refresh_tokens
            ADD COLUMN IF NOT EXISTS suspicious_at TIMESTAMPTZ;

          -- 14) Prayer request anonymity
          ALTER TABLE prayer_requests
            ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;
        `,
      },
    ];

    for (const m of migrations) {
      const { rowCount } = await client.query(
        `SELECT 1 FROM _migrations WHERE name = $1`,
        [m.name]
      );
      if (rowCount === 0) {
        logger.info(`Running migration: ${m.name}`);
        await client.query("BEGIN");
        await client.query(m.sql);
        await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [m.name]);
        await client.query("COMMIT");
        logger.info(`Migration ${m.name} applied.`);
      }
    }
    } finally {
      // Release advisory lock
      await client.query(`SELECT pg_advisory_unlock($1)`, [lockId]).catch(() => {});
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.fatal({ err }, "Migration failed — aborting startup");
    process.exit(1);
  } finally {
    client.release();
  }
}

runMigrations().then(() => {
  const server = app.listen(PORT, () => {
    logger.info(`Church backend API running on http://localhost:${PORT}`);
    startScheduledJobs();
  });

  // ── Graceful Shutdown ──────────────────────────────────────────────
  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Received shutdown signal, draining connections…");

    // Stop accepting new connections
    server.close(() => {
      logger.info("HTTP server closed");
    });

    // Give in-flight requests time to finish, then force-close
    const forceTimeout = setTimeout(() => {
      logger.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 30_000);
    forceTimeout.unref();

    try {
      await pool.end();
      logger.info("Database pool drained");
    } catch (err) {
      logger.error({ err }, "Error draining database pool");
    }

    clearTimeout(forceTimeout);
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection — initiating shutdown");
    gracefulShutdown("unhandledRejection");
  });

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — initiating shutdown");
    gracefulShutdown("uncaughtException");
  });
});
