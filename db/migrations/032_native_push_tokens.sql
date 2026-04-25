-- 032_native_push_tokens.sql
-- Extends push_subscriptions to also carry native device tokens (APNs / FCM).
-- Web-push rows still use endpoint + p256dh + auth.
-- Native-push rows use endpoint = "apns://<token>" | "fcm://<token>" with
-- p256dh/auth NULL and platform populated.

BEGIN;

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS platform text
    CHECK (platform IN ('web', 'ios', 'android')) DEFAULT 'web';

ALTER TABLE push_subscriptions
  ALTER COLUMN p256dh DROP NOT NULL,
  ALTER COLUMN auth DROP NOT NULL;

-- Per-platform app identifier (capacitor appId for native, origin for web)
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS app_id text;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_platform
  ON push_subscriptions(platform)
  WHERE platform IN ('ios', 'android');

COMMIT;
