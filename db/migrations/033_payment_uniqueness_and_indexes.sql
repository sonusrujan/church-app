-- Migration 033: Fix payment uniqueness for multi-subscription payments,
-- add scalability indexes, and add race-safe constraints for approvals and reminders.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) PAYMENT UNIQUENESS
-- The old single-column UNIQUE(transaction_id) constraint prevents legitimate
-- multi-subscription payments (same Razorpay payment_id covering two
-- subscriptions produces two rows). Replace with composite partial uniques.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS uq_payments_transaction_id;

-- One transaction_id may appear at most once per (subscription_id NULL or not).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_txn_sub
  ON payments (transaction_id, subscription_id)
  WHERE transaction_id IS NOT NULL AND subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_txn_nosub
  ON payments (transaction_id)
  WHERE transaction_id IS NOT NULL AND subscription_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) SUBSCRIPTION REMINDER DEDUP
-- Prevent concurrent cron runs from sending duplicate reminders for the same
-- subscription+due_date+channel.
-- ═══════════════════════════════════════════════════════════════════════════

-- Use date_trunc on sent_at to make "one reminder per subscription+type per day" unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_reminders_daily
  ON subscription_reminders (subscription_id, reminder_type, (date_trunc('day', sent_at)))
  WHERE subscription_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) MEMBERSHIP REQUEST APPROVAL RACE
-- Ensure only one approval can succeed by making (status, request_id) lockable.
-- The service layer uses FOR UPDATE SKIP LOCKED; ensure the index exists.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS ix_membership_requests_status
  ON membership_requests (status);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) SCALABILITY INDEXES (identified in audit)
-- ═══════════════════════════════════════════════════════════════════════════

-- Reminder cron scans: (status, next_payment_date) — WHERE status IN ('active','overdue')
CREATE INDEX IF NOT EXISTS ix_subscriptions_status_next_due
  ON subscriptions (status, next_payment_date)
  WHERE status IN ('active', 'overdue', 'pending_first_payment');

-- Member search by church+name
CREATE INDEX IF NOT EXISTS ix_members_church_name
  ON members (church_id, full_name)
  WHERE deleted_at IS NULL;

-- Payment history by member
CREATE INDEX IF NOT EXISTS ix_payments_member_date
  ON payments (member_id, payment_date DESC);

-- Audit log by church and timestamp
CREATE INDEX IF NOT EXISTS ix_audit_logs_church_time
  ON audit_logs (church_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) JOB FAILURES (DLQ) — record jobs that exhausted all retries
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) ACCOUNT RECOVERY - email fallback
-- Add recovery_email to users so a second verified channel exists if the
-- phone number is lost.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recovery_email TEXT,
  ADD COLUMN IF NOT EXISTS recovery_email_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_users_recovery_email
  ON users (lower(recovery_email))
  WHERE recovery_email IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) TRIAL GRANT HISTORY
-- Preserve trial history so a churn+resubscribe can't re-grant a trial.
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) PUSH NOTIFICATION IDEMPOTENCY KEY
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 9) SUBSCRIPTION "paused" STATUS (already supported via CHECK expansion)
-- Make sure the subscription status check allows 'paused'.
-- ═══════════════════════════════════════════════════════════════════════════

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
  -- status constraint shape may differ; skip if already permissive
  NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10) OTP rate-limit table (per-phone + per-IP, app-side fallback beyond Twilio)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS otp_rate_limits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_otp_rate_limits_window
  ON otp_rate_limits (window_start);

-- ═══════════════════════════════════════════════════════════════════════════
-- 11) SAAS PENDING ORDERS — ensure unique razorpay_order_id
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 12) CHURCH LEGAL/TAX FIELDS FOR RECEIPTS
-- Required fields for legally valid Indian tax-deduction (80G) receipts.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE churches
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS tax_80g_registration_number TEXT,
  ADD COLUMN IF NOT EXISTS pan_number TEXT,
  ADD COLUMN IF NOT EXISTS gstin TEXT,
  ADD COLUMN IF NOT EXISTS receipt_signatory_name TEXT,
  ADD COLUMN IF NOT EXISTS receipt_signatory_title TEXT,
  ADD COLUMN IF NOT EXISTS registered_address TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- ═══════════════════════════════════════════════════════════════════════════
-- 13) SESSION-LEVEL REFRESH TOKEN REVOCATION
-- Flag a refresh token as suspicious instead of nuking the whole family.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS suspicious_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════
-- 14) PRAYER REQUEST ANONYMITY
-- is_anonymous flag hides member identity from pastoral views.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE prayer_requests
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;

COMMIT;
