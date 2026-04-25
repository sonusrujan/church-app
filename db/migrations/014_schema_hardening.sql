-- Migration 014: Schema Hardening
-- Adds updated_at columns, composite indexes, membership_id unique constraint, refund_id back-reference

BEGIN;

-- ============================================================
-- 1. Add updated_at columns with auto-update triggers
-- ============================================================

-- Generic trigger function (create if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper to add updated_at + trigger to a table
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'churches', 'users', 'members', 'subscriptions', 'payments',
    'pastors', 'prayer_requests', 'membership_requests',
    'cancellation_requests', 'family_members',
    'family_member_requests', 'family_member_create_requests',
    'refund_requests'
  ] LOOP
    -- Add column if not exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = tbl AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN updated_at timestamptz DEFAULT now()', tbl);
    END IF;

    -- Create trigger if not exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.triggers
      WHERE event_object_table = tbl AND trigger_name = 'trg_' || tbl || '_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
        tbl, tbl
      );
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 2. Composite indexes for common query patterns
-- ============================================================

-- Members by church + verification status (admin filtering)
CREATE INDEX IF NOT EXISTS idx_members_church_verification
  ON members (church_id, verification_status)
  WHERE deleted_at IS NULL;

-- Payments by church + status (admin reporting)
CREATE INDEX IF NOT EXISTS idx_payments_church_status
  ON payments (church_id, payment_status);

-- Subscriptions by church + status (admin overview)
CREATE INDEX IF NOT EXISTS idx_subscriptions_church_status
  ON subscriptions (church_id, status);

-- Members by church + phone (phone lookups)
CREATE INDEX IF NOT EXISTS idx_members_church_phone
  ON members (church_id, phone_number)
  WHERE deleted_at IS NULL AND phone_number IS NOT NULL;

-- ============================================================
-- 3. Unique membership_id per church
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_membership_id_church_unique
  ON members (membership_id, church_id)
  WHERE membership_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- 4. Add refund_id back-reference on payments (optional link)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'refund_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN refund_id uuid REFERENCES payment_refunds(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_payments_refund_id ON payments (refund_id) WHERE refund_id IS NOT NULL;
  END IF;
END;
$$;

COMMIT;
