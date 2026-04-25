-- Migration: Atomic subscription payment processing
-- Creates a PostgreSQL function that processes multiple subscription payments
-- in a single transaction, ensuring payment insert + subscription update + event
-- recording are all-or-nothing per batch.

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

    -- Insert payment
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
    WHERE id = v_sub_id
      AND member_id = p_member_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Subscription % not found or does not belong to member %', v_sub_id, p_member_id;
    END IF;

    -- Record payment_recorded event
    INSERT INTO subscription_events (
      member_id, subscription_id, church_id, event_type,
      status_after, amount, source, metadata, event_at
    ) VALUES (
      p_member_id, v_sub_id, v_church_id, 'payment_recorded',
      'success', v_amount, 'payment_gateway',
      jsonb_build_object(
        'payment_method', 'subscription_paynow',
        'transaction_id', p_transaction_id,
        'payment_date', p_payment_date::TEXT,
        'receipt_number', COALESCE(v_receipt, v_receipt_number)
      ),
      NOW()
    );

    -- Record subscription_due_paid event
    INSERT INTO subscription_events (
      member_id, subscription_id, church_id, event_type,
      status_before, status_after, amount, source, metadata, event_at
    ) VALUES (
      p_member_id, v_sub_id, v_church_id, 'subscription_due_paid',
      v_old_status, v_new_status, v_amount, 'payment_gateway',
      jsonb_build_object(
        'paid_via', 'pay_now',
        'next_payment_date', v_new_next,
        'transaction_id', p_transaction_id,
        'is_adjustment', v_is_adjustment
      ),
      NOW()
    );

    v_results := v_results || jsonb_build_object(
      'payment_id', v_payment_id,
      'receipt_number', COALESCE(v_receipt, v_receipt_number),
      'subscription_id', v_sub_id,
      'already_existed', FALSE,
      'next_payment_date', v_new_next
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'payment_count', jsonb_array_length(v_results),
    'results', v_results
  );
END;
$$;
