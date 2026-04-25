-- Sprint 6 Migration: Super Admin Operations
-- Adds: payment_refunds table, scheduled_reports table

-- ═══ 1. Payment Refunds ═══
create table if not exists payment_refunds (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid not null references payments(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  refund_amount numeric not null,
  refund_reason text,
  refund_method text not null,  -- razorpay, cash, bank_transfer, other
  recorded_by uuid references users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists payment_refunds_payment_id_idx
  on payment_refunds(payment_id);

create index if not exists payment_refunds_member_id_idx
  on payment_refunds(member_id);

-- ═══ 2. Scheduled Reports ═══
create table if not exists scheduled_reports (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  report_type text not null,       -- members, payments, donations
  frequency text not null,         -- daily, weekly, monthly
  recipient_emails text[] not null default '{}',
  enabled boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists scheduled_reports_church_id_idx
  on scheduled_reports(church_id);

create index if not exists scheduled_reports_enabled_idx
  on scheduled_reports(enabled) where enabled = true;

-- ═══ 3. RLS Policies ═══
alter table if exists payment_refunds enable row level security;
alter table if exists scheduled_reports enable row level security;

create policy "select payment_refunds by church" on payment_refunds
  for select using (
    auth.role() = 'authenticated'
  );

create policy "select scheduled_reports by church" on scheduled_reports
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

-- ═══ 4. Grants ═══
grant select on payment_refunds to authenticated;
grant all on payment_refunds to service_role;
grant select on scheduled_reports to authenticated;
grant all on scheduled_reports to service_role;
