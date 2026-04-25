-- ============================================================
-- Migration 004: Additional QA Fixes
-- Addresses: PERF indexes, EDGE-1 failed webhook tracking,
--            payment method enum, event date validation
-- ============================================================

BEGIN;

-- ─── Additional Performance Indexes ───

-- Index for subscription status lookups (used in self-heal, reminder queries)
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions(status)
  WHERE deleted_at IS NULL;

-- Index for subscription member lookups
CREATE INDEX IF NOT EXISTS subscriptions_member_id_idx ON subscriptions(member_id)
  WHERE deleted_at IS NULL;

-- Index for payment date range queries (analytics)
CREATE INDEX IF NOT EXISTS payments_date_church_idx ON payments(church_id, payment_date);

-- Index for audit log queries by church + date
CREATE INDEX IF NOT EXISTS audit_log_church_created_idx
  ON admin_audit_log(church_id, created_at DESC);

-- ─── EDGE-1: Track failed webhook event processing ───

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'razorpay_webhook_events' AND column_name = 'processing_status'
  ) THEN
    ALTER TABLE razorpay_webhook_events
      ADD COLUMN processing_status TEXT DEFAULT 'pending',
      ADD COLUMN processing_error TEXT,
      ADD COLUMN processed_at TIMESTAMPTZ;
  END IF;
END $$;

-- ─── PAY-17: Payment method check constraint ───

DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payment_method_valid
    CHECK (payment_method IS NULL OR payment_method IN (
      'cash', 'cheque', 'bank_transfer', 'upi', 'card', 'razorpay',
      'subscription_paynow', 'other'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
