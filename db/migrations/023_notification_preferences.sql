-- Migration: Per-category notification preferences
-- Allows users to opt in/out of notification categories

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID NOT NULL,
  category TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, category)
);

COMMENT ON TABLE notification_preferences IS 'Per-category notification opt-in/out preferences';
COMMENT ON COLUMN notification_preferences.category IS 'Category: events, payments, prayer, family, announcements';
