-- Migration: Add updated_at column to church_events and church_notifications for CRUD support
-- Run this against the RDS database

-- ── church_events: add updated_at ──
ALTER TABLE church_events ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- ── church_notifications: add updated_at ──
ALTER TABLE church_notifications ADD COLUMN IF NOT EXISTS updated_at timestamptz;
