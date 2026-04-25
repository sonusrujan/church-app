-- Migration 022: Fix public donation payment_method CHECK constraint
-- Adds 'public_donation' to the allowed payment_method values

BEGIN;

-- Drop old constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payment_method_valid;

-- Re-create with 'public_donation' included
ALTER TABLE payments ADD CONSTRAINT payment_method_valid
  CHECK (payment_method IS NULL OR payment_method IN (
    'cash', 'cheque', 'bank_transfer', 'upi', 'card', 'razorpay',
    'subscription_paynow', 'public_donation', 'other'
  )) NOT VALID;

-- Validate any existing rows
ALTER TABLE payments VALIDATE CONSTRAINT payment_method_valid;

COMMIT;
