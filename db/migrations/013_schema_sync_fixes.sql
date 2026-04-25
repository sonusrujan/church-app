-- Migration 013: Schema sync fixes
-- Fixes DB-CRIT-3 (payment_method CHECK) and DB-CRIT-4 (function church_id)
-- from April 2026 QA audit

BEGIN;

-- ─── DB-CRIT-3: Fix payment_method CHECK constraint to allow 'subscription_paynow' ───
-- Drop old constraint first
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payment_method_valid;
-- Normalize any existing non-conforming values to 'other' before adding constraint
UPDATE payments SET payment_method = 'other'
  WHERE payment_method IS NOT NULL
    AND payment_method NOT IN (
      'cash', 'cheque', 'bank_transfer', 'upi', 'card', 'razorpay',
      'subscription_paynow', 'other'
    );
-- Add constraint with NOT VALID to avoid re-scanning all rows (UPDATE above already cleaned data)
ALTER TABLE payments ADD CONSTRAINT payment_method_valid
  CHECK (payment_method IS NULL OR payment_method IN (
    'cash', 'cheque', 'bank_transfer', 'upi', 'card', 'razorpay',
    'subscription_paynow', 'other'
  )) NOT VALID;

-- ─── DB-CRIT-4: Fix process_subscription_payments_batch to include church_id ───
CREATE OR REPLACE FUNCTION process_subscription_payments_batch(
  p_member_id UUID,
  p_transaction_id TEXT,
  p_payment_date TIMESTAMPTZ,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item JSONB;
  v_payment_id UUID;
  v_receipt TEXT;
  v_church_id UUID;
  v_results JSONB := '[]'::JSONB;
  v_sub_id UUID;
  v_amount NUMERIC;
  v_new_status TEXT;
  v_new_next TEXT;
  v_old_status TEXT;
  v_receipt_number TEXT;
  v_is_adjustment BOOLEAN;
  v_existing_id UUID;
  v_existing_receipt TEXT;
BEGIN
  -- Get member's church_id once
  SELECT church_id INTO v_church_id FROM members WHERE id = p_member_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sub_id        := (v_item->>'subscription_id')::UUID;
    v_amount        := (v_item->>'amount')::NUMERIC;
    v_receipt_number := v_item->>'receipt_number';
    v_new_status    := v_item->>'new_status';
    v_new_next      := v_item->>'new_next_payment_date';
    v_old_status    := v_item->>'old_status';
    v_is_adjustment := COALESCE((v_item->>'is_adjustment')::BOOLEAN, FALSE);

    -- Idempotency: check if payment already exists for this transaction + subscription
    SELECT id, receipt_number INTO v_existing_id, v_existing_receipt
    FROM payments
    WHERE transaction_id = p_transaction_id
      AND member_id = p_member_id
      AND subscription_id = v_sub_id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      v_results := v_results || jsonb_build_object(
        'payment_id', v_existing_id,
        'receipt_number', v_existing_receipt,
        'subscription_id', v_sub_id,
        'already_existed', TRUE,
        'next_payment_date', v_new_next
      );
      CONTINUE;
    END IF;

    -- Insert payment with church_id (DB-CRIT-4 fix)
    INSERT INTO payments (
      member_id, subscription_id, church_id, amount, payment_method,
      transaction_id, payment_status, payment_date,
      receipt_number, receipt_generated_at
    ) VALUES (
      p_member_id, v_sub_id, v_church_id, v_amount, 'subscription_paynow',
      p_transaction_id, 'success', p_payment_date,
      v_receipt_number, NOW()
    )
    RETURNING id, receipt_number INTO v_payment_id, v_receipt;

    -- Update subscription status and next_payment_date
    UPDATE subscriptions
    SET status = v_new_status,
        next_payment_date = v_new_next::DATE
    WHERE id = v_sub_id;

    -- Record subscription event
    INSERT INTO subscription_events (
      subscription_id, member_id, event_type, old_status, new_status, details
    ) VALUES (
      v_sub_id, p_member_id,
      CASE WHEN v_is_adjustment THEN 'adjustment_payment' ELSE 'payment_recorded' END,
      v_old_status, v_new_status,
      jsonb_build_object(
        'payment_id', v_payment_id,
        'amount', v_amount,
        'transaction_id', p_transaction_id,
        'next_payment_date', v_new_next
      )
    );

    v_results := v_results || jsonb_build_object(
      'payment_id', v_payment_id,
      'receipt_number', v_receipt,
      'subscription_id', v_sub_id,
      'already_existed', FALSE,
      'next_payment_date', v_new_next
    );
  END LOOP;

  RETURN v_results;
END;
$$;

-- ─── HIGH-1: Enable RLS on member_special_dates ───
ALTER TABLE member_special_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS special_dates_tenant ON member_special_dates;
CREATE POLICY special_dates_tenant ON member_special_dates
  USING (app_church_id() IS NULL OR church_id = app_church_id());

DROP POLICY IF EXISTS special_dates_insert ON member_special_dates;
CREATE POLICY special_dates_insert ON member_special_dates
  FOR INSERT
  WITH CHECK (app_church_id() IS NULL OR church_id = app_church_id());

-- ─── MED-4: Enable RLS on notification_batches ───
ALTER TABLE notification_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_batches_service_only ON notification_batches;
CREATE POLICY notification_batches_service_only ON notification_batches
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Upgrade idempotency index to UNIQUE (if not already done by migration 006)
DROP INDEX IF EXISTS payments_transaction_member_sub_idx;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_tx_idempotency
  ON payments(transaction_id, member_id, subscription_id)
  WHERE transaction_id IS NOT NULL;

-- Record migration
INSERT INTO _migrations (name) VALUES ('013_schema_sync_fixes')
ON CONFLICT DO NOTHING;

-- ─── LOW-6: Change subscriptions.member_id from CASCADE to SET NULL ───
-- Preserves subscription/financial records when a member is deleted
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_member_id_fkey;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_member_id_fkey
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

COMMIT;
