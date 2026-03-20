-- Migration: Family members and per-person subscriptions
-- Run this in Supabase SQL Editor for existing projects.

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

alter table if exists subscriptions
  add column if not exists family_member_id uuid references family_members(id) on delete set null;
