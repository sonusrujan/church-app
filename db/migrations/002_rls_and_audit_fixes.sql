-- ============================================================================
-- Migration 002: RLS Policies, Soft Delete, Platform Fee, Audit Fixes
-- Applied: 2026-03-24
-- Issues addressed: 1.1, 4.2, 5.1
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1.1  ROW-LEVEL SECURITY on all tenant-scoped tables
--
-- Strategy:
--   • App sets `app.current_church_id` on each request via SET LOCAL.
--   • RLS policies use current_setting('app.current_church_id', true)
--   • Super-admin bypass: if the GUC is empty/null, allow all (superadmin
--     explicitly sets '' so that the policy becomes permissive).
--     In practice the app still filters, but RLS is defense-in-depth.
-- ============================================================================

-- Helper: returns the current church_id set by the app, or NULL
CREATE OR REPLACE FUNCTION app_church_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_church_id', true), '')::uuid;
$$;

-- ---------- members ----------
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE members FORCE ROW LEVEL SECURITY;
CREATE POLICY members_tenant ON members
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- subscriptions ----------
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant ON subscriptions
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- payments ----------
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant ON payments
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- announcements ----------
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
CREATE POLICY announcements_tenant ON announcements
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- church_events ----------
ALTER TABLE church_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_events FORCE ROW LEVEL SECURITY;
CREATE POLICY church_events_tenant ON church_events
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- church_notifications ----------
ALTER TABLE church_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY church_notifications_tenant ON church_notifications
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- prayer_requests ----------
ALTER TABLE prayer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE prayer_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY prayer_requests_tenant ON prayer_requests
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- pastors ----------
ALTER TABLE pastors ENABLE ROW LEVEL SECURITY;
ALTER TABLE pastors FORCE ROW LEVEL SECURITY;
CREATE POLICY pastors_tenant ON pastors
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- membership_requests ----------
ALTER TABLE membership_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_requests_tenant ON membership_requests
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- cancellation_requests ----------
ALTER TABLE cancellation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY cancellation_requests_tenant ON cancellation_requests
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- subscription_events ----------
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_events_tenant ON subscription_events
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- subscription_reminders ----------
ALTER TABLE subscription_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_reminders_tenant ON subscription_reminders
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- scheduled_reports ----------
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY scheduled_reports_tenant ON scheduled_reports
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- notification_deliveries ----------
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_deliveries_tenant ON notification_deliveries
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- church_leadership ----------
ALTER TABLE church_leadership ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_leadership FORCE ROW LEVEL SECURITY;
CREATE POLICY church_leadership_tenant ON church_leadership
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- family_member_requests ----------
ALTER TABLE family_member_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_member_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY family_member_requests_tenant ON family_member_requests
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- family_member_create_requests ----------
ALTER TABLE family_member_create_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_member_create_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY family_member_create_requests_tenant ON family_member_create_requests
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- admin_audit_log ----------
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_audit_log_tenant ON admin_audit_log
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- platform_fee_collections ----------
ALTER TABLE platform_fee_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_fee_collections FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_fee_collections_tenant ON platform_fee_collections
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- refund_requests ----------
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY refund_requests_tenant ON refund_requests
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- payment_refunds ----------
-- payment_refunds doesn't have church_id directly, skip RLS
-- (it joins through payments which has RLS)

-- ---------- users ----------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_tenant ON users
  USING (app_church_id() IS NULL OR church_id = app_church_id() OR church_id IS NULL);

-- ---------- church_subscriptions ----------
ALTER TABLE church_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY church_subscriptions_tenant ON church_subscriptions
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- church_subscription_payments ----------
ALTER TABLE church_subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_subscription_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY church_subscription_payments_tenant ON church_subscription_payments
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ---------- church_income_summary ----------
ALTER TABLE church_income_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE church_income_summary FORCE ROW LEVEL SECURITY;
CREATE POLICY church_income_summary_tenant ON church_income_summary
  USING (app_church_id() IS NULL OR church_id = app_church_id());

-- ============================================================================
-- 4.2  Add deleted_at (soft delete) to more tables
-- ============================================================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE church_events ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE prayer_requests ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ============================================================================
-- 5.1  Ensure church_id exists on tables that need it
-- (payments and subscriptions already have church_id from the schema)
-- ============================================================================

-- payment_refunds needs church_id for proper scoping
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_payment_refunds_church ON payment_refunds(church_id);

-- ============================================================================
-- Refresh token table for 1.2
-- ============================================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE revoked = false;

COMMIT;
