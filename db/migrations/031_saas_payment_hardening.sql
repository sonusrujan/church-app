-- 031_saas_payment_hardening.sql
-- Hardens the SaaS-fee (church→platform) payment path so that:
--   1. Duplicate transaction_ids cannot create duplicate payment rows
--      (which would otherwise roll next_payment_date forward multiple times
--      and grant free billing cycles).
--   2. The Razorpay webhook can safely reconcile a SaaS payment when the
--      synchronous /api/saas/pay/verify call fails after Razorpay success.
--
-- Also adds the web_handoff_tokens table used by the native→web handoff flow.

BEGIN;

-- ── 1. Idempotency: one payment row per Razorpay payment_id ──
--    NULL transaction_ids (manual/bank-transfer records) are exempted
--    via the partial index.

CREATE UNIQUE INDEX IF NOT EXISTS church_subscription_payments_txn_unique
  ON church_subscription_payments(transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ── 2. Webhook handoff: store the Razorpay order_id on the subscription
--    row so the webhook can look up which church_subscription to activate
--    without the admin's JWT context.

CREATE TABLE IF NOT EXISTS church_subscription_pending_orders (
  razorpay_order_id text PRIMARY KEY,
  church_subscription_id uuid NOT NULL REFERENCES church_subscriptions(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  expected_amount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz
);

CREATE INDEX IF NOT EXISTS church_subscription_pending_orders_church_idx
  ON church_subscription_pending_orders(church_id, created_at DESC);

-- ── 3. Web handoff tokens (native → browser single-use bridge) ──
--    Row is inserted at mint time. Consumed by the /exchange endpoint
--    with an UPDATE ... WHERE consumed_at IS NULL RETURNING guard so
--    replay is impossible.

CREATE TABLE IF NOT EXISTS web_handoff_tokens (
  jti uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  church_id uuid REFERENCES churches(id) ON DELETE SET NULL,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_handoff_tokens_user_idx
  ON web_handoff_tokens(user_id, created_at DESC);

-- Automatic cleanup: expired, unused rows older than 1 day can be purged
-- by a scheduled job — no cron here, just the index to make it cheap.
CREATE INDEX IF NOT EXISTS web_handoff_tokens_expiry_idx
  ON web_handoff_tokens(expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
