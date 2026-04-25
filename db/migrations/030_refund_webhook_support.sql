-- Migration 030: Refund webhook support
-- Adds razorpay_refund_id and refund_status to payment_refunds so
-- the refund.processed webhook handler can persist and deduplicate
-- refunds that originate from the Razorpay dashboard (outside the app).

ALTER TABLE payment_refunds
  ADD COLUMN IF NOT EXISTS razorpay_refund_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS refund_status TEXT DEFAULT 'processed';

-- Unique partial index: only one row per Razorpay refund ID, ignoring NULL rows
-- (app-initiated refunds recorded before this migration have NULL here).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_refunds_razorpay_id
  ON payment_refunds(razorpay_refund_id)
  WHERE razorpay_refund_id IS NOT NULL;
