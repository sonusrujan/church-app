-- ============================================================
-- Migration 013: Phone-Only Identity Migration
-- Makes email optional across all tables, phone becomes primary
-- ============================================================

-- 1. users: make email truly optional (allow NULL, keep default '')
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email SET DEFAULT '';

-- 2. members: make email optional
ALTER TABLE members ALTER COLUMN email DROP NOT NULL;
ALTER TABLE members ALTER COLUMN email SET DEFAULT '';

-- Drop the old unique email+church constraint (email no longer unique identifier)
DROP INDEX IF EXISTS members_email_church_unique;

-- Add unique phone+church constraint (phone is now primary identifier per church)
CREATE UNIQUE INDEX IF NOT EXISTS members_phone_church_unique
  ON members(phone_number, church_id)
  WHERE deleted_at IS NULL AND phone_number IS NOT NULL AND phone_number != '';

-- 3. prayer_requests: make member_email optional, add member_phone
ALTER TABLE prayer_requests ALTER COLUMN member_email DROP NOT NULL;
ALTER TABLE prayer_requests ALTER COLUMN member_email SET DEFAULT '';
DO $$ BEGIN
  ALTER TABLE prayer_requests ADD COLUMN member_phone text DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 4. membership_requests: make email optional, add phone
ALTER TABLE membership_requests ALTER COLUMN email DROP NOT NULL;
ALTER TABLE membership_requests ALTER COLUMN email SET DEFAULT '';
DO $$ BEGIN
  ALTER TABLE membership_requests ADD COLUMN phone_number text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Drop old email-based unique index for membership requests
DROP INDEX IF EXISTS membership_requests_church_email_pending_idx;

-- Add phone-based unique index for membership requests
CREATE UNIQUE INDEX IF NOT EXISTS membership_requests_church_phone_pending_idx
  ON membership_requests(church_id, phone_number)
  WHERE status = 'pending' AND phone_number IS NOT NULL AND phone_number != '';

-- 5. admin_audit_log: add actor_phone column
DO $$ BEGIN
  ALTER TABLE admin_audit_log ADD COLUMN actor_phone text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 6. scheduled_reports: add recipient_phones array
DO $$ BEGIN
  ALTER TABLE scheduled_reports ADD COLUMN recipient_phones text[] NOT NULL DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Done
