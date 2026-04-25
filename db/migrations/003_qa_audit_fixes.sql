-- ============================================================
-- Migration 003: QA Audit Fixes
-- Addresses: CRIT-9, CRIT-12, CRIT-14, and performance indexes
-- ============================================================

BEGIN;

-- ─── CRIT-14: Make admin_audit_log INSERT-only (tamper protection) ───

-- Drop the permissive "FOR ALL" policy if it exists
DROP POLICY IF EXISTS allow_service_role_admin_audit_log ON admin_audit_log;

-- Create INSERT-only policy for the service role
CREATE POLICY audit_log_insert_only ON admin_audit_log
  FOR INSERT
  WITH CHECK (true);

-- Prevent UPDATE and DELETE at the rule level (belt + suspenders)
CREATE OR REPLACE RULE audit_no_update AS ON UPDATE TO admin_audit_log DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_no_delete AS ON DELETE TO admin_audit_log DO INSTEAD NOTHING;


-- ─── CRIT-12: Add church_id to payments table ───

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'church_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN church_id UUID REFERENCES churches(id);

    -- Backfill from members table
    UPDATE payments p
    SET church_id = m.church_id
    FROM members m
    WHERE p.member_id = m.id AND p.church_id IS NULL;

    CREATE INDEX IF NOT EXISTS payments_church_id_idx ON payments(church_id);
  END IF;
END $$;


-- ─── CRIT-9: Unique email per church constraint ───

-- First deduplicate existing records: keep the earliest per (email, church_id)
-- by soft-deleting duplicates
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(email), church_id
      ORDER BY created_at ASC
    ) AS rn
  FROM members
  WHERE deleted_at IS NULL AND email IS NOT NULL AND email != ''
)
UPDATE members SET deleted_at = NOW()
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Now create the unique index
CREATE UNIQUE INDEX IF NOT EXISTS members_email_church_unique
  ON members(LOWER(email), church_id)
  WHERE deleted_at IS NULL AND email IS NOT NULL AND email != '';


-- ─── Performance indexes ───

CREATE INDEX IF NOT EXISTS payments_member_id_idx ON payments(member_id);
CREATE INDEX IF NOT EXISTS family_members_member_id_idx ON family_members(member_id);
CREATE INDEX IF NOT EXISTS sub_reminders_sub_type_sent_idx
  ON subscription_reminders(subscription_id, reminder_type, sent_at);

-- Active subscription uniqueness per member+plan
CREATE UNIQUE INDEX IF NOT EXISTS active_subscription_per_member_plan
  ON subscriptions(member_id, plan_name)
  WHERE status IN ('active', 'pending_first_payment');


-- ─── Data integrity constraints ───

-- Positive refund amount
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'payment_refunds' AND constraint_name = 'refund_amount_positive'
  ) THEN
    ALTER TABLE payment_refunds ADD CONSTRAINT refund_amount_positive CHECK (refund_amount > 0);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Reasonable family member age
DO $$ BEGIN
  ALTER TABLE family_members ADD CONSTRAINT age_reasonable CHECK (age IS NULL OR (age >= 0 AND age <= 150));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Subscription date ordering
DO $$ BEGIN
  ALTER TABLE subscriptions ADD CONSTRAINT dates_ordered CHECK (next_payment_date >= start_date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


COMMIT;
