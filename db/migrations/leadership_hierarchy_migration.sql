-- Leadership Hierarchy Migration
-- Adds roles and church_leadership tables for hierarchical leadership management

-- 1. Leadership roles (global, reusable across churches)
CREATE TABLE IF NOT EXISTS leadership_roles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,
  hierarchy_level integer NOT NULL,  -- lower = higher rank (1 = highest)
  is_pastor_role boolean NOT NULL DEFAULT false,  -- DC, Presbyter, Pastor auto-added to pastors list
  description text,
  created_at timestamptz DEFAULT now()
);

-- Seed default roles
INSERT INTO leadership_roles (name, hierarchy_level, is_pastor_role, description)
VALUES
  ('Bishop',         1, false, 'Spiritual Overseer & Head of the Church'),
  ('DC',             2, true,  'Deanery Chairman — Regional Governance'),
  ('Presbyter',      3, true,  'Council of Elders — Spiritual Leadership'),
  ('Secretary',      4, false, 'Don Secretary — Administrative Leadership'),
  ('Treasurer',      5, false, 'Don Treasurer — Financial Leadership'),
  ('Vice President', 6, false, 'Don Vice President — Operational Leadership'),
  ('Pastor',         7, true,  'Local Congregation Care & Prayer Ministry')
ON CONFLICT (name) DO NOTHING;

-- 2. Church leadership assignments (per-church)
CREATE TABLE IF NOT EXISTS church_leadership (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES leadership_roles(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,      -- linked to existing member
  full_name text NOT NULL,                                        -- display name
  phone_number text,
  email text,
  photo_url text,
  bio text,                                                       -- short description / details
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS church_leadership_church_active_idx
  ON church_leadership(church_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS church_leadership_role_idx
  ON church_leadership(role_id);

CREATE INDEX IF NOT EXISTS church_leadership_member_idx
  ON church_leadership(member_id)
  WHERE member_id IS NOT NULL;

-- Prevent duplicate active assignment of same person to same role in same church
CREATE UNIQUE INDEX IF NOT EXISTS church_leadership_unique_active_assignment
  ON church_leadership(church_id, role_id, member_id)
  WHERE is_active = true AND member_id IS NOT NULL;
