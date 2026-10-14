-- =====================================================================
-- 20261011120000_emergency_security_lockdown.sql
-- PHASE 0: emergency security fix for the LIVE database.
--
-- What it does:
--   1. Removes all access for anonymous (not logged in) visitors.
--   2. Turns Row Level Security back ON for profiles, so nobody can change
--      their own role or shop, and nobody can edit other users' profiles.
--   3. Secures process_checkout / process_reversal / process_stock_adjustment:
--      a real login + shop-membership check, every write limited to the
--      caller's own shop, a fixed search_path, and no anonymous execute.
--   4. process_checkout becomes replay-safe: if a sale was already saved,
--      a retry does nothing instead of deducting stock and credit again.
--   5. process_reversal with delete=true becomes double-click-safe: if the
--      sale is already gone, stock and credit are not restored a second time.
--   6. Removes the "allow everyone" policies on inventory_alerts.
--   7. Adds the missing "updatedAt" column to profiles and expenses, so
--      editing a profile, cashier or expense stops failing.
--
-- Compatible with the app version deployed today: no frontend change needed.
-- Safe to run more than once. Runs as one transaction: if any statement
-- fails, nothing is changed.
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this
-- whole file -> Run. Then run supabase/diagnostics/verify_20261011120000.sql
-- and paste the result back.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Private schema for helper functions (not exposed through the API)
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

-- True when the logged-in user belongs to the shop: either they ARE the
-- shop (admin: shopId = their own uid) or their profile points at it.
create or replace function private.is_shop_member(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and p_shop is not null
     and (
       auth.uid() = p_shop
       or exists (
         select 1 from public.profiles p
         where p.id = auth.uid() and p."shopId" = p_shop
       )
     );
$$;
revoke all on function private.is_shop_member(uuid) from public;
revoke all on function private.is_shop_member(uuid) from anon;
grant execute on function private.is_shop_member(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 1. No access at all for anonymous visitors
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------------
-- 2. Missing columns the current app already writes
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists "updatedAt" timestamptz default now();
alter table public.expenses add column if not exists "updatedAt" timestamptz default now();

-- ---------------------------------------------------------------------
-- 3. profiles: RLS back on, safe policies, role/shopId not editable
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', r.policyname);
  end loop;
end $$;

-- Read: your own profile; a shop admin also reads their shop's cashiers.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or "shopId" = (select auth.uid()));

-- Insert (a): first login creates YOUR OWN profile as admin of YOUR OWN shop.
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (
    id = (select auth.uid())
    and role = 'admin'
    and "shopId" = (select auth.uid())
  );

-- Insert (b): a shop admin adds a cashier to THEIR OWN shop only.
create policy profiles_insert_cashier on public.profiles
  for insert to authenticated
  with check (
    role = 'cashier'
    and "shopId" = (select auth.uid())
    and id <> (select auth.uid())
  );

-- Update: own profile, or an admin editing their own cashiers' name/email.
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or "shopId" = (select auth.uid()))
  with check (id = (select auth.uid()) or "shopId" = (select auth.uid()));

-- Delete: an admin removes one of their cashiers (never themselves).
create policy profiles_delete on public.profiles
  for delete to authenticated
  using ("shopId" = (select auth.uid()) and id <> (select auth.uid()));

-- Column-level lock: role and shopId can never be changed through the API.
revoke update on public.profiles from authenticated;
grant update (username, email, "updatedAt") on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 4. inventory_alerts: remove the "everyone can read/write" policies
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  if to_regclass('public.inventory_alerts') is not null then
    for r in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'inventory_alerts'
    loop
      execute format('drop policy %I on public.inventory_alerts', r.policyname);
    end loop;
    execute 'alter table public.inventory_alerts enable row level security';
    execute $p$create policy inventory_alerts_shop on public.inventory_alerts
               for all to authenticated
               using (private.is_shop_member(shop_id))
               with check (private.is_shop_member(shop_id))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. process_checkout: same signature as today, now secured + replay-safe
-- ---------------------------------------------------------------------
create or replace function public.process_checkout(
  p_shop_id text,
  p_sale_data jsonb,
  p_product_updates jsonb,
  p_bottle_updates jsonb,
  p_inventory_logs jsonb,
  p_customer_id text default null,
  p_credit_increment numeric default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_prod jsonb;
  v_bot  jsonb;
  v_log  jsonb;
begin
  begin
    v_shop := p_shop_id::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid shop id' using errcode = '22023';
  end;

  if not private.is_shop_member(v_shop) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;

  if p_sale_data is null or coalesce(p_sale_data->>'id', '') = '' then
    raise exception 'Sale id is required' using errcode = '22023';
  end if;

  -- 1. Insert the sale. If this sale id already exists (a retry of a sale
  --    that was already saved), stop here so stock and credit are NOT
  --    applied a second time.
  insert into public.sales (
    id, "shopId", "customerId", items, "totalAmount", "paymentMethod",
    "splitAmounts", "saleDate", "saleDateClient", "actorName", "actorRole",
    "totalCOGS", "totalProfit", "createdAt", "updatedAt"
  )
  values (
    p_sale_data->>'id',
    v_shop,
    nullif(trim(coalesce(p_sale_data->>'customerId', '')), ''),
    p_sale_data->'items',
    (p_sale_data->>'totalAmount')::numeric,
    p_sale_data->>'paymentMethod',
    p_sale_data->'splitAmounts',
    coalesce((p_sale_data->>'saleDate')::timestamptz, now()),
    p_sale_data->>'saleDateClient',
    p_sale_data->>'actorName',
    p_sale_data->>'actorRole',
    (p_sale_data->>'totalCOGS')::numeric,
    (p_sale_data->>'totalProfit')::numeric,
    coalesce((p_sale_data->>'createdAt')::timestamptz, now()),
    now()
  )
  on conflict (id) do nothing;

  if not found then
    return;
  end if;

  -- 2. Stock deductions: only this shop's products
  for v_prod in select * from jsonb_array_elements(coalesce(p_product_updates, '[]'::jsonb))
  loop
    update public.products
       set "stockQuantity" = coalesce("stockQuantity", 0) - coalesce((v_prod->>'deduction')::numeric, 0),
           "updatedAt"     = now()
     where id = v_prod->>'id'
       and "shopId" = v_shop;
  end loop;

  -- 3. Bottle upserts: new bottles go into this shop; existing bottles are
  --    updated only if they belong to this shop.
  for v_bot in select * from jsonb_array_elements(coalesce(p_bottle_updates, '[]'::jsonb))
  loop
    insert into public.bottles as b (
      id, "productId", "shopId", "bottleSize", "remainingMl", status,
      "openedDate", "createdAt", "updatedAt"
    )
    values (
      v_bot->>'id',
      v_bot->>'productId',
      v_shop,
      (v_bot->>'bottleSize')::numeric,
      (v_bot->>'remainingMl')::numeric,
      v_bot->>'status',
      nullif(trim(coalesce(v_bot->>'openedDate', '')), '')::timestamptz,
      now(),
      now()
    )
    on conflict (id) do update set
      "remainingMl" = excluded."remainingMl",
      status        = excluded.status,
      "openedDate"  = coalesce(excluded."openedDate", b."openedDate"),
      "updatedAt"   = now()
    where b."shopId" = excluded."shopId";
  end loop;

  -- 4. Inventory logs: always recorded under this shop, with the real user id
  for v_log in select * from jsonb_array_elements(coalesce(p_inventory_logs, '[]'::jsonb))
  loop
    insert into public.inventory_logs (
      id, "productId", "productName", "shopId", action, type, change,
      "quantityChange", "mlChange", "newStock", reason, notes,
      "actorName", "actorRole", "createdAtClient", "createdAt", "createdBy"
    )
    values (
      v_log->>'id',
      v_log->>'productId',
      v_log->>'productName',
      v_shop,
      v_log->>'action',
      v_log->>'type',
      (v_log->>'change')::numeric,
      (v_log->>'quantityChange')::numeric,
      nullif(v_log->>'mlChange', '')::numeric,
      nullif(v_log->>'newStock', '')::numeric,
      v_log->>'reason',
      v_log->>'notes',
      v_log->>'actorName',
      v_log->>'actorRole',
      v_log->>'createdAtClient',
      coalesce((v_log->>'createdAt')::timestamptz, now()),
      auth.uid()::text
    )
    on conflict (id) do nothing;
  end loop;

  -- 5. Customer credit (udhaar): only this shop's customer
  if p_customer_id is not null
     and trim(p_customer_id) <> ''
     and coalesce(p_credit_increment, 0) > 0
  then
    update public.customers
       set "creditBalance" = coalesce("creditBalance", 0) + p_credit_increment,
           "updatedAt"     = now()
     where id = p_customer_id
       and "shopId" = v_shop;
  end if;
end;
$$;

revoke all on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) from public;
revoke all on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) from anon;
grant execute on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 6. process_reversal: same signature as today, now secured
-- ---------------------------------------------------------------------
create or replace function public.process_reversal(
  p_shop_id uuid,
  p_sale_id text,
  p_delete_sale boolean,
  p_inventory_logs jsonb,
  p_bottle_updates jsonb,
  p_product_updates jsonb,
  p_customer_id text,
  p_credit_decrement numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;

  -- 1. Delete the sale (only from this shop). If it is already gone
  --    (double click, retry, two devices), stop: do NOT restore stock or
  --    credit a second time.
  if p_delete_sale then
    delete from public.sales
     where id = p_sale_id
       and "shopId" = p_shop_id;
    if not found then
      return;
    end if;
  end if;

  -- 2. Inventory logs: always under this shop, with the real user id
  insert into public.inventory_logs (
    id, "shopId", "productId", "productName", type, action,
    "quantityChange", "previousStock", "newStock", change,
    "mlChange", "newStockMl", reason, notes, "actorName",
    "userName", "actorRole", "createdAtClient", "createdAt", "createdBy"
  )
  select
    r.id, p_shop_id, r."productId", r."productName", r.type, r.action,
    r."quantityChange", r."previousStock", r."newStock", r.change,
    r."mlChange", r."newStockMl", r.reason, r.notes, r."actorName",
    r."userName", r."actorRole", r."createdAtClient",
    coalesce(r."createdAt", now()), auth.uid()::text
  from jsonb_populate_recordset(null::public.inventory_logs, coalesce(p_inventory_logs, '[]'::jsonb)) r
  where r.id is not null
  on conflict (id) do nothing;

  -- 3. Restore bottles: only this shop's bottles
  for v_rec in select * from jsonb_array_elements(coalesce(p_bottle_updates, '[]'::jsonb))
  loop
    update public.bottles
       set "remainingMl" = (v_rec.value->>'remainingMl')::numeric,
           status        = v_rec.value->>'status',
           "openedDate"  = case
                             when v_rec.value->>'openedDate' is not null
                             then (v_rec.value->>'openedDate')::timestamptz
                             else null
                           end,
           "updatedAt"   = coalesce((v_rec.value->>'updatedAt')::timestamptz, now())
     where id = v_rec.value->>'bottleId'
       and "shopId" = p_shop_id;
  end loop;

  -- 4. Restore stock: only this shop's products
  for v_rec in select * from jsonb_array_elements(coalesce(p_product_updates, '[]'::jsonb))
  loop
    update public.products
       set "stockQuantity" = coalesce("stockQuantity", 0) + coalesce((v_rec.value->>'addition')::numeric, 0),
           "updatedAt"     = now()
     where id = v_rec.value->>'productId'
       and "shopId" = p_shop_id;
  end loop;

  -- 5. Reduce customer credit: only this shop's customer
  if p_customer_id is not null and coalesce(p_credit_decrement, 0) > 0 then
    update public.customers
       set "creditBalance" = coalesce("creditBalance", 0) - p_credit_decrement,
           "updatedAt"     = now()
     where id = p_customer_id
       and "shopId" = p_shop_id;
  end if;
end;
$$;

revoke all on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) from public;
revoke all on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) from anon;
grant execute on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 7. process_stock_adjustment: drop the broken uuid overload (it made
--    every call ambiguous) and secure the text version. The app does not
--    call it today; it is kept for the sync engine's existing handler.
-- ---------------------------------------------------------------------
drop function if exists public.process_stock_adjustment(uuid, uuid, jsonb, jsonb, jsonb, jsonb);

create or replace function public.process_stock_adjustment(
  p_shop_id uuid,
  p_product_id text,
  p_product_update jsonb,
  p_bottle_updates jsonb,
  p_bottle_inserts jsonb,
  p_inventory_logs jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;

  if p_product_update is not null then
    update public.products
       set name            = p_product_update->>'name',
           category        = p_product_update->>'category',
           "costPrice"     = (p_product_update->>'costPrice')::numeric,
           "sellingPrice"  = (p_product_update->>'sellingPrice')::numeric,
           "minStockLevel" = (p_product_update->>'minStockLevel')::numeric,
           unit            = p_product_update->>'unit',
           "bottleSize"    = p_product_update->>'bottleSize',
           "unitCostPerMl" = (p_product_update->>'unitCostPerMl')::numeric,
           "pricePerMl"    = (p_product_update->>'pricePerMl')::numeric,
           "stockQuantity" = (p_product_update->>'stockQuantity')::numeric,
           "updatedAt"     = now()
     where id = p_product_id
       and "shopId" = p_shop_id;
  end if;

  for v_rec in select * from jsonb_array_elements(coalesce(p_bottle_updates, '[]'::jsonb))
  loop
    update public.bottles
       set "remainingMl" = (v_rec.value->>'remainingMl')::numeric,
           status        = v_rec.value->>'status',
           "openedDate"  = case
                             when v_rec.value->>'openedDate' is not null
                             then (v_rec.value->>'openedDate')::timestamptz
                             else "openedDate"
                           end,
           "updatedAt"   = now()
     where id = v_rec.value->>'id'
       and "shopId" = p_shop_id;
  end loop;

  insert into public.bottles (
    id, "productId", "shopId", "bottleSize", "remainingMl", status,
    "openedDate", "createdAt", "updatedAt"
  )
  select
    coalesce(r.id, gen_random_uuid()::text), r."productId", p_shop_id,
    r."bottleSize", r."remainingMl", coalesce(r.status, 'closed'),
    r."openedDate", coalesce(r."createdAt", now()), now()
  from jsonb_populate_recordset(null::public.bottles, coalesce(p_bottle_inserts, '[]'::jsonb)) r;

  insert into public.inventory_logs (
    id, "shopId", "productId", "productName", type, action,
    "quantityChange", "previousStock", "newStock", change,
    "mlChange", "newStockMl", reason, notes, "actorName",
    "userName", "actorRole", "createdAtClient", "createdAt", "createdBy"
  )
  select
    r.id, p_shop_id, r."productId", r."productName", r.type, r.action,
    r."quantityChange", r."previousStock", r."newStock", r.change,
    r."mlChange", r."newStockMl", r.reason, r.notes, r."actorName",
    r."userName", r."actorRole", r."createdAtClient",
    coalesce(r."createdAt", now()), auth.uid()::text
  from jsonb_populate_recordset(null::public.inventory_logs, coalesce(p_inventory_logs, '[]'::jsonb)) r
  where r.id is not null
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.process_stock_adjustment(uuid, text, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.process_stock_adjustment(uuid, text, jsonb, jsonb, jsonb, jsonb) from anon;
grant execute on function public.process_stock_adjustment(uuid, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- New functions created later in public must not be executable by everyone
-- by default.
alter default privileges in schema public revoke execute on functions from public;

-- Tell the API layer to reload the schema (new columns, new grants).
notify pgrst, 'reload schema';

commit;
