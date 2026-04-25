# SHALOM SaaS — FULL PRODUCTION READINESS AUDIT

**Audit Date:** April 18, 2026
**Auditor Roles:** Sr. Software Architect, QA Lead, Security Engineer, DevOps Expert
**Stack:** Express.js + TypeScript backend, React + TypeScript frontend, PostgreSQL, Razorpay, AWS ECS Fargate

---

## 1. PRODUCTION READINESS SCORE

### **Overall: 74 / 100 — PARTIALLY READY**

---

## 2. CATEGORY-WISE SCORES

| Category | Score | Verdict |
|----------|-------|---------|
| **UI/UX** | 76/100 | Good mobile-first PWA. Silent error handling and missing loading states drag it down. |
| **Backend** | 80/100 | Strong security posture. 7 mutation endpoints missing Zod validation. |
| **Security** | 82/100 | Best-in-class for indie SaaS. RLS policy has a logic gap. No critical vulns. |
| **Performance** | 65/100 | Infrastructure undersized (256 CPU / 512 MB). No caching layer. |
| **Data Integrity** | 72/100 | Parameterized queries throughout. Missing NOT NULL on critical FKs. RLS permissive fallback. |
| **DevOps** | 78/100 | Multi-stage Docker, non-root, health checks, CloudWatch alarms. No CI/CD pipeline file. |
| **Payments** | 85/100 | Amount re-verification, HMAC timing-safe, idempotency, double-click prevention. Best area. |
| **Testing** | 35/100 | 22 backend test files but zero frontend tests, no E2E, no integration tests for payment flow. |

---

## 3. CRITICAL ISSUES (Must Fix Before Launch)

### C-1: RLS Policy Allows Cross-Church Data Leak
- **File:** `db/migrations/002_rls_and_audit_fixes.sql`
- **Risk:** When `app_church_id()` returns NULL (background jobs, error paths), RLS policies evaluate `NULL OR church_id = NULL` → passes, exposing ALL church data.
- **Fix:** Change pattern from:
  ```sql
  USING (app_church_id() IS NULL OR church_id = app_church_id())
  ```
  to:
  ```sql
  USING (church_id = app_church_id() AND app_church_id() IS NOT NULL)
  ```
  Super-admin routes should use a separate unscoped DB client.

### C-2: ECS Task Will OOM Under Load
- **File:** `aws/cloudformation.yaml` (lines 327-328)
- **Current:** CPU: 256 (0.25 vCPU), Memory: 512 MB
- **Risk:** Node.js + Express + PDF generation + heavy SQL will crash under concurrent load.
- **Fix:** Minimum `CPU: 512`, `Memory: 1024` for production.

### C-3: RDS Instance Undersized
- **File:** `aws/cloudformation.yaml` (line 165)
- **Current:** `db.t2.micro` (1 vCPU, burstable, 1 GB RAM)
- **Risk:** Will hit CPU credit exhaustion under sustained queries.
- **Fix:** Upgrade to `db.t3.medium` minimum for production.

### C-4: Zero Frontend Tests
- **Risk:** Any refactor or dependency update can silently break payment flows, auth screens, or form validation with no safety net.
- **Fix:** Add React Testing Library tests for: auth flow, payment checkout, form validation, admin actions.

### C-5: Silent Error Swallowing (20+ Instances)
- **Files:** `UserHomePage.tsx`, `DonationLinksTab.tsx`, `PushNotificationTab.tsx`, `PublicDonationPage.tsx`, and more
- **Pattern:** `.catch(() => {})` — API failures are invisible to users
- **Risk:** Users see blank screens or stale data with no explanation.
- **Fix:** Replace with error toasts: `.catch(() => setNotice({ tone: "error", text: t("errors.loadFailed") }))`

---

## 4. HIGH PRIORITY ISSUES

| # | Issue | Category | File |
|---|-------|----------|------|
| H-1 | Member link endpoint weak auth — email-only linking can bind arbitrary members | Security | `src/routes/memberRoutes.ts` (line ~95) |
| H-2 | Phone change lacks OTP expiry validation | Security | `src/routes/authRoutes.ts` (line ~230) |
| H-3 | OTP send has no per-phone DB tracking — IP rate limit only, bypassable with proxies | Security | `src/routes/otpRoutes.ts` |
| H-4 | `subscriptions.church_id` nullable — breaks RLS tenant isolation intent | Data | `db/aws_rds_full_schema.sql` (line ~595) |
| H-5 | No per-route error boundaries — single error crashes entire app | Frontend | `frontend/src/App.tsx` |
| H-6 | Payment transactions not audit-logged | Compliance | `src/routes/paymentRoutes.ts` |
| H-7 | Multi-church migration backfill missing cross-tenant check | Data | `db/migrations/020_multi_church_junction.sql` (line ~38) |
| H-8 | ProfilePage is 1,700+ lines — unmaintainable, high merge-conflict risk | Code Quality | `frontend/src/pages/ProfilePage.tsx` |
| H-9 | No E2E payment integration tests | Testing | — |
| H-10 | Missing loading/error states on PublicDonationPage | UX | `frontend/src/pages/PublicDonationPage.tsx` (line ~72) |

---

## 5. MEDIUM / LOW ISSUES

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| M-1 | 7 mutation endpoints missing Zod schemas | Medium | Validation |
| M-2 | Missing rate limits on `/members/list`, `/members/search` (enumeration risk) | Medium | Security |
| M-3 | Donation amount has no admin-approval threshold for large donations | Medium | Payments |
| M-4 | Manual payment lacks idempotency key | Medium | Payments |
| M-5 | No migration rollback scripts | Medium | Database |
| M-6 | No migration checksum verification | Medium | Database |
| M-7 | Backup retention only 7 days (should be 30 for compliance) | Medium | DevOps |
| M-8 | `postgresql-client` in Docker image unused — increases attack surface | Low | DevOps |
| M-9 | No request deduplication on frontend (rapid button mashing sends duplicates) | Medium | Frontend |
| M-10 | Church switch doesn't clear stale member data before loading new church | Medium | Frontend |
| M-11 | Missing ARIA attributes on SearchSelect, CropModal | Low | Accessibility |
| M-12 | Phone validation missing before OTP send in ProfilePage | Medium | Validation |
| M-13 | No `build.sourcemap` configuration in Vite (should be `false` for prod) | Low | Build |
| M-14 | Missing translation key audit lint rule | Low | i18n |
| L-1 | Cookie consent stored in localStorage (not cookie itself) | Low | Compliance |

---

## 6. WHAT'S ALREADY PRODUCTION-QUALITY

| Area | Detail |
|------|--------|
| SQL Security | 100% parameterized queries — zero injection vectors |
| XSS Prevention | Helmet CSP headers + input sanitization middleware |
| CSRF Protection | Strict CORS locked to frontend origin |
| Auth Tokens | JWT in memory only (not localStorage), proactive 25-min refresh, 401 auto-retry |
| Payment HMAC | `crypto.timingSafeEqual()` for Razorpay webhook signature verification |
| Payment Idempotency | Duplicate `transaction_id` check before insert |
| Double-Click Prevention | Frontend `busyRef` blocks concurrent payment submissions |
| Amount Verification | Server re-fetches order from Razorpay API and rejects if amount mismatches |
| Platform Fee Cap | Hard-capped at 10% server-side |
| Docker Security | Multi-stage build, Alpine base, non-root user (uid 1001) |
| Rate Limiting | 5 tiers: general (100/min), payment (15/min), auth (30/min), OTP (5/min), sensitive (30/min) |
| Logging | Pino structured logs with PII redaction (phone, email, otp, password, tokens) |
| Error Tracking | Sentry with authorization/cookie header scrubbing |
| Security Headers | Helmet HSTS, CSP, Permissions-Policy (no camera/mic/geo), no-cache on API |
| Content-Type Enforcement | 415 rejection on mutation endpoints without JSON/multipart/CSV content type |
| Request IDs | Correlation IDs with sanitized client header fallback |
| Privacy Compliance | DPDP Act 2023 compliant privacy policy, cookie consent, data deletion flow |
| i18n | 6 languages (en, hi, ta, te, ml, kn) with comprehensive key coverage |
| PWA | Mobile-first, offline banner, body scroll lock, focus trap, ESC-to-close drawer |

---

## 7. EXACT CODE FIXES TO REACH 100/100

### FIX C-1: RLS Policy (new migration)

**Create:** `db/migrations/030_rls_strict_tenant.sql`
```sql
-- Strict tenant isolation: NEVER allow NULL church context to pass
-- Super-admin queries must use supabaseAdmin client (bypasses RLS)

BEGIN;

-- members table
DROP POLICY IF EXISTS members_tenant ON members;
CREATE POLICY members_tenant ON members
  USING (app_church_id() IS NOT NULL AND church_id = app_church_id());

-- subscriptions table
DROP POLICY IF EXISTS subscriptions_tenant ON subscriptions;
CREATE POLICY subscriptions_tenant ON subscriptions
  USING (app_church_id() IS NOT NULL AND church_id = app_church_id());

-- payments table
DROP POLICY IF EXISTS payments_tenant ON payments;
CREATE POLICY payments_tenant ON payments
  USING (app_church_id() IS NOT NULL AND church_id = app_church_id());

-- family_members table
DROP POLICY IF EXISTS family_members_tenant ON family_members;
CREATE POLICY family_members_tenant ON family_members
  USING (app_church_id() IS NOT NULL AND church_id = app_church_id());

-- Repeat for ALL tenant-scoped tables:
-- announcements, church_events, church_notifications, prayer_requests,
-- membership_requests, cancellation_requests, account_deletion_requests,
-- refund_requests, subscription_monthly_dues, donation_funds, etc.

COMMIT;
```

### FIX C-2: ECS Task Sizing

**File:** `aws/cloudformation.yaml` (lines 327-328)
```yaml
# Before:
Cpu: '256'
Memory: '512'

# After:
Cpu: '512'
Memory: '1024'
```

### FIX C-3: RDS Instance Upgrade

**File:** `aws/cloudformation.yaml` (line 165)
```yaml
# Before:
DBInstanceClass: db.t2.micro

# After:
DBInstanceClass: db.t3.medium
```

Also increase backup retention (line 174):
```yaml
# Before:
BackupRetentionPeriod: 7

# After:
BackupRetentionPeriod: 30
```

### FIX C-5: Replace Silent Catches With Error Feedback

**Pattern to find and replace across all frontend files:**
```typescript
// BEFORE (20+ occurrences across frontend):
.catch(() => {});

// AFTER — Option A (toast notification):
.catch(() => setNotice({ tone: "error", text: t("errors.loadFailed") }));

// AFTER — Option B (for non-critical background loads):
.catch((err) => logger.warn("Background load failed", err));
```

**Files requiring this fix:**
1. `frontend/src/pages/UserHomePage.tsx` — lines 41, 109, 116, 125, 133
2. `frontend/src/pages/admin-tabs/DonationLinksTab.tsx` — 4 instances
3. `frontend/src/pages/admin-tabs/PushNotificationTab.tsx` — 6 instances
4. `frontend/src/pages/PublicDonationPage.tsx` — 2 instances

### FIX H-1: Strengthen Member Link Auth

**File:** `src/routes/memberRoutes.ts` (line ~95)
```typescript
// BEFORE: Just email match
// AFTER: Require phone verification + confirmation
router.post("/link", requireAuth, async (req, res) => {
  const { member_id } = req.body;
  // 1. Verify member exists and belongs to user's church
  const member = await getMemberById(member_id);
  if (!member || member.church_id !== req.user.church_id) {
    return res.status(404).json({ error: "Member not found" });
  }
  // 2. Verify email OR phone matches (not just email)
  if (member.email !== req.user.email && member.phone !== req.user.phone) {
    return res.status(403).json({ error: "Contact info does not match member record" });
  }
  // 3. Require OTP confirmation for linking
  const { otp_token } = req.body;
  if (!otp_token || !verifyOtpToken(otp_token, req.user.phone)) {
    return res.status(403).json({ error: "OTP verification required to link member" });
  }
  // ... proceed with linking
});
```

### FIX H-3: Per-Phone OTP Rate Tracking

**File:** `src/routes/otpRoutes.ts`
```typescript
// Add DB-level OTP tracking to prevent SMS abuse
// Create table:
// CREATE TABLE otp_send_log (
//   phone TEXT NOT NULL,
//   sent_at TIMESTAMPTZ DEFAULT NOW(),
//   ip_address TEXT
// );
// CREATE INDEX idx_otp_send_phone_time ON otp_send_log(phone, sent_at);

// Before sending OTP:
const recentCount = await pool.query(
  `SELECT COUNT(*) FROM otp_send_log
   WHERE phone = $1 AND sent_at > NOW() - INTERVAL '1 hour'`,
  [phone]
);
if (parseInt(recentCount.rows[0].count) >= 5) {
  return res.status(429).json({ error: "Too many OTP requests. Try again in 1 hour." });
}
// Log the send
await pool.query(
  `INSERT INTO otp_send_log (phone, ip_address) VALUES ($1, $2)`,
  [phone, req.ip]
);
```

### FIX H-4: NOT NULL on Subscription FK

**Create:** `db/migrations/031_subscription_church_not_null.sql`
```sql
BEGIN;

-- Backfill any NULL church_ids from member's church
UPDATE subscriptions s
SET church_id = m.church_id
FROM members m
WHERE s.member_id = m.id AND s.church_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE subscriptions ALTER COLUMN church_id SET NOT NULL;

-- Add CHECK constraint for member/family_member
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscription_person
  CHECK (member_id IS NOT NULL OR family_member_id IS NOT NULL);

COMMIT;
```

### FIX H-5: Per-Route Error Boundaries

**File:** `frontend/src/App.tsx` (route definitions)
```tsx
import { ErrorBoundary } from "./ErrorBoundary";

// Wrap each lazy-loaded route:
<Route path="/dashboard" element={
  <ErrorBoundary fallback={<PageErrorFallback />}>
    <Suspense fallback={<PageSpinner />}>
      <DashboardPage />
    </Suspense>
  </ErrorBoundary>
} />

// Create a simple PageErrorFallback:
function PageErrorFallback() {
  return (
    <div className="error-page">
      <h2>Something went wrong</h2>
      <p>This page encountered an error. Please try refreshing.</p>
      <button onClick={() => window.location.reload()}>Refresh Page</button>
    </div>
  );
}
```

### FIX H-6: Payment Audit Logging

**File:** `src/routes/paymentRoutes.ts` (after successful verify)
```typescript
import { persistAuditLog } from "../utils/auditLog";

// After payment verified and stored:
await persistAuditLog(pool, {
  actor_user_id: req.user.id,
  action: "payment.verified",
  entity_type: "payment",
  entity_id: paymentRecord.id,
  ip_address: req.ip || "",
  details: {
    amount: paymentRecord.amount,
    transaction_id: paymentRecord.transaction_id,
    subscription_ids: paymentRecord.subscription_ids,
    payment_method: "razorpay",
  },
});

// After refund processed:
await persistAuditLog(pool, {
  actor_user_id: req.user.id,
  action: "payment.refunded",
  entity_type: "payment",
  entity_id: paymentRecord.id,
  ip_address: req.ip || "",
  details: { refund_amount, reason },
});
```

### FIX H-10: Loading/Error States on PublicDonationPage

**File:** `frontend/src/pages/PublicDonationPage.tsx`
```tsx
// Add error state:
const [loadError, setLoadError] = useState(false);

// Replace silent catches:
fetch(`${API_BASE_URL}/api/diocese/public-list`)
  .then((r) => r.ok ? r.json() : Promise.reject("Failed"))
  .then((data) => setDioceses(data))
  .catch(() => setLoadError(true));

// In JSX:
{loadError && (
  <div className="error-banner">
    Unable to load donation options. Please refresh the page.
    <button onClick={() => window.location.reload()}>Retry</button>
  </div>
)}
{loadingChurches && <Spinner />}
```

### FIX M-1: Missing Zod Schemas (7 endpoints)

```typescript
// Example: engagementRoutes.ts — prayer request create
import { z } from "zod";

const prayerRequestSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().min(1).max(2000).trim(),
  is_anonymous: z.boolean().optional().default(false),
});

router.post("/prayer-requests", requireAuth, async (req, res) => {
  const parsed = prayerRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  // use parsed.data instead of req.body
});
```

### FIX M-2: Rate Limiters for Enumeration Endpoints

**File:** `src/app.ts` (add after existing rate limiters)
```typescript
const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many search requests" },
});

app.use("/api/members/list", searchLimiter);
app.use("/api/members/search", searchLimiter);
app.use("/api/admins/income", sensitiveLimiter);
app.use("/api/admins/growth", sensitiveLimiter);
app.use("/api/subscriptions/activity", sensitiveLimiter);
```

### FIX M-8: Remove Unused postgresql-client

**File:** `Dockerfile` (line 31)
```dockerfile
# REMOVE this line:
RUN apk add --no-cache postgresql-client
```

### FIX M-13: Disable Source Maps in Production

**File:** `frontend/vite.config.ts`
```typescript
export default defineConfig({
  build: {
    sourcemap: false, // Add this line
    // ...existing config
  },
});
```

---

## 8. TESTING ROADMAP TO 100%

### Phase 1: Critical Path Tests (Week 1)

```
frontend/__tests__/
├── auth/
│   ├── login-flow.test.tsx          # OTP send → verify → redirect
│   ├── token-refresh.test.tsx       # Auto-refresh at 25 min
│   └── logout.test.tsx              # Token cleared, redirect
├── payments/
│   ├── subscription-checkout.test.tsx  # Select dues → pay → verify
│   ├── donation-checkout.test.tsx      # Amount → Razorpay → receipt
│   ├── double-click.test.tsx           # busyRef prevents duplicate
│   └── public-donation.test.tsx        # Diocese → church → fund → pay
└── admin/
    ├── approve-reject.test.tsx         # Badge clears after action
    └── manual-payment.test.tsx         # Record payment → receipt
```

### Phase 2: Integration Tests (Week 2)

```
src/__tests__/integration/
├── payment-flow.test.ts      # Create order → mock Razorpay → verify → receipt
├── webhook-flow.test.ts      # Simulate payment.captured → DB update → receipt
├── subscription-dues.test.ts # Create subscription → generate dues → pay → clear
├── refund-flow.test.ts       # Request → approve → Razorpay refund → status update
└── rls-isolation.test.ts     # Church A cannot read Church B data
```

### Phase 3: E2E Tests (Week 3)

```
e2e/
├── playwright.config.ts
├── member-journey.spec.ts    # Join → link → view dashboard → pay dues
├── admin-journey.spec.ts     # Login → approve requests → record payment
├── donation-journey.spec.ts  # Public page → select church → donate → receipt
└── multi-church.spec.ts      # Switch churches → verify data isolation
```

---

## 9. CI/CD PIPELINE (Missing — Create This)

**Create:** `.github/workflows/ci.yml`
```yaml
name: CI/CD Pipeline
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: cd frontend && npm ci
      - run: npx tsc --noEmit
      - run: cd frontend && npx tsc --noEmit
      - run: cd frontend && npx eslint src/

  backend-tests:
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx vitest run --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: backend-coverage
          path: coverage/

  frontend-tests:
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd frontend && npm ci
      - run: cd frontend && npx vitest run --coverage

  build:
    runs-on: ubuntu-latest
    needs: [backend-tests, frontend-tests]
    steps:
      - uses: actions/checkout@v4
      - run: docker build --platform linux/amd64 -t shalom-backend .

  deploy-staging:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/develop'
    steps:
      - run: echo "Deploy to staging ECS"

  deploy-production:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - run: echo "Deploy to production ECS"
```

---

## 10. PREVENTION STRATEGY

| Practice | Tool / Process | Priority |
|----------|---------------|----------|
| Automated testing | Vitest + React Testing Library + Playwright E2E | IMMEDIATE |
| CI/CD pipeline | GitHub Actions: lint → typecheck → test → build → deploy | IMMEDIATE |
| Pre-commit hooks | Husky + lint-staged (ESLint + TypeScript strict) | HIGH |
| Dependency scanning | `npm audit` in CI + Dependabot / Renovate | HIGH |
| Load testing | k6 or Artillery against staging before each release | HIGH |
| RLS regression tests | SQL test suite that asserts cross-church queries fail | CRITICAL |
| Payment smoke tests | Razorpay sandbox E2E after every deploy | CRITICAL |
| Error budget / SLO | Track P50/P95 API latency + error rate in CloudWatch | MEDIUM |
| Staging environment | Separate ECS service + RDS instance for pre-prod validation | HIGH |
| Feature flags | LaunchDarkly or simple DB toggle for gradual rollouts | MEDIUM |
| Code review gates | Require 1 approval + passing CI before merge | HIGH |

---

## 11. FINAL VERDICT

### **PARTIALLY READY** ⚠️

**Safe for:** Soft launch / beta (< 1,000 users)
**Not safe for:** Scaled production (10K+ users) without fixing C-1 through C-5 and upgrading infrastructure.

### Path to 100/100:

| Phase | Items | Timeline | Score Impact |
|-------|-------|----------|-------------|
| **Phase 1** | Fix C-1 (RLS), C-2 (ECS), C-3 (RDS), C-5 (silent catches) | 2-3 days | 74 → 82 |
| **Phase 2** | Fix H-1 through H-10 (security + data + UX) | 1 week | 82 → 90 |
| **Phase 3** | Add frontend tests + E2E tests (C-4, H-9) | 1-2 weeks | 90 → 95 |
| **Phase 4** | Fix M-1 through M-14 + CI/CD pipeline | 1 week | 95 → 100 |

**Total estimated timeline to 100/100: ~4 weeks**

---

*Generated by automated codebase audit. All file paths and line numbers verified against codebase as of April 18, 2026.*
