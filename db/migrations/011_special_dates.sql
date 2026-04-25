-- Migration: 011_special_dates.sql
-- Feature: Special dates (birthday, anniversary) for church members
-- Used for sending wishes on behalf of the church

CREATE TABLE IF NOT EXISTS member_special_dates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  occasion_type text NOT NULL CHECK (occasion_type IN ('birthday', 'anniversary')),
  occasion_date date NOT NULL,
  person_name text NOT NULL,
  spouse_name text,  -- only for anniversary
  notes text,
  is_from_profile boolean NOT NULL DEFAULT false,  -- true = auto-synced from member DOB
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_special_dates_church ON member_special_dates(church_id);
CREATE INDEX IF NOT EXISTS idx_special_dates_member ON member_special_dates(member_id);
CREATE INDEX IF NOT EXISTS idx_special_dates_date ON member_special_dates(church_id, occasion_date);
CREATE INDEX IF NOT EXISTS idx_special_dates_month_day
  ON member_special_dates(church_id, EXTRACT(MONTH FROM occasion_date), EXTRACT(DAY FROM occasion_date));

-- Prevent exact duplicate entries (same member, occasion, date, person)
CREATE UNIQUE INDEX IF NOT EXISTS idx_special_dates_unique
  ON member_special_dates(member_id, occasion_type, occasion_date, person_name)
  WHERE is_from_profile = false;
