# COMPREHENSIVE QA TESTING REPORT — APRIL 2026

**Application:** Shalom Church Management SaaS  
**Stack:** Express.js + React 18 + TypeScript + PostgreSQL 17 + AWS (ECS Fargate, RDS, S3, CloudFront)  
**Audit Date:** April 8, 2026  
**Auditor Role:** Senior Manual Tester — Full A-Z Functionality Audit  
**Prior Audit:** June 2025 (scored 4.5/10 with 97 issues, 14 Critical)

---

## EXECUTIVE SUMMARY

| Metric | June 2025 | April 2026 | Verdict |
|--------|-----------|------------|---------|
| **Overall App Quality** | 4.5 / 10 | **7.5 / 10** | Major improvement |
| **Security Score** | 3.0 / 10 | **8.0 / 10** | Most critical vulns fixed |
| **Total Issues** | 97 | **34** | 65% reduction |
| **Critical Issues** | 14 | **4** (all DB schema drift) | 71% reduction |
| **Go/No-Go** | NO-GO | **CONDITIONAL GO** | See Phase 1 blockers |

---

## WHAT'S FIXED — JUNE 2025 → APRIL 2026 (63 Issues Resolved)

### Security Fixes (All 14 Critical + Most High)

| Old ID | Issue | Status |
|--------|-------|--------|
| CRIT-1 | `requireActiveChurch` fails open on DB error | **FIXED** — returns 503 |
| CRIT-2 | JWT role privilege escalation — no DB re-validation | **FIXED** — DB lookup with 15s TTL cache |
| CRIT-3 | ~25 admin actions have no audit trail | **FIXED** — `persistAuditLog` on all admin routes |
| CRIT-4 | Missing OAuth state parameter (CSRF) | **FIXED** — crypto.randomBytes(32) + httpOnly cookie |
| CRIT-5 | Cross-church IDOR on payment history | **FIXED** — church_id scoping + ownership verification |
| CRIT-6 | Unbounded payment query — server OOM risk | **FIXED** — SQL aggregation with SUM/GROUP BY |
| CRIT-7 | i18n system completely dead | **PARTIALLY FIXED** — 11/12 user pages use `t()` |
| CRIT-8 | Webhook signature fallback key confusion attack | **FIXED** — global key only |
| CRIT-9 | No unique constraint on member email per church | **FIXED** (in migration 003) |
| CRIT-10 | Failed auth attempts not logged | **FIXED** — logged with IP and path |
| CRIT-11 | Access token in URL query string | **FIXED** — httpOnly cookie + `/auth/callback?google=1` flag only |
| CRIT-12 | Payments table missing `church_id` | **FIXED** (in migration 003) |
| CRIT-13 | Connection pool × ECS instances > RDS max | **FIXED** — max=20, pool monitoring |
| CRIT-14 | Audit log table fully mutable | **FIXED** (in migration 003 — INSERT-only + rules) |

### Other Fixed Items

| Category | Fixed |
|----------|-------|
| CORS locked to FRONTEND_URL in prod | ✅ |
| Express body limit set (1MB) | ✅ |
| HSTS via Helmet | ✅ |
| 4-tier rate limiting (general/auth/payment/sensitive) | ✅ |
| Content-Type enforcement on mutations | ✅ |
| Input sanitizer covers body AND query | ✅ |
| Pino PII redaction (auth, cookies, OTP, secrets) | ✅ |
| Request correlation/trace IDs | ✅ |
| superAdminAudit writes to DB + stdout | ✅ |
| Cross-church isolation on all tenant routes | ✅ |
| Webhook idempotency (insert-first dedup) | ✅ |
| Razorpay SDK error handling wrapped | ✅ |
| Payment reconciliation bounded (50 items, 5 concurrent) | ✅ |
| `requireRegisteredUser` generic error messages | ✅ |
| OTP brute force: 5 attempts + 15min lockout + timing-safe | ✅ |
| Refresh token rotation with 30s grace window | ✅ |
| Refresh tokens hashed (SHA-256) in DB | ✅ |
| Leadership cross-church assignment prevented | ✅ |
| Pastor list requires church_id | ✅ |
| Member list returns empty for no church_id | ✅ |
| Family request cross-church bypass prevented | ✅ |
| Prayer request email manipulation prevented | ✅ |
| AdminConsolePage split into 36 lazy-loaded tabs (was 3200-line monolith) | ✅ |
| Skip-to-content link added | ✅ |
| aria-live on toast notifications | ✅ |
| Hamburger menu aria-expanded | ✅ |
| ErrorBoundary wraps all routes | ✅ |
| Login form uses `<form>` tag with implicit label association | ✅ |
| EmptyState component for zero-data scenarios | ✅ |
| ValidatedInput for inline phone/email validation | ✅ |
| Custom confirmation modal (replaced `window.prompt()` for super-admin) | ✅ |
| Service worker offline fallback (`/offline.html`) | ✅ |
| Comprehensive dark mode design system | ✅ |
| Advisory locks for job scheduler (prevents overlap) | ✅ |
| SQL-level aggregation for analytics | ✅ |
| Batch operations for subscriptions/notifications | ✅ |

---

## REMAINING ISSUES (34 Total)

---

### CRITICAL (4 Issues) — All Database Schema Drift

These are CRITICAL because a fresh deploy from `aws_rds_full_schema.sql` alone would miss all protection from migrations 003–012.

---

#### DB-CRIT-1: Consolidated Schema Missing `members_email_church_unique` Index

- **File:** [db/aws_rds_full_schema.sql](db/aws_rds_full_schema.sql)
- **Description:** Migration 003 correctly creates `CREATE UNIQUE INDEX members_email_church_unique ON members(LOWER(email), church_id) WHERE deleted_at IS NULL`. The consolidated schema has only a plain `members_email_idx(email)` — no uniqueness per church.
- **Impact:** A fresh deploy allows duplicate member emails within the same church, corrupting subscriptions and payments.
- **Fix:** Add the unique index to `aws_rds_full_schema.sql`.

---

#### DB-CRIT-2: Consolidated Schema Missing Audit Log INSERT-Only Protection

- **File:** [db/aws_rds_full_schema.sql](db/aws_rds_full_schema.sql)
- **Description:** Migration 003 adds `audit_log_insert_only` policy + `audit_no_update`/`audit_no_delete` rules. None of these exist in the consolidated schema.
- **Impact:** Fresh deploy leaves audit log fully mutable — records can be tampered with.
- **Fix:** Add INSERT-only policy and rules to `aws_rds_full_schema.sql`.

---

#### DB-CRIT-3: `payment_method` CHECK Constraint Blocks Valid Inserts

- **File:** [db/migrations/004_additional_qa_fixes.sql](db/migrations/004_additional_qa_fixes.sql)
- **Description:** CHECK constraint allows: `cash, cheque, bank_transfer, upi, card, razorpay, other`. But `process_subscription_payments_batch` function inserts `'subscription_paynow'` — NOT in the allowed list.
- **Impact:** Every call to the batch payment function fails with a CHECK violation. Subscription auto-payments are broken.
- **Fix:** Add `'subscription_paynow'` (and any `manual_*` variants) to the CHECK constraint.

---

#### DB-CRIT-4: Consolidated Schema Function Missing `church_id` in Payment INSERT

- **File:** [db/aws_rds_full_schema.sql](db/aws_rds_full_schema.sql)
- **Description:** `process_subscription_payments_batch` function in the consolidated schema omits `church_id` from the INSERT. The atomic migration file has the correct version with `church_id`.
- **Impact:** Fresh deploy creates payments with NULL `church_id`, breaking RLS tenant isolation for all auto-generated payments.
- **Fix:** Sync the consolidated schema function with `atomic_subscription_payment_migration.sql`.

---

### HIGH (8 Issues)

---

#### HIGH-1: `member_special_dates` Table Has No RLS

- **File:** [db/migrations/011_special_dates.sql](db/migrations/011_special_dates.sql)
- **Description:** Table has `church_id` column but `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is never called. No RLS policy exists.
- **Impact:** Cross-tenant data leakage — birthday/anniversary data accessible across churches via direct DB queries.
- **Fix:** Add `ALTER TABLE member_special_dates ENABLE ROW LEVEL SECURITY` + tenant policy.

---

#### HIGH-2: Admin Tab `deleteAdmin()` — No Confirmation Dialog

- **File:** [frontend/src/pages/admin-tabs/AdminOpsTab.tsx](frontend/src/pages/admin-tabs/AdminOpsTab.tsx)
- **Description:** Removing an admin role is a single click with no confirmation modal. The app has `openOperationConfirmDialog` in context but this tab doesn't use it.
- **Impact:** Accidental admin removal with one click.
- **Fix:** Wire up `openOperationConfirmDialog` for admin deletion.

---

#### HIGH-3: Admin Tab `deleteMember()` — No Confirmation Dialog

- **File:** [frontend/src/pages/admin-tabs/MemberOpsTab.tsx](frontend/src/pages/admin-tabs/MemberOpsTab.tsx)
- **Description:** "Preview Delete Impact" exists but the actual delete action has no confirmation step.
- **Impact:** Accidental member soft-deletion with cascading impacts to subscriptions and payments.
- **Fix:** Add confirmation dialog before executing delete.

---

#### HIGH-4: Refunds Tab — No Confirmation, No Amount Ceiling

- **File:** [frontend/src/pages/admin-tabs/RefundsTab.tsx](frontend/src/pages/admin-tabs/RefundsTab.tsx)
- **Description:** Recording an irreversible refund has no confirmation dialog. While backend validates refund amount, the UI doesn't show a clear ceiling or require confirmation.
- **Impact:** Accidental refund recording.
- **Fix:** Add confirmation modal showing original payment amount and refund amount.

---

#### HIGH-5: Grace Period Cancellation — No Notification to Member

- **File:** [src/services/subscriptionReminderService.ts](src/services/subscriptionReminderService.ts)
- **Description:** When `enforceGracePeriods()` auto-cancels a subscription, no notification (email/SMS/push) is sent to the member. They get overdue reminders but no "your subscription has been cancelled" message.
- **Impact:** Members discover cancellation only when they check the app. Poor user experience.
- **Fix:** Send a cancellation notification in `enforceGracePeriods()`.

---

#### HIGH-6: Grace Period Cancellation — No Audit Event Recorded

- **File:** [src/services/subscriptionReminderService.ts](src/services/subscriptionReminderService.ts)
- **Description:** `enforceGracePeriods()` does a raw status update without calling `recordSubscriptionEvent()`. Unlike `reconcileOverdueSubscriptions` which records events, grace period cancellations leave no audit trail. 
- **Impact:** Missing audit trail for subscription lifecycle events.
- **Fix:** Add `recordSubscriptionEvent({ type: 'grace_period_cancelled', ... })` in the enforcement logic.

---

#### HIGH-7: All 36 Admin Tabs Lack i18n Translations

- **File:** [frontend/src/pages/admin-tabs/](frontend/src/pages/admin-tabs/)
- **Description:** Zero admin tab files import `useI18n`. All strings are hardcoded English. The 11/12 user-facing pages use `t()` correctly, but the entire admin console is English-only.
- **Impact:** Church admins who speak Hindi, Tamil, Telugu, Malayalam, or Kannada see an English-only admin interface while the rest of their app is translated.
- **Fix:** Add i18n to all admin tabs. High effort but required for advertised 6-language support.

---

#### HIGH-8: Cancellation Request Approval — No Confirmation

- **File:** [frontend/src/pages/admin-tabs/CancellationRequestsTab.tsx](frontend/src/pages/admin-tabs/CancellationRequestsTab.tsx)
- **Description:** Approving a cancellation request (which permanently cancels a member's subscription) requires no confirmation.
- **Impact:** Accidental subscription cancellation on approval click.
- **Fix:** Add confirmation dialog.

---

### MEDIUM (12 Issues)

---

#### MED-1: Refresh Token Expiry Is 365 Days

- **File:** [src/services/refreshTokenService.ts](src/services/refreshTokenService.ts)
- **Description:** `REFRESH_TOKEN_EXPIRY_DAYS = 365`. Industry standard is 7-30 days with sliding renewal.
- **Impact:** A stolen refresh token is valid for a full year.
- **Fix:** Reduce to 30 days with sliding renewal on use.

---

#### MED-2: No CSRF Protection on Logout

- **File:** [src/routes/authRoutes.ts](src/routes/authRoutes.ts)
- **Description:** POST `/refresh/revoke` uses `sameSite: "lax"` cookie. A malicious site could post a hidden form to force logout.
- **Impact:** Forced logout (nuisance attack, not data theft).
- **Fix:** Add CSRF token or use `sameSite: "strict"` on refresh cookie.

---

#### MED-3: Subscription Creation — No Backend Idempotency

- **File:** [src/routes/subscriptionRoutes.ts](src/routes/subscriptionRoutes.ts)
- **Description:** No deduplication check on `POST /create`. If a request times out and the user retries, two identical subscriptions are created. Frontend has a client-side check but the backend doesn't enforce it.
- **Impact:** Duplicate active subscriptions for the same member and plan.
- **Fix:** Add unique constraint or pre-check: `member_id + plan_name + status = 'active'`.

---

#### MED-4: `notification_batches` Table Has No RLS

- **File:** [db/migrations/012_notification_batches.sql](db/migrations/012_notification_batches.sql)
- **Description:** Table created without RLS or `church_id`.
- **Impact:** Low direct risk (no sensitive data) but violates the "RLS everywhere" pattern.
- **Fix:** Add `church_id` column + RLS policy, or ensure access is service-role only.

---

#### MED-5: `--text-muted` CSS Variable Undefined But Referenced

- **File:** [frontend/src/index.css](frontend/src/index.css), [App.tsx](frontend/src/App.tsx), [SettingsPage.tsx](frontend/src/pages/SettingsPage.tsx)
- **Description:** Multiple components use `var(--text-muted)` but the variable is never defined. Elements render with inherited color instead of muted gray.
- **Impact:** Inconsistent text styling. Some "muted" text may appear full-contrast.
- **Fix:** Define `--text-muted` in `:root` or replace references with `--on-surface-variant`.

---

#### MED-6: `<p>` Tag Color Breaks Dark Mode

- **File:** [frontend/src/index.css](frontend/src/index.css)
- **Description:** `p { color: rgba(46, 42, 90, 0.65); }` — hardcoded dark-purple on all paragraphs. In dark mode, paragraphs appear as dark text on dark backgrounds.
- **Impact:** Unreadable paragraph text in dark mode.
- **Fix:** Use CSS variable: `p { color: var(--on-surface-variant); }` and set appropriately per theme.

---

#### MED-7: `.muted` Text Contrast Fails WCAG AA

- **File:** [frontend/src/index.css](frontend/src/index.css)
- **Description:** `--on-surface-variant: #6B6590` on `--surface: #EDE6ED` = ~3.7:1 contrast ratio. WCAG AA requires 4.5:1 for normal text.
- **Impact:** Accessibility violation — muted text may be unreadable for users with low vision.
- **Fix:** Darken `--on-surface-variant` to at least `#5A5280` (~4.5:1).

---

#### MED-8: Missing `autoComplete` on Login Inputs

- **File:** [frontend/src/App.tsx](frontend/src/App.tsx)
- **Description:** Phone input missing `autoComplete="tel"`, OTP input missing `autoComplete="one-time-code"`. Mobile browsers won't auto-fill saved phone numbers or suggest incoming OTPs.
- **Impact:** Degraded mobile login UX.
- **Fix:** Add appropriate `autoComplete` attributes.

---

#### MED-9: `window.confirm()` Still Used in 3 Places

- **File:** [ProfilePage.tsx](frontend/src/pages/ProfilePage.tsx), [AnnouncementsTab.tsx](frontend/src/pages/admin-tabs/AnnouncementsTab.tsx)
- **Description:** Three instances of `window.confirm()` remain instead of the custom modal: DOB conflict, special date deletion, and clear-all-announcements. Inconsistent UX + broken on iOS PWA.
- **Impact:** Design inconsistency; may not work in PWA mode on iOS Safari.
- **Fix:** Replace with the app's existing custom confirmation modal.

---

#### MED-10: Service Worker Cache Versioned with Manual Integer

- **File:** [frontend/public/sw.js](frontend/public/sw.js)
- **Description:** `CACHE_VERSION = "5"` — manual increment, not tied to build hash. Easy to forget after deploy.
- **Impact:** Users may run stale frontend code if version isn't bumped.
- **Fix:** Inject build hash at build time (e.g., `CACHE_VERSION = import.meta.env.VITE_BUILD_HASH`).

---

#### MED-11: Bulk Import — No Phone Number Normalization

- **File:** [src/routes/operationsRoutes.ts](src/routes/operationsRoutes.ts)
- **Description:** Phone numbers are inserted as-is during bulk import. The family member service normalizes Indian phone numbers, but bulk import doesn't.
- **Impact:** Inconsistent phone number formats — duplicates possible with `+91` vs `0` vs raw 10-digit.
- **Fix:** Apply the same phone normalization used in `familyMemberCreateService`.

---

#### MED-12: Family Member Approval — No Duplicate Check

- **File:** [src/services/familyMemberCreateService.ts](src/services/familyMemberCreateService.ts)
- **Description:** If admin approves two requests for the same person (same phone/email), two member records are created with no dedup check.
- **Impact:** Duplicate member records from parallel approvals.
- **Fix:** Check for existing member with same phone/email in the approval transaction.

---

### LOW (10 Issues)

| # | Issue | File |
|---|---|---|
| LOW-1 | Google OAuth nonce not implemented (state parameter suffices for CSRF) | googleAuthRoutes.ts |
| LOW-2 | Pino doesn't redact `*.phone_number`, `*.email` (auth/OTP redacted) | logger.ts |
| LOW-3 | Comment says "15s for security" but next line says "60s" — cosmetic doc mismatch | requireAuth.ts |
| LOW-4 | `ErrorBoundary` strings not internationalized ("Something went wrong") | ErrorBoundary.tsx |
| LOW-5 | Payment idempotency index is non-UNIQUE in consolidated schema | aws_rds_full_schema.sql |
| LOW-6 | `subscriptions.member_id` CASCADE deletes cause orphaned linked data | aws_rds_full_schema.sql |
| LOW-7 | No "New version available" UI prompt for service worker updates | sw.js + index.html |
| LOW-8 | `channels_sent` metadata records only `["email"]` due to async race | subscriptionReminderService.ts |
| LOW-9 | Family member rejection doesn't notify the requester | familyMemberCreateService.ts |
| LOW-10 | Job scheduler has no health monitoring/heartbeat mechanism | scheduler.ts |

---

## FEATURE-BY-FEATURE TESTING MATRIX

### Authentication & Authorization

| Feature | Test Case | Result | Notes |
|---------|-----------|--------|-------|
| Phone OTP login | Send OTP, verify, receive JWT | **PASS** | SHA-256 hashed, 10min expiry |
| OTP brute force protection | 5 failed attempts → 15min lockout | **PASS** | DB-backed rate limit |
| OTP rate limiting | >5 sends/hour → blocked | **PASS** | Per-phone atomic check |
| Google OAuth login | State param validated, no token in URL | **PASS** | httpOnly cookie flow |
| Token refresh | 401 → transparent retry with new token | **PASS** | 30s grace window for tabs |
| Token storage | httpOnly cookie (primary) + localStorage (fallback) | **PASS (risk)** | XSS could extract LS token |
| Logout | Cookie cleared + token revoked in DB | **PASS** | |
| Role re-validation | JWT role checked against DB (15s cache) | **PASS** | |
| Failed auth logging | Invalid JWT/OTP logged with IP | **PASS** | |
| Church deactivation check | Deactivated church → 403 on auth | **PASS** | Checked in requireAuth |

### Multi-Tenant Isolation

| Feature | Test Case | Result | Notes |
|---------|-----------|--------|-------|
| Church-scoped data | Admin can only see own church data | **PASS** | resolveChurchId enforced |
| Cross-church payments | Can't access other church's payments | **PASS** | Ownership verification |
| Cross-church members | Can't query other church's members | **PASS** | Empty result for no church_id |
| Cross-church leadership | Can't assign roles in other church | **PASS** | targetChurchId = own church |
| Cross-church pastors | Can't list all pastors | **PASS** | church_id required |
| RLS enforcement | Database-level row scoping | **PASS** | GUC-based `app_church_id()` |
| Special dates RLS | Cross-church birthday data | **FAIL** | No RLS on table (HIGH-1) |

### Payment System

| Feature | Test Case | Result | Notes |
|---------|-----------|--------|-------|
| Razorpay order creation | Amount from DB, not client | **PASS** | |
| Payment verification | Razorpay order amount = source of truth | **PASS** | |
| Webhook idempotency | Duplicate webhook → 200 (skip) | **PASS** | event_id UNIQUE constraint |
| Webhook signature | HMAC-SHA256 + timingSafeEqual | **PASS** | Global key only |
| Webhook failure handling | Processing error → 500 (retry) | **PASS** | Cleanup + retry |
| Manual payment recording | Church-scoped, audit logged | **PASS** | |
| Refund recording | Amount validated against original | **PASS** | But no UI confirmation (HIGH-4) |
| Receipt download | Ownership verification | **PASS** | 4-way auth check |
| Payment reconciliation | Pending → resolved, bounded batch | **PASS** | 50 items, 5 concurrent |
| Subscription auto-payment | Batch function with church_id | **FAIL** | CHECK constraint blocks (DB-CRIT-3) |

### Subscription Management

| Feature | Test Case | Result | Notes |
|---------|-----------|--------|-------|
| Create subscription | Validates plan, amount, billing cycle | **PASS** | |
| Duplicate prevention | Client-side duplicate plan check | **PASS** | But no backend guard (MED-3) |
| Start date logic | Always 5th of current/next month | **PASS** | |
| Activate via payment only | Direct status="active" blocked (403) | **PASS** | |
| Grace period enforcement | Auto-cancel past grace days | **PASS** | But no notification (HIGH-5) |
| Overdue reminders | 3-day upcoming + 7/14/30 overdue | **PASS** | Deduplication works |
| Subscription events | Status changes recorded | **PASS** | Except grace cancellations (HIGH-6) |

### Admin Operations

| Feature | Test Case | Result | Notes |
|---------|-----------|--------|-------|
| Bulk member import | CSV → 500 row max, dedup, per-row results | **PASS** | |
| Bulk import church scoping | Members scoped to admin's church | **PASS** | |
| Admin role management | Grant/revoke admin access | **PASS** | But no confirm on revoke (HIGH-2) |
| Member management | CRUD with soft-delete | **PASS** | But no confirm on delete (HIGH-3) |
| Announcement management | Create, edit, delete, clear-all | **PASS** | window.confirm on clear-all (MED-9) |
| Event management | Create, edit, delete | **PASS** | |
| Notification sending | Multi-channel (email/SMS/push) | **PASS** | Batch 500/chunk |
| Family member requests | Submit → admin review → approve/reject | **PASS** | |
| Membership requests | Submit → admin review | **PASS** | |
| Scheduled reports | Auto-generated every 6 hours | **PASS** | |
| Income dashboard | SQL aggregation, responsive charts | **PASS** | |
| Leadership hierarchy | Assign/remove roles, church-scoped | **PASS** | |

### Frontend & UX

| Feature | Test Case | Result | Notes |
|---------|-----------|--------|-------|
| Lazy loading (all pages) | Route-based code splitting | **PASS** | React.lazy + Suspense |
| Lazy loading (admin tabs) | 36 tabs lazy-loaded | **PASS** | |
| Loading skeletons | Shimmer states during data fetch | **PASS** | role="status" |
| Dark mode | Full design system with CSS variables | **PASS** | Except `<p>` tags (MED-6) |
| i18n (user pages) | 6 languages on 11/12 pages | **PASS** | |
| i18n (admin pages) | Translations in admin tabs | **FAIL** | All English (HIGH-7) |
| Mobile responsive | Sidebar drawer, responsive grids | **PASS** | |
| Skip-to-content | Keyboard navigation | **PASS** | |
| Toast notifications | aria-live="polite" | **PASS** | |
| Error boundary | Catches React render errors | **PASS** | |
| Empty states | Configured icons/messages | **PASS** | |
| Inline validation | Phone + email format checking | **PASS** | |
| Double-submit prevention | busyKey pattern on all mutations | **PASS** | |
| PWA offline | Serves offline.html when disconnected | **PASS** | |
| PWA push notifications | Subscribe, receive, click-to-open | **PASS** | |
| API error handling | 401 retry, timeout, network errors | **PASS** | |

### Job Scheduler

| Feature | Test Case | Result | Notes |
|---------|-----------|--------|-------|
| Overlapping execution prevention | PostgreSQL advisory locks | **PASS** | |
| Overdue reconciliation | Daily 00:30 UTC | **PASS** | |
| Subscription reminders | Daily 06:00 UTC with dedup | **PASS** | |
| Grace period enforcement | Daily 01:00 UTC | **PASS** | No notification/audit (HIGH-5/6) |
| Job queue processing | Every 3s, batch 200, concurrency 40 | **PASS** | |
| Payment reconciliation | Every 2h, bounded batch | **PASS** | Advisory lock slightly risky (LOW) |
| Special date reminders | Daily 03:30 UTC | **PASS** | |

---

## CATEGORY SCORES

| Category | June 2025 | April 2026 | Key Improvement |
|----------|-----------|------------|-----------------|
| Authentication | 4/10 | **9/10** | OAuth state, no token in URL, DB role validation |
| Authorization (RBAC) | 3/10 | **9/10** | All routes church-scoped, ownership verified |
| Multi-Tenant Isolation | 3/10 | **8/10** | RLS everywhere (except special_dates) |
| Payment Processing | 3/10 | **8/10** | Webhook security, SQL aggregation, reconciliation |
| Data Integrity | 3/10 | **7/10** | Unique constraints, FK fix — BUT schema drift |
| API Security | 5/10 | **9/10** | Rate limiting, HSTS, body limits, input sanitization |
| Error Handling | 4/10 | **8/10** | Fail-closed middleware, generic errors, circuit pattern |
| Logging & Observability | 2/10 | **8/10** | Full audit trail, PII redaction, correlation IDs |
| UI/UX | 4/10 | **7/10** | Lazy loading, i18n (partial), a11y, dark mode |
| Performance | 4/10 | **8/10** | SQL aggregation, batch ops, indexed queries |

---

## PRIORITY FIX ORDER

### Phase 0: BLOCKER — Fix Before Next Deploy from Consolidated Schema

1. **DB-CRIT-1**: Add `members_email_church_unique` to `aws_rds_full_schema.sql`
2. **DB-CRIT-2**: Add audit log INSERT-only protection to `aws_rds_full_schema.sql`
3. **DB-CRIT-3**: Fix `payment_method` CHECK constraint to include `'subscription_paynow'`
4. **DB-CRIT-4**: Sync `process_subscription_payments_batch` function with atomic migration

### Phase 1: HIGH — Fix Within 1 Week

5. **HIGH-1**: Enable RLS on `member_special_dates`
6. **HIGH-2/3/4/8**: Add confirmation dialogs to `deleteAdmin`, `deleteMember`, Refunds, Cancellation approval
7. **HIGH-5**: Send notification when subscription auto-cancelled (grace period)
8. **HIGH-6**: Record subscription_event on grace period cancellation

### Phase 2: MEDIUM — Fix Within 2 Weeks

9. **MED-1**: Reduce refresh token expiry to 30 days
10. **MED-3**: Add backend idempotency guard on subscription creation
11. **MED-5/6/7**: Fix CSS variable issues (--text-muted, <p> dark mode, contrast)
12. **MED-8**: Add autoComplete attributes to login inputs
13. **MED-9**: Replace remaining window.confirm() with custom modal
14. **MED-10**: Auto-inject build hash into service worker cache version
15. **MED-11/12**: Phone normalization in bulk import, duplicate check in family approval

### Phase 3: LOW — Fix When Convenient

16. All LOW-1 through LOW-10 items

---

## ROOT CAUSE ANALYSIS

The 4 Critical issues all share one root cause: **`aws_rds_full_schema.sql` was frozen on March 24, 2026 and never updated to incorporate fixes from migrations 003–012.** The production database has all fixes applied (via sequential migrations), but the "source of truth" schema file is dangerously out of date.

**Recommendation:** After fixing, add a CI check that verifies the consolidated schema matches the result of all migrations applied sequentially. This prevents future schema drift.

---

## GO/NO-GO RECOMMENDATION

### **VERDICT: CONDITIONAL GO**

**Conditions for GO:**
1. Verify that production database has all migrations (003–012) applied (likely yes — these are runtime fixes)
2. Fix DB-CRIT-3 (payment_method CHECK) — this actively blocks subscription auto-payments
3. Fix HIGH-2/3/4 — missing confirmation dialogs on destructive actions

**If these 3 conditions are met:** The application is safe for production use. The remaining Critical issues only affect fresh deploys from the consolidated schema (not the current running production database).

**Key risk:** The consolidated schema drift means disaster recovery (rebuilding from scratch) would produce a vulnerable database. This should be fixed urgently but doesn't block current operations.

---

*End of Report — April 8, 2026*
