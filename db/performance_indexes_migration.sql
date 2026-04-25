-- Migration: Performance and idempotency indexes
-- Adds indexes for subscription reconciliation, search, and payment idempotency

-- ─── Tier 1: Performance-critical ────────────────────────────────────

-- Overdue reconciliation job: filters status='active' + next_payment_date < today
-- Without this, the daily cron job does a full table scan on subscriptions
CREATE INDEX IF NOT EXISTS subscriptions_status_next_payment_idx
  ON subscriptions(status, next_payment_date);

-- Member subscription lookups (used on every dashboard load)
CREATE INDEX IF NOT EXISTS subscriptions_member_id_idx
  ON subscriptions(member_id);

-- Payment idempotency: storePayment checks (transaction_id, member_id, subscription_id)
-- Also used by the atomic RPC function process_subscription_payments_batch
CREATE INDEX IF NOT EXISTS payments_transaction_member_sub_idx
  ON payments(transaction_id, member_id, subscription_id)
  WHERE transaction_id IS NOT NULL;

-- Email lookup for user linking/auth (7+ code paths use .ilike("email",...))
CREATE INDEX IF NOT EXISTS users_email_lower_idx
  ON users(LOWER(email));

-- Member lookup by email (member registration, profile sync)
CREATE INDEX IF NOT EXISTS members_email_idx
  ON members(email);

-- Church-scoped member filtering (admin dashboards, member search)
CREATE INDEX IF NOT EXISTS members_church_id_idx
  ON members(church_id);

-- Admin listing: frequently filtered by role + church
CREATE INDEX IF NOT EXISTS users_role_church_idx
  ON users(role, church_id);

-- ─── Tier 2: Operational queries ─────────────────────────────────────

-- Prayer requests by church (engagement dashboard)
CREATE INDEX IF NOT EXISTS prayer_requests_church_id_idx
  ON prayer_requests(church_id, created_at DESC);

-- Announcements by church (announcement listing)
CREATE INDEX IF NOT EXISTS announcements_church_id_idx
  ON announcements(church_id, created_at DESC);
