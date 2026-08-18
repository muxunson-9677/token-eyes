-- Rolling-safe attribution: retain the legacy five-column row identity and
-- add an optional extension. Old ingest ignores it; rollback leaves it intact.
do $$
begin
  if to_regclass('public.tokentracker_hourly') is null then return; end if;

  alter table public.tokentracker_hourly add column if not exists billing_mode_slices jsonb;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.tokentracker_hourly'::regclass
      and conname = 'tokentracker_hourly_billing_mode_slices_check'
  ) then
    alter table public.tokentracker_hourly add constraint tokentracker_hourly_billing_mode_slices_check
      check (billing_mode_slices is null or (jsonb_typeof(billing_mode_slices) = 'object'
        and billing_mode_slices - 'api_key' - 'token_plan' - 'unknown' = '{}'::jsonb)) not valid;
  end if;

  execute $fn$
    create or replace function public.tokentracker_hourly_ingest_v3(
      p_user_id text, p_device_id text, p_rows jsonb
    ) returns integer language plpgsql security definer set search_path = pg_catalog, public as $body$
    declare r record; lock_row record; slices jsonb; legacy jsonb; t record; incoming record;
      base_key text; processed_snapshots text[] := array[]::text[];
      v_user_id uuid; v_device_id uuid; affected integer := 0;
    begin
      begin
        v_user_id := p_user_id::uuid;
        v_device_id := p_device_id::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid token tracker uuid' using errcode = '22023';
      end;
      -- Acquire every base lock in one deterministic order. Opposite row
      -- orders in concurrent batches therefore cannot deadlock.
      for lock_row in
        select distinct concat_ws(E'\x1f',v_user_id::text,v_device_id::text,
          extract(epoch from x.hour_start)::text,coalesce(x.source,'unknown'),coalesce(x.model,'unknown')) lock_key
        from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(hour_start timestamptz,source text,model text)
        order by lock_key
      loop
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_row.lock_key,0));
      end loop;
      for r in select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
        hour_start timestamptz, source text, model text, billing_mode text, billing_mode_snapshot boolean,
        input_tokens bigint, cached_input_tokens bigint, cache_creation_input_tokens bigint,
        output_tokens bigint, reasoning_output_tokens bigint, total_tokens bigint,
        billable_total_tokens bigint, total_cost_usd numeric, conversations bigint)
      loop
        base_key := concat_ws(E'\x1f',extract(epoch from r.hour_start)::text,r.source,r.model);
        if coalesce(r.billing_mode_snapshot,false) then
          if base_key=any(processed_snapshots) then continue; end if;
          processed_snapshots := array_append(processed_snapshots,base_key);
          select jsonb_object_agg(case when x.billing_mode in ('api_key','token_plan') then x.billing_mode else 'unknown' end,
            jsonb_build_object('input_tokens',coalesce(x.input_tokens,0),'cached_input_tokens',coalesce(x.cached_input_tokens,0),
              'cache_creation_input_tokens',coalesce(x.cache_creation_input_tokens,0),'output_tokens',coalesce(x.output_tokens,0),
              'reasoning_output_tokens',coalesce(x.reasoning_output_tokens,0),'total_tokens',coalesce(x.total_tokens,0),
              'billable_total_tokens',coalesce(x.billable_total_tokens,x.total_tokens,0),'total_cost_usd',coalesce(x.total_cost_usd,0),
              'conversations',coalesce(x.conversations,0))) into slices
          from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(hour_start timestamptz,source text,model text,
            billing_mode text,billing_mode_snapshot boolean,input_tokens bigint,cached_input_tokens bigint,
            cache_creation_input_tokens bigint,output_tokens bigint,reasoning_output_tokens bigint,total_tokens bigint,
            billable_total_tokens bigint,total_cost_usd numeric,conversations bigint)
          where coalesce(x.billing_mode_snapshot,false) and x.hour_start=r.hour_start
            and coalesce(x.source,'unknown')=r.source and coalesce(x.model,'unknown')=r.model;
        else
          select h.billing_mode_slices, jsonb_build_object(
          'input_tokens', coalesce(h.input_tokens,0), 'cached_input_tokens', coalesce(h.cached_input_tokens,0),
          'cache_creation_input_tokens', coalesce(h.cache_creation_input_tokens,0), 'output_tokens', coalesce(h.output_tokens,0),
          'reasoning_output_tokens', coalesce(h.reasoning_output_tokens,0), 'total_tokens', coalesce(h.total_tokens,0),
          'billable_total_tokens', coalesce(h.billable_total_tokens,h.total_tokens,0),
          'total_cost_usd', coalesce(h.total_cost_usd,0), 'conversations', coalesce(h.conversations,0))
          into slices, legacy from public.tokentracker_hourly h
        where h.user_id=v_user_id and h.device_id=v_device_id and h.hour_start=r.hour_start
          and h.source=r.source and h.model=r.model for update;
        if slices is not null then
          select sum(coalesce((v->>'input_tokens')::bigint,0)) input_tokens,
            sum(coalesce((v->>'cached_input_tokens')::bigint,0)) cached_input_tokens,
            sum(coalesce((v->>'cache_creation_input_tokens')::bigint,0)) cache_creation_input_tokens,
            sum(coalesce((v->>'output_tokens')::bigint,0)) output_tokens,
            sum(coalesce((v->>'reasoning_output_tokens')::bigint,0)) reasoning_output_tokens,
            sum(coalesce((v->>'total_tokens')::bigint,0)) total_tokens,
            sum(coalesce((v->>'billable_total_tokens')::bigint,0)) billable_total_tokens,
            sum(coalesce((v->>'total_cost_usd')::numeric,0)) total_cost_usd,
            sum(coalesce((v->>'conversations')::bigint,0)) conversations into t from jsonb_each(slices)e(k,v);
          if coalesce(t.input_tokens,0) <> coalesce((legacy->>'input_tokens')::bigint,0)
            or coalesce(t.cached_input_tokens,0) <> coalesce((legacy->>'cached_input_tokens')::bigint,0)
            or coalesce(t.cache_creation_input_tokens,0) <> coalesce((legacy->>'cache_creation_input_tokens')::bigint,0)
            or coalesce(t.output_tokens,0) <> coalesce((legacy->>'output_tokens')::bigint,0)
            or coalesce(t.reasoning_output_tokens,0) <> coalesce((legacy->>'reasoning_output_tokens')::bigint,0)
            or coalesce(t.total_tokens,0) <> coalesce((legacy->>'total_tokens')::bigint,0)
            or coalesce(t.billable_total_tokens,0) <> coalesce((legacy->>'billable_total_tokens')::bigint,0)
            or coalesce(t.total_cost_usd,0) <> coalesce((legacy->>'total_cost_usd')::numeric,0)
            or coalesce(t.conversations,0) <> coalesce((legacy->>'conversations')::bigint,0)
          then slices := null; end if;
        end if;
        if slices is null then
          select sum(coalesce(x.input_tokens,0)) input_tokens,sum(coalesce(x.cached_input_tokens,0)) cached_input_tokens,
            sum(coalesce(x.cache_creation_input_tokens,0)) cache_creation_input_tokens,sum(coalesce(x.output_tokens,0)) output_tokens,
            sum(coalesce(x.reasoning_output_tokens,0)) reasoning_output_tokens,sum(coalesce(x.total_tokens,0)) total_tokens,
            sum(coalesce(x.billable_total_tokens,x.total_tokens,0)) billable_total_tokens,
            sum(coalesce(x.total_cost_usd,0)) total_cost_usd,sum(coalesce(x.conversations,0)) conversations into incoming
          from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(hour_start timestamptz,source text,model text,billing_mode_snapshot boolean,
            input_tokens bigint,cached_input_tokens bigint,cache_creation_input_tokens bigint,output_tokens bigint,
            reasoning_output_tokens bigint,total_tokens bigint,billable_total_tokens bigint,total_cost_usd numeric,conversations bigint)
          where not coalesce(x.billing_mode_snapshot,false) and x.hour_start=r.hour_start
            and coalesce(x.source,'unknown')=r.source and coalesce(x.model,'unknown')=r.model;
          slices := case when legacy is null then '{}'::jsonb
            when coalesce(incoming.input_tokens,0)=coalesce((legacy->>'input_tokens')::bigint,0)
              and coalesce(incoming.cached_input_tokens,0)=coalesce((legacy->>'cached_input_tokens')::bigint,0)
              and coalesce(incoming.cache_creation_input_tokens,0)=coalesce((legacy->>'cache_creation_input_tokens')::bigint,0)
              and coalesce(incoming.output_tokens,0)=coalesce((legacy->>'output_tokens')::bigint,0)
              and coalesce(incoming.reasoning_output_tokens,0)=coalesce((legacy->>'reasoning_output_tokens')::bigint,0)
              and coalesce(incoming.total_tokens,0)=coalesce((legacy->>'total_tokens')::bigint,0)
              and coalesce(incoming.billable_total_tokens,0)=coalesce((legacy->>'billable_total_tokens')::bigint,0)
              and coalesce(incoming.total_cost_usd,0)=coalesce((legacy->>'total_cost_usd')::numeric,0)
              and coalesce(incoming.conversations,0)=coalesce((legacy->>'conversations')::bigint,0) then '{}'::jsonb
            else jsonb_build_object('unknown',legacy) end;
        end if;
        slices := slices || jsonb_build_object(case when r.billing_mode in ('api_key','token_plan') then r.billing_mode else 'unknown' end,
          jsonb_build_object('input_tokens',coalesce(r.input_tokens,0),'cached_input_tokens',coalesce(r.cached_input_tokens,0),
            'cache_creation_input_tokens',coalesce(r.cache_creation_input_tokens,0),'output_tokens',coalesce(r.output_tokens,0),
            'reasoning_output_tokens',coalesce(r.reasoning_output_tokens,0),'total_tokens',coalesce(r.total_tokens,0),
            'billable_total_tokens',coalesce(r.billable_total_tokens,r.total_tokens,0),'total_cost_usd',coalesce(r.total_cost_usd,0),
            'conversations',coalesce(r.conversations,0)));
        end if;
        select sum(coalesce((v->>'input_tokens')::bigint,0)) input_tokens,
          sum(coalesce((v->>'cached_input_tokens')::bigint,0)) cached_input_tokens,
          sum(coalesce((v->>'cache_creation_input_tokens')::bigint,0)) cache_creation_input_tokens,
          sum(coalesce((v->>'output_tokens')::bigint,0)) output_tokens,
          sum(coalesce((v->>'reasoning_output_tokens')::bigint,0)) reasoning_output_tokens,
          sum(coalesce((v->>'total_tokens')::bigint,0)) total_tokens,
          sum(coalesce((v->>'billable_total_tokens')::bigint,0)) billable_total_tokens,
          sum(coalesce((v->>'total_cost_usd')::numeric,0)) total_cost_usd,
          sum(coalesce((v->>'conversations')::bigint,0)) conversations into t from jsonb_each(slices) e(k,v);
        insert into public.tokentracker_hourly(user_id,device_id,hour_start,source,model,input_tokens,cached_input_tokens,
          cache_creation_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,billable_total_tokens,total_cost_usd,conversations,billing_mode_slices)
        values(v_user_id,v_device_id,r.hour_start,r.source,r.model,t.input_tokens,t.cached_input_tokens,
          t.cache_creation_input_tokens,t.output_tokens,t.reasoning_output_tokens,t.total_tokens,t.billable_total_tokens,t.total_cost_usd,t.conversations,slices)
        on conflict (user_id,device_id,hour_start,source,model) do update set
          input_tokens=excluded.input_tokens,cached_input_tokens=excluded.cached_input_tokens,
          cache_creation_input_tokens=excluded.cache_creation_input_tokens,output_tokens=excluded.output_tokens,
          reasoning_output_tokens=excluded.reasoning_output_tokens,total_tokens=excluded.total_tokens,
          billable_total_tokens=excluded.billable_total_tokens,total_cost_usd=excluded.total_cost_usd,
          conversations=excluded.conversations,billing_mode_slices=excluded.billing_mode_slices;
        affected := affected + 1;
      end loop; return affected;
    end $body$
  $fn$;

  execute $fn$
    create or replace function public.account_usage_grouped_v2(p_user_id text,p_device_ids text[],p_from timestamptz,
      p_to timestamptz,p_trunc text,p_tz text,p_offset_min integer) returns jsonb
    language plpgsql stable security definer set search_path = pg_catalog, public as $body$
    declare v_user_id uuid; v_device_ids uuid[]; result jsonb;
    begin
      begin
        v_user_id := p_user_id::uuid;
        v_device_ids := coalesce(p_device_ids,array[]::text[])::uuid[];
      exception when invalid_text_representation then
        raise exception 'invalid token tracker uuid' using errcode = '22023';
      end;
      with f as (select h.device_id::text device_id,h.hour_start,coalesce(h.source,'unknown') source,coalesce(h.model,'unknown') model,
        h.billing_mode_slices,coalesce(h.total_tokens,0) total_tokens,coalesce(h.billable_total_tokens,h.total_tokens,0) billable_total_tokens,
        coalesce(h.total_cost_usd,0) total_cost_usd,coalesce(h.input_tokens,0) input_tokens,
        coalesce(h.output_tokens,0) output_tokens,coalesce(h.cached_input_tokens,0) cached_input_tokens,
        coalesce(h.cache_creation_input_tokens,0) cache_creation_input_tokens,
        coalesce(h.reasoning_output_tokens,0) reasoning_output_tokens,coalesce(h.conversations,0) conversations
        from public.tokentracker_hourly h where h.user_id=v_user_id and h.hour_start>=p_from and h.hour_start<p_to
          and (h.source='cursor' or h.device_id=any(v_device_ids))),
      ranked as (select f.*,row_number() over(partition by source,model,hour_start order by total_tokens desc,device_id) rn from f where source='cursor'),
      canonical as (select * from ranked where rn=1 union all select f.*,1 rn from f where source<>'cursor'),
      b as (select case p_trunc when 'hour' then to_char(date_trunc('hour',lt),'YYYY-MM-DD"T"HH24:00:00')
          when 'day' then to_char(date_trunc('day',lt),'YYYY-MM-DD') when 'month' then to_char(date_trunc('month',lt),'YYYY-MM')
          else to_char(lt,'YYYY-MM-DD"T"HH24:MI:SS') end bucket,c.*,
        case when billing_mode_slices is null
          or coalesce(st.total_tokens,0) <> total_tokens
          or coalesce(st.billable_total_tokens,0) <> billable_total_tokens
          or coalesce(st.input_tokens,0) <> input_tokens
          or coalesce(st.output_tokens,0) <> output_tokens
          or coalesce(st.cached_input_tokens,0) <> cached_input_tokens
          or coalesce(st.cache_creation_input_tokens,0) <> cache_creation_input_tokens
          or coalesce(st.reasoning_output_tokens,0) <> reasoning_output_tokens
          or coalesce(st.total_cost_usd,0) <> total_cost_usd
          or coalesce(st.conversations,0) <> conversations
          then jsonb_build_object('api_key',0,'token_plan',0,'unknown',total_tokens)
          else jsonb_build_object('api_key',coalesce((billing_mode_slices->'api_key'->>'total_tokens')::bigint,0),
            'token_plan',coalesce((billing_mode_slices->'token_plan'->>'total_tokens')::bigint,0),
            'unknown',coalesce((billing_mode_slices->'unknown'->>'total_tokens')::bigint,0)) end mt
        from (select c.*,case when nullif(p_tz,'') is not null then c.hour_start at time zone p_tz
          else (c.hour_start at time zone 'UTC')+make_interval(mins=>coalesce(p_offset_min,0)) end lt from canonical c)c
        left join lateral (select sum(coalesce((v->>'total_tokens')::bigint,0)) total_tokens,
          sum(coalesce((v->>'billable_total_tokens')::bigint,0)) billable_total_tokens,
          sum(coalesce((v->>'input_tokens')::bigint,0)) input_tokens,sum(coalesce((v->>'output_tokens')::bigint,0)) output_tokens,
          sum(coalesce((v->>'cached_input_tokens')::bigint,0)) cached_input_tokens,
          sum(coalesce((v->>'cache_creation_input_tokens')::bigint,0)) cache_creation_input_tokens,
          sum(coalesce((v->>'reasoning_output_tokens')::bigint,0)) reasoning_output_tokens,
          sum(coalesce((v->>'total_cost_usd')::numeric,0)) total_cost_usd,
          sum(coalesce((v->>'conversations')::bigint,0)) conversations
          from jsonb_each(c.billing_mode_slices)e(k,v))st on true),
      g as (select bucket,source,model,sum(total_tokens) total_tokens,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,
        sum(cached_input_tokens) cached_input_tokens,sum(cache_creation_input_tokens) cache_creation_input_tokens,
        sum(reasoning_output_tokens) reasoning_output_tokens,sum(conversations) conversations,
        jsonb_build_object('api_key',sum((mt->>'api_key')::bigint),'token_plan',sum((mt->>'token_plan')::bigint),
          'unknown',sum((mt->>'unknown')::bigint)) billing_mode_token_totals from b group by bucket,source,model)
      select coalesce(jsonb_agg(to_jsonb(g) order by bucket,source,model),'[]'::jsonb) into result from g;
      return result;
    end;
    $body$
  $fn$;

  revoke all on function public.tokentracker_hourly_ingest_v3(text,text,jsonb) from public,anon,authenticated;
  grant execute on function public.tokentracker_hourly_ingest_v3(text,text,jsonb) to service_role;
  revoke all on function public.account_usage_grouped_v2(text,text[],timestamptz,timestamptz,text,text,integer) from public,anon,authenticated;
  grant execute on function public.account_usage_grouped_v2(text,text[],timestamptz,timestamptz,text,text,integer) to service_role;
end $$;
