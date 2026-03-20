-- Manual seed for registered member users and their dashboard data.
-- Run after schema/grants/rls and after churches are already present.
-- You do NOT need Supabase Auth UUID in advance.
-- users.id is auto-generated now, so only email is required.
-- On first login, backend links auth.users.id into public.users.auth_user_id for that email.

begin;

-- 1) Registered app users (required for login access)
with seed_users(email, full_name, role, church_id) as (
  values
    ('strangerbro9669@gmail.com', 'Member One', 'member', '22222222-2222-2222-2222-222222222222'::uuid),
    ('member2@example.com', 'Member Two', 'member', '33333333-3333-3333-3333-333333333333'::uuid)
),
updated as (
  update public.users u
  set
    full_name = s.full_name,
    role = s.role,
    church_id = s.church_id
  from seed_users s
  where lower(u.email) = lower(s.email)
  returning u.id, lower(u.email) as email_key
),
inserted as (
  insert into public.users (email, full_name, role, church_id)
  select s.email, s.full_name, s.role, s.church_id
  from seed_users s
  where not exists (
    select 1 from public.users u where lower(u.email) = lower(s.email)
  )
  returning id, lower(email) as email_key
),
all_users as (
  select distinct on (m.email_key) m.id, m.email_key
  from (
    select id, email_key from updated
    union all
    select id, email_key from inserted
  ) as m
  order by m.email_key, m.id
)
insert into public.members (
  id,
  user_id,
  full_name,
  email,
  address,
  membership_id,
  family_members,
  subscription_amount,
  verification_status,
  church_id
)
select
  s.id,
  u.id,
  s.full_name,
  s.email,
  s.address,
  s.membership_id,
  s.family_members,
  s.subscription_amount,
  s.verification_status,
  s.church_id
from (
  values
    (
      'c1111111-1111-1111-1111-111111111111'::uuid,
      'strangerbro9669@gmail.com'::text,
      'Member One'::text,
      'Kochi'::text,
      'M-1001'::text,
      '[{"name":"Spouse One"}]'::jsonb,
      500::numeric,
      'verified'::text,
      '22222222-2222-2222-2222-222222222222'::uuid
    ),
    (
      'c2222222-2222-2222-2222-222222222222'::uuid,
      'member2@example.com'::text,
      'Member Two'::text,
      'Kottayam'::text,
      'M-1002'::text,
      '[]'::jsonb,
      300::numeric,
      'verified'::text,
      '33333333-3333-3333-3333-333333333333'::uuid
    )
) as s(
  id,
  email,
  full_name,
  address,
  membership_id,
  family_members,
  subscription_amount,
  verification_status,
  church_id
)
join all_users u
  on u.email_key = lower(s.email)
on conflict (id)
do update set
  user_id = excluded.user_id,
  full_name = excluded.full_name,
  email = excluded.email,
  address = excluded.address,
  membership_id = excluded.membership_id,
  family_members = excluded.family_members,
  subscription_amount = excluded.subscription_amount,
  verification_status = excluded.verification_status,
  church_id = excluded.church_id;

-- 3) Subscriptions
insert into public.subscriptions (
  id,
  member_id,
  plan_name,
  amount,
  billing_cycle,
  start_date,
  next_payment_date,
  status
)
values
  (
    'd1111111-1111-1111-1111-111111111111',
    'c1111111-1111-1111-1111-111111111111',
    'Family Plan',
    500,
    'monthly',
    current_date - interval '30 days',
    current_date,
    'active'
  ),
  (
    'd2222222-2222-2222-2222-222222222222',
    'c2222222-2222-2222-2222-222222222222',
    'Standard Plan',
    300,
    'monthly',
    current_date - interval '25 days',
    current_date + interval '5 days',
    'active'
  )
on conflict (id)
do update set
  member_id = excluded.member_id,
  plan_name = excluded.plan_name,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  start_date = excluded.start_date,
  next_payment_date = excluded.next_payment_date,
  status = excluded.status;

-- 4) Payments (receipts/donations)
insert into public.payments (
  id,
  member_id,
  subscription_id,
  amount,
  payment_method,
  transaction_id,
  payment_status,
  payment_date
)
values
  (
    'e1111111-1111-1111-1111-111111111111',
    'c1111111-1111-1111-1111-111111111111',
    'd1111111-1111-1111-1111-111111111111',
    500,
    'manual',
    'TXN-M1-001',
    'success',
    now() - interval '20 days'
  ),
  (
    'e2222222-2222-2222-2222-222222222222',
    'c2222222-2222-2222-2222-222222222222',
    'd2222222-2222-2222-2222-222222222222',
    300,
    'manual',
    'TXN-M2-001',
    'success',
    now() - interval '10 days'
  )
on conflict (id)
do update set
  member_id = excluded.member_id,
  subscription_id = excluded.subscription_id,
  amount = excluded.amount,
  payment_method = excluded.payment_method,
  transaction_id = excluded.transaction_id,
  payment_status = excluded.payment_status,
  payment_date = excluded.payment_date;

commit;

-- Verification
-- select id, email, role, church_id from public.users where role = 'member' order by created_at desc;
-- select id, user_id, email, membership_id, church_id from public.members order by created_at desc;
-- select id, member_id, plan_name, amount, status from public.subscriptions order by start_date desc;
-- select id, member_id, amount, payment_status, payment_date from public.payments order by payment_date desc;
