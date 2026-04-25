# PRODUCTION LAUNCH AUDIT — Shalom Church SaaS

**Date:** 18 April 2026  
**Audited by:** Expert Panel (Architect, QA Lead, Security Engineer, DevOps/SRE, Product Manager, End-User Proxy)  
**Scope:** Full-stack application — React frontend, Express/TS backend, PostgreSQL on RDS, AWS ECS Fargate, Razorpay payments  

---

## 1. FINAL VERDICT

### **PARTIALLY READY** — Score: **72 / 100**

The application has a solid architectural foundation, good security practices in many areas (memory-only tokens, RLS, input sanitization, helmet/CSP, webhook HMAC verification), and a working payment flow. However, **several medium-high severity issues remain** that could cause data integrity problems, user confusion, or financial discrepancies in production. No **truly critical** blockering vulnerabilities were found, but the cumulative risk of the medium-severity items warrants targeted fixes before launch with real paying users.

---

## 2. CATEGORY SCORES

| Category | Score | Assessment |
|----------|-------|------------|
| **Security** | **78/100** | Strong foundations (JWT in memory, RLS, XSS sanitizer, CSP). Gaps: file upload lacks magic-byte check, 101/123 mutation endpoints lack Zod schemas, donationFund routes bypass RLS. |
| **Backend / API** | **74/100** | Well-structured. Gaps: many silent `.catch(() => {})`, several multi-step writes without transactions, ~80% of mutation endpoints lack Zod validation middleware. |
| **Data Integrity** | **70/100** | RLS enforced on most paths. Gaps: missing CHECK constraints on key financial columns, no transaction wrapping on family-member creation, manual-payment idempotency only within 60s (insufficient for retries). |
| **UX / UI** | **75/100** | Good i18n, loading states, ARIA. Gaps: 11+ direct `fetch()` calls bypass `apiRequest` (no timeout, no retry, no error standardization), Razorpay modal dismiss shows confusing error. |
| **Performance** | **80/100** | Code-splitting, debounced search, Vite chunking. Gap: monolithic AppContext (40+ properties) causes excessive re-renders. |
| **DevOps / Observability** | **68/100** | Docker + ECS + auto-migrations working. Gaps: 5 test failures in CI, no env-var validation at startup beyond `DATABASE_URL`/`JWT_SECRET`, Sentry DSN not configured in prod (warn-only), no visibility-based poll backoff. |

---

## 3. CRITICAL ISSUES (Must Fix Before Launch)

### C-1: File Upload Validates Only MIME Type — No Extension or Magic-Byte Check
**Severity:** CRITICAL | **Files:** `src/services/uploadService.ts:26-37`

`validateUpload()` and `validateMediaUpload()` check only `file.mimetype`, which is client-controlled. An attacker can upload `malicious.svg` with `mimetype: image/jpeg` to store executable SVG/HTML content in S3.

**Impact:** Stored XSS via SVG, potential phishing via HTML uploads.  
**Fix:** Add file extension whitelist + magic-byte signature check (first 4 bytes).

---

### C-2: 101 of 123 Mutation Endpoints Lack Zod Schema Validation
**Severity:** CRITICAL | **Files:** All route files

Only 22 mutation routes use the `validate()` middleware. The remaining 101 do manual/ad-hoc validation or none at all. This is the single largest attack surface.

**Key unvalidated routes:**
- `pastorRoutes.ts` — POST /create, PATCH /:id (accepts `String(req.body?.full_name || "")`)
- `paymentRoutes.ts` — POST /order, /verify, /donation/order, /donation/verify, /subscription/order, /subscription/verify
- `leadershipRoutes.ts` — POST /assign, PATCH /:id, DELETE /:id
- `adminRoutes.ts` — PATCH (role change), POST /pre-register, POST /approve
- `dioceseRoutes.ts` — POST /, PATCH /:id, all sub-routes
- `donationFundRoutes.ts` — POST /, PUT /:id
- `pushRoutes.ts` — POST /subscribe, /send-notification

**Impact:** Unbounded string fields, type coercion bypass, data corruption.  
**Fix:** Add Zod schemas + `validate()` middleware to every POST/PATCH/PUT/DELETE endpoint. ~2 days of work.

---

### C-3: donationFundRoutes Uses `pool.query()` Bypassing RLS on Write Operations
**Severity:** HIGH → Elevated to CRITICAL for write paths | **File:** `src/routes/donationFundRoutes.ts`

All 9 queries in this file use `pool.query()` directly, bypassing the RLS context set by `rlsStorage`. While each write endpoint manually checks `church_id`, the read endpoints for authenticated admins (`GET /`) also bypass RLS. If a super-admin's church context is wrong, they could unintentionally operate on another church's data.

The `/public` GET endpoint is acceptable (returns only fund names, which are non-sensitive for the public donation flow).

**Impact:** RLS bypass on authenticated write/read paths.  
**Fix:** Replace `pool.query()` with `rawQuery()` from `dbClient.ts` for all authenticated endpoints.

---

## 4. HIGH PRIORITY ISSUES

### H-1: 11+ Frontend `fetch()` Calls Bypass `apiRequest` Utility
**Severity:** HIGH | **Files:** See table below

These bypass timeout, error standardization, retry-on-401, and `X-Church-Id` header:

| File | Endpoint | Risk |
|------|----------|------|
| `HistoryPage.tsx:82` | `/api/payments/.../receipt` | No timeout |
| `ExplorePage.tsx:76` | `/api/churches/public-search` | No error handling |
| `DonationLinksTab.tsx:40,49,58` | Diocese/fund public endpoints | 3 calls, no standardization |
| `PhotoUpload.tsx:77-120` | `/api/uploads/image` (XMLHttpRequest) | No cleanup, memory leak risk |
| `DonationCheckoutPage.tsx:54,100` | Donation order/verify | No dedup, no timeout |
| `AdBannerTab.tsx:90` | Image upload (XHR) | No X-Church-Id |
| `EventsTab.tsx:150` | Image upload (XHR) | No X-Church-Id |
| `PaymentHistoryTab.tsx:37` | `/api/payments/.../receipt` | No timeout |

**Fix:** Migrate all to `apiRequest()` or at minimum add timeout + error handling.

---

### H-2: Silent `.catch(() => {})` on Critical Operations
**Severity:** HIGH | **Files:** 15+ locations across backend

Silent swallowing of errors hides:
- Failed audit logs → compliance gaps
- Failed push notifications → users not informed
- Failed S3 deletions → orphaned files accumulating

**Key locations:**
- `specialDateRoutes.ts:111,140,168` — `persistAuditLog(...).catch(() => {})`
- `webhookRoutes.ts:225,268,277` — `queueNotification({...}).catch(() => {})`
- `requestRoutes.ts:156,274,403,517` — various notification `.catch(() => {})`
- `authRoutes.ts:339` — `deleteFromS3(oldUrl).catch(() => {})`

**Fix:** Replace all with `.catch((err) => { logger.warn({ err }, "...context..."); })`.

---

### H-3: Missing Database Transactions on Multi-Step Writes
**Severity:** HIGH | **Files:** `familyMemberCreateService.ts`, `engagementService.ts`

Family member creation inserts into `members` → `family_members` → `church_notifications` without a transaction. If step 2 fails, an orphan member record remains.

**Fix:** Wrap multi-step writes in `BEGIN`/`COMMIT`/`ROLLBACK` using `getClient()`.

---

### H-4: Payment Order/Verify Endpoints Lack Zod Validation
**Severity:** HIGH | **File:** `src/routes/paymentRoutes.ts`

Six payment endpoints accept `req.body` without Zod:
- `POST /order` (line 174)
- `POST /verify` (line 250)
- `POST /donation/order` (line 380)
- `POST /donation/verify` (line 437)
- `POST /subscription/order` (line 558)
- `POST /subscription/verify` (line 667)

Amount is derived server-side from DB (good), but `razorpay_payment_id`, `razorpay_signature`, and other string fields are not schema-validated.

**Fix:** Add Zod schemas for all six endpoints.

---

### H-5: Manual Payment Idempotency Window Too Small (60 seconds)
**Severity:** HIGH | **File:** `src/routes/operationsRoutes.ts:~120`

The 60-second dedup window is too small. If a network timeout causes a retry after 2 minutes, the duplicate payment goes through. Real-world retries can take 5+ minutes.

**Fix:** Extend to `INTERVAL '5 minutes'` or implement connection-level idempotency keys (client sends UUID, server deduplicates by key).

---

### H-6: Missing CHECK Constraints on Financial Columns
**Severity:** HIGH | **Database schema**

No `CHECK` constraints on:
- `payments.amount` — should be `> 0`
- `subscriptions.amount` — should be `>= 200`
- `churches.platform_fee_percentage` — should be `BETWEEN 0 AND 10`

App-level validation exists but database is the last line of defense.

**Fix:** Add via migration:
```sql
ALTER TABLE payments ADD CONSTRAINT chk_payment_amount CHECK (amount > 0);
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscription_amount CHECK (amount >= 200);
```

---

### H-7: 5 Failing Backend Tests
**Severity:** HIGH | **Files:** `app.test.ts`, `webhookRoutes.test.ts`, `pushRoutes.test.ts`, `authIntegration.test.ts`

4 test failures + 1 frontend failure. Shipping with known test failures sets a bad precedent and may mask regressions.

**Fix:** Fix or quarantine failing tests before launch.

---

## 5. MEDIUM PRIORITY ISSUES

### M-1: Razorpay Modal Dismiss Shows Confusing Error Toast
**File:** `frontend/src/lib/razorpayCheckout.ts`  
When user closes the Razorpay payment modal, it rejects with `"Payment cancelled by user"` which shows as an error toast. Should be an info/warning, not an error.

### M-2: No Token Re-validation in Church Picker After Long Delay
**File:** `frontend/src/hooks/useAuth.ts:151-163`  
If user leaves the multi-church picker open for 30+ minutes, their token may expire before they select. No re-validation before `selectChurch()`.

### M-3: AppContext Monolithic Provider (40+ Properties)
**File:** `frontend/src/App.tsx:330-355`  
All consumers re-render when ANY context value changes (e.g., `busyKey` change re-renders DashboardPage charts). Should split into AuthContext, DataContext, UIContext.

### M-4: Role Cache 5-Second TTL Without Invalidation on Role Change
**File:** `src/middleware/requireAuth.ts:9-10`  
`invalidateRoleCache()` exists but isn't called from admin role-change endpoints. A 5-second window where a deauthorized user retains access.

### M-5: Missing Database Indexes on Hot Query Paths
- `payments(transaction_id)` — used in idempotency check, no index
- `subscriptions(member_id, status)` — used in aggregations
- `subscriptions(church_id, status)` — used in dashboard queries

### M-6: `tryRefreshToken()` Doesn't Send `X-Church-Id` Header
**File:** `frontend/src/lib/api.ts:43-55`  
Direct `fetch()` for token refresh. Not critical (refresh doesn't need church context) but the retry after refresh also omits `X-Church-Id`.

### M-7: Empty Church List Not Handled
**File:** `frontend/src/hooks/useAuth.ts:156-163`  
If `churches.length === 0` after login, user navigates to dashboard with no church set. Dashboard will fail silently.

### M-8: Env Var Validation Incomplete at Startup
**File:** `src/config.ts:7-13`  
Only validates `DATABASE_URL` and `JWT_SECRET`. Missing validation for `RAZORPAY_KEY_ID`, `S3_UPLOAD_BUCKET`, `TWILIO_*`, `SENTRY_DSN`. App starts but silently fails later.

### M-9: Badge/Notification Polling Without Visibility Check
**File:** `frontend/src/hooks/useBootstrap.ts:316-320`  
60-second poll for admin badge counts continues even when browser tab is inactive. Wastes requests and server resources.

### M-10: No Backup Verification or Restoration Test Documented
**DevOps concern.** RDS has 30-day backup retention but no documented restoration test. First real restore will be in an emergency.

---

## 6. LOW PRIORITY ISSUES

| ID | Issue | File |
|----|-------|------|
| L-1 | Service worker uses `Date.now()` hash instead of content hash | `frontend/vite.config.ts` |
| L-2 | Images lack `loading="lazy"` attribute | `PhotoUpload.tsx` |
| L-3 | Account deletion form has no minimum reason length | `SettingsPage.tsx` |
| L-4 | `localStorage` used for language preference (XSS overwrite vector) | `frontend/src/i18n/index.tsx` |
| L-5 | Public church search rate limit at 15/min (could allow enumeration) | `src/routes/churchRoutes.ts` |

---

## 7. HIDDEN RISKS (Future Problems)

### 7.1 Webhook Race Condition Under Load
The INSERT-before-process dedup pattern works correctly for normal traffic. Under extreme load (Razorpay retry storms), two near-simultaneous inserts could both succeed if the unique constraint check and insert don't overlap. The current code handles this via `23505` error code, which is correct. **Risk is theoretical, not practical** — Razorpay typically retries with 5-minute gaps.

### 7.2 Growing `razorpay_webhook_events` Table
No cleanup/archival strategy. This table will grow indefinitely. Needs TTL-based cleanup (DELETE WHERE created_at < NOW() - INTERVAL '90 days').

### 7.3 Session Storage for Church Context
`activeChurchId` in `sessionStorage` is lost when user opens app in new tab. Multi-tab usage will fail silently — one tab may operate on wrong church.

### 7.4 Push Notification Delivery Failures
`queueNotification().catch(() => {})` means push failures are silently dropped. Over time, users will report "I didn't get notified" with no server-side evidence.

### 7.5 Database Migration Ordering
Docker entrypoint sorts migrations alphabetically. If migration `009_fix_family_rls_policies.sql` depends on `009_fix_family_subscription_payments.sql`, execution order is undefined. Currently works by coincidence.

### 7.6 Monolithic Context Performance Cliff
As more features are added, the single `AppContext` with 40+ properties will cause increasingly noticeable re-render lag. This is a scaling issue, not a bug.

---

## 8. EXACT FIX RECOMMENDATIONS (Priority Order)

### Tier 1: Block Launch (1-2 days)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | **Add file extension + magic-byte validation** to `uploadService.ts` | 2h | Closes stored XSS vector |
| 2 | **Add Zod schemas to payment endpoints** (6 routes in paymentRoutes.ts) | 3h | Validates all financial inputs |
| 3 | **Replace `pool.query()` with `rawQuery()`** in donationFundRoutes.ts | 1h | Restores RLS enforcement |
| 4 | **Fix 5 failing tests** or quarantine them | 2h | CI green before launch |
| 5 | **Replace silent `.catch(() => {})`** with logging (15 locations) | 2h | Makes failures visible |
| 6 | **Add CHECK constraints** on payments.amount, subscriptions.amount | 30m | DB-level financial safety |

### Tier 2: First Week Post-Launch (3-5 days)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 7 | Migrate 11 frontend direct `fetch()` to `apiRequest()` | 4h | Standardized error handling |
| 8 | Add Zod to remaining high-risk mutation endpoints (pastors, admins, leadership, diocese, push) | 4h | Closes validation gaps |
| 9 | Wrap family-member creation in DB transaction | 2h | Prevents orphan records |
| 10 | Extend idempotency window to 5 minutes | 30m | Better retry safety |
| 11 | Handle Razorpay modal dismiss gracefully | 1h | Better UX |

### Tier 3: First Month (Ongoing)

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 12 | Split AppContext into separate providers | 4h | Performance |
| 13 | Add database indexes on hot query paths | 1h | Query performance |
| 14 | Call `invalidateRoleCache()` from admin role-change endpoints | 30m | Tighter access control |
| 15 | Add `document.visibilityState` check to badge polling | 30m | Saves server resources |
| 16 | Add Zod to ALL remaining mutation endpoints | 8h | Complete coverage |

---

## 9. REGRESSION RISKS

| Area | Risk | Mitigation |
|------|------|------------|
| **Payment flows** | Any change to Razorpay SDK/verify logic could break payment reconciliation | Need end-to-end payment test suite (currently only mocked) |
| **Auth middleware** | Role cache changes could lock out users | Integration tests with real JWT tokens |
| **Migration ordering** | New migrations could break if they depend on undocumented assumptions | Add migration dependency comments and numbered prefixes |
| **Multi-church switching** | Changes to bootstrap/selectChurch could leave stale data | Test with 2+ church accounts |
| **RLS policies** | Schema changes could break RLS enforcement | RLS-specific test suite needed |

---

## 10. LAUNCH CHECKLIST

### Before Launch (Required)
- [ ] Fix C-1: File upload magic-byte validation
- [ ] Fix C-2: Add Zod to payment endpoints (minimum 6 routes)
- [ ] Fix C-3: Replace `pool.query()` in donationFundRoutes
- [ ] Fix H-2: Replace silent `.catch(() => {})` with logging
- [ ] Fix H-6: Add CHECK constraints on financial columns
- [ ] Fix H-7: Fix or quarantine failing tests
- [ ] Verify SENTRY_DSN is configured in production ECS task definition
- [ ] Verify S3 bucket is NOT publicly writable
- [ ] Run `npm audit` and fix critical/high vulnerabilities
- [ ] Verify RDS automated backups are enabled and test a point-in-time restore
- [ ] Verify CloudFront serves `Content-Security-Policy` header (not just backend)
- [ ] Verify all production environment variables are set (not just DATABASE_URL/JWT_SECRET)

### Day-1 Monitoring
- [ ] Monitor Sentry for first production errors
- [ ] Monitor CloudWatch for ECS task restarts
- [ ] Monitor webhook delivery success rate (Razorpay dashboard)
- [ ] Check RDS storage utilization and connection count
- [ ] Verify audit_log table is being populated on every write operation

### First Week
- [ ] Migrate direct `fetch()` calls to `apiRequest()`
- [ ] Run i18n audit script (`frontend/audit_i18n.sh`) to find missing translations
- [ ] Load test payment flow with test Razorpay credentials
- [ ] Test multi-church switching with 2+ churches
- [ ] Test account deletion + membership approval + family linking flows

---

## APPENDIX: Architecture Summary

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  CloudFront │────▶│  S3 (React)  │     │  RDS PostgreSQL  │
│  E29I0...   │     │  Frontend    │     │  db.t3.medium    │
│             │──┐  └──────────────┘     │  30d backup      │
└─────────────┘  │                       └────────┬─────────┘
                 │  ┌──────────────┐              │
                 └─▶│  ALB → ECS   │──────────────┘
                    │  Fargate     │
                    │  512/1024 MB │──── S3 Uploads
                    │  Express.js  │──── Razorpay API
                    └──────────────┘──── Twilio (OTP/SMS)
                           │
                    ┌──────┴──────┐
                    │  ECR Image  │
                    │  Auto-migr. │
                    └─────────────┘
```

**Users:** Admin, Member, Super-Admin, Pastor  
**Key flows:** OTP login → Church join/select → Dashboard → Payments → Push notifications  
**Endpoints:** 52 route handlers (123 mutation paths), 22 with Zod validation  
**Tests:** 203 backend (199 passing), 81 frontend (80 passing)  
**Languages:** en, hi, ta, te, ml, kn (6 languages)
