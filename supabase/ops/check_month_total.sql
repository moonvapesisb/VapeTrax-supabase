-- =====================================================================
-- VapeTrax: one month's totals, to compare with the app's Dashboard and
-- Detailed Reports.
-- Read-only: this query changes nothing. It shows money totals only
-- (no customer names, no personal data).
--
-- Which month: by default LAST month, in Pakistan time (Asia/Karachi).
-- To check another month, change the line marked "MONTH TO CHECK" below,
-- for example:   select date '2026-09-01' as chosen_month
--
-- How to run: SQL Editor -> New query -> paste this file -> Run ->
-- copy the single result cell and paste it back to Claude.
--
-- How to compare with the app:
--   * Dashboard: pick the first and last day of the month in the date
--     boxes. "revenue" = SELECTED REVENUE, "gross_profit" = SELECTED GROSS
--     PROFIT, "cash"/"online"/"credit" = the CASH/ONLINE/CREDIT cards,
--     "recovered_credit" = the "Recovered Credit" line on the CASH card,
--     "expenses" = SELECTED EXPENSES.
--   * Detailed Reports: the same dates, Sales report -> Total Amount and
--     Total Entries ("sales_count").
-- Sales are dated by "saleDate" (set on every sale), exactly as the app.
-- =====================================================================
with chosen as (
  select null::date as chosen_month   -- MONTH TO CHECK (null = last month)
),
bounds as (
  select m as month_start,
         (m::timestamp at time zone 'Asia/Karachi')                        as from_ts,
         ((m + interval '1 month')::timestamp at time zone 'Asia/Karachi') as to_ts
  from (
    select coalesce(
             date_trunc('month', c.chosen_month)::date,
             (date_trunc('month', (now() at time zone 'Asia/Karachi')) - interval '1 month')::date
           ) as m
    from chosen c
  ) x
),
sales_in_month as (
  select s."shopId" as shop,
         coalesce(s."totalAmount", 0)  as amount,
         coalesce(s."totalProfit", 0)  as profit,
         s."paymentMethod"             as method,
         s."splitAmounts"              as split
  from public.sales s, bounds b
  where s."saleDate" >= b.from_ts and s."saleDate" < b.to_ts
),
split_part_amounts as (
  select shop,
         case when jsonb_typeof(split) = 'object' and coalesce(split->>'cash', '')   ~ '^-?[0-9]+(\.[0-9]+)?$' then (split->>'cash')::numeric   else 0 end as cash,
         case when jsonb_typeof(split) = 'object' and coalesce(split->>'online', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (split->>'online')::numeric else 0 end as online,
         case when jsonb_typeof(split) = 'object' and coalesce(split->>'credit', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (split->>'credit')::numeric else 0 end as credit,
         jsonb_typeof(split) is distinct from 'object' as unreadable
  from sales_in_month
  where method = 'split'
),
per_shop as (
  select shop,
         count(*)                                              as sales_count,
         sum(amount)                                           as revenue,
         sum(profit)                                           as gross_profit,
         sum(amount) filter (where method = 'cash')            as cash_sales,
         sum(amount) filter (where method = 'online')          as online_sales,
         sum(amount) filter (where method = 'credit')          as credit_sales
  from sales_in_month
  group by shop
),
split_per_shop as (
  select shop, sum(cash) as cash, sum(online) as online, sum(credit) as credit,
         count(*) filter (where unreadable) as unreadable
  from split_part_amounts
  group by shop
),
expenses_per_shop as (
  select e."shopId" as shop, count(*) as n, sum(coalesce(e.amount, 0)) as total
  from public.expenses e, bounds b
  where e."expenseDate" >= b.from_ts and e."expenseDate" < b.to_ts
  group by e."shopId"
),
recovered_per_shop as (
  select c."shopId" as shop, sum(coalesce(c.amount, 0)) as total
  from public.credits c, bounds b
  where c."createdAt" >= b.from_ts and c."createdAt" < b.to_ts
    and c."creditType" = 'customer' and c."transactionType" = 'taken'
  group by c."shopId"
),
shops as (
  select shop from per_shop
  union select shop from expenses_per_shop
  union select shop from recovered_per_shop
)
select jsonb_pretty(jsonb_build_object(
  'month', (select to_char(month_start, 'YYYY-MM') from bounds),
  'from_pakistan_time', (select to_char(from_ts at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI') from bounds),
  'to_pakistan_time_exclusive', (select to_char(to_ts at time zone 'Asia/Karachi', 'YYYY-MM-DD HH24:MI') from bounds),
  'shops', coalesce((
    select jsonb_agg(jsonb_build_object(
      'shop', sh.shop,
      'sales_count', coalesce(p.sales_count, 0),
      'revenue', round(coalesce(p.revenue, 0), 2),
      'gross_profit', round(coalesce(p.gross_profit, 0), 2),
      'cash', round(coalesce(p.cash_sales, 0) + coalesce(sp.cash, 0), 2),
      'online', round(coalesce(p.online_sales, 0) + coalesce(sp.online, 0), 2),
      'credit', round(coalesce(p.credit_sales, 0) + coalesce(sp.credit, 0), 2),
      'split_sales_with_unreadable_parts', coalesce(sp.unreadable, 0),
      'recovered_credit', round(coalesce(r.total, 0), 2),
      'expenses_count', coalesce(e.n, 0),
      'expenses', round(coalesce(e.total, 0), 2)
    ) order by sh.shop)
    from shops sh
    left join per_shop p on p.shop = sh.shop
    left join split_per_shop sp on sp.shop = sh.shop
    left join expenses_per_shop e on e.shop = sh.shop
    left join recovered_per_shop r on r.shop = sh.shop
  ), '[]'::jsonb)
)) as month_totals;
