-- ============================================================================
-- Migration 020: Multi-Church Junction Table (user_church_memberships)
--
-- Purpose: Support users belonging to multiple churches safely.
-- The `users.church_id` and `users.role` columns are KEPT for backward
-- compatibility during the dual-read transition period. They will be
-- dropped in a future migration after all code paths use the junction table.
--
-- Applied: 2026-04-18
-- ============================================================================

BEGIN;

-- 1. Create the junction table
CREATE TABLE IF NOT EXISTS user_church_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  church_id   uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES members(id) ON DELETE SET NULL,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  is_active   boolean NOT NULL DEFAULT true,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, church_id)
);

CREATE INDEX idx_ucm_user_id ON user_church_memberships(user_id);
CREATE INDEX idx_ucm_church_id ON user_church_memberships(church_id);
CREATE INDEX idx_ucm_member_id ON user_church_memberships(member_id) WHERE member_id IS NOT NULL;

-- 2. RLS on junction table
ALTER TABLE user_church_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_church_memberships FORCE ROW LEVEL SECURITY;

-- Tenanted access: see only your church's memberships
CREATE POLICY ucm_tenant ON user_church_memberships
  USING (
    app_church_id() IS NOT NULL AND church_id = app_church_id()
  );

-- Super-admin bypass (separate policy)
CREATE POLICY ucm_superadmin ON user_church_memberships
  USING (app_church_id() IS NULL);

-- 3. Backfill from existing data
-- For every user that has a church_id, create a junction row
INSERT INTO user_church_memberships (user_id, church_id, role, is_active, joined_at)
SELECT
  u.id,
  u.church_id,
  COALESCE(u.role, 'member'),
  true,
  COALESCE(u.created_at, now())
FROM users u
WHERE u.church_id IS NOT NULL
  AND u.role != 'super_admin'
ON CONFLICT (user_id, church_id) DO NOTHING;

-- 4. Link member_id where we can match user_id + church_id
UPDATE user_church_memberships ucm
SET member_id = m.id
FROM members m
WHERE ucm.user_id = m.user_id
  AND ucm.church_id = m.church_id
  AND m.deleted_at IS NULL
  AND ucm.member_id IS NULL;

-- 5. Backfill cross-church memberships that exist in members but not in users.church_id
-- (e.g., a user pre-registered in Church B but users.church_id points to Church A)
INSERT INTO user_church_memberships (user_id, church_id, member_id, role, is_active, joined_at)
SELECT
  m.user_id,
  m.church_id,
  m.id,
  COALESCE(u.role, 'member'),
  true,
  COALESCE(m.created_at, now())
FROM members m
JOIN users u ON u.id = m.user_id
WHERE m.user_id IS NOT NULL
  AND m.deleted_at IS NULL
  AND u.role != 'super_admin'
ON CONFLICT (user_id, church_id) DO UPDATE
  SET member_id = EXCLUDED.member_id
  WHERE user_church_memberships.member_id IS NULL;

-- 6. Add unique constraint on users.phone_number (one identity per phone)
-- Only if not already present — safely handle duplicates first
-- NOTE: If duplicate phones exist, keep the oldest row's phone and null the rest
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT phone_number, array_agg(id ORDER BY created_at ASC) AS ids
    FROM users
    WHERE phone_number IS NOT NULL AND phone_number != ''
    GROUP BY phone_number
    HAVING count(*) > 1
  LOOP
    -- Keep first (oldest), null out the rest
    UPDATE users SET phone_number = NULL
    WHERE id = ANY(dup.ids[2:])
      AND phone_number = dup.phone_number;
  END LOOP;
END $$;

-- Now safe to add unique index (partial — only non-null, non-empty phones)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON users (phone_number)
  WHERE phone_number IS NOT NULL AND phone_number != '';

-- 7. Partial unique on members(phone_number, church_id) for active members
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_phone_church_unique
  ON members (phone_number, church_id)
  WHERE phone_number IS NOT NULL AND phone_number != '' AND deleted_at IS NULL;

COMMIT;
