-- Supabase Row-Level Security and policies for Church Subscription app

-- enable RLS on tables
alter table if exists churches enable row level security;
alter table if exists users enable row level security;
alter table if exists members enable row level security;
alter table if exists subscriptions enable row level security;
alter table if exists payments enable row level security;
alter table if exists subscription_events enable row level security;
alter table if exists announcements enable row level security;

-- Helper notes:
-- role claim can be in root JWT, app_metadata, or user_metadata
-- church_id claim can be in root JWT, app_metadata, or user_metadata

-- Create policies for churches (only same church)
drop policy if exists "select churches by church_id" on churches;
create policy "select churches by church_id" on churches
  for select using (
    auth.role() = 'authenticated'
    and id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ),
      ''
    )::uuid
  );

-- Users: only allow users in same church or themselves
drop policy if exists "select users by church" on users;
create policy "select users by church" on users
  for select using (
    auth.role() = 'authenticated' and (
      church_id = nullif(
        coalesce(
          auth.jwt() ->> 'church_id',
          auth.jwt() -> 'app_metadata' ->> 'church_id',
          auth.jwt() -> 'user_metadata' ->> 'church_id'
        ),
        ''
      )::uuid or
      id = auth.uid()
    )
  );

drop policy if exists "insert users" on users;
create policy "insert users" on users
  for insert with check (
    auth.role() = 'authenticated' and id = auth.uid()
  );

drop policy if exists "update users" on users;
create policy "update users" on users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Members: can access own member record by user_id, admins can access same church
drop policy if exists "select members for self or church" on members;
create policy "select members for self or church" on members
  for select using (
    auth.role() = 'authenticated' and (
      user_id = auth.uid() or church_id = nullif(
        coalesce(
          auth.jwt() ->> 'church_id',
          auth.jwt() -> 'app_metadata' ->> 'church_id',
          auth.jwt() -> 'user_metadata' ->> 'church_id'
        ),
        ''
      )::uuid
    )
  );

drop policy if exists "insert members admin only" on members;
create policy "insert members admin only" on members
  for insert with check (
    auth.role() = 'authenticated'
    and coalesce(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() -> 'user_metadata' ->> 'role'
    ) = 'admin'
    and church_id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ),
      ''
    )::uuid
  );

drop policy if exists "update members admin or self" on members;
create policy "update members admin or self" on members
  for update using (
    auth.role() = 'authenticated' and (
      user_id = auth.uid() or (
        coalesce(
          auth.jwt() ->> 'role',
          auth.jwt() -> 'app_metadata' ->> 'role',
          auth.jwt() -> 'user_metadata' ->> 'role'
        ) = 'admin'
        and church_id = nullif(
          coalesce(
            auth.jwt() ->> 'church_id',
            auth.jwt() -> 'app_metadata' ->> 'church_id',
            auth.jwt() -> 'user_metadata' ->> 'church_id'
          ),
          ''
        )::uuid
      )
    )
  ) with check (
    auth.role() = 'authenticated' and (
      user_id = auth.uid() or (
        coalesce(
          auth.jwt() ->> 'role',
          auth.jwt() -> 'app_metadata' ->> 'role',
          auth.jwt() -> 'user_metadata' ->> 'role'
        ) = 'admin'
        and church_id = nullif(
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

-- Subscriptions: only members of same church through member relation or admin by church
drop policy if exists "select subscriptions by church" on subscriptions;
create policy "select subscriptions by church" on subscriptions
  for select using (
    auth.role() = 'authenticated' and (
      exists (
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

drop policy if exists "insert subscriptions admin only" on subscriptions;
create policy "insert subscriptions admin only" on subscriptions
  for insert with check (
    auth.role() = 'authenticated'
    and coalesce(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() -> 'user_metadata' ->> 'role'
    ) = 'admin'
    and exists (
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
  );

-- Payments: can read if belongs to member or admin in church
drop policy if exists "select payments by member church" on payments;
create policy "select payments by member church" on payments
  for select using (
    auth.role() = 'authenticated' and (
      exists (
        select 1 from members m where m.id = member_id and m.user_id = auth.uid()
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

drop policy if exists "insert payments" on payments;
create policy "insert payments" on payments
  for insert with check (
    auth.role() = 'authenticated' and (
      exists (
        select 1 from members m where m.id = member_id and m.user_id = auth.uid()
      ) or (
        coalesce(
          auth.jwt() ->> 'role',
          auth.jwt() -> 'app_metadata' ->> 'role',
          auth.jwt() -> 'user_metadata' ->> 'role'
        ) = 'admin'
        and exists (
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
    )
  );

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

-- Announcements: only church admins can insert; any authenticated user in church can select
drop policy if exists "select announcements by church" on announcements;
create policy "select announcements by church" on announcements
  for select using (
    auth.role() = 'authenticated'
    and church_id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ),
      ''
    )::uuid
  );

drop policy if exists "insert announcements admin only" on announcements;
create policy "insert announcements admin only" on announcements
  for insert with check (
    auth.role() = 'authenticated'
    and coalesce(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() -> 'user_metadata' ->> 'role'
    ) = 'admin'
    and church_id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ),
      ''
    )::uuid
  );

drop policy if exists "update announcements admin only" on announcements;
create policy "update announcements admin only" on announcements
  for update using (
    auth.role() = 'authenticated'
    and coalesce(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() -> 'user_metadata' ->> 'role'
    ) = 'admin'
    and church_id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ),
      ''
    )::uuid
  ) with check (
    auth.role() = 'authenticated'
    and coalesce(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() -> 'user_metadata' ->> 'role'
    ) = 'admin'
    and church_id = nullif(
      coalesce(
        auth.jwt() ->> 'church_id',
        auth.jwt() -> 'app_metadata' ->> 'church_id',
        auth.jwt() -> 'user_metadata' ->> 'church_id'
      ),
      ''
    )::uuid
  );
