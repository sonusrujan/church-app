-- Migration 024: Enforce NOT NULL on announcements.church_id and subscription_events.church_id
-- Rationale: Every announcement and subscription event must belong to a church for multi-tenant isolation.

BEGIN;

-- ── announcements.church_id ──

-- Backfill: announcements should always have a church_id (via created_by → users → church_id)
UPDATE announcements a
SET church_id = u.church_id
FROM users u
WHERE a.church_id IS NULL
  AND a.created_by = u.id
  AND u.church_id IS NOT NULL;

-- Safety: delete orphaned announcements with no church (should not exist in practice)
DELETE FROM announcements WHERE church_id IS NULL;

ALTER TABLE announcements ALTER COLUMN church_id SET NOT NULL;

-- ── subscription_events.church_id ──

-- Backfill from subscription → church_id (subscriptions.church_id is now NOT NULL per migration 023)
UPDATE subscription_events se
SET church_id = s.church_id
FROM subscriptions s
WHERE se.church_id IS NULL
  AND se.subscription_id = s.id;

-- Backfill remaining via member → church_id
UPDATE subscription_events se
SET church_id = m.church_id
FROM members m
WHERE se.church_id IS NULL
  AND se.member_id = m.id
  AND m.church_id IS NOT NULL;

-- Safety check
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM subscription_events WHERE church_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot add NOT NULL: % subscription_events row(s) still have NULL church_id',
      (SELECT count(*) FROM subscription_events WHERE church_id IS NULL);
  END IF;
END $$;

ALTER TABLE subscription_events ALTER COLUMN church_id SET NOT NULL;

COMMIT;
