-- ============================================================================
-- AWS RDS Full Schema — Church Subscription Management Platform
-- Generated: 2026-03-24
-- 
-- Combined idempotent migration from all Supabase schema/migration files.
-- All Supabase-specific references (RLS, policies, grants, auth.*, 
-- supabase_realtime) have been removed for plain AWS RDS PostgreSQL.
-- ============================================================================

-- ═══ Extensions ═══
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

-- ============================================================================
-- SECTION 1: BASE TABLES (no foreign-key dependencies)
-- ============================================================================

-- ─── 1a. Churches ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS churches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_code text UNIQUE,
  name text NOT NULL,
  payments_enabled boolean NOT NULL DEFAULT false,
  razorpay_key_id text,
  razorpay_key_secret text,
  address text,
  location text,
  contact_phone text,
  -- Product readiness
  trial_ends_at timestamptz,
  deleted_at timestamptz,
  -- SaaS / platform
  member_subscription_enabled boolean NOT NULL DEFAULT true,
  church_subscription_enabled boolean NOT NULL DEFAULT false,
  church_subscription_amount numeric(10,2) NOT NULL DEFAULT 0,
  platform_fee_enabled boolean NOT NULL DEFAULT false,
  platform_fee_percentage numeric(5,2) NOT NULL DEFAULT 2.00,
  service_enabled boolean NOT NULL DEFAULT true,
  grace_period_days integer NOT NULL DEFAULT 30,
  subscription_minimum numeric(10,2) NOT NULL DEFAULT 200.00,
  created_at timestamptz DEFAULT now()
);

-- church_code uniqueness (partial — allows NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS churches_church_code_unique
  ON churches(church_code)
  WHERE church_code IS NOT NULL;

-- ─── 1b. Leadership Roles (global, reusable across churches) ───────────────
CREATE TABLE IF NOT EXISTS leadership_roles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,
  hierarchy_level integer NOT NULL,
  is_pastor_role boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Seed default roles
INSERT INTO leadership_roles (name, hierarchy_level, is_pastor_role, description)
VALUES
  ('Bishop',           1, false, 'Spiritual Overseer & Head of the Church'),
  ('DC',               2, true,  'Deanery Chairman — Regional Governance'),
  ('Presbyter',        3, true,  'Council of Elders — Spiritual Leadership'),
  ('Secretary',        4, false, 'Don Secretary — Administrative Leadership'),
  ('Treasurer',        5, false, 'Don Treasurer — Financial Leadership'),
  ('Vice President',   6, false, 'Don Vice President — Operational Leadership'),
  ('Pastor',           7, true,  'Local Congregation Care & Prayer Ministry'),
  ('Committee Member', 8, false, 'Church Committee Member'),
  ('Sexton',           9, false, 'Church Sexton — Facility & Property Caretaker'),
  ('Other',           10, false, 'Custom role with user-defined name and level')
ON CONFLICT (name) DO NOTHING;

-- ─── 1c. OTP Verification Store ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_verifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_verifications_phone
  ON otp_verifications(phone, verified);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_expires
  ON otp_verifications(expires_at);

-- ─── 1d. OTP Rate Limits ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_rate_limits (
  phone text PRIMARY KEY,
  send_count integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);

-- ─── 1e. Async Job Queue ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_queue (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retry')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  error_message text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_pending
  ON job_queue(status, scheduled_for)
  WHERE status IN ('pending', 'retry');

-- ─── 1f. Razorpay Webhook Events ──────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_events
  ON razorpay_webhook_events(event_type, processed);

-- ============================================================================
-- SECTION 2: USERS TABLE (depends on churches)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id uuid,
  email text NOT NULL DEFAULT '',
  full_name text,
  avatar_url text,
  phone_number text,
  role text NOT NULL DEFAULT 'member',
  church_id uuid REFERENCES churches(id) ON DELETE CASCADE,
  preferred_language text NOT NULL DEFAULT 'en',
  dark_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique
  ON users(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_unique
  ON users(phone_number)
  WHERE phone_number IS NOT NULL AND phone_number != '';

CREATE INDEX IF NOT EXISTS users_email_lower_idx
  ON users(LOWER(email));

CREATE INDEX IF NOT EXISTS users_role_church_idx
  ON users(role, church_id);

-- ─── Refresh Tokens (depends on users) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ─── Deferred church column that references users ──────────────────────────
ALTER TABLE churches
  ADD COLUMN IF NOT EXISTS trial_granted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- ─── Push Notification Subscriptions (depends on users) ────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

-- ============================================================================
-- SECTION 3: MEMBERS TABLE (depends on users, churches)
-- ============================================================================

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone_number text,
  alt_phone_number text,
  address text,
  membership_id text,
  family_members jsonb,
  subscription_amount numeric DEFAULT 0,
  verification_status text DEFAULT 'pending',
  church_id uuid REFERENCES churches(id) ON DELETE CASCADE,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS members_email_idx
  ON members(email);

CREATE UNIQUE INDEX IF NOT EXISTS members_email_church_unique
  ON members(LOWER(email), church_id)
  WHERE deleted_at IS NULL AND email IS NOT NULL AND email != '';

CREATE INDEX IF NOT EXISTS members_church_id_idx
  ON members(church_id);

-- ============================================================================
-- SECTION 4: TABLES DEPENDING ON MEMBERS / CHURCHES
-- ============================================================================

-- ─── 4a. Family Members ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS family_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  gender text,
  relation text,
  age integer,
  dob date,
  has_subscription boolean NOT NULL DEFAULT false,
  linked_to_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_members_member_created_idx
  ON family_members(member_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS family_members_linked_member_unique
  ON family_members(linked_to_member_id)
  WHERE linked_to_member_id IS NOT NULL;

-- ─── 4b. Pastors ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pastors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone_number text NOT NULL,
  email text,
  details text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pastors_church_created_idx
  ON pastors(church_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS pastors_phone_unique
  ON pastors(phone_number);

CREATE UNIQUE INDEX IF NOT EXISTS pastors_email_unique
  ON pastors(LOWER(email))
  WHERE email IS NOT NULL;

-- ─── 4c. Announcements ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcements_church_id_idx
  ON announcements(church_id, created_at DESC);

-- ─── 4d. Church Events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS church_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  event_date timestamptz,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS church_events_church_created_idx
  ON church_events(church_id, created_at DESC);

-- ─── 4e. Church Notifications ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS church_notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS church_notifications_church_created_idx
  ON church_notifications(church_id, created_at DESC);

-- ─── 4f. Prayer Requests ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prayer_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  member_email text NOT NULL,
  details text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prayer_requests_church_id_idx
  ON prayer_requests(church_id, created_at DESC);

-- ─── 4g. Prayer Request Recipients ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prayer_request_recipients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  prayer_request_id uuid NOT NULL REFERENCES prayer_requests(id) ON DELETE CASCADE,
  pastor_id uuid NOT NULL REFERENCES pastors(id) ON DELETE CASCADE,
  pastor_email text,
  delivery_status text NOT NULL DEFAULT 'queued',
  delivery_note text,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prayer_request_recipients_request_idx
  ON prayer_request_recipients(prayer_request_id);

-- ─── 4h. Membership Requests ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  phone_number text,
  address text,
  membership_id text,
  message text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS membership_requests_church_status_idx
  ON membership_requests(church_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS membership_requests_church_email_pending_idx
  ON membership_requests(church_id, LOWER(email))
  WHERE status = 'pending';

-- ─── 4i. Admin Audit Log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  actor_role text,
  church_id uuid REFERENCES churches(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  entity_type text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}',
  ip_address text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_church_created_idx
  ON admin_audit_log(church_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_actor_created_idx
  ON admin_audit_log(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
  ON admin_audit_log(action, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_insert_only ON admin_audit_log
  FOR INSERT
  WITH CHECK (true);

CREATE OR REPLACE RULE audit_no_update AS ON UPDATE TO admin_audit_log DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_no_delete AS ON DELETE TO admin_audit_log DO INSTEAD NOTHING;

-- ─── 4j. Scheduled Reports ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  report_type text NOT NULL,
  frequency text NOT NULL,
  recipient_emails text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_reports_church_id_idx
  ON scheduled_reports(church_id);

CREATE INDEX IF NOT EXISTS scheduled_reports_enabled_idx
  ON scheduled_reports(enabled)
  WHERE enabled = true;

-- ─── 4k. Notification Deliveries ──────────────────────────────────────────
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
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status
  ON notification_deliveries(status, created_at);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_church
  ON notification_deliveries(church_id, created_at DESC);

-- ─── 4l. Church Leadership ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS church_leadership (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES leadership_roles(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone_number text,
  email text,
  photo_url text,
  bio text,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  custom_role_name text,
  custom_hierarchy_level integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS church_leadership_church_active_idx
  ON church_leadership(church_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS church_leadership_role_idx
  ON church_leadership(role_id);

CREATE INDEX IF NOT EXISTS church_leadership_member_idx
  ON church_leadership(member_id)
  WHERE member_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS church_leadership_unique_active_assignment
  ON church_leadership(church_id, role_id, member_id)
  WHERE is_active = true AND member_id IS NOT NULL;

-- ─── 4m. Family Member Requests (search + approval) ──────────────────────
CREATE TABLE IF NOT EXISTS family_member_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  requester_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  relation text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_member_requests_church_status_idx
  ON family_member_requests(church_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS family_member_requests_requester_idx
  ON family_member_requests(requester_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS family_member_requests_target_idx
  ON family_member_requests(target_member_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS family_member_requests_target_pending_idx
  ON family_member_requests(target_member_id)
  WHERE status = 'pending';

-- ─── 4n. Family Member Create Requests ────────────────────────────────────
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
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  review_notes text,
  created_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_family_create_requests_church
  ON family_member_create_requests(church_id, status);

CREATE INDEX IF NOT EXISTS idx_family_create_requests_requester
  ON family_member_create_requests(requester_member_id);

-- ============================================================================
-- SECTION 5: SUBSCRIPTIONS (depends on members, family_members, churches)
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  family_member_id uuid REFERENCES family_members(id) ON DELETE SET NULL,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  plan_name text NOT NULL,
  amount numeric NOT NULL,
  billing_cycle text NOT NULL,
  start_date date NOT NULL,
  next_payment_date date NOT NULL,
  status text DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS subscriptions_status_next_payment_idx
  ON subscriptions(status, next_payment_date);

CREATE INDEX IF NOT EXISTS subscriptions_member_id_idx
  ON subscriptions(member_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_church
  ON subscriptions(church_id);

-- ============================================================================
-- SECTION 6: PAYMENTS (depends on members, subscriptions, churches)
-- ============================================================================

-- NOTE: member_id uses ON DELETE SET NULL to preserve financial records
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  church_id uuid REFERENCES churches(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  payment_method text,
  transaction_id text,
  payment_status text,
  payment_date timestamptz DEFAULT now(),
  payment_category text DEFAULT 'other',
  receipt_number text,
  receipt_generated_at timestamptz,
  fund_name text
);

CREATE INDEX IF NOT EXISTS payments_member_payment_date_idx
  ON payments(member_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS payments_receipt_number_idx
  ON payments(receipt_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_tx_idempotency
  ON payments(transaction_id, member_id, subscription_id)
  WHERE transaction_id IS NOT NULL;

ALTER TABLE payments ADD CONSTRAINT payment_method_valid
  CHECK (payment_method IS NULL OR payment_method IN (
    'cash', 'cheque', 'bank_transfer', 'upi', 'card', 'razorpay',
    'subscription_paynow', 'donation', 'public_donation', 'other'
  ));

CREATE INDEX IF NOT EXISTS idx_payments_church
  ON payments(church_id, payment_date DESC);

-- ============================================================================
-- SECTION 7: SUBSCRIPTION EVENTS (audit trail)
-- ============================================================================

-- NOTE: member_id uses ON DELETE SET NULL to preserve audit trail
CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status_before text,
  status_after text,
  amount numeric,
  source text NOT NULL DEFAULT 'system',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_events_member_event_at_idx
  ON subscription_events(member_id, event_at DESC);

CREATE INDEX IF NOT EXISTS subscription_events_subscription_event_at_idx
  ON subscription_events(subscription_id, event_at DESC);

CREATE INDEX IF NOT EXISTS subscription_events_church_event_at_idx
  ON subscription_events(church_id, event_at DESC);

-- ============================================================================
-- SECTION 8: CANCELLATION REQUESTS (depends on subscriptions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cancellation_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cancellation_requests_church_status_idx
  ON cancellation_requests(church_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS cancellation_requests_sub_pending_idx
  ON cancellation_requests(subscription_id)
  WHERE status = 'pending';

-- ============================================================================
-- SECTION 9: SUBSCRIPTION REMINDERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_reminders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  reminder_type text NOT NULL
    CHECK (reminder_type IN ('upcoming', 'overdue_7', 'overdue_14', 'overdue_30')),
  channels_sent text[] NOT NULL DEFAULT '{}',
  sent_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_reminders_sub
  ON subscription_reminders(subscription_id, reminder_type);

-- ============================================================================
-- SECTION 10: PAYMENT-DEPENDENT TABLES
-- ============================================================================

-- ─── 10a. Payment Refunds ──────────────────────────────────────────────────
-- NOTE: member_id uses ON DELETE SET NULL to preserve refund records
CREATE TABLE IF NOT EXISTS payment_refunds (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  refund_amount numeric NOT NULL,
  refund_reason text,
  refund_method text NOT NULL,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_refunds_payment_id_idx
  ON payment_refunds(payment_id);

CREATE INDEX IF NOT EXISTS payment_refunds_member_id_idx
  ON payment_refunds(member_id);

-- ─── 10b. Platform Fee Collections ────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_platform_fee_church
  ON platform_fee_collections(church_id, collected_at DESC);

-- ─── 10c. Refund Requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refund_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  transaction_id text,
  amount numeric(10,2) NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'forwarded', 'approved', 'denied', 'processed')),
  forwarded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  forwarded_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_church
  ON refund_requests(church_id, status);

CREATE INDEX IF NOT EXISTS idx_refund_requests_member
  ON refund_requests(member_id);

-- ─── 10d. Payment Reconciliation Queue ────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_reconciliation_queue (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  razorpay_order_id text NOT NULL,
  razorpay_payment_id text,
  church_id uuid REFERENCES churches(id) ON DELETE SET NULL,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  subscription_ids uuid[] DEFAULT '{}',
  expected_amount numeric(10,2),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reconciled', 'failed', 'manual_review')),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz DEFAULT now(),
  reconciled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payment_reconciliation
  ON payment_reconciliation_queue(status, created_at);

-- ============================================================================
-- SECTION 11: SAAS — CHURCH SUBSCRIPTIONS & BILLING
-- ============================================================================

-- ─── 11a. Church Subscriptions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS church_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'overdue', 'cancelled')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  next_payment_date date NOT NULL,
  last_payment_date date,
  inactive_since date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_church_subscriptions_church
  ON church_subscriptions(church_id);

CREATE INDEX IF NOT EXISTS idx_church_subscriptions_status
  ON church_subscriptions(status);

-- ─── 11b. Church Subscription Payments ────────────────────────────────────
CREATE TABLE IF NOT EXISTS church_subscription_payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_subscription_id uuid NOT NULL REFERENCES church_subscriptions(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  payment_method text,
  transaction_id text,
  payment_status text NOT NULL DEFAULT 'success'
    CHECK (payment_status IN ('success', 'failed', 'pending')),
  payment_date timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_church_sub_payments_church
  ON church_subscription_payments(church_id, payment_date DESC);

-- ============================================================================
-- SECTION 12: ANALYTICS — INCOME SUMMARY
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_church_income_summary
  ON church_income_summary(church_id, period_type, period_key);

-- ============================================================================
-- SECTION 13: FUNCTIONS — ATOMIC SUBSCRIPTION PAYMENT PROCESSING
-- ============================================================================

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

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

COMMIT;
