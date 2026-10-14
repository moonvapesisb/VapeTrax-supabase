-- =====================================================================
-- VapeTrax live DB check 7: INTEGRITY PROBE
-- Read-only: this query changes nothing. It returns ONE cell of JSON.
-- It contains NO personal data: no names, phone numbers, emails, user ids
-- or per-person amounts. Only counts, value classes, fingerprints (md5) of
-- function code, and security settings.
--
-- How to run:
--   1. Supabase dashboard -> SQL Editor -> "New query"
--   2. Paste this whole file and click "Run"
--   3. Click the single result cell, copy its JSON and paste it back to Claude
--
-- What it answers (the next migrations depend on it):
--   summary               the headline yes/no answers below in one place
--   functions             md5 and markers of every public/private function
--                         body; "matches_repo" compares with the bodies in
--                         20261011120000 / 20261011140000 (the two applied
--                         migrations), so we know they are what is live
--   rls_auto_enable_definition, event_triggers   Supabase's RLS helper
--   default_privileges    what NEW tables and functions get automatically
--   tables                RLS on/forced, anon/authenticated rights, policies
--   products_bottleSize   value classes per category (numeric, '', null,
--                         with 'ml', other)
--   bottles               ml above size, negative ml, statuses, orphans,
--                         cross-shop bottles, e-liquid stock vs bottle ml
--   raw_values, value_variants   category / paymentMethod / saleType
--                         spellings, including case and space variants
--   ids                   uuid-style vs 20-character Firestore-style ids
--   sales_items           line shapes and keys (bottleChanges, refillMl,
--                         costPrice, ...), lines without productId
--   missing_customers     sales and credits pointing at no customer
--   others_credits        'others' credits grouped by lower(trim(name)),
--                         reported as counts only
--   credit_balance        stored creditBalance vs the balance worked out
--                         from credits and credit sales
--   money                 values with more than 2 decimals / not whole rupees
--   sale_dates            saleDate vs saleDateClient (Firestore JSON aware)
--   duplicates            duplicate product names and customer phones
--   accounts              users, profiles, sign-in providers, unconfirmed
--   row_counts            rows per table
-- =====================================================================
with
fn as (
  select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as signature,
         p.oid,
         p.prosecdef as security_definer,
         exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) s
                 where s like 'search_path=%') as fixed_search_path,
         format_type(p.prorettype, null) as returns,
         md5(replace(p.prosrc, chr(13), '')) as body_md5,
         p.prosrc as src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d
                     where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
),
-- md5 of each function body (carriage returns removed) exactly as written
-- in the applied migration that last defined it.
expected (signature, body_md5, defined_by) as (
  values
    ('public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric)',
     'a194d113563acb7680931dfa825a5638', '20261011140000'),
    ('public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric)',
     '41cd8243529c513d247805a42015f861', '20261011140000'),
    ('public.process_stock_adjustment(uuid, text, jsonb, jsonb, jsonb, jsonb)',
     '5280a3f3c7cce4e716618c8d40b83a2d', '20261011120000'),
    ('private.is_shop_member(uuid)',
     '774f70fde6d8cf0bd87b66ca8ba1309d', '20261011120000')
),
tbl as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity,
         coalesce(c.relacl, acldefault('r', c.relowner)) as acl
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
),
-- Table rights granted to anon / authenticated directly or through PUBLIC
-- (grantee 0), one row per right.
table_rights as (
  select t.relname, r.rolname, a.privilege_type
    from tbl t
   cross join lateral aclexplode(t.acl) a
    join pg_roles r on r.rolname in ('anon', 'authenticated') and a.grantee in (0, r.oid)
),
lines as (
  select l.line
    from public.sales s
   cross join lateral jsonb_array_elements(
           case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end) as l(line)
),
obj_lines as (
  select line from lines where jsonb_typeof(line) = 'object'
),
eliquid as (
  select p.id,
         coalesce(p."stockQuantity", 0) as stock,
         coalesce((select sum(coalesce(b."remainingMl", 0)) from public.bottles b
                    where b."productId" = p.id and b."shopId" = p."shopId"
                      and b.status in ('closed', 'opened')), 0) as active_ml
    from public.products p
   where lower(btrim(coalesce(p.category, ''))) = 'e-liquid'
),
sale_dates as (
  select s."saleDate" as sale_date,
         s."saleDateClient" as c,
         pg_input_is_valid(coalesce(s."saleDateClient", ''), 'jsonb') as is_json,
         pg_input_is_valid(coalesce(s."saleDateClient", ''), 'timestamptz') as is_ts
    from public.sales s
),
sale_dates_typed as (
  select d.sale_date, d.c, d.is_ts,
         case when d.is_json then d.c::jsonb end as j,
         case
           when d.c is null or btrim(d.c) = '' then 'null'
           when d.is_json and jsonb_typeof(d.c::jsonb) = 'object' then 'firestore_json'
           when d.is_ts and d.c ~ '^\d{4}-\d{2}-\d{2}T' then 'iso'
           when d.is_ts then 'postgres_text'
           else 'other'
         end as fmt
    from sale_dates d
),
sale_dates_parsed as (
  select d.sale_date, d.fmt,
         case
           when d.fmt = 'firestore_json'
                and coalesce(d.j ->> '_seconds', d.j ->> 'seconds') ~ '^-?\d+(\.\d+)?$'
             then to_timestamp(coalesce(d.j ->> '_seconds', d.j ->> 'seconds')::double precision
                  + case when coalesce(d.j ->> '_nanoseconds', d.j ->> 'nanoseconds') ~ '^\d+$'
                         then coalesce(d.j ->> '_nanoseconds', d.j ->> 'nanoseconds')::double precision / 1e9
                         else 0 end)
           when d.fmt in ('iso', 'postgres_text') then d.c::timestamptz
         end as parsed
    from sale_dates_typed d
),
credit_net as (
  select c."shopId", c."customerId",
         sum(case when c."transactionType" = 'given' then abs(c.amount)
                  when c."transactionType" = 'taken' then -abs(c.amount)
                  else 0 end) as net
    from public.credits c
   where c."creditType" = 'customer' and c."customerId" is not null
   group by 1, 2
),
credit_sales as (
  select s."shopId", s."customerId",
         sum(case when s."paymentMethod" = 'credit' then coalesce(s."totalAmount", 0)
                  when s."paymentMethod" = 'split'
                       and (s."splitAmounts" ->> 'credit') ~ '^-?\d+(\.\d+)?$'
                    then (s."splitAmounts" ->> 'credit')::numeric
                  else 0 end) as net
    from public.sales s
   where s."customerId" is not null
   group by 1, 2
),
balances as (
  select coalesce(c."creditBalance", 0) as stored,
         coalesce(cn.net, 0) as from_credits,
         coalesce(cn.net, 0) + coalesce(cs.net, 0) as from_credits_and_sales
    from public.customers c
    left join credit_net cn on cn."shopId" = c."shopId" and cn."customerId" = c.id
    left join credit_sales cs on cs."shopId" = c."shopId" and cs."customerId" = c.id
),
others as (
  select lower(btrim(c."entityName")) as norm, c."entityName" as raw
    from public.credits c
   where c."creditType" = 'others'
),
others_groups as (
  select norm, count(*) as n, count(distinct raw) as spellings
    from others where coalesce(norm, '') <> '' group by norm
),
id_xml as (
  select ic.table_name as tbl,
         query_to_xml(format($q$select count(*) as total,
             count(*) filter (where id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as uuid_like,
             count(*) filter (where id ~ '^[A-Za-z0-9]{20}$') as firestore_20,
             min(length(id)) as min_length,
             max(length(id)) as max_length
           from public.%I$q$, ic.table_name), false, true, '') as x
    from information_schema.columns ic
   where ic.table_schema = 'public' and ic.column_name = 'id' and ic.data_type = 'text'
),
money_cols (tbl, col) as (
  values ('products', 'costPrice'), ('products', 'sellingPrice'), ('products', 'pricePerMl'),
         ('products', 'unitCostPerMl'), ('sales', 'totalAmount'), ('sales', 'totalCOGS'),
         ('sales', 'totalProfit'), ('customers', 'creditBalance'), ('credits', 'amount'),
         ('expenses', 'amount'), ('personal_expenses', 'amount'), ('finance_accounts', 'balance'),
         ('finance_transactions', 'amount'), ('purchases', 'purchase_price')
),
money_xml as (
  select m.tbl || '.' || m.col as col,
         query_to_xml(format($q$select
             count(*) filter (where %1$I <> round(%1$I, 2)) as more_than_2_decimals,
             count(*) filter (where %1$I <> round(%1$I)) as not_whole_rupees
           from public.%2$I$q$, m.col, m.tbl), false, true, '') as x
    from money_cols m
    join information_schema.columns ic
      on ic.table_schema = 'public' and ic.table_name = m.tbl
     and ic.column_name = m.col and ic.data_type = 'numeric'
),
phones as (
  select c."shopId",
         c.phone as raw,
         case when regexp_replace(c.phone, '[^0-9]', '', 'g') ~ '^92\d{10}$'
              then '0' || substr(regexp_replace(c.phone, '[^0-9]', '', 'g'), 3)
              else regexp_replace(c.phone, '[^0-9]', '', 'g') end as norm
    from public.customers c
   where coalesce(btrim(c.phone), '') <> ''
),
summary as (
  select jsonb_build_object(
    'repo_bodies_match',
      (select count(*) = (select count(*) from expected)
         from expected e join fn f on f.signature = e.signature and f.body_md5 = e.body_md5),
    'rls_on_every_public_table', not exists (select 1 from tbl where not relrowsecurity),
    'anon_has_no_table_privileges',
      not exists (select 1 from table_rights where rolname = 'anon'),
    'functions_anon_can_call',
      (select coalesce(jsonb_agg(f.signature order by f.signature), '[]'::jsonb) from fn f
        where has_function_privilege('anon', f.oid, 'EXECUTE')
          and f.returns not in ('trigger', 'event_trigger')),
    'functions_without_fixed_search_path',
      (select coalesce(jsonb_agg(f.signature order by f.signature), '[]'::jsonb) from fn f
        where not f.fixed_search_path),
    'new_public_functions_executable_by_everyone',
      not exists (select 1 from pg_default_acl d
                  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0
                    and d.defaclobjtype = 'f'
                    and not exists (select 1 from unnest(d.defaclacl) a where a::text like '=%')),
    'rls_auto_enable_exists',
      exists (select 1 from fn f where f.signature = 'public.rls_auto_enable()'),
    'products_below_zero', (select count(*) from public.products where "stockQuantity" < 0),
    'bottles_below_zero', (select count(*) from public.bottles where "remainingMl" < 0)
  ) as v
)
select jsonb_pretty(jsonb_build_object(
  'probe', '07_integrity_probe',
  'probe_version', 1,
  'generated_at', now(),
  'postgres_version', current_setting('server_version'),

  'summary', (select v from summary),

  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'signature', f.signature,
      'returns', f.returns,
      'security_definer', f.security_definer,
      'fixed_search_path', f.fixed_search_path,
      'anon_can_execute', has_function_privilege('anon', f.oid, 'EXECUTE'),
      'authenticated_can_execute', has_function_privilege('authenticated', f.oid, 'EXECUTE'),
      'body_md5', f.body_md5,
      'matches_repo', case when e.signature is null then null else f.body_md5 = e.body_md5 end,
      'repo_version', e.defined_by,
      'markers', jsonb_build_object(
        'membership_check', f.src like '%private.is_shop_member%',
        'replay_safe_insert', f.src ilike '%on conflict (id) do nothing%',
        'stops_if_not_found', f.src ilike '%if not found then%return%',
        'refill_half_ml_rule', f.src like '%0.5 ml steps%',
        'shortfall_rule', f.src like '%shortfall%',
        'nan_and_huge_guard', f.src like '%>= 100000%',
        'negative_restore_guard', f.src like '%Invalid stock restore amount%')
    ) order by f.signature), '[]'::jsonb)
      from fn f left join expected e on e.signature = f.signature),
  'expected_functions_missing', (
    select coalesce(jsonb_agg(e.signature order by e.signature), '[]'::jsonb)
      from expected e where not exists (select 1 from fn f where f.signature = e.signature)),

  'rls_auto_enable_definition', (
    select string_agg(pg_get_functiondef(f.oid), E'\n') from fn f
     where f.signature = 'public.rls_auto_enable()'),
  'event_triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', e.evtname, 'event', e.evtevent, 'enabled', e.evtenabled::text,
      'function', e.evtfoid::regproc::text, 'tags', e.evttags) order by e.evtname), '[]'::jsonb)
      from pg_event_trigger e),
  'default_privileges', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'role', pg_get_userbyid(d.defaclrole),
      'schema', case when d.defaclnamespace = 0 then '(all schemas)'
                     else d.defaclnamespace::regnamespace::text end,
      'object_type', d.defaclobjtype::text,
      'acl', d.defaclacl::text[])
      order by pg_get_userbyid(d.defaclrole), d.defaclnamespace::regnamespace::text, d.defaclobjtype::text),
      '[]'::jsonb)
      from pg_default_acl d),

  'tables', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', t.relname,
      'rls_enabled', t.relrowsecurity,
      'rls_forced', t.relforcerowsecurity,
      'anon', (
        select coalesce(string_agg(distinct tr.privilege_type, ',' order by tr.privilege_type), '')
          from table_rights tr where tr.relname = t.relname and tr.rolname = 'anon'),
      'authenticated', (
        select coalesce(string_agg(distinct tr.privilege_type, ',' order by tr.privilege_type), '')
          from table_rights tr where tr.relname = t.relname and tr.rolname = 'authenticated'),
      'authenticated_column_rights', (
        select coalesce(jsonb_agg(distinct a.attname || ':' || cr.privilege_type), '[]'::jsonb)
          from pg_attribute a
         cross join lateral aclexplode(a.attacl) cr
          join pg_roles r on r.rolname = 'authenticated' and cr.grantee = r.oid
         where a.attrelid = t.oid and a.attacl is not null),
      'policies', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', pol.policyname, 'cmd', pol.cmd, 'roles', pol.roles, 'permissive', pol.permissive)
          order by pol.policyname), '[]'::jsonb)
          from pg_policies pol
         where pol.schemaname = 'public' and pol.tablename = t.relname)
    ) order by t.relname), '[]'::jsonb)
      from tbl t),

  'products_bottleSize', jsonb_build_object(
    'classes_by_category', (
      select coalesce(jsonb_object_agg(x.category, x.classes), '{}'::jsonb)
        from (
          select y.category, jsonb_object_agg(y.class, y.n) as classes
            from (
              select coalesce(p.category, '(null)') as category,
                     case
                       when p."bottleSize" is null then 'null'
                       when btrim(p."bottleSize") = '' then 'empty'
                       when btrim(p."bottleSize") ~ '^[0-9]+(\.[0-9]+)?$' then 'numeric'
                       when btrim(p."bottleSize") ~* '^[0-9]+(\.[0-9]+)?\s*ml$' then 'with_ml'
                       else 'other'
                     end as class,
                     count(*) as n
                from public.products p
               group by 1, 2
            ) y
           group by y.category
        ) x),
    'other_values', (
      select coalesce(jsonb_agg(jsonb_build_object('value', v.value, 'n', v.n) order by v.n desc, v.value), '[]'::jsonb)
        from (
          select left(btrim(p."bottleSize"), 40) as value, count(*) as n
            from public.products p
           where btrim(p."bottleSize") <> ''
             and btrim(p."bottleSize") !~ '^[0-9]+(\.[0-9]+)?$'
             and btrim(p."bottleSize") !~* '^[0-9]+(\.[0-9]+)?\s*ml$'
           group by 1 order by 2 desc, 1 limit 25
        ) v)),

  'bottles', jsonb_build_object(
    'total', (select count(*) from public.bottles),
    'remaining_more_than_size',
      (select count(*) from public.bottles where "remainingMl" > "bottleSize"),
    'negative_ml', (select count(*) from public.bottles where "remainingMl" < 0),
    'null_ml', (select count(*) from public.bottles where "remainingMl" is null),
    'null_or_zero_size', (select count(*) from public.bottles where coalesce("bottleSize", 0) <= 0),
    'empty_or_sold_with_ml_left',
      (select count(*) from public.bottles where status in ('empty', 'sold') and "remainingMl" > 0),
    'status', (
      select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
        from (select coalesce(status, '(null)') as status, count(*) as n
                from public.bottles group by 1) x),
    'orphans_product_missing', (
      select count(*) from public.bottles b
       where not exists (select 1 from public.products p where p.id = b."productId")),
    'cross_shop_product_in_other_shop', (
      select count(*) from public.bottles b
       where exists (select 1 from public.products p where p.id = b."productId" and p."shopId" <> b."shopId")),
    'eliquid_stock_vs_active_bottle_ml', jsonb_build_object(
      'products', (select count(*) from eliquid),
      'mismatched_products', (select count(*) from eliquid where abs(stock - active_ml) > 0.001),
      'total_abs_mismatch_ml', (select coalesce(sum(abs(stock - active_ml)), 0) from eliquid),
      'stock_ml_total', (select coalesce(sum(stock), 0) from eliquid),
      'active_bottle_ml_total', (select coalesce(sum(active_ml), 0) from eliquid),
      'stock_more_than_bottles', (select count(*) from eliquid where stock - active_ml > 0.001),
      'bottles_more_than_stock', (select count(*) from eliquid where active_ml - stock > 0.001),
      'stock_but_no_active_bottles', (select count(*) from eliquid where stock > 0 and active_ml = 0))),

  'raw_values', jsonb_build_object(
    'products.category', (
      select coalesce(jsonb_agg(jsonb_build_object('value', v.value, 'n', v.n) order by v.n desc, v.value), '[]'::jsonb)
        from (select left(coalesce(category, '(null)'), 40) as value, count(*) as n
                from public.products group by 1 order by 2 desc, 1 limit 50) v),
    'sales.paymentMethod', (
      select coalesce(jsonb_agg(jsonb_build_object('value', v.value, 'n', v.n) order by v.n desc, v.value), '[]'::jsonb)
        from (select left(coalesce("paymentMethod", '(null)'), 40) as value, count(*) as n
                from public.sales group by 1 order by 2 desc, 1 limit 50) v),
    'sales.items.saleType', (
      select coalesce(jsonb_agg(jsonb_build_object('value', v.value, 'n', v.n) order by v.n desc, v.value), '[]'::jsonb)
        from (select left(coalesce(line ->> 'saleType', '(null)'), 40) as value, count(*) as n
                from obj_lines group by 1 order by 2 desc, 1 limit 50) v),
    'inventory_logs.type/action', (
      select coalesce(jsonb_agg(jsonb_build_object('value', v.value, 'n', v.n) order by v.n desc, v.value), '[]'::jsonb)
        from (select left(coalesce(type, '(null)') || ' / ' || coalesce(action, '(null)'), 60) as value, count(*) as n
                from public.inventory_logs group by 1 order by 2 desc, 1 limit 50) v)),
  'value_variants', jsonb_build_object(
    'products.category', (
      select coalesce(jsonb_agg(jsonb_build_object('normalized', x.norm, 'spellings', x.spellings) order by x.norm), '[]'::jsonb)
        from (select lower(btrim(category)) as norm, jsonb_agg(distinct category order by category) as spellings
                from public.products where category is not null
               group by 1 having count(distinct category) > 1) x),
    'sales.paymentMethod', (
      select coalesce(jsonb_agg(jsonb_build_object('normalized', x.norm, 'spellings', x.spellings) order by x.norm), '[]'::jsonb)
        from (select lower(btrim("paymentMethod")) as norm, jsonb_agg(distinct "paymentMethod" order by "paymentMethod") as spellings
                from public.sales where "paymentMethod" is not null
               group by 1 having count(distinct "paymentMethod") > 1) x),
    'sales.items.saleType', (
      select coalesce(jsonb_agg(jsonb_build_object('normalized', x.norm, 'spellings', x.spellings) order by x.norm), '[]'::jsonb)
        from (select lower(btrim(line ->> 'saleType')) as norm, jsonb_agg(distinct line ->> 'saleType' order by line ->> 'saleType') as spellings
                from obj_lines where line ->> 'saleType' is not null
               group by 1 having count(distinct line ->> 'saleType') > 1) x)),

  'ids', (
    select coalesce(jsonb_object_agg(i.tbl, jsonb_build_object(
      'total', (xpath('/row/total/text()', i.x))[1]::text::bigint,
      'uuid_like', (xpath('/row/uuid_like/text()', i.x))[1]::text::bigint,
      'firestore_20', (xpath('/row/firestore_20/text()', i.x))[1]::text::bigint,
      'other', (xpath('/row/total/text()', i.x))[1]::text::bigint
             - (xpath('/row/uuid_like/text()', i.x))[1]::text::bigint
             - (xpath('/row/firestore_20/text()', i.x))[1]::text::bigint,
      'min_length', (xpath('/row/min_length/text()', i.x))[1]::text::int,
      'max_length', (xpath('/row/max_length/text()', i.x))[1]::text::int)), '{}'::jsonb)
      from id_xml i),

  'sales_items', jsonb_build_object(
    'sales_with_items_not_an_array',
      (select count(*) from public.sales where items is null or jsonb_typeof(items) <> 'array'),
    'lines', (select count(*) from lines),
    'lines_not_an_object', (select count(*) from lines where jsonb_typeof(line) <> 'object'),
    'lines_without_productId',
      (select count(*) from obj_lines where coalesce(btrim(line ->> 'productId'), '') = ''),
    'lines_with_bottleChanges', (select count(*) from obj_lines where line ? 'bottleChanges'),
    'lines_with_nonempty_bottleChanges',
      (select count(*) from obj_lines
        where jsonb_typeof(line -> 'bottleChanges') = 'array' and jsonb_array_length(line -> 'bottleChanges') > 0),
    'lines_with_refillMl', (select count(*) from obj_lines where line ? 'refillMl'),
    'lines_with_refillAmount', (select count(*) from obj_lines where line ? 'refillAmount'),
    'lines_with_costPrice', (select count(*) from obj_lines where line ? 'costPrice'),
    'key_counts', (
      select coalesce(jsonb_object_agg(k.key, k.n), '{}'::jsonb)
        from (select key, count(*) as n
                from obj_lines cross join lateral jsonb_object_keys(line) as key
               group by key) k),
    'unit_price_not_whole_rupees', (
      select count(*) from obj_lines
       where (line ->> 'unitPrice') ~ '^-?\d+(\.\d+)?$'
         and (line ->> 'unitPrice')::numeric <> round((line ->> 'unitPrice')::numeric))),

  'missing_customers', jsonb_build_object(
    'sales_customer_not_found', (
      select count(*) from public.sales s
       where coalesce(btrim(s."customerId"), '') <> ''
         and not exists (select 1 from public.customers c where c.id = s."customerId")),
    'sales_customer_in_other_shop', (
      select count(*) from public.sales s
       where coalesce(btrim(s."customerId"), '') <> ''
         and not exists (select 1 from public.customers c where c.id = s."customerId" and c."shopId" = s."shopId")
         and exists (select 1 from public.customers c where c.id = s."customerId")),
    'credits_customer_not_found', (
      select count(*) from public.credits cr
       where coalesce(btrim(cr."customerId"), '') <> ''
         and not exists (select 1 from public.customers c where c.id = cr."customerId")),
    'credits_customer_in_other_shop', (
      select count(*) from public.credits cr
       where coalesce(btrim(cr."customerId"), '') <> ''
         and not exists (select 1 from public.customers c where c.id = cr."customerId" and c."shopId" = cr."shopId")
         and exists (select 1 from public.customers c where c.id = cr."customerId")),
    'customer_credits_without_customerId', (
      select count(*) from public.credits
       where "creditType" = 'customer' and coalesce(btrim("customerId"), '') = '')),

  'others_credits', jsonb_build_object(
    'rows', (select count(*) from others),
    'rows_without_name', (select count(*) from others where coalesce(norm, '') = ''),
    'distinct_names_as_typed', (select count(distinct raw) from others where coalesce(norm, '') <> ''),
    'groups_after_lower_trim', (select count(*) from others_groups),
    'groups_with_spelling_variants', (select count(*) from others_groups where spellings > 1),
    'rows_in_groups_with_variants', (select coalesce(sum(n), 0) from others_groups where spellings > 1),
    'largest_group_rows', (select coalesce(max(n), 0) from others_groups),
    'group_size_histogram', (
      select coalesce(jsonb_object_agg(h.n, h.groups), '{}'::jsonb)
        from (select n, count(*) as groups from others_groups group by n) h)),

  'credit_balance', jsonb_build_object(
    'customers', (select count(*) from balances),
    'mismatch_vs_credits_and_credit_sales',
      (select count(*) from balances where abs(stored - from_credits_and_sales) > 0.009),
    'total_abs_difference_vs_credits_and_credit_sales',
      (select coalesce(sum(abs(stored - from_credits_and_sales)), 0) from balances),
    'mismatch_vs_credits_only',
      (select count(*) from balances where abs(stored - from_credits) > 0.009),
    'negative_stored_balance', (select count(*) from balances where stored < 0),
    'balance_without_any_history',
      (select count(*) from balances where stored <> 0 and from_credits_and_sales = 0)),

  'money', (
    select coalesce(jsonb_object_agg(m.col, jsonb_build_object(
      'more_than_2_decimals', (xpath('/row/more_than_2_decimals/text()', m.x))[1]::text::bigint,
      'not_whole_rupees', (xpath('/row/not_whole_rupees/text()', m.x))[1]::text::bigint)), '{}'::jsonb)
      from money_xml m),

  'sale_dates', jsonb_build_object(
    'sales', (select count(*) from sale_dates_parsed),
    'client_format', (
      select coalesce(jsonb_object_agg(x.fmt, x.n), '{}'::jsonb)
        from (select fmt, count(*) as n from sale_dates_parsed group by fmt) x),
    'client_unparseable', (select count(*) from sale_dates_parsed where fmt <> 'null' and parsed is null),
    'saleDate_missing', (select count(*) from sale_dates_parsed where sale_date is null),
    'differs_more_than_10_minutes',
      (select count(*) from sale_dates_parsed where abs(extract(epoch from (sale_date - parsed))) > 600),
    'differs_more_than_1_hour',
      (select count(*) from sale_dates_parsed where abs(extract(epoch from (sale_date - parsed))) > 3600),
    'differs_more_than_1_day',
      (select count(*) from sale_dates_parsed where abs(extract(epoch from (sale_date - parsed))) > 86400),
    'max_difference_minutes',
      (select round(coalesce(max(abs(extract(epoch from (sale_date - parsed)))), 0) / 60, 1) from sale_dates_parsed)),

  'duplicates', jsonb_build_object(
    'product_name_groups', (
      select count(*) from (select 1 from public.products
                            group by "shopId", lower(btrim(name)) having count(*) > 1) d),
    'product_name_rows', (
      select coalesce(sum(n), 0) from (select count(*) as n from public.products
                                       group by "shopId", lower(btrim(name)) having count(*) > 1) d),
    'product_name_category_size_groups', (
      select count(*) from (select 1 from public.products
                            group by "shopId", lower(btrim(name)), lower(btrim(coalesce(category, ''))),
                                     lower(btrim(coalesce("bottleSize", '')))
                            having count(*) > 1) d),
    'customer_phone_exact_groups', (
      select count(*) from (select 1 from phones group by "shopId", raw having count(*) > 1) d),
    'customer_phone_exact_rows', (
      select coalesce(sum(n), 0) from (select count(*) as n from phones group by "shopId", raw having count(*) > 1) d),
    'customer_phone_normalized_groups', (
      select count(*) from (select 1 from phones where norm <> '' group by "shopId", norm having count(*) > 1) d),
    'customer_phone_normalized_rows', (
      select coalesce(sum(n), 0) from (select count(*) as n from phones where norm <> ''
                                       group by "shopId", norm having count(*) > 1) d)),

  'accounts', jsonb_build_object(
    'auth_users', (select count(*) from auth.users),
    'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
    'unconfirmed', (select count(*) from auth.users where email_confirmed_at is null),
    'never_signed_in', (select count(*) from auth.users where last_sign_in_at is null),
    'signed_in_last_30_days', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'without_profile', (
      select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)),
    'without_identity', (
      select count(*) from auth.users u where not exists (select 1 from auth.identities i where i.user_id = u.id)),
    'providers', (
      select coalesce(jsonb_object_agg(x.provider, x.n), '{}'::jsonb)
        from (select coalesce(provider, '(null)') as provider, count(distinct user_id) as n
                from auth.identities group by 1) x),
    'profiles_by_role', (
      select coalesce(jsonb_object_agg(x.role, x.n), '{}'::jsonb)
        from (select coalesce(role, '(null)') as role, count(*) as n from public.profiles group by 1) x),
    'profiles_null_shopId', (select count(*) from public.profiles where "shopId" is null),
    'admins_whose_shopId_is_not_own_id', (
      select count(*) from public.profiles where role = 'admin' and "shopId" is distinct from id),
    'legacy_public_users_rows', (select count(*) from public.users)),

  'row_counts', (
    select coalesce(jsonb_object_agg(t.relname,
      (xpath('/row/n/text()', query_to_xml(format($q$select count(*) as n from public.%I$q$, t.relname),
                                          false, true, '')))[1]::text::bigint), '{}'::jsonb)
      from tbl t)
)) as integrity_probe;
