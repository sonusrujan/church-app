# SHALOM Backend

## Setup
1. Copy `.env.example` to `.env`.
2. Fill Supabase keys.
3. Keep `PAYMENTS_ENABLED=false` to run backend without Razorpay.
4. Add Razorpay keys only when you enable payments later.
5. Start dev server:

```bash
npm run dev
```

## Frontend UI
1. Go to `frontend` folder.
2. Copy `frontend/.env.example` to `frontend/.env`.
3. Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Keep `VITE_API_BASE_URL=http://localhost:4000` for local dev.
5. Run:

```bash
cd frontend
npm run dev
```

Backend root now redirects to frontend (`FRONTEND_URL`, default `http://localhost:5173`) so opening `http://localhost:4000` lands on UI instead of API text.

## API Endpoints
- `GET /api` (API index)
- `GET /health`
- `POST /api/auth/sync-profile`
- `GET /api/auth/me`
- `GET /api/auth/member-dashboard`
- `POST /api/auth/update-profile`
- `POST /api/auth/family-members`
- `POST /api/members/create`
- `POST /api/members/link`
- `GET /api/members/list`
- `GET /api/members/search`
- `GET /api/members/:id`
- `GET /api/members/:id/delete-impact`
- `PATCH /api/members/:id`
- `DELETE /api/members/:id`
- `POST /api/subscriptions/create`
- `GET /api/subscriptions/my?member_id=...`
- `POST /api/subscriptions/reconcile-overdue` (admin only)
- `GET /api/payments/config`
- `POST /api/payments/order`
- `POST /api/payments/verify`
- `POST /api/payments/donation/order`
- `POST /api/payments/donation/verify`
- `POST /api/payments/subscription/order`
- `POST /api/payments/subscription/verify`
- `GET /api/payments/:paymentId/receipt`
- `POST /api/announcements/send`
- `GET /api/announcements/list`
- `GET /api/admins/list`
- `GET /api/admins/search`
- `GET /api/admins/id/:id`
- `GET /api/admins/income`
- `POST /api/admins/pre-register-member`
- `POST /api/admins/grant`
- `POST /api/admins/revoke`
- `PATCH /api/admins/id/:id`
- `DELETE /api/admins/id/:id`
- `GET /api/churches/summary`
- `GET /api/churches/search`
- `GET /api/churches/id/:id`
- `GET /api/churches/id/:id/delete-impact`
- `POST /api/churches/create`
- `PATCH /api/churches/id/:id`
- `DELETE /api/churches/id/:id`
- `GET /api/churches/payment-config`
- `POST /api/churches/payment-config`
- `GET /api/pastors/list`
- `GET /api/pastors/:id`
- `POST /api/pastors/create`
- `PATCH /api/pastors/:id`
- `DELETE /api/pastors/:id`
- `POST /api/pastors/:id/transfer`
- `GET /api/engagement/events`
- `POST /api/engagement/events`
- `GET /api/engagement/notifications`
- `POST /api/engagement/notifications`
- `POST /api/engagement/prayer-requests`
- `GET /api/engagement/prayer-requests`

## Notes
- Use Supabase Auth token in `Authorization: Bearer <token>`.
- `requireAuth` middleware expects Supabase JWT and user metadata includes `role`, `church_id`.
- Add RLS policies in Supabase for row-level security.
- Run SQL scripts in this order: `db/schema.sql` -> `db/grants.sql` -> `db/rls.sql`.
- If upgrading existing DB, run `db/auth_user_linking_migration.sql` before using pre-registration without UID.
- For realtime tracking on existing DBs, run `db/subscription_realtime_tracking_migration.sql`.
- For family member subscriptions on existing DBs, run `db/family_members_subscription_migration.sql`.
- For SHALOM churches/pastors/events/notifications/prayer modules, run `db/shalom_expansion_migration.sql`.
- For strict single-church pastor assignment on existing DBs, run `db/pastors_single_church_enforcement_migration.sql`.
- For payment receipt metadata on existing DBs, run `db/payment_receipt_metadata_migration.sql`.
- Set `SUPER_ADMIN_EMAILS` in `.env`. Primary super-admin is `sonusrujan76@gmail.com`.
- If `PAYMENTS_ENABLED=false`, `/api/payments/*` returns HTTP 503 by design.

## Razorpay Setup

1. In backend `.env`, set:
	- `PAYMENTS_ENABLED=true`
	- `RAZORPAY_KEY_ID=...`
	- `RAZORPAY_KEY_SECRET=...`
2. In Razorpay Dashboard, set your website/app URL to your deployed frontend URL (for example `https://yourdomain.com`).
3. Do not use localhost URL in Razorpay business website field. For temporary tests, use a public HTTPS tunnel URL.
4. Restart backend after env updates.
5. Frontend automatically checks `/api/payments/config` and enables/disables donation and subscription Pay Now actions.

### Per-Church Razorpay Keys (SHALOM)

- Each church can have its own Razorpay `key_id` and `key_secret`.
- Use admin endpoint to configure church payment keys:
	- `GET /api/churches/payment-config`
	- `POST /api/churches/payment-config`
- Church admin can configure only their own church.
- Super admin can configure any church by passing `church_id`.
- `/api/payments/config`, order, and verify routes now resolve keys from the logged-in user's church.
- Global keys in `.env` are now fallback only (mainly for backward compatibility before migration).

## Super Admin Email Flow

This project now supports direct super-admin access by email.

1. Put your email in `.env` under `SUPER_ADMIN_EMAILS`.
2. Login with Google using that email.
3. Either call `POST /api/auth/sync-profile` once after login, or run `db/step4_step5_bootstrap.sql` to seed churches + admin row manually.
4. Use these admin APIs with your Bearer token:

```bash
POST /api/auth/sync-profile { "full_name": "Sonu", "church_id": "your-church-uuid" }
POST /api/auth/update-profile { "full_name": "Sonu", "avatar_url": "https://...", "address": "Kochi", "subscription_amount": 500 }
GET /api/admins/list
POST /api/admins/pre-register-member { "email": "member@church.com", "full_name": "Member Name", "membership_id": "M-1003", "address": "Kochi", "subscription_amount": 500, "church_id": "optional-uuid-for-super-admin" }
POST /api/admins/grant    { "email": "target@church.com", "church_id": "optional-uuid" }
POST /api/admins/revoke   { "email": "target@church.com" }
```

Rules:
- Only super-admin emails can call these endpoints.
- The super-admin email itself cannot be revoked.
- Target user should already exist in `public.users` (ask user to login once first).

## Registered User Enforcement

- Access now requires the signed-in Google email to already exist in `public.users`.
- If an email is not registered, backend returns `403` (`This email is not registered`) and frontend signs the user out.
- `admin` users see admin tools; `member` users see a member dashboard (profile, church, subscriptions, receipts, donation summary, and history).
- On first successful login, backend auto-links `auth.users.id` into `public.users.auth_user_id` by matching email.

## Manual Member Seeding

- Use `db/manual_members_seed.sql` to seed member users and dashboard data manually.
- You can pre-register users before first login using only email, name, role, and church.
- `public.users.id` is now auto-generated and `public.users.auth_user_id` is filled automatically on first login.

## Frontend UX

- App now uses route-based pages with a minimal application shell: `/signin`, `/dashboard`, `/profile`, `/admin-tools`, and `/signout`.
- Users can edit profile name, profile image URL, and address from the Profile page.
- Members can also update monthly subscription amount from Profile page (minimum allowed: 200).
- Members can donate any amount to their church from the dashboard using the Donate button and payment hook.
- Subscription `Pay Now` button is active only when dues are pending; otherwise it is shown as inactive.
- Member dashboard now includes live subscription tracking status and a realtime event feed.
- Members can add family members with Name, Gender, Relation, Age, DOB.
- Family member form supports adding an individual subscription for that person (person-level subscription).
- Subscription payment supports selecting one or more due subscriptions by checkbox before checkout.
- App branding is now SHALOM.
- Church-admin users have both admin tools and member capabilities (pay, donate, profile, family, history).
- Pastor creation requires selecting a church in Admin Tools, and the same pastor identity (phone/email) cannot be assigned across multiple churches.
- Super admin tools include a tree-structured operations console for Member/Church/Pastor/Admin workflows (search, fetch, update, transfer, delete).
- Destructive delete paths expose impact previews (`.../delete-impact`) before force delete to reduce accidental data loss.
- Events tab includes church events, notifications, and prayer request flow (select one or more pastors).
- History tab downloads generated PDF receipts linked to verified payments.

## Realtime Subscription Tracking

- Ledger table: `public.subscription_events`.
- Backend emits events on:
	- new subscription creation,
	- successful payment record,
	- member subscription amount changes,
	- overdue reconciliation (`active` -> `overdue`).
- Frontend subscribes to Supabase Realtime changes on `subscription_events` by member id and refreshes the dashboard automatically.
- To reconcile overdue subscriptions manually:

```bash
POST /api/subscriptions/reconcile-overdue
POST /api/subscriptions/reconcile-overdue?scope=all  # super-admin only
```

