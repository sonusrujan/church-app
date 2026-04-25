-- Product Readiness Migration
-- Adds: membership_requests, cancellation_requests, admin_audit_log, church trial, soft-delete

-- ═══ 1. Membership Requests (self-registration with admin approval) ═══
create table if not exists membership_requests (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  email text not null,
  full_name text not null,
  phone_number text,
  address text,
  membership_id text,
  message text,
  status text not null default 'pending',  -- pending, approved, rejected
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz default now()
);

create index if not exists membership_requests_church_status_idx
  on membership_requests(church_id, status, created_at desc);

create unique index if not exists membership_requests_church_email_pending_idx
  on membership_requests(church_id, lower(email))
  where status = 'pending';

-- ═══ 2. Subscription Cancellation Requests ═══
create table if not exists cancellation_requests (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  church_id uuid not null references churches(id) on delete cascade,
  reason text,
  status text not null default 'pending',  -- pending, approved, rejected
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz default now()
);

create index if not exists cancellation_requests_church_status_idx
  on cancellation_requests(church_id, status, created_at desc);

create unique index if not exists cancellation_requests_sub_pending_idx
  on cancellation_requests(subscription_id)
  where status = 'pending';

-- ═══ 3. Admin Audit Log (persistent, not just console) ═══
create table if not exists admin_audit_log (
  id uuid primary key default uuid_generate_v4(),
  actor_user_id uuid references users(id) on delete set null,
  actor_email text not null,
  church_id uuid references churches(id) on delete set null,
  action text not null,
  target_type text,        -- 'member', 'church', 'subscription', 'pastor', etc.
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists admin_audit_log_church_created_idx
  on admin_audit_log(church_id, created_at desc);

create index if not exists admin_audit_log_actor_created_idx
  on admin_audit_log(actor_user_id, created_at desc);

-- ═══ 4. Church Trial Period (super admin grants free months) ═══
alter table churches add column if not exists trial_ends_at timestamptz;
alter table churches add column if not exists trial_granted_by uuid references users(id) on delete set null;

-- ═══ 5. Soft Delete for Churches and Members ═══
alter table churches add column if not exists deleted_at timestamptz;
alter table members add column if not exists deleted_at timestamptz;

-- ═══ 6. RLS Policies for new tables ═══
alter table if exists membership_requests enable row level security;
alter table if exists cancellation_requests enable row level security;
alter table if exists admin_audit_log enable row level security;

-- Membership requests: church-scoped read
create policy "select membership_requests by church" on membership_requests
  for select using (
    auth.role() = 'authenticated'
    and church_id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ), ''
    )::uuid
  );

-- Cancellation requests: church-scoped read
create policy "select cancellation_requests by church" on cancellation_requests
  for select using (
    auth.role() = 'authenticated'
    and church_id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ), ''
    )::uuid
  );

-- Audit log: church-scoped read for admins
create policy "select admin_audit_log by church" on admin_audit_log
  for select using (
    auth.role() = 'authenticated'
    and church_id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ), ''
    )::uuid
  );

-- ═══ 7. Grants for new tables ═══
grant select on membership_requests to authenticated;
grant select on cancellation_requests to authenticated;
grant select on admin_audit_log to authenticated;
grant all on membership_requests to service_role;
grant all on cancellation_requests to service_role;
grant all on admin_audit_log to service_role;
