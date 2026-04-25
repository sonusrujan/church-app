-- Migration 023: Enforce subscriptions.church_id NOT NULL
-- Rationale: Every subscription must belong to a church for RLS and multi-tenant isolation.
-- Backfill strategy: derive church_id from the owning member's church.

BEGIN;

-- Step 1: Backfill any NULL church_id rows from the member's church
UPDATE subscriptions s
SET church_id = m.church_id
FROM members m
WHERE s.church_id IS NULL
  AND s.member_id = m.id
  AND m.church_id IS NOT NULL;

-- Step 2: Backfill via family_member → member → church for family subscriptions
UPDATE subscriptions s
SET church_id = m.church_id
FROM family_members fm
JOIN members m ON fm.member_id = m.id
WHERE s.church_id IS NULL
  AND s.family_member_id = fm.id
  AND m.church_id IS NOT NULL;

-- Step 3: Safety check — abort if any rows still have NULL church_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM subscriptions WHERE church_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot add NOT NULL: % subscription(s) still have NULL church_id after backfill',
      (SELECT count(*) FROM subscriptions WHERE church_id IS NULL);
  END IF;
END $$;

-- Step 4: Add NOT NULL constraint
ALTER TABLE subscriptions ALTER COLUMN church_id SET NOT NULL;

COMMIT;
