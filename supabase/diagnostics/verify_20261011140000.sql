-- =====================================================================
-- Verify migration 20261011140000_stock_never_negative_refill_steps.sql
-- Read-only. Run it AFTER the migration and paste the result back.
-- "all_checks_passed": true means the stock and refill rules are active.
-- =====================================================================
with checks as (
  select jsonb_build_object(
    'rule_stock_never_negative_exists',
      exists (select 1 from pg_constraint
              where conname = 'products_stock_not_negative'
                and conrelid = 'public.products'::regclass),
    'rule_bottle_ml_never_negative_exists',
      exists (select 1 from pg_constraint
              where conname = 'bottles_remaining_not_negative'
                and conrelid = 'public.bottles'::regclass),
    'no_product_below_zero',
      not exists (select 1 from public.products where "stockQuantity" < 0),
    'no_bottle_below_zero',
      not exists (select 1 from public.bottles where "remainingMl" < 0),
    'checkout_has_refill_rule',
      exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'process_checkout'
                and p.prosrc like '%0.5 ml steps%'),
    'checkout_has_shortfall_rule',
      exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'process_checkout'
                and p.prosrc like '%shortfall%'),
    'reversal_rejects_negative_restore',
      exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'process_reversal'
                and p.prosrc like '%Invalid stock restore amount%'),
    'checkout_rejects_nan_and_huge_amounts',
      exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname = 'process_checkout'
                and p.prosrc like '%>= 100000%'),
    'shortfall_alerts_product_id_is_text',
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'inventory_alerts'
                and column_name = 'product_id' and data_type = 'text'),
    'shop_members_can_read_shortfall_alerts',
      has_table_privilege('authenticated', 'public.inventory_alerts', 'SELECT'),
    'anon_still_cannot_run_process_functions',
      not exists (select 1 from pg_proc p
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname like 'process\_%'
                    and has_function_privilege('anon', p.oid, 'EXECUTE'))
  ) as c
)
select jsonb_pretty(jsonb_build_object(
  'all_checks_passed', not exists (select 1 from jsonb_each(checks.c) e where e.value <> 'true'::jsonb),
  'checks', checks.c,
  'products_reset_from_negative_to_zero', (
    select count(*) from public.inventory_logs
    where reason = 'Automatic correction: stock was below zero')
))
from checks;
