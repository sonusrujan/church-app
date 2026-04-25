-- Migration 016: Account deletion requests
-- Allows members to request account deletion, reviewed by church admins

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_church_status
  ON account_deletion_requests (church_id, status);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_member
  ON account_deletion_requests (member_id);

-- Prevent duplicate pending requests per member
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_requests_pending_unique
  ON account_deletion_requests (member_id) WHERE status = 'pending';
