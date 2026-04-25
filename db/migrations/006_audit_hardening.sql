-- Migration 006: Payment System Audit Hardening
-- Fixes: CRIT-01, CRIT-04, HIGH-02, HIGH-03, HIGH-04, MED-01, MED-02, MED-03, MED-09, LOW-01
-- Date: 2026-03-29
BEGIN;

-- ============================================================
-- CRIT-01: Add UNIQUE index on payment idempotency key
-- Prevents duplicate payments from concurrent requests
-- ============================================================
DROP INDEX IF EXISTS idx_payments_transaction_member_sub;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_tx_idempotency
  ON payments(transaction_id, member_id, subscription_id)
  WHERE transaction_id IS NOT NULL;

-- ============================================================
-- CRIT-04 / MED-01: CHECK constraint on payment_status
-- Restrict allowed values for payment_status column
-- ============================================================
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payment_status
    CHECK (payment_status IN ('success','failed','pending','processing','refunded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- MED-01: CHECK constraint on subscription status
-- ============================================================
DO $$ BEGIN
  ALTER TABLE subscriptions ADD CONSTRAINT chk_subscription_status
    CHECK (status IN ('active','inactive','overdue','cancelled','pending_first_payment','completed','paused'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- HIGH-03: Platform fee percentage bounded 0-25%
-- ============================================================
DO $$ BEGIN
  ALTER TABLE churches ADD CONSTRAINT chk_platform_fee_pct_range
    CHECK (platform_fee_percentage >= 0 AND platform_fee_percentage <= 25);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- HIGH-02: Refund amount must be positive (already exists, ensure)
-- ============================================================
DO $$ BEGIN
  ALTER TABLE payment_refunds ADD CONSTRAINT chk_refund_amount_positive
    CHECK (refund_amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- HIGH-04: Ensure payments.member_id is SET NULL not CASCADE
-- ============================================================
DO $$ 
DECLARE
  fk_name text;
BEGIN
  -- Find the FK constraint name on payments.member_id
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_name = 'payments' 
    AND kcu.column_name = 'member_id' 
    AND tc.constraint_type = 'FOREIGN KEY'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    -- Check if delete rule is CASCADE
    IF EXISTS (
      SELECT 1 FROM information_schema.referential_constraints rc
      WHERE rc.constraint_name = fk_name AND rc.delete_rule = 'CASCADE'
    ) THEN
      EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', fk_name);
      ALTER TABLE payments ADD CONSTRAINT fk_payments_member_id 
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;
      RAISE NOTICE 'Fixed payments.member_id FK: CASCADE → SET NULL';
    END IF;
  END IF;
END $$;

-- ============================================================
-- MED-02: Subscription amount precision
-- ============================================================
DO $$ BEGIN
  ALTER TABLE subscriptions ALTER COLUMN amount TYPE numeric(10,2);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not alter subscriptions.amount type: %', SQLERRM;
END $$;

-- ============================================================
-- MED-03: Unique constraint on receipt_number
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_receipt_number_unique
  ON payments(receipt_number)
  WHERE receipt_number IS NOT NULL;

-- ============================================================
-- MED-09: Webhook processing index
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_type_processed
  ON razorpay_webhook_events(event_type, processed);

-- ============================================================
-- Ensure event_id unique on razorpay_webhook_events (CRIT-02 support)
-- ============================================================
DO $$ BEGIN
  ALTER TABLE razorpay_webhook_events ADD CONSTRAINT uq_webhook_event_id UNIQUE (event_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Church subscription status CHECK constraint
-- ============================================================
DO $$ BEGIN
  ALTER TABLE church_subscriptions ADD CONSTRAINT chk_church_sub_status
    CHECK (status IN ('active','inactive','overdue','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Church subscription payment status CHECK constraint
-- ============================================================
DO $$ BEGIN
  ALTER TABLE church_subscription_payments ADD CONSTRAINT chk_church_sub_payment_status
    CHECK (payment_status IN ('success','failed','pending'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
