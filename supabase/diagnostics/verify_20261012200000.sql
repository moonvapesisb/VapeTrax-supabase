-- =====================================================================
-- Verify migration 20261012200000_shop_links_and_transfers.sql
-- Read-only. Run it AFTER the migration and paste the result back.
-- "all_checks_passed": true means linked shops and stock transfers are in
-- place and locked down. The counts at the end contain no personal data.
-- =====================================================================
with
new_tables (name) as (
  values ('public.shop_links'), ('public.product_links'), ('public.stock_transfers'),
         ('public.stock_transfer_items'), ('private.shop_link_codes'), ('private.shop_link_attempts')
),
app_tables (name) as (
  values ('public.shop_links'), ('public.product_links'), ('public.stock_transfers'),
         ('public.stock_transfer_items')
),
rpcs (sig) as (
  values ('public.create_shop_link_code()'), ('public.link_shop_with_code(text)'),
         ('public.unlink_shop(uuid)'), ('public.list_linked_shops()'),
         ('public.preview_transfer(uuid,text[])'), ('public.transfer_stock(text,uuid,jsonb,text)')
),
fns as (
  select p.oid, n.nspname, p.proname, p.prorettype, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d
                     where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
),
checks as (
  select jsonb_build_object(
    'new_tables_exist_with_rls',
      not exists (select 1 from new_tables t
                  where to_regclass(t.name) is null
                     or not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(t.name))),
    'app_can_only_read_new_tables',
      not exists (select 1 from app_tables t
                  where to_regclass(t.name) is null
                     or not has_table_privilege('authenticated', to_regclass(t.name), 'SELECT')
                     or has_table_privilege('authenticated', to_regclass(t.name), 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
    'link_codes_hidden_from_the_app',
      to_regclass('private.shop_link_codes') is not null
      and not has_table_privilege('authenticated', to_regclass('private.shop_link_codes'), 'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated', to_regclass('private.shop_link_attempts'), 'SELECT,INSERT,UPDATE,DELETE'),
    'one_read_policy_per_new_table',
      (select count(*) from pg_policies p
        where p.schemaname = 'public'
          and p.tablename in ('shop_links', 'product_links', 'stock_transfers', 'stock_transfer_items')
          and p.cmd = 'SELECT' and p.roles = '{authenticated}'::name[]) = 4
      and (select count(*) from pg_policies p
            where p.schemaname = 'public'
              and p.tablename in ('shop_links', 'product_links', 'stock_transfers', 'stock_transfer_items')) = 4,
    'anon_has_no_table_right_on_new_tables',
      not exists (select 1 from new_tables t
                  where to_regclass(t.name) is not null
                    and has_table_privilege('anon', to_regclass(t.name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
    'anon_cannot_run_any_function',
      not exists (select 1 from fns f
                  where f.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
                    and has_function_privilege('anon', f.oid, 'EXECUTE')),
    'every_function_fixes_search_path',
      not exists (select 1 from fns f
                  where f.proname <> 'rls_auto_enable'
                    and not exists (select 1 from unnest(coalesce(f.proconfig, '{}'::text[])) s
                                    where s like 'search_path=%')),
    'transfer_functions_for_logged_in_users_only',
      not exists (select 1 from rpcs r
                  where to_regprocedure(r.sig) is null
                     or not has_function_privilege('authenticated', to_regprocedure(r.sig), 'EXECUTE')
                     or not (select p.prosecdef and p.proacl is not null
                                    and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                               from pg_proc p where p.oid = to_regprocedure(r.sig))),
    'inventory_logs_has_refId',
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'inventory_logs' and column_name = 'refId'),
    'stock_never_negative_rules_present',
      exists (select 1 from pg_constraint
              where conname = 'products_stock_not_negative' and conrelid = 'public.products'::regclass)
      and exists (select 1 from pg_constraint
                  where conname = 'bottles_remaining_not_negative' and conrelid = 'public.bottles'::regclass),
    'safe_retries_and_number_guards',
      to_regprocedure('public.transfer_stock(text,uuid,jsonb,text)') is not null
      and coalesce((select p.prosrc like '%transfer_not_applied%' and p.prosrc like '%transfer_finite%'
                      from pg_proc p
                     where p.oid = to_regprocedure('public.transfer_stock(text,uuid,jsonb,text)')), false),
    'nothing_below_zero',
      not exists (select 1 from public.products where "stockQuantity" < 0)
      and not exists (select 1 from public.bottles where "remainingMl" < 0)
  ) as c
)
select jsonb_pretty(jsonb_build_object(
  'all_checks_passed', not exists (select 1 from jsonb_each(checks.c) e where e.value <> 'true'::jsonb),
  'checks', checks.c,
  'counts', jsonb_build_object(
    'shop_links',      (select count(*) from public.shop_links),
    'stock_transfers', (select count(*) from public.stock_transfers),
    'transfer_lines',  (select count(*) from public.stock_transfer_items),
    'transfer_logs',   (select count(*) from public.inventory_logs where type in ('transfer_out', 'transfer_in'))
  )
))
from checks;
