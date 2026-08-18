-- Preserve trusted billing attribution as part of the legacy hourly identity.
-- Privacy-minimal deployments intentionally omit this table, so migration is conditional.
do $$
declare
  old_constraint record;
  old_index record;
begin
  if to_regclass('public.tokentracker_hourly') is null then
    return;
  end if;

  alter table public.tokentracker_hourly
    add column if not exists billing_mode text default 'unknown';

  update public.tokentracker_hourly
  set billing_mode = 'unknown'
  where billing_mode is null
     or billing_mode not in ('api_key', 'token_plan', 'unknown');

  alter table public.tokentracker_hourly
    alter column billing_mode set default 'unknown',
    alter column billing_mode set not null;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tokentracker_hourly'::regclass
      and conname = 'tokentracker_hourly_billing_mode_check'
  ) then
    alter table public.tokentracker_hourly
      add constraint tokentracker_hourly_billing_mode_check
      check (billing_mode in ('api_key', 'token_plan', 'unknown'));
  end if;

  for old_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.tokentracker_hourly'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by a.attname)
        from unnest(c.conkey) with ordinality as keys(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = keys.attnum
      ) = array['device_id', 'hour_start', 'model', 'source', 'user_id']::name[]
  loop
    execute format('alter table public.tokentracker_hourly drop constraint %I', old_constraint.conname);
  end loop;

  for old_index in
    select indexrelid::regclass::text as index_name
    from pg_index i
    where i.indrelid = 'public.tokentracker_hourly'::regclass
      and i.indisunique
      and not i.indisprimary
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and (
        select array_agg(a.attname order by a.attname)
        from unnest(i.indkey) with ordinality as keys(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = keys.attnum
      ) = array['device_id', 'hour_start', 'model', 'source', 'user_id']::name[]
  loop
    execute format('drop index %s', old_index.index_name);
  end loop;

  create unique index if not exists tokentracker_hourly_billing_identity_uidx
    on public.tokentracker_hourly
      (user_id, device_id, hour_start, source, model, billing_mode);
end
$$;
