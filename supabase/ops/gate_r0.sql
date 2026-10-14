-- =====================================================================
-- VapeTrax: R0 release gate (step 0.7).
--
-- Read-only: it changes nothing.
--
-- After the R0 app version is deployed, every POS device should move to
-- it. The server counts each sale and each sale delete per app build in
-- private.legacy_rpc_calls (created by migration
-- 20261012100000_lockdown_followup.sql). An app too old to say which
-- build it is shows up as the build 'unknown'.
--
-- This file lists those counts per build for the last 7 days (today and
-- the 6 days before it, Pakistan time). The gate PASSES when calls were
-- recorded and none of them came from an 'unknown' build, which means
-- every device that sold something is on R0 or later.
--
-- How to run (about 7 days after the R0 release):
--   1. Supabase dashboard -> SQL Editor -> "New query"
--   2. Paste this whole file and click "Run"
--   3. Copy the single result cell and paste it back.
--      "passed": true means the gate is passed.
--      If it is false, "verdict" says why and what to do.
-- =====================================================================

do $gate$
declare
  v_window_end   date := (now() at time zone 'Asia/Karachi')::date;
  v_window_start date := (now() at time zone 'Asia/Karachi')::date - 6;
  v_day     text;
  v_build   text;
  v_fn      text;
  v_device  text;
  v_shop    text;
  v_calls   text;
  v_report  jsonb;
  v_total   bigint;
  v_unknown bigint;
  v_result  jsonb;
begin
  if to_regclass('private.legacy_rpc_calls') is null then
    v_result := jsonb_build_object(
      'passed', false,
      'verdict', 'NOT READY: private.legacy_rpc_calls does not exist yet. Apply migration 20261012100000_lockdown_followup.sql first.');
  else
    -- Find each column by name, whether it is written "clientBuild" or client_build.
    select
      max(c.column_name) filter (where lower(replace(c.column_name, '_', '')) = 'day'),
      max(c.column_name) filter (where lower(replace(c.column_name, '_', '')) = 'clientbuild'),
      max(c.column_name) filter (where lower(replace(c.column_name, '_', '')) = 'fn'),
      max(c.column_name) filter (where lower(replace(c.column_name, '_', '')) = 'deviceid'),
      max(c.column_name) filter (where lower(replace(c.column_name, '_', '')) = 'shopid'),
      max(c.column_name) filter (where lower(replace(c.column_name, '_', '')) = 'calls')
      into v_day, v_build, v_fn, v_device, v_shop, v_calls
      from information_schema.columns c
     where c.table_schema = 'private' and c.table_name = 'legacy_rpc_calls';

    if v_day is null or v_build is null then
      v_result := jsonb_build_object(
        'passed', false,
        'verdict', 'CANNOT CHECK: private.legacy_rpc_calls has no day or clientBuild column. Send this result to the developer.',
        'columns', (select jsonb_agg(c.column_name order by c.ordinal_position)
                      from information_schema.columns c
                     where c.table_schema = 'private' and c.table_name = 'legacy_rpc_calls'));
    else
      execute format($q$
        with w as (
          select coalesce(nullif(btrim(%1$s::text), ''), 'unknown') as build,
                 %2$s::date as day,
                 coalesce(%3$s::text, '?') as fn,
                 %4$s::text as device,
                 %5$s::text as shop,
                 coalesce(%6$s, 1)::bigint as calls
            from private.legacy_rpc_calls
           where %2$s::date between $1 and $2
        ),
        per_fn as (
          select build, jsonb_object_agg(fn, n order by fn) as by_function
            from (select build, fn, sum(calls)::bigint as n from w group by build, fn) x
           group by build
        ),
        per_build as (
          select build,
                 sum(calls)::bigint as calls,
                 count(distinct device) as devices,
                 count(distinct shop) as shops,
                 count(distinct day) as days_seen,
                 min(day) as first_day,
                 max(day) as last_day
            from w
           group by build
        )
        select jsonb_build_object(
          'total_calls', coalesce((select sum(calls) from w), 0),
          'unknown_calls', coalesce((select sum(calls) from w where lower(build) = 'unknown'), 0),
          'builds', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'build', b.build,
                     'calls', b.calls,
                     'devices', b.devices,
                     'shops', b.shops,
                     'days_seen', b.days_seen,
                     'first_day', b.first_day,
                     'last_day', b.last_day,
                     'by_function', f.by_function)
                   order by b.last_day desc, b.calls desc)
              from per_build b
              left join per_fn f using (build)), '[]'::jsonb))
      $q$,
        quote_ident(v_build),
        quote_ident(v_day),
        coalesce(quote_ident(v_fn), 'null'),
        coalesce(quote_ident(v_device), 'null'),
        coalesce(quote_ident(v_shop), 'null'),
        coalesce(quote_ident(v_calls), 'null'))
      into v_report
      using v_window_start, v_window_end;

      v_total   := (v_report ->> 'total_calls')::bigint;
      v_unknown := (v_report ->> 'unknown_calls')::bigint;

      v_result := jsonb_build_object(
        'passed', v_total > 0 and v_unknown = 0,
        'verdict', case
          when v_total = 0 then
            'NOT YET: no sale or sale delete reached the server in these 7 days, so nothing can be checked. Run it again after a few days of sales.'
          when v_unknown > 0 then
            'NOT YET: ' || v_unknown || ' call(s) came from an old app version (build unknown). Open the app once on every POS device, wait a few days, and run this again.'
          else
            'PASSED: every call in these 7 days came from an app build that identifies itself (R0 or later).'
        end,
        'window', jsonb_build_object('from', v_window_start, 'to', v_window_end, 'time_zone', 'Asia/Karachi'),
        'checked_at', to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI'),
        'total_calls', v_total,
        'unknown_calls', v_unknown,
        'builds', v_report -> 'builds');
    end if;
  end if;

  perform set_config('vapetrax.gate_r0', v_result::text, false);
end
$gate$;

select jsonb_pretty(current_setting('vapetrax.gate_r0')::jsonb) as gate_r0;
