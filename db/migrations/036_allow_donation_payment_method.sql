-- Migration 036: allow logged-in donation payments.
--
-- Logged-in donation verification stores payment_method = 'donation'. The
-- existing CHECK constraint allowed public_donation but not donation, so a
-- successful Razorpay payment could fail during local verification/storage.

BEGIN;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payment_method_valid;

ALTER TABLE payments ADD CONSTRAINT payment_method_valid
  CHECK (payment_method IS NULL OR payment_method IN (
    'cash', 'cheque', 'bank_transfer', 'upi', 'card', 'razorpay',
    'subscription_paynow', 'donation', 'public_donation', 'other'
  )) NOT VALID;

ALTER TABLE payments VALIDATE CONSTRAINT payment_method_valid;

INSERT INTO _migrations (name)
VALUES ('036_allow_donation_payment_method')
ON CONFLICT (name) DO NOTHING;

COMMIT;
