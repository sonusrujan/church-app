-- Migration: Add location, end_time to church_events
-- For F-2: Event location & end time

ALTER TABLE church_events
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;

COMMENT ON COLUMN church_events.location IS 'Physical location or address of the event';
COMMENT ON COLUMN church_events.end_time IS 'Event end time (event_date is start)';
