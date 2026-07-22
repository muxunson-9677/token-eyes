-- Keep cloud ranking totals on the same basis as Token Eyes' local usage view:
-- Codex / Every Code reasoning tokens are informational subsets, not an
-- additional amount to add to their displayed total.
do $migration$
declare
  previous_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.refresh_leaderboard_snapshots(boolean,boolean)'::regprocedure
  ) into previous_definition;

  updated_definition := replace(
    previous_definition,
    '+ grouped.reasoning_output_tokens',
    '+ case
            when grouped.source in (''codex'', ''every-code'') then 0
            else grouped.reasoning_output_tokens
          end'
  );

  if updated_definition = previous_definition then
    raise exception 'refresh_leaderboard_snapshots token-total expression was not found';
  end if;

  execute updated_definition;
end;
$migration$;
