-- Debounced, bounded leaderboard refresh queue.
-- Apply after leaderboard-device-state.sql and before the refresh Edge function.

create extension if not exists pgcrypto;

create table if not exists public.tokentracker_leaderboard_dirty_dimensions (
  period text not null check (period in ('today', 'week', '30d', 'month', 'total')),
  metric text not null check (metric in ('tokens', 'estimated_spend', 'actual_cost')),
  source text not null,
  dirty_since timestamptz not null default now(),
  not_before timestamptz not null default now(),
  claim_id uuid,
  claimed_until timestamptz,
  reason text not null,
  primary key (period, metric, source)
);

alter table public.tokentracker_leaderboard_dirty_dimensions
  add column if not exists claimed_until timestamptz;

alter table public.tokentracker_leaderboard_dirty_dimensions
  add column if not exists claim_id uuid;

create index if not exists tokentracker_leaderboard_dirty_due_idx
  on public.tokentracker_leaderboard_dirty_dimensions (not_before, dirty_since);

create or replace function public.mark_leaderboard_dimensions_dirty(
  p_user_id uuid,
  p_actual_cost_changed boolean default false
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_count integer := 0;
begin
  if p_user_id is null or not exists (
    select 1
    from public.tokentracker_user_settings settings
    where settings.user_id = p_user_id
      and settings.leaderboard_public = true
  ) then
    return 0;
  end if;

  with source_rows as (
    select distinct item.value ->> 0 as source
    from public.tokentracker_leaderboard_device_state state
    cross join lateral jsonb_each(state.payload -> 'periods') as period_data(period, rows)
    cross join lateral jsonb_array_elements(period_data.rows) as item(value)
    where state.user_id = p_user_id
      and jsonb_typeof(item.value) = 'array'
      and jsonb_array_length(item.value) = 7
      and item.value ->> 0 = any(array[
        'claude', 'codex', 'every-code', 'cursor', 'trae', 'gemini',
        'opencode', 'openclaw', 'kilo-cli', 'kilocode', 'roocode', 'kiro',
        'hermes', 'kimi', 'kimi-code', 'codebuddy', 'workbuddy', 'omp', 'pi',
        'craft', 'grok', 'copilot', 'zed', 'goose', 'droid', 'antigravity',
        'deepseek-harness'
      ]::text[])
  ),
  dimensions as (
    select period, metric, source
    from unnest(array['today', 'week', '30d', 'month', 'total']) period
    cross join unnest(array['tokens', 'estimated_spend']) metric
    cross join (
      select 'all'::text as source
      union
      select source from source_rows
    ) sources
    union all
    select period, 'actual_cost', 'all'
    from unnest(array['today', 'week', '30d', 'month', 'total']) period
    where coalesce(p_actual_cost_changed, false)
  ),
  queued as (
    insert into public.tokentracker_leaderboard_dirty_dimensions (
      period, metric, source, dirty_since, not_before, reason
    )
    -- The Durable Object alarm is the debounce boundary. A new key is due
    -- immediately; the coordinator enforces at most one successful refresh
    -- per 60-second window without running an empty minute cron.
    select period, metric, source, now(), now(), 'meaningful-upload'
    from dimensions
    on conflict (period, metric, source) do update
    set dirty_since = least(
          tokentracker_leaderboard_dirty_dimensions.dirty_since,
          excluded.dirty_since
        ),
        not_before = least(
          tokentracker_leaderboard_dirty_dimensions.not_before,
          excluded.not_before
        ),
        claim_id = null,
        claimed_until = null,
        reason = excluded.reason
    returning 1
  )
  select count(*)::integer into v_count from queued;

  return v_count;
end;
$function$;

create or replace function public.enqueue_leaderboard_daily_reconciliation()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_count integer;
  v_dimension_count integer;
begin
  with fixed_sources(source) as (
    select unnest(array[
      'all', 'claude', 'codex', 'every-code', 'cursor', 'trae', 'gemini',
      'opencode', 'openclaw', 'kilo-cli', 'kilocode', 'roocode', 'kiro',
      'hermes', 'kimi', 'kimi-code', 'codebuddy', 'workbuddy', 'omp', 'pi',
      'craft', 'grok', 'copilot', 'zed', 'goose', 'droid', 'antigravity',
      'deepseek-harness'
    ]::text[])
  ),
  dimensions as (
    select period, metric, source
    from unnest(array['today', 'week', '30d', 'month', 'total']) period
    cross join unnest(array['tokens', 'estimated_spend']) metric
    cross join fixed_sources
    union all
    select period, 'actual_cost', 'all'
    from unnest(array['today', 'week', '30d', 'month', 'total']) period
  ),
  verified_dimensions as (
    select jsonb_agg(jsonb_build_object(
      'period', period, 'metric', metric, 'source', source
    )) as value
    from dimensions
  ),
  queued as (
    insert into public.tokentracker_leaderboard_dirty_dimensions (
      period, metric, source, dirty_since, not_before, reason
    )
    select period, metric, source, now(), now(), 'daily-reconciliation'
    from dimensions
    on conflict (period, metric, source) do update
    set dirty_since = least(
          tokentracker_leaderboard_dirty_dimensions.dirty_since,
          excluded.dirty_since
        ),
        not_before = least(
          tokentracker_leaderboard_dirty_dimensions.not_before,
          excluded.not_before
        ),
        claim_id = null,
        claimed_until = null,
        reason = excluded.reason
    returning 1
  )
  select count(*)::integer, jsonb_array_length(verified.value)
  into v_count, v_dimension_count
  from queued
  cross join verified_dimensions verified
  group by verified.value;

  if v_count <> 285 or v_dimension_count <> 285 then
    raise exception 'daily leaderboard dimension set must contain exactly 285 keys';
  end if;
  return v_count;
end;
$function$;

create or replace function public.claim_leaderboard_dirty_dimensions(
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_result jsonb;
  v_claim_id uuid := gen_random_uuid();
begin
  if p_limit is null or p_limit < 1 or p_limit > 285 then
    raise exception 'invalid dirty dimension claim limit';
  end if;

  with due as (
    select period, metric, source
    from public.tokentracker_leaderboard_dirty_dimensions
    where not_before <= now()
      and (claimed_until is null or claimed_until <= now())
    order by not_before, dirty_since, period, metric, source
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.tokentracker_leaderboard_dirty_dimensions dirty
    set claim_id = v_claim_id,
        claimed_until = now() + interval '5 minutes'
    from due
    where dirty.period = due.period
      and dirty.metric = due.metric
      and dirty.source = due.source
    returning dirty.period, dirty.metric, dirty.source, dirty.claim_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period', period, 'metric', metric, 'source', source, 'claim_id', claim_id
  ) order by period, metric, source), '[]'::jsonb)
  into v_result
  from claimed;

  return v_result;
end;
$function$;

create or replace function public.ack_leaderboard_dirty_dimensions(
  p_dimensions jsonb
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_count integer;
begin
  if jsonb_typeof(p_dimensions) <> 'array'
     or jsonb_array_length(p_dimensions) < 1
     or jsonb_array_length(p_dimensions) > 285 then
    raise exception 'invalid dirty dimension acknowledgement';
  end if;

  with acknowledged as (
    delete from public.tokentracker_leaderboard_dirty_dimensions dirty
    using jsonb_array_elements(p_dimensions) dimension
    where dirty.period = dimension ->> 'period'
      and dirty.metric = dimension ->> 'metric'
      and dirty.source = dimension ->> 'source'
      and dirty.claim_id::text = dimension ->> 'claim_id'
    returning 1
  )
  select count(*)::integer into v_count from acknowledged;
  return v_count;
end;
$function$;

revoke all on table public.tokentracker_leaderboard_dirty_dimensions from public, anon, authenticated;
revoke all on function public.mark_leaderboard_dimensions_dirty(uuid, boolean) from public, anon, authenticated;
revoke all on function public.enqueue_leaderboard_daily_reconciliation() from public, anon, authenticated;
revoke all on function public.claim_leaderboard_dirty_dimensions(integer) from public, anon, authenticated;
revoke all on function public.ack_leaderboard_dirty_dimensions(jsonb) from public, anon, authenticated;
grant execute on function public.mark_leaderboard_dimensions_dirty(uuid, boolean) to project_admin;
grant execute on function public.enqueue_leaderboard_daily_reconciliation() to project_admin;
grant execute on function public.claim_leaderboard_dirty_dimensions(integer) to project_admin;
grant execute on function public.ack_leaderboard_dirty_dimensions(jsonb) to project_admin;
