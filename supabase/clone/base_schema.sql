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
