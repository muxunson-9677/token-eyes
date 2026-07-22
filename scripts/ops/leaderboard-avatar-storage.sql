-- Create the bucket as private with the InsForge CLI before applying this SQL:
--   insforge storage create-bucket tokentracker-leaderboard-avatars --private
-- Object reads and writes stay behind the JWT-verifying avatar edge functions.

begin;

create table if not exists public.tokentracker_leaderboard_avatar_metadata (
  user_id uuid primary key references auth.users(id) on delete cascade,
  object_key text not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  avatar_url text not null,
  updated_at timestamptz not null default now()
);

create index if not exists tokentracker_leaderboard_avatar_content_hash_idx
  on public.tokentracker_leaderboard_avatar_metadata (content_hash);

alter table public.tokentracker_leaderboard_avatar_metadata enable row level security;

drop policy if exists leaderboard_avatar_metadata_own
  on public.tokentracker_leaderboard_avatar_metadata;
create policy leaderboard_avatar_metadata_own
  on public.tokentracker_leaderboard_avatar_metadata
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on table public.tokentracker_leaderboard_avatar_metadata from public;
revoke all on table public.tokentracker_leaderboard_avatar_metadata from anon;
grant select, insert, update, delete
  on table public.tokentracker_leaderboard_avatar_metadata
  to authenticated;
grant all on table public.tokentracker_leaderboard_avatar_metadata to project_admin;

commit;
