-- =====================================================================
-- VapeTrax: find sales that may have been LOST by the old "Edit sale"
-- button (before the 2026-10-11 app update hid it).
--
-- The old Edit first put the sale's stock back and deleted the sale, then
-- re-created it. On some older sales the re-create step crashed, so the
-- sale vanished. Every Edit left an inventory log "Sale edited (restored
-- old): XXXXXX" (the last 6 characters of the sale id). This lists the
-- ones whose sale no longer exists and that were not deleted on purpose.
--
-- Read-only: this query changes nothing. It shows product names, amounts
-- and dates only (no customer names or phone numbers).
--
-- How to run: SQL Editor -> New query -> paste this file -> Run ->
-- copy the single result cell and paste it back to Claude.
-- To fix one: ring the sale again in New Sale with the same items, using
-- "lost_at" as the sale date. Its stock was already put back, so do NOT
-- add stock by hand.
-- =====================================================================
with edits as (
  select
    l."shopId",
    upper(substring(l.reason from 'Sale edited \(restored old\): ([A-Za-z0-9-]{1,12})')) as suffix,
    l."createdAt",
    l."productName",
    coalesce(l."mlChange", 0) as ml,
    coalesce(l."quantityChange", 0) as qty
  from public.inventory_logs l
  where l.reason like 'Sale edited (restored old): %'
),
grouped as (
  select "shopId", suffix,
         min("createdAt") as lost_at,
         jsonb_agg(jsonb_build_object(
           'product', "productName",
           'ml_restored', ml,
           'pieces_restored', qty) order by "productName") as items_restored
  from edits
  where suffix is not null
  group by "shopId", suffix
),
candidates as (
  select g.*
  from grouped g
  where not exists (   -- the sale still exists (the edit worked)
          select 1 from public.sales s
          where s."shopId" = g."shopId" and upper(right(s.id, length(g.suffix))) = g.suffix)
    and not exists (   -- the sale was deleted on purpose afterwards
          select 1 from public.inventory_logs d
          where d."shopId" = g."shopId"
            and d.reason like 'Sale deleted (restored): %'
            and upper(substring(d.reason from 'Sale deleted \(restored\): ([A-Za-z0-9-]{1,12})')) = g.suffix)
)
select jsonb_pretty(jsonb_build_object(
  'edits_found', (select count(*) from grouped),
  'possibly_lost', (select count(*) from candidates),
  'lost_sales', coalesce((
    select jsonb_agg(jsonb_build_object(
             'sale_ref', suffix,
             'lost_at', lost_at,
             'items_restored', items_restored) order by lost_at)
    from candidates), '[]'::jsonb)
));
