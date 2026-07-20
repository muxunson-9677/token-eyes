begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tokentracker-leaderboard-avatars',
  'tokentracker-leaderboard-avatars',
  false,
  16384,
  array['image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 16384,
  allowed_mime_types = array['image/webp'];

create table if not exists public.tokentracker_leaderboard_avatar_metadata (
  user_id uuid primary key,
  object_key text not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  avatar_url text not null,
  updated_at timestamptz not null default now()
);

alter table public.tokentracker_leaderboard_avatar_metadata enable row level security;

create policy leaderboard_avatar_metadata_own
  on public.tokentracker_leaderboard_avatar_metadata
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy leaderboard_avatar_objects_own_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tokentracker-leaderboard-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy leaderboard_avatar_objects_own_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tokentracker-leaderboard-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy leaderboard_avatar_objects_own_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tokentracker-leaderboard-avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
