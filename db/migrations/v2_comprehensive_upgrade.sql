-- ============================================================================
-- V2 Comprehensive Upgrade Migration
-- Covers: grace period, OTP store, audit log, notification delivery,
--         async job queue, family member creation requests, cascade safety,
--         i18n preferences, subscription reminders, dark mode preference,
--         RBAC church_id scoping on subscriptions & payments,
--         SaaS church subscription & platform fee system
-- ============================================================================

-- 0. RBAC: Add church_id to subscriptions and payments for multi-tenant isolation
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;

-- Back-fill existing records from member.church_id
UPDATE subscriptions s SET church_id = m.church_id
FROM members m WHERE s.member_id = m.id AND s.church_id IS NULL;

UPDATE payments p SET church_id = m.church_id
FROM members m WHERE p.member_id = m.id AND p.church_id IS NULL;

-- Create indexes for church-scoped queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_church ON subscriptions(church_id);
CREATE INDEX IF NOT EXISTS idx_payments_church ON payments(church_id, payment_date DESC);

-- 0b. SaaS: Church subscription & platform fee system
ALTER TABLE churches ADD COLUMN IF NOT EXISTS member_subscription_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS church_subscription_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS church_subscription_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS platform_fee_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS platform_fee_percentage numeric(5,2) NOT NULL DEFAULT 2.00;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS service_enabled boolean NOT NULL DEFAULT true;

-- Church subscription tracking (SaaS billing for churches)
CREATE TABLE IF NOT EXISTS church_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'overdue', 'cancelled')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  next_payment_date date NOT NULL,
  last_payment_date date,
  inactive_since date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_church_subscriptions_church ON church_subscriptions(church_id);
CREATE INDEX IF NOT EXISTS idx_church_subscriptions_status ON church_subscriptions(status);

-- Church subscription payments (Super Admin's revenue tracking)
CREATE TABLE IF NOT EXISTS church_subscription_payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_subscription_id uuid NOT NULL REFERENCES church_subscriptions(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  payment_method text,
  transaction_id text,
  payment_status text NOT NULL DEFAULT 'success' CHECK (payment_status IN ('success', 'failed', 'pending')),
  payment_date timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_church_sub_payments_church ON church_subscription_payments(church_id, payment_date DESC);

-- Platform fee tracking (2% extra collected during member checkout)
CREATE TABLE IF NOT EXISTS platform_fee_collections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  base_amount numeric(10,2) NOT NULL,
  fee_percentage numeric(5,2) NOT NULL,
  fee_amount numeric(10,2) NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_fee_church ON platform_fee_collections(church_id, collected_at DESC);

-- Refund requests (members can raise, admin forwards, super admin approves)
CREATE TABLE IF NOT EXISTS refund_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  transaction_id text,
  amount numeric(10,2) NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'forwarded', 'approved', 'denied', 'processed')),
  forwarded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  forwarded_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refund_requests_church ON refund_requests(church_id, status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_member ON refund_requests(member_id);

-- 1. Grace period per church (configurable by super admin)
ALTER TABLE churches ADD COLUMN IF NOT EXISTS grace_period_days integer NOT NULL DEFAULT 30;
ALTER TABLE churches ADD COLUMN IF NOT EXISTS subscription_minimum numeric(10,2) NOT NULL DEFAULT 200.00;

-- 2. OTP verification store (replaces in-memory Map)
CREATE TABLE IF NOT EXISTS otp_verifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_phone ON otp_verifications(phone, verified);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_expires ON otp_verifications(expires_at);

-- 3. Per-phone OTP rate limiting
CREATE TABLE IF NOT EXISTS otp_rate_limits (
  phone text PRIMARY KEY,
  send_count integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);

-- 4. Comprehensive admin audit log (all admin actions, not just super admin)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  actor_role text,
  church_id uuid REFERENCES churches(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb DEFAULT '{}',
  ip_address text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_church ON admin_audit_log(church_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action, created_at DESC);

-- 5. Notification delivery tracking (SMS, email, push)
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid REFERENCES churches(id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_phone text,
  recipient_email text,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'push')),
  notification_type text NOT NULL,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_church ON notification_deliveries(church_id, created_at DESC);

-- 6. Async job queue (for emails, SMS, push notifications)
CREATE TABLE IF NOT EXISTS job_queue (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retry')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  error_message text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_queue_pending ON job_queue(status, scheduled_for) WHERE status IN ('pending', 'retry');

-- 7. Family member creation requests (request admin to add a new member record)
CREATE TABLE IF NOT EXISTS family_member_create_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone_number text,
  email text,
  date_of_birth date,
  relation text NOT NULL,
  address text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  review_notes text,
  created_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_family_create_requests_church ON family_member_create_requests(church_id, status);
CREATE INDEX IF NOT EXISTS idx_family_create_requests_requester ON family_member_create_requests(requester_member_id);

-- 8. Subscription reminder tracking
CREATE TABLE IF NOT EXISTS subscription_reminders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('upcoming', 'overdue_7', 'overdue_14', 'overdue_30')),
  channels_sent text[] NOT NULL DEFAULT '{}',
  sent_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_reminders_sub ON subscription_reminders(subscription_id, reminder_type);

-- 9. User language preference
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';

-- 10. User dark mode preference
ALTER TABLE users ADD COLUMN IF NOT EXISTS dark_mode boolean NOT NULL DEFAULT false;

-- 11. Push notification subscriptions (Web Push)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- 12. Razorpay webhook events (for payment reconciliation)
CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_events ON razorpay_webhook_events(event_type, processed);

-- 13. Payment reconciliation queue
CREATE TABLE IF NOT EXISTS payment_reconciliation_queue (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  razorpay_order_id text NOT NULL,
  razorpay_payment_id text,
  church_id uuid REFERENCES churches(id) ON DELETE SET NULL,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  subscription_ids uuid[] DEFAULT '{}',
  expected_amount numeric(10,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled', 'failed', 'manual_review')),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now(),
  reconciled_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payment_reconciliation ON payment_reconciliation_queue(status, created_at);

-- 14. Cascade delete safety: change cascading deletes on payment-related FKs to SET NULL
-- Note: We change payments.member_id from CASCADE to SET NULL to preserve tax/legal records
-- This requires dropping and re-adding the constraint
DO $$
BEGIN
  -- payments.member_id: preserve payment records when member deleted
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'payments_member_id_fkey' AND table_name = 'payments'
  ) THEN
    ALTER TABLE payments DROP CONSTRAINT payments_member_id_fkey;
    ALTER TABLE payments ADD CONSTRAINT payments_member_id_fkey 
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;
  END IF;

  -- subscription_events.member_id: preserve audit trail
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'subscription_events_member_id_fkey' AND table_name = 'subscription_events'
  ) THEN
    ALTER TABLE subscription_events DROP CONSTRAINT subscription_events_member_id_fkey;
    ALTER TABLE subscription_events ADD CONSTRAINT subscription_events_member_id_fkey 
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;
  END IF;

  -- payment_refunds.member_id: preserve refund records
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'payment_refunds_member_id_fkey' AND table_name = 'payment_refunds'
  ) THEN
    ALTER TABLE payment_refunds DROP CONSTRAINT payment_refunds_member_id_fkey;
    ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_member_id_fkey 
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 15. Income summary materialized view (for fast analytics)
-- Using a regular table that gets refreshed by cron instead of materialized view
-- (Supabase doesn't support REFRESH MATERIALIZED VIEW via SDK)
CREATE TABLE IF NOT EXISTS church_income_summary (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  period_type text NOT NULL CHECK (period_type IN ('daily', 'monthly', 'yearly')),
  period_key text NOT NULL,
  subscription_income numeric(10,2) NOT NULL DEFAULT 0,
  donation_income numeric(10,2) NOT NULL DEFAULT 0,
  total_income numeric(10,2) NOT NULL DEFAULT 0,
  payment_count integer NOT NULL DEFAULT 0,
  computed_at timestamptz DEFAULT now(),
  UNIQUE(church_id, period_type, period_key)
);
CREATE INDEX IF NOT EXISTS idx_church_income_summary ON church_income_summary(church_id, period_type, period_key);

-- 16. RLS policies for new tables
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_member_create_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE razorpay_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_income_summary ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by backend)
-- No anon access to any of these tables

-- Allow service_role full access to all new tables (backend uses service_role key)
-- No anon access to any of these tables
-- Use DROP IF EXISTS to make re-runs safe

DROP POLICY IF EXISTS allow_service_role_otp_verifications ON otp_verifications;
CREATE POLICY allow_service_role_otp_verifications ON otp_verifications FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_otp_rate_limits ON otp_rate_limits;
CREATE POLICY allow_service_role_otp_rate_limits ON otp_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_admin_audit_log ON admin_audit_log;
CREATE POLICY allow_service_role_admin_audit_log ON admin_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_notification_deliveries ON notification_deliveries;
CREATE POLICY allow_service_role_notification_deliveries ON notification_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_job_queue ON job_queue;
CREATE POLICY allow_service_role_job_queue ON job_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_family_member_create_requests ON family_member_create_requests;
CREATE POLICY allow_service_role_family_member_create_requests ON family_member_create_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_subscription_reminders ON subscription_reminders;
CREATE POLICY allow_service_role_subscription_reminders ON subscription_reminders FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_push_subscriptions ON push_subscriptions;
CREATE POLICY allow_service_role_push_subscriptions ON push_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_razorpay_webhook_events ON razorpay_webhook_events;
CREATE POLICY allow_service_role_razorpay_webhook_events ON razorpay_webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_payment_reconciliation_queue ON payment_reconciliation_queue;
CREATE POLICY allow_service_role_payment_reconciliation_queue ON payment_reconciliation_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_church_income_summary ON church_income_summary;
CREATE POLICY allow_service_role_church_income_summary ON church_income_summary FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS for SaaS tables
ALTER TABLE church_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_fee_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_service_role_church_subscriptions ON church_subscriptions;
CREATE POLICY allow_service_role_church_subscriptions ON church_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_church_subscription_payments ON church_subscription_payments;
CREATE POLICY allow_service_role_church_subscription_payments ON church_subscription_payments FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_platform_fee_collections ON platform_fee_collections;
CREATE POLICY allow_service_role_platform_fee_collections ON platform_fee_collections FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_service_role_refund_requests ON refund_requests;
CREATE POLICY allow_service_role_refund_requests ON refund_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
