-- =====================================================================
-- supabase/diagnostics/08_lost_sales.sql
-- Read-only. Run it any time AFTER 20261012100000_lockdown_followup.sql.
--
-- Lists sales that were removed through "Edit" (Sales History -> Edit ->
-- Complete Sale) and never came back. An edit first puts the old sale's
-- stock and udhaar back and removes it, then saves the new version under
-- the same sale id. If the app stops in between (for example the deployed
-- app's "Invalid time value" error on a sale from before Supabase), the
-- sale is gone from Sales History; a full copy is kept in
-- private.deleted_rows, and this file shows it.
--
-- How to get a lost sale back: ring it again in New Sale (same items,
-- customer and payment; set the date to the "saleDate" shown here).
-- Do NOT copy the old row back by hand: its stock and udhaar were already
-- put back, so a copied row would leave stock too high and udhaar too low.
--
-- Wait until every device shows 0 waiting before reading the list: an edit
-- still being sent shows here until it arrives.
-- Contains customer names: share the result only with the developer.
-- If it stops with "relation private.deleted_rows does not exist", the
-- migration has not been run.
-- =====================================================================
with removed as (
  select distinct on (d."rowId")
         d."rowId" as sale_id, d.reason, d."deletedAt", d."row"
    from private.deleted_rows d
   where d."table" = 'sales'
   order by d."rowId", d."deletedAt" desc, d.id desc
),
lost as (
  select r.*
    from removed r
   where not exists (select 1 from public.sales s where s.id = r.sale_id)
)
select jsonb_pretty(jsonb_build_object(
  'diagnostic', '08_lost_sales',
  'generated_at', now(),
  'lost_in_edit_count', (select count(*) from lost l where l.reason = 'sale edit'),
  'lost_in_edit', coalesce((
    select jsonb_agg(jsonb_build_object(
             'saleId', l.sale_id,
             'removedAt', to_char(l."deletedAt" at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI'),
             'saleDate', l."row"->>'saleDate',
             'totalAmount', l."row"->'totalAmount',
             'paymentMethod', l."row"->'paymentMethod',
             'splitAmounts', l."row"->'splitAmounts',
             'customerId', l."row"->'customerId',
             'customerName', (select c.name from public.customers c where c.id = l."row"->>'customerId'),
             'items', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'productName', i->'productName',
                        'saleType', i->'saleType',
                        'quantity', i->'quantity',
                        'refillAmount', i->'refillAmount',
                        'totalPrice', i->'totalPrice'))
                 from jsonb_array_elements(case when jsonb_typeof(l."row"->'items') = 'array'
                                                then l."row"->'items' else '[]'::jsonb end) i
                where jsonb_typeof(i) = 'object'), '[]'::jsonb))
           order by l."deletedAt" desc)
      from lost l
     where l.reason = 'sale edit'), '[]'::jsonb),
  'deleted_on_purpose_count', (select count(*) from lost l where l.reason is distinct from 'sale edit')
));
