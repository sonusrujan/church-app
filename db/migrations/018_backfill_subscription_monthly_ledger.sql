-- 018_backfill_subscription_monthly_ledger.sql
-- Backfill monthly subscription ledger for legacy data (Jan 2025 onward)
-- Safe to re-run: inserts are conflict-protected and allocations only consume pending rows.

BEGIN;

-- 1) Seed due-month rows from Jan 2025 to current month for all subscriptions.
INSERT INTO subscription_monthly_dues (
  subscription_id,
  member_id,
  church_id,
  due_month,
  status,
  source
)
SELECT
  s.id,
  s.member_id,
  s.church_id,
  gs.due_month,
  'pending'::text,
  'legacy_backfill_seed'::text
FROM subscriptions s
JOIN LATERAL (
  SELECT generate_series(
    GREATEST(date_trunc('month', s.start_date::timestamp)::date, DATE '2025-01-01'),
    date_trunc('month', CURRENT_DATE::timestamp)::date,
    INTERVAL '1 month'
  )::date AS due_month
) gs ON TRUE
WHERE s.member_id IS NOT NULL
  AND s.church_id IS NOT NULL
  AND date_trunc('month', s.start_date::timestamp)::date <= date_trunc('month', CURRENT_DATE::timestamp)::date
ON CONFLICT (subscription_id, due_month) DO NOTHING;

-- 2) Consume historical successful subscription payments oldest-pending-first.
DO $$
DECLARE
  p_rec RECORD;
  v_monthly_amount numeric;
  v_months_to_allocate integer;
  v_remaining integer;
  v_due RECORD;
  v_first_pending date;
  v_next_month date := (date_trunc('month', CURRENT_DATE::timestamp) + INTERVAL '1 month')::date;
BEGIN
  FOR p_rec IN
    SELECT
      p.id AS payment_id,
      p.subscription_id,
      p.member_id,
      COALESCE(p.church_id, s.church_id) AS church_id,
      p.amount,
      p.payment_date,
      s.amount AS subscription_amount,
      s.billing_cycle,
      s.family_member_id,
      m.full_name AS member_name,
      fm.full_name AS family_member_name
    FROM payments p
    JOIN subscriptions s ON s.id = p.subscription_id
    LEFT JOIN members m ON m.id = s.member_id
    LEFT JOIN family_members fm ON fm.id = s.family_member_id
    WHERE p.subscription_id IS NOT NULL
      AND p.payment_status = 'success'
      AND p.amount > 0
      AND p.payment_date >= TIMESTAMPTZ '2025-01-01 00:00:00+00'
      AND s.member_id IS NOT NULL
      AND COALESCE(p.church_id, s.church_id) IS NOT NULL
    ORDER BY p.payment_date ASC, p.id ASC
  LOOP
    -- Compute month-equivalent amount:
    -- monthly => subscription amount
    -- yearly  => subscription amount / 12
    IF p_rec.billing_cycle = 'yearly' THEN
      v_monthly_amount := p_rec.subscription_amount / 12.0;
    ELSE
      v_monthly_amount := p_rec.subscription_amount;
    END IF;

    IF v_monthly_amount IS NULL OR v_monthly_amount <= 0 THEN
      CONTINUE;
    END IF;

    v_months_to_allocate := FLOOR(p_rec.amount / v_monthly_amount);
    IF v_months_to_allocate IS NULL OR v_months_to_allocate <= 0 THEN
      CONTINUE;
    END IF;

    v_remaining := v_months_to_allocate;

    WHILE v_remaining > 0 LOOP
      SELECT d.id, d.due_month
      INTO v_due
      FROM subscription_monthly_dues d
      WHERE d.subscription_id = p_rec.subscription_id
        AND d.status = 'pending'
      ORDER BY d.due_month ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        EXIT;
      END IF;

      UPDATE subscription_monthly_dues
      SET
        status = 'imported_paid',
        paid_payment_id = p_rec.payment_id,
        source = 'legacy_backfill_payment',
        updated_at = now()
      WHERE id = v_due.id;

      INSERT INTO payment_month_allocations (
        payment_id,
        subscription_id,
        member_id,
        church_id,
        covered_month,
        monthly_amount,
        person_name
      ) VALUES (
        p_rec.payment_id,
        p_rec.subscription_id,
        p_rec.member_id,
        p_rec.church_id,
        v_due.due_month,
        v_monthly_amount,
        COALESCE(p_rec.family_member_name, p_rec.member_name, 'Member')
      )
      ON CONFLICT DO NOTHING;

      v_remaining := v_remaining - 1;
    END LOOP;
  END LOOP;

  -- 3) Recompute subscription next-payment pointers from pending ledger.
  FOR p_rec IN
    SELECT DISTINCT s.id, s.status
    FROM subscriptions s
    JOIN subscription_monthly_dues d ON d.subscription_id = s.id
  LOOP
    SELECT MIN(due_month)
    INTO v_first_pending
    FROM subscription_monthly_dues
    WHERE subscription_id = p_rec.id
      AND status = 'pending';

    -- Skip cancelled/paused subscriptions to avoid violating dates_ordered constraint
    IF p_rec.status IN ('cancelled', 'paused') THEN
      CONTINUE;
    END IF;

    IF v_first_pending IS NOT NULL THEN
      UPDATE subscriptions
      SET
        next_payment_date = GREATEST(v_first_pending, start_date),
        status = 'overdue'
      WHERE id = p_rec.id;
    ELSE
      UPDATE subscriptions
      SET
        next_payment_date = GREATEST(v_next_month, start_date),
        status = 'active'
      WHERE id = p_rec.id;
    END IF;
  END LOOP;
END $$;

COMMIT;
