-- Migration 015: Add occupation, confirmation_taken, age columns to members table
-- Also sets verification_status default to 'verified'

-- 1. Add new columns
ALTER TABLE members ADD COLUMN IF NOT EXISTS occupation text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS confirmation_taken boolean DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS age integer;

-- 2. Change default verification_status from 'pending' to 'verified'
ALTER TABLE members ALTER COLUMN verification_status SET DEFAULT 'verified';

-- 3. Make email optional (was NOT NULL, but phone-first means email may be absent)
ALTER TABLE members ALTER COLUMN email DROP NOT NULL;
