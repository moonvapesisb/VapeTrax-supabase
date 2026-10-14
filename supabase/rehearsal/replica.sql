-- =====================================================================
-- supabase/rehearsal/replica.sql
-- REHEARSAL ONLY. Loaded into a local PGlite (Postgres 17) database by
-- supabase/rehearsal/lib.mjs. NEVER paste this into the Supabase SQL Editor.
--
-- Recreates the LIVE database's schema (no data) as it was on 2026-10-11,
-- just BEFORE migration 20261011120000 was applied. Every migration in
-- supabase/migrations/ is then rehearsed on top of it.
--
-- Sources (the live database is the truth, not supabase/schema.sql):
--   * supabase/diagnostics/live-snapshot-2026-10-11.md (diagnostics 01-04
--     run by the owner on live);
--   * src/types/supabase.ts (generated from live before the lockdown: it
--     gives the column list of every table);
--   * Supabase's own definitions for the auth helpers, roles and default
--     privileges.
--
-- Known differences from live (keep this list current):
--   * Old function BODIES are simplified stand-ins. The signatures, owners,
--     SECURITY DEFINER flags and grants match; 20261011120000 replaces the
--     bodies anyway.
--   * public.rls_auto_enable() is a stand-in for Supabase's helper, and its
--     event trigger is created DISABLED, so no migration can lean on it.
--     supabase/diagnostics/07_integrity_probe.sql reports the real body and
--     whether the trigger is enabled live; copy them here once known.
--   * Column types the snapshot does not pin down are noted inline
--     ("assumed").
--   * Here everything runs as a true superuser. On Supabase the postgres
--     role is not a superuser and cannot change objects owned by Supabase
--     (for example the auth schema's tables).
--   * pg_stat_statements and supabase_vault are not available in PGlite.
-- =====================================================================

-- Refuse to run anywhere except the rehearsal (lib.mjs sets this marker).
do $replica_guard$
begin
  if coalesce(current_setting('rehearsal.replica', true), '') <> 'on' then
    raise exception 'DO NOT RUN: supabase/rehearsal/replica.sql is for the local rehearsal only. Nothing was changed.';
  end if;
end
$replica_guard$;

-- ---------------------------------------------------------------------
-- Roles and extensions (as on every Supabase project)
-- ---------------------------------------------------------------------
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase's database search_path. PGlite has a single session, so set it
-- for the session as well.
do $$
begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;
set search_path = "$user", public, extensions;

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- auth schema: the parts the app, the diagnostics and the scripts use
-- ---------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key,
  email              text,
  created_at         timestamptz default now(),
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz
);

create table auth.identities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null,
  provider_id text,
  created_at  timestamptz default now()
);

create table auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- Supabase's definitions: PostgREST 12 sets request.jwt.claims (JSON);
-- older versions set request.jwt.claim.<name>. Both are read.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- public tables (every live table; ids are text without defaults except
-- the snake_case legacy tables)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  email       text,
  role        text not null default 'admin' check (role in ('admin', 'cashier')),
  "shopId"    uuid references auth.users(id),
  "createdAt" timestamptz default now()
);

create table public.products (
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

create table public.bottles (
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

create table public.customers (
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

create table public.sales (
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

create table public.credits (
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

create table public.inventory_logs (
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

create table public.expenses (
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

create table public.personal_expenses (
  id                text primary key,
  "shopId"          uuid not null references auth.users(id),
  category          text,
  description       text,
  amount            numeric default 0,
  "createdAtClient" text,
  "createdAt"       timestamptz default now()
);

-- Column defaults below are assumed from the retired schema.sql.
create table public.settings (
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

create table public.daily_summaries (
  id            text primary key,
  "shopId"      uuid not null references auth.users(id),
  "summaryDate" date,
  data          jsonb default '{}'::jsonb,
  "createdAt"   timestamptz default now()
);

create table public.finance_accounts (
  id          text primary key,
  "shopId"    uuid not null references auth.users(id),
  name        text,
  type        text,
  balance     numeric default 0,
  "createdAt" timestamptz default now()
);

create table public.finance_transactions (
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

create table public.stock_alerts (
  id          text primary key,
  "shopId"    uuid not null references auth.users(id),
  "productId" text references public.products(id),
  threshold   numeric,
  active      boolean default true,
  "createdAt" timestamptz default now()
);

-- snake_case legacy tables: uuid ids with uuid_generate_v4(). shop_id has
-- no foreign key (the snapshot lists none).
create table public.users (
  id         uuid primary key default extensions.uuid_generate_v4(),
  email      text not null,
  username   text not null,
  role       text not null check (role in ('admin', 'cashier')),
  shop_id    uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint users_email_key unique (email)
);

create table public.suppliers (
  id             uuid primary key default extensions.uuid_generate_v4(),
  shop_id        uuid not null,
  name           text not null,
  contact_number text,
  email          text,
  city           text,
  created_at     timestamptz default now()
);

create table public.purchases (
  id             uuid primary key default extensions.uuid_generate_v4(),
  shop_id        uuid not null,
  supplier_id    uuid not null references public.suppliers(id),
  product_id     text not null,              -- type assumed
  quantity       numeric not null,
  purchase_price numeric not null,
  purchase_date  timestamptz not null,       -- type assumed
  created_at     timestamptz default now()
);

create table public.inventory_alerts (
  id           uuid primary key default extensions.uuid_generate_v4(),
  shop_id      uuid not null,
  product_id   text not null,
  product_name text not null,
  message      text not null,
  resolved     boolean default false,
  created_at   timestamptz default now(),
  resolved_at  timestamptz
);

-- ---------------------------------------------------------------------
-- Row Level Security as live: ON everywhere except profiles
-- (fix-rls.sql had turned it off there)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'products', 'bottles', 'customers', 'sales', 'credits', 'inventory_logs',
    'expenses', 'personal_expenses', 'settings', 'daily_summaries',
    'finance_accounts', 'finance_transactions', 'stock_alerts', 'users',
    'suppliers', 'purchases', 'inventory_alerts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- One FOR ALL policy per business table: no WITH CHECK, no role filter.
  foreach t in array array[
    'products', 'bottles', 'customers', 'sales', 'credits', 'inventory_logs',
    'expenses', 'personal_expenses', 'finance_accounts', 'finance_transactions',
    'stock_alerts'
  ] loop
    execute format($f$create policy "Shop access %1$s" on public.%1$I for all
      using (("shopId" = auth.uid()) or (exists (select 1 from profiles
        where ((profiles.id = auth.uid()) and (profiles."shopId" = %1$I."shopId")))))$f$, t);
  end loop;
end $$;

create policy "Owner access settings" on public.settings for all using ("shopId" = auth.uid());
create policy "Owner access daily_summaries" on public.daily_summaries for all using ("shopId" = auth.uid());

create policy "Users can read own profile" on public.profiles for select
  using ((auth.uid() = id) or ("shopId" = auth.uid()));
create policy "Users can insert own profile" on public.profiles for insert
  with check ((auth.uid() = id) or ("shopId" = auth.uid()));
create policy "Users can update own profile" on public.profiles for update
  using ((auth.uid() = id) or ("shopId" = auth.uid()));
create policy "Admin can delete cashier" on public.profiles for delete
  using ("shopId" = auth.uid());

create policy "Allow all read inventory_alerts" on public.inventory_alerts for select using (true);
create policy "Allow all insert inventory_alerts" on public.inventory_alerts for insert with check (true);
create policy "Allow all update inventory_alerts" on public.inventory_alerts for update using (true);
-- users, suppliers and purchases: RLS on and no policies (locked).

-- ---------------------------------------------------------------------
-- Grants as live (grants.sql was applied). inventory_alerts was created
-- later and has no grants.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select c.relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
             and c.relname <> 'inventory_alerts'
  loop
    execute format('grant all on public.%I to anon, authenticated, service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Realtime publication (tables listed in the snapshot)
-- ---------------------------------------------------------------------
create publication supabase_realtime for table
  public.bottles, public.credits, public.customers, public.daily_summaries,
  public.expenses, public.finance_accounts, public.finance_transactions,
  public.inventory_logs, public.personal_expenses, public.products,
  public.profiles, public.sales, public.stock_alerts, public.users;

-- ---------------------------------------------------------------------
-- Functions as live: SECURITY DEFINER, no search_path, executable by anon.
-- Bodies are simplified stand-ins (20261011120000 replaces them).
-- ---------------------------------------------------------------------
create function public.process_checkout(
  p_shop_id text, p_sale_data jsonb, p_product_updates jsonb, p_bottle_updates jsonb,
  p_inventory_logs jsonb, p_customer_id text default null, p_credit_increment numeric default 0)
returns void language plpgsql security definer as $$
begin
  insert into public.sales (id, "shopId", "totalAmount")
  values (p_sale_data->>'id', p_shop_id::uuid, (p_sale_data->>'totalAmount')::numeric)
  on conflict (id) do nothing;
end $$;

create function public.process_reversal(
  p_shop_id uuid, p_sale_id text, p_delete_sale boolean, p_inventory_logs jsonb,
  p_bottle_updates jsonb, p_product_updates jsonb, p_customer_id text, p_credit_decrement numeric)
returns void language plpgsql security definer as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and "shopId" = p_shop_id)
     and auth.uid() != p_shop_id then
    raise exception 'Unauthorized shop access';
  end if;
  if p_delete_sale then delete from sales where id = p_sale_id; end if;
end $$;

create function public.process_stock_adjustment(
  p_shop_id uuid, p_product_id text, p_product_update jsonb, p_bottle_updates jsonb,
  p_bottle_inserts jsonb, p_inventory_logs jsonb)
returns void language plpgsql security definer as $$ begin null; end $$;

create function public.process_stock_adjustment(
  p_shop_id uuid, p_product_id uuid, p_product_update jsonb, p_bottle_updates jsonb,
  p_bottle_inserts jsonb, p_inventory_logs jsonb)
returns void language plpgsql security definer as $$ begin null; end $$;

-- Stand-in for Supabase's "enable RLS on new tables" helper (see header).
create function public.rls_auto_enable() returns event_trigger
language plpgsql security definer as $$
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      execute format('alter table if exists %s enable row level security', cmd.object_identity);
    end if;
  end loop;
end $$;

create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
alter event trigger ensure_rls disable;

grant execute on all functions in schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Supabase's default privileges for objects postgres creates later in
-- public. Every NEW table, sequence and function is granted to anon,
-- authenticated and service_role unless a migration revokes it, and new
-- functions are also executable by PUBLIC (Postgres' global default).
-- Set last, so the existing tables above keep exactly the live grants.
-- ---------------------------------------------------------------------
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
