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

  -- v1 is owned by older cloud deployments and its body is not part of this
  -- repository. Keep it untouched; account edges opt into this auditable v2.
  execute $function$
    create or replace function public.account_usage_grouped_v2(
      p_user_id text,
      p_device_ids text[],
      p_from timestamptz,
      p_to timestamptz,
      p_trunc text,
      p_tz text,
      p_offset_min integer
    ) returns jsonb
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      with filtered as (
        select
          h.device_id::text as device_id,
          h.hour_start,
          coalesce(h.source, 'unknown') as source,
          coalesce(h.model, 'unknown') as model,
          case
            when h.billing_mode in ('api_key', 'token_plan') then h.billing_mode
            else 'unknown'
          end as billing_mode,
          coalesce(h.total_tokens, 0) as total_tokens,
          coalesce(h.input_tokens, 0) as input_tokens,
          coalesce(h.output_tokens, 0) as output_tokens,
          coalesce(h.cached_input_tokens, 0) as cached_input_tokens,
          coalesce(h.cache_creation_input_tokens, 0) as cache_creation_input_tokens,
          coalesce(h.reasoning_output_tokens, 0) as reasoning_output_tokens,
          coalesce(h.conversations, 0) as conversations
        from public.tokentracker_hourly h
        where h.user_id::text = p_user_id
          and h.hour_start >= p_from
          and h.hour_start < p_to
          and (h.source = 'cursor' or h.device_id::text = any(coalesce(p_device_ids, array[]::text[])))
      ), account_ranked as (
        select
          f.*,
          row_number() over (
            partition by f.source, f.model, f.hour_start, f.billing_mode
            order by f.total_tokens desc, f.device_id
          ) as account_rank
        from filtered f
        where f.source = 'cursor'
      ), canonical as (
        select
          device_id, hour_start, source, model, billing_mode,
          total_tokens, input_tokens, output_tokens, cached_input_tokens,
          cache_creation_input_tokens, reasoning_output_tokens, conversations
        from account_ranked
        where account_rank = 1
        union all
        select
          device_id, hour_start, source, model, billing_mode,
          total_tokens, input_tokens, output_tokens, cached_input_tokens,
          cache_creation_input_tokens, reasoning_output_tokens, conversations
        from filtered
        where source <> 'cursor'
      ), bucketed as (
        select
          case p_trunc
            when 'hour' then to_char(date_trunc('hour', local_time), 'YYYY-MM-DD"T"HH24:00:00')
            when 'day' then to_char(date_trunc('day', local_time), 'YYYY-MM-DD')
            when 'month' then to_char(date_trunc('month', local_time), 'YYYY-MM')
            else to_char(local_time, 'YYYY-MM-DD"T"HH24:MI:SS')
          end as bucket,
          source, model, billing_mode,
          total_tokens, input_tokens, output_tokens, cached_input_tokens,
          cache_creation_input_tokens, reasoning_output_tokens, conversations
        from (
          select
            c.*,
            case
              when nullif(p_tz, '') is not null then c.hour_start at time zone p_tz
              else (c.hour_start at time zone 'UTC')
                + make_interval(mins => coalesce(p_offset_min, 0))
            end as local_time
          from canonical c
        ) localized
      ), grouped as (
        select
          bucket, source, model, billing_mode,
          sum(total_tokens) as total_tokens,
          sum(input_tokens) as input_tokens,
          sum(output_tokens) as output_tokens,
          sum(cached_input_tokens) as cached_input_tokens,
          sum(cache_creation_input_tokens) as cache_creation_input_tokens,
          sum(reasoning_output_tokens) as reasoning_output_tokens,
          sum(conversations) as conversations
        from bucketed
        group by bucket, source, model, billing_mode
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'bucket', bucket,
            'source', source,
            'model', model,
            'billing_mode', billing_mode,
            'total_tokens', total_tokens,
            'input_tokens', input_tokens,
            'output_tokens', output_tokens,
            'cached_input_tokens', cached_input_tokens,
            'cache_creation_input_tokens', cache_creation_input_tokens,
            'reasoning_output_tokens', reasoning_output_tokens,
            'conversations', conversations
          ) order by bucket, source, model, billing_mode
        ),
        '[]'::jsonb
      )
      from grouped
    $body$
  $function$;
end
$$;
