-- Migration 019: Razorpay Routes — linked accounts, payment transfers, settlement tracking
-- Super-admin only feature for automatic fund splitting between platform and churches.

BEGIN;

-- ── 1. Add routes columns to churches ──
ALTER TABLE churches
  ADD COLUMN IF NOT EXISTS razorpay_linked_account_id text,
  ADD COLUMN IF NOT EXISTS routes_enabled boolean NOT NULL DEFAULT false;

-- ── 2. Church linked accounts ──
CREATE TABLE IF NOT EXISTS church_linked_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  razorpay_account_id text NOT NULL,
  account_status text NOT NULL DEFAULT 'created'
    CHECK (account_status IN ('created', 'needs_clarification', 'under_review', 'activated', 'suspended', 'rejected')),
  business_name text,
  contact_name text,
  email text,
  phone text,
  bank_account_name text,
  bank_account_number text,
  bank_ifsc_code text,
  legal_business_name text,
  legal_info jsonb DEFAULT '{}',
  onboarded_by text,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (church_id),
  UNIQUE (razorpay_account_id)
);

-- ── 3. Payment transfers ──
CREATE TABLE IF NOT EXISTS payment_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  linked_account_id text NOT NULL,
  razorpay_transfer_id text,
  transfer_amount numeric(10,2) NOT NULL CHECK (transfer_amount > 0),
  platform_fee_amount numeric(10,2) NOT NULL DEFAULT 0,
  transfer_status text NOT NULL DEFAULT 'created'
    CHECK (transfer_status IN ('created', 'pending', 'processed', 'settled', 'failed', 'reversed')),
  razorpay_order_id text,
  settled_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Transfer settlement log ──
CREATE TABLE IF NOT EXISTS transfer_settlement_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES payment_transfers(id) ON DELETE CASCADE,
  razorpay_settlement_id text,
  amount numeric(10,2) NOT NULL,
  utr text,
  settled_at timestamptz NOT NULL DEFAULT now()
);

-- ── 5. Add transfer_status to payments for quick lookup ──
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS transfer_status text;

-- ── 6. Indexes ──
CREATE INDEX IF NOT EXISTS idx_church_linked_accounts_church
  ON church_linked_accounts(church_id);

CREATE INDEX IF NOT EXISTS idx_payment_transfers_payment
  ON payment_transfers(payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_transfers_church
  ON payment_transfers(church_id);

CREATE INDEX IF NOT EXISTS idx_payment_transfers_status
  ON payment_transfers(transfer_status);

CREATE INDEX IF NOT EXISTS idx_transfer_settlement_log_transfer
  ON transfer_settlement_log(transfer_id);

CREATE INDEX IF NOT EXISTS idx_payments_transfer_status
  ON payments(transfer_status) WHERE transfer_status IS NOT NULL;

-- ── 7. Record migration ──
INSERT INTO _migrations (name) VALUES ('019_razorpay_routes')
ON CONFLICT DO NOTHING;

COMMIT;
