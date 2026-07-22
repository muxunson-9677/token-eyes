-- Minimal cloud schema for Token Eyes leaderboard participation.
-- Full usage history stays local; this schema stores no hourly rows, code,
-- conversations, project names, paths, skills, MCP data, or file contents.

begin;

create table if not exists public.tokentracker_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  leaderboard_public boolean not null default true,
  leaderboard_anonymous boolean not null default false,
  display_name text check (display_name is null or char_length(display_name) between 1 and 50),
  github_url text,
  show_github_url boolean not null default false,
  updated_at timestamptz not null default now(),
  check (
    github_url is null
    or github_url ~ '^https://github\\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/?$'
  )
);

alter table public.tokentracker_user_settings enable row level security;

drop policy if exists tokentracker_user_settings_own_select
  on public.tokentracker_user_settings;
create policy tokentracker_user_settings_own_select
  on public.tokentracker_user_settings
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists tokentracker_user_settings_own_insert
  on public.tokentracker_user_settings;
create policy tokentracker_user_settings_own_insert
  on public.tokentracker_user_settings
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists tokentracker_user_settings_own_update
  on public.tokentracker_user_settings;
create policy tokentracker_user_settings_own_update
  on public.tokentracker_user_settings
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists tokentracker_user_settings_own_delete
  on public.tokentracker_user_settings;
create policy tokentracker_user_settings_own_delete
  on public.tokentracker_user_settings
  for delete to authenticated
  using (auth.uid() = user_id);

revoke all on table public.tokentracker_user_settings from public;
revoke all on table public.tokentracker_user_settings from anon;
grant select, insert, update, delete
  on table public.tokentracker_user_settings
  to authenticated;
grant all on table public.tokentracker_user_settings to project_admin;

create or replace view public.tokentracker_user_profiles as
select
  users.id as user_id,
  coalesce(
    nullif(btrim(settings.display_name), ''),
    nullif(btrim(users.profile ->> 'name'), ''),
    nullif(split_part(users.email, '@', 1), ''),
    'Anonymous'
  ) as display_name,
  coalesce(
    nullif(users.profile ->> 'avatar_url', ''),
    nullif(users.profile ->> 'picture', '')
  ) as avatar_url,
  users.created_at
from auth.users users
left join public.tokentracker_user_settings settings
  on settings.user_id = users.id;

revoke all on table public.tokentracker_user_profiles from public;
revoke all on table public.tokentracker_user_profiles from anon;
revoke all on table public.tokentracker_user_profiles from authenticated;
grant select on table public.tokentracker_user_profiles to project_admin;

commit;
