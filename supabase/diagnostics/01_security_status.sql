-- =====================================================================
-- VapeTrax live DB check 1 of 4: SECURITY STATUS
-- Read-only: this query changes nothing.
--
-- How to run:
--   1. Supabase dashboard -> SQL Editor -> "New query"
--   2. Paste this whole file and click "Run"
--   3. Click the single result cell, copy its JSON and paste it back to Claude
--
-- Shows: whether Row Level Security is ON per table, what the anonymous
-- (not logged in) role can do on each table, which database functions
-- are SECURITY DEFINER and who can execute them, and triggers on auth.users.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'tables', (
    select jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'policy_count', (select count(*) from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname),
      'anon_privileges', concat_ws(',',
        case when has_table_privilege('anon', c.oid, 'SELECT') then 'SELECT' end,
        case when has_table_privilege('anon', c.oid, 'INSERT') then 'INSERT' end,
        case when has_table_privilege('anon', c.oid, 'UPDATE') then 'UPDATE' end,
        case when has_table_privilege('anon', c.oid, 'DELETE') then 'DELETE' end),
      'authenticated_privileges', concat_ws(',',
        case when has_table_privilege('authenticated', c.oid, 'SELECT') then 'SELECT' end,
        case when has_table_privilege('authenticated', c.oid, 'INSERT') then 'INSERT' end,
        case when has_table_privilege('authenticated', c.oid, 'UPDATE') then 'UPDATE' end,
        case when has_table_privilege('authenticated', c.oid, 'DELETE') then 'DELETE' end)
    ) order by c.relname)
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
  ),
  'functions', (
    select jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'settings', p.proconfig,
      'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) order by p.proname)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  ),
  'auth_users_triggers', (
    select jsonb_agg(jsonb_build_object('trigger', t.tgname, 'function', t.tgfoid::regproc::text))
    from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
  )
));
