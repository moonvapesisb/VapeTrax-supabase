-- =====================================================================
-- VapeTrax live DB check 4 of 4: DATA PROFILE (counts and formats only)
-- Read-only: this query changes nothing. It returns NO customer names,
-- phone numbers or other personal data: only counts, shop IDs and date
-- *formats* (every digit replaced with 9).
--
-- How to run:
--   1. Supabase dashboard -> SQL Editor -> "New query"
--   2. Paste this whole file and click "Run"
--   3. Click the single result cell, copy its JSON and paste it back to Claude
--
-- Shows: row count per table, users and roles, data per shop, how dates
-- are stored (needed to migrate them safely) and basic data-quality checks.
-- =====================================================================
select jsonb_pretty(jsonb_build_object(
  'row_counts', (
    select jsonb_object_agg(c.relname,
      (xpath('/row/n/text()',
             query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')
      ))[1]::text::bigint)
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
  ),
  'auth_users_total', (select count(*) from auth.users),
  'auth_users_unconfirmed_email', (select count(*) from auth.users where email_confirmed_at is null),
  'auth_users_without_profile', (
    select count(*) from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
  ),
  'profiles_by_role', (
    select jsonb_object_agg(r.role_name, r.n)
    from (select coalesce("role", '(null)') as role_name, count(*) as n
          from public.profiles group by 1) r
  ),
  'profiles_null_shopId', (select count(*) from public.profiles where "shopId" is null),
  'admins_whose_shopId_is_not_own_id', (
    select count(*) from public.profiles
    where "role" = 'admin' and "shopId" is not null and "shopId"::text <> id::text
  ),
  'shops', (
    select jsonb_agg(jsonb_build_object(
      'shopId', s.sid,
      'has_profile_with_same_id', exists (select 1 from public.profiles p where p.id::text = s.sid),
      'members_pointing_here', (select count(*) from public.profiles p where p."shopId"::text = s.sid),
      'products', (select count(*) from public.products x where x."shopId"::text = s.sid),
      'customers', (select count(*) from public.customers x where x."shopId"::text = s.sid),
      'sales', (select count(*) from public.sales x where x."shopId"::text = s.sid),
      'expenses', (select count(*) from public.expenses x where x."shopId"::text = s.sid),
      'inventory_logs', (select count(*) from public.inventory_logs x where x."shopId"::text = s.sid)
    ))
    from (
      select "shopId"::text as sid from public.profiles where "shopId" is not null
      union select "shopId"::text from public.products
      union select "shopId"::text from public.customers
      union select "shopId"::text from public.sales
    ) s
  ),
  'sales_date_range', (
    select jsonb_build_object('oldest_createdAt', min("createdAt"), 'newest_createdAt', max("createdAt"))
    from public.sales
  ),
  'date_formats', jsonb_build_object(
    'sales.saleDate', (
      select jsonb_object_agg(t.pat, t.n) from (
        select regexp_replace(coalesce("saleDate"::text, 'NULL'), '[0-9]', '9', 'g') as pat, count(*) as n
        from public.sales group by 1 order by 2 desc limit 10) t),
    'sales.saleDateClient', (
      select jsonb_object_agg(t.pat, t.n) from (
        select regexp_replace(coalesce("saleDateClient"::text, 'NULL'), '[0-9]', '9', 'g') as pat, count(*) as n
        from public.sales group by 1 order by 2 desc limit 10) t),
    'credits.createdAtClient', (
      select jsonb_object_agg(t.pat, t.n) from (
        select regexp_replace(coalesce("createdAtClient"::text, 'NULL'), '[0-9]', '9', 'g') as pat, count(*) as n
        from public.credits group by 1 order by 2 desc limit 10) t),
    'expenses.expenseDate', (
      select jsonb_object_agg(t.pat, t.n) from (
        select regexp_replace(coalesce("expenseDate"::text, 'NULL'), '[0-9]', '9', 'g') as pat, count(*) as n
        from public.expenses group by 1 order by 2 desc limit 10) t),
    'expenses.createdAtClient', (
      select jsonb_object_agg(t.pat, t.n) from (
        select regexp_replace(coalesce("createdAtClient"::text, 'NULL'), '[0-9]', '9', 'g') as pat, count(*) as n
        from public.expenses group by 1 order by 2 desc limit 10) t),
    'inventory_logs.createdAtClient', (
      select jsonb_object_agg(t.pat, t.n) from (
        select regexp_replace(coalesce("createdAtClient"::text, 'NULL'), '[0-9]', '9', 'g') as pat, count(*) as n
        from public.inventory_logs group by 1 order by 2 desc limit 10) t)
  ),
  'data_quality', jsonb_build_object(
    'products_negative_stock', (select count(*) from public.products where "stockQuantity" < 0),
    'products_duplicate_names_per_shop', (
      select count(*) from (
        select "shopId", lower(trim(name)) from public.products
        group by 1, 2 having count(*) > 1) d),
    'customers_negative_credit', (select count(*) from public.customers where "creditBalance" < 0),
    'customers_duplicate_phone_per_shop', (
      select count(*) from (
        select "shopId", phone from public.customers
        where phone is not null and phone <> ''
        group by 1, 2 having count(*) > 1) d),
    'sales_null_saleDate', (select count(*) from public.sales where "saleDate" is null),
    'sales_with_customer_not_found', (
      select count(*) from public.sales s
      where s."customerId" is not null
        and not exists (select 1 from public.customers c where c.id::text = s."customerId"::text)),
    'sales_items_not_array', (
      select count(*) from public.sales
      where items is null or jsonb_typeof(items::jsonb) <> 'array')
  )
));
