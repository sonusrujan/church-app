-- Migration: Fix RLS policies on family tables
-- 007 used subquery for family_member_requests but it has its own church_id.
-- Also add explicit WITH CHECK for INSERT support.

-- ── Fix family_members policy (add WITH CHECK) ──
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

-- ── Fix family_member_requests policy (use direct church_id + WITH CHECK) ──
DROP POLICY IF EXISTS "family_member_requests_tenant" ON family_member_requests;
CREATE POLICY "family_member_requests_tenant" ON family_member_requests
  FOR ALL
  USING (app_church_id() IS NULL OR church_id = app_church_id())
  WITH CHECK (app_church_id() IS NULL OR church_id = app_church_id());
