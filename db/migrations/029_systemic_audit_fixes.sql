-- Migration 029: Systemic audit fixes
-- Bug Class A: Universal soft-delete for all entity tables
-- Bug Class D: SaaS lifecycle enforcement support

-- ═══════════════════════════════════════════════════════
-- A1: Add deleted_at columns to tables that currently hard-delete
-- ═══════════════════════════════════════════════════════

ALTER TABLE dioceses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE donation_funds ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE church_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Partial indexes for efficient soft-delete filtering (only index non-deleted rows)
CREATE INDEX IF NOT EXISTS idx_dioceses_not_deleted ON dioceses (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_donation_funds_not_deleted ON donation_funds (church_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ad_banners_not_deleted ON ad_banners (scope, scope_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_church_events_not_deleted ON church_events (church_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_announcements_not_deleted ON announcements (church_id) WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════
-- D1: Add trial_ends_at to churches for trial enforcement
-- ═══════════════════════════════════════════════════════

ALTER TABLE churches ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT NULL;

-- Index for SaaS enforcement job to find expired trials efficiently
CREATE INDEX IF NOT EXISTS idx_churches_trial_ends_at ON churches (trial_ends_at) WHERE trial_ends_at IS NOT NULL AND deleted_at IS NULL;

-- Index for SaaS enforcement job to find overdue church subscriptions
CREATE INDEX IF NOT EXISTS idx_church_subscriptions_enforcement ON church_subscriptions (status, next_payment_date) WHERE status IN ('active', 'overdue');

-- ═══════════════════════════════════════════════════════
-- Done
-- ═══════════════════════════════════════════════════════
