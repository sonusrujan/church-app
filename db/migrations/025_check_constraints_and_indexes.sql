-- 025: Add CHECK constraints on financial columns and performance indexes
-- H-6: CHECK constraints + M-5: Database indexes + 7.2: Webhook cleanup

-- ── Financial CHECK constraints ──
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT chk_payment_amount CHECK (amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE subscriptions ADD CONSTRAINT chk_subscription_amount CHECK (amount >= 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE churches ADD CONSTRAINT chk_platform_fee_percentage CHECK (platform_fee_percentage BETWEEN 0 AND 10);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Performance indexes on hot query paths (M-5) ──
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_member_status ON subscriptions(member_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_church_status ON subscriptions(church_id, status);

-- ── Webhook events cleanup index (7.2) ──
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON razorpay_webhook_events(created_at);
