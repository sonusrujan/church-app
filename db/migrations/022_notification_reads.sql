-- Migration: Server-side notification read tracking
-- Replaces localStorage-only tracking with persistent DB storage

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id UUID NOT NULL REFERENCES church_notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);

COMMENT ON TABLE notification_reads IS 'Tracks which notifications have been read by each user';
