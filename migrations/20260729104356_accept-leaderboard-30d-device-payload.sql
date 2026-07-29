-- The desktop payload has included the rolling 30-day period since 0.54.26.
-- Extend the existing validated RPC instead of maintaining a second copy.
do $migration$
declare
  previous_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.upsert_my_leaderboard_device_state(text,smallint,text,timestamptz,jsonb)'::regprocedure
  ) into previous_definition;

  updated_definition := replace(
    previous_definition,
    'array[''today'', ''week'', ''month'', ''total'']',
    'array[''today'', ''week'', ''30d'', ''month'', ''total'']'
  );

  if updated_definition = previous_definition
     or position('''30d''' in updated_definition) = 0 then
    raise exception 'could not extend leaderboard device payload with 30d';
  end if;

  execute updated_definition;
end;
$migration$;
