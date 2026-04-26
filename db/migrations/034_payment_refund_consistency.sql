-- Migration 034: payment/refund consistency fixes.
--
-- 1. Link payment_month_allocations back to the exact due row it paid so
--    refund reversal can reliably restore those dues to pending.
-- 2. Track refunded portions of platform fees and Razorpay Route transfers so
--    refund accounting does not drift after partial or full refunds.

BEGIN;

ALTER TABLE payment_month_allocations
  ADD COLUMN IF NOT EXISTS due_id uuid REFERENCES subscription_monthly_dues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_month_allocations_due
  ON payment_month_allocations(due_id)
  WHERE due_id IS NOT NULL;

UPDATE payment_month_allocations pma
SET due_id = smd.id
FROM subscription_monthly_dues smd
WHERE pma.due_id IS NULL
  AND smd.subscription_id = pma.subscription_id
  AND smd.due_month = pma.covered_month;

ALTER TABLE platform_fee_collections
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE payment_transfers
  ADD COLUMN IF NOT EXISTS reversed_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;

DROP INDEX IF EXISTS idx_payment_refunds_razorpay_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_refunds_razorpay_payment
  ON payment_refunds(razorpay_refund_id, payment_id)
  WHERE razorpay_refund_id IS NOT NULL;

COMMIT;
