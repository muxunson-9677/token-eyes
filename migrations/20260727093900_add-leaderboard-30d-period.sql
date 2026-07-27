-- Keep the cloud leaderboard's rolling 30 days identical to Usage Stats.

alter table public.tokentracker_actual_cost_state
  add column if not exists "30d_usd" numeric(20,6);

alter table public.tokentracker_actual_cost_state
  drop constraint if exists tokentracker_actual_cost_state_check;
alter table public.tokentracker_actual_cost_state
  add constraint tokentracker_actual_cost_state_check check (
    (
      share_actual_cost
      and today_usd is not null and today_usd >= 0
      and week_usd is not null and week_usd >= 0
      and ("30d_usd" is null or "30d_usd" >= 0)
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
  );

alter table public.tokentracker_leaderboard_snapshots_v2
  drop constraint if exists tokentracker_leaderboard_snapshots_v2_period_check;
alter table public.tokentracker_leaderboard_snapshots_v2
  add constraint tokentracker_leaderboard_snapshots_v2_period_check
  check (period in ('today', 'week', '30d', 'month', 'total'));

create or replace function public.set_my_leaderboard_actual_cost(
  p_share boolean,
  p_today_usd numeric,
  p_week_usd numeric,
  p_30d_usd numeric,
  p_month_usd numeric,
  p_total_usd numeric,
  p_captured_at timestamptz
) returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_share is null or p_captured_at is null then raise exception 'share and captured_at are required' using errcode = '22023'; end if;
  if p_captured_at > now() + interval '5 minutes' then raise exception 'captured_at is too far in the future' using errcode = '22023'; end if;
  if p_share and (p_today_usd is null or p_today_usd < 0 or p_week_usd is null or p_week_usd < 0 or p_30d_usd is null or p_30d_usd < 0 or p_month_usd is null or p_month_usd < 0 or p_total_usd is null or p_total_usd < 0) then
    raise exception 'shared actual costs must be non-negative' using errcode = '22023';
  end if;
  insert into public.tokentracker_actual_cost_state (user_id, share_actual_cost, today_usd, week_usd, "30d_usd", month_usd, total_usd, captured_at, updated_at)
  values (v_user_id, p_share, case when not p_share then null else p_today_usd end, case when not p_share then null else p_week_usd end, case when not p_share then null else p_30d_usd end, case when not p_share then null else p_month_usd end, case when not p_share then null else p_total_usd end, p_captured_at, now())
  on conflict (user_id) do update set share_actual_cost = excluded.share_actual_cost, today_usd = excluded.today_usd, week_usd = excluded.week_usd, "30d_usd" = excluded."30d_usd", month_usd = excluded.month_usd, total_usd = excluded.total_usd, captured_at = excluded.captured_at, updated_at = now();
end;
$function$;

create or replace function public.refresh_my_leaderboard_actual_cost(
  p_today_usd numeric,
  p_week_usd numeric,
  p_30d_usd numeric,
  p_month_usd numeric,
  p_total_usd numeric,
  p_captured_at timestamptz
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_captured_at is null or p_captured_at > now() + interval '5 minutes' or p_today_usd is null or p_today_usd < 0 or p_week_usd is null or p_week_usd < 0 or p_30d_usd is null or p_30d_usd < 0 or p_month_usd is null or p_month_usd < 0 or p_total_usd is null or p_total_usd < 0 then
    raise exception 'invalid actual-cost refresh' using errcode = '22023';
  end if;
  update public.tokentracker_actual_cost_state set today_usd = p_today_usd, week_usd = p_week_usd, "30d_usd" = p_30d_usd, month_usd = p_month_usd, total_usd = p_total_usd, captured_at = p_captured_at, updated_at = now() where user_id = v_user_id and share_actual_cost = true;
  return found;
end;
$function$;

revoke all on function public.set_my_leaderboard_actual_cost(boolean, numeric, numeric, numeric, numeric, numeric, timestamptz) from public, anon;
grant execute on function public.set_my_leaderboard_actual_cost(boolean, numeric, numeric, numeric, numeric, numeric, timestamptz) to authenticated;
revoke all on function public.refresh_my_leaderboard_actual_cost(numeric, numeric, numeric, numeric, numeric, timestamptz) from public, anon;
grant execute on function public.refresh_my_leaderboard_actual_cost(numeric, numeric, numeric, numeric, numeric, timestamptz) to authenticated;
