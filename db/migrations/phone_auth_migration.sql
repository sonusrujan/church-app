-- Phone Auth Migration
-- Adds phone_number column to users table for phone-based OTP authentication.
-- Run this against your PostgreSQL database before deploying the new auth code.

-- 1) Add phone_number column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number text;

-- 2) Unique index on phone_number (non-empty values only)
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_unique
  ON users(phone_number)
  WHERE phone_number IS NOT NULL AND phone_number != '';

-- 3) Default email to empty string for phone-only users
ALTER TABLE users ALTER COLUMN email SET DEFAULT '';
