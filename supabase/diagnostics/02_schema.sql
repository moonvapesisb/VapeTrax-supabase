-- =====================================================================
-- VapeTrax live DB check 2 of 4: SCHEMA (tables, columns, keys, indexes)
-- Read-only: this query changes nothing.
--
-- How to run:
--   1. Supabase dashboard -> SQL Editor -> "New query"
--   2. Paste this whole file and click "Run"
--   3. Click the single result cell, copy its JSON and paste it back to Claude
--
-- Shows: every column (type, nullable, default), every constraint
-- (primary keys, foreign keys, unique, check), every index, triggers,
-- views, enum types, realtime tables, extensions and the Postgres version.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'columns', (
    select jsonb_object_agg(t.table_name, t.cols)
    from (
      select c.table_name,
             jsonb_agg(jsonb_build_object(
               'col', c.column_name,
               'type', c.data_type,
               'nullable', c.is_nullable,
               'default', c.column_default
             ) order by c.ordinal_position) as cols
      from information_schema.columns c
      where c.table_schema = 'public'
      group by c.table_name
    ) t
  ),
  'constraints', (
    select jsonb_agg(jsonb_build_object(
      'table', con.conrelid::regclass::text,
      'name', con.conname,
      'type', con.contype,
      'definition', pg_get_constraintdef(con.oid)
    ) order by con.conrelid::regclass::text, con.conname)
    from pg_constraint con
    where con.connamespace = 'public'::regnamespace
      and con.conrelid <> 0
  ),
  'indexes', (
    select jsonb_agg(jsonb_build_object('table', i.tablename, 'definition', i.indexdef)
                     order by i.tablename, i.indexname)
    from pg_indexes i
    where i.schemaname = 'public'
  ),
  'triggers', (
    select jsonb_agg(jsonb_build_object(
      'table', t.tgrelid::regclass::text,
      'trigger', t.tgname,
      'function', t.tgfoid::regproc::text
    ) order by t.tgrelid::regclass::text, t.tgname)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace
      and not t.tgisinternal
  ),
  'views', (
    select jsonb_agg(v.table_name order by v.table_name)
    from information_schema.views v
    where v.table_schema = 'public'
  ),
  'enum_types', (
    select jsonb_agg(jsonb_build_object(
      'type', ty.typname,
      'values', (select jsonb_agg(e.enumlabel order by e.enumsortorder)
                 from pg_enum e where e.enumtypid = ty.oid)
    ))
    from pg_type ty
    where ty.typnamespace = 'public'::regnamespace
      and ty.typtype = 'e'
  ),
  'realtime_tables', (
    select jsonb_agg(pt.tablename order by pt.tablename)
    from pg_publication_tables pt
    where pt.pubname = 'supabase_realtime'
  ),
  'extensions', (
    select jsonb_agg(jsonb_build_object('name', x.extname, 'version', x.extversion) order by x.extname)
    from pg_extension x
  ),
  'postgres_version', version()
));
