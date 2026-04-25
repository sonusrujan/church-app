-- 017_subscription_monthly_ledger.sql
-- Month-level subscription dues and payment allocations (Jan 2025 onward migration support)

CREATE TABLE IF NOT EXISTS subscription_monthly_dues (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  due_month date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'imported_paid')),
  paid_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, due_month)
);

CREATE INDEX IF NOT EXISTS idx_subscription_monthly_dues_subscription
  ON subscription_monthly_dues(subscription_id, due_month);

CREATE INDEX IF NOT EXISTS idx_subscription_monthly_dues_member
  ON subscription_monthly_dues(member_id, due_month DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_monthly_dues_church
  ON subscription_monthly_dues(church_id, due_month DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_monthly_dues_pending
  ON subscription_monthly_dues(subscription_id, status, due_month)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS payment_month_allocations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  covered_month date NOT NULL,
  monthly_amount numeric NOT NULL,
  person_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, covered_month),
  UNIQUE (payment_id, covered_month)
);

CREATE INDEX IF NOT EXISTS idx_payment_month_allocations_member
  ON payment_month_allocations(member_id, covered_month DESC);

CREATE INDEX IF NOT EXISTS idx_payment_month_allocations_payment
  ON payment_month_allocations(payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_month_allocations_subscription
  ON payment_month_allocations(subscription_id, covered_month DESC);

CREATE OR REPLACE FUNCTION update_subscription_monthly_dues_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscription_monthly_dues_updated_at ON subscription_monthly_dues;
CREATE TRIGGER trg_subscription_monthly_dues_updated_at
BEFORE UPDATE ON subscription_monthly_dues
FOR EACH ROW
EXECUTE FUNCTION update_subscription_monthly_dues_updated_at();
