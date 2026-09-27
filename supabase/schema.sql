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
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
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

-- Approval checks used by the security rules. They live in the "private"
-- schema, which the web API doesn't expose, so they can't be called directly.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.is_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'approved');
$$;
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'approved' and is_admin);
$$;
revoke all on function private.is_approved(), private.is_admin() from public, anon;
grant execute on function private.is_approved(), private.is_admin() to authenticated;

drop policy if exists "see own membership" on public.members;
drop policy if exists "admins see everyone" on public.members;
create policy "see own membership" on public.members for select using (auth.uid() = user_id);
create policy "admins see everyone" on public.members for select using (private.is_admin());

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
revoke all on function public.handle_new_member() from public, anon, authenticated;  -- only the trigger runs it
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
  if not private.is_admin() then raise exception 'not allowed'; end if;
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
create policy "read own docs"   on public.docs for select using (auth.uid() = user_id and private.is_approved());
create policy "insert own docs" on public.docs for insert with check (auth.uid() = user_id and private.is_approved());
create policy "update own docs" on public.docs for update using (auth.uid() = user_id and private.is_approved()) with check (auth.uid() = user_id and private.is_approved());
create policy "delete own docs" on public.docs for delete using (auth.uid() = user_id and private.is_approved());

-- 6. Face ID / Touch ID sign-in (passkeys). Only the passkey server
--    function reads or writes these tables (RLS on, no policies).
create table if not exists public.passkeys (
  id           text primary key,              -- credential id (base64url)
  user_id      uuid not null references auth.users (id) on delete cascade,
  public_key   text not null,                 -- base64url COSE public key
  counter      bigint not null default 0,
  transports   text[],
  device_name  text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists passkeys_user on public.passkeys (user_id);
alter table public.passkeys enable row level security;

create table if not exists public.webauthn_challenges (
  id         uuid primary key default gen_random_uuid(),
  challenge  text not null,
  user_id    uuid references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('register','login')),
  expires_at timestamptz not null default now() + interval '5 minutes'
);
alter table public.webauthn_challenges enable row level security;

-- 7. Weekly leaderboard. Each person's app publishes its own weekly
--    summary (no food or training details); approved members can read
--    everyone's row. People who switch the leaderboard off delete theirs.
create table if not exists public.leaderboard (
  user_id        uuid not null references auth.users (id) on delete cascade,
  week           date not null,                 -- Monday of the week
  name           text,
  workouts       int  not null default 0,        -- days with gym or sport
  protein_avg    numeric,                       -- g/day over days with food logged
  protein_target numeric,
  logged_days    int  not null default 0,
  score          int  not null default 0,        -- 0-100
  updated_at     timestamptz not null default now(),
  primary key (user_id, week)
);
alter table public.leaderboard enable row level security;
drop policy if exists "members read the board" on public.leaderboard;
drop policy if exists "write own board row"   on public.leaderboard;
drop policy if exists "update own board row"  on public.leaderboard;
drop policy if exists "delete own board row"  on public.leaderboard;
create policy "members read the board" on public.leaderboard for select using (private.is_approved());
create policy "write own board row"   on public.leaderboard for insert with check (auth.uid() = user_id and private.is_approved());
create policy "update own board row"  on public.leaderboard for update using (auth.uid() = user_id and private.is_approved()) with check (auth.uid() = user_id and private.is_approved());
create policy "delete own board row"  on public.leaderboard for delete using (auth.uid() = user_id);

-- 8. Hardening.
-- Only the kinds of records the app writes.
alter table public.docs drop constraint if exists docs_collection_known;
alter table public.docs add constraint docs_collection_known
  check (collection in ('days','profile','foods','reports','plans','reviews','foodlib','health'));
-- Leaderboard numbers must be sensible (weeks start on Monday).
alter table public.leaderboard drop constraint if exists leaderboard_sane;
alter table public.leaderboard add constraint leaderboard_sane check (
  extract(isodow from week) = 1 and workouts between 0 and 7 and logged_days between 0 and 7
  and score between 0 and 100 and char_length(coalesce(name,'')) <= 40
  and coalesce(protein_avg,0) between 0 and 1000 and coalesce(protein_target,0) between 0 and 1000);
-- Old copies of the approval checks, from before they moved to "private".
drop function if exists public.is_approved();
drop function if exists public.is_admin();

-- Supabase's own rls_auto_enable() event-trigger helper doesn't need to be
-- callable over the API (event triggers run regardless of these grants).
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- 9. Apple Health sync keys (supabase/functions/health-sync).
-- One key per person, stored only as a SHA-256 hash. Only the function reads
-- or writes this table (RLS on, no policies); synced numbers go to docs
-- collection 'health', one record per day.
create table if not exists public.health_keys (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_sync_at timestamptz
);
alter table public.health_keys enable row level security;
revoke all on public.health_keys from anon, authenticated;
