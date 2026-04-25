-- Migration 026: Scalability fixes (Audit items 1.1 + 2.7)
-- 1.1: Add missing indexes for common query patterns
-- 2.7: Subscription state machine enforcement

-- ═══════════════════════════════════════════════════════════
-- 1.1: MISSING INDEXES
-- ═══════════════════════════════════════════════════════════

-- 1. Church events: range queries by event_date do full scan
CREATE INDEX IF NOT EXISTS idx_church_events_church_date
  ON church_events(church_id, event_date DESC);

-- 2. Subscription reminders: daily reminder generation has no church+date index
CREATE INDEX IF NOT EXISTS idx_subscription_reminders_church_sent
  ON subscription_reminders(church_id, sent_at DESC);

-- 3. Notification deliveries: batch status lookup for processing
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_batch_status
  ON notification_deliveries(batch_id, status);

-- 4. Job queue: archival/cleanup queries need created_at index
CREATE INDEX IF NOT EXISTS idx_job_queue_created_at
  ON job_queue(created_at DESC);

-- 5. Family members: subscription status filter
CREATE INDEX IF NOT EXISTS idx_family_members_member_subscription
  ON family_members(member_id, has_subscription);


-- ═══════════════════════════════════════════════════════════
-- 2.7: SUBSCRIPTION STATUS STATE MACHINE
-- ═══════════════════════════════════════════════════════════
-- Valid transitions:
--   pending_first_payment → active, cancelled
--   active → overdue, paused, cancelled
--   overdue → active, paused, cancelled
--   paused → active, cancelled
--   cancelled → (terminal, no transitions out)

CREATE OR REPLACE FUNCTION enforce_subscription_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- cancelled is terminal
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot transition from cancelled status (subscription %)', OLD.id;
  END IF;

  -- pending_first_payment can only go to active or cancelled
  IF OLD.status = 'pending_first_payment' AND NEW.status NOT IN ('active', 'cancelled') THEN
    RAISE EXCEPTION 'Pending subscription can only transition to active or cancelled, got: %', NEW.status;
  END IF;

  -- active can go to overdue, paused, or cancelled
  IF OLD.status = 'active' AND NEW.status NOT IN ('overdue', 'paused', 'cancelled') THEN
    RAISE EXCEPTION 'Active subscription can only transition to overdue, paused, or cancelled, got: %', NEW.status;
  END IF;

  -- overdue can go to active, paused, or cancelled
  IF OLD.status = 'overdue' AND NEW.status NOT IN ('active', 'paused', 'cancelled') THEN
    RAISE EXCEPTION 'Overdue subscription can only transition to active, paused, or cancelled, got: %', NEW.status;
  END IF;

  -- paused can go to active or cancelled
  IF OLD.status = 'paused' AND NEW.status NOT IN ('active', 'cancelled') THEN
    RAISE EXCEPTION 'Paused subscription can only transition to active or cancelled, got: %', NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any (idempotent)
DROP TRIGGER IF EXISTS subscription_status_transition ON subscriptions;

CREATE TRIGGER subscription_status_transition
  BEFORE UPDATE OF status ON subscriptions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION enforce_subscription_status_transition();
