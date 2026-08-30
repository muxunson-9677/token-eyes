-- Compact private leaderboard state, one current row per user and device.
-- Apply before leaderboard-actual-cost-state.sql.

begin;

create table if not exists public.tokentracker_leaderboard_device_state (
  user_id uuid not null references auth.users(id) on delete cascade,
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

drop policy if exists leaderboard_device_state_update_own
  on public.tokentracker_leaderboard_device_state;

drop policy if exists leaderboard_device_state_delete_own
  on public.tokentracker_leaderboard_device_state;
create policy leaderboard_device_state_delete_own
  on public.tokentracker_leaderboard_device_state
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.tokentracker_leaderboard_device_state from public;
revoke all on table public.tokentracker_leaderboard_device_state from anon;
revoke insert, update, delete
  on table public.tokentracker_leaderboard_device_state
  from authenticated;
grant select on table public.tokentracker_leaderboard_device_state to authenticated;

create or replace function public.upsert_my_leaderboard_device_state(
  p_device_id text,
  p_state_version smallint,
  p_summary_hash text,
  p_captured_at timestamptz,
  p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_period text;
  v_rows jsonb;
  v_item jsonb;
  v_token_index integer;
  v_period_token_total numeric(30,0);
  v_device_count integer;
  v_allowed_sources text[] := array[
    'claude', 'codex', 'every-code', 'cursor', 'trae', 'gemini',
    'opencode', 'openclaw', 'kilo-cli', 'kilocode', 'roocode', 'kiro',
    'hermes', 'kimi', 'kimi-code', 'codebuddy', 'workbuddy', 'omp', 'pi',
    'craft', 'grok', 'copilot', 'zed', 'goose', 'droid', 'antigravity',
    'deepseek-harness'
  ];
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
  if p_captured_at > now() + interval '5 minutes' then
    raise exception 'captured_at is too far in the future' using errcode = '22023';
  end if;
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 8192 then
    raise exception 'invalid compact payload' using errcode = '22023';
  end if;
  if not (p_payload ?& array['version', 'device_id', 'captured_at', 'periods'])
     or p_payload - array['version', 'device_id', 'captured_at', 'periods'] <> '{}'::jsonb
     or p_payload -> 'version' <> '1'::jsonb
     or jsonb_typeof(p_payload -> 'device_id') <> 'string'
     or p_payload ->> 'device_id' <> p_device_id
     or jsonb_typeof(p_payload -> 'captured_at') <> 'string'
     or (p_payload ->> 'captured_at')::timestamptz <> p_captured_at
     or jsonb_typeof(p_payload -> 'periods') <> 'object'
     or not ((p_payload -> 'periods') ?& array['today', 'week', '30d', 'month', 'total'])
     or (p_payload -> 'periods') - array['today', 'week', '30d', 'month', 'total'] <> '{}'::jsonb then
    raise exception 'invalid compact payload shape' using errcode = '22023';
  end if;

  foreach v_period in array array['today', 'week', '30d', 'month', 'total']
  loop
    v_period_token_total := 0;
    v_rows := p_payload -> 'periods' -> v_period;
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) > 100 then
      raise exception 'invalid compact period rows' using errcode = '22023';
    end if;

    for v_item in select value from jsonb_array_elements(v_rows)
    loop
      if jsonb_typeof(v_item) <> 'array'
         or jsonb_array_length(v_item) <> 7
         or jsonb_typeof(v_item -> 0) <> 'string'
         or char_length(v_item ->> 0) not between 1 and 64
         or (v_item ->> 0) !~ '^[^[:cntrl:]]+$'
         or not ((v_item ->> 0) = any(v_allowed_sources))
         or jsonb_typeof(v_item -> 1) <> 'string'
         or char_length(v_item ->> 1) not between 1 and 256
         or (v_item ->> 1) !~ '^[^[:cntrl:]]+$' then
        raise exception 'invalid compact usage row' using errcode = '22023';
      end if;

      for v_token_index in 2..6
      loop
        if jsonb_typeof(v_item -> v_token_index) <> 'string'
           or (v_item ->> v_token_index) !~ '^[0-9]{1,15}$' then
          raise exception 'invalid compact token count' using errcode = '22023';
        end if;
        v_period_token_total := v_period_token_total
          + (v_item ->> v_token_index)::numeric;
      end loop;
    end loop;
    if v_period_token_total > 10000000000000000 then
      raise exception 'compact period token total exceeds limit' using errcode = '22023';
    end if;
  end loop;

  -- Serialize per-user inserts so two new devices cannot race past the cap.
  perform pg_advisory_xact_lock(
    hashtext('tokentracker:leaderboard-device:' || v_user_id::text)
  );
  if not exists (
    select 1
    from public.tokentracker_leaderboard_device_state
    where user_id = v_user_id
      and device_id = p_device_id
  ) then
    select count(*)
    into v_device_count
    from public.tokentracker_leaderboard_device_state
    where user_id = v_user_id;
    if v_device_count >= 3 then
      raise exception 'device limit exceeded' using errcode = '22023';
    end if;
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
      updated_at = now()
  where tokentracker_leaderboard_device_state.summary_hash
    is distinct from excluded.summary_hash;
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
