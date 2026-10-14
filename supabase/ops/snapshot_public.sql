-- =====================================================================
-- VapeTrax: take a SNAPSHOT (backup copy) of every table, inside the
-- database, before a risky change.
--
-- What it does:
--   * creates a new schema named app_backup_YYYYMMDD_HHMI (Pakistan time),
--     for example app_backup_20261012_2215;
--   * copies every table of the app (schema public) into it, plus the list
--     of login accounts (auth.users: id, email and created_at only);
--   * removes every permission on the copy, so the app, the public key and
--     logged-in users can never read or change it;
--   * shows the row counts of the copy next to the live tables.
-- It does NOT change, delete or lock any live data.
--
-- The whole file runs as ONE transaction that sees the database at a single
-- moment (repeatable read): every table is copied as it was at that moment,
-- and the counts it shows compare the copy with that same moment. A sale
-- saved while it runs is not in this snapshot (it is in the live tables as
-- usual), and it cannot make the copy half-done or the counts disagree.
--
-- How to run:
--   1. Supabase dashboard -> SQL Editor -> "New query"
--   2. Paste this whole file and click "Run"
--   3. Copy the single result cell and paste it back to Claude.
--      "all_counts_match": true means the copy is complete.
--      "consistent_copy": true means every table was copied at the same
--      moment (see above). If it is false, say so when you paste it back.
--
-- Notes:
--   * Running it twice within the same minute stops with "already exists"
--     and changes nothing: wait a minute and run it again.
--   * Each snapshot takes about as much space as the data itself (the Free
--     plan has 500 MB). Step 1.2 adds supabase/ops/prune_snapshots.sql to
--     list old snapshots and remove the ones you name.
--   * Restoring from a snapshot is a manual, assisted job: ask first.
-- =====================================================================

-- One moment for everything below (must stay the first statement). The SQL
-- Editor runs the pasted file as one transaction.
set transaction isolation level repeatable read;

do $snapshot$
declare
  v_schema text := 'app_backup_' || to_char(now() at time zone 'Asia/Karachi', 'YYYYMMDD_HH24MI');
  v_table  text;
  v_rows   bigint;
begin
  if to_regnamespace(v_schema) is not null then
    raise exception 'A snapshot named % already exists (one was taken less than a minute ago). Wait a minute and run this file again. Nothing was changed.', v_schema;
  end if;

  execute format('create schema %I', v_schema);
  execute format('revoke all on schema %I from public, anon, authenticated, service_role', v_schema);
  execute format('comment on schema %I is %L', v_schema,
    'VapeTrax snapshot taken ' || to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI') ||
    ' (Asia/Karachi) by supabase/ops/snapshot_public.sql. Read-only backup copy; the app never uses it.');

  for v_table in
    select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute format('create table %I.%I as table public.%I', v_schema, v_table, v_table);
    execute format('revoke all on table %I.%I from public, anon, authenticated, service_role', v_schema, v_table);
    execute format('alter table %I.%I enable row level security', v_schema, v_table);
    execute format('select count(*) from %I.%I', v_schema, v_table) into v_rows;
    raise notice '% rows copied from public.%', v_rows, v_table;
  end loop;

  execute format('create table %I.auth_users as select id, email, created_at from auth.users', v_schema);
  execute format('revoke all on table %I.auth_users from public, anon, authenticated, service_role', v_schema);
  execute format('alter table %I.auth_users enable row level security', v_schema);
  execute format('select count(*) from %I.auth_users', v_schema) into v_rows;
  raise notice '% login accounts copied', v_rows;

  raise notice 'Snapshot % is complete.', v_schema;
end
$snapshot$;

-- Result: the newest snapshot's row counts next to the live tables.
with snap as (
  select n.nspname as name
    from pg_namespace n
   where n.nspname ~ '^app_backup_[0-9]{8}_[0-9]{4}$'
   order by n.nspname desc
   limit 1
),
counts as (
  select c.relname as tbl,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname),
                                              false, true, '')))[1]::text::bigint as live_rows,
         case when to_regclass(format('%I.%I', s.name, c.relname)) is not null then
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', s.name, c.relname),
                                                false, true, '')))[1]::text::bigint
         end as snapshot_rows
    from pg_class c cross join snap s
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
)
select jsonb_pretty(jsonb_build_object(
  'snapshot', (select name from snap),
  'consistent_copy', current_setting('transaction_isolation') = 'repeatable read',
  'all_counts_match', (select bool_and(live_rows = snapshot_rows) from counts)
                      and (select count(*) from auth.users) =
                          (select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.auth_users', s.name),
                                                                       false, true, '')))[1]::text::bigint from snap s),
  'login_accounts', jsonb_build_object(
    'live', (select count(*) from auth.users),
    'snapshot', (select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.auth_users', s.name),
                                                             false, true, '')))[1]::text::bigint from snap s)),
  'tables', (select jsonb_agg(jsonb_build_object('table', tbl, 'live_rows', live_rows, 'snapshot_rows', snapshot_rows)
                              order by tbl) from counts)
)) as snapshot_result;
