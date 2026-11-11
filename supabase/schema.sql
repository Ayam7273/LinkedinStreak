-- LinkedStreak schema. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
--
-- Who can write what:
--   settings            the signed-in user reads and writes their own row
--   posts               the user can READ and DELETE their own rows; only the server
--                       (service role, via /api/verify-post) can INSERT
--   push_subscriptions  the user can read and delete their own rows; the server inserts
--   notification_log    RLS on, no client policies at all: server only

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- settings
create table if not exists public.settings (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  display_name         text,
  profile_url          text,
  profile_slug         text,
  start_date           date,
  reminder_times       jsonb   not null default '["09:00","18:00","21:30"]'::jsonb,
  grace_reminder_time  text    not null default '10:00',
  reminders_enabled    boolean not null default true,
  updated_at           timestamptz not null default now(),
  constraint reminder_times_is_array check (jsonb_typeof(reminder_times) = 'array'),
  constraint grace_time_format check (grace_reminder_time ~ '^\d{2}:\d{2}$')
);

-- ---------------------------------------------------------------- posts
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  activity_id    text not null unique,
  url_original   text not null,
  url_canonical  text not null,
  published_at   timestamptz not null,
  required_day   date not null,
  author_status  text not null check (author_status in ('verified', 'unconfirmed')),
  logged_at      timestamptz not null default now(),
  note           text check (note is null or char_length(note) <= 280),
  constraint required_day_is_weekend check (extract(isodow from required_day) in (5, 6, 7))
);

create unique index if not exists posts_user_day_uniq on public.posts (user_id, required_day);
create index if not exists posts_user_published_idx on public.posts (user_id, published_at desc);

-- ---------------------------------------------------------------- push_subscriptions
create table if not exists public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  endpoint         text not null unique,
  p256dh           text not null,
  auth             text not null,
  user_agent       text,
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  failure_count    integer not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------- notification_log
create table if not exists public.notification_log (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users (id) on delete cascade,
  kind      text not null check (kind in ('reminder', 'last_call', 'grace', 'test')),
  for_day   date not null,
  slot      text not null,
  sent_at   timestamptz not null default now()
);

create unique index if not exists notification_log_once on public.notification_log (user_id, kind, for_day, slot);

-- ---------------------------------------------------------------- updated_at trigger
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.settings           enable row level security;
alter table public.posts              enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log   enable row level security;

-- settings: full access to own row
drop policy if exists settings_select on public.settings;
drop policy if exists settings_insert on public.settings;
drop policy if exists settings_update on public.settings;
create policy settings_select on public.settings for select to authenticated using (user_id = auth.uid());
create policy settings_insert on public.settings for insert to authenticated with check (user_id = auth.uid());
create policy settings_update on public.settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- posts: read and delete own rows. No insert/update policy: the server is the only writer.
drop policy if exists posts_select on public.posts;
drop policy if exists posts_delete on public.posts;
create policy posts_select on public.posts for select to authenticated using (user_id = auth.uid());
create policy posts_delete on public.posts for delete to authenticated using (user_id = auth.uid());

-- push_subscriptions: read and delete own rows. The server inserts/updates.
drop policy if exists push_select on public.push_subscriptions;
drop policy if exists push_delete on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- notification_log: no policies. RLS on + no policy = no access for anon/authenticated.

-- Belt and braces: the anon role gets nothing on these tables.
revoke all on public.settings, public.posts, public.push_subscriptions, public.notification_log from anon;
revoke insert, update on public.posts from authenticated;
revoke all on public.notification_log from authenticated;
