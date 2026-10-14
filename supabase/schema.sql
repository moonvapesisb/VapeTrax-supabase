-- =====================================================================
-- DO NOT RUN THIS FILE. It is a retired historical snapshot.
--
-- It is kept only as a record of how the database used to look. The live
-- database is now defined by the applied migrations
--   supabase/migrations/20261011120000_emergency_security_lockdown.sql
--   supabase/migrations/20261011140000_stock_never_negative_refill_steps.sql
-- and described by supabase/diagnostics/live-snapshot-2026-10-11.md.
--
-- Running this file in the Supabase SQL Editor would undo those fixes: it
-- can let anyone holding the public app key call shop functions, expose
-- one shop's data to another, and break checkout and the never-below-zero
-- stock rule. The DO block below stops the whole script with an error
-- before anything else runs. Do not remove it, and do not run parts of
-- this file by selecting them.
-- =====================================================================
DO $do_not_run$ BEGIN RAISE EXCEPTION 'DO NOT RUN: schema.sql is a retired snapshot, superseded by migrations 20261011120000 and 20261011140000. Nothing was changed.'; END $do_not_run$;

-- ==========================================
-- VapeTrax Firebase -> Supabase Schema
-- (Using camelCase to perfectly match Firebase data models)
-- ==========================================

-- 1. Profiles Table (replaces users collection)
create table profiles (
  "id"          uuid primary key references auth.users(id) on delete cascade,
  "username"    text not null,
  "email"       text,
  "role"        text not null default 'admin' check ("role" in ('admin','cashier')),
  "shopId"      uuid references auth.users(id),   -- cashiers point to their admin's uid
  "createdAt"   timestamptz default now()
);

alter table profiles enable row level security;
create policy "Users can read own profile"     on profiles for select using (auth.uid() = "id" or "shopId" = auth.uid());
create policy "Users can insert own profile"   on profiles for insert with check (auth.uid() = "id" or "shopId" = auth.uid());
create policy "Users can update own profile"   on profiles for update using (auth.uid() = "id" or "shopId" = auth.uid());
create policy "Admin can delete cashier"       on profiles for delete using ("shopId" = auth.uid());

-- 2. Products Table
create table products (
  "id"              text primary key,
  "shopId"          uuid not null references auth.users(id),
  "name"            text not null,
  "category"        text,
  "brand"           text,
  "costPrice"       numeric default 0,
  "sellingPrice"    numeric default 0,
  "stockQuantity"   numeric default 0,
  "minStockLevel"   numeric default 0,
  "lowStockAlert"   numeric,
  "pricePerMl"      numeric default 0,
  "unitCostPerMl"   numeric default 0,
  "unit"            text,
  "bottleSize"      text,
  "nicotineLevel"   numeric,
  "imageUrl"        text,
  "createdAtClient" text,
  "createdAt"       timestamptz default now(),
  "updatedAt"       timestamptz default now()
);

alter table products enable row level security;
create policy "Shop access products" on products for all using (
  "shopId" = auth.uid() or
  exists (select 1 from profiles where "id" = auth.uid() and "shopId" = products."shopId")
);

-- 3. Bottles Table (replaces sub-collection)
create table bottles (
  "id"             text primary key,
  "productId"      text not null references products("id") on delete cascade,
  "shopId"         uuid not null references auth.users(id),
  "bottleSize"     numeric,
  "remainingMl"    numeric,
  "status"         text default 'closed' check ("status" in ('closed','opened','empty','sold')),
  "openedDate"     timestamptz,
  "createdAt"      timestamptz default now(),
  "updatedAt"      timestamptz default now()
);

alter table bottles enable row level security;
create policy "Shop access bottles" on bottles for all using (
  "shopId" = auth.uid() or
  exists (select 1 from profiles where "id" = auth.uid() and "shopId" = bottles."shopId")
);

-- 4. Customers Table
create table customers (
  "id"              text primary key,
  "shopId"          uuid not null references auth.users(id),
  "name"            text not null,
  "phone"           text,
  "email"           text,
  "creditBalance"   numeric default 0,
  "createdAtClient" text,
  "updatedAt"       timestamptz default now(),
  "createdAt"       timestamptz default now()
);

alter table customers enable row level security;
create policy "Shop access customers" on customers for all using (
  "shopId" = auth.uid() or
  exists (select 1 from profiles where "id" = auth.uid() and "shopId" = customers."shopId")
);

-- 5. Sales Table
create table sales (
  "id"                 text primary key,
  "shopId"             uuid not null references auth.users(id),
  "customerId"         text references customers("id"),
  "totalAmount"        numeric not null default 0,
  "totalCOGS"          numeric default 0,
  "totalProfit"        numeric default 0,
  "paymentMethod"      text,
  "items"              jsonb default '[]',
  "actorName"          text,
  "actorRole"          text,
  "userName"           text,
  "saleDate"           timestamptz,
  "saleDateClient"     text,
  "notes"              text,
  "splitAmounts"       jsonb,
  "updatedAt"          timestamptz default now(),
  "createdAt"          timestamptz default now()
);

alter table sales enable row level security;
create policy "Shop access sales" on sales for all using (
  "shopId" = auth.uid() or
  exists (select 1 from profiles where "id" = auth.uid() and "shopId" = sales."shopId")
);

-- 6. Expenses Table
create table expenses (
  "id"               text primary key,
  "shopId"           uuid not null references auth.users(id),
  "category"         text,
  "description"      text,
  "amount"           numeric not null default 0,
  "expenseDate"      timestamptz,
  "createdAtClient"  text,
  "createdAt"        timestamptz default now()
);

alter table expenses enable row level security;
create policy "Shop access expenses" on expenses for all using (
  "shopId" = auth.uid() or
  exists (select 1 from profiles where "id" = auth.uid() and "shopId" = expenses."shopId")
);

-- 7. Personal Expenses Table
create table personal_expenses (
  "id"               text primary key,
  "shopId"           uuid not null references auth.users(id),
  "category"         text,
  "description"      text,
  "amount"           numeric default 0,
  "createdAtClient"  text,
  "createdAt"        timestamptz default now()
);

alter table personal_expenses enable row level security;
create policy "Shop access personal_expenses" on personal_expenses for all using (
  "shopId" = auth.uid() or
  exists (select 1 from profiles where "id" = auth.uid() and "shopId" = personal_expenses."shopId")
);

-- 8. Credits Table
create table credits (
  "id"               text primary key,
  "shopId"           uuid not null references auth.users(id),
  "creditType"       text check ("creditType" in ('customer','supplier','others')),
  "customerId"       text references customers("id"),
  "supplierId"       text,
  "entityName"       text,
  "entityContact"    text,
  "amount"           numeric not null default 0,
  "description"      text,
  "transactionType"  text check ("transactionType" in ('given','taken')),
  "createdBy"        text,
  "createdAtClient"  text,
  "createdAt"        timestamptz default now()
);

alter table credits enable row level security;
create policy "Shop access credits" on credits for all using (
  "shopId" = auth.uid() or
  exists (select 1 from profiles where "id" = auth.uid() and "shopId" = credits."shopId")
);

-- 9. Inventory Logs Table
create table inventory_logs (
  "id"              text primary key,
  "shopId"          uuid not null references auth.users(id),
  "productId"       text references products("id"),
  "productName"     text,
  "type"            text,
  "action"          text,
  "quantityChange"  numeric,
  "previousStock"   numeric,
  "newStock"        numeric,
  "change"          numeric,
  "mlChange"        numeric,
  "newStockMl"      numeric,
  "reason"          text,
  "notes"           text,
  "actorName"       text,
  "userName"        text,
  "actorRole"       text,
  "createdAtClient" text,
  "createdAt"       timestamptz default now()
);

alter table inventory_logs enable row level security;
create policy "Shop access inventory_logs" on inventory_logs for all using (
  "shopId" = auth.uid() or
  exists (select 1 from profiles where "id" = auth.uid() and "shopId" = inventory_logs."shopId")
);

-- 10. Settings Table
create table settings (
  "shopId"              uuid primary key references auth.users(id),
  "shopName"            text,
  "shopLogo"            text,
  "logoUrl"             text,
  "shopAddress"         text,
  "shopPhone"           text,
  "shopEmail"           text,
  "shopWebsite"         text,
  "currency"            text default 'Rs',
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

alter table settings enable row level security;
create policy "Owner access settings" on settings for all using ("shopId" = auth.uid());

-- 11. Finance Accounts and Transactions
create table finance_accounts (
  "id"         text primary key,
  "shopId"     uuid not null references auth.users(id),
  "name"       text,
  "type"       text,
  "balance"    numeric default 0,
  "createdAt"  timestamptz default now()
);

alter table finance_accounts enable row level security;
create policy "Shop access finance_accounts" on finance_accounts for all using (
  "shopId" = auth.uid() or exists (select 1 from profiles where "id" = auth.uid() and "shopId" = finance_accounts."shopId")
);

create table finance_transactions (
  "id"              text primary key,
  "shopId"          uuid not null references auth.users(id),
  "accountId"       text references finance_accounts("id"),
  "type"            text,
  "amount"          numeric,
  "description"     text,
  "referenceId"     text,
  "referenceType"   text,
  "createdAt"       timestamptz default now()
);

alter table finance_transactions enable row level security;
create policy "Shop access finance_transactions" on finance_transactions for all using (
  "shopId" = auth.uid() or exists (select 1 from profiles where "id" = auth.uid() and "shopId" = finance_transactions."shopId")
);

-- 12. Daily Summaries and Stock Alerts
create table daily_summaries (
  "id"          text primary key,
  "shopId"      uuid not null references auth.users(id),
  "summaryDate" date,
  "data"        jsonb default '{}',
  "createdAt"   timestamptz default now()
);

alter table daily_summaries enable row level security;
create policy "Owner access daily_summaries" on daily_summaries for all using ("shopId" = auth.uid());

create table stock_alerts (
  "id"          text primary key,
  "shopId"      uuid not null references auth.users(id),
  "productId"   text references products("id"),
  "threshold"   numeric,
  "active"      boolean default true,
  "createdAt"   timestamptz default now()
);

alter table stock_alerts enable row level security;
create policy "Shop access stock_alerts" on stock_alerts for all using (
  "shopId" = auth.uid() or exists (select 1 from profiles where "id" = auth.uid() and "shopId" = stock_alerts."shopId")
);
