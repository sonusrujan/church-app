-- Migration: Add start_date and end_date to ad_banners for date-based scheduling
-- These columns allow banners to be shown only within a specific date range.

DO $$ BEGIN
  ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT NULL;
  ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS end_date DATE DEFAULT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
