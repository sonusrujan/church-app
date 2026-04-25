-- Migration: SHALOM role expansion and engagement modules
-- Run this against your PostgreSQL database for existing projects.

alter table if exists churches
  add column if not exists church_code text;

alter table if exists churches
  add column if not exists address text;

alter table if exists churches
  add column if not exists payments_enabled boolean not null default false;

alter table if exists churches
  add column if not exists razorpay_key_id text;

alter table if exists churches
  add column if not exists razorpay_key_secret text;

alter table if exists members
  add column if not exists phone_number text;

alter table if exists members
  add column if not exists alt_phone_number text;

create unique index if not exists churches_church_code_unique
  on churches(church_code)
  where church_code is not null;

create table if not exists pastors (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  full_name text not null,
  phone_number text not null,
  email text,
  details text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists pastors_church_created_idx
  on pastors(church_id, created_at desc);

create unique index if not exists pastors_phone_unique
  on pastors(phone_number);

create unique index if not exists pastors_email_unique
  on pastors(lower(email))
  where email is not null;

create table if not exists church_events (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  title text not null,
  message text not null,
  event_date timestamptz,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists church_events_church_created_idx
  on church_events(church_id, created_at desc);

create table if not exists church_notifications (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  title text not null,
  message text not null,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists church_notifications_church_created_idx
  on church_notifications(church_id, created_at desc);

create table if not exists prayer_requests (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  member_name text not null,
  member_email text not null,
  details text not null,
  status text not null default 'sent',
  created_at timestamptz default now()
);

create table if not exists prayer_request_recipients (
  id uuid primary key default uuid_generate_v4(),
  prayer_request_id uuid not null references prayer_requests(id) on delete cascade,
  pastor_id uuid not null references pastors(id) on delete cascade,
  pastor_email text,
  delivery_status text not null default 'queued',
  delivery_note text,
  delivered_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists prayer_request_recipients_request_idx
  on prayer_request_recipients(prayer_request_id);
