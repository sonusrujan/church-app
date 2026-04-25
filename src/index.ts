import app from "./app";
import { PORT } from "./config";
import { startScheduledJobs } from "./jobs/scheduler";
import { getClient, pool } from "./services/dbClient";
import { logger } from "./utils/logger";

async function runMigrations() {
  const client = await getClient();
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
});
