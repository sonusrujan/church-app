-- Add payment_category column to track purpose: subscription, donation, other
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_category text DEFAULT 'other';

-- Backfill: payments linked to a subscription are subscription payments
UPDATE payments SET payment_category = 'subscription' WHERE subscription_id IS NOT NULL AND payment_category = 'other';
