-- Optional actual-cost consent and rolling-30-day aggregate.
-- Apply after leaderboard-device-state.sql.

begin;

create table if not exists public.tokentracker_actual_cost_state (
  user_id uuid primary key,
  share_actual_cost boolean not null default false,
  today_usd numeric(20,6),
  week_usd numeric(20,6),
  "30d_usd" numeric(20,6),
  month_usd numeric(20,6),
  total_usd numeric(20,6),
  captured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (
    (
      share_actual_cost
      and today_usd is not null and today_usd >= 0
      and week_usd is not null and week_usd >= 0
      and "30d_usd" is not null and "30d_usd" >= 0
      and month_usd is not null and month_usd >= 0
      and total_usd is not null and total_usd >= 0
    )
    or
    (
      not share_actual_cost
      and today_usd is null
      and week_usd is null
      and "30d_usd" is null
      and month_usd is null
      and total_usd is null
    )
  )
);

alter table public.tokentracker_actual_cost_state enable row level security;

drop policy if exists leaderboard_actual_cost_select_own
  on public.tokentracker_actual_cost_state;
create policy leaderboard_actual_cost_select_own
  on public.tokentracker_actual_cost_state
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists leaderboard_actual_cost_insert_own
  on public.tokentracker_actual_cost_state;

drop policy if exists leaderboard_actual_cost_update_own
  on public.tokentracker_actual_cost_state;

drop policy if exists leaderboard_actual_cost_delete_own
  on public.tokentracker_actual_cost_state;
create policy leaderboard_actual_cost_delete_own
  on public.tokentracker_actual_cost_state
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.tokentracker_actual_cost_state from public;
revoke all on table public.tokentracker_actual_cost_state from anon;
revoke insert, update
  on table public.tokentracker_actual_cost_state
  from authenticated;
grant select, delete
  on table public.tokentracker_actual_cost_state
  to authenticated;

create or replace function public.set_my_leaderboard_actual_cost(
  p_share boolean,
  p_today_usd numeric,
  p_week_usd numeric,
  p_30d_usd numeric,
  p_month_usd numeric,
  p_total_usd numeric,
  p_captured_at timestamptz
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
  if p_share is null or p_captured_at is null then
    raise exception 'share and captured_at are required' using errcode = '22023';
  end if;
  if p_captured_at > now() + interval '5 minutes' then
    raise exception 'captured_at is too far in the future' using errcode = '22023';
  end if;
  if p_share and (
    p_today_usd is null or p_today_usd < 0
    or p_week_usd is null or p_week_usd < 0
    or p_30d_usd is null or p_30d_usd < 0
    or p_month_usd is null or p_month_usd < 0
    or p_total_usd is null or p_total_usd < 0
  ) then
    raise exception 'shared actual costs must be non-negative' using errcode = '22023';
  end if;

  insert into public.tokentracker_actual_cost_state (
    user_id,
    share_actual_cost,
    today_usd,
    week_usd,
    "30d_usd",
    month_usd,
    total_usd,
    captured_at,
    updated_at
  ) values (
    v_user_id,
    p_share,
    case when not p_share then null else p_today_usd end,
    case when not p_share then null else p_week_usd end,
    case when not p_share then null else p_30d_usd end,
    case when not p_share then null else p_month_usd end,
    case when not p_share then null else p_total_usd end,
    p_captured_at,
    now()
  )
  on conflict (user_id) do update
  set share_actual_cost = excluded.share_actual_cost,
      today_usd = excluded.today_usd,
      week_usd = excluded.week_usd,
      "30d_usd" = excluded."30d_usd",
      month_usd = excluded.month_usd,
      total_usd = excluded.total_usd,
      captured_at = excluded.captured_at,
      updated_at = now();
end;
$function$;

revoke all on function public.set_my_leaderboard_actual_cost(
  boolean, numeric, numeric, numeric, numeric, numeric, timestamptz
) from public;
revoke all on function public.set_my_leaderboard_actual_cost(
  boolean, numeric, numeric, numeric, numeric, numeric, timestamptz
) from anon;
grant execute on function public.set_my_leaderboard_actual_cost(
  boolean, numeric, numeric, numeric, numeric, numeric, timestamptz
) to authenticated;

create or replace function public.refresh_my_leaderboard_actual_cost(
  p_today_usd numeric,
  p_week_usd numeric,
  p_30d_usd numeric,
  p_month_usd numeric,
  p_total_usd numeric,
  p_captured_at timestamptz
) returns boolean
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
  if p_captured_at is null
     or p_captured_at > now() + interval '5 minutes'
     or p_today_usd is null or p_today_usd < 0
     or p_week_usd is null or p_week_usd < 0
     or p_30d_usd is null or p_30d_usd < 0
     or p_month_usd is null or p_month_usd < 0
     or p_total_usd is null or p_total_usd < 0 then
    raise exception 'invalid actual-cost refresh' using errcode = '22023';
  end if;

  update public.tokentracker_actual_cost_state
  set today_usd = p_today_usd,
      week_usd = p_week_usd,
      "30d_usd" = p_30d_usd,
      month_usd = p_month_usd,
      total_usd = p_total_usd,
      captured_at = p_captured_at,
      updated_at = now()
  where user_id = v_user_id
    and share_actual_cost = true;

  return found;
end;
$function$;

revoke all on function public.refresh_my_leaderboard_actual_cost(
  numeric, numeric, numeric, numeric, numeric, timestamptz
) from public;
revoke all on function public.refresh_my_leaderboard_actual_cost(
  numeric, numeric, numeric, numeric, numeric, timestamptz
) from anon;
grant execute on function public.refresh_my_leaderboard_actual_cost(
  numeric, numeric, numeric, numeric, numeric, timestamptz
) to authenticated;

create or replace function public.delete_my_leaderboard_data()
returns void
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

  delete from public.tokentracker_leaderboard_device_state
  where user_id = v_user_id;

  delete from public.tokentracker_actual_cost_state
  where user_id = v_user_id;

  if to_regclass('public.tokentracker_leaderboard_snapshots') is not null then
    execute
      'delete from public.tokentracker_leaderboard_snapshots where user_id = $1'
      using v_user_id;
  end if;

  if to_regclass('public.tokentracker_leaderboard_snapshots_v2') is not null then
    execute
      'delete from public.tokentracker_leaderboard_snapshots_v2 where user_id = $1'
      using v_user_id;
  end if;

  if to_regclass('public.tokentracker_leaderboard_avatar_metadata') is not null then
    if to_regclass('storage.objects') is not null then
      execute
        'delete from storage.objects
         where bucket = ''tokentracker-leaderboard-avatars''
           and key in (
             select object_key
             from public.tokentracker_leaderboard_avatar_metadata
             where user_id = $1
           )'
        using v_user_id;
    end if;
    execute
      'delete from public.tokentracker_leaderboard_avatar_metadata where user_id = $1'
      using v_user_id;
  end if;

  delete from public.tokentracker_user_settings
  where user_id = v_user_id;
end;
$function$;

revoke all on function public.delete_my_leaderboard_data() from public;
revoke all on function public.delete_my_leaderboard_data() from anon;
grant execute on function public.delete_my_leaderboard_data() to authenticated;

commit;
