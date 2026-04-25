-- Migration: Switch prayer_request_recipients from pastors table to church_leadership table
-- This drops the FK on pastor_id → pastors(id) and adds leader_id → church_leadership(id)

BEGIN;

-- 1. Add the new leader_id column
ALTER TABLE prayer_request_recipients
  ADD COLUMN IF NOT EXISTS leader_id uuid;

-- 2. Drop the old FK constraint on pastor_id
ALTER TABLE prayer_request_recipients
  DROP CONSTRAINT IF EXISTS prayer_request_recipients_pastor_id_fkey;

-- 3. Add new FK constraint on leader_id → church_leadership(id)
ALTER TABLE prayer_request_recipients
  ADD CONSTRAINT prayer_request_recipients_leader_id_fkey
    FOREIGN KEY (leader_id) REFERENCES church_leadership(id) ON DELETE CASCADE;

-- 4. Make pastor_id nullable (legacy data remains, new rows use leader_id)
ALTER TABLE prayer_request_recipients
  ALTER COLUMN pastor_id DROP NOT NULL;

-- 5. Create index on leader_id
CREATE INDEX IF NOT EXISTS prayer_request_recipients_leader_idx
  ON prayer_request_recipients(leader_id);

COMMIT;
