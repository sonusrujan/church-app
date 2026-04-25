# SHALOM — Church Management Platform

> Full-stack church management SaaS running on **AWS** (RDS PostgreSQL, ECS Fargate, S3 + CloudFront).

---

## Quick Start (Local Development)

### Option A: Docker Compose (recommended)

```bash
docker-compose up
```

This starts PostgreSQL, backend (port 4000), and frontend (port 5173) automatically.
The database is seeded from `db/aws_rds_full_schema.sql` on first run.

### Option B: Manual

**1. Database**

Set up a local PostgreSQL instance and run the migration:

```bash
psql postgresql://user:pass@localhost:5432/shalom -f db/aws_rds_full_schema.sql
```

**2. Backend**

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET at minimum
npm install
npm run dev
```

**3. Frontend**

```bash
cd frontend
cp .env.example .env
# Edit .env — set VITE_API_URL=http://localhost:4000
npm install
npm run dev
```

---

## Environment Variables

### Backend (`.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for signing JWT tokens (min 32 chars) |
| `PORT` | | Server port (default: 4000) |
| `FRONTEND_URL` | | Frontend origin for CORS (default: `http://localhost:5173`) |
| `GOOGLE_CLIENT_ID` | | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | | Google OAuth callback URL |
| `OTP_EXPIRY_MINUTES` | | OTP validity period (default: 10) |
| `AWS_REGION` | | AWS region for SNS (default: `ap-south-1`) |
| `AWS_ACCESS_KEY_ID` | | AWS credentials for SNS |
| `AWS_SECRET_ACCESS_KEY` | | AWS credentials for SNS |
| `PAYMENTS_ENABLED` | | Set `true` to enable Razorpay (default: `false`) |
| `RAZORPAY_KEY_ID` | | Razorpay key (required if payments enabled) |
| `RAZORPAY_KEY_SECRET` | | Razorpay secret (required if payments enabled) |
| `SUPER_ADMIN_EMAILS` | | Comma-separated super-admin emails |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | ✅ | Backend API URL (e.g. `http://localhost:4000`) |

---

## AWS Deployment

### Architecture

```
CloudFront (CDN) ─┬─ S3 (frontend static files)
                   └─ ALB ─── ECS Fargate (backend container)
                                    │
                              RDS PostgreSQL
```

### Deploy via CloudFormation

```bash
# Set required secrets
export DB_PASSWORD="your-db-password-min-12-chars"
export JWT_SECRET="your-jwt-secret-min-32-chars"

# Run deployment
bash aws/deploy.sh
```

The script will:
1. Create the full AWS infrastructure (VPC, RDS, ECS, ALB, S3, CloudFront)
2. Store secrets in SSM Parameter Store
3. Build and push the Docker image to ECR
4. Deploy the ECS service
5. Build and upload the frontend to S3
6. Invalidate the CloudFront cache

### Manual Deployment Steps

```bash
# 1. Deploy infrastructure
aws cloudformation deploy \
  --template-file aws/cloudformation.yaml \
  --stack-name shalom-stack \
  --parameter-overrides DBPassword=<password> JwtSecret=<secret> \
  --capabilities CAPABILITY_IAM

# 2. Run database migration (use bastion host or VPN)
psql <DATABASE_URL> -f db/aws_rds_full_schema.sql

# 3. Build & push Docker image
aws ecr get-login-password | docker login --username AWS --password-stdin <ECR_URI>
docker build -t shalom-backend .
docker tag shalom-backend:latest <ECR_URI>:latest
docker push <ECR_URI>:latest

# 4. Build & deploy frontend
cd frontend
VITE_API_URL=<ALB_URL> npm run build
aws s3 sync dist/ s3://<FRONTEND_BUCKET>/ --delete
```

---

## Auth System

Two authentication methods:

1. **OTP (Phone)** — `POST /api/auth/otp/send` → `POST /api/auth/otp/verify` → JWT issued
2. **Google OAuth** — `GET /api/auth/google` → Google consent → callback → JWT issued

All protected routes use `Authorization: Bearer <JWT>` headers.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api` | API index |
| **Auth** | | |
| `POST` | `/api/auth/otp/send` | Send OTP |
| `POST` | `/api/auth/otp/verify` | Verify OTP, get JWT |
| `GET` | `/api/auth/google` | Initiate Google OAuth |
| `GET` | `/api/auth/google/callback` | Google OAuth callback |
| `POST` | `/api/auth/sync-profile` | Sync user profile |
| `GET` | `/api/auth/me` | Get current user |
| `GET` | `/api/auth/member-dashboard` | Member dashboard data |
| `POST` | `/api/auth/update-profile` | Update profile |
| `POST` | `/api/auth/family-members` | Manage family members |
| **Members** | | |
| `POST` | `/api/members/create` | Create member |
| `POST` | `/api/members/link` | Link member |
| `GET` | `/api/members/list` | List members |
| `GET` | `/api/members/search` | Search members |
| `GET` | `/api/members/:id` | Get member |
| `PATCH` | `/api/members/:id` | Update member |
| `DELETE` | `/api/members/:id` | Delete member |
| **Subscriptions** | | |
| `POST` | `/api/subscriptions/create` | Create subscription |
| `GET` | `/api/subscriptions/my` | My subscriptions |
| `POST` | `/api/subscriptions/reconcile-overdue` | Reconcile overdue (admin) |
| **Payments** | | |
| `GET` | `/api/payments/config` | Payment config |
| `POST` | `/api/payments/order` | Create order |
| `POST` | `/api/payments/verify` | Verify payment |
| `POST` | `/api/payments/donation/order` | Donation order |
| `POST` | `/api/payments/donation/verify` | Verify donation |
| `GET` | `/api/payments/:paymentId/receipt` | Get receipt |
| **Churches** | | |
| `POST` | `/api/churches/create` | Create church |
| `GET` | `/api/churches/summary` | Church summary |
| `GET` | `/api/churches/search` | Search churches |
| `GET` | `/api/churches/id/:id` | Get church |
| `PATCH` | `/api/churches/id/:id` | Update church |
| `DELETE` | `/api/churches/id/:id` | Delete church |
| **Pastors** | | |
| `POST` | `/api/pastors/create` | Create pastor |
| `GET` | `/api/pastors/list` | List pastors |
| `GET` | `/api/pastors/:id` | Get pastor |
| `PATCH` | `/api/pastors/:id` | Update pastor |
| `DELETE` | `/api/pastors/:id` | Delete pastor |
| `POST` | `/api/pastors/:id/transfer` | Transfer pastor |
| **Admins** | | |
| `GET` | `/api/admins/list` | List admins |
| `GET` | `/api/admins/search` | Search admins |
| `POST` | `/api/admins/grant` | Grant admin role |
| `POST` | `/api/admins/revoke` | Revoke admin role |
| **Engagement** | | |
| `GET/POST` | `/api/engagement/events` | Events |
| `GET/POST` | `/api/engagement/notifications` | Notifications |
| `GET/POST` | `/api/engagement/prayer-requests` | Prayer requests |
| `GET/POST` | `/api/announcements/*` | Announcements |

---

## Project Structure

```
├── aws/                    # AWS deployment configs
│   ├── cloudformation.yaml # Full infrastructure template
│   └── deploy.sh           # One-command deployment script
├── db/
│   └── aws_rds_full_schema.sql  # Combined database migration
├── frontend/               # React 19 + Vite + Tailwind
├── src/
│   ├── config.ts           # Environment config
│   ├── app.ts              # Express app setup
│   ├── index.ts            # Server entry point
│   ├── middleware/
│   │   └── requireAuth.ts  # JWT auth middleware
│   ├── routes/             # API route handlers
│   ├── services/
│   │   ├── supabaseClient.ts  # PostgreSQL query builder (pg Pool)
│   │   └── *.ts            # Business logic services
│   └── types/              # TypeScript types
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # Local dev environment
└── package.json
```

## Notes
- Set `SUPER_ADMIN_EMAILS` in `.env`. Primary super-admin is `sonusrujan76@gmail.com`.
- If `PAYMENTS_ENABLED=false`, `/api/payments/*` returns HTTP 503 by design.
- The query builder in `supabaseClient.ts` provides a Supabase-compatible API over raw `pg` Pool.
- All database access goes through AWS RDS PostgreSQL — no Supabase dependency.

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

