-- Step 4 + Step 5 bootstrap script
-- Purpose:
-- 1) Seed multiple churches.
-- 2) Create/update your admin profile row in public.users.
-- 3) Set role/church_id claims for an already logged-in Google user.
--
-- How to use:
-- 1) Make sure the admin has already logged in once with Google in your app.
-- 2) In your auth system -> Users, copy that user's UUID.
-- 3) Replace values in the declare block below.
-- 4) Run the script in SQL Editor.

begin;

do $$
declare
  v_admin_user_id uuid := '55f72f2b-e584-4efa-998a-1f0c8f447f53';
  v_admin_email text := 'sonusrujan76@gmail.com';
  v_admin_full_name text := 'Sonu Srujan';

  -- Primary church attached to your profile and JWT metadata.
  v_primary_church_id uuid := '22222222-2222-2222-2222-222222222222';
begin
  -- Safety check: run this only after the user logs in once via Google.
  if not exists (
    select 1
    from auth.users
    where id = v_admin_user_id
      and lower(email) = lower(v_admin_email)
  ) then
    raise exception 'Auth user not found for id/email. Login once with Google, then rerun with correct v_admin_user_id/email.';
  end if;

  -- Step 5: create or update churches
  insert into public.churches (id, name, location, contact_phone)
  values
    ('22222222-2222-2222-2222-222222222222', 'St. Thomas Church', 'Kochi, Kerala', '+919999999901'),
    ('33333333-3333-3333-3333-333333333333', 'Grace Fellowship Church', 'Kottayam, Kerala', '+919999999902'),
    ('44444444-4444-4444-4444-444444444444', 'New Life Church', 'Thrissur, Kerala', '+919999999903')
  on conflict (id)
  do update set
    name = excluded.name,
    location = excluded.location,
    contact_phone = excluded.contact_phone;

  -- Step 5: create or update your app user profile row
  insert into public.users (id, auth_user_id, email, full_name, role, church_id)
  values (v_admin_user_id, v_admin_user_id, v_admin_email, v_admin_full_name, 'admin', v_primary_church_id)
  on conflict (id)
  do update set
    auth_user_id = excluded.auth_user_id,
    email = excluded.email,
    full_name = excluded.full_name,
    role = 'admin',
    church_id = excluded.church_id;

  -- Step 4: write claims into auth metadata so JWT carries role/church_id.
  -- Note: "super-admin" is controlled by SUPER_ADMIN_EMAILS in backend env.
  update auth.users
  set
    raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', 'admin', 'church_id', v_primary_church_id::text),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', 'admin', 'church_id', v_primary_church_id::text)
  where id = v_admin_user_id;
end $$;

commit;

-- Verification queries
-- select id, email, role, church_id from public.users where id = '55f72f2b-e584-4efa-998a-1f0c8f447f53';
-- select id, raw_app_meta_data, raw_user_meta_data from auth.users where id = '55f72f2b-e584-4efa-998a-1f0c8f447f53';
-- select id, name, location, contact_phone from public.churches order by name;
