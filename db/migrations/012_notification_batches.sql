-- Migration 012: Notification batch tracking
-- Adds batch_id to notification_deliveries and a notification_batches table for grouping

CREATE TABLE IF NOT EXISTS notification_batches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel text NOT NULL CHECK (channel IN ('push', 'sms')),
  scope text NOT NULL DEFAULT 'global',
  scope_id text,
  title text,
  body text NOT NULL,
  total_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  cancelled_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'completed', 'partially_failed', 'cancelled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Add batch_id to notification_deliveries if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_deliveries' AND column_name = 'batch_id'
  ) THEN
    ALTER TABLE notification_deliveries ADD COLUMN batch_id uuid REFERENCES notification_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Expand the status CHECK constraint to include 'cancelled'
DO $$
BEGIN
  -- Drop existing constraint (name varies, so find it)
  PERFORM 1 FROM information_schema.check_constraints
    WHERE constraint_name LIKE '%notification_deliveries_status%';
  IF FOUND THEN
    EXECUTE (
      SELECT 'ALTER TABLE notification_deliveries DROP CONSTRAINT ' || constraint_name
      FROM information_schema.check_constraints
      WHERE constraint_name LIKE '%notification_deliveries_status%'
      LIMIT 1
    );
  END IF;
  -- Add updated constraint
  ALTER TABLE notification_deliveries
    ADD CONSTRAINT notification_deliveries_status_check
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'cancelled'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Status constraint update skipped: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_batches_created_at ON notification_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_batch_id ON notification_deliveries(batch_id);
