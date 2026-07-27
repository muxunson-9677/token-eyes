-- Extend the already-deployed atomic refresh procedure without replacing its
-- pricing, privacy, or ranking logic with a second implementation.

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('public.refresh_leaderboard_snapshots(boolean,boolean)'::regprocedure)
    into definition;
  if definition is null then
    raise exception 'refresh_leaderboard_snapshots(boolean,boolean) is required';
  end if;

  definition := replace(
    definition,
    'array[''today'', ''week'', ''month'', ''total'']',
    'array[''today'', ''week'', ''30d'', ''month'', ''total'']'
  );
  definition := replace(
    definition,
    'array[''today'', ''week'']',
    'array[''today'', ''week'', ''30d'']'
  );
  definition := replace(
    definition,
    E'        or (\n          selected.period = ''month''',
    E'        or (\n          selected.period = ''30d''\n          and (state.captured_at at time zone ''Asia/Shanghai'')::date = v_shanghai_day\n        )\n        or (\n          selected.period = ''month'''
  );
  definition := replace(
    definition,
    E'        when ''week'' then actual.week_usd\n        when ''month'' then actual.month_usd',
    E'        when ''week'' then actual.week_usd\n        when ''30d'' then actual."30d_usd"\n        when ''month'' then actual.month_usd'
  );
  definition := replace(
    definition,
    E'        or (\n          totals.period = ''month''',
    E'        or (\n          totals.period = ''30d''\n          and (actual.captured_at at time zone ''Asia/Shanghai'')::date = v_shanghai_day\n        )\n        or (\n          totals.period = ''month'''
  );
  definition := replace(
    definition,
    E'        when ''week'' then\n          v_shanghai_day - (extract(isodow from v_shanghai_day)::integer - 1)\n        when ''month'' then',
    E'        when ''week'' then\n          v_shanghai_day - (extract(isodow from v_shanghai_day)::integer - 1)\n        when ''30d'' then v_shanghai_day - 29\n        when ''month'' then'
  );
  definition := replace(
    definition,
    E'        when ''week'' then\n          v_shanghai_day - (extract(isodow from v_shanghai_day)::integer - 1) + 6\n        when ''month'' then',
    E'        when ''week'' then\n          v_shanghai_day - (extract(isodow from v_shanghai_day)::integer - 1) + 6\n        when ''30d'' then v_shanghai_day\n        when ''month'' then'
  );

  if position('''30d''' in definition) = 0 then
    raise exception 'could not extend refresh procedure with 30d';
  end if;
  execute definition;
end;
$migration$;
