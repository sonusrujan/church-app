-- Migration: Subscription realtime tracking ledger
-- Run this in Supabase SQL Editor for existing projects.

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

alter table if exists subscription_events enable row level security;

drop policy if exists "select subscription events by member church" on subscription_events;
create policy "select subscription events by member church" on subscription_events
  for select using (
    auth.role() = 'authenticated' and (
      exists (
        select 1 from members m
        where m.id = member_id
          and m.user_id = auth.uid()
      ) or exists (
        select 1 from members m
        where m.id = member_id
          and m.church_id = nullif(
            coalesce(
              auth.jwt() ->> 'church_id',
              auth.jwt() -> 'app_metadata' ->> 'church_id',
              auth.jwt() -> 'user_metadata' ->> 'church_id'
            ),
            ''
          )::uuid
      )
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.subscription_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
