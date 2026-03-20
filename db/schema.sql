-- Church Subscription Management Schema

create extension if not exists "uuid-ossp";

create table if not exists churches (
  id uuid primary key default uuid_generate_v4(),
  church_code text unique,
  name text not null,
  payments_enabled boolean not null default false,
  razorpay_key_id text,
  razorpay_key_secret text,
  address text,
  location text,
  contact_phone text,
  created_at timestamptz default now()
);

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid,
  email text not null,
  full_name text,
  avatar_url text,
  role text not null default 'member',
  church_id uuid references churches(id) on delete cascade,
  created_at timestamptz default now()
);

create unique index if not exists users_auth_user_id_unique
  on users(auth_user_id)
  where auth_user_id is not null;

create table if not exists members (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete set null,
  full_name text not null,
  email text not null,
  phone_number text,
  alt_phone_number text,
  address text,
  membership_id text,
  family_members jsonb,
  subscription_amount numeric default 0,
  verification_status text default 'pending',
  church_id uuid references churches(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists family_members (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id) on delete cascade,
  full_name text not null,
  gender text,
  relation text,
  age integer,
  dob date,
  has_subscription boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists family_members_member_created_idx
  on family_members(member_id, created_at desc);

create table if not exists subscriptions (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid references members(id) on delete cascade,
  family_member_id uuid references family_members(id) on delete set null,
  plan_name text not null,
  amount numeric not null,
  billing_cycle text not null,
  start_date date not null,
  next_payment_date date not null,
  status text default 'active'
);

create table if not exists payments (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid references members(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  amount numeric not null,
  payment_method text,
  transaction_id text,
  payment_status text,
  payment_date timestamptz default now(),
  receipt_number text,
  receipt_generated_at timestamptz
);

create index if not exists payments_member_payment_date_idx
  on payments(member_id, payment_date desc);

create index if not exists payments_receipt_number_idx
  on payments(receipt_number);

create table if not exists subscription_events (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  church_id uuid references churches(id) on delete cascade,
  event_type text not null,
  status_before text,
  status_after text,
  amount numeric,
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  event_at timestamptz not null default now(),
  created_at timestamptz default now()
);

create index if not exists subscription_events_member_event_at_idx
  on subscription_events(member_id, event_at desc);

create index if not exists subscription_events_subscription_event_at_idx
  on subscription_events(subscription_id, event_at desc);

create index if not exists subscription_events_church_event_at_idx
  on subscription_events(church_id, event_at desc);

do $$
begin
  alter publication supabase_realtime add table public.subscription_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create table if not exists announcements (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid references churches(id) on delete cascade,
  title text not null,
  message text not null,
  created_by uuid,
  created_at timestamptz default now()
);

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
