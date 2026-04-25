-- Migration: 008_fix_unlinked_manual_payments.sql
-- Fix manual payments that were recorded without subscription_id
-- by auto-matching them to the member's subscription when the amount matches.

-- Step 1: For all manual payments with no subscription_id,
-- try to link them to a matching subscription (same member, same amount, active/pending status).
-- This handles both direct subscriptions AND family-linked subscriptions.
UPDATE payments p
SET subscription_id = matched.sub_id,
    payment_category = 'subscription'
FROM (
  SELECT DISTINCT ON (p2.id) p2.id AS payment_id, s.id AS sub_id
  FROM payments p2
  JOIN subscriptions s ON s.amount = p2.amount
    AND (
      -- Direct: subscription belongs to the paying member
      s.member_id = p2.member_id
      OR
      -- Family: member is linked via family_members, subscription references family_member_id
      EXISTS (
        SELECT 1 FROM family_members fm
        WHERE fm.linked_to_member_id = p2.member_id
          AND s.family_member_id = fm.id
      )
    )
  WHERE p2.subscription_id IS NULL
    AND p2.payment_method LIKE 'manual_%'
    AND p2.payment_status = 'success'
    AND s.status IN ('pending_first_payment', 'overdue', 'active')
  ORDER BY p2.id, 
    CASE s.status 
      WHEN 'pending_first_payment' THEN 1 
      WHEN 'overdue' THEN 2 
      WHEN 'active' THEN 3 
    END
) matched
WHERE p.id = matched.payment_id;

-- Step 2: Update subscriptions that now have a successful payment linked to them
-- Set status to 'active' and advance next_payment_date if it's in the past
UPDATE subscriptions s
SET status = 'active',
    next_payment_date = CASE
      WHEN s.next_payment_date <= CURRENT_DATE THEN
        CASE s.billing_cycle
          WHEN 'yearly' THEN (DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year' + INTERVAL '4 days')::date
          ELSE (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' + INTERVAL '4 days')::date
        END
      ELSE s.next_payment_date
    END
FROM payments p
WHERE p.subscription_id = s.id
  AND p.payment_status = 'success'
  AND p.payment_method LIKE 'manual_%'
  AND s.status IN ('pending_first_payment', 'overdue');
