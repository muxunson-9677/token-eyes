-- Compact private leaderboard state, one current row per user and device.
-- Apply before leaderboard-actual-cost-state.sql.

begin;

create table if not exists public.tokentracker_leaderboard_device_state (
  user_id uuid not null,
  device_id text not null check (char_length(device_id) between 8 and 128),
  state_version smallint not null default 1 check (state_version = 1),
  summary_hash text not null check (summary_hash ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id),
  check (octet_length(payload::text) <= 8192)
);

create index if not exists tokentracker_leaderboard_device_state_updated_idx
  on public.tokentracker_leaderboard_device_state (updated_at);

alter table public.tokentracker_leaderboard_device_state enable row level security;

drop policy if exists leaderboard_device_state_select_own
  on public.tokentracker_leaderboard_device_state;
create policy leaderboard_device_state_select_own
  on public.tokentracker_leaderboard_device_state
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists leaderboard_device_state_insert_own
  on public.tokentracker_leaderboard_device_state;
create policy leaderboard_device_state_insert_own
  on public.tokentracker_leaderboard_device_state
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists leaderboard_device_state_update_own
  on public.tokentracker_leaderboard_device_state;
create policy leaderboard_device_state_update_own
  on public.tokentracker_leaderboard_device_state
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists leaderboard_device_state_delete_own
  on public.tokentracker_leaderboard_device_state;
create policy leaderboard_device_state_delete_own
  on public.tokentracker_leaderboard_device_state
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.tokentracker_leaderboard_device_state from public;
revoke all on table public.tokentracker_leaderboard_device_state from anon;
grant select, insert, update, delete
  on table public.tokentracker_leaderboard_device_state
  to authenticated;

create or replace function public.upsert_my_leaderboard_device_state(
  p_device_id text,
  p_state_version smallint,
  p_summary_hash text,
  p_captured_at timestamptz,
  p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_device_id is null or char_length(p_device_id) not between 8 and 128 then
    raise exception 'invalid device_id' using errcode = '22023';
  end if;
  if p_state_version is distinct from 1 then
    raise exception 'unsupported state_version' using errcode = '22023';
  end if;
  if p_summary_hash is null or p_summary_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid summary_hash' using errcode = '22023';
  end if;
  if p_captured_at is null then
    raise exception 'captured_at is required' using errcode = '22023';
  end if;
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 8192 then
    raise exception 'invalid compact payload' using errcode = '22023';
  end if;

  insert into public.tokentracker_leaderboard_device_state (
    user_id,
    device_id,
    state_version,
    summary_hash,
    captured_at,
    payload,
    updated_at
  ) values (
    v_user_id,
    p_device_id,
    p_state_version,
    p_summary_hash,
    p_captured_at,
    p_payload,
    now()
  )
  on conflict (user_id, device_id) do update
  set state_version = excluded.state_version,
      summary_hash = excluded.summary_hash,
      captured_at = excluded.captured_at,
      payload = excluded.payload,
      updated_at = now();
end;
$function$;

revoke all on function public.upsert_my_leaderboard_device_state(
  text, smallint, text, timestamptz, jsonb
) from public;
revoke all on function public.upsert_my_leaderboard_device_state(
  text, smallint, text, timestamptz, jsonb
) from anon;
grant execute on function public.upsert_my_leaderboard_device_state(
  text, smallint, text, timestamptz, jsonb
) to authenticated;

commit;
