-- Migration 027: Workflow audit fixes
-- Fixes identified in real-world SaaS audit (April 2026)

-- 1. Fix chk_payment_status: add 'partially_refunded' (critical — partial refunds break without this)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payment_status;
ALTER TABLE payments ADD CONSTRAINT chk_payment_status
  CHECK (payment_status IN ('success','failed','pending','processing','refunded','partially_refunded'));

-- 2. Add 'waived' status to subscription_monthly_dues
ALTER TABLE subscription_monthly_dues DROP CONSTRAINT IF EXISTS chk_due_status;
ALTER TABLE subscription_monthly_dues ADD CONSTRAINT chk_due_status
  CHECK (status IN ('pending','paid','imported_paid','waived'));

-- 3. Backfill payments.church_id from members where NULL
UPDATE payments p
SET church_id = m.church_id
FROM members m
WHERE p.member_id = m.id
  AND p.church_id IS NULL
  AND m.church_id IS NOT NULL;

-- 4. Backfill payment_refunds.church_id from payments where NULL
UPDATE payment_refunds pr
SET church_id = p.church_id
FROM payments p
WHERE pr.payment_id = p.id
  AND pr.church_id IS NULL
  AND p.church_id IS NOT NULL;

-- 5. Add cancelled status to events
ALTER TABLE church_events ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
