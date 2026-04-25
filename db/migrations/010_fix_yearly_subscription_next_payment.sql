-- Migration: 010_fix_yearly_subscription_next_payment.sql
-- Fix: Migration 009 Step 4 applied monthly next_payment_date formula to yearly
-- subscriptions. Yearly subs should advance by 12 months, not 1 month.
--
-- This corrects any active yearly subscription whose next_payment_date is
-- within a few months (meaning it got the monthly formula instead of yearly).

-- Fix yearly subscriptions that were wrongly given a monthly next_payment_date
UPDATE subscriptions
SET next_payment_date = (next_payment_date + INTERVAL '11 months')::date
WHERE billing_cycle = 'yearly'
  AND status = 'active'
  AND next_payment_date IS NOT NULL
  -- Only fix those that were touched by migration 009 (recent, close dates)
  AND next_payment_date < CURRENT_DATE + INTERVAL '6 months';

-- Also add a unique constraint to prevent duplicate active subscriptions per member+slot.
-- A member can have at most ONE non-cancelled subscription per family_member_id slot.
-- (family_member_id IS NULL = the member's own direct subscription)
-- Using a partial unique index to enforce this at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_sub_per_member_slot
  ON subscriptions (member_id, COALESCE(family_member_id, '00000000-0000-0000-0000-000000000000'))
  WHERE status IN ('active', 'pending_first_payment', 'overdue');
