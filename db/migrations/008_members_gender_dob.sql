-- Migration: Add gender and dob columns to members table
-- These columns exist on family_members but were missing from members

ALTER TABLE members ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS dob date;
