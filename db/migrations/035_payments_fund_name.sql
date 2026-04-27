-- Migration 035: add fund_name column to payments.
--
-- The donation verify endpoints (logged-in and public) write fund_name on
-- INSERT, and analytics/exports read it back. The column was referenced in
-- code but never created in the database, causing every donation verify to
-- fail with a 500 after the Razorpay charge succeeded.

BEGIN;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS fund_name text;

CREATE INDEX IF NOT EXISTS idx_payments_fund_name
  ON payments(fund_name)
  WHERE fund_name IS NOT NULL;

INSERT INTO _migrations (name)
VALUES ('035_payments_fund_name')
ON CONFLICT (name) DO NOTHING;

COMMIT;
