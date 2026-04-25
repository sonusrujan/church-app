-- Migration: Enable RLS on family_members and family_member_requests tables
-- Uses the app_church_id() GUC pattern (RDS-compatible)

-- ── family_members ──
ALTER TABLE IF EXISTS family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS family_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_members_tenant" ON family_members;
CREATE POLICY "family_members_tenant" ON family_members
  FOR ALL
  USING (
    app_church_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = family_members.member_id
        AND m.church_id = app_church_id()
    )
  )
  WITH CHECK (
    app_church_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = family_members.member_id
        AND m.church_id = app_church_id()
    )
  );

-- ── family_member_requests (has its own church_id column) ──
ALTER TABLE IF EXISTS family_member_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS family_member_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_member_requests_tenant" ON family_member_requests;
CREATE POLICY "family_member_requests_tenant" ON family_member_requests
  FOR ALL
  USING (app_church_id() IS NULL OR church_id = app_church_id())
  WITH CHECK (app_church_id() IS NULL OR church_id = app_church_id());
