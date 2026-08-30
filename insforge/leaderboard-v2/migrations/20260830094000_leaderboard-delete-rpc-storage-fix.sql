-- Avatar bytes are deleted first by the JWT-verifying avatar Edge Function.
-- Keep the auth-bound database cleanup RPC independent of protected storage tables.
create or replace function public.delete_my_leaderboard_data()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform public.mark_leaderboard_dimensions_dirty(v_user_id, true);

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
