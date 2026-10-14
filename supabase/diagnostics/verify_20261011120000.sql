-- =====================================================================
-- Verify migration 20261011120000_emergency_security_lockdown.sql
-- Read-only. Run it AFTER the migration and paste the result back.
-- "all_checks_passed": true means the lockdown is in place.
-- =====================================================================
with checks as (
  select jsonb_build_object(
    'profiles_rls_enabled',
      (select c.relrowsecurity from pg_class c where c.oid = 'public.profiles'::regclass),
    'anon_has_no_table_access',
      not exists (
        select 1 from pg_class c
        where c.relnamespace = 'public'::regnamespace
          and c.relkind in ('r', 'p')
          and (has_table_privilege('anon', c.oid, 'SELECT')
            or has_table_privilege('anon', c.oid, 'INSERT')
            or has_table_privilege('anon', c.oid, 'UPDATE')
            or has_table_privilege('anon', c.oid, 'DELETE'))),
    'anon_cannot_run_process_functions',
      not exists (
        select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname like 'process\_%'
          and has_function_privilege('anon', p.oid, 'EXECUTE')),
    'logged_in_users_can_run_process_functions',
      not exists (
        select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname like 'process\_%'
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    'process_functions_have_fixed_search_path',
      not exists (
        select 1 from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname like 'process\_%'
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) s
                          where s like 'search_path=%')),
    'single_process_stock_adjustment',
      (select count(*) = 1 from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'process_stock_adjustment'),
    'profiles_role_not_editable',
      not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
    'profiles_shopId_not_editable',
      not has_column_privilege('authenticated', 'public.profiles', 'shopId', 'UPDATE'),
    'profiles_username_editable',
      has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE'),
    'no_allow_everyone_policies',
      not exists (select 1 from pg_policies
                  where schemaname = 'public' and (qual = 'true' or with_check = 'true')),
    'profiles_updatedAt_exists',
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'updatedAt'),
    'expenses_updatedAt_exists',
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'expenses' and column_name = 'updatedAt'),
    'helper_function_exists',
      to_regprocedure('private.is_shop_member(uuid)') is not null
  ) as c
)
select jsonb_pretty(jsonb_build_object(
  'all_checks_passed', not exists (select 1 from jsonb_each(checks.c) e where e.value <> 'true'::jsonb),
  'checks', checks.c,
  'profiles_policies', (
    select jsonb_agg(jsonb_build_object('policy', p.policyname, 'cmd', p.cmd) order by p.policyname)
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'profiles')
))
from checks;
