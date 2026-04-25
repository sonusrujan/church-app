-- Migration 028: Schema hardening + Razorpay old-model column removal
-- Covers:
--   Phase 3.9 — DROP churches.razorpay_key_id / razorpay_key_secret (old per-church key model)
--   Phase 3   — RLS on payment_refunds, missing indexes, partial unique on subscriptions,
--               per-church unique on pastors.email, NOT NULL on payments columns

BEGIN;

-- ── 1. Remove old per-church Razorpay API key columns (Razorpay Routes model is now used) ──
ALTER TABLE churches DROP COLUMN IF EXISTS razorpay_key_id;
ALTER TABLE churches DROP COLUMN IF EXISTS razorpay_key_secret;

-- ── 2. RLS on payment_refunds (church_id was added in migration 002) ──
ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_refunds_tenant ON payment_refunds;
CREATE POLICY payment_refunds_tenant ON payment_refunds
  USING (church_id::text = current_setting('app.church_id', true));

-- ── 3. NOT NULL constraints on payments critical columns ──
-- Backfill any remaining NULLs (migration 027 already did most of this)
UPDATE payments p
SET church_id = m.church_id
FROM members m
WHERE p.member_id = m.id
  AND p.church_id IS NULL
  AND m.church_id IS NOT NULL;

-- Enforce NOT NULL now that backfill is done (skip if already constrained)
DO $$ BEGIN
  ALTER TABLE payments ALTER COLUMN church_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ── 4. Partial unique index on subscriptions — one active subscription per member per plan per church ──
-- Prevents duplicate active/pending subscriptions being created in race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_active_member_plan
  ON subscriptions(member_id, plan_name, church_id)
  WHERE status NOT IN ('cancelled', 'expired');

-- ── 5. Per-church unique constraint on pastors.email ──
-- The old global unique on email incorrectly prevents the same pastor from serving two churches.
-- Drop the global unique index and replace with a per-church partial unique.
DO $$ BEGIN
  ALTER TABLE pastors DROP CONSTRAINT IF EXISTS pastors_email_key;
EXCEPTION WHEN others THEN NULL;
END $$;
DROP INDEX IF EXISTS pastors_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pastors_email_per_church
  ON pastors(church_id, email)
  WHERE email IS NOT NULL AND is_active = true;

-- ── 6. Missing performance indexes on high-query tables ──
CREATE INDEX IF NOT EXISTS idx_prayer_requests_church_created
  ON prayer_requests(church_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_church_created
  ON announcements(church_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_member_date
  ON payments(member_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_church
  ON payment_refunds(church_id);

-- ── 7. Index on payment_transfers.razorpay_transfer_id for webhook lookups ──
CREATE INDEX IF NOT EXISTS idx_payment_transfers_razorpay_id
  ON payment_transfers(razorpay_transfer_id)
  WHERE razorpay_transfer_id IS NOT NULL;

-- ── 8. Record migration ──
INSERT INTO _migrations (name) VALUES ('028_schema_hardening_razorpay_cleanup')
ON CONFLICT DO NOTHING;

COMMIT;
