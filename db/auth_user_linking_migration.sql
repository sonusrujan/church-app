-- Migration: allow pre-registering users by email and linking Supabase Auth UUID later.

begin;

alter table if exists public.users
  alter column id set default uuid_generate_v4();

alter table if exists public.users
  add column if not exists auth_user_id uuid;

alter table if exists public.users
  add column if not exists avatar_url text;

create unique index if not exists users_auth_user_id_unique
  on public.users(auth_user_id)
  where auth_user_id is not null;

commit;
