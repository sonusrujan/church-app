-- Migration: 009_fix_family_subscription_payments.sql
-- Fix: payments recorded against a family member's member_id should link to
-- the family subscription (under the head) rather than the member's own subscription.

-- Step 1: For payments that are still unlinked (subscription_id IS NULL)
-- AND the paying member is a family_member (linked_to_member_id),
-- link to the family subscription that matches by family_member_id + amount.
UPDATE payments p
SET subscription_id = matched.sub_id,
    payment_category = 'subscription'
FROM (
  SELECT DISTINCT ON (p2.id) p2.id AS payment_id, s.id AS sub_id
  FROM payments p2
  JOIN family_members fm ON fm.linked_to_member_id = p2.member_id
  JOIN subscriptions s ON s.family_member_id = fm.id AND s.amount = p2.amount
  WHERE p2.subscription_id IS NULL
    AND p2.payment_method LIKE 'manual_%'
    AND p2.payment_status = 'success'
    AND s.status IN ('pending_first_payment', 'overdue', 'active')
  ORDER BY p2.id, s.start_date DESC
) matched
WHERE p.id = matched.payment_id;

-- Step 2: For payments that were wrongly linked to the member's OWN subscription
-- when a family subscription exists, re-link them to the family subscription.
-- This fixes migration 008 which may have linked to the wrong subscription.
UPDATE payments p
SET subscription_id = better.family_sub_id
FROM (
  SELECT p2.id AS payment_id, p2.subscription_id AS old_sub_id, s_family.id AS family_sub_id
  FROM payments p2
  JOIN subscriptions s_own ON s_own.id = p2.subscription_id
  JOIN family_members fm ON fm.linked_to_member_id = p2.member_id
  JOIN subscriptions s_family ON s_family.family_member_id = fm.id AND s_family.amount = p2.amount
  WHERE p2.payment_method LIKE 'manual_%'
    AND p2.payment_status = 'success'
    AND s_own.family_member_id IS NULL               -- current link is to own subscription (not family)
    AND s_family.id != p2.subscription_id             -- different from current
    AND s_family.status IN ('pending_first_payment', 'overdue', 'active')
) better
WHERE p.id = better.payment_id;

-- Step 3: Revert wrongly-activated own subscriptions that lost their payment link
-- (from migration 008 activating de324e71 which should have stayed pending)
UPDATE subscriptions s
SET status = 'pending_first_payment'
WHERE s.status = 'active'
  AND s.family_member_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.subscription_id = s.id AND p.payment_status = 'success'
  );

-- Step 4: Activate family subscriptions that now have a successful payment
UPDATE subscriptions s
SET status = 'active',
    next_payment_date = CASE
      WHEN s.next_payment_date <= CURRENT_DATE THEN
        CASE s.billing_cycle
          WHEN 'yearly' THEN (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' + INTERVAL '4 days')::date
          ELSE (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' + INTERVAL '4 days')::date
        END
      ELSE s.next_payment_date
    END
FROM payments p
WHERE p.subscription_id = s.id
  AND p.payment_status = 'success'
  AND s.status IN ('pending_first_payment', 'overdue');
