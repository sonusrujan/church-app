-- Family Member Request (Search + Approval) Migration
-- Adds family_member_requests table for the approval workflow
-- Adds linked_to_member_id column on family_members for linking to existing members

-- 1. Add linked_to_member_id on family_members (points to the *target* member being added as family)
ALTER TABLE family_members
  ADD COLUMN IF NOT EXISTS linked_to_member_id uuid REFERENCES members(id) ON DELETE SET NULL;

-- A member can only be linked as a family member to ONE parent member
CREATE UNIQUE INDEX IF NOT EXISTS family_members_linked_member_unique
  ON family_members(linked_to_member_id)
  WHERE linked_to_member_id IS NOT NULL;

-- 2. Family member request table
CREATE TABLE IF NOT EXISTS family_member_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  requester_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  target_member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  relation text NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, auto_rejected
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  rejection_reason text,  -- machine-set reason for auto-rejections
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS family_member_requests_church_status_idx
  ON family_member_requests(church_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS family_member_requests_requester_idx
  ON family_member_requests(requester_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS family_member_requests_target_idx
  ON family_member_requests(target_member_id, status);

-- Prevent duplicate pending requests for the same target member
CREATE UNIQUE INDEX IF NOT EXISTS family_member_requests_target_pending_idx
  ON family_member_requests(target_member_id)
  WHERE status = 'pending';
