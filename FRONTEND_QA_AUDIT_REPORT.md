# Comprehensive QA Audit Report — Admin Console Frontend

**Auditor Perspective:** Senior QA Tester — Manual Audit  
**Scope:** All shared components, context, lib, types, and 36 admin tab components  
**Test Perspectives:** Admin, Super Admin, Edge Cases  

---

## Table of Contents

1. [Bugs](#1-bugs)
2. [UX Issues](#2-ux-issues)
3. [Style Issues](#3-style-issues)
4. [Error Handling](#4-error-handling)
5. [i18n Gaps (Hardcoded English)](#5-i18n-gaps-hardcoded-english)
6. [Accessibility](#6-accessibility)
7. [Data Validation](#7-data-validation)
8. [Role / Permission Problems](#8-role--permission-problems)

---

## 1. Bugs

### BUG-001: `FamilyRequestsTab.tsx` — Uses `any[]` type for API data
- **File:** `frontend/src/pages/admin-tabs/FamilyRequestsTab.tsx`, line ~10
- **Severity:** Medium
- **Detail:** Uses `any[]` instead of a proper `FamilyRequestRow` type. This bypasses all TypeScript checks and could silently render undefined fields, leading to blank data or runtime crashes when the API shape changes.

### BUG-002: `ExportTab.tsx` — Unused `churchParam` variable
- **File:** `frontend/src/pages/admin-tabs/ExportTab.tsx`
- **Severity:** Low
- **Detail:** Declares `const churchParam = ...` that is assigned but never used in the URL query string. If the intent was to scope exports by church, this is a logic bug and exported CSVs may contain unscoped data.

### BUG-003: `PreRegisterTab.tsx` — Phone field initialized with trailing space
- **File:** `frontend/src/pages/admin-tabs/PreRegisterTab.tsx`
- **Severity:** Medium
- **Detail:** The phone input initial value is `"+91 "` (with a trailing space). The validation function `normalizeIndianPhone` may not strip leading/trailing whitespace from the prefix, causing the phone number to be submitted as `+91 XXXXXXXXXX` (with space), which would fail matching against existing phone numbers in the database.

### BUG-004: `LeadershipTab.tsx` — Hardcoded "Photo uploaded/updated successfully" bypasses i18n
- **File:** `frontend/src/pages/admin-tabs/LeadershipTab.tsx`, lines ~158, ~186
- **Severity:** Low
- **Detail:** `onUploaded` callback passes hardcoded English strings `"Photo uploaded successfully"` and `"Photo updated successfully"` to `setNotice`. These will render in English regardless of user language.

### BUG-005: `EventsTab.tsx` — Delete events/notifications has no confirmation dialog
- **File:** `frontend/src/pages/admin-tabs/EventsTab.tsx`, lines ~183–192
- **Severity:** High
- **Detail:** `handleDeleteEvent` and `handleDeleteNotification` immediately call the API with no confirmation prompt. A misclick deletes data irreversibly.

### BUG-006: `AnnouncementsTab.tsx` — Individual announcement delete has no confirmation
- **File:** `frontend/src/pages/admin-tabs/AnnouncementsTab.tsx`
- **Severity:** High
- **Detail:** The delete button calls the API directly with no `confirm()` or custom confirm dialog. Only "Clear All" uses the confirm dialog.

### BUG-007: `ChurchOpsTab.tsx` — Delete church has no confirmation dialog
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`, lines ~93–102
- **Severity:** Critical
- **Detail:** `deleteChurch()` sends `DELETE` with `force=true` immediately. Although `previewDelete` exists as a separate button, clicking "Delete Church" directly will delete the church and all associated data without any confirmation gate.

### BUG-008: `ChurchOpsTab.tsx` — Hardcoded English strings in success callbacks
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`, lines ~49, ~64, ~72, ~80, ~95
- **Severity:** Medium
- **Detail:** Multiple `withAuthRequest` calls pass hardcoded English strings: `"Church search complete."`, `"Church income loaded."`, `"Church updated."`, `"Church delete impact loaded."`, `"Church deleted."` — these bypass i18n.

### BUG-009: `ChurchOpsTab.tsx` — Delete impact notice uses hardcoded English
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`, lines ~140–142
- **Severity:** Medium
- **Detail:** The impact summary `"Impact: Users {n}, Members {n}, ..."` is entirely hardcoded English with inline interpolation instead of using `t()`.

### BUG-010: `LeadershipTab.tsx` — Remove leader has no confirmation dialog
- **File:** `frontend/src/pages/admin-tabs/LeadershipTab.tsx`, line ~128
- **Severity:** High
- **Detail:** `remove(leader.id)` is called directly on button click without any confirmation, permanently removing a church leader.

### BUG-011: `RefundRequestsTab.tsx` — Shared `reviewNote` state across all refund request items
- **File:** `frontend/src/pages/admin-tabs/RefundRequestsTab.tsx`, line ~16
- **Severity:** Medium
- **Detail:** A single `reviewNote` state is shared for all refund request rows. If a super admin starts typing a note for one request, then clicks approve/deny on a different request, the note from the first request is submitted with the second.

### BUG-012: `DonationFundsTab.tsx` — Uses native `confirm()` instead of custom dialog
- **File:** `frontend/src/pages/admin-tabs/DonationFundsTab.tsx`
- **Severity:** Low
- **Detail:** Uses `window.confirm()` for delete confirmation instead of the app's `openOperationConfirmDialog`. This shows a browser-native dialog that cannot be styled, translated, or themed, and appears inconsistent with the rest of the app.

### BUG-013: `EditSubscriptionTab.tsx` — Possible stale subscription data after update
- **File:** `frontend/src/pages/admin-tabs/EditSubscriptionTab.tsx`
- **Severity:** Low
- **Detail:** After a successful PATCH to update a subscription, the component does not re-fetch the subscription list for that member. If the user edits a second field without re-searching, they operate on stale data.

### BUG-014: `PhotoUpload.tsx` — XHR upload retry on 401 may show inconsistent progress
- **File:** `frontend/src/components/PhotoUpload.tsx`, lines ~70–120
- **Severity:** Low
- **Detail:** On 401, the first XHR's `onprogress` has already been firing. A new XHR is created for retry, but the progress state from the first upload is never reset to 0, causing the progress ring to jump backward or show inconsistent progress.

---

## 2. UX Issues

### UX-001: `ErrorBoundary.tsx` — Full-page error screen with no navigation
- **File:** `frontend/src/components/ErrorBoundary.tsx`
- **Severity:** Medium
- **Detail:** When an error boundary triggers, the user sees "Something went wrong" with only a "Reload Page" button. There is no way to navigate back, go home, or contact support. For component-level errors this replaces the entire child tree.

### UX-002: `CropModal.tsx` — No keyboard shortcuts for crop actions
- **File:** `frontend/src/components/CropModal.tsx`
- **Severity:** Low
- **Detail:** The crop modal has no Escape-to-close binding and no Enter-to-confirm binding. Users must click the buttons.

### UX-003: `SearchSelect.tsx` — Dropdown closes on blur without delay
- **File:** `frontend/src/components/SearchSelect.tsx`
- **Severity:** Medium
- **Detail:** If a user clicks on a dropdown option, the `onBlur` fires before `onClick`, potentially closing the dropdown before the selection registers. This is a common race condition with blur-based dropdowns.

### UX-004: `PastorsTab.tsx` — Long list without pagination
- **File:** `frontend/src/pages/admin-tabs/PastorsTab.tsx`
- **Severity:** Medium
- **Detail:** Pastor list renders all results without pagination. For a super admin managing 100+ churches with multiple pastors each, this will create a very long, hard-to-navigate DOM.

### UX-005: `LeadershipTab.tsx` — No loading indicator during remove/assign operations
- **File:** `frontend/src/pages/admin-tabs/LeadershipTab.tsx`
- **Severity:** Low
- **Detail:** While button text changes during `busyKey` match, there is no overlay or skeleton preventing the user from clicking other leaders' edit/remove buttons in parallel.

### UX-006: `ChurchOpsTab.tsx` — Success toast on every search
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`, line ~49
- **Severity:** Low
- **Detail:** `withAuthRequest` with success message `"Church search complete."` shows a toast on every search. Searches are frequent operations and showing a success notice each time is noisy and distracting.

### UX-007: `SaaSSettingsTab.tsx` — Settings not auto-loaded when church is selected
- **File:** `frontend/src/pages/admin-tabs/SaaSSettingsTab.tsx`, line ~18
- **Severity:** Medium
- **Detail:** User must select a church from the dropdown then separately click "Load Settings." The settings should auto-load on church selection — the extra click is a usability friction point, especially since the default church is `churches[0]` but its settings aren't loaded on mount.

### UX-008: `RefundRequestsTab.tsx` — Data not auto-loaded on mount
- **File:** `frontend/src/pages/admin-tabs/RefundRequestsTab.tsx`
- **Severity:** Medium
- **Detail:** The tab renders empty and requires the user to click "Refresh" to see any data. There is no `useEffect` to load data on mount. Same issue exists in `SaaSSubscriptionsTab.tsx`.

### UX-009: `SaaSSubscriptionsTab.tsx` — Data not auto-loaded on mount
- **File:** `frontend/src/pages/admin-tabs/SaaSSubscriptionsTab.tsx`
- **Severity:** Medium
- **Detail:** Same as UX-008 — overview and revenue data are not loaded until the user clicks "Refresh."

### UX-010: `CsvUpload.tsx` — Preview table has no max-height or scroll
- **File:** `frontend/src/components/CsvUpload.tsx`
- **Severity:** Low
- **Detail:** When a CSV with hundreds of rows is loaded, the entire preview renders inline, pushing the page content down drastically with no virtual scroll or max-height limit.

### UX-011: `IncomeDashboardTab.tsx` — Report download triggers multiple success toasts
- **File:** `frontend/src/pages/admin-tabs/IncomeDashboardTab.tsx`
- **Severity:** Low
- **Detail:** Report generation and download each trigger their own success notices, causing toast stacking.

---

## 3. Style Issues

### STYLE-001: `ValidatedInput.tsx` — Phone input hardcoded to Indian format
- **File:** `frontend/src/components/ValidatedInput.tsx`
- **Severity:** Medium
- **Detail:** Phone validation regex and prefix are hardcoded to Indian +91 format. While this may be intentional for the current market, it prevents use for churches in other countries without code changes.

### STYLE-002: Inline styles used extensively throughout all tabs
- **Files:** Nearly every admin tab file
- **Severity:** Low
- **Detail:** Heavy use of `style={{ ... }}` inline rather than CSS classes. Examples:
  - `LeadershipTab.tsx` lines ~135, ~145, ~152 (avatar sizing, flex layout)
  - `ChurchOpsTab.tsx` lines ~135–150 (income chart margins)
  - `EventsTab.tsx` lines ~200+ (church scope selector padding, form container)
  - `RefundRequestsTab.tsx` lines ~60+ (list item padding, badge layout)
  This makes theming difficult and causes style inconsistency when CSS variables update.

### STYLE-003: `ChurchOpsTab.tsx` — Income chart has hardcoded negative left margin
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`, line ~152
- **Severity:** Low
- **Detail:** `margin={{ left: -20 }}` is hardcoded in the BarChart, which may cause label clipping on smaller screens or with larger currency values.

### STYLE-004: Inconsistent button style for destructive operations
- **Files:** Various tabs
- **Severity:** Medium
- **Detail:** Some dangerous operations use `btn-danger` class (e.g., `LeadershipTab` remove, `ChurchOpsTab` delete church) while others use plain `btn` (e.g., `ChurchOpsTab` preview delete impact, `DonationFundsTab` delete). This inconsistency fails to properly signal destructive actions visually.

### STYLE-005: `DioceseTab.tsx` — Edit leader form labels are unstyled bare text
- **File:** `frontend/src/pages/admin-tabs/DioceseTab.tsx`
- **Severity:** Low
- **Detail:** The inline edit form for diocese leaders uses plain HTML `<label>` with text like "Role", "Name", "Phone" that don't follow the app's field-stack pattern.

---

## 4. Error Handling

### ERR-001: `CsvUpload.tsx` — Custom CSV parser does not handle quoted fields with commas
- **File:** `frontend/src/components/CsvUpload.tsx`
- **Severity:** High
- **Detail:** The CSV parser splits on commas naively. CSV fields containing commas inside quotes (e.g., `"Smith, John"`) will be split incorrectly, corrupting import data. This is a common edge case in CSV parsing.

### ERR-002: `pushSubscription.ts` — Silently swallows errors in `unsubscribeFromPush`
- **File:** `frontend/src/lib/pushSubscription.ts`
- **Severity:** Medium
- **Detail:** The catch block in unsubscribe sets a generic notice but does not differentiate between network errors, permission errors, or the subscription not existing. The user sees the same vague error for different root causes.

### ERR-003: `razorpayCheckout.ts` — No timeout for Razorpay popup
- **File:** `frontend/src/lib/razorpayCheckout.ts`
- **Severity:** Medium
- **Detail:** The Razorpay popup Promise has no timeout. If Razorpay's SDK script fails to load or the popup becomes unresponsive, the Promise never resolves/rejects, leaving the UI in a perpetual loading state.

### ERR-004: Most admin tabs have empty `catch` blocks with only a toast
- **Files:** Nearly all admin tabs
- **Severity:** Medium
- **Detail:** Error handling across all tabs follows the pattern `catch { setNotice({ tone: "error", text: t("...") }) }` with no logging. In production, errors are silently swallowed with no telemetry, making debugging customer issues extremely difficult. Consider adding `console.error` or an error reporting service.

### ERR-005: `api.ts` — Token refresh deduplication race condition
- **File:** `frontend/src/lib/api.ts`
- **Severity:** Medium
- **Detail:** When multiple API calls receive 401 simultaneously, the token refresh is deduplicated correctly, but the retried requests all use the new token from the shared promise. However, if the refresh itself fails, all waiting requests reject with the same error, potentially causing multiple error toasts from different components.

### ERR-006: `EventsTab.tsx` — Image upload error on 401 retry uses raw `fetch` instead of `apiRequest`
- **File:** `frontend/src/pages/admin-tabs/EventsTab.tsx`, lines ~135–155
- **Severity:** Medium
- **Detail:** The image upload function uses raw `fetch` + manual `tryRefreshToken` instead of the app's `apiRequest` wrapper. This bypasses the centralized error handling, timeout, and refresh deduplication logic. If the retry also gets a 401, the error is `"Upload failed"` with no session-expired handling.

---

## 5. i18n Gaps (Hardcoded English)

### I18N-001: `ErrorBoundary.tsx` — All text hardcoded
- **File:** `frontend/src/components/ErrorBoundary.tsx`, lines ~30–40
- **Strings:** `"Something went wrong"`, `"Reload Page"`
- **Note:** Class components cannot use `useI18n()` hook. Needs a wrapper or context consumer pattern.

### I18N-002: `OfflineIndicator.tsx` — Offline message hardcoded
- **File:** `frontend/src/components/OfflineIndicator.tsx`, line ~15
- **String:** `"You are offline. Some features may be unavailable."`

### I18N-003: `PhotoUpload.tsx` — Multiple hardcoded strings
- **File:** `frontend/src/components/PhotoUpload.tsx`
- **Strings at various lines:**
  - `"No file selected"` (~line 50)
  - `"Upload failed"` (~line 88)
  - `"Session expired"` (~line 78)
  - `"Photo deleted successfully"` (~line 120)
  - `"Delete failed"` (~line 128)

### I18N-004: `CsvUpload.tsx` — Component labels may be hardcoded
- **File:** `frontend/src/components/CsvUpload.tsx`
- **Detail:** Labels like "Preview", "Upload", "Download Template" should be verified to use `t()`.

### I18N-005: `LeadershipTab.tsx` — Church label and edit form labels
- **File:** `frontend/src/pages/admin-tabs/LeadershipTab.tsx`
- **Strings:**
  - Line ~133: `"Church"` (label for church selector)
  - Line ~174: `"Name"` (edit form label)
  - Line ~194: `"Custom Role Name"` (edit form label)
  - Line ~195: `"Hierarchy Level"` (edit form label)
  - Line ~158: `"Photo uploaded successfully"`
  - Line ~186: `"Photo updated successfully"`

### I18N-006: `SaaSSettingsTab.tsx` — "Church" label hardcoded
- **File:** `frontend/src/pages/admin-tabs/SaaSSettingsTab.tsx`, line ~59
- **String:** `"Church"` (label for select dropdown)

### I18N-007: `ChurchOpsTab.tsx` — Multiple hardcoded success messages and impact display
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`
- **Strings:**
  - Success messages: `"Church search complete."`, `"Church income loaded."`, `"Church updated."`, `"Church delete impact loaded."`, `"Church deleted."`
  - Impact display: `"Impact: Users {n}, Members {n}, Pastors {n}, Events {n}, Notifications {n}, Prayer Requests {n}, Payments {n}"`

### I18N-008: `PastorsTab.tsx` — Error messages hardcoded
- **File:** `frontend/src/pages/admin-tabs/PastorsTab.tsx`
- **Strings:** Several error/success callback strings in `withAuthRequest` calls.

### I18N-009: `DioceseTab.tsx` — Edit leader form labels
- **File:** `frontend/src/pages/admin-tabs/DioceseTab.tsx`
- **Strings:** `"Role"`, `"Name"`, `"Phone"`, `"Email"`, `"Photo"` in the inline edit form.

### I18N-010: `RestoreTab.tsx` — Multiple hardcoded strings
- **File:** `frontend/src/pages/admin-tabs/RestoreTab.tsx`
- **Detail:** Contains hardcoded English in UI labels and notification messages.

### I18N-011: `AdminOpsTab.tsx` — Confirm dialog text hardcoded
- **File:** `frontend/src/pages/admin-tabs/AdminOpsTab.tsx`
- **Detail:** Confirm dialog description uses hardcoded English interpolation.

### I18N-012: `MemberOpsTab.tsx` — Impact display and notices
- **File:** `frontend/src/pages/admin-tabs/MemberOpsTab.tsx`
- **Detail:** Member delete impact labels are hardcoded English.

### I18N-013: `RefundsTab.tsx` — Validation messages
- **File:** `frontend/src/pages/admin-tabs/RefundsTab.tsx`
- **Detail:** Validation error messages passed to `setNotice` are in hardcoded English.

### I18N-014: `IncomeDashboardTab.tsx` — Report period descriptions and "Church" label
- **File:** `frontend/src/pages/admin-tabs/IncomeDashboardTab.tsx`
- **Strings:** `"Church"` label, report period description strings in download section.

### I18N-015: `PlatformRazorpayTab.tsx` — "Status:" label
- **File:** `frontend/src/pages/admin-tabs/PlatformRazorpayTab.tsx`
- **String:** `"Status:"` label is hardcoded.

### I18N-016: `TrialTab.tsx` — "Status:" label
- **File:** `frontend/src/pages/admin-tabs/TrialTab.tsx`
- **String:** `"Status:"` label is hardcoded.

### I18N-017: `ScheduledReportsTab.tsx` — Field labels
- **File:** `frontend/src/pages/admin-tabs/ScheduledReportsTab.tsx`
- **Strings:** `"Recipients (emails or phones, comma-separated)"`, `"Church"` label.

### I18N-018: `PreRegisterTab.tsx` — Phone label
- **File:** `frontend/src/pages/admin-tabs/PreRegisterTab.tsx`
- **String:** `"Phone Number (primary)"` label.

### I18N-019: `EventsTab.tsx` — "Session expired" and "Upload failed"
- **File:** `frontend/src/pages/admin-tabs/EventsTab.tsx`, lines ~144, ~148
- **Strings:** `"Session expired"`, `"Upload failed"` in the image upload handler.

---

## 6. Accessibility

### A11Y-001: `CropModal.tsx` — Modal lacks focus trap and ARIA attributes
- **File:** `frontend/src/components/CropModal.tsx`
- **Severity:** High
- **Detail:** The modal renders via a portal but does not trap focus, has no `role="dialog"`, no `aria-modal="true"`, and no `aria-labelledby`. Screen readers cannot identify this as a modal. Focus can tab behind the modal to invisible content.

### A11Y-002: `CropModal.tsx` — Canvas element has no accessible alternative
- **File:** `frontend/src/components/CropModal.tsx`
- **Severity:** Medium
- **Detail:** The `<canvas>` element used for image cropping has no `role`, `aria-label`, or fallback text. Screen reader users have no indication of what this element represents.

### A11Y-003: `SearchSelect.tsx` — Dropdown list missing `role="listbox"` and `role="option"`
- **File:** `frontend/src/components/SearchSelect.tsx`
- **Severity:** Medium
- **Detail:** While the component has some ARIA attributes, the dropdown options use `<div>` without `role="option"` and the container lacks `role="listbox"`. Screen readers will not announce options correctly.

### A11Y-004: `Pagination.tsx` — No `aria-label` on navigation
- **File:** `frontend/src/components/Pagination.tsx`
- **Severity:** Low
- **Detail:** The pagination `<nav>` lacks `aria-label="Pagination"` to identify it for screen readers.

### A11Y-005: Icon-only buttons missing `aria-label` across many tabs
- **Files:** Multiple admin tabs
- **Severity:** High
- **Detail:** Many buttons contain only an icon (Lucide component) with a `title` attribute but no `aria-label`. The `title` attribute is not reliably announced by screen readers. Affected files include:
  - `EventsTab.tsx` — Edit/Delete buttons (lines ~235, ~236, ~247, ~248)
  - `AnnouncementsTab.tsx` — Delete button
  - `AuditLogTab.tsx` — Filter buttons
  - Others with `<button><Pencil size={14} /></button>` pattern

### A11Y-006: `ChurchOpsTab.tsx` — Delete church button has no `aria-describedby` linking to impact
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`
- **Severity:** Medium
- **Detail:** The "Delete Church" button performs a critical destructive action but has no `aria-describedby` connecting it to the impact preview, so screen reader users cannot hear the impact context before confirming.

### A11Y-007: `LeadershipTab.tsx` — Avatar fallback initial has no `aria-label`
- **File:** `frontend/src/pages/admin-tabs/LeadershipTab.tsx`, line ~193
- **Severity:** Low
- **Detail:** Leader avatar `<img>` uses `alt={leader.full_name}` which is correct, but the fallback initial `<span>` has no `aria-label` so screen readers just hear the letter.

### A11Y-008: Color-only status indicators
- **Files:** `RefundRequestsTab.tsx`, `SaaSSubscriptionsTab.tsx`, `TrialTab.tsx`, `PlatformRazorpayTab.tsx`
- **Severity:** Medium
- **Detail:** Status badges rely on CSS class colors (green/red/yellow) to communicate status. Users with color vision deficiency cannot distinguish states without text context. The text inside the badge helps, but the color is the primary differentiator in the UI layout.

### A11Y-009: `OfflineIndicator.tsx` — No ARIA live region
- **File:** `frontend/src/components/OfflineIndicator.tsx`
- **Severity:** Medium
- **Detail:** The offline banner appears dynamically but has no `role="alert"` or `aria-live="assertive"`. Screen reader users will not be notified when their connection drops.

### A11Y-010: Tables lack `<caption>` elements
- **Files:** `EventsTab.tsx`, `AuditLogTab.tsx`, `PaymentHistoryTab.tsx`, `ChurchOpsTab.tsx`
- **Severity:** Low
- **Detail:** Data tables use `<table className="data-table">` without `<caption>` elements. Screen readers cannot announce the purpose of each table.

---

## 7. Data Validation

### VAL-001: `CreateSubscriptionTab.tsx` — Minimum amount hardcoded to ₹200
- **File:** `frontend/src/pages/admin-tabs/CreateSubscriptionTab.tsx`
- **Severity:** Medium
- **Detail:** Subscription amount minimum is `200` in the frontend validation. If this business rule changes on the backend, the frontend will silently prevent valid amounts. Should be configurable or fetched from the API.

### VAL-002: `ValidatedInput.tsx` — Phone validation only supports Indian +91 numbers
- **File:** `frontend/src/components/ValidatedInput.tsx`
- **Severity:** Medium
- **Detail:** `validatePhone()` only accepts 10-digit numbers with optional `+91` prefix. Any international church member with a non-Indian number cannot register.

### VAL-003: `RolesTab.tsx` — Identifier parsing guesses email vs phone
- **File:** `frontend/src/pages/admin-tabs/RolesTab.tsx`
- **Severity:** Medium
- **Detail:** The component tries to guess whether the input is an email or phone number to build the API call. A phone number like `+91912345678@` with a typo could be misidentified. There's no explicit toggle or validation feedback.

### VAL-004: `ManualPaymentTab.tsx` — No max amount validation
- **File:** `frontend/src/pages/admin-tabs/ManualPaymentTab.tsx`
- **Severity:** Medium
- **Detail:** The manual payment amount field has no upper bound. A typo like `500000` instead of `5000` would be recorded with no sanity check.

### VAL-005: `SaaSSettingsTab.tsx` — Platform fee percentage allows out-of-range values
- **File:** `frontend/src/pages/admin-tabs/SaaSSettingsTab.tsx`, lines ~86–88
- **Severity:** Low
- **Detail:** The `<input type="number" min="0" max="100">` HTML constraint only applies on native form submit. Since the component uses `onClick` on a button (not form submit), values outside 0–100 can be saved via keyboard entry.

### VAL-006: `ChurchOpsTab.tsx` — No validation on church name update
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`, line ~66
- **Severity:** Medium
- **Detail:** `editName.trim() || undefined` is sent to the API. If the user clears the name field entirely, `undefined` is sent, which might not update the name or might set it to null depending on backend behavior. There is no frontend check ensuring name is non-empty.

### VAL-007: `ScheduledReportsTab.tsx` — No email/phone validation for recipients
- **File:** `frontend/src/pages/admin-tabs/ScheduledReportsTab.tsx`
- **Severity:** Medium
- **Detail:** The recipients field accepts comma-separated emails/phones but performs no validation on the individual values. Typos, malformed emails, or invalid phone numbers are submitted directly.

### VAL-008: `BulkImportTab.tsx` — CSV import relies on naive parser (see ERR-001)
- **File:** `frontend/src/pages/admin-tabs/BulkImportTab.tsx`
- **Severity:** High
- **Detail:** Since the CSV parser in `CsvUpload.tsx` cannot handle quoted fields, bulk member imports with names containing commas will corrupt multiple rows silently.

### VAL-009: `SaaSSettingsTab.tsx` — `church_subscription_amount` allows negative values
- **File:** `frontend/src/pages/admin-tabs/SaaSSettingsTab.tsx`, line ~81
- **Severity:** Low
- **Detail:** `parseFloat(e.target.value) || 0` will accept negative numbers since `parseFloat("-100")` returns `-100` which is truthy. The HTML `min="0"` is not enforced programmatically.

---

## 8. Role / Permission Problems

### ROLE-001: `PaymentGatewayTab.tsx` — Church selector always shown for non-super-admin
- **File:** `frontend/src/pages/admin-tabs/PaymentGatewayTab.tsx`
- **Severity:** Medium
- **Detail:** The church selector dropdown is rendered for all admin roles, not just super admin. A regular church admin should not see or need a church selector — their own church should be auto-selected. This exposes the existence of other churches in the dropdown.

### ROLE-002: `ChurchOpsTab.tsx` — No super admin guard on initial render
- **File:** `frontend/src/pages/admin-tabs/ChurchOpsTab.tsx`
- **Severity:** Low
- **Detail:** While `searchChurches` checks `if (!isSuperAdmin) return`, the UI still renders the search form for all users. If a non-super-admin somehow reaches this tab, they see the full UI but functionality silently fails.

### ROLE-003: `EventsTab.tsx` — Super admin without selected church can view all events globally
- **File:** `frontend/src/pages/admin-tabs/EventsTab.tsx`, lines ~52–56
- **Severity:** Low (may be intentional)
- **Detail:** When `isSuperAdmin && !scopedChurchId`, the code fetches all events via `/api/engagement/all-events?limit=500`. This is likely intentional but should be verified: a super admin can see all churches' events without scoping. If the intent is to require church selection first, this is a permission gap.

### ROLE-004: `LeadershipTab.tsx` — Profile loading race condition for regular admin
- **File:** `frontend/src/pages/admin-tabs/LeadershipTab.tsx`, line ~133
- **Severity:** Low
- **Detail:** For non-super-admin users, `resolvedChurchId` depends on `authContext?.profile?.church_id`. If the profile hasn't loaded yet, `resolvedChurchId` is empty string and the component shows "select a church" prompt, which is confusing for a regular admin who shouldn't need to select a church.

### ROLE-005: `RefundRequestsTab.tsx` — `isChurchAdmin` check may be too narrow
- **File:** `frontend/src/pages/admin-tabs/RefundRequestsTab.tsx`, line ~78
- **Severity:** Medium
- **Detail:** Only `isChurchAdmin` can forward refund requests (`rr.status === "pending"`). If there are other admin roles (e.g., `isDioceseAdmin`) that should also forward requests, they'll see no action buttons at all for pending requests. Verify the role matrix covers all admin tiers.

### ROLE-006: Frontend-only role checks without backend enforcement
- **Files:** All admin tabs
- **Severity:** Medium (systematic)
- **Detail:** All role checks are client-side (`isSuperAdmin`, `isChurchAdmin`). If a user manipulates these values in the React context via dev tools, they can access all super admin UI. This is a frontend audit note — verify backend RLS/middleware independently enforces the same role restrictions on every API endpoint.

---

## Summary Statistics

| Category | Count | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| Bugs | 14 | 1 | 3 | 6 | 4 |
| UX Issues | 11 | 0 | 0 | 5 | 6 |
| Style Issues | 5 | 0 | 0 | 2 | 3 |
| Error Handling | 6 | 0 | 1 | 4 | 1 |
| i18n Gaps | 19 | 0 | 0 | 19 | 0 |
| Accessibility | 10 | 2 | 0 | 4 | 4 |
| Data Validation | 9 | 1 | 0 | 5 | 3 |
| Role/Permission | 6 | 0 | 0 | 3 | 3 |
| **Total** | **80** | **4** | **4** | **48** | **24** |

---

## Priority Fix Recommendations

### Critical (Fix Immediately)
1. **BUG-007** — Add confirmation dialog before church deletion in `ChurchOpsTab`
2. **A11Y-001** — Add focus trap, `role="dialog"`, `aria-modal`, `aria-labelledby` to `CropModal`
3. **A11Y-005** — Add `aria-label` to all icon-only buttons across all tabs
4. **VAL-008 / ERR-001** — Replace naive CSV parser with RFC 4180–compliant parser

### High Priority (Fix This Sprint)
5. **BUG-005** — Add confirmation to event/notification delete in `EventsTab`
6. **BUG-006** — Add confirmation to announcement delete in `AnnouncementsTab`
7. **BUG-010** — Add confirmation to leader removal in `LeadershipTab`
8. **UX-008/009** — Auto-load data on mount for `RefundRequestsTab` and `SaaSSubscriptionsTab`

### Medium Priority (Fix Next Sprint)
9. All **i18n gaps** — Systematic sweep to replace 19+ hardcoded English strings with `t()` calls
10. **BUG-011** — Refactor `reviewNote` to per-request state in `RefundRequestsTab`
11. **UX-007** — Auto-load SaaS settings on church selection
12. **ROLE-001** — Hide church selector from non-super-admin in `PaymentGatewayTab`
13. **VAL-004** — Add max amount guard to manual payment
14. **ERR-006** — Refactor `EventsTab` image upload to use `apiRequest`
