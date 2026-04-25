# Shalom Church App — 7-Day Customer Experience Audit

**Date:** 19 April 2026
**Method:** Simulated 7 days of daily app usage as a paying member, family head, and church admin
**Total Issues Found:** 62

---

## Summary by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| **P0 — Broken** | 2 | Feature completely non-functional |
| **P1 — Critical** | 16 | Money anxiety, data loss risk, i18n broken on entire pages |
| **P2 — High** | 28 | Dead ends, navigation gaps, confusing flows |
| **P3 — Low** | 16 | Polish, consistency, accessibility |

---

## Phase 1 — Trust & Safety (P0 + P1 Critical)

*Fix these before any user touches the app. Broken payments, dead features, and dangerous actions.*

### P0-1: ChurchPicker never rendered — multi-church users stuck

- **File:** `frontend/src/components/ChurchPicker.tsx`, `frontend/src/App.tsx`, `frontend/src/hooks/useAuth.ts`
- **Problem:** `ChurchPicker.tsx` exists with full UI. `useAuth.ts:161` sets `showChurchPicker = true` when a user belongs to multiple churches. But `ChurchPicker` is never imported or rendered in `App.tsx` or anywhere else. Multi-church users see nothing and are silently stuck.
- **Fix:** Import `ChurchPicker` in `App.tsx` and conditionally render it when `auth.showChurchPicker` is true. Also add a "Switch Church" button to the sidebar.

### P0-2: No "Switch Church" button anywhere in the UI

- **File:** `frontend/src/hooks/useAuth.ts:195-207`, `frontend/src/App.tsx`
- **Problem:** `switchChurch()` function exists in `useAuth.ts` but is never exposed in any UI — no sidebar button, no settings option. Multi-church users have zero way to switch after initial login.
- **Fix:** Add "Switch Church" item to the sidebar nav for users with `churches.length > 1`.

### P1-1: Payment verification failure shows ERROR tone — terrifying

- **File:** `frontend/src/pages/DashboardPage.tsx:325-333`
- **Problem:** After money is debited, if verification returns HTTP 503, users see an **error-red** "verification pending" message. Money is gone but the UI screams "error". Should be `tone: "info"` or `tone: "warning"` with reassuring copy.
- **Fix:** Change `tone: "error"` to `tone: "warning"` for 503/0 verification responses. Update the i18n text to say "Your payment is being verified. This usually takes a few seconds. Your dashboard will update automatically."

### P1-2: No post-payment confirmation screen

- **File:** `frontend/src/pages/DashboardPage.tsx:315-320`
- **Problem:** After successful payment, the code clears selections, refreshes dashboard, shows a 4-second toast. No confirmation screen with: amount paid, transaction ID, date, or "Download Receipt" button. Customer is dumped back to the dashboard.
- **Fix:** Show a payment success modal with amount, transaction ID, date/time, and a "Download Receipt" link. Only dismiss on user action.

### P1-3: No donation receipt or proof after payment

- **File:** `frontend/src/pages/DonationCheckoutPage.tsx:105-138`
- **Problem:** Donation success shows a "Thank You" message with a scripture verse but: no receipt download, no transaction ID, no payment reference number. Donors have no proof for tax deductions.
- **Fix:** Display transaction ID on success screen. Add "Download Receipt" button.

### P1-4: Razorpay modal shows generic "Shalom — Payment"

- **File:** `frontend/src/lib/razorpayCheckout.ts:51-52`
- **Problem:** Fallback `name: "Shalom"` and `description: "Payment"` appear in bank statements / UPI apps when church-specific values aren't passed. Looks untrustworthy — "Who is Shalom? Is this a scam?"
- **Fix:** Always pass actual church name and descriptive text (e.g., "Monthly Subscription — Grace Church").

### P1-5: Donation checkout shows generic i18n key as church name

- **File:** `frontend/src/pages/DonationCheckoutPage.tsx:73`
- **Problem:** `name: t("donation.churchName")` is a translation key, not the actual church name variable. Donors see a generic translated string in the Razorpay modal instead of the actual church name.
- **Fix:** Use the `churchName` state variable instead of the i18n key.

### P1-6: "Selected Church" placeholder never resolves

- **File:** `frontend/src/pages/PublicDonationPage.tsx:83-86`
- **Problem:** When navigating via URL `?church=<id>`, placeholder `"Selected Church"` is set and **never replaced** with the actual name from the API. User sees "Selected Church" throughout checkout.
- **Fix:** Fetch church name from API when `urlChurchId` is present, and replace the placeholder.

### P1-7: "Waived" processing fee is a dark pattern

- **File:** `frontend/src/components/CheckoutSummary.tsx:46-77`
- **Problem:** When no platform fee is configured, checkout invents a phantom 1% fee and shows it crossed out as "Waived." Customers wonder: "Will I be charged 1% next time?" Erodes trust.
- **Fix:** If there's no fee, don't show any fee line. Only show fee details if a fee is actually configured.

### P1-8: Delete account — no confirmation friction

- **File:** `frontend/src/pages/SettingsPage.tsx:65, 205-210`
- **Problem:** No "type DELETE to confirm" pattern. Modal opens, user can immediately click delete. Reason field is optional and can be empty. For an irreversible action, this is dangerously frictionless.
- **Fix:** Add a confirmation input (type "DELETE" or your phone number) and make reason mandatory with minimum length.

### P1-9: Sign out has no confirmation dialog

- **File:** `frontend/src/pages/SettingsPage.tsx:137`
- **Problem:** `navigate("/signout")` fires directly on click. No "Are you sure?" dialog. One accidental tap and you're logged out.
- **Fix:** Add a confirmation dialog before navigating to `/signout`.

### P1-10: Event/notification delete has no confirmation

- **File:** `frontend/src/pages/admin-tabs/EventsTab.tsx:366`
- **Problem:** `handleDeleteEvent` fires immediately on click — no confirm dialog, unlike other destructive admin actions.
- **Fix:** Add `openOperationConfirmDialog` before delete, consistent with other admin panels.

### P1-11: Push notification send has no preview or confirmation

- **File:** `frontend/src/pages/admin-tabs/PushNotificationTab.tsx:118-147`
- **Problem:** Admin fills in title + body and clicks Send. No preview, no "Send to X users?" confirmation. A mass push to all members with a typo can't be undone.
- **Fix:** Add a confirmation step showing preview + estimated recipient count.

### P1-12: HistoryPage entirely hardcoded English (i18n broken)

- **File:** `frontend/src/pages/HistoryPage.tsx` — 20+ strings
- **Problem:** Every label — "Payment History", "Month and Year", "Paid Amount", "Download Receipt", "No monthly payment entries found", "Loading..." — all bypass `t()`. Hindi/Tamil users see a fully English page.
- **Fix:** Replace all hardcoded strings with `t()` calls and add keys to all locale files.

### P1-13: PublicDonationPage extensively hardcoded English

- **File:** `frontend/src/pages/PublicDonationPage.tsx` — 15+ strings
- **Problem:** "Select Church", "Choose Diocese", "Loading churches...", "Phone Number *", "Invalid email address", "Retry" — all hardcoded English.
- **Fix:** Replace all hardcoded strings with `t()` calls.

### P1-14: DonationLinksTab entirely hardcoded English

- **File:** `frontend/src/pages/admin-tabs/DonationLinksTab.tsx` — 12+ strings
- **Problem:** "Donation Links & QR Codes", "Diocese", "Church", "Fund", "Donation Link", "Copy", "QR Code", "Download QR Code" — all hardcoded.
- **Fix:** Replace all hardcoded strings with `t()` calls.

### P1-15: PaymentHistoryTab (Admin) hardcoded English

- **File:** `frontend/src/pages/admin-tabs/PaymentHistoryTab.tsx` — 8+ strings
- **Problem:** "Filter by person name", "Month and Year", "Member" fallback, "Prev"/"Next" — all hardcoded English.
- **Fix:** Replace with `t()` calls.

### P1-16: ChurchPicker hardcoded English

- **File:** `frontend/src/components/ChurchPicker.tsx:12-13`
- **Problem:** "Select your church" and "You belong to multiple churches..." are hardcoded English.
- **Fix:** Use `t()` i18n calls.

---

## Phase 2 — Dead Ends & Navigation (P2 High)

*Fix user flows that lead nowhere and navigation that hides features.*

### P2-1: JoinPage dead end — no fallback if user lacks code

- **File:** `frontend/src/pages/JoinPage.tsx:31`
- **Problem:** Asks for 8-digit church code with no explanation of where to get it. No "I don't have a code" link, no church explorer, no contact help. Just a text field and "Sign Out."
- **Fix:** Add "Don't have a code?" link with options: contact your church admin, or explore churches (if applicable).

### P2-2: Family dependent dead end — only action is sign out

- **File:** `frontend/src/pages/DashboardPage.tsx` (dependent view)
- **Problem:** Dependent family members see only "Sign Out" — feels like rejection. No explanation of what a family account means, no way to contact the head or admin.
- **Fix:** Show a friendly message explaining their family role, who the head is, and how to contact the church admin.

### P2-3: History empty state is a dead end

- **File:** `frontend/src/pages/HistoryPage.tsx:168-171`
- **Problem:** "No monthly payment entries found" with a receipt icon. No guidance like "Go to Dashboard to make your first payment."
- **Fix:** Add a CTA button linking to the dashboard.

### P2-4: No Settings in BottomNav — feature hidden

- **File:** `frontend/src/components/BottomNav.tsx:12-18`
- **Problem:** Bottom nav has Home, Dashboard, Donate, Events, Profile — no Settings. Users must discover settings through the hamburger sidebar.
- **Fix:** Add a gear icon to the Profile page header, or replace one nav item with Settings.

### P2-5: No notification badges on BottomNav

- **File:** `frontend/src/components/BottomNav.tsx:8-20`
- **Problem:** NotificationBadge component exists and badge counts (`duesCount`, `totalAdminPending`) are computed in App.tsx, but never wired to BottomNav icons.
- **Fix:** Pass badge counts as props to BottomNav and render NotificationBadge on Dashboard and Events icons.

### P2-6: "Donate" tab visible when payments are disabled

- **File:** `frontend/src/components/BottomNav.tsx:14`
- **Problem:** If `paymentsEnabled` is false (Razorpay not configured), the Donate tab still appears. Tapping leads to an error or disabled state.
- **Fix:** Conditionally hide Donate tab when `paymentsEnabled` is false.

### P2-7: isSuperAdmin prop passed to BottomNav but discarded

- **File:** `frontend/src/components/BottomNav.tsx:6-7`
- **Problem:** `isSuperAdmin` is received and immediately aliased to `_isSuperAdmin` (unused). Super admins see the same nav as members.
- **Fix:** Show an "Admin" tab in BottomNav for admin/super-admin users, or remove the unused prop.

### P2-8: No admin console link in BottomNav

- **File:** `frontend/src/components/BottomNav.tsx`
- **Problem:** Admins must use the hamburger sidebar to access admin tools — no direct admin link in the primary navigation.
- **Fix:** Add an "Admin" icon to BottomNav for users with admin roles.

### P2-9: Toast auto-dismiss in 4 seconds — too fast

- **File:** `frontend/src/App.tsx:242`
- **Problem:** `setTimeout(() => setNotice(...), 4000)` — payment confirmations, error messages, and all notices vanish in 4 seconds. Too fast to read, especially for older users.
- **Fix:** Payment-related notices: 10 seconds minimum. Errors: persist until dismissed. Add a close button to all notices.

### P2-10: New notices overwrite previous (no stacking)

- **File:** `frontend/src/App.tsx:102`
- **Problem:** Single `useState<Notice>` — if payment success is followed by a dashboard refresh error, the error overwrites the success. Customer never sees the payment confirmation.
- **Fix:** Use a notice queue/stack. Show multiple toasts or a FIFO queue.

### P2-11: Notice bar is inline, invisible on scroll

- **File:** `frontend/src/App.tsx:384`
- **Problem:** Rendered inline at page top, not as a floating toast. On mobile, if user has scrolled down, notices are invisible.
- **Fix:** Make notices float as a fixed-position toast at the top or bottom of the viewport.

### P2-12: "Pay Now" button disabled with no explanation

- **File:** `frontend/src/pages/DashboardPage.tsx:651-658`
- **Problem:** Three conditions can disable the button. User sees only a grayed button. No tooltip or text explaining why.
- **Fix:** Show helper text below the button: "Select subscriptions to pay", "Payments are not yet enabled", etc.

### P2-13: Subscription cancel button says "Cancel" — ambiguous

- **File:** `frontend/src/pages/DashboardPage.tsx:571-577`
- **Problem:** Generic "Cancel" text next to subscriptions. Users think it cancels the current action, not the subscription.
- **Fix:** Change label to "Request Cancellation" or "Cancel Subscription".

### P2-14: Cancel subscription modal — no warning about consequences

- **File:** `frontend/src/pages/DashboardPage.tsx:870-890`
- **Problem:** Modal only asks for a reason. No warning about: "Your access will end after current period", "This is a request that an admin must approve."
- **Fix:** Add clear warning text explaining consequences and that it requires admin approval.

### P2-15: No resend OTP button

- **File:** `frontend/src/pages/SignInPage.tsx` (OTP verification section)
- **Problem:** No "Resend OTP" button. Only option is "Change number" to go back and re-enter the same number. No countdown timer.
- **Fix:** Add a "Resend OTP" button with a 30-second cooldown timer.

### P2-16: No inline phone validation feedback

- **File:** `frontend/src/pages/SignInPage.tsx`
- **Problem:** No red border or hint text on invalid phone input. Error only appears as a toast after submit.
- **Fix:** Add inline validation with styled error text below the input.

### P2-17: Language selector appears after login — backwards

- **File:** `frontend/src/App.tsx` (language gate flow)
- **Problem:** User reads login form in default language, then is asked to choose a language. Should be before/during sign-in.
- **Fix:** Move language selector to the sign-in page (as a toggle in the corner) or show it on the splash page.

### P2-18: No refund path visible to members/donors

- **File:** Terms page mentions "contact church admin" but no UI link anywhere
- **Problem:** Members have no self-service refund option and no visible path/instructions to request one.
- **Fix:** Add a "Request Refund" link on payment history entries, or at minimum link to admin contact from payment details.

### P2-19: Events — no RSVP, no calendar integration, no venue/end-time

- **File:** `frontend/src/pages/EventsPage.tsx:39-61`
- **Problem:** Events show only title, message, and a start date. No RSVP mechanism, no "Add to Calendar" (.ics) button, no location, no end time.
- **Fix:** Add "Add to Calendar" button (generate .ics link). Location and end time require backend schema additions.

### P2-20: No read/unread notification visual

- **File:** `frontend/src/pages/EventsPage.tsx:67-85`
- **Problem:** All notifications render identically. No visual "read" vs "unread" distinction. No "Mark all read" button.
- **Fix:** Track read status (localStorage or API). Bold/highlight unread notifications. Add "Mark all read" button.

### P2-21: No notification preferences for members

- **File:** (none exists)
- **Problem:** Members receive all notifications with no way to opt out per category.
- **Fix:** Add notification preference toggles in Settings page.

### P2-22: Events vs Notifications naming confusion (admin)

- **File:** `frontend/src/pages/admin-tabs/EventsTab.tsx:290-300`
- **Problem:** EventsTab has "Events" and "Notifications" toggles. There's also a separate "Push Notifications" admin tab. Admin creates a "notification" in EventsTab thinking it's a push — it's not.
- **Fix:** Rename to "Announcements" vs "Push Notifications" to differentiate.

### P2-23: Admin badge count hardcoded wrong

- **File:** `frontend/src/pages/AdminConsolePage.tsx:201`
- **Problem:** "operations" group badge shows "6" but has 7 items. Hardcoded numbers instead of dynamic counts.
- **Fix:** Replace hardcoded badge counts with dynamic `{items.length}`.

### P2-24: Duplicate "Members" and "Leadership" buttons for church admins

- **File:** `frontend/src/pages/AdminConsolePage.tsx:206-217, 370-380`
- **Problem:** Church admins see these nav items in both the "operations" and "general" groups.
- **Fix:** Remove duplicates — show in one group only.

### P2-25: Family request approval — insufficient context

- **File:** `frontend/src/pages/admin-tabs/FamilyRequestsTab.tsx:60-75`
- **Problem:** Admin sees only requester name, target name, and relation. No membership IDs, no verification status, no existing family count.
- **Fix:** Show member status, verification state, and current family size alongside the request.

### P2-26: No member bulk actions in admin panel

- **File:** `frontend/src/pages/admin-tabs/MemberOpsTab.tsx`
- **Problem:** For a church with 500+ members, every status change or verification is one-at-a-time. No checkboxes, no "select all", no bulk operations.
- **Fix:** Add multi-select checkboxes with bulk verify/delete/export actions.

### P2-27: Sign-in hardcodes +91 — India-only login

- **File:** `frontend/src/pages/SignInPage.tsx`, `frontend/src/lib/normalizeIndianPhone.ts`
- **Problem:** Phone input hardcodes `+91` prefix with `maxLength={10}`. Any member outside India cannot sign in.
- **Fix:** Add a country code selector dropdown, or at minimum document this is India-only.

### P2-28: Subscription status shows raw database values

- **File:** `frontend/src/pages/DashboardPage.tsx:520-532`
- **Problem:** Status rendered as raw strings: `active`, `overdue`, `pending_first_payment`. No color coding, no user-friendly labels.
- **Fix:** Map status values to translated, styled badges (green "Active", red "Overdue", yellow "Pending").

---

## Phase 3 — Polish & Consistency (P3 Low)

*Make the app feel finished and professional.*

### P3-1: Splash page has no content — just a logo for 3 seconds

- **File:** `frontend/src/pages/HomePage.tsx:8-9`
- **Problem:** Auto-redirects to sign-in after 3 seconds. No tagline, no church info, no skip hint. Logo is clickable but not indicated. No accessibility text.
- **Fix:** Add church name/tagline, add "Tap to continue" text, add aria-label.

### P3-2: Dashboard shows ₹0.00 for new members — meaningless

- **File:** `frontend/src/pages/DashboardPage.tsx:524-526`
- **Problem:** Outstanding balance card always shows, even when meaningless. New members see a prominent "₹0.00" with no context.
- **Fix:** Hide the balance card when there are no subscriptions, or show "No dues" text instead.

### P3-3: No loading skeleton — blank flash on dashboard

- **File:** `frontend/src/pages/DashboardPage.tsx`
- **Problem:** Dashboard renders empty cards with ₹0 amounts before data arrives. `LoadingSkeleton` exists but is only used for growth metrics.
- **Fix:** Use `LoadingSkeleton` for the entire member dashboard during initial load.

### P3-4: History page loading is plain "Loading..." text

- **File:** `frontend/src/pages/HistoryPage.tsx:141`
- **Problem:** Should use a table skeleton matching column layout, not plain text.
- **Fix:** Replace with `LoadingSkeleton` or a table skeleton.

### P3-5: Pagination labels confusing — "Previous" means "Older"

- **File:** `frontend/src/pages/HistoryPage.tsx:123-134`
- **Problem:** "Newer entries" (left) vs "Previous entries" (right) on a descending list. "Previous" means older here.
- **Fix:** Change to "Newer" / "Older" consistently.

### P3-6: No page number indicator in pagination

- **File:** `frontend/src/pages/HistoryPage.tsx:176`
- **Problem:** Static text "Showing 10 entries per page in descending order" — no "Page 2 of 5" or "Showing 11-20 of 47".
- **Fix:** Add dynamic page indicator.

### P3-7: Duplicate pagination controls (top and bottom)

- **File:** `frontend/src/pages/HistoryPage.tsx:120-135, 175-186`
- **Problem:** Pagination appears both above and below the table with slightly different markup. Top lacks page count.
- **Fix:** Unify to a single Pagination component used in both positions.

### P3-8: Receipt download failure — no retry button

- **File:** `frontend/src/pages/HistoryPage.tsx:86-89`
- **Problem:** Failed download shows a toast only. No retry button, no indication of which receipt failed.
- **Fix:** Add inline retry button on the failed row.

### P3-9: Transaction IDs truncated — no way to see full value

- **File:** `frontend/src/pages/DashboardPage.tsx:819`
- **Problem:** Sliced to 16 chars. No tooltip, copy button, or expandable view. Useless for bank disputes.
- **Fix:** Add a copy-to-clipboard button and title tooltip with the full ID.

### P3-10: Profile/Settings split is confusing

- **File:** `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/ProfilePage.tsx`
- **Problem:** Profile editing at `/profile`, dangerous actions (sign out, delete) at `/settings`. User looking for "edit profile" in Settings won't find it.
- **Fix:** Add a link from Settings to Profile, or merge Settings into the Profile page as a tab.

### P3-11: Phone change blocks save with no clear UI indicator

- **File:** `frontend/src/pages/ProfilePage.tsx:358-360`
- **Problem:** Changed phone + no OTP verification = toast error on Save (easily missed in 4 seconds).
- **Fix:** Disable Save button when phone is changed but unverified. Show inline warning near the phone field.

### P3-12: Avatar auto-saves, everything else requires "Save" button

- **File:** `frontend/src/pages/ProfilePage.tsx:692-711`
- **Problem:** Avatar upload triggers instant API save. All other fields require clicking "Save Profile". Inconsistent.
- **Fix:** Either auto-save all fields, or require Save for avatar too (show avatar as pending until save).

### P3-13: Occupation dropdown options are English-only

- **File:** `frontend/src/pages/ProfilePage.tsx:81-84`
- **Problem:** "Farmer", "Teacher", "Business" etc. never go through `t()`. In translated UI, the dropdown stays English.
- **Fix:** Move occupation options to i18n locale files.

### P3-14: Family member phone edit — no +91 prefix shown

- **File:** `frontend/src/pages/ProfilePage.tsx:1068-1075`
- **Problem:** Unlike the main profile phone field with a `+91` badge, this is a bare text input. Users don't know the expected format.
- **Fix:** Add the same `+91` prefix badge, or show placeholder text with format hint.

### P3-15: Growth metrics failure silently swallowed

- **File:** `frontend/src/pages/DashboardPage.tsx:129-131`
- **Problem:** `catch { /* silently fail */ }` — admins think there's no data when there's actually a network error.
- **Fix:** Show an inline "Failed to load chart — Retry" message in the chart area.

### P3-16: Push notification denied — no fix instructions

- **File:** `frontend/src/pages/SettingsPage.tsx:115-119`
- **Problem:** Muted text says push is blocked. No instructions on how to re-enable in browser/device settings.
- **Fix:** Add step-by-step instructions for enabling push in browser settings.

### P3-17: No breadcrumbs anywhere in the app

- **File:** All pages
- **Problem:** Zero breadcrumb navigation. Admin deep in tools has no trail back except browser back button.
- **Fix:** Add breadcrumbs to admin console at minimum (Admin > Finance > Payment History).

### P3-18: Admin console — no search/filter for 39 tabs

- **File:** `frontend/src/pages/AdminConsolePage.tsx:86-97`
- **Problem:** Up to 36 tab keys for super admins. Tree nav requires scrolling — no search, no favorites, no recent tools.
- **Fix:** Add a search/filter input at the top of the admin sidebar.

### P3-19: Member status badges have no ARIA labels

- **File:** `frontend/src/pages/admin-tabs/MemberOpsTab.tsx:406-416`
- **Problem:** Status badges use inline color styles with no ARIA attributes. Screen readers can't distinguish status.
- **Fix:** Add `aria-label` to status badge elements.

### P3-20: Hardcoded ₹ currency symbol in ManualPaymentTab

- **File:** `frontend/src/pages/admin-tabs/ManualPaymentTab.tsx:120`
- **Problem:** `₹{Number(s.amount).toFixed(0)}` instead of using `formatAmount()`.
- **Fix:** Use `formatAmount()` for consistency.

### P3-21: DOB conflict check uses 60-second timeout hack

- **File:** `frontend/src/pages/ProfilePage.tsx:177-179`
- **Problem:** If dialog is dismissed, code waits 60 seconds before treating as "cancelled." Can cause unexpected delayed behavior.
- **Fix:** Use a proper dialog promise that resolves immediately on dismiss.

### P3-22: Fund descriptions not shown to donors

- **File:** `frontend/src/pages/PublicDonationPage.tsx:296`
- **Problem:** Fund selector shows flat names ("Building Fund") with no description. `DonationFundsTab` supports descriptions, but they're never displayed to donors.
- **Fix:** Show fund descriptions as subtitle text in the fund selector dropdown.

### P3-23: Default fund options hardcoded English

- **File:** `frontend/src/pages/PublicDonationPage.tsx:15-22`
- **Problem:** `DEFAULT_FUND_OPTIONS` array is hardcoded English. Falls back to these if API fails.
- **Fix:** Use i18n keys for default fund options.

### P3-24: SaaS payment history has no receipt download

- **File:** `frontend/src/pages/DashboardPage.tsx:800-829`
- **Problem:** SaaS/platform fee payment history shows transactions but no download button, unlike member payment history.
- **Fix:** Add receipt download for SaaS payments.

### P3-25: No donation history for public (anonymous) donors

- **File:** `frontend/src/pages/HistoryPage.tsx`
- **Problem:** Page only shows subscription payments. Public donors who gave via the donation page have no way to see history or receipts.
- **Fix:** Add a "Donation History" tab or separate page for donation records.

### P3-26: Multi-month subscription — no per-month price breakdown

- **File:** `frontend/src/pages/DashboardPage.tsx:845-856`
- **Problem:** Checkout shows total for 3 months but not "₹X × 3 months" breakdown. User must do mental math.
- **Fix:** Show `₹X/month × 3 months = ₹Y` in checkout summary.

### P3-27: Bootstrap error message is generic English

- **File:** `frontend/src/hooks/useBootstrap.ts`
- **Problem:** Error message is hardcoded English "Something went wrong" — bypasses i18n with no hint about what failed.
- **Fix:** Use `t()` for the error message and add specifics (network, auth, server).

### P3-28: Family list — no visual hierarchy or tree

- **File:** `frontend/src/pages/ProfilePage.tsx:112-120`
- **Problem:** Family members show as an unstructured flat list. No visual indication of who is head, dependent, linked vs unlinked.
- **Fix:** Show a simple hierarchy: head at top with crown/star icon, dependents indented below with relation labels.

### P3-29: Hardcoded "Donation Links & QR" in admin sidebar

- **File:** `frontend/src/pages/AdminConsolePage.tsx:356`
- **Problem:** Hardcoded English string not wrapped in `t()`.
- **Fix:** Use `t("admin.donationLinksQR")`.

### P3-30: No Razorpay loading indicator between Pay click and popup

- **File:** `frontend/src/lib/razorpayCheckout.ts:40-43`, `frontend/src/pages/DashboardPage.tsx:855`
- **Problem:** Checkout modal closes → blank dashboard → Razorpay popup appears after script loads. On slow mobile data, the gap feels broken.
- **Fix:** Show a full-screen loading overlay ("Opening payment gateway...") until Razorpay popup appears.

---

## Phase Plan

### Phase 1 — Trust & Safety (18 issues)

> **Goal:** No user loses money confidence, no destructive action without confirmation, no broken features.

| # | Issue | Files to Change |
|---|-------|-----------------|
| P0-1 | Render ChurchPicker in App.tsx | `App.tsx`, `ChurchPicker.tsx` |
| P0-2 | Add "Switch Church" to sidebar | `App.tsx` |
| P1-1 | Payment verify → warning tone | `DashboardPage.tsx` |
| P1-2 | Post-payment confirmation modal | `DashboardPage.tsx` |
| P1-3 | Donation receipt on success | `DonationCheckoutPage.tsx` |
| P1-4 | Pass real church name to Razorpay | `razorpayCheckout.ts`, callers |
| P1-5 | Fix donation checkout church name | `DonationCheckoutPage.tsx` |
| P1-6 | Resolve "Selected Church" placeholder | `PublicDonationPage.tsx` |
| P1-7 | Remove phantom "waived" fee | `CheckoutSummary.tsx` |
| P1-8 | Add delete account confirmation friction | `SettingsPage.tsx` |
| P1-9 | Add sign-out confirmation | `SettingsPage.tsx` |
| P1-10 | Add event/notification delete confirmation | `EventsTab.tsx` |
| P1-11 | Add push notification send preview | `PushNotificationTab.tsx` |
| P1-12 | i18n: HistoryPage | `HistoryPage.tsx`, locale files |
| P1-13 | i18n: PublicDonationPage | `PublicDonationPage.tsx`, locale files |
| P1-14 | i18n: DonationLinksTab | `DonationLinksTab.tsx`, locale files |
| P1-15 | i18n: PaymentHistoryTab | `PaymentHistoryTab.tsx`, locale files |
| P1-16 | i18n: ChurchPicker | `ChurchPicker.tsx`, locale files |

### Phase 2 — Dead Ends & Navigation (28 issues)

> **Goal:** No user gets stuck. Every screen has a next logical action. Navigation surfaces all features.

| # | Issue | Files to Change |
|---|-------|-----------------|
| P2-1 | JoinPage fallback for no code | `JoinPage.tsx` |
| P2-2 | Family dependent friendly message | `DashboardPage.tsx` |
| P2-3 | History empty state CTA | `HistoryPage.tsx` |
| P2-4 | Settings accessible from Profile | `BottomNav.tsx` or `ProfilePage.tsx` |
| P2-5 | Notification badges on BottomNav | `BottomNav.tsx`, `App.tsx` |
| P2-6 | Hide Donate when payments disabled | `BottomNav.tsx` |
| P2-7 | Use or remove isSuperAdmin prop | `BottomNav.tsx` |
| P2-8 | Admin link in BottomNav | `BottomNav.tsx` |
| P2-9 | Toast duration: 10s for payments | `App.tsx` |
| P2-10 | Toast stacking / queue | `App.tsx` |
| P2-11 | Floating toast (fixed position) | `App.tsx`, CSS |
| P2-12 | Explain disabled Pay Now button | `DashboardPage.tsx` |
| P2-13 | "Cancel" → "Request Cancellation" | `DashboardPage.tsx` |
| P2-14 | Cancel modal — show consequences | `DashboardPage.tsx` |
| P2-15 | Add resend OTP with cooldown | `SignInPage.tsx` |
| P2-16 | Inline phone input validation | `SignInPage.tsx` |
| P2-17 | Language selector before/during login | `App.tsx`, `SignInPage.tsx` |
| P2-18 | Refund path for members | `HistoryPage.tsx` or `DashboardPage.tsx` |
| P2-19 | Events: Add to Calendar button | `EventsPage.tsx` |
| P2-20 | Read/unread notification state | `EventsPage.tsx` |
| P2-21 | Notification preferences in settings | `SettingsPage.tsx` |
| P2-22 | Rename "Notifications" to "Announcements" | `EventsTab.tsx`, locale files |
| P2-23 | Dynamic admin badge counts | `AdminConsolePage.tsx` |
| P2-24 | Remove duplicate admin nav items | `AdminConsolePage.tsx` |
| P2-25 | Family request — show more context | `FamilyRequestsTab.tsx` |
| P2-26 | Member bulk actions | `MemberOpsTab.tsx` |
| P2-27 | Country code selector for phone | `SignInPage.tsx` |
| P2-28 | Styled subscription status badges | `DashboardPage.tsx` |

### Phase 3 — Polish & Consistency (30 issues)

> **Goal:** The app feels finished, professional, and consistent across all screens.

| # | Issue | Files to Change |
|---|-------|-----------------|
| P3-1 | Splash page content | `HomePage.tsx` |
| P3-2 | Hide ₹0 balance for new members | `DashboardPage.tsx` |
| P3-3 | Dashboard loading skeleton | `DashboardPage.tsx` |
| P3-4 | History table loading skeleton | `HistoryPage.tsx` |
| P3-5 | Pagination labels: Newer/Older | `HistoryPage.tsx` |
| P3-6 | Dynamic page number indicator | `HistoryPage.tsx` |
| P3-7 | Unify pagination component | `HistoryPage.tsx` |
| P3-8 | Receipt download retry button | `HistoryPage.tsx` |
| P3-9 | Full transaction ID + copy button | `DashboardPage.tsx` |
| P3-10 | Link Settings from Profile | `SettingsPage.tsx`, `ProfilePage.tsx` |
| P3-11 | Disable Save when phone unverified | `ProfilePage.tsx` |
| P3-12 | Consistent avatar save behavior | `ProfilePage.tsx` |
| P3-13 | i18n: Occupation options | `ProfilePage.tsx`, locale files |
| P3-14 | Family phone +91 prefix | `ProfilePage.tsx` |
| P3-15 | Growth metrics retry on failure | `DashboardPage.tsx` |
| P3-16 | Push denied — show fix instructions | `SettingsPage.tsx` |
| P3-17 | Add breadcrumbs to admin | `AdminConsolePage.tsx` |
| P3-18 | Admin sidebar search/filter | `AdminConsolePage.tsx` |
| P3-19 | ARIA labels on status badges | `MemberOpsTab.tsx` |
| P3-20 | Use formatAmount in ManualPayment | `ManualPaymentTab.tsx` |
| P3-21 | Fix DOB dialog timeout hack | `ProfilePage.tsx` |
| P3-22 | Show fund descriptions to donors | `PublicDonationPage.tsx` |
| P3-23 | i18n: Default fund options | `PublicDonationPage.tsx`, locale files |
| P3-24 | SaaS payment receipt download | `DashboardPage.tsx` |
| P3-25 | Donation history for public donors | `HistoryPage.tsx` |
| P3-26 | Multi-month price breakdown | `DashboardPage.tsx` |
| P3-27 | i18n: Bootstrap error message | `useBootstrap.ts`, locale files |
| P3-28 | Family hierarchy visual | `ProfilePage.tsx` |
| P3-29 | i18n: Admin sidebar strings | `AdminConsolePage.tsx`, locale files |
| P3-30 | Razorpay loading overlay | `razorpayCheckout.ts`, `DashboardPage.tsx` |

### Phase 4 — Feature Gaps (future)

> **Goal:** Features that require backend schema changes or significant new functionality.*

| # | Feature | Scope |
|---|---------|-------|
| F-1 | RSVP for events | Backend + Frontend: new `event_rsvps` table, API, UI buttons |
| F-2 | Event location & end time | Backend migration + EventsPage + EventsTab |
| F-3 | Notification read tracking | Backend: `notification_reads` table + API + frontend state |
| F-4 | Per-category notification preferences | Backend: `notification_preferences` table + Settings UI |
| F-5 | Donation confirmation email | Backend: email service integration + donation webhook handler |
| F-6 | Tax receipt generation (80G) | Backend: PDF generation + receipt template + download API |
| F-7 | Member self-service refund requests | Backend: `refund_requests` table + API + member UI |
| F-8 | Church explorer / search | Backend: public church directory API + frontend ExploreChurches page |
| F-9 | QR code scan for church join | Frontend: camera permission + QR scanner library |
| F-10 | Country code selector (international) | Backend: remove +91 phone normalization + frontend country picker |
| F-11 | Calendar integration (.ics export) | Frontend: .ics file generator from event data |
| F-12 | Member bulk import/export (CSV) | Backend: CSV parser + bulk upsert API + admin upload UI |

---

## Execution Order

```
Phase 1 (Trust & Safety)     ██████████████████  18 issues — Do FIRST
Phase 2 (Dead Ends & Nav)    ████████████████████████████  28 issues — Do SECOND
Phase 3 (Polish)             ██████████████████████████████  30 issues — Do THIRD
Phase 4 (Feature Gaps)       ████████████  12 features — Do LAST (requires backend changes)
```

**Total: 88 items across 4 phases**
