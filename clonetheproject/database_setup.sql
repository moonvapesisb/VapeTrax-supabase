-- =====================================================================
-- VapeTrax: COMPLETE DATABASE SETUP FOR A NEW SUPABASE PROJECT
-- =====================================================================
-- Paste this WHOLE file into a NEW, EMPTY Supabase project:
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- It takes up to a minute. The last result must show  "all_ok": true
-- (read clonetheproject/HOW_TO_SET_UP.md for every step).
--
-- It creates every table, security rule, function and trigger of the
-- original VapeTrax database. It contains NO shop data.
-- Everything runs as one transaction: if any error appears, NOTHING was
-- created. Copy the error, fix the cause, and run the whole file again.
--
-- Do NOT run this on the original shop's database, and do NOT run it twice
-- on the same project: it is meant for an empty project only.
--
-- GENERATED FILE: do not edit by hand. Rebuild with
--   npm run build:clone-sql
-- Database version: 20261012200000
-- Included migrations (in this order):
--   20261011120000_emergency_security_lockdown.sql
--   20261011140000_stock_never_negative_refill_steps.sql
--   20261012100000_lockdown_followup.sql
--   20261012200000_shop_links_and_transfers.sql
-- =====================================================================
begin;

-- Stop early if this project already has the VapeTrax tables.
do $guard$
begin
  if to_regclass('public.sales') is not null or to_regclass('public.products') is not null then
    raise exception 'STOPPED: this project already has VapeTrax tables. This file is only for a NEW, EMPTY Supabase project. Nothing was changed.';
  end if;
end $guard$;

-- ===== Part 1: tables =====

-- =====================================================================
-- supabase/clone/base_schema.sql
-- Part 1 of clonetheproject/database_setup.sql (built by
-- scripts/build-clone-sql.mjs). Do not paste this file on its own.
--
-- Creates the VapeTrax tables on a NEW, EMPTY Supabase project, exactly as
-- the original project's tables were before the migrations in
-- supabase/migrations/ (see supabase/rehearsal/replica.sql, which this
-- mirrors). The migrations that follow in the bundle then add every
-- security rule, function and later column. No data is copied.
--
-- Not created here, because every Supabase project already has them:
-- the anon/authenticated/service_role roles, the auth schema, auth.uid(),
-- the default privileges and the supabase_realtime publication.
-- =====================================================================

create extension if not exists "uuid-ossp" with schema extensions;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  email       text,
  role        text not null default 'admin' check (role in ('admin', 'cashier')),
  "shopId"    uuid references auth.users(id),
  "createdAt" timestamptz default now()
);

create table if not exists public.products (
  id              text primary key,
  "shopId"        uuid not null references auth.users(id),
  name            text not null,
  category        text,
  brand           text,
  "costPrice"     numeric default 0,
  "sellingPrice"  numeric default 0,
  "stockQuantity" numeric default 0,
  "minStockLevel" numeric default 0,
  unit            text,
  "bottleSize"    text,
  "nicotineLevel" numeric,
  "imageUrl"      text,
  "createdAt"     timestamptz default now(),
  "updatedAt"     timestamptz default now(),
  "pricePerMl"    numeric default 0,
  "unitCostPerMl" numeric default 0,
  "lowStockAlert" numeric,
  "createdAtClient" text
);

create table if not exists public.bottles (
  id            text primary key,
  "productId"   text not null,
  "shopId"      uuid not null references auth.users(id),
  "bottleSize"  numeric,
  "remainingMl" numeric,
  status        text default 'closed' check (status in ('closed', 'opened', 'empty', 'sold')),
  "openedDate"  timestamptz,
  "createdAt"   timestamptz default now(),
  "updatedAt"   timestamptz default now()
);

create table if not exists public.customers (
  id                text primary key,
  "shopId"          uuid not null references auth.users(id),
  name              text not null,
  phone             text,
  email             text,
  "creditBalance"   numeric default 0,
  "createdAt"       timestamptz default now(),
  "createdAtClient" text,
  "updatedAt"       timestamptz default now()
);

create table if not exists public.sales (
  id               text primary key,
  "shopId"         uuid not null references auth.users(id),
  "customerId"     text,
  "totalAmount"    numeric not null default 0,
  "totalProfit"    numeric default 0,
  "paymentMethod"  text,
  items            jsonb default '[]'::jsonb,
  "saleDate"       timestamptz,
  "saleDateClient" text,
  notes            text,
  "splitAmounts"   jsonb,
  "createdAt"      timestamptz default now(),
  "totalCOGS"      numeric default 0,
  "actorName"      text,
  "actorRole"      text,
  "userName"       text,
  "updatedAt"      timestamptz default now()
);

create table if not exists public.credits (
  id                text primary key,
  "shopId"          uuid not null references auth.users(id),
  "creditType"      text check ("creditType" in ('customer', 'supplier', 'others')),
  "customerId"      text,
  "supplierId"      text,
  "entityName"      text,
  "entityContact"   text,
  amount            numeric not null default 0,
  description       text,
  "transactionType" text check ("transactionType" in ('given', 'taken')),
  "createdBy"       text,
  "actorName"       text,
  "actorRole"       text,
  "createdAtClient" text,
  "createdAt"       timestamptz default now()
);

create table if not exists public.inventory_logs (
  id               text primary key,
  "shopId"         uuid not null references auth.users(id),
  "productId"      text,
  "productName"    text,
  type             text,
  action           text,
  "quantityChange" numeric,
  "previousStock"  numeric,
  "newStock"       numeric,
  change           numeric,
  "mlChange"       numeric,
  "newStockMl"     numeric,
  reason           text,
  notes            text,
  "actorName"      text,
  "userName"       text,
  "actorRole"      text,
  "createdAtClient" text,
  "createdAt"      timestamptz default now(),
  "createdBy"      text
);

create table if not exists public.expenses (
  id                text primary key,
  "shopId"          uuid not null references auth.users(id),
  category          text,
  description       text,
  amount            numeric not null default 0,
  "expenseDate"     timestamptz,
  "createdAtClient" text,
  "createdAt"       timestamptz default now(),
  "actorName"       text,
  "actorRole"       text,
  "createdBy"       text
);

create table if not exists public.personal_expenses (
  id                text primary key,
  "shopId"          uuid not null references auth.users(id),
  category          text,
  description       text,
  amount            numeric default 0,
  "createdAtClient" text,
  "createdAt"       timestamptz default now()
);

create table if not exists public.settings (
  "shopId"              uuid primary key references auth.users(id),
  "shopName"            text,
  "shopLogo"            text,
  "logoUrl"             text,
  "shopAddress"         text,
  "shopPhone"           text,
  "shopEmail"           text,
  "shopWebsite"         text,
  currency              text default 'Rs',
  "invoicePrefix"       text default 'INV-',
  "invoiceFooter"       text default 'Thank you for your business!',
  "lowStockThreshold"   numeric default 5,
  "themeColor"          text default '#8b5cf6',
  "accentColor"         text default '#d946ef',
  "showShopAddress"     boolean default true,
  "showShopPhone"       boolean default true,
  "showShopEmail"       boolean default true,
  "showCustomerDetails" boolean default true,
  "showPaymentMethod"   boolean default true,
  "showTaxDetails"      boolean default false,
  "taxRate"             numeric default 0,
  "footerMessage"       text,
  "lastBackupDate"      text,
  "updatedAt"           timestamptz default now()
);

-- Older tables the app no longer uses. The migrations lock them (no access);
-- they are created so the database matches the original exactly.
create table if not exists public.daily_summaries (
  id            text primary key,
  "shopId"      uuid not null references auth.users(id),
  "summaryDate" date,
  data          jsonb default '{}'::jsonb,
  "createdAt"   timestamptz default now()
);

create table if not exists public.finance_accounts (
  id          text primary key,
  "shopId"    uuid not null references auth.users(id),
  name        text,
  type        text,
  balance     numeric default 0,
  "createdAt" timestamptz default now()
);

create table if not exists public.finance_transactions (
  id              text primary key,
  "shopId"        uuid not null references auth.users(id),
  "accountId"     text references public.finance_accounts(id),
  type            text,
  amount          numeric,
  description     text,
  "referenceId"   text,
  "referenceType" text,
  "createdAt"     timestamptz default now()
);

create table if not exists public.stock_alerts (
  id          text primary key,
  "shopId"    uuid not null references auth.users(id),
  "productId" text references public.products(id),
  threshold   numeric,
  active      boolean default true,
  "createdAt" timestamptz default now()
);

create table if not exists public.users (
  id         uuid primary key default extensions.uuid_generate_v4(),
  email      text not null,
  username   text not null,
  role       text not null check (role in ('admin', 'cashier')),
  shop_id    uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint users_email_key unique (email)
);

create table if not exists public.suppliers (
  id             uuid primary key default extensions.uuid_generate_v4(),
  shop_id        uuid not null,
  name           text not null,
  contact_number text,
  email          text,
  city           text,
  created_at     timestamptz default now()
);

create table if not exists public.purchases (
  id             uuid primary key default extensions.uuid_generate_v4(),
  shop_id        uuid not null,
  supplier_id    uuid not null references public.suppliers(id),
  product_id     text not null,
  quantity       numeric not null,
  purchase_price numeric not null,
  purchase_date  timestamptz not null,
  created_at     timestamptz default now()
);

-- Shortfall alerts shown on the Products page ("please recount").
create table if not exists public.inventory_alerts (
  id           uuid primary key default extensions.uuid_generate_v4(),
  shop_id      uuid not null,
  product_id   text not null,
  product_name text not null,
  message      text not null,
  resolved     boolean default false,
  created_at   timestamptz default now(),
  resolved_at  timestamptz
);

-- On the original project this table had no grants until the migrations
-- gave members read access and "mark resolved" only. A new project's default
-- privileges would grant everything, so take them back first.
revoke all on public.inventory_alerts from anon, authenticated, service_role;

-- Row Level Security on every table before anything else can reach them.
-- The migrations below add the real rules.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;


-- ===== Migration 20261011120000_emergency_security_lockdown.sql =====

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


-- ===== Migration 20261011140000_stock_never_negative_refill_steps.sql =====

-- ---------------------------------------------------------------------
-- 1. Repair: reset any negative stock to 0, with an audit log entry
-- ---------------------------------------------------------------------
insert into public.inventory_logs (
  id, "shopId", "productId", "productName", type, action, change,
  "quantityChange", "previousStock", "newStock", reason, notes,
  "actorName", "actorRole", "createdAtClient", "createdAt"
)
select
  gen_random_uuid()::text, p."shopId", p.id, p.name, 'correction', 'correction',
  -p."stockQuantity", -p."stockQuantity", p."stockQuantity", 0,
  'Automatic correction: stock was below zero',
  'Stock reset to 0 by the never-negative rule. Please recount this product.',
  'System', 'system',
  to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), now()
from public.products p
where p."stockQuantity" < 0;

update public.products
   set "stockQuantity" = 0, "updatedAt" = now()
 where "stockQuantity" < 0;

update public.bottles
   set "remainingMl" = 0, status = 'empty', "updatedAt" = now()
 where "remainingMl" < 0;

-- ---------------------------------------------------------------------
-- 2. Database rules: stock and bottle ml can never be negative
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'products_stock_not_negative'
                   and conrelid = 'public.products'::regclass) then
    alter table public.products
      add constraint products_stock_not_negative check ("stockQuantity" >= 0);
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'bottles_remaining_not_negative'
                   and conrelid = 'public.bottles'::regclass) then
    alter table public.bottles
      add constraint bottles_remaining_not_negative check ("remainingMl" >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2b. Shortfall alerts: make sure product_id is text (products use text
--     ids), and let shop members read their alerts and mark them resolved
--     (the Stock page shows them). Insert/delete stay server-only.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'inventory_alerts'
               and column_name = 'product_id' and data_type = 'uuid') then
    alter table public.inventory_alerts alter column product_id type text using product_id::text;
  end if;
end $$;

grant select on public.inventory_alerts to authenticated;

grant update (resolved, resolved_at) on public.inventory_alerts to authenticated;

-- ---------------------------------------------------------------------
-- 3. process_checkout: same signature; adds the stock and refill rules
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
  v_shop      uuid;
  v_item      jsonb;
  v_prod      jsonb;
  v_bot       jsonb;
  v_log       jsonb;
  v_qty       numeric;
  v_ml        numeric;
  v_deduction numeric;
  v_name      text;
  v_category  text;
  v_stock     numeric;
  v_unit      text;
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

  -- 1. Insert the sale. A retry of a sale that was already saved stops here,
  --    so stock and credit are never applied twice.
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

  -- 2. Sale lines: whole-number quantities; refills only in 0.5 ml steps.
  --    (Checked after the insert so an already-saved sale replays as a no-op;
  --    an error here rolls the insert back too.)
  for v_item in select * from jsonb_array_elements(coalesce(p_sale_data->'items', '[]'::jsonb))
  loop
    v_qty := (v_item->>'quantity')::numeric;
    -- (">= 100000" also rejects NaN and Infinity, which pass the other tests)
    if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) or v_qty >= 100000 then
      raise exception 'Quantity for "%" must be a whole number above zero (got %).',
        coalesce(v_item->>'productName', '?'), coalesce(v_item->>'quantity', 'nothing')
        using errcode = '22023';
    end if;
    if v_item->>'saleType' = 'refill' then
      v_ml := (v_item->>'refillAmount')::numeric;
      if v_ml is null or v_ml <= 0 or (v_ml * 2) <> trunc(v_ml * 2) or v_ml >= 100000 then
        raise exception 'Refill for "%" must be in 0.5 ml steps (0.5, 1, 1.5 ...), not % ml.',
          coalesce(v_item->>'productName', '?'), coalesce(v_item->>'refillAmount', 'nothing')
          using errcode = '22023';
      end if;
    end if;
  end loop;

  -- 3. Stock deductions: only this shop's products, and NEVER below zero.
  --    The POS blocks sales at the counter when stock is short. If a sale
  --    still arrives short (made offline, or two devices sold the last unit
  --    at the same moment), the goods have already left the shop: the sale
  --    is kept, stock stops at 0, and a "shortfall - please recount" log and
  --    alert are written for the owner.
  for v_prod in select * from jsonb_array_elements(coalesce(p_product_updates, '[]'::jsonb))
  loop
    v_deduction := coalesce((v_prod->>'deduction')::numeric, 0);
    if v_deduction < 0 or v_deduction >= 1000000 then
      raise exception 'Invalid stock deduction (%).', v_deduction using errcode = '22023';
    end if;

    update public.products
       set "stockQuantity" = coalesce("stockQuantity", 0) - v_deduction,
           "updatedAt"     = now()
     where id = v_prod->>'id'
       and "shopId" = v_shop
       and coalesce("stockQuantity", 0) >= v_deduction;

    if not found then
      select p.name, p.category, coalesce(p."stockQuantity", 0)
        into v_name, v_category, v_stock
        from public.products p
       where p.id = v_prod->>'id' and p."shopId" = v_shop
       for update;
      if found and v_stock >= v_deduction then
        -- A restock committed in between (we waited for its lock): normal deduction.
        update public.products
           set "stockQuantity" = v_stock - v_deduction, "updatedAt" = now()
         where id = v_prod->>'id' and "shopId" = v_shop;
      elsif found then
        v_unit := case when v_category = 'e-liquid' then 'ml' else 'pcs' end;

        update public.products
           set "stockQuantity" = 0, "updatedAt" = now()
         where id = v_prod->>'id' and "shopId" = v_shop;

        insert into public.inventory_logs (
          id, "shopId", "productId", "productName", type, action, change,
          "quantityChange", "previousStock", "newStock", reason, notes,
          "actorName", "actorRole", "createdAtClient", "createdAt", "createdBy"
        )
        values (
          gen_random_uuid()::text, v_shop, v_prod->>'id', v_name, 'correction', 'shortfall',
          -v_stock, -v_stock, v_stock, 0,
          format('Stock shortfall on sale %s: sold %s %s but only %s %s was in stock',
                 right(p_sale_data->>'id', 6), v_deduction, v_unit, v_stock, v_unit),
          'Stock stopped at 0 (it can never go below zero). Please recount this product.',
          'System', 'system',
          to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), now(),
          auth.uid()::text
        );

        -- Best effort: the alert must never be the reason a sale is lost.
        begin
          insert into public.inventory_alerts (shop_id, product_id, product_name, message)
          values (
            v_shop, v_prod->>'id', v_name,
            format('Shortfall: sold %s %s but only %s %s was in stock. Please recount.',
                   v_deduction, v_unit, v_stock, v_unit)
          );
        exception when others then
          raise warning 'Shortfall alert not written: %', sqlerrm;
        end;
      end if;
      -- Product no longer exists in this shop (deleted): nothing to deduct.
    end if;
  end loop;

  -- 4. Bottle upserts: new bottles go into this shop; existing bottles are
  --    updated only if they belong to this shop. (ml >= 0 is a table rule.)
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

  -- 5. Inventory logs: always under this shop, with the real user id
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

  -- 6. Customer credit (udhaar): only this shop's customer
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
-- 4. process_reversal: same as 20261011120000, plus: restore amounts can
--    never be negative (a negative "restore" would reduce stock)
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
  v_rec      record;
  v_addition numeric;
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;

  if p_delete_sale then
    delete from public.sales
     where id = p_sale_id
       and "shopId" = p_shop_id;
    if not found then
      return;
    end if;
  end if;

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

  for v_rec in select * from jsonb_array_elements(coalesce(p_product_updates, '[]'::jsonb))
  loop
    v_addition := coalesce((v_rec.value->>'addition')::numeric, 0);
    if v_addition < 0 then
      raise exception 'Invalid stock restore amount (%).', v_addition using errcode = '22023';
    end if;
    update public.products
       set "stockQuantity" = coalesce("stockQuantity", 0) + v_addition,
           "updatedAt"     = now()
     where id = v_rec.value->>'productId'
       and "shopId" = p_shop_id;
  end loop;

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

notify pgrst, 'reload schema';


-- ===== Migration 20261012100000_lockdown_followup.sql =====

set local lock_timeout = '5s';

set local statement_timeout = '5min';

-- ---------------------------------------------------------------------
-- 0. Precondition, ledger and private helpers
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.is_shop_member(uuid)') is null then
    raise exception 'apply 20261011120000 first';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
                 where conname = 'products_stock_not_negative'
                   and conrelid = 'public.products'::regclass) then
    raise exception 'apply 20261011140000 first';
  end if;
end $$;

create table if not exists private.schema_migrations (
  version     text primary key,
  name        text not null,
  "appliedAt" timestamptz not null default now(),
  note        text
);

create table if not exists private.app_config (
  key         text primary key,
  value       jsonb,
  "updatedAt" timestamptz not null default now()
);

create table if not exists private.policy_snapshots (
  label      text not null,
  schemaname text not null,
  tablename  text not null,
  policyname text not null,
  permissive text,
  roles      text[],
  cmd        text,
  qual       text,
  with_check text,
  "takenAt"  timestamptz not null default now(),
  primary key (label, schemaname, tablename, policyname)
);

create table if not exists private.function_snapshots (
  label      text not null,
  signature  text not null,
  definition text not null,
  acl        text,
  "takenAt"  timestamptz not null default now(),
  primary key (label, signature)
);

create table if not exists private.repair_log (
  id         bigserial primary key,
  "loggedAt" timestamptz not null default now(),
  "shopId"   uuid,
  kind       text not null,
  "refTable" text,
  "refId"    text,
  detail     jsonb,
  "actorId"  uuid
);

-- reason: 'app delete' (a delete sent by the app), 'sale delete' or
-- 'sale edit' (process_reversal; an edit puts the same sale id back).
create table if not exists private.deleted_rows (
  id            bigserial primary key,
  "table"       text not null,
  "rowId"       text,
  "shopId"      uuid,
  "row"         jsonb not null,
  "deletedBy"   uuid,
  "deletedAt"   timestamptz not null default now(),
  "clientBuild" text,
  reason        text
);

-- What a sale that arrived short could NOT take off (requested - applied),
-- per product, for the sale currently stored under that id. A reversal
-- puts back only what was really taken off, then clears these rows.
create table if not exists private.sale_shortfalls (
  id          bigserial primary key,
  "shopId"    uuid not null,
  "saleId"    text not null,
  "productId" text not null,
  requested   numeric not null,
  applied     numeric not null,
  "createdAt" timestamptz not null default now()
);

create index if not exists sale_shortfalls_sale on private.sale_shortfalls ("shopId", "saleId");

create table if not exists private.legacy_rpc_calls (
  day           date not null,
  "shopId"      uuid not null,
  fn            text not null,
  "clientBuild" text not null default 'unknown',
  "deviceId"    text not null default 'unknown',
  calls         integer not null default 0,
  "firstAt"     timestamptz not null default now(),
  "lastAt"      timestamptz not null default now(),
  primary key (day, "shopId", fn, "clientBuild", "deviceId")
);

revoke all on all tables in schema private from public, anon, authenticated;

revoke all on all sequences in schema private from public, anon, authenticated;

insert into private.schema_migrations (version, name, "appliedAt", note) values
  ('20261011120000', '20261011120000_emergency_security_lockdown.sql', '2026-10-11 00:00:00+05',
   'Applied on 2026-10-11, before this ledger existed (recorded by 20261012100000).'),
  ('20261011140000', '20261011140000_stock_never_negative_refill_steps.sql', '2026-10-11 00:00:00+05',
   'Applied on 2026-10-11, before this ledger existed (recorded by 20261012100000).')
on conflict (version) do nothing;

insert into private.app_config (key, value) values
  ('schema_version', '1'::jsonb),
  ('min_client_build', 'null'::jsonb)
on conflict (key) do nothing;

-- Numbers and dates sent by devices: never throw, NULL when unreadable.
create or replace function private.try_numeric(p text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(btrim(p), '')::numeric;
exception when others then
  return null;
end;
$$;

-- Like try_numeric, but NaN and +/-Infinity are NULL too.
create or replace function private.finite_numeric(p text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric := private.try_numeric(p);
begin
  if v is null or v = 'NaN'::numeric or abs(v) = 'Infinity'::numeric then
    return null;
  end if;
  return v;
end;
$$;

-- ISO text, Postgres text, Firestore {"_seconds": ...} JSON, epoch seconds
-- or milliseconds. NULL when unreadable or not finite.
create or replace function private.try_parse_ts(p text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := btrim(p);
  j jsonb;
  s numeric;
  r timestamptz;
begin
  if v is null or v = '' then
    return null;
  end if;
  if left(v, 1) = '{' then
    j := v::jsonb;
    s := coalesce(j->>'_seconds', j->>'seconds')::numeric;
    if s is null then
      return null;
    end if;
    r := pg_catalog.to_timestamp(s + coalesce(coalesce(j->>'_nanoseconds', j->>'nanoseconds')::numeric, 0) / 1000000000);
  elsif v ~ '^[0-9]{11,15}$' then
    r := pg_catalog.to_timestamp(v::numeric / 1000);
  elsif v ~ '^[0-9]{9,10}(\.[0-9]+)?$' then
    r := pg_catalog.to_timestamp(v::numeric);
  else
    r := v::timestamptz;
  end if;
  if r is null or not pg_catalog.isfinite(r) then
    return null;
  end if;
  return r;
exception when others then
  return null;
end;
$$;

-- '30ml', '30', '60 ML' -> 30 / 30 / 60; '', 'n/a', null -> NULL.
create or replace function private.bottle_size_ml(p text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric := private.finite_numeric(substring(coalesce(p, '') from '([0-9]+(\.[0-9]+)?)'));
begin
  return case when v > 0 then v end;
end;
$$;

-- Request telemetry. The app sends no custom headers today, so the build
-- usually comes from the payload (see count_legacy_call) or is 'unknown'.
create or replace function private.client_build()
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return coalesce(nullif(btrim(left(current_setting('request.headers', true)::json->>'x-client-build', 64)), ''), 'unknown');
exception when others then
  return 'unknown';
end;
$$;

create or replace function private.device_id(p_payload jsonb default null)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v text;
begin
  begin
    v := nullif(btrim(left(current_setting('request.headers', true)::json->>'x-device-id', 64)), '');
  exception when others then
    v := null;
  end;
  return coalesce(v, nullif(btrim(left(p_payload->>'deviceId', 64)), ''), 'unknown');
end;
$$;

-- Pass-through until step 2.8 (it will refuse builds below min_client_build).
create or replace function private.require_client_build()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  return;
end;
$$;

-- Counts every call of a legacy RPC per day, shop, build and device.
-- Never the reason a sale fails.
create or replace function private.count_legacy_call(p_shop uuid, p_fn text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_build  text;
  v_device text;
begin
  v_build := private.client_build();
  if v_build = 'unknown' then
    v_build := coalesce(nullif(btrim(left(p_payload->>'clientBuild', 64)), ''), 'unknown');
  end if;
  v_device := private.device_id(p_payload);
  insert into private.legacy_rpc_calls as c (day, "shopId", fn, "clientBuild", "deviceId", calls)
  values ((now() at time zone 'Asia/Karachi')::date, p_shop, p_fn, v_build, v_device, 1)
  on conflict (day, "shopId", fn, "clientBuild", "deviceId")
  do update set calls = c.calls + 1, "lastAt" = now();
exception when others then
  raise warning 'legacy_rpc_calls not counted: %', sqlerrm;
end;
$$;

-- Ledger helpers.
create or replace function private.require_migration(p_versions text[])
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_missing text[];
begin
  select array_agg(v order by v) into v_missing
    from unnest(p_versions) v
   where not exists (select 1 from private.schema_migrations m where m.version = v);
  if v_missing is not null then
    raise exception 'Apply these migrations first: %', array_to_string(v_missing, ', ');
  end if;
end;
$$;

create or replace function private.mark_migration(p_version text, p_name text, p_note text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into private.schema_migrations (version, name, note)
  values (p_version, p_name, p_note)
  on conflict (version) do nothing;
end;
$$;

-- Policy and function snapshots (for a later rollback by hand).
create or replace function private.drop_all_policies(p_schema text, p_table text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  for r in select policyname from pg_catalog.pg_policies
           where schemaname = p_schema and tablename = p_table
  loop
    execute format('drop policy %I on %I.%I', r.policyname, p_schema, p_table);
  end loop;
end;
$$;

create or replace function private.snapshot_policies(p_label text, p_schema text default 'public')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  -- A label is taken once: running a migration again keeps its first snapshot.
  if exists (select 1 from private.policy_snapshots where label = p_label) then
    return 0;
  end if;
  insert into private.policy_snapshots (label, schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
  select p_label, p.schemaname, p.tablename, p.policyname, p.permissive, p.roles::text[], p.cmd, p.qual, p.with_check
    from pg_catalog.pg_policies p
   where p.schemaname = p_schema
  on conflict (label, schemaname, tablename, policyname) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function private.restore_policies(p_label text, p_schema text, p_table text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  perform private.drop_all_policies(p_schema, p_table);
  for r in select * from private.policy_snapshots
           where label = p_label and schemaname = p_schema and tablename = p_table
           order by policyname
  loop
    execute format('create policy %I on %I.%I as %s for %s to %s%s%s',
      r.policyname, p_schema, p_table, r.permissive, r.cmd,
      (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ') from unnest(r.roles) x),
      case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function private.snapshot_functions(p_label text, p_signatures text[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if exists (select 1 from private.function_snapshots where label = p_label) then
    return 0;
  end if;
  insert into private.function_snapshots (label, signature, definition, acl)
  select p_label, s, pg_catalog.pg_get_functiondef(to_regprocedure(s)),
         (select p.proacl::text from pg_catalog.pg_proc p where p.oid = to_regprocedure(s))
    from unnest(p_signatures) s
   where to_regprocedure(s) is not null
  on conflict (label, signature) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- When the return type changed, CREATE OR REPLACE is refused: the function
-- is then dropped by its full signature and created again. (A function a
-- table rule depends on, like is_shop_member, keeps its return type and is
-- replaced in place.)
create or replace function private.restore_functions(p_label text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select * from private.function_snapshots where label = p_label order by signature
  loop
    begin
      execute r.definition;
    exception when invalid_function_definition then
      execute format('drop function %s', r.signature);
      execute r.definition;
    end;
    execute format('revoke all on function %s from public, anon', r.signature);
    if coalesce(r.acl, '') like '%authenticated=X%' then
      execute format('grant execute on function %s to authenticated', r.signature);
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Snapshot what this file replaces, before it changes anything (a later
-- rollback by hand: private.restore_functions / restore_policies).
select private.snapshot_functions('pre_20261012100000', array[
  'public.process_checkout(text,jsonb,jsonb,jsonb,jsonb,text,numeric)',
  'public.process_reversal(uuid,text,boolean,jsonb,jsonb,jsonb,text,numeric)',
  'public.process_stock_adjustment(uuid,text,jsonb,jsonb,jsonb,jsonb)',
  'private.is_shop_member(uuid)'
]);

select private.snapshot_policies('pre_20261012100000', 'public');

-- Shop membership, legacy model (owners -> shops comes in step 2.1):
-- the shop your profile points at, plus your own uid unless you are a
-- cashier (an owner's shop IS their uid; a new owner has no profile yet).
-- A cashier never gets their own uid, so they cannot put rows into a
-- "shop" of their own and hide them from the admin. Empty when logged out.
create or replace function private.legacy_shop_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when auth.uid() is null then '{}'::uuid[]
           when p.role = 'cashier' then array_remove(array[p."shopId"], null)
           else array_remove(array[auth.uid(), p."shopId"], null)
         end
    from (select 1) as one
    left join public.profiles p on p.id = auth.uid();
$$;

-- The one membership source: is_shop_member is redefined on top of it.
create or replace function private.is_shop_member(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_shop is not null and p_shop = any(private.legacy_shop_ids());
$$;

-- The shop admin: the shop IS their account, and their profile is admin
-- (or missing, as the deployed app treats a missing profile as admin).
create or replace function private.legacy_is_shop_admin(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and p_shop is not null
     and p_shop = auth.uid()
     and not exists (select 1 from public.profiles p
                     where p.id = auth.uid() and p.role is distinct from 'admin');
$$;

-- A login created in the last hour that has no profile yet: the only kind
-- of account an admin may link as a cashier.
create or replace function private.is_fresh_auth_user(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_uid is not null
     and exists (select 1 from auth.users u
                 where u.id = p_uid and u.created_at > now() - interval '1 hour')
     and not exists (select 1 from public.profiles p where p.id = p_uid);
$$;

-- ---------------------------------------------------------------------
-- 7 (first, the rules below use these columns). Additive fixes for the
--   deployed app: id defaults, archive columns, inventory_logs."refId".
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists "deletedAt"    timestamptz,
  add column if not exists "deletedBy"    uuid,
  add column if not exists "deleteReason" text;

alter table public.customers
  add column if not exists "deletedAt"    timestamptz,
  add column if not exists "deletedBy"    uuid,
  add column if not exists "deleteReason" text;

alter table public.bottles
  add column if not exists "archivedAt" timestamptz;

alter table public.inventory_logs
  add column if not exists "refId" text;

do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'bottles', 'customers', 'sales', 'credits', 'inventory_logs',
    'expenses', 'personal_expenses', 'daily_summaries', 'finance_accounts',
    'finance_transactions', 'stock_alerts'
  ] loop
    if to_regclass('public.' || quote_ident(t)) is not null
       and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t
                     and column_name = 'id' and data_type = 'text' and column_default is null)
    then
      execute format('alter table public.%I alter column id set default (pg_catalog.gen_random_uuid())::text', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. RLS on every public table, never forced; anon has nothing.
--    (Functions are re-checked at the end, after they are recreated.)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select c.relname, c.relrowsecurity, c.relforcerowsecurity
             from pg_catalog.pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  loop
    if not r.relrowsecurity then
      execute format('alter table public.%I enable row level security', r.relname);
    end if;
    if r.relforcerowsecurity then
      execute format('alter table public.%I no force row level security', r.relname);
    end if;
    execute format('revoke all on table public.%I from anon', r.relname);
    -- The app never needs these; TRUNCATE would also skip the delete guards.
    execute format('revoke truncate, references, trigger on table public.%I from authenticated', r.relname);
  end loop;
end $$;

revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------------
-- 2. profiles
-- ---------------------------------------------------------------------
drop policy if exists profiles_insert_cashier on public.profiles;

create policy profiles_insert_cashier on public.profiles
  for insert to authenticated
  with check (
    role = 'cashier'
    and "shopId" = (select auth.uid())
    and id <> (select auth.uid())
    and private.legacy_is_shop_admin("shopId")
    and private.is_fresh_auth_user(id)
  );

-- Defence in depth on top of the column grants (role and shopId are not
-- updatable by API users). Also stops the API's service role; the owner
-- (SQL Editor) and server functions are not affected.
create or replace function private.profiles_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon', 'service_role')
     and (new.role is distinct from old.role or new."shopId" is distinct from old."shopId") then
    raise exception 'A profile''s role and shop cannot be changed from the app.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function private.profiles_guard_update();

-- ---------------------------------------------------------------------
-- 3. settings: members read, the shop admin saves, nobody deletes
-- ---------------------------------------------------------------------
select private.drop_all_policies('public', 'settings');

create policy settings_select on public.settings
  for select to authenticated
  using ("shopId" = any ((select private.legacy_shop_ids())::uuid[]));

create policy settings_insert on public.settings
  for insert to authenticated
  with check ("shopId" = (select auth.uid()));

create policy settings_update on public.settings
  for update to authenticated
  using ("shopId" = (select auth.uid()))
  with check ("shopId" = (select auth.uid()));

revoke delete, truncate on public.settings from authenticated;

-- ---------------------------------------------------------------------
-- 4. Business tables
-- ---------------------------------------------------------------------
-- products, customers, bottles: archived rows are hidden from the app.
do $$
declare
  t   text;
  arc text;
begin
  foreach t in array array['products', 'customers', 'bottles'] loop
    arc := case when t = 'bottles' then 'archivedAt' else 'deletedAt' end;
    perform private.drop_all_policies('public', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using ("shopId" = any ((select private.legacy_shop_ids())::uuid[]) and %I is null)$p$,
                   t || '_select', t, arc);
    execute format($p$create policy %I on public.%I for insert to authenticated
                      with check ("shopId" = any ((select private.legacy_shop_ids())::uuid[]))$p$,
                   t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
                      using ("shopId" = any ((select private.legacy_shop_ids())::uuid[]))
                      with check ("shopId" = any ((select private.legacy_shop_ids())::uuid[]))$p$,
                   t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
                      using ("shopId" = any ((select private.legacy_shop_ids())::uuid[]))$p$,
                   t || '_delete', t);
  end loop;

  foreach t in array array['sales', 'expenses'] loop
    perform private.drop_all_policies('public', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                      using ("shopId" = any ((select private.legacy_shop_ids())::uuid[]))
                      with check ("shopId" = any ((select private.legacy_shop_ids())::uuid[]))$p$,
                   t || '_shop', t);
  end loop;

  -- credits and inventory_logs: read and add only (append-only).
  foreach t in array array['credits', 'inventory_logs'] loop
    perform private.drop_all_policies('public', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using ("shopId" = any ((select private.legacy_shop_ids())::uuid[]))$p$,
                   t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
                      with check ("shopId" = any ((select private.legacy_shop_ids())::uuid[]))$p$,
                   t || '_insert', t);
  end loop;
end $$;

-- Append-only, loudly: the app gets "permission denied" instead of a
-- silent "0 rows". The trigger also stops the API's service role.
revoke update, delete, truncate on public.credits, public.inventory_logs from authenticated;

create or replace function private.append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon', 'service_role') then
    raise exception '% is append-only: rows cannot be changed or removed from the app.', tg_table_name
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['credits', 'inventory_logs'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.append_only_guard()',
                   t || '_append_only', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.append_only_guard()',
                   t || '_no_truncate', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. personal_expenses: the shop admin only (14 live rows; the backup
--    exports them).
-- ---------------------------------------------------------------------
select private.drop_all_policies('public', 'personal_expenses');

create policy personal_expenses_admin on public.personal_expenses
  for all to authenticated
  using ("shopId" = (select auth.uid()))
  with check ("shopId" = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 6. Unused tables: no rules at all (with RLS on, that is deny-all).
--    inventory_alerts is in use (shortfall alerts) and is left as it is.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['finance_accounts', 'finance_transactions', 'daily_summaries',
                           'stock_alerts', 'users', 'suppliers', 'purchases'] loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      perform private.drop_all_policies('public', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. Delete safety for deletes made by the app (role authenticated).
--    Deletes inside the server functions (process_reversal) run as the
--    owner and are not affected.
-- ---------------------------------------------------------------------
create or replace function private.note_api_delete(p_table text, p_row jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n    integer;
  v_shop uuid;
begin
  if p_table not in ('products', 'customers', 'bottles', 'sales', 'expenses', 'personal_expenses', 'profiles') then
    raise exception 'note_api_delete: % is not covered', p_table using errcode = '42501';
  end if;

  -- One request (one transaction) may delete at most 25 rows.
  v_n := coalesce(nullif(current_setting('vapetrax.api_deletes', true), ''), '0')::integer + 1;
  perform set_config('vapetrax.api_deletes', v_n::text, true);
  if v_n > 25 then
    raise exception 'mass_delete_blocked: one request may delete at most 25 rows. Nothing was deleted.'
      using errcode = 'PT422', hint = 'Delete 25 or fewer at a time.';
  end if;

  v_shop := private.try_parse_uuid(p_row->>'shopId');
  if not private.is_shop_member(v_shop) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;

  if p_table in ('products', 'customers') then
    execute format('update public.%I set "deletedAt" = now(), "deletedBy" = auth.uid(), "updatedAt" = now()
                     where id = $1 and "shopId" = $2 and "deletedAt" is null', p_table)
      using p_row->>'id', v_shop;
  elsif p_table = 'bottles' then
    update public.bottles set "archivedAt" = now(), "updatedAt" = now()
     where id = p_row->>'id' and "shopId" = v_shop and "archivedAt" is null;
  else
    insert into private.deleted_rows ("table", "rowId", "shopId", "row", "deletedBy", "clientBuild", reason)
    values (p_table, p_row->>'id', v_shop, p_row, auth.uid(), private.client_build(), 'app delete');
  end if;
end;
$$;

create or replace function private.try_parse_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- SECURITY INVOKER on purpose: current_user is then 'authenticated' for a
-- delete sent by the app, and the owner inside a server function.
create or replace function private.api_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return old;
  end if;
  perform private.note_api_delete(tg_table_name, to_jsonb(old));
  if tg_table_name in ('products', 'customers', 'bottles') then
    return null;      -- archived, not deleted (the app sees "0 rows, no error")
  end if;
  return old;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'customers', 'bottles', 'sales', 'expenses', 'personal_expenses', 'profiles'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_api_delete_guard', t);
    execute format('create trigger %I before delete on public.%I for each row execute function private.api_delete_guard()',
                   t || '_api_delete_guard', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. Legacy RPCs: drop and recreate returning jsonb (snapshotted in 0).
-- ---------------------------------------------------------------------
drop function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric);

drop function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric);

create function public.process_checkout(
  p_shop_id text,
  p_sale_data jsonb,
  p_product_updates jsonb,
  p_bottle_updates jsonb,
  p_inventory_logs jsonb,
  p_customer_id text default null,
  p_credit_increment numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop       uuid;
  v_uid        uuid := auth.uid();
  v_sale_id    text;
  v_items      jsonb;
  v_prods      jsonb;
  v_bots       jsonb;
  v_logs       jsonb;
  v_sale_date  timestamptz;
  v_future     timestamptz;
  v_customer   text;
  v_total      numeric;
  v_item       jsonb;
  v_prod       jsonb;
  v_bot        jsonb;
  v_log        jsonb;
  v_qty        numeric;
  v_ml         numeric;
  v_deduction  numeric;
  v_pid        text;
  v_ids        text[];
  v_before     jsonb;
  v_missing    text[] := '{}';
  v_name       text;
  v_category   text;
  v_stock      numeric;
  v_unit       text;
  v_actor_name text;
  v_actor_role text;
  v_bid        text;
  v_bml        numeric;
  v_bstatus    text;
  v_inserted   boolean;
  v_pm         text;
  v_credit     numeric;
begin
  begin
    v_shop := p_shop_id::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid shop id' using errcode = '22023';
  end;

  if not private.is_shop_member(v_shop) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;

  if p_sale_data is null or jsonb_typeof(p_sale_data) <> 'object' or coalesce(p_sale_data->>'id', '') = '' then
    raise exception 'Sale id is required' using errcode = '22023';
  end if;
  v_sale_id := p_sale_data->>'id';

  perform private.require_client_build();
  perform private.count_legacy_call(v_shop, 'process_checkout', p_sale_data);

  v_items := case when jsonb_typeof(p_sale_data->'items') = 'array' then p_sale_data->'items' else '[]'::jsonb end;
  v_prods := case when jsonb_typeof(p_product_updates) = 'array' then p_product_updates else '[]'::jsonb end;
  v_bots  := case when jsonb_typeof(p_bottle_updates) = 'array' then p_bottle_updates else '[]'::jsonb end;
  v_logs  := case when jsonb_typeof(p_inventory_logs) = 'array' then p_inventory_logs else '[]'::jsonb end;

  -- The sale date the device chose (an edited sale keeps its original
  -- date). Only a date more than 10 minutes in the future is clamped.
  v_sale_date := coalesce(private.try_parse_ts(p_sale_data->>'saleDate'),
                          private.try_parse_ts(p_sale_data->>'saleDateClient'),
                          now());
  if v_sale_date > now() + interval '10 minutes' then
    v_future := v_sale_date;
    v_sale_date := now();
  end if;

  v_customer := coalesce(nullif(btrim(coalesce(p_sale_data->>'customerId', '')), ''),
                         nullif(btrim(coalesce(p_customer_id, '')), ''));
  v_total := coalesce(private.finite_numeric(p_sale_data->>'totalAmount'), 0);

  -- 1. Insert the sale. A retry of a sale that was already saved stops
  --    here, so stock and credit are never applied twice.
  insert into public.sales (
    id, "shopId", "customerId", items, "totalAmount", "paymentMethod",
    "splitAmounts", "saleDate", "saleDateClient", "actorName", "actorRole",
    "totalCOGS", "totalProfit", "createdAt", "updatedAt"
  )
  values (
    v_sale_id,
    v_shop,
    v_customer,
    v_items,
    v_total,
    p_sale_data->>'paymentMethod',
    p_sale_data->'splitAmounts',
    v_sale_date,
    p_sale_data->>'saleDateClient',
    p_sale_data->>'actorName',
    p_sale_data->>'actorRole',
    private.finite_numeric(p_sale_data->>'totalCOGS'),
    private.finite_numeric(p_sale_data->>'totalProfit'),
    coalesce(private.try_parse_ts(p_sale_data->>'createdAt'), now()),
    now()
  )
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'saleId', v_sale_id);
  end if;

  -- A new sale under this id: shortfall notes of an earlier sale with the
  -- same id (deleted without a reversal) do not belong to it.
  delete from private.sale_shortfalls where "shopId" = v_shop and "saleId" = v_sale_id;

  if v_future is not null then
    insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
    values (v_shop, 'future_sale_date_clamped', 'sales', v_sale_id,
            jsonb_build_object('sent', v_future, 'stored', v_sale_date), v_uid);
  end if;
  if private.finite_numeric(p_sale_data->>'totalAmount') is null then
    insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
    values (v_shop, 'unreadable_total', 'sales', v_sale_id,
            jsonb_build_object('sent', p_sale_data->'totalAmount'), v_uid);
  end if;

  -- 2. Sale lines: whole-number quantities; refills only in 0.5 ml steps.
  --    (Checked after the insert so an already-saved sale replays as a
  --    no-op; an error here rolls the insert back too.) The sale type is
  --    read the way process_reversal reads it ('Refill', ' refill ' too).
  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_qty := private.try_numeric(v_item->>'quantity');
    -- (">= 100000" also rejects NaN and Infinity, which pass the other tests)
    if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) or v_qty >= 100000 then
      raise exception 'Quantity for "%" must be a whole number above zero (got %).',
        coalesce(v_item->>'productName', '?'), coalesce(v_item->>'quantity', 'nothing')
        using errcode = '22023';
    end if;
    if lower(btrim(coalesce(v_item->>'saleType', ''))) = 'refill' then
      v_ml := private.try_numeric(v_item->>'refillAmount');
      if v_ml is null or v_ml <= 0 or (v_ml * 2) <> trunc(v_ml * 2) or v_ml >= 100000 then
        raise exception 'Refill for "%" must be in 0.5 ml steps (0.5, 1, 1.5 ...), not % ml.',
          coalesce(v_item->>'productName', '?'), coalesce(v_item->>'refillAmount', 'nothing')
          using errcode = '22023';
      end if;
    end if;
  end loop;

  -- 3. Lock every product this sale touches, in id order, before changing
  --    anything: two devices selling at once wait for each other instead
  --    of deadlocking.
  select coalesce(array_agg(distinct s.pid order by s.pid), '{}') into v_ids
    from (
      select x->>'id' as pid from jsonb_array_elements(v_prods) x where jsonb_typeof(x) = 'object'
      union all
      select x->>'productId' from jsonb_array_elements(v_bots) x where jsonb_typeof(x) = 'object'
      union all
      select x->>'productId' from jsonb_array_elements(v_logs) x where jsonb_typeof(x) = 'object'
    ) s
   where coalesce(s.pid, '') <> '';

  perform 1 from public.products p
   where p.id = any(v_ids) and p."shopId" = v_shop
   order by p.id
   for update;

  select coalesce(jsonb_object_agg(p.id, coalesce(p."stockQuantity", 0)), '{}'::jsonb) into v_before
    from public.products p
   where p.id = any(v_ids) and p."shopId" = v_shop;

  -- 4. Stock deductions: only this shop's products, and NEVER below zero.
  --    The POS blocks sales at the counter when stock is short. If a sale
  --    still arrives short (made offline, or two devices sold the last unit
  --    at the same moment), the goods have already left the shop: the sale
  --    is kept, stock stops at 0, and a "shortfall - please recount" log and
  --    alert are written for the owner. A product that is not in this shop
  --    is skipped and recorded in private.repair_log.
  for v_prod in select * from jsonb_array_elements(v_prods)
  loop
    v_deduction := private.try_numeric(v_prod->>'deduction');
    if v_deduction is null and coalesce(btrim(v_prod->>'deduction'), '') <> '' then
      v_deduction := 'NaN';   -- unreadable text: refused just below
    end if;
    v_deduction := coalesce(v_deduction, 0);
    -- (">= 1000000" also rejects NaN and Infinity)
    if v_deduction < 0 or v_deduction >= 1000000 then
      raise exception 'Invalid stock deduction (%).', coalesce(v_prod->>'deduction', '?') using errcode = '22023';
    end if;

    v_pid := v_prod->>'id';
    if v_pid is null or not (v_before ? v_pid) then
      if not (coalesce(v_pid, '') = any(v_missing)) then
        v_missing := v_missing || coalesce(v_pid, '');
        insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
        values (v_shop, 'missing_product', 'products', v_pid,
                jsonb_build_object('saleId', v_sale_id, 'deduction', v_deduction), v_uid);
      end if;
      continue;
    end if;
    continue when v_deduction = 0;

    -- Guarded deduction: never below zero.
    update public.products
       set "stockQuantity" = coalesce("stockQuantity", 0) - v_deduction,
           "updatedAt"     = now()
     where id = v_pid
       and "shopId" = v_shop
       and coalesce("stockQuantity", 0) >= v_deduction;

    if not found then
      -- Shortfall (the row is locked, so the shortage is real).
      select p.name, p.category, coalesce(p."stockQuantity", 0)
        into v_name, v_category, v_stock
        from public.products p
       where p.id = v_pid and p."shopId" = v_shop;
      v_unit := case when v_category = 'e-liquid' then 'ml' else 'pcs' end;

      update public.products
         set "stockQuantity" = 0, "updatedAt" = now()
       where id = v_pid and "shopId" = v_shop;

      -- What could not be taken off, so a later reversal (delete or edit)
      -- puts back only what was really taken off.
      insert into private.sale_shortfalls ("shopId", "saleId", "productId", requested, applied)
      values (v_shop, v_sale_id, v_pid, v_deduction, v_stock);

      insert into public.inventory_logs (
        id, "shopId", "productId", "productName", type, action, change,
        "quantityChange", "previousStock", "newStock", reason, notes,
        "actorName", "actorRole", "createdAtClient", "createdAt", "createdBy", "refId"
      )
      values (
        gen_random_uuid()::text, v_shop, v_pid, v_name, 'correction', 'shortfall',
        -v_stock, -v_stock, v_stock, 0,
        format('Stock shortfall on sale %s: sold %s %s but only %s %s was in stock',
               right(v_sale_id, 6), v_deduction, v_unit, v_stock, v_unit),
        'Stock stopped at 0 (it can never go below zero). Please recount this product.',
        'System', 'system',
        to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), now(),
        v_uid::text, v_sale_id
      );

      -- Best effort: the alert must never be the reason a sale is lost.
      begin
        insert into public.inventory_alerts (shop_id, product_id, product_name, message)
        values (
          v_shop, v_pid, coalesce(v_name, '?'),
          format('Shortfall: sold %s %s but only %s %s was in stock. Please recount.',
                 v_deduction, v_unit, v_stock, v_unit)
        );
      exception when others then
        raise warning 'Shortfall alert not written: %', sqlerrm;
      end;
    end if;
  end loop;

  -- 5. Bottles: only for a product of this shop; an existing bottle is
  --    updated only if it belongs to this shop. (ml >= 0 is a table rule;
  --    an unreadable or absurd ml is skipped and recorded.)
  for v_bot in select * from jsonb_array_elements(v_bots)
  loop
    v_bid := nullif(btrim(coalesce(v_bot->>'id', '')), '');
    continue when v_bid is null;
    v_pid := v_bot->>'productId';
    if v_pid is null or not (v_before ? v_pid) then
      insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
      values (v_shop, 'bottle_skipped_missing_product', 'bottles', v_bid,
              jsonb_build_object('saleId', v_sale_id, 'productId', v_pid), v_uid);
      continue;
    end if;
    v_bml := private.finite_numeric(v_bot->>'remainingMl');
    if v_bml is null or v_bml < 0 or v_bml >= 100000 then
      insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
      values (v_shop, 'invalid_bottle_update', 'bottles', v_bid,
              jsonb_build_object('saleId', v_sale_id, 'remainingMl', v_bot->'remainingMl'), v_uid);
      continue;
    end if;
    v_bstatus := case when v_bot->>'status' in ('closed', 'opened', 'empty', 'sold') then v_bot->>'status' end;

    v_inserted := null;
    insert into public.bottles as b (
      id, "productId", "shopId", "bottleSize", "remainingMl", status,
      "openedDate", "createdAt", "updatedAt"
    )
    values (
      v_bid, v_pid, v_shop, private.finite_numeric(v_bot->>'bottleSize'), v_bml,
      coalesce(v_bstatus, 'opened'), private.try_parse_ts(v_bot->>'openedDate'), now(), now()
    )
    on conflict (id) do update set
      "remainingMl" = excluded."remainingMl",
      status        = coalesce(v_bstatus, b.status),
      "openedDate"  = coalesce(excluded."openedDate", b."openedDate"),
      "updatedAt"   = now()
    where b."shopId" = excluded."shopId"
    returning (xmax = 0) into v_inserted;

    if v_inserted then
      insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
      values (v_shop, 'bottle_created_at_checkout', 'bottles', v_bid,
              jsonb_build_object('saleId', v_sale_id, 'productId', v_pid), v_uid);
    end if;
  end loop;

  -- 6. Inventory logs: stamped by the server (shop, real user, name and
  --    role from the profile, stock before and after from the locked row,
  --    refId = the sale id). Logs of products not in this shop are skipped.
  select p.username, p.role into v_actor_name, v_actor_role
    from public.profiles p where p.id = v_uid;

  for v_log in select * from jsonb_array_elements(v_logs)
  loop
    continue when jsonb_typeof(v_log) <> 'object';
    v_pid := v_log->>'productId';
    if v_pid is null or not (v_before ? v_pid) then
      if not (coalesce(v_pid, '') = any(v_missing)) then
        v_missing := v_missing || coalesce(v_pid, '');
        insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
        values (v_shop, 'missing_product', 'products', v_pid,
                jsonb_build_object('saleId', v_sale_id, 'from', 'inventory_log'), v_uid);
      end if;
      continue;
    end if;

    select p.name, p.category, coalesce(p."stockQuantity", 0) into v_name, v_category, v_stock
      from public.products p where p.id = v_pid and p."shopId" = v_shop;

    insert into public.inventory_logs (
      id, "productId", "productName", "shopId", action, type, change,
      "quantityChange", "mlChange", "previousStock", "newStock", "newStockMl",
      reason, notes, "actorName", "actorRole", "createdAtClient", "createdAt",
      "createdBy", "refId"
    )
    values (
      coalesce(nullif(btrim(coalesce(v_log->>'id', '')), ''), gen_random_uuid()::text),
      v_pid,
      coalesce(v_log->>'productName', v_name),
      v_shop,
      v_log->>'action',
      v_log->>'type',
      private.finite_numeric(v_log->>'change'),
      private.finite_numeric(v_log->>'quantityChange'),
      private.finite_numeric(v_log->>'mlChange'),
      (v_before->>v_pid)::numeric,
      v_stock,
      case when v_category = 'e-liquid' then v_stock end,
      v_log->>'reason',
      v_log->>'notes',
      coalesce(v_actor_name, v_log->>'actorName'),
      coalesce(v_actor_role, v_log->>'actorRole'),
      v_log->>'createdAtClient',
      coalesce(private.try_parse_ts(v_log->>'createdAt'), now()),
      v_uid::text,
      v_sale_id
    )
    on conflict (id) do nothing;
  end loop;

  -- 7. Customer credit (udhaar), worked out from the payment itself:
  --    'credit' -> the total, 'split' -> its credit part; capped at the
  --    total, never negative. p_credit_increment is ignored.
  v_pm := lower(btrim(coalesce(p_sale_data->>'paymentMethod', '')));
  v_credit := case v_pm
                when 'credit' then v_total
                when 'split' then coalesce(private.finite_numeric(p_sale_data->'splitAmounts'->>'credit'), 0)
                else 0
              end;
  v_credit := greatest(0, least(v_credit, v_total));

  if p_credit_increment is distinct from v_credit and coalesce(p_credit_increment, 0) <> v_credit then
    insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
    values (v_shop, 'credit_increment_ignored', 'sales', v_sale_id,
            jsonb_build_object('sent', p_credit_increment, 'applied', v_credit), v_uid);
  end if;

  if v_credit > 0 then
    if v_customer is null then
      insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
      values (v_shop, 'credit_without_customer', 'sales', v_sale_id,
              jsonb_build_object('credit', v_credit), v_uid);
    else
      update public.customers
         set "creditBalance" = coalesce("creditBalance", 0) + v_credit,
             "updatedAt"     = now()
       where id = v_customer
         and "shopId" = v_shop;
      if not found then
        insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
        values (v_shop, 'missing_customer', 'customers', v_customer,
                jsonb_build_object('saleId', v_sale_id, 'credit', v_credit), v_uid);
      end if;
    end if;
  end if;

  return jsonb_build_object('status', 'applied', 'saleId', v_sale_id);
end;
$$;

revoke all on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) from public, anon;

grant execute on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) to authenticated;

create function public.process_reversal(
  p_shop_id uuid,
  p_sale_id text,
  p_delete_sale boolean,
  p_inventory_logs jsonb,
  p_bottle_updates jsonb,
  p_product_updates jsonb,
  p_customer_id text,
  p_credit_decrement numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_sale       public.sales%rowtype;
  v_items      jsonb;
  v_item       jsonb;
  v_bc         jsonb;
  v_pid        text;
  v_type       text;
  v_qty        numeric;
  v_size       numeric;
  v_amount     numeric;
  v_ids        text[];
  v_bids       text[];
  v_found      boolean;
  v_name       text;
  v_category   text;
  v_psize      text;
  v_new        numeric;
  v_delta      numeric;
  v_cap        numeric;
  v_bml        numeric;
  v_bstatus    text;
  v_bsize      numeric;
  v_new_ml     numeric;
  v_status     text;
  v_actor_name text;
  v_actor_role text;
  v_pm         text;
  v_total      numeric;
  v_credit     numeric;
  v_restored   integer := 0;
  v_tag        text;
  v_short      jsonb;
  v_cut        numeric;
  v_cuts       jsonb := '{}';
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Unauthorized shop access' using errcode = '42501';
  end if;
  if not private.legacy_is_shop_admin(p_shop_id) then
    raise exception 'Only the shop admin can delete or edit a sale.' using errcode = '42501';
  end if;

  perform private.count_legacy_call(p_shop_id, 'process_reversal', null);

  -- 1. Always delete the STORED sale (whatever p_delete_sale says: both
  --    deployed callers delete it right after anyway). If it is already
  --    gone (double click, retry, two devices), restore nothing.
  delete from public.sales
   where id = p_sale_id
     and "shopId" = p_shop_id
  returning * into v_sale;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'saleId', p_sale_id);
  end if;

  -- The deployed app sends p_delete_sale = false only from its edit flow,
  -- which then checks the same sale id out again ('sale edit').
  insert into private.deleted_rows ("table", "rowId", "shopId", "row", "deletedBy", "clientBuild", reason)
  values ('sales', v_sale.id, p_shop_id, to_jsonb(v_sale), v_uid, private.client_build(),
          case when p_delete_sale is false then 'sale edit' else 'sale delete' end);

  -- 2. Everything below comes from the stored sale. The client's arrays
  --    (p_inventory_logs, p_bottle_updates, p_product_updates) and
  --    p_credit_decrement are ignored.
  v_items := case when jsonb_typeof(v_sale.items) = 'array' then v_sale.items else '[]'::jsonb end;
  v_tag := upper(right(v_sale.id, 6));

  -- What this sale could not take off when it arrived short, per product:
  -- never put back (it never left the stock count). Used up here.
  select coalesce(jsonb_object_agg(s.pid, s.missing), '{}'::jsonb) into v_short
    from (select f."productId" as pid, sum(greatest(f.requested - f.applied, 0)) as missing
            from private.sale_shortfalls f
           where f."shopId" = p_shop_id and f."saleId" = v_sale.id
           group by f."productId") s;
  delete from private.sale_shortfalls where "shopId" = p_shop_id and "saleId" = v_sale.id;

  select coalesce(array_agg(distinct x->>'productId' order by x->>'productId'), '{}') into v_ids
    from jsonb_array_elements(v_items) x
   where jsonb_typeof(x) = 'object' and coalesce(x->>'productId', '') <> '';
  select coalesce(array_agg(distinct b->>'bottleId' order by b->>'bottleId'), '{}') into v_bids
    from jsonb_array_elements(v_items) x
    cross join lateral jsonb_array_elements(case when jsonb_typeof(x->'bottleChanges') = 'array' then x->'bottleChanges' else '[]'::jsonb end) b
   where jsonb_typeof(x) = 'object' and jsonb_typeof(b) = 'object' and coalesce(b->>'bottleId', '') <> '';

  perform 1 from public.products p
   where p.id = any(v_ids) and p."shopId" = p_shop_id
   order by p.id
   for update;
  perform 1 from public.bottles b
   where b.id = any(v_bids) and b."shopId" = p_shop_id
   order by b.id
   for update;

  select p.username, p.role into v_actor_name, v_actor_role
    from public.profiles p where p.id = v_uid;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    continue when jsonb_typeof(v_item) <> 'object';
    v_pid  := nullif(btrim(coalesce(v_item->>'productId', '')), '');
    v_type := lower(btrim(coalesce(v_item->>'saleType', 'regular')));
    v_qty  := private.finite_numeric(v_item->>'quantity');
    v_cut  := 0;

    v_found := false;
    if v_pid is not null then
      select true, p.name, p.category, p."bottleSize" into v_found, v_name, v_category, v_psize
        from public.products p
       where p.id = v_pid and p."shopId" = p_shop_id;
      v_found := coalesce(v_found, false);
    end if;

    -- e-liquid stock is in ml: refill -> refill ml x quantity, full bottle
    -- -> bottle size x quantity; anything else -> the quantity. The line's
    -- own size is read like the app's parseBottleSizeMl ('60ml' -> 60),
    -- then the product's, then the app's 30 ml fallback.
    if v_type = 'refill' then
      v_amount := private.finite_numeric(coalesce(v_item->>'refillAmount', v_item->>'refillMl')) * v_qty;
    elsif v_type = 'full_bottle' then
      v_size := coalesce(private.bottle_size_ml(v_item->>'bottleSize'), private.bottle_size_ml(v_psize), 30);
      v_amount := v_size * v_qty;
    else
      v_amount := v_qty;
    end if;

    if v_pid is null then
      insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
      values (p_shop_id, 'restore_line_without_product', 'sales', v_sale.id,
              jsonb_build_object('productName', v_item->>'productName', 'amount', v_amount), v_uid);
    elsif not v_found then
      insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
      values (p_shop_id, 'missing_product', 'products', v_pid,
              jsonb_build_object('saleId', v_sale.id, 'amount', v_amount, 'from', 'reversal'), v_uid);
    elsif v_amount is null or v_amount < 0 or v_amount >= 1000000 then
      -- A negative restore would reduce stock: it is refused (not applied).
      insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
      values (p_shop_id, 'invalid_restore_amount', 'products', v_pid,
              jsonb_build_object('saleId', v_sale.id,
                                 'message', format('Invalid stock restore amount (%s): not applied.', coalesce(v_amount::text, 'unreadable'))),
              v_uid);
    elsif v_amount > 0 then
      -- A shortfall sale: what was never taken off is not put back.
      v_cut := least(v_amount, coalesce((v_short->>v_pid)::numeric, 0));
      if v_cut > 0 then
        v_short := jsonb_set(v_short, array[v_pid], to_jsonb((v_short->>v_pid)::numeric - v_cut));
        v_amount := v_amount - v_cut;
        v_cuts := jsonb_set(v_cuts, array[v_pid], to_jsonb(coalesce((v_cuts->>v_pid)::numeric, 0) + v_cut));
        insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
        values (p_shop_id, 'shortfall_not_restored', 'products', v_pid,
                jsonb_build_object('saleId', v_sale.id, 'notRestored', v_cut, 'restored', v_amount), v_uid);
      end if;
    end if;

    if v_pid is not null and v_found and v_amount > 0 and v_amount < 1000000 then
      update public.products
         set "stockQuantity" = coalesce("stockQuantity", 0) + v_amount,
             "updatedAt"     = now()
       where id = v_pid and "shopId" = p_shop_id
      returning "stockQuantity" into v_new;

      insert into public.inventory_logs (
        id, "shopId", "productId", "productName", type, action,
        "quantityChange", "previousStock", "newStock", change,
        "mlChange", "newStockMl", reason, notes, "actorName",
        "actorRole", "createdAtClient", "createdAt", "createdBy", "refId"
      )
      values (
        gen_random_uuid()::text, p_shop_id, v_pid, coalesce(v_item->>'productName', v_name), 'return', 'return',
        case when v_type = 'refill' then 0 when v_type = 'full_bottle' then v_qty else v_amount end,
        v_new - v_amount, v_new, v_amount,
        case when v_type in ('refill', 'full_bottle') then v_amount end,
        case when v_category = 'e-liquid' then v_new end,
        format('Sale deleted (restored): %s', v_tag),
        'Inventory restored by the server from the stored sale'
          || case when v_cut > 0 then format(' (%s not put back: never taken off, stock was short)', v_cut) else '' end,
        coalesce(v_actor_name, 'System'), coalesce(v_actor_role, 'admin'),
        to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), now(),
        v_uid::text, v_sale.id
      );
      v_restored := v_restored + 1;
    end if;

    -- Bottles by delta (before - after), so a refill made after this sale
    -- is kept; capped at the bottle size; status worked out again. Orphan
    -- bottles (product gone) are restored the same way.
    if jsonb_typeof(v_item->'bottleChanges') = 'array' then
      for v_bc in select * from jsonb_array_elements(v_item->'bottleChanges')
      loop
        continue when jsonb_typeof(v_bc) <> 'object' or coalesce(v_bc->>'bottleId', '') = '';
        v_delta := private.finite_numeric(v_bc->>'beforeRemainingMl') - private.finite_numeric(v_bc->>'afterRemainingMl');
        continue when v_delta is null or v_delta <= 0 or v_delta >= 100000;

        select b."remainingMl", b.status, b."bottleSize" into v_bml, v_bstatus, v_bsize
          from public.bottles b
         where b.id = v_bc->>'bottleId' and b."shopId" = p_shop_id;
        if not found then
          insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
          values (p_shop_id, 'missing_bottle', 'bottles', v_bc->>'bottleId',
                  jsonb_build_object('saleId', v_sale.id, 'ml', v_delta), v_uid);
          continue;
        end if;

        v_cap := case
                   when v_bsize > 0 then v_bsize
                   else private.bottle_size_ml(v_item->>'bottleSize')
                 end;
        v_new_ml := coalesce(v_bml, 0) + v_delta;
        if v_cap is not null then
          -- capped at the size, but a bottle already holding more than its
          -- size (old data) is never lowered by a restore
          v_new_ml := least(v_new_ml, greatest(v_cap, coalesce(v_bml, 0)));
        end if;
        v_status := case
                      when v_new_ml <= 0 then v_bstatus
                      when v_bc->>'beforeStatus' = 'closed' and (v_cap is null or v_new_ml >= v_cap) then 'closed'
                      else 'opened'
                    end;

        update public.bottles
           set "remainingMl" = v_new_ml,
               status        = v_status,
               "openedDate"  = case when v_status = 'closed' then null else "openedDate" end,
               "updatedAt"   = now()
         where id = v_bc->>'bottleId' and "shopId" = p_shop_id;
      end loop;
    end if;
  end loop;

  -- One recount alert per product whose shortfall was not put back (best
  -- effort, and only when no recount is already pending for it).
  for v_pid, v_cut in select e.key, e.value::numeric from jsonb_each_text(v_cuts) e order by e.key
  loop
    begin
      insert into public.inventory_alerts (shop_id, product_id, product_name, message)
      select p_shop_id, v_pid, coalesce(p.name, '?'),
             format('Sale %s removed: %s %s not put back (stock was short when it was sold). Please recount.',
                    v_tag, v_cut, case when p.category = 'e-liquid' then 'ml' else 'pcs' end)
        from public.products p
       where p.id = v_pid and p."shopId" = p_shop_id
         and not exists (select 1 from public.inventory_alerts a
                          where a.shop_id = p_shop_id and a.product_id = v_pid
                            and coalesce(a.resolved, false) = false);
    exception when others then
      raise warning 'Shortfall alert not written: %', sqlerrm;
    end;
  end loop;

  -- 3. Udhaar back from the stored payment: 'credit' -> the total,
  --    'split' -> its credit part (the same rule checkout uses).
  v_pm := lower(btrim(coalesce(v_sale."paymentMethod", '')));
  v_total := coalesce(private.finite_numeric(v_sale."totalAmount"::text), 0);
  v_credit := case v_pm
                when 'credit' then v_total
                when 'split' then coalesce(private.finite_numeric(v_sale."splitAmounts"->>'credit'), 0)
                else 0
              end;
  v_credit := greatest(0, least(v_credit, v_total));

  if v_credit > 0 then
    if nullif(btrim(coalesce(v_sale."customerId", '')), '') is null then
      insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
      values (p_shop_id, 'credit_without_customer', 'sales', v_sale.id,
              jsonb_build_object('credit', v_credit, 'from', 'reversal'), v_uid);
    else
      update public.customers
         set "creditBalance" = coalesce("creditBalance", 0) - v_credit,
             "updatedAt"     = now()
       where id = v_sale."customerId"
         and "shopId" = p_shop_id;
      if not found then
        insert into private.repair_log ("shopId", kind, "refTable", "refId", detail, "actorId")
        values (p_shop_id, 'missing_customer', 'customers', v_sale."customerId",
                jsonb_build_object('saleId', v_sale.id, 'credit', v_credit, 'from', 'reversal'), v_uid);
      end if;
    end if;
  end if;

  return jsonb_build_object('status', 'applied', 'saleId', v_sale.id,
                            'linesRestored', v_restored, 'creditRestored', v_credit);
end;
$$;

revoke all on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) from public, anon;

grant execute on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) to authenticated;

-- Retired: nothing in the app queues it any more.
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
set search_path = ''
as $$
begin
  raise exception 'process_stock_adjustment is retired (deprecated): update the app.'
    using errcode = 'PT410';
end;
$$;

revoke all on function public.process_stock_adjustment(uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon;

grant execute on function public.process_stock_adjustment(uuid, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 1 (again, now that every function exists). No function is callable by
-- PUBLIC or anon, except Supabase's event-trigger helper rls_auto_enable.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select n.nspname, p.proname, pg_catalog.oidvectortypes(p.proargtypes) as args
             from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private')
              and p.prokind in ('f', 'p')
              and p.proname <> 'rls_auto_enable'
              and p.prorettype <> 'pg_catalog.event_trigger'::regtype
              and not exists (select 1 from pg_catalog.pg_depend d
                              where d.classid = 'pg_catalog.pg_proc'::regclass
                                and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %I.%I(%s) from public, anon', r.nspname, r.proname, r.args);
  end loop;
end $$;

-- What logged-in users need: the helpers used inside table rules, and the
-- delete guard's helper (the guard itself runs as the caller).
grant execute on function private.is_shop_member(uuid)       to authenticated;

grant execute on function private.legacy_shop_ids()          to authenticated;

grant execute on function private.legacy_is_shop_admin(uuid) to authenticated;

grant execute on function private.is_fresh_auth_user(uuid)   to authenticated;

grant execute on function private.note_api_delete(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Ledger, API reload, validation
-- ---------------------------------------------------------------------
create or replace function private.lockdown_followup_checks()
returns table (check_name text, ok boolean, detail text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v  text;
  v2 text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  check_name := 'rls_on_every_public_table'; ok := v is null; detail := coalesce('RLS off: ' || v, 'ok'); return next;

  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relforcerowsecurity;
  check_name := 'rls_not_forced'; ok := v is null; detail := coalesce('forced: ' || v, 'ok'); return next;

  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
     and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  check_name := 'anon_has_no_table_privilege'; ok := v is null; detail := coalesce('anon can use: ' || v, 'ok'); return next;

  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into v
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
     and p.prorettype not in ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
     and not exists (select 1 from pg_catalog.pg_depend d
                     where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  check_name := 'anon_cannot_execute_any_function'; ok := v is null; detail := coalesce('anon can run: ' || v, 'ok'); return next;

  select string_agg(p.tablename || '.' || p.policyname, ', ' order by 1) into v
    from pg_catalog.pg_policies p
   where p.schemaname = 'public' and (p.qual = 'true' or p.with_check = 'true');
  check_name := 'no_allow_everyone_policy'; ok := v is null; detail := coalesce('open: ' || v, 'ok'); return next;

  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into v
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
     and p.proname <> 'rls_auto_enable'
     and not exists (select 1 from pg_catalog.pg_depend d
                     where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) s where s like 'search_path=%');
  check_name := 'every_function_fixes_search_path'; ok := v is null; detail := coalesce('no search_path: ' || v, 'ok'); return next;

  select string_agg(x.f || '=' || x.n, ', ' order by x.f), bool_and(x.n = 1)::text into v, v2
    from (select f, (select count(*) from pg_catalog.pg_proc p
                      where p.pronamespace = 'public'::regnamespace and p.proname = f) as n
            from unnest(array['process_checkout', 'process_reversal', 'process_stock_adjustment']) f) x;
  check_name := 'exactly_one_of_each_legacy_rpc'; ok := v2 = 'true'; detail := v; return next;

  ok := (select bool_and(format_type(p.prorettype, null) = 'jsonb'
                         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                         and p.prosecdef)
           from pg_catalog.pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname in ('process_checkout', 'process_reversal'));
  check_name := 'checkout_and_reversal_return_jsonb_for_logged_in_users'; detail := 'returns jsonb, SECURITY DEFINER, EXECUTE for authenticated'; return next;

  ok := not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
        and not has_column_privilege('authenticated', 'public.profiles', 'shopId', 'UPDATE')
        and exists (select 1 from pg_catalog.pg_trigger t
                    where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'profiles_guard_update' and not t.tgisinternal);
  check_name := 'profiles_role_and_shop_locked'; detail := 'column grants + update trigger'; return next;

  ok := exists (select 1 from pg_catalog.pg_policies p
                where p.schemaname = 'public' and p.tablename = 'profiles' and p.policyname = 'profiles_insert_cashier'
                  and p.with_check like '%is_fresh_auth_user%');
  check_name := 'cashier_link_needs_fresh_login'; detail := 'profiles_insert_cashier'; return next;

  ok := exists (select 1 from pg_catalog.pg_proc p
                where p.oid = to_regprocedure('private.legacy_shop_ids()')
                  and p.prosrc like '%p.role = ''cashier''%');
  check_name := 'cashier_sees_only_their_shop'; detail := 'legacy_shop_ids: a cashier never gets their own uid as a shop'; return next;

  ok := exists (select 1 from pg_catalog.pg_constraint where conname = 'products_stock_not_negative'
                  and conrelid = 'public.products'::regclass and convalidated)
        and exists (select 1 from pg_catalog.pg_constraint where conname = 'bottles_remaining_not_negative'
                  and conrelid = 'public.bottles'::regclass and convalidated)
        and exists (select 1 from pg_catalog.pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.proname = 'process_checkout'
                      and p.prosrc like '%0.5 ml steps%' and p.prosrc like '%shortfall%'
                      and p.prosrc like '%>= 100000%' and p.prosrc like '%Invalid stock deduction%'
                      and p.prosrc like '%inventory_alerts%')
        and not exists (select 1 from public.products where "stockQuantity" < 0)
        and not exists (select 1 from public.bottles where "remainingMl" < 0);
  check_name := 'owner_stock_rules_kept'; detail := 'CHECKs, guarded deduction, shortfall + alert, 0.5 ml, NaN guard, nothing below zero'; return next;

  ok := exists (select 1 from pg_catalog.pg_policies p
                where p.schemaname = 'public' and p.tablename = 'inventory_alerts' and p.policyname = 'inventory_alerts_shop')
        and has_table_privilege('authenticated', 'public.inventory_alerts', 'SELECT')
        and has_column_privilege('authenticated', 'public.inventory_alerts', 'resolved', 'UPDATE')
        and has_column_privilege('authenticated', 'public.inventory_alerts', 'resolved_at', 'UPDATE')
        and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'inventory_alerts'
                      and column_name = 'product_id' and data_type = 'text');
  check_name := 'shortfall_alerts_still_usable'; detail := 'inventory_alerts policy, grants and text product_id kept'; return next;

  select string_agg(p.tablename || '.' || p.policyname, ', ' order by 1) into v
    from pg_catalog.pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('finance_accounts', 'finance_transactions', 'daily_summaries',
                         'stock_alerts', 'users', 'suppliers', 'purchases');
  check_name := 'unused_tables_deny_all'; ok := v is null; detail := coalesce('still has: ' || v, 'ok'); return next;

  select string_agg(p.policyname, ', ' order by 1) into v
    from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = 'personal_expenses';
  check_name := 'personal_expenses_admin_only'; ok := v = 'personal_expenses_admin'; detail := coalesce(v, 'no policy'); return next;

  select string_agg(p.cmd, ',' order by p.cmd) into v
    from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = 'settings';
  check_name := 'settings_members_read_admin_saves'; ok := v = 'INSERT,SELECT,UPDATE'; detail := coalesce(v, 'no policy'); return next;

  ok := not has_table_privilege('authenticated', 'public.credits', 'UPDATE,DELETE,TRUNCATE')
        and not has_table_privilege('authenticated', 'public.inventory_logs', 'UPDATE,DELETE,TRUNCATE')
        and (select count(*) from pg_catalog.pg_trigger t
              where t.tgrelid in ('public.credits'::regclass, 'public.inventory_logs'::regclass)
                and t.tgname like '%append_only' and not t.tgisinternal) = 2;
  check_name := 'credits_and_inventory_logs_append_only'; detail := 'no update/delete right, guard triggers'; return next;

  select string_agg(c.relname, ', ' order by c.relname) into v
    from unnest(array['products', 'customers', 'bottles', 'sales', 'expenses', 'personal_expenses', 'profiles']) t
    join pg_catalog.pg_class c on c.relname = t and c.relnamespace = 'public'::regnamespace
   where not exists (select 1 from pg_catalog.pg_trigger g
                     where g.tgrelid = c.oid and g.tgname = t || '_api_delete_guard' and not g.tgisinternal);
  check_name := 'delete_guard_on_app_deletes'; ok := v is null; detail := coalesce('missing on: ' || v, 'archive products/customers/bottles, copy the rest, max 25 per request'); return next;

  select string_agg(c.table_name, ', ' order by c.table_name) into v
    from information_schema.columns c
   where c.table_schema = 'public' and c.column_name = 'id' and c.data_type = 'text' and c.column_default is null
     and c.table_name in ('products', 'bottles', 'customers', 'sales', 'credits', 'inventory_logs',
                          'expenses', 'personal_expenses', 'daily_summaries', 'finance_accounts',
                          'finance_transactions', 'stock_alerts');
  check_name := 'text_ids_have_a_default'; ok := v is null; detail := coalesce('no default: ' || v, 'ok'); return next;

  ok := exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'inventory_logs' and column_name = 'refId')
        and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'products' and column_name = 'deletedAt')
        and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'customers' and column_name = 'deletedAt')
        and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'bottles' and column_name = 'archivedAt');
  check_name := 'new_columns_present'; detail := 'inventory_logs.refId, products/customers.deletedAt, bottles.archivedAt'; return next;

  select string_agg(x, ', ' order by x) into v
    from unnest(array['20261011120000', '20261011140000', '20261012100000']) x
   where not exists (select 1 from private.schema_migrations m where m.version = x);
  check_name := 'migration_ledger'; ok := v is null; detail := coalesce('missing: ' || v, '20261011120000, 20261011140000, 20261012100000 recorded'); return next;

  check_name := 'running_as_owner_not_app_user'; ok := current_user not in ('authenticated', 'anon');
  detail := 'current_user = ' || current_user; return next;
end;
$$;

revoke all on function private.lockdown_followup_checks() from public, anon, authenticated;

select private.mark_migration('20261012100000', '20261012100000_lockdown_followup.sql',
  'Lockdown follow-up (plan step 0.3).');

notify pgrst, 'reload schema';

-- Every structural check must pass, or the whole file is rolled back.
do $$
declare
  v_failed text;
begin
  select string_agg(check_name || ' (' || detail || ')', '; ') into v_failed
    from private.lockdown_followup_checks() where ok is not true;
  if v_failed is not null then
    raise exception 'VALIDATION FAILED, nothing was changed: %', v_failed;
  end if;
end $$;

-- The real-user check: for each real profile, act AS that user (the role
-- and login the app uses) and count what it can see; it must equal what the
-- owner sees for that shop. Any difference rolls the whole file back. The
-- role is reset before the block ends.
do $$
declare
  r        record;
  t        text;
  v_ids    uuid[];
  v_exp    jsonb;
  v_got    jsonb;
  v_n      bigint;
  v_where  text;
  v_report text := '';
  v_count  integer := 0;
begin
  for r in select p.id, p."shopId", p.role from public.profiles p order by p.id
  loop
    -- (a cashier's shop is only the one their profile points at)
    v_ids := case when r.role = 'cashier' then array_remove(array[r."shopId"], null)
                  else array_remove(array[r.id, r."shopId"], null) end;
    v_exp := '{}'::jsonb;
    foreach t in array array['products', 'bottles', 'customers', 'sales', 'expenses', 'credits',
                             'inventory_logs', 'settings', 'personal_expenses'] loop
      v_where := case t
                   when 'products'          then '"shopId" = any($1) and "deletedAt" is null'
                   when 'customers'         then '"shopId" = any($1) and "deletedAt" is null'
                   when 'bottles'           then '"shopId" = any($1) and "archivedAt" is null'
                   when 'personal_expenses' then '"shopId" = $2'
                   else '"shopId" = any($1)'
                 end;
      execute format('select count(*) from public.%I where %s', t, v_where) into v_n using v_ids, r.id;
      v_exp := v_exp || jsonb_build_object(t, v_n);
    end loop;

    v_got := '{}'::jsonb;
    perform set_config('request.jwt.claims',
                       json_build_object('sub', r.id, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    execute 'set local role authenticated';
    foreach t in array array['products', 'bottles', 'customers', 'sales', 'expenses', 'credits',
                             'inventory_logs', 'settings', 'personal_expenses'] loop
      execute format('select count(*) from public.%I', t) into v_n;
      v_got := v_got || jsonb_build_object(t, v_n);
    end loop;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    if v_got <> v_exp then
      raise exception 'REAL-USER CHECK FAILED for profile % (%): sees % but the shop has %. Nothing was changed.',
        left(r.id::text, 8), r.role, v_got, v_exp;
    end if;
    v_count := v_count + 1;
    v_report := v_report || case when v_report = '' then '' else '; ' end
                || left(r.id::text, 8) || ' (' || r.role || '): ' || v_got::text;
  end loop;

  if current_user in ('authenticated', 'anon') then
    raise exception 'still acting as an app user after the real-user check';
  end if;
  perform set_config('vapetrax.real_user_check',
                     v_count || ' profile(s) checked, each sees exactly its own shop: ' || v_report, false);
end $$;

-- The validation table to paste back (read-only; runs as the owner).
select x.check_name as "check", x.ok, x.detail
  from (
    select 0 as pos, 'all_checks_passed' as check_name,
           bool_and(c.ok) and coalesce(current_setting('vapetrax.real_user_check', true), '') <> '' as ok,
           count(*) + 1 || ' checks, including the real-user check' as detail
      from private.lockdown_followup_checks() c
    union all
    select 1, c.check_name, c.ok, c.detail from private.lockdown_followup_checks() c
    union all
    select 2, 'real_user_check',
           coalesce(current_setting('vapetrax.real_user_check', true), '') <> '',
           coalesce(nullif(current_setting('vapetrax.real_user_check', true), ''), 'did not run')
  ) x
 order by x.pos, x.check_name;


-- ===== Migration 20261012200000_shop_links_and_transfers.sql =====

set local lock_timeout = '5s';

set local statement_timeout = '2min';

do $$
begin
  if to_regprocedure('private.is_shop_member(uuid)') is null then
    raise exception 'apply 20261011120000 first';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
                 where conname = 'products_stock_not_negative'
                   and conrelid = 'public.products'::regclass) then
    raise exception 'apply 20261011140000 first';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Link codes: only the sha256 of the code is stored.
create table if not exists private.shop_link_codes (
  "codeHash"  text primary key,
  "shopId"    uuid not null references auth.users(id) on delete cascade,
  "createdBy" uuid not null,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null,
  "usedAt"    timestamptz,
  "usedBy"    uuid
);

-- One active (unused) code per shop at a time.
create unique index if not exists shop_link_codes_one_active
  on private.shop_link_codes ("shopId") where "usedAt" is null;

-- Wrong-code attempts, for the 10-per-hour limit.
create table if not exists private.shop_link_attempts (
  id            uuid primary key default gen_random_uuid(),
  "userId"      uuid not null,
  "attemptedAt" timestamptz not null default now(),
  reason        text
);

create index if not exists shop_link_attempts_user
  on private.shop_link_attempts ("userId", "attemptedAt");

-- A link between two shops, stored once with the smaller id first.
create table if not exists public.shop_links (
  "shopA"     uuid not null references auth.users(id),
  "shopB"     uuid not null references auth.users(id),
  "createdAt" timestamptz not null default now(),
  "createdBy" uuid,
  primary key ("shopA", "shopB"),
  constraint shop_links_ordered check ("shopA" < "shopB")
);

create index if not exists shop_links_shop_b on public.shop_links ("shopB");

-- Which product a sender's product became at the receiving shop.
create table if not exists public.product_links (
  "fromShop"      uuid not null references auth.users(id),
  "fromProductId" text not null,
  "toShop"        uuid not null references auth.users(id),
  "toProductId"   text not null,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now(),
  primary key ("fromShop", "fromProductId", "toShop"),
  constraint product_links_two_shops check ("fromShop" <> "toShop")
);

create table if not exists public.stock_transfers (
  id                 text primary key default (gen_random_uuid())::text,
  "clientMutationId" text not null,
  "fromShop"         uuid not null references auth.users(id),
  "toShop"           uuid not null references auth.users(id),
  "fromShopName"     text,
  "toShopName"       text,
  "createdBy"        uuid not null,
  "createdByName"    text,
  "createdAt"        timestamptz not null default now(),
  note               text,
  status             text not null default 'completed',
  "lineCount"        integer not null default 0,
  constraint stock_transfers_mutation_unique unique ("clientMutationId"),
  constraint stock_transfers_two_shops check ("fromShop" <> "toShop"),
  constraint stock_transfers_status check (status in ('completed'))
);

create index if not exists stock_transfers_from on public.stock_transfers ("fromShop", "createdAt" desc);

create index if not exists stock_transfers_to on public.stock_transfers ("toShop", "createdAt" desc);

create table if not exists public.stock_transfer_items (
  "transferId"     text not null references public.stock_transfers(id),
  "fromProductId"  text not null,
  "toProductId"    text not null,
  "productName"    text,
  "toProductName"  text,
  category         text,
  quantity         integer not null,
  "mlPerUnit"      numeric,
  "stockMoved"     numeric not null,
  "costPerUnit"    numeric,
  "createdProduct" boolean not null default false,
  "matchedBy"      text,
  "bottlesMoved"   integer not null default 0,
  "bottlesCreated" integer not null default 0,
  primary key ("transferId", "fromProductId"),
  constraint stock_transfer_items_quantity check (quantity between 1 and 10000),
  constraint stock_transfer_items_moved check ("stockMoved" > 0)
);

-- inventory_logs."refId" (20261012100000 adds it too): the transfer id.
-- Checked first, so a re-run does not even take the table lock.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'inventory_logs'
                   and column_name = 'refId') then
    alter table public.inventory_logs add column "refId" text;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Rights and Row Level Security: everyone reads their own shops' rows,
--    nobody writes directly (only through the functions below).
-- ---------------------------------------------------------------------
alter table public.shop_links           enable row level security;

alter table public.product_links        enable row level security;

alter table public.stock_transfers      enable row level security;

alter table public.stock_transfer_items enable row level security;

alter table private.shop_link_codes     enable row level security;

alter table private.shop_link_attempts  enable row level security;

revoke all on table public.shop_links, public.product_links,
                    public.stock_transfers, public.stock_transfer_items
  from public, anon, authenticated;

grant select on table public.shop_links, public.product_links,
                      public.stock_transfers, public.stock_transfer_items
  to authenticated;

revoke all on table private.shop_link_codes, private.shop_link_attempts
  from public, anon, authenticated;

drop policy if exists shop_links_select on public.shop_links;

create policy shop_links_select on public.shop_links
  for select to authenticated
  using (private.is_shop_member("shopA") or private.is_shop_member("shopB"));

drop policy if exists product_links_select on public.product_links;

create policy product_links_select on public.product_links
  for select to authenticated
  using (private.is_shop_member("fromShop") or private.is_shop_member("toShop"));

drop policy if exists stock_transfers_select on public.stock_transfers;

create policy stock_transfers_select on public.stock_transfers
  for select to authenticated
  using (private.is_shop_member("fromShop") or private.is_shop_member("toShop"));

drop policy if exists stock_transfer_items_select on public.stock_transfer_items;

create policy stock_transfer_items_select on public.stock_transfer_items
  for select to authenticated
  using (exists (select 1 from public.stock_transfers t
                 where t.id = stock_transfer_items."transferId"
                   and (private.is_shop_member(t."fromShop") or private.is_shop_member(t."toShop"))));

-- ---------------------------------------------------------------------
-- 3. Private helpers
-- ---------------------------------------------------------------------

-- The caller's shop when they are a shop admin (profiles.role = 'admin'
-- and their shop is their own id), else null.
create or replace function private.transfer_shop_of_caller()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.profiles p
   where p.id = auth.uid()
     and p.role = 'admin'
     and p."shopId" = p.id;
$$;

-- A shop's display name: settings."shopName", else its admin's username.
create or replace function private.transfer_shop_name(p_shop uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select nullif(btrim(s."shopName"), '') from public.settings s where s."shopId" = p_shop),
    (select nullif(btrim(p.username), '') from public.profiles p where p.id = p_shop),
    'Shop ' || left(p_shop::text, 8));
$$;

-- Bottle size in ml from products."bottleSize" (text): '30', '30ml',
-- '60 ML'. Null when it is not a plain positive number up to 1000.
create or replace function private.transfer_bottle_ml(p text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
           when m is null then null
           when m[1]::numeric > 0 and m[1]::numeric <= 1000 then trim_scale(m[1]::numeric)
         end
    from (select regexp_match(coalesce(p, ''), '^\s*([0-9]{1,4}(?:\.[0-9]{1,2})?)\s*(?:ml)?\s*$', 'i') as m) x;
$$;

-- The number itself, or null when it is NaN, Infinity or -Infinity. numeric
-- NaN and Infinity sort above every number, so they slip through checks
-- such as "stock < asked" or a CHECK (>= 0); they are refused (stock) or
-- treated as unknown (costs and prices) before any arithmetic.
create or replace function private.transfer_finite(p numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
           when p is null then null
           when p = 'NaN'::numeric or p = 'Infinity'::numeric or p = '-Infinity'::numeric then null
           else p
         end;
$$;

-- Where a sender's product goes at the receiving shop:
--   'linked': the product an earlier transfer used (product_links), as long
--             as it is still counted the same way: e-liquid in ml with the
--             same bottle size, everything else in pieces. (If the other
--             shop has since turned it into an e-liquid, or the other way
--             round, pieces must not be added to ml.)
--   'name':   exactly one product with the same trimmed, case-insensitive
--             name and category (and, for e-liquid, the same bottle size);
--   'new':    nothing suitable, a product will be created.
-- Archived products ("deletedAt" set, 20261012100000) are never used.
create or replace function private.transfer_resolve_destination(
  p_src uuid, p_src_product_id text, p_name text, p_category text,
  p_is_liquid boolean, p_size numeric, p_dst uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id text;
  v_n  integer;
begin
  select dp.id into v_id
    from public.product_links l
    join public.products dp on dp.id = l."toProductId" and dp."shopId" = l."toShop"
   where l."fromShop" = p_src
     and l."fromProductId" = p_src_product_id
     and l."toShop" = p_dst
     and (to_jsonb(dp) ->> 'deletedAt') is null
     and (lower(btrim(coalesce(dp.category, ''))) = 'e-liquid') = p_is_liquid
     and (not p_is_liquid or private.transfer_bottle_ml(dp."bottleSize") = p_size);
  if v_id is not null then
    return jsonb_build_object('kind', 'linked', 'productId', v_id, 'nameMatches', 1);
  end if;

  select count(*)::integer, min(dp.id) into v_n, v_id
    from public.products dp
   where dp."shopId" = p_dst
     and lower(btrim(coalesce(dp.name, ''))) = lower(btrim(coalesce(p_name, '')))
     and lower(btrim(coalesce(dp.category, ''))) = lower(btrim(coalesce(p_category, '')))
     and (to_jsonb(dp) ->> 'deletedAt') is null
     and (not p_is_liquid or private.transfer_bottle_ml(dp."bottleSize") = p_size);
  if v_n = 1 then
    return jsonb_build_object('kind', 'name', 'productId', v_id, 'nameMatches', 1);
  end if;
  return jsonb_build_object('kind', 'new', 'productId', null, 'nameMatches', v_n);
end;
$$;

-- The lines of a saved transfer, as the RPC returns them.
create or replace function private.transfer_lines(p_transfer text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'fromProductId',  i."fromProductId",
           'toProductId',    i."toProductId",
           'productName',    i."productName",
           'toProductName',  i."toProductName",
           'category',       i.category,
           'quantity',       i.quantity,
           'mlPerUnit',      i."mlPerUnit",
           'stockMoved',     i."stockMoved",
           'costPerUnit',    i."costPerUnit",
           'createdProduct', i."createdProduct",
           'matchedBy',      i."matchedBy",
           'bottlesMoved',   i."bottlesMoved",
           'bottlesCreated', i."bottlesCreated")
           order by i."fromProductId"), '[]'::jsonb)
    from public.stock_transfer_items i
   where i."transferId" = p_transfer;
$$;

-- Advisory lock for one shop's transfers and links. Pairs are always taken
-- smaller id first, so two transfers can never wait on each other.
create or replace function private.transfer_lock_shops(p_a uuid, p_b uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('vapetrax.transfer.shop:' || least(p_a, p_b)::text, 0));
  if p_b is not null and p_a is distinct from p_b then
    perform pg_advisory_xact_lock(hashtextextended('vapetrax.transfer.shop:' || greatest(p_a, p_b)::text, 0));
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Linking shops
-- ---------------------------------------------------------------------
create or replace function public.create_shop_link_code()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- No 0/O or 1/I: easy to read out and type.
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  -- Fully random bytes of a version-4 uuid (6-8 hold version and variant bits).
  c_positions constant integer[] := array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12];
  v_shop    uuid := private.transfer_shop_of_caller();
  v_bytes   bytea;
  v_code    text := '';
  v_expires timestamptz := now() + interval '30 minutes';
  v_pos     integer;
begin
  if v_shop is null then
    raise exception 'Only a shop admin can create a link code.' using errcode = '42501';
  end if;

  perform private.transfer_lock_shops(v_shop, v_shop);

  v_bytes := uuid_send(gen_random_uuid());
  foreach v_pos in array c_positions loop
    v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, v_pos) % 32) + 1, 1);
  end loop;

  -- One active code per shop: a new code replaces any unused one.
  delete from private.shop_link_codes
   where "shopId" = v_shop and "usedAt" is null;
  -- Housekeeping.
  delete from private.shop_link_codes
   where "expiresAt" < now() - interval '30 days';

  insert into private.shop_link_codes ("codeHash", "shopId", "createdBy", "expiresAt")
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_shop, auth.uid(), v_expires);

  return jsonb_build_object('code', v_code, 'expiresAt', v_expires);
end;
$$;

create or replace function public.link_shop_with_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shop   uuid := private.transfer_shop_of_caller();
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_hash   text;
  v_row    private.shop_link_codes%rowtype;
  v_fails  integer;
  v_reason text;
begin
  if v_shop is null then
    raise exception 'Only a shop admin can link shops.' using errcode = '42501';
  end if;

  -- Wrong codes are counted (and kept: a refusal is an answer, not an
  -- error, so the count is saved). At most 10 per hour per user.
  delete from private.shop_link_attempts where "attemptedAt" < now() - interval '1 day';
  select count(*)::integer into v_fails
    from private.shop_link_attempts
   where "userId" = auth.uid() and "attemptedAt" > now() - interval '1 hour';
  if v_fails >= 10 then
    return jsonb_build_object('status', 'refused', 'reason', 'too_many_attempts',
      'message', 'Too many wrong codes. Wait an hour, then try again.');
  end if;

  if length(v_code) = 10 then
    v_hash := encode(sha256(convert_to(v_code, 'UTF8')), 'hex');
    select * into v_row from private.shop_link_codes where "codeHash" = v_hash;
    if v_row."codeHash" is not null and v_row."shopId" <> v_shop then
      -- The shop locks first, then the code row: the same order as
      -- create_shop_link_code (which deletes the unused code under its shop
      -- lock), so the two can never wait on each other in a circle. The row
      -- is read again under the lock: a new code may have replaced it.
      perform private.transfer_lock_shops(v_shop, v_row."shopId");
      select * into v_row from private.shop_link_codes where "codeHash" = v_hash for update;
    end if;
  end if;

  -- A retry of a link that already worked (its answer was lost on the way):
  -- the same answer again, not "already used", and no wrong attempt counted.
  if v_row."usedAt" is not null
     and v_row."usedBy" = auth.uid()
     and v_row."shopId" <> v_shop
     and exists (select 1 from public.shop_links l
                 where l."shopA" = least(v_shop, v_row."shopId")
                   and l."shopB" = greatest(v_shop, v_row."shopId")) then
    return jsonb_build_object(
      'status', 'linked',
      'linkedShopId', v_row."shopId",
      'linkedShopName', private.transfer_shop_name(v_row."shopId"));
  end if;

  v_reason := case
    when v_row."codeHash" is null then 'invalid'
    when v_row."shopId" = v_shop then 'own'
    when v_row."usedAt" is not null then 'used'
    when v_row."expiresAt" <= now() then 'expired'
    when not exists (select 1 from public.profiles p
                     where p.id = v_row."shopId" and p.role = 'admin' and p."shopId" = p.id) then 'invalid'
    when exists (select 1 from public.shop_links l
                 where l."shopA" = least(v_shop, v_row."shopId")
                   and l."shopB" = greatest(v_shop, v_row."shopId")) then 'already_linked'
  end;

  if v_reason is not null then
    if v_reason in ('invalid', 'used', 'expired') then
      insert into private.shop_link_attempts ("userId", reason) values (auth.uid(), v_reason);
    end if;
    return jsonb_build_object('status', 'refused', 'reason', v_reason, 'message', case v_reason
      when 'invalid'        then 'That code is not valid. Check it and try again.'
      when 'own'            then 'That code belongs to this shop. Enter the code made in the OTHER shop.'
      when 'used'           then 'That code was already used. Ask the other shop for a new code.'
      when 'expired'        then 'That code has expired (codes last 30 minutes). Ask the other shop for a new code.'
      when 'already_linked' then 'These two shops are already linked.'
    end);
  end if;

  -- (Both shop locks and the code row lock are already held.)
  insert into public.shop_links ("shopA", "shopB", "createdBy")
  values (least(v_shop, v_row."shopId"), greatest(v_shop, v_row."shopId"), auth.uid())
  on conflict do nothing;

  update private.shop_link_codes
     set "usedAt" = now(), "usedBy" = auth.uid()
   where "codeHash" = v_row."codeHash";

  return jsonb_build_object(
    'status', 'linked',
    'linkedShopId', v_row."shopId",
    'linkedShopName', private.transfer_shop_name(v_row."shopId"));
end;
$$;

create or replace function public.unlink_shop(p_other uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shop uuid := private.transfer_shop_of_caller();
begin
  if v_shop is null then
    raise exception 'Only a shop admin can unlink shops.' using errcode = '42501';
  end if;
  if p_other is null or p_other = v_shop then
    return jsonb_build_object('status', 'not_linked');
  end if;

  -- Waits for a transfer between the two shops that is still running.
  perform private.transfer_lock_shops(v_shop, p_other);

  delete from public.shop_links
   where "shopA" = least(v_shop, p_other)
     and "shopB" = greatest(v_shop, p_other);
  if found then
    return jsonb_build_object('status', 'unlinked');
  end if;
  return jsonb_build_object('status', 'not_linked');
end;
$$;

create or replace function public.list_linked_shops()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid := private.transfer_shop_of_caller();
begin
  if v_shop is null then
    raise exception 'Only a shop admin can see linked shops.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('shopId', o.shop, 'name', o.name, 'linkedAt', o.linked_at)
                     order by lower(o.name), o.shop)
      from (select x.shop, private.transfer_shop_name(x.shop) as name, x.linked_at
              from (select case when l."shopA" = v_shop then l."shopB" else l."shopA" end as shop,
                           l."createdAt" as linked_at
                      from public.shop_links l
                     where l."shopA" = v_shop or l."shopB" = v_shop) x) o
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Transfers
-- ---------------------------------------------------------------------

-- What a transfer to p_to_shop would do with these products, before it
-- runs. The sender cannot read the other shop's products (RLS), so the
-- matching, stock and prices on the other side come from here.
create or replace function public.preview_transfer(p_to_shop uuid, p_product_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_src    uuid := private.transfer_shop_of_caller();
  v_pid    text;
  v_p      public.products%rowtype;
  v_d      public.products%rowtype;
  v_liquid boolean;
  v_size   numeric;
  v_res    jsonb;
  v_lines  jsonb := '[]'::jsonb;
begin
  if v_src is null then
    raise exception 'Only a shop admin can transfer stock.' using errcode = '42501';
  end if;
  if p_to_shop is null or p_to_shop = v_src then
    raise exception 'Pick another shop to send the stock to.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.shop_links l
                 where l."shopA" = least(v_src, p_to_shop) and l."shopB" = greatest(v_src, p_to_shop)) then
    raise exception 'These shops are not linked. Link them first on the Shop Transfers page.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_product_ids), 0) > 100 then
    raise exception 'At most 100 products per transfer.' using errcode = '22023';
  end if;

  for v_pid in
    select u.x
      from unnest(coalesce(p_product_ids, '{}'::text[])) with ordinality as u(x, n)
     where u.x is not null
     group by u.x
     order by min(u.n)
  loop
    select * into v_p
      from public.products p
     where p.id = v_pid and p."shopId" = v_src and (to_jsonb(p) ->> 'deletedAt') is null;
    if not found then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'fromProductId', v_pid, 'problem', 'This product was not found in this shop.'));
      continue;
    end if;

    v_liquid := lower(btrim(coalesce(v_p.category, ''))) = 'e-liquid';
    v_size := case when v_liquid then private.transfer_bottle_ml(v_p."bottleSize") end;
    v_res := private.transfer_resolve_destination(v_src, v_p.id, v_p.name, v_p.category, v_liquid, v_size, p_to_shop);

    v_d := null;
    if v_res ->> 'productId' is not null then
      select * into v_d from public.products p where p.id = v_res ->> 'productId' and p."shopId" = p_to_shop;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'fromProductId',   v_p.id,
      'productName',     v_p.name,
      'category',        v_p.category,
      'isLiquid',        v_liquid,
      'bottleSize',      v_size,
      'fromStock',       greatest(coalesce(private.transfer_finite(v_p."stockQuantity"), 0), 0),
      'match',           v_res ->> 'kind',
      'nameMatches',     (v_res ->> 'nameMatches')::integer,
      'toProductId',     v_d.id,
      'toProductName',   v_d.name,
      'toStock',         case when v_d.id is not null
                              then greatest(coalesce(private.transfer_finite(v_d."stockQuantity"), 0), 0) end,
      'toSellingPrice',  private.transfer_finite(v_d."sellingPrice"),
      'toPricePerMl',    private.transfer_finite(v_d."pricePerMl"),
      'newSellingPrice', case when v_d.id is null
                              then round(greatest(coalesce(private.transfer_finite(v_p."sellingPrice"), 0), 0)) end,
      'newPricePerMl',   case when v_d.id is null
                              then round(greatest(coalesce(private.transfer_finite(v_p."pricePerMl"), 0), 0)) end,
      'problem',         case
                           when v_liquid and v_size is null
                             then 'This e-liquid has no bottle size (ml). Set it on the Products page first.'
                           when v_p."stockQuantity" is not null and private.transfer_finite(v_p."stockQuantity") is null
                             then 'Its stock figure here is not a number. Correct its stock on the Stock page first.'
                           when v_d.id is not null and v_d."stockQuantity" is not null
                                and private.transfer_finite(v_d."stockQuantity") is null
                             then format('Its stock figure at %s is not a number. Ask that shop to correct it first.',
                                         private.transfer_shop_name(p_to_shop))
                         end));
  end loop;

  return jsonb_build_object(
    'toShopId', p_to_shop,
    'toShopName', private.transfer_shop_name(p_to_shop),
    'lines', v_lines);
end;
$$;

-- Moves stock from the caller's shop to a linked shop, in one transaction.
--   p_client_mutation_id  the app's id for this transfer, kept across
--                         retries: the same id is applied once.
--   p_items               [{productId, quantity}]: whole quantities from 1
--                         to 10000; for e-liquid the number of sealed
--                         bottles. Each product once.
-- Returns {status: 'completed' | 'duplicate', transferId, lines}.
--
-- Every error raised AFTER the duplicate check carries the hint
-- 'transfer_not_applied': the server looked the transfer id up, found it
-- not saved (no earlier call with it still running), and saved nothing now.
-- The app relies on it when it retries a transfer whose first answer was
-- lost: only such an error proves the first attempt did not go through. An
-- error raised before that point (not an admin, a bad id) says nothing
-- about an earlier attempt and has no hint.
create or replace function public.transfer_stock(
  p_client_mutation_id text,
  p_to_shop uuid,
  p_items jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_src        uuid := private.transfer_shop_of_caller();
  v_mid        text := btrim(coalesce(p_client_mutation_id, ''));
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_now_iso    text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_existing   public.stock_transfers%rowtype;
  v_transfer   text;
  v_src_name   text;
  v_dst_name   text;
  v_actor      text;
  v_item       jsonb;
  v_qty_raw    numeric;
  v_qtys       jsonb := '{}'::jsonb;
  v_ids        text[];
  v_missing    text;
  v_p          public.products%rowtype;
  v_d          public.products%rowtype;
  v_n          integer;
  v_liquid     boolean;
  v_size       numeric;
  v_moved      numeric;
  v_res        jsonb;
  v_plan       jsonb := '{}'::jsonb;
  v_dst_ids    text[] := '{}'::text[];
  v_dst_id     text;
  v_kind       text;
  v_created    boolean;
  v_src_before numeric;
  v_dst_before numeric;
  v_s_cost     numeric;
  v_d_cost     numeric;
  v_new_cost   numeric;
  v_b_moved    integer;
  v_b_new      integer;
  v_detail     text;
  v_err_state  text;
  v_err_msg    text;
  v_err_detail text;
begin
  if v_src is null then
    raise exception 'Only a shop admin can transfer stock.' using errcode = '42501';
  end if;
  if v_mid = '' or length(v_mid) > 100 then
    raise exception 'A transfer id (clientMutationId, 1 to 100 characters) is required.' using errcode = '22023';
  end if;

  -- Retry safety: one call per transfer id at a time. A retry waits here
  -- until the earlier call has finished, then finds the saved transfer and
  -- changes nothing.
  perform pg_advisory_xact_lock(hashtextextended('vapetrax.transfer.mutation:' || v_mid, 0));
  select * into v_existing from public.stock_transfers t where t."clientMutationId" = v_mid;
  if found then
    if v_existing."fromShop" <> v_src then
      raise exception 'This transfer id is already used by another shop.' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'transferId', v_existing.id,
      'toShopName', v_existing."toShopName",
      'lines', private.transfer_lines(v_existing.id));
  end if;

  -- This transfer id is not saved. From here on, every error is returned
  -- with the hint 'transfer_not_applied' (see above).
  begin
    -- Destination: another shop, linked to this one. The link is checked
    -- under both shop locks, so an unlink that is running finishes first
    -- and is then respected.
    if p_to_shop is null or p_to_shop = v_src then
      raise exception 'Pick another shop to send the stock to.' using errcode = '22023';
    end if;
    perform private.transfer_lock_shops(v_src, p_to_shop);
    if not exists (select 1 from public.shop_links l
                   where l."shopA" = least(v_src, p_to_shop) and l."shopB" = greatest(v_src, p_to_shop)) then
      raise exception 'These shops are not linked. Link them first on the Shop Transfers page.' using errcode = '42501';
    end if;

    -- Lines: whole quantities, 1 to 10000, each product once.
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'Add at least one product to the transfer.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_items) > 100 then
      raise exception 'At most 100 products per transfer.' using errcode = '22023';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_items) e
    loop
      if jsonb_typeof(v_item) <> 'object'
         or jsonb_typeof(v_item -> 'productId') is distinct from 'string'
         or btrim(v_item ->> 'productId') = '' then
        raise exception 'Every line needs a productId.' using errcode = '22023';
      end if;
      v_qty_raw := null;
      if jsonb_typeof(v_item -> 'quantity') in ('number', 'string') then
        begin
          v_qty_raw := (v_item ->> 'quantity')::numeric;
        exception when others then
          v_qty_raw := null;
        end;
      end if;
      -- ("> 10000" also refuses NaN and Infinity, which sort above every number)
      if v_qty_raw is null or v_qty_raw <= 0 or v_qty_raw > 10000 or v_qty_raw <> trunc(v_qty_raw) then
        raise exception 'Quantity must be a whole number from 1 to 10000 (got % for product %).',
          coalesce(v_item ->> 'quantity', 'nothing'), v_item ->> 'productId'
          using errcode = '22023';
      end if;
      if v_qtys ? (v_item ->> 'productId') then
        raise exception 'Product % is listed twice. Put it on one line.', v_item ->> 'productId'
          using errcode = '22023';
      end if;
      v_qtys := v_qtys || jsonb_build_object(v_item ->> 'productId', v_qty_raw::integer);
    end loop;

    -- The sender's products, locked in id order (the order a sale locks
    -- them in), so concurrent sales and transfers queue instead of colliding.
    select array_agg(k order by k) into v_ids from jsonb_object_keys(v_qtys) k;
    perform 1
       from public.products p
      where p."shopId" = v_src and p.id = any(v_ids)
      order by p.id
        for update;

    select string_agg(k, ', ' order by k) into v_missing
      from unnest(v_ids) k
     where not exists (select 1 from public.products p
                       where p.id = k and p."shopId" = v_src and (to_jsonb(p) ->> 'deletedAt') is null);
    if v_missing is not null then
      raise exception 'Product not found in this shop: %. Nothing was transferred.', v_missing using errcode = '22023';
    end if;

    -- Phase 1: check every line before anything changes, and find (or
    -- create, with no stock yet) the receiving product of each line.
    for v_p in
      select p.* from public.products p
       where p."shopId" = v_src and p.id = any(v_ids)
       order by p.id
    loop
      v_n := (v_qtys ->> v_p.id)::integer;
      v_liquid := lower(btrim(coalesce(v_p.category, ''))) = 'e-liquid';
      v_size := case when v_liquid then private.transfer_bottle_ml(v_p."bottleSize") end;
      if v_liquid and v_size is null then
        raise exception '"%" is an e-liquid without a bottle size (ml). Set its bottle size on the Products page first. Nothing was transferred.',
          v_p.name using errcode = '22023';
      end if;
      if v_p."stockQuantity" is not null and private.transfer_finite(v_p."stockQuantity") is null then
        raise exception 'The stock figure of "%" in this shop is not a number (%). Correct its stock on the Stock page first. Nothing was transferred.',
          v_p.name, v_p."stockQuantity" using errcode = '22023';
      end if;
      v_moved := case when v_liquid then v_n * v_size else v_n end;

      -- Refuse (and change nothing) when stock is short: never below zero.
      v_src_before := greatest(coalesce(v_p."stockQuantity", 0), 0);
      if v_src_before < v_moved then
        if v_liquid then
          raise exception 'Not enough stock of "%": % sealed bottle(s) = % ml asked, but only % ml is in stock. Nothing was transferred.',
            v_p.name, v_n, trim_scale(v_moved), trim_scale(v_src_before) using errcode = 'P0001';
        else
          raise exception 'Not enough stock of "%": % asked, but only % in stock. Nothing was transferred.',
            v_p.name, v_n, trim_scale(v_src_before) using errcode = 'P0001';
        end if;
      end if;

      v_res := private.transfer_resolve_destination(v_src, v_p.id, v_p.name, v_p.category, v_liquid, v_size, p_to_shop);
      v_dst_id := v_res ->> 'productId';
      v_created := v_dst_id is null;
      if v_created then
        -- New product: the sender's costs and prices (whole rupees for
        -- prices; anything that is not a number becomes 0, "unknown").
        v_dst_id := (gen_random_uuid())::text;
        insert into public.products (
          id, "shopId", name, category, brand, "bottleSize", unit,
          "costPrice", "sellingPrice", "pricePerMl", "unitCostPerMl",
          "minStockLevel", "lowStockAlert", "nicotineLevel", "stockQuantity",
          "createdAt", "updatedAt", "createdAtClient")
        values (
          v_dst_id, p_to_shop, v_p.name, v_p.category, v_p.brand, v_p."bottleSize", v_p.unit,
          greatest(coalesce(private.transfer_finite(v_p."costPrice"), 0), 0),
          round(greatest(coalesce(private.transfer_finite(v_p."sellingPrice"), 0), 0)),
          round(greatest(coalesce(private.transfer_finite(v_p."pricePerMl"), 0), 0)),
          greatest(coalesce(private.transfer_finite(v_p."unitCostPerMl"), 0), 0),
          private.transfer_finite(v_p."minStockLevel"), private.transfer_finite(v_p."lowStockAlert"),
          private.transfer_finite(v_p."nicotineLevel"), 0,
          now(), now(), v_now_iso);
      end if;
      v_plan := v_plan || jsonb_build_object(v_p.id, jsonb_build_object(
                  'to', v_dst_id, 'kind', v_res ->> 'kind', 'created', v_created));
      v_dst_ids := v_dst_ids || v_dst_id;
    end loop;

    -- The receiving products, locked in id order too (the order a sale at
    -- that shop locks them in), all before any of them changes: a transfer
    -- and a sale there never wait on each other in a circle. Products
    -- created just above are new rows nobody else can see yet.
    perform 1
       from public.products p
      where p."shopId" = p_to_shop and p.id = any(v_dst_ids)
      order by p.id
        for update;

    v_src_name := private.transfer_shop_name(v_src);
    v_dst_name := private.transfer_shop_name(p_to_shop);
    select coalesce(nullif(btrim(p.username), ''), 'Admin') into v_actor
      from public.profiles p where p.id = auth.uid();

    v_transfer := (gen_random_uuid())::text;
    insert into public.stock_transfers (
      id, "clientMutationId", "fromShop", "toShop", "fromShopName", "toShopName",
      "createdBy", "createdByName", note, status, "lineCount")
    values (
      v_transfer, v_mid, v_src, p_to_shop, v_src_name, v_dst_name,
      auth.uid(), v_actor, left(v_note, 500), 'completed', cardinality(v_ids));

    -- Phase 2: move the stock, line by line.
    for v_p in
      select p.* from public.products p
       where p."shopId" = v_src and p.id = any(v_ids)
       order by p.id
    loop
      v_n := (v_qtys ->> v_p.id)::integer;
      v_liquid := lower(btrim(coalesce(v_p.category, ''))) = 'e-liquid';
      v_size := case when v_liquid then private.transfer_bottle_ml(v_p."bottleSize") end;
      v_moved := case when v_liquid then v_n * v_size else v_n end;
      v_src_before := greatest(coalesce(v_p."stockQuantity", 0), 0);
      v_dst_id := v_plan -> v_p.id ->> 'to';
      v_kind := v_plan -> v_p.id ->> 'kind';
      v_created := (v_plan -> v_p.id ->> 'created')::boolean;

      -- 1. Sender (checked in phase 1: enough stock).
      update public.products
         set "stockQuantity" = v_src_before - v_moved,
             "updatedAt"     = now()
       where id = v_p.id and "shopId" = v_src;

      -- 2. Receiver: locked above; read now, as an earlier line of this
      --    transfer may already have added to it.
      select * into v_d
        from public.products p
       where p.id = v_dst_id and p."shopId" = p_to_shop;
      if not found or (to_jsonb(v_d) ->> 'deletedAt') is not null then
        raise exception 'The matching product at % changed during the transfer. Please try again.', v_dst_name
          using errcode = '40001';
      end if;
      if v_d."stockQuantity" is not null and private.transfer_finite(v_d."stockQuantity") is null then
        raise exception 'The stock figure of "%" at % is not a number. Ask that shop to correct its stock first. Nothing was transferred.',
          v_d.name, v_dst_name using errcode = '22023';
      end if;
      v_dst_before := greatest(coalesce(v_d."stockQuantity", 0), 0);

      -- Cost per piece, or per ml for e-liquid. 0 means "unknown" (so does
      -- a cost that is not a number).
      if v_liquid then
        v_s_cost := case when coalesce(private.transfer_finite(v_p."unitCostPerMl"), 0) > 0 then v_p."unitCostPerMl"
                         else greatest(coalesce(private.transfer_finite(v_p."costPrice"), 0), 0) / v_size end;
        v_d_cost := case when coalesce(private.transfer_finite(v_d."unitCostPerMl"), 0) > 0 then v_d."unitCostPerMl"
                         when coalesce(private.transfer_finite(v_d."costPrice"), 0) > 0 then v_d."costPrice" / v_size
                         else 0 end;
      else
        v_s_cost := greatest(coalesce(private.transfer_finite(v_p."costPrice"), 0), 0);
        v_d_cost := greatest(coalesce(private.transfer_finite(v_d."costPrice"), 0), 0);
      end if;

      if v_created then
        -- New product: costs and prices were copied when it was created.
        update public.products
           set "stockQuantity" = v_dst_before + v_moved, "updatedAt" = now()
         where id = v_dst_id and "shopId" = p_to_shop;
      else
        -- Existing product: prices untouched, cost = weighted average. When
        -- one side's cost is unknown, the other side's cost is used for it.
        v_new_cost := (v_dst_before * (case when v_d_cost > 0 then v_d_cost else v_s_cost end)
                       + v_moved * (case when v_s_cost > 0 then v_s_cost else v_d_cost end))
                      / (v_dst_before + v_moved);
        if v_liquid then
          update public.products
             set "stockQuantity" = v_dst_before + v_moved,
                 "unitCostPerMl" = round(v_new_cost, 2),
                 "costPrice"     = round(v_new_cost * v_size, 2),
                 "updatedAt"     = now()
           where id = v_dst_id and "shopId" = p_to_shop;
        else
          update public.products
             set "stockQuantity" = v_dst_before + v_moved,
                 "costPrice"     = round(v_new_cost, 2),
                 "updatedAt"     = now()
           where id = v_dst_id and "shopId" = p_to_shop;
        end if;
      end if;

      -- 3. Sealed bottles: move up to N full closed bottles of this size, and
      --    create the rest at the receiver (the sender's bottle rows are not
      --    always complete; that never stops a transfer). The NEWEST bottles
      --    move: the POS opens and sells the oldest closed bottle first, so
      --    a device of the sending shop that has not refreshed yet is
      --    unlikely to pick a bottle that has left. (A bottle without a date
      --    counts as the oldest there, so it moves last here.)
      v_b_moved := 0;
      v_b_new := 0;
      if v_liquid then
        with moved as (
          update public.bottles b
             set "shopId" = p_to_shop, "productId" = v_dst_id, "updatedAt" = now()
           where b.id in (select x.id
                            from public.bottles x
                           where x."shopId" = v_src
                             and x."productId" = v_p.id
                             and x.status = 'closed'
                             and x."bottleSize" = v_size
                             and x."remainingMl" = v_size
                             and (to_jsonb(x) ->> 'archivedAt') is null
                           order by x."createdAt" desc nulls last, x.id desc
                           limit v_n
                             for update)
          returning 1)
        select count(*)::integer into v_b_moved from moved;
        v_b_new := v_n - v_b_moved;
        insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status, "createdAt", "updatedAt")
        select (gen_random_uuid())::text, v_dst_id, p_to_shop, v_size, v_size, 'closed', now(), now()
          from generate_series(1, v_b_new);
      end if;

      -- 4. Logs in both shops (refId and notes carry the transfer id).
      v_detail := case when v_liquid
                       then format('%s sealed bottle(s) x %s ml = %s ml', v_n, v_size, trim_scale(v_moved))
                       else format('%s piece(s)', v_n) end;
      insert into public.inventory_logs (
        id, "shopId", "productId", "productName", type, action,
        "quantityChange", "previousStock", "newStock", change, "mlChange", "newStockMl",
        reason, notes, "actorName", "userName", "actorRole",
        "createdAtClient", "createdAt", "createdBy", "refId")
      values
        ((gen_random_uuid())::text, v_src, v_p.id, v_p.name, 'transfer_out', 'transfer_out',
         -v_n, v_src_before, v_src_before - v_moved, -v_moved,
         case when v_liquid then -v_moved end, case when v_liquid then v_src_before - v_moved end,
         left('Transfer to ' || v_dst_name, 200),
         left(format('Transfer %s: %s sent', v_transfer, v_detail) || coalesce(' - ' || v_note, ''), 1000),
         v_actor, v_actor, 'admin', v_now_iso, now(), auth.uid()::text, v_transfer),
        ((gen_random_uuid())::text, p_to_shop, v_dst_id, v_d.name, 'transfer_in', 'transfer_in',
         v_n, v_dst_before, v_dst_before + v_moved, v_moved,
         case when v_liquid then v_moved end, case when v_liquid then v_dst_before + v_moved end,
         left('Transfer from ' || v_src_name, 200),
         left(format('Transfer %s: %s received', v_transfer, v_detail)
              || case when v_created then ' (new product created)' else '' end
              || coalesce(' - ' || v_note, ''), 1000),
         v_actor, v_actor, 'admin', v_now_iso, now(), auth.uid()::text, v_transfer);

      -- 5. Remember the product pair (both ways) and record the line.
      insert into public.product_links ("fromShop", "fromProductId", "toShop", "toProductId")
      values (v_src, v_p.id, p_to_shop, v_dst_id)
      on conflict ("fromShop", "fromProductId", "toShop") do update
        set "toProductId" = excluded."toProductId", "updatedAt" = now()
        where public.product_links."toProductId" is distinct from excluded."toProductId";
      insert into public.product_links ("fromShop", "fromProductId", "toShop", "toProductId")
      values (p_to_shop, v_dst_id, v_src, v_p.id)
      on conflict ("fromShop", "fromProductId", "toShop") do nothing;

      insert into public.stock_transfer_items (
        "transferId", "fromProductId", "toProductId", "productName", "toProductName", category,
        quantity, "mlPerUnit", "stockMoved", "costPerUnit", "createdProduct", "matchedBy",
        "bottlesMoved", "bottlesCreated")
      values (
        v_transfer, v_p.id, v_dst_id, v_p.name, v_d.name, v_p.category,
        v_n, v_size, v_moved,
        round(case when v_liquid then v_s_cost * v_size else v_s_cost end, 2),
        v_created, v_kind, v_b_moved, v_b_new);
    end loop;

    return jsonb_build_object(
      'status', 'completed',
      'transferId', v_transfer,
      'toShopName', v_dst_name,
      'lines', private.transfer_lines(v_transfer));
  exception when others then
    get stacked diagnostics
      v_err_state  = returned_sqlstate,
      v_err_msg    = message_text,
      v_err_detail = pg_exception_detail;
    raise exception using
      errcode = v_err_state,
      message = v_err_msg,
      detail  = coalesce(v_err_detail, ''),
      hint    = 'transfer_not_applied';
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Function rights: the RPCs for logged-in users (each checks for a shop
--    admin itself), the helpers for nobody but the functions above.
-- ---------------------------------------------------------------------
revoke all on function private.transfer_shop_of_caller() from public, anon;

grant execute on function private.transfer_shop_of_caller() to authenticated;

revoke all on function private.transfer_shop_name(uuid) from public, anon, authenticated;

revoke all on function private.transfer_bottle_ml(text) from public, anon, authenticated;

revoke all on function private.transfer_finite(numeric) from public, anon, authenticated;

revoke all on function private.transfer_resolve_destination(uuid, text, text, text, boolean, numeric, uuid) from public, anon, authenticated;

revoke all on function private.transfer_lines(text) from public, anon, authenticated;

revoke all on function private.transfer_lock_shops(uuid, uuid) from public, anon, authenticated;

revoke all on function public.create_shop_link_code() from public, anon;

revoke all on function public.link_shop_with_code(text) from public, anon;

revoke all on function public.unlink_shop(uuid) from public, anon;

revoke all on function public.list_linked_shops() from public, anon;

revoke all on function public.preview_transfer(uuid, text[]) from public, anon;

revoke all on function public.transfer_stock(text, uuid, jsonb, text) from public, anon;

grant execute on function public.create_shop_link_code() to authenticated;

grant execute on function public.link_shop_with_code(text) to authenticated;

grant execute on function public.unlink_shop(uuid) to authenticated;

grant execute on function public.list_linked_shops() to authenticated;

grant execute on function public.preview_transfer(uuid, text[]) to authenticated;

grant execute on function public.transfer_stock(text, uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Validation (also used by the result table below)
-- ---------------------------------------------------------------------
create or replace function private.shop_transfers_checks()
returns table (check_name text, ok boolean, detail text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v text;
begin
  select string_agg(t, ', ' order by t) into v
    from unnest(array['public.shop_links', 'public.product_links', 'public.stock_transfers',
                      'public.stock_transfer_items', 'private.shop_link_codes',
                      'private.shop_link_attempts']) t
   where to_regclass(t) is null
      or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = to_regclass(t));
  check_name := 'rls_on_new_tables'; ok := v is null;
  detail := coalesce('missing or RLS off: ' || v, 'shop_links, product_links, stock_transfers, stock_transfer_items, 2 private tables');
  return next;

  select string_agg(t, ', ' order by t) into v
    from unnest(array['public.shop_links', 'public.product_links', 'public.stock_transfers',
                      'public.stock_transfer_items']) t
   where to_regclass(t) is null
      or not has_table_privilege('authenticated', to_regclass(t), 'SELECT')
      or has_table_privilege('authenticated', to_regclass(t), 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  check_name := 'app_can_only_read_new_tables'; ok := v is null;
  detail := coalesce('wrong rights: ' || v, 'SELECT only; writes go through the functions');
  return next;

  select string_agg(t, ', ' order by t) into v
    from unnest(array['private.shop_link_codes', 'private.shop_link_attempts']) t
   where to_regclass(t) is null
      or has_table_privilege('authenticated', to_regclass(t), 'SELECT,INSERT,UPDATE,DELETE');
  check_name := 'link_codes_hidden_from_the_app'; ok := v is null;
  detail := coalesce('readable: ' || v, 'only the code hash is stored, and nobody can read it');
  return next;

  select string_agg(s.tbl, ', ' order by s.tbl) into v
    from (select t.tbl,
                 count(p.policyname) as total,
                 count(p.policyname) filter (where p.cmd = 'SELECT' and p.roles = '{authenticated}'::name[]) as good
            from unnest(array['shop_links', 'product_links', 'stock_transfers', 'stock_transfer_items']) as t(tbl)
            left join pg_catalog.pg_policies p on p.schemaname = 'public' and p.tablename = t.tbl
           group by t.tbl) s
   where s.good <> 1 or s.total <> 1;
  check_name := 'one_read_policy_per_new_table'; ok := v is null;
  detail := coalesce('check policies on: ' || v, 'members of either shop can read; no write policy');
  return next;

  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_catalog.pg_class c
   where c.oid in (to_regclass('public.shop_links'), to_regclass('public.product_links'),
                   to_regclass('public.stock_transfers'), to_regclass('public.stock_transfer_items'),
                   to_regclass('private.shop_link_codes'), to_regclass('private.shop_link_attempts'))
     and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  select concat_ws('; ', v, string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)) into v
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
     and p.prorettype not in ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
     and not exists (select 1 from pg_catalog.pg_depend d
                     where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  v := nullif(v, '');
  check_name := 'anon_has_nothing'; ok := v is null;
  detail := coalesce('anon can use: ' || v, 'no table and no function for visitors who are not logged in');
  return next;

  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname) into v
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
     and p.proname <> 'rls_auto_enable'
     and not exists (select 1 from pg_catalog.pg_depend d
                     where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) s where s like 'search_path=%');
  check_name := 'every_function_fixes_search_path'; ok := v is null;
  detail := coalesce('no search_path: ' || v, 'ok');
  return next;

  select string_agg(f, ', ' order by f) into v
    from unnest(array['public.create_shop_link_code()', 'public.link_shop_with_code(text)',
                      'public.unlink_shop(uuid)', 'public.list_linked_shops()',
                      'public.preview_transfer(uuid,text[])',
                      'public.transfer_stock(text,uuid,jsonb,text)']) f
   where to_regprocedure(f) is null
      or not (select p.prosecdef
                     and p.proacl is not null
                     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                from pg_catalog.pg_proc p where p.oid = to_regprocedure(f))
      or not has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE');
  check_name := 'transfer_functions_for_logged_in_users'; ok := v is null;
  detail := coalesce('not ready: ' || v, '6 functions: SECURITY DEFINER, logged-in users only, each checks for a shop admin');
  return next;

  ok := exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'inventory_logs' and column_name = 'refId');
  check_name := 'inventory_logs_has_refId'; detail := 'transfer logs carry the transfer id';
  return next;

  ok := exists (select 1 from pg_catalog.pg_constraint
                where conname = 'products_stock_not_negative' and conrelid = 'public.products'::regclass)
        and exists (select 1 from pg_catalog.pg_constraint
                    where conname = 'bottles_remaining_not_negative' and conrelid = 'public.bottles'::regclass)
        and to_regprocedure('public.transfer_stock(text,uuid,jsonb,text)') is not null
        and (select p.prosrc like '%Not enough stock%' from pg_catalog.pg_proc p
              where p.oid = to_regprocedure('public.transfer_stock(text,uuid,jsonb,text)'));
  check_name := 'stock_never_negative'; detail := 'CHECK rules in place; a short transfer is refused with nothing changed';
  return next;

  ok := to_regprocedure('public.transfer_stock(text,uuid,jsonb,text)') is not null
        and (select p.prosrc like '%transfer_not_applied%' and p.prosrc like '%transfer_finite%'
               from pg_catalog.pg_proc p
              where p.oid = to_regprocedure('public.transfer_stock(text,uuid,jsonb,text)'));
  check_name := 'safe_retries_and_number_guards';
  detail := 'refusals after the duplicate check are marked for the app; NaN/Infinity stock refused';
  return next;

  -- The ledger exists only once 20261012100000 has run (this file works without it).
  check_name := 'migration_ledger';
  if to_regclass('private.schema_migrations') is null then
    ok := true;
    detail := 'no ledger yet (20261012100000 not applied): nothing to record';
  else
    ok := exists (select 1 from private.schema_migrations m where m.version = '20261012200000');
    detail := case when ok then '20261012200000 recorded in private.schema_migrations'
                   else '20261012200000 missing from private.schema_migrations' end;
  end if;
  return next;
end;
$$;

revoke all on function private.shop_transfers_checks() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Migration ledger (from 20261012100000 on; skipped when it is not there)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.mark_migration(text,text,text)') is not null then
    perform private.mark_migration('20261012200000', '20261012200000_shop_links_and_transfers.sql',
      'Shop-to-shop stock transfers.');
  end if;
end $$;

notify pgrst, 'reload schema';

-- Every check must pass, or the whole file is rolled back.
do $$
declare
  v_failed text;
begin
  select string_agg(c.check_name || ' (' || c.detail || ')', '; ') into v_failed
    from private.shop_transfers_checks() c where c.ok is not true;
  if v_failed is not null then
    raise exception 'VALIDATION FAILED, nothing was changed: %', v_failed;
  end if;
end $$;

-- The validation table to paste back (read-only).
select x.check_name as "check", x.ok, x.detail
  from (
    select 0 as pos, 'all_checks_passed' as check_name, bool_and(c.ok) as ok,
           count(*) || ' checks' as detail
      from private.shop_transfers_checks() c
    union all
    select 1, c.check_name, c.ok, c.detail from private.shop_transfers_checks() c
  ) x
 order by x.pos, x.check_name;


-- ---------------------------------------------------------------------
-- Live updates: let the app hear changes on these tables (Supabase Realtime).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['products', 'bottles', 'customers', 'sales', 'credits', 'expenses', 'inventory_logs'] loop
    if to_regclass('public.' || t) is not null and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Final check: the result should say "all_ok": true.
-- ---------------------------------------------------------------------
with expected(t) as (
  values ('profiles'), ('products'), ('bottles'), ('customers'), ('sales'), ('credits'),
         ('inventory_logs'), ('expenses'), ('personal_expenses'), ('settings'), ('inventory_alerts')
),
c as (
  select jsonb_build_object(
    'app_tables_created',
      (select bool_and(to_regclass('public.' || t) is not null) from expected),
    'rls_on_every_table',
      not exists (select 1 from pg_class k where k.relnamespace = 'public'::regnamespace
                  and k.relkind in ('r', 'p') and not k.relrowsecurity),
    'anon_has_no_table_access',
      not exists (select 1 from pg_class k where k.relnamespace = 'public'::regnamespace
                  and k.relkind in ('r', 'p')
                  and (has_table_privilege('anon', k.oid, 'SELECT') or has_table_privilege('anon', k.oid, 'INSERT')
                    or has_table_privilege('anon', k.oid, 'UPDATE') or has_table_privilege('anon', k.oid, 'DELETE'))),
    'checkout_function_ready',
      to_regprocedure('public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric)') is not null,
    'stock_never_negative_rule',
      exists (select 1 from pg_constraint where conname = 'products_stock_not_negative'),
    'realtime_on',
      (select count(*) = 7 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename in ('products', 'bottles', 'customers', 'sales', 'credits', 'expenses', 'inventory_logs'))
  ) as checks
)
select jsonb_pretty(jsonb_build_object(
  'all_ok', not exists (select 1 from jsonb_each(c.checks) e where e.value <> 'true'::jsonb),
  'checks', c.checks,
  'database_version', '20261012200000'
)) as result
from c;
