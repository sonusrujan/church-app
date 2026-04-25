-- ============================================================================
-- Migration 021: Cross-Tenant Security Hardening
--
-- Fixes:
-- SH-008: Add church_id to refresh_tokens to prevent session tenant drift
-- ============================================================================

BEGIN;

-- Add church_id to refresh_tokens (nullable for backward compat with existing tokens)
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES churches(id) ON DELETE SET NULL;

COMMIT;
