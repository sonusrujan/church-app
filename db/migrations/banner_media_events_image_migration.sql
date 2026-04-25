-- Migration: Ad banner media type + position, events/notifications image_url
-- Date: 2026-03-28

-- 1. Ad banners: add media_type and position columns (table may not exist on fresh deploy)
DO $$ BEGIN
  ALTER TABLE ad_banners
    ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image',
    ADD COLUMN IF NOT EXISTS position text NOT NULL DEFAULT 'bottom';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 2. Events: add image_url column
ALTER TABLE church_events
  ADD COLUMN IF NOT EXISTS image_url text;

-- 3. Notifications: add image_url column
ALTER TABLE church_notifications
  ADD COLUMN IF NOT EXISTS image_url text;

-- 4. Rename leadership role "DC" → "Deanery Chairman"
UPDATE leadership_roles SET name = 'Deanery Chairman' WHERE name = 'DC';
