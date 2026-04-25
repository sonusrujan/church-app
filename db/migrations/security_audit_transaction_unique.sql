-- Security audit: Add UNIQUE constraint on payments.transaction_id to prevent double-insert races
-- Also adds index for faster dedup lookups

-- Only add if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_payments_transaction_id'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT uq_payments_transaction_id UNIQUE (transaction_id);
  END IF;
END $$;
