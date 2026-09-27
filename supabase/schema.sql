-- Fuel & Lift — database setup. Run once in Supabase → SQL Editor → New query.
-- Safe to re-run: every statement checks before creating.

-- 1. Every person's data: one row per document (a day, the profile, a saved
--    food, a report, a plan, a review). Only the owner can read or write it;
--    the database enforces this, not the web page.
create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  collection text        not null check (collection ~ '^[a-z_]{1,24}$'),
  id         text        not null check (length(id) between 1 and 120),
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id)
);
create index if not exists docs_changed on public.docs (user_id, updated_at);

alter table public.docs enable row level security;

drop policy if exists "read own docs"   on public.docs;
drop policy if exists "insert own docs" on public.docs;
drop policy if exists "update own docs" on public.docs;
drop policy if exists "delete own docs" on public.docs;
create policy "read own docs"   on public.docs for select using (auth.uid() = user_id);
create policy "insert own docs" on public.docs for insert with check (auth.uid() = user_id);
create policy "update own docs" on public.docs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own docs" on public.docs for delete using (auth.uid() = user_id);

-- Keep updated_at honest (the page's clock can be wrong).
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.touch_updated_at();

-- A single document can't be larger than 1 MB.
alter table public.docs drop constraint if exists docs_size;
alter table public.docs add constraint docs_size check (pg_column_size(data) < 1048576);

-- 2. Live sync between phone and laptop.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 3. Claude usage per person per day, for the daily cap. Only the server
--    function writes here (with the service role); people can read their own.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "read own usage" on public.ai_usage;
create policy "read own usage" on public.ai_usage for select using (auth.uid() = user_id);

-- Atomically adds one to today's count and returns the new count.
create or replace function public.bump_ai_usage(p_user uuid, p_day date)
returns int language sql security definer set search_path = public as $$
  insert into public.ai_usage (user_id, day, count) values (p_user, p_day, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count;
$$;
revoke all on function public.bump_ai_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid, date) to service_role;

-- Gives one back when Claude couldn't be reached, so failures don't use up the cap.
create or replace function public.refund_ai_usage(p_user uuid, p_day date)
returns void language sql security definer set search_path = public as $$
  update public.ai_usage set count = greatest(count - 1, 0) where user_id = p_user and day = p_day;
$$;
revoke all on function public.refund_ai_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.refund_ai_usage(uuid, date) to service_role;

-- 4. Invite-only sign-up (optional). Add friends' emails here; leave the
--    table empty to let anyone who has the link sign up.
create table if not exists public.invites (
  email text primary key check (email = lower(email))
);
alter table public.invites enable row level security; -- no policies: only the service role reads it

-- 5. Approval: anyone can sign in (Google, Apple or email), but the first
--    time they land on "waiting for approval" until the owner approves them.
--    The database enforces it: until approved, a person can't read or write
--    any data and the AI function refuses them.
create table if not exists public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text,
  name         text,
  provider     text,
  status       text not null default 'pending' check (status in ('pending','approved','declined')),
  is_admin     boolean not null default false,
  requested_at timestamptz not null default now(),
  decided_at   timestamptz
);
alter table public.members enable row level security;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'approved');
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'approved' and is_admin);
$$;

drop policy if exists "see own membership" on public.members;
drop policy if exists "admins see everyone" on public.members;
create policy "see own membership" on public.members for select using (auth.uid() = user_id);
create policy "admins see everyone" on public.members for select using (public.is_admin());

-- Every new account gets a row; emails already on the invites list are approved straight away.
create or replace function public.handle_new_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (user_id, email, name, provider, status, decided_at)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          coalesce(new.raw_app_meta_data->>'provider', 'email'),
          case when exists (select 1 from public.invites where email = lower(new.email)) then 'approved' else 'pending' end,
          case when exists (select 1 from public.invites where email = lower(new.email)) then now() end)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_member();

-- Accounts that existed before approvals were switched on are approved.
insert into public.members (user_id, email, provider, status, decided_at)
select id, lower(email), coalesce(raw_app_meta_data->>'provider', 'email'), 'approved', now() from auth.users
on conflict (user_id) do nothing;

-- Only an admin can approve, decline or remove someone (and not themselves).
create or replace function public.set_member_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own access'; end if;
  if p_status not in ('approved','declined','pending') then raise exception 'bad status'; end if;
  update public.members set status = p_status, decided_at = now() where user_id = p_user;
end $$;
revoke all on function public.set_member_status(uuid, text) from public, anon;
grant execute on function public.set_member_status(uuid, text) to authenticated;

-- Data needs approval as well as ownership.
drop policy if exists "read own docs"   on public.docs;
drop policy if exists "insert own docs" on public.docs;
drop policy if exists "update own docs" on public.docs;
drop policy if exists "delete own docs" on public.docs;
create policy "read own docs"   on public.docs for select using (auth.uid() = user_id and public.is_approved());
create policy "insert own docs" on public.docs for insert with check (auth.uid() = user_id and public.is_approved());
create policy "update own docs" on public.docs for update using (auth.uid() = user_id and public.is_approved()) with check (auth.uid() = user_id and public.is_approved());
create policy "delete own docs" on public.docs for delete using (auth.uid() = user_id and public.is_approved());
