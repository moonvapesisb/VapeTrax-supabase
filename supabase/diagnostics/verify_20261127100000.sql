-- =====================================================================
-- Verify migration 20261127100000_cash_and_bank_management.sql
-- Read-only. Run AFTER the migration and paste the JSON result back.
-- "all_checks_passed": true means Cash & Bank accounts, ledger,
-- RLS, Realtime publication, and RPCs are in place and locked down.
-- =====================================================================
with
rpcs (sig) as (
  values
    ('public.ensure_shop_finance_accounts(uuid)'),
    ('public.create_finance_account(text,uuid,text,text,text,text,numeric,text)'),
    ('public.update_finance_account(text,text,text,text)'),
    ('public.archive_finance_account(text)'),
    ('public.record_opening_balance(text,uuid,text,numeric,text,timestamptz)'),
    ('public.transfer_funds(text,text,text,uuid,text,text,numeric,text,text,timestamptz)'),
    ('public.record_payout(text,uuid,text,numeric,text,text,text,text,timestamptz)'),
    ('public.record_expense(text,text,uuid,text,text,numeric,timestamptz,text)'),
    ('public.update_expense(text,uuid,text,text,numeric,timestamptz,text,text,text)'),
    ('public.delete_expense(text,uuid,text)'),
    ('public.record_credit_payment(text,text,uuid,text,numeric,text,text)'),
    ('public.reverse_finance_transaction(text,uuid,text,text,timestamptz)'),
    ('public.get_linked_shops_finance_summary()'),
    ('public.process_checkout(text,jsonb,jsonb,jsonb,jsonb,text,numeric)'),
    ('public.process_reversal(uuid,text,boolean,jsonb,jsonb,jsonb,text,numeric)')
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
snap_diff as (
  select
    (select definition from private.function_snapshots
      where label = 'pre_20261127100000'
        and signature = 'public.process_checkout(text,jsonb,jsonb,jsonb,jsonb,text,numeric)') as co_old,
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(to_regprocedure('public.process_checkout(text,jsonb,jsonb,jsonb,jsonb,text,numeric)')),
      $re$\r??\n[ \t]*?-- \[FINANCE_START\].*?-- \[FINANCE_END\]$re$, '', 'g'
    ) as co_stripped,
    (select definition from private.function_snapshots
      where label = 'pre_20261127100000'
        and signature = 'public.process_reversal(uuid,text,boolean,jsonb,jsonb,jsonb,text,numeric)') as rev_old,
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_functiondef(to_regprocedure('public.process_reversal(uuid,text,boolean,jsonb,jsonb,jsonb,text,numeric)')),
      $re$\r??\n[ \t]*?-- \[FINANCE_START\].*?-- \[FINANCE_END\]$re$, '', 'g'
    ) as rev_stripped
),
checks as (
  select jsonb_build_object(
    'finance_columns_match_plan',
      (select count(*) = 7 from information_schema.columns
        where table_schema = 'public' and table_name = 'finance_accounts'
          and column_name in ('ownerShopId', 'bankName', 'accountNumber', 'isOverdrawn', 'isArchived', 'archivedAt', 'updatedAt'))
      and (select count(*) = 12 from information_schema.columns
            where table_schema = 'public' and table_name = 'finance_transactions'
              and column_name in ('ownerShopId', 'counterpartyAccountId', 'direction', 'transferId', 'category', 'paidTo',
                                  'notes', 'actorName', 'actorRole', 'createdBy', 'occurredAt', 'updatedAt'))
      and not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'finance_transactions'
                         and column_name = 'balanceAfter')
      and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'expenses' and column_name = 'paidFromAccountId')
      and (select count(*) = 2 from information_schema.columns
            where table_schema = 'public' and table_name = 'credits'
              and column_name in ('paymentMethod', 'accountId')),

    'finance_constraints_and_indexes',
      exists (select 1 from pg_constraint where conname = 'finance_accounts_overdrawn_sync' and conrelid = 'public.finance_accounts'::regclass)
      and exists (select 1 from pg_constraint where conname = 'finance_transactions_amount_positive_int' and conrelid = 'public.finance_transactions'::regclass)
      and exists (select 1 from pg_indexes
                   where schemaname = 'public' and tablename = 'finance_accounts'
                     and indexname = 'finance_accounts_one_cash_per_shop')
      and exists (select 1 from pg_indexes
                   where schemaname = 'public' and tablename = 'finance_accounts'
                     and indexname = 'finance_accounts_one_primary_per_shop')
      and exists (select 1 from pg_indexes
                   where schemaname = 'public' and tablename = 'finance_transactions'
                     and indexname = 'finance_transactions_single_ref_unique'
                     and indexdef not like '%expense%'
                     and indexdef like '%credit%'
                     and indexdef like '%opening%'
                     and indexdef like '%adjustment%'),

    'finance_tables_select_only_for_authenticated',
      has_table_privilege('authenticated', 'public.finance_accounts', 'SELECT')
      and not has_table_privilege('authenticated', 'public.finance_accounts', 'INSERT,UPDATE,DELETE,TRUNCATE')
      and has_table_privilege('authenticated', 'public.finance_transactions', 'SELECT')
      and not has_table_privilege('authenticated', 'public.finance_transactions', 'INSERT,UPDATE,DELETE,TRUNCATE')
      and (select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename in ('finance_accounts', 'finance_transactions')
              and p.cmd = 'SELECT' and p.roles = '{authenticated}'::name[]) = 2
      and (select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename in ('finance_accounts', 'finance_transactions')) = 2,

    'finance_triggers_present',
      exists (select 1 from pg_trigger t
               where t.tgrelid = 'public.finance_transactions'::regclass
                 and t.tgname = 'finance_transactions_before_insert' and not t.tgisinternal)
      and exists (select 1 from pg_trigger t
                   where t.tgrelid = 'public.finance_transactions'::regclass
                     and t.tgname = 'finance_transactions_after_insert' and not t.tgisinternal)
      and exists (select 1 from pg_trigger t
                   where t.tgrelid = 'public.finance_transactions'::regclass
                     and t.tgname = 'finance_transactions_append_only' and not t.tgisinternal),

    'anon_has_no_finance_access',
      not has_table_privilege('anon', 'public.finance_accounts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('anon', 'public.finance_transactions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not exists (select 1 from fns f
                       where f.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
                         and has_function_privilege('anon', f.oid, 'EXECUTE')),

    'realtime_publication_ready',
      (not exists (select 1 from pg_publication where pubname = 'supabase_realtime'))
      or (select count(*) = 3 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public'
             and tablename in ('finance_accounts', 'finance_transactions', 'shop_links')),

    'all_finance_rpcs_secured',
      not exists (select 1 from rpcs r
                   where to_regprocedure(r.sig) is null
                      or not has_function_privilege('authenticated', to_regprocedure(r.sig), 'EXECUTE')
                      or not (select p.prosecdef and p.proacl is not null
                                     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                                     and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) s where s like 'search_path=%')
                                from pg_proc p where p.oid = to_regprocedure(r.sig))),

    'process_checkout_only_finance_differs',
      coalesce((select co_old is not null and co_old = co_stripped from snap_diff), false),

    'process_reversal_only_finance_differs',
      coalesce((select rev_old is not null and rev_old = rev_stripped from snap_diff), false),

    'every_shop_has_cash_and_primary',
      not exists (
        select 1 from (select distinct "shopId" as sid from public.profiles where "shopId" is not null) s
         where not exists (select 1 from public.finance_accounts a where a."ownerShopId" = s.sid and a.type = 'shopCash' and not a."isArchived")
            or not exists (select 1 from public.finance_accounts a where a."ownerShopId" = s.sid and a.type = 'primaryOnline' and not a."isArchived")
      ),

    'balances_match_ledger',
      not exists (
        select 1 from public.finance_accounts a
         where a.balance <> coalesce((
           select sum(case when ft.direction = 'in' then ft.amount else -ft.amount end)
             from public.finance_transactions ft
            where ft."accountId" = a.id
         ), 0)
      )
  ) as c
)
select jsonb_pretty(jsonb_build_object(
  'all_checks_passed', not exists (select 1 from jsonb_each(checks.c) e where e.value <> 'true'::jsonb),
  'checks', checks.c,
  'counts', jsonb_build_object(
    'finance_accounts',     (select count(*) from public.finance_accounts),
    'finance_transactions', (select count(*) from public.finance_transactions),
    'expenses_linked',      (select count(*) from public.expenses where "paidFromAccountId" is not null)
  )
))
from checks;
