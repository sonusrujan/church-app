# Backend Codebase Audit Report

**Date:** 2025-01-XX  
**Scope:** Full Node.js + Express + TypeScript backend (`src/`, `db/`)  
**Schema Authority:** `db/aws_rds_full_schema.sql` (36 tables + runtime migrations in `src/index.ts`)

---

## Executive Summary

The audit uncovered **3 CRITICAL**, **4 HIGH**, **3 MEDIUM**, and **3 LOW** issues. The most dangerous finding is a **schema conflict** between `aws_rds_full_schema.sql` and `src/index.ts` runtime migrations for the `refresh_tokens` table — deploying the schema file first causes all authentication token operations to crash. Five tables and several columns are missing from the canonical schema file but are created by runtime migrations, creating a fragile deployment story.

---

## CRITICAL Issues

### C-1: `refresh_tokens` Schema Conflict — Auth Token System Broken on Schema-First Deploy

| Field | Detail |
|---|---|
| **Files** | `db/aws_rds_full_schema.sql:167-176`, `src/index.ts:19-43`, `src/services/refreshTokenService.ts:31-101` |
| **Severity** | **CRITICAL** |
| **Category** | DB schema mismatch / deployment hazard |

**Problem:**  
`aws_rds_full_schema.sql` line 173 defines `refresh_tokens` with `revoked_at timestamptz` and NO `updated_at` column. But `src/index.ts` migration `013_refresh_tokens` (line 19) creates the same table with `revoked boolean NOT NULL DEFAULT false` and `updated_at timestamptz DEFAULT now()`.

`refreshTokenService.ts` uses:
- `revoked` (boolean) — lines 31, 39, 46, 53, 59, 74, 93, 95, 101
- `updated_at` — line 47

The runtime migration uses `CREATE TABLE IF NOT EXISTS`, which is a **no-op** if the table already exists from the schema file.

**Runtime Impact:**  
If `aws_rds_full_schema.sql` runs before the app starts:
- Table is created with `revoked_at` (not `revoked`) and without `updated_at`
- All `.eq("revoked", false)` and `.update({ revoked: true })` calls throw **column "revoked" does not exist**
- Login, token rotation, logout, and admin role-change operations **all crash**
- Users cannot authenticate after initial JWT expires

**Fix:**  
Update `aws_rds_full_schema.sql` to match the runtime migration: replace `revoked_at timestamptz` with `revoked boolean NOT NULL DEFAULT false` and add `updated_at timestamptz DEFAULT now()`. Add the trigger function.

---

### C-2: `image_url` Column Missing on `church_events` and `church_notifications` — Not in Any Automated Migration

| Field | Detail |
|---|---|
| **Files** | `src/services/engagementService.ts:18,43-44,55,59,73,90,100-101,111,115,132,154,177-178,186`, `db/migrations/banner_media_events_image_migration.sql:11-17` |
| **Severity** | **CRITICAL** |
| **Category** | Missing DB column / migration gap |

**Problem:**  
`engagementService.ts` reads and writes `image_url` on both `church_events` and `church_notifications` tables in 15+ locations. This column is added by `db/migrations/banner_media_events_image_migration.sql`, but:
1. **NOT** in `aws_rds_full_schema.sql` (church_events defined at line 285, church_notifications at line 299 — neither includes `image_url`)
2. **NOT** in `src/index.ts` runtime migrations (confirmed — no migration adds these columns)

The migration file exists but must be **run manually**. There's no automated mechanism to apply it.

**Runtime Impact:**  
On a fresh deployment (schema file + runtime migrations):
- All event/notification creation calls fail: `column "image_url" does not exist`
- All event/notification list queries fail (select includes `image_url`)
- All event/notification update calls fail
- Affects 8 API endpoints under `/api/engagement/*`

**Fix:**  
Either add `image_url text` to both CREATE TABLE statements in `aws_rds_full_schema.sql`, or add a new runtime migration in `src/index.ts` that runs `ALTER TABLE church_events ADD COLUMN IF NOT EXISTS image_url text` and `ALTER TABLE church_notifications ADD COLUMN IF NOT EXISTS image_url text`.

---

### C-3: `ad_banners` Columns `media_type` and `position` Not in Runtime Migration

| Field | Detail |
|---|---|
| **Files** | `src/services/adBannerService.ts` (entire file), `src/index.ts:70-91` (migration 009), `db/migrations/banner_media_events_image_migration.sql:5-9` |
| **Severity** | **CRITICAL** |
| **Category** | Missing DB columns / migration gap |

**Problem:**  
Runtime migration `009_diocese_media_and_ads` in `src/index.ts` creates `ad_banners` with columns: `id, scope, scope_id, image_url, link_url, sort_order, is_active, created_by, created_at, updated_at`. The separate migration file `banner_media_events_image_migration.sql` adds `media_type` and `position` columns, but this migration is **not** in `src/index.ts` and **not** in `aws_rds_full_schema.sql`.

If `adBannerService.ts` selects or inserts `media_type` or `position`:

```
.select("id, scope, scope_id, image_url, link_url, media_type, position, ...")
```

These queries will crash if the external migration hasn't been applied.

**Runtime Impact:**  
Ad banner CRUD operations may crash with `column "media_type" does not exist` on fresh deployments.

**Fix:**  
Add `media_type` and `position` columns to the `CREATE TABLE ad_banners` statement in `src/index.ts` migration `009`, or add a new runtime migration.

---

## HIGH Issues

### H-1: `aws_rds_full_schema.sql` Missing 5 Tables — Schema File Unreliable for Deployment

| Field | Detail |
|---|---|
| **Files** | `db/aws_rds_full_schema.sql`, `src/index.ts:70-148` |
| **Severity** | **HIGH** |
| **Category** | Schema drift / deployment hazard |

**Problem:**  
The following tables are **completely absent** from `aws_rds_full_schema.sql` but are created by runtime migrations in `src/index.ts`:

| Table | Runtime Migration | Service File |
|---|---|---|
| `platform_config` | `007_platform_config` (line 137) | `platformConfigService.ts` |
| `dioceses` | `008_diocese` (line 93) | `dioceseService.ts` |
| `diocese_churches` | `008_diocese` (line 93) | `dioceseService.ts` |
| `diocese_leadership` | `008_diocese` (line 93) | `dioceseService.ts` |
| `ad_banners` | `009_diocese_media_and_ads` (line 70) | `adBannerService.ts` |

**Runtime Impact:**  
These tables DO get created by the runtime migrations when the app starts, so they won't crash in normal operation. However:
- The schema file is misleading/incomplete — anyone using it for reference, DB inspection, or manual deployment will be missing 5 tables
- CI/CD pipelines that seed a DB from `aws_rds_full_schema.sql` before running tests will fail for diocese, ad banner, and SaaS routes
- The runtime migration for `refresh_tokens` (C-1 above) conflicts with the schema's version

**Fix:**  
Add all 5 CREATE TABLE statements to `aws_rds_full_schema.sql`. Remove the stale `refresh_tokens` definition and replace with the correct one.

---

### H-2: `logo_url` Column Missing from `churches` Table in Schema File

| Field | Detail |
|---|---|
| **Files** | `db/aws_rds_full_schema.sql:21-44`, `src/index.ts:149-150` (migration 006), `src/services/churchService.ts:71,86,269,295,333-334,363` |
| **Severity** | **HIGH** |
| **Category** | Schema drift |

**Problem:**  
`churches` table in `aws_rds_full_schema.sql` (lines 21-44) does NOT include `logo_url`. It's only added by runtime migration `006_church_logo`: `ALTER TABLE churches ADD COLUMN IF NOT EXISTS logo_url text`.

`churchService.ts` references `logo_url` in 6+ locations for create, update, select, and the dedicated PATCH `/my-logo` endpoint.

**Runtime Impact:**  
Works at runtime (migration adds it), but schema file is incorrect. Same deployment risks as H-1.

**Fix:**  
Add `logo_url text` to the `churches` CREATE TABLE in `aws_rds_full_schema.sql`.

---

### H-3: Runtime Migration Ordering Inconsistency

| Field | Detail |
|---|---|
| **Files** | `src/index.ts:17-363` |
| **Severity** | **HIGH** |
| **Category** | Migration ordering |

**Problem:**  
Migrations in the array are **not** in ascending numerical order:
```
013_refresh_tokens
012_other_role_custom_fields
011_diocese_logos_array
010_committee_sexton_roles
009_diocese_media_and_ads
008_diocese
007_platform_config
006_church_logo
005_prayer_leadership
003_qa_audit_fixes
004_rpc_subscription_update_guard  ← out of order
```

Migrations are listed newest-first (013 → 003), so they execute in **reverse chronological** order. For these specific migrations this works because they use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, and similar idempotent patterns. But adding a future migration that depends on a prior one would break if the order is not corrected.

Additionally, migration `004_rpc_subscription_update_guard` appears AFTER `003_qa_audit_fixes` in the array, meaning `004` runs after `003` despite numericaly coming before. This is only safe because they're independent.

**Runtime Impact:**  
No current breakage, but a latent ordering bug that will cause failures if dependencies are introduced between migrations.

**Fix:**  
Reorder migrations ascending (003 → 013) to match conventional migration ordering.

---

### H-4: No Automated Process for `db/migrations/` Files

| Field | Detail |
|---|---|
| **Files** | `db/migrations/` (20+ files), `src/index.ts` |
| **Severity** | **HIGH** |
| **Category** | Deployment gap |

**Problem:**  
The `db/migrations/` directory contains 20+ migration files, but `src/index.ts` only runs its own inline migrations (003-013). There is no code that discovers or applies files from `db/migrations/`. Critical migrations like `banner_media_events_image_migration.sql` (which adds `image_url` columns — see C-2) exist solely in this directory and must be applied **manually**.

**Runtime Impact:**  
If any migration in `db/migrations/` hasn't been manually applied to the database, the features depending on those schema changes will crash. There's no way to verify completeness automatically.

**Fix:**  
Either incorporate all needed `db/migrations/` changes into `src/index.ts` runtime migrations, or build a migration runner that processes files from `db/migrations/` in order.

---

## MEDIUM Issues

### M-1: Dead Import in `authRoutes.ts`

| Field | Detail |
|---|---|
| **Files** | `src/routes/authRoutes.ts:17` |
| **Severity** | **MEDIUM** |
| **Category** | Dead code / unused import |

**Problem:**  
`getRegisteredUserByPhone` is imported from `../services/userService` at line 17 but is **never called** anywhere in `authRoutes.ts`.

**Runtime Impact:**  
No crash. Tree-shaking doesn't apply at runtime in Node.js, so it's dead code that increases the import surface unnecessarily.

**Fix:**  
Remove the unused import.

---

### M-2: Google OAuth Env Vars Have Silent Empty-String Defaults

| Field | Detail |
|---|---|
| **Files** | `src/config.ts`, `src/routes/googleAuthRoutes.ts` |
| **Severity** | **MEDIUM** |
| **Category** | Configuration / silent failure |

**Problem:**  
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are used by `googleAuthRoutes.ts` but are not in the `requiredEnv` array in `config.ts`. They default to empty strings. If not configured:
- The Google OAuth URL will be malformed (empty client_id in query string)
- The token exchange will fail with a cryptic Google API error
- No startup-time validation warns the operator

**Runtime Impact:**  
Google OAuth login fails silently with unhelpful errors if env vars aren't set. Not a crash, but a poor deployment experience.

**Fix:**  
Either add these to `requiredEnv` (if Google auth is mandatory) or add a startup warning log if they're empty.

---

### M-3: `reconcilePendingPayments` Counter Bug

| Field | Detail |
|---|---|
| **Files** | `src/services/paymentReconciliationService.ts:14-16,27` |
| **Severity** | **MEDIUM** |
| **Category** | Logic error |

**Problem:**  
The function returns `{ reconciled, failed, already_ok, manual_review }` but the `reconciled` counter is **never incremented** — it always returns `0`. The `already_ok` counter is incremented when a payment is found (Razorpay=paid, DB=paid), but the `reconciled` counter (new reconciliation) is never used.

**Runtime Impact:**  
The reconciliation report always shows `reconciled: 0` regardless of actual reconciliation results. Misleading operational metrics.

**Fix:**  
Either remove the `reconciled` counter or increment it in the appropriate branch.

---

## LOW Issues

### L-1: `banner_media_events_image_migration.sql` ALTERs `ad_banners` Before It May Exist

| Field | Detail |
|---|---|
| **Files** | `db/migrations/banner_media_events_image_migration.sql:5-9` |
| **Severity** | **LOW** |
| **Category** | Migration dependency |

**Problem:**  
This migration runs `ALTER TABLE ad_banners ADD COLUMN IF NOT EXISTS media_type ...` and `ADD COLUMN IF NOT EXISTS position ...`. The `ad_banners` table is only created by runtime migration `009` in `src/index.ts`. If this migration file is applied **before** the app has ever started (before migration 009 runs), it will fail with `relation "ad_banners" does not exist`.

**Runtime Impact:**  
Migration fails if run out of order. No impact on running application.

---

### L-2: Unused Service Files (Background Job Only)

| Field | Detail |
|---|---|
| **Files** | `src/services/notificationService.ts`, `src/services/subscriptionReminderService.ts`, `src/services/mailerService.ts` |
| **Severity** | **LOW** |
| **Category** | Code organization |

**Problem:**  
These services are not imported by any route file — they are only used by `src/jobs/scheduler.ts` and `src/services/jobQueueService.ts` for background processing. This is not a bug but makes it unclear which services power API endpoints vs. background jobs.

**Runtime Impact:**  
None.

---

### L-3: `aws_rds_full_schema.sql` Header Says "Generated 2026-03-24"

| Field | Detail |
|---|---|
| **Files** | `db/aws_rds_full_schema.sql:3` |
| **Severity** | **LOW** |
| **Category** | Stale metadata |

**Problem:**  
The schema file header says "Generated: 2026-03-24" but it's missing tables and columns that were added by migrations after that date (dioceses, ad_banners, platform_config, logo_url, image_url, etc.). The file hasn't been regenerated to reflect current state.

---

## Summary Table

| ID | Severity | Issue | Status |
|---|---|---|---|
| C-1 | **CRITICAL** | `refresh_tokens` schema conflict — auth breaks on schema-first deploy | Open |
| C-2 | **CRITICAL** | `image_url` missing from `church_events`/`church_notifications` — no automated migration | Open |
| C-3 | **CRITICAL** | `ad_banners` columns `media_type`/`position` not in runtime migration | Open |
| H-1 | **HIGH** | Schema file missing 5 tables created by runtime migrations | Open |
| H-2 | **HIGH** | `logo_url` missing from `churches` in schema file | Open |
| H-3 | **HIGH** | Runtime migration array in reverse/inconsistent order | Open |
| H-4 | **HIGH** | No automated runner for `db/migrations/` files | Open |
| M-1 | **MEDIUM** | Dead import `getRegisteredUserByPhone` in `authRoutes.ts` | Open |
| M-2 | **MEDIUM** | Google OAuth env vars silently default to empty strings | Open |
| M-3 | **MEDIUM** | `reconciled` counter never incremented in reconciliation service | Open |
| L-1 | **LOW** | External migration ALTERs `ad_banners` before table may exist | Open |
| L-2 | **LOW** | Some services only used by background jobs, not routes | Open |
| L-3 | **LOW** | Schema file header date stale | Open |

---

## What Passed Audit (No Issues Found)

- **All 20 route files** are properly registered in `src/app.ts`
- **All route handler imports** resolve to existing exported functions in their respective services (except M-1 dead import)
- **Middleware chains** are correctly applied: all protected routes use `requireAuth` + `requireRegisteredUser`; public routes (OTP, webhook, OAuth callback) correctly omit auth middleware
- **The single `.rpc()` call** to `process_subscription_payments_batch` (in `paymentRoutes.ts:622`) references a function that exists in the schema
- **Core tables** used by member, subscription, payment, announcement, prayer request, family member, and pastor services all exist with correct columns
- **Rate limiters** are applied to sensitive routes (payment creation, OTP, membership requests)
- **No SQL injection vectors** found — all queries use parameterized queries via the custom query builder or `$1`-style params in `rawQuery` calls
- **Input sanitization** (`inputSanitizer.ts` middleware) is applied globally via `app.use()`
- **`linked_to_member_id`** on `family_members` ✓ exists (schema line 237)
- **`preferred_language`** and **`dark_mode`** on `users` ✓ exist (schema lines 147-148)
- **`payment_category`** on `payments` ✓ exists (schema line 565 area)
- **`subscription_minimum`** on `churches` ✓ exists (schema line 43)
