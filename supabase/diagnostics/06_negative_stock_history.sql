-- =====================================================================
-- VapeTrax: when and how did stock go below zero?
-- Read-only: this query changes nothing. Shows product names, dates and
-- who made the change (no customer data).
--
-- How to run: SQL Editor -> New query -> paste this file -> Run ->
-- copy the single result cell and paste it back to Claude.
-- Note: "newStock" in old logs was calculated by the app from its local
-- copy, so treat it as a strong hint, not an exact number.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'products_below_zero_right_now', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'product', p.name, 'category', p.category, 'stock', p."stockQuantity") order by p.name), '[]'::jsonb)
    from public.products p
    where p."stockQuantity" < 0),
  'bottles_below_zero_right_now', (
    select count(*) from public.bottles where "remainingMl" < 0),
  'log_entries_that_left_stock_below_zero', (
    select count(*) from public.inventory_logs
    where "newStock" < 0 or "newStockMl" < 0),
  'by_kind_of_change', (
    select coalesce(jsonb_object_agg(t.kind, t.n), '{}'::jsonb)
    from (
      select coalesce(type, '?') || ' / ' || coalesce(action, '?') as kind, count(*) as n
      from public.inventory_logs
      where "newStock" < 0 or "newStockMl" < 0
      group by 1
    ) t),
  'old_sales_with_non_whole_quantities', (
    select count(distinct s.id)
    from public.sales s,
         jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end) i
    where not coalesce((i->>'quantity') ~ '^[1-9][0-9]*(\.0+)?$', false)),
  'old_sales_with_refills_not_in_half_ml_steps', (
    select count(distinct s.id)
    from public.sales s,
         jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end) i
    where i->>'saleType' = 'refill'
      and not coalesce((i->>'refillAmount') ~ '^[0-9]+(\.(0+|50*))?$', false)),
  'latest_50', (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    from (
      select "createdAt" as at, "productName" as product, type, action,
             "quantityChange", "mlChange", "newStock", "newStockMl",
             reason, "actorName" as by_user, "actorRole" as by_role
      from public.inventory_logs
      where "newStock" < 0 or "newStockMl" < 0
      order by "createdAt" desc
      limit 50
    ) t)
));
