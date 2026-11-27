-- =====================================================================
-- 20261127100000_cash_and_bank_management.sql
-- Cash & Bank Account Management module for VapeTrax:
--   1. Extends finance_accounts & finance_transactions (camelCase, whole
--      rupees, append-only ledger, partial unique primary/cash indexes,
--      derived balances via trigger - no stored balanceAfter).
--   2. Adds paidFromAccountId to expenses & paymentMethod/accountId to credits.
--   3. SELECT-only RLS for shop-level + direct shop_links sharing (non-transitive);
--      all writes go exclusively through SECURITY DEFINER RPCs.
--   4. Enables Supabase Realtime idempotently for finance_accounts,
--      finance_transactions and shop_links.
--   5. Auto-creates shopCash & primaryOnline for existing & new shops.
--   6. Extends process_checkout & process_reversal atomically (wrapped in
--      comment-only [FINANCE_START]/[FINANCE_END] markers).
--   7. Adds finance RPCs: ensure_shop_finance_accounts, create_finance_account,
--      update_finance_account, archive_finance_account, record_opening_balance,
--      transfer_funds, record_payout, record_expense, update_expense,
--      delete_expense, record_credit_payment, reverse_finance_transaction,
--      get_linked_shops_finance_summary.
-- =====================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

select private.require_migration(array['20261012100000', '20261012200000']);

select private.snapshot_functions('pre_20261127100000', array[
  'public.process_checkout(text,jsonb,jsonb,jsonb,jsonb,text,numeric)',
  'public.process_reversal(uuid,text,boolean,jsonb,jsonb,jsonb,text,numeric)'
]);
select private.snapshot_policies('pre_20261127100000', 'public');

-- ---------------------------------------------------------------------
-- 1. Schema updates: finance_accounts, finance_transactions, expenses, credits
-- ---------------------------------------------------------------------
alter table public.finance_accounts
  add column if not exists "ownerShopId"   uuid references auth.users(id),
  add column if not exists "bankName"      text,
  add column if not exists "accountNumber" text,
  add column if not exists "isOverdrawn"   boolean not null default false,
  add column if not exists "isArchived"    boolean not null default false,
  add column if not exists "archivedAt"    timestamptz,
  add column if not exists "updatedAt"     timestamptz not null default now();

alter table public.finance_transactions
  add column if not exists "ownerShopId"           uuid references auth.users(id),
  add column if not exists "counterpartyAccountId" text references public.finance_accounts(id),
  add column if not exists direction               text,
  add column if not exists "transferId"            text,
  add column if not exists category                text,
  add column if not exists "paidTo"                text,
  add column if not exists notes                   text,
  add column if not exists "actorName"             text,
  add column if not exists "actorRole"             text,
  add column if not exists "createdBy"             text,
  add column if not exists "occurredAt"            timestamptz not null default now(),
  add column if not exists "updatedAt"             timestamptz not null default now();

alter table public.expenses
  add column if not exists "paidFromAccountId" text references public.finance_accounts(id);

alter table public.credits
  add column if not exists "paymentMethod" text,
  add column if not exists "accountId"     text references public.finance_accounts(id);

-- Strict pre-migration data guard: NEVER coerce existing rows.
-- Fail immediately if any existing row has null or invalid core fields.
do $$
declare
  v_bad_accounts bigint;
  v_bad_txs      bigint;
begin
  select count(*) into v_bad_accounts
    from public.finance_accounts
   where "shopId" is null
      or coalesce(btrim(name), '') = ''
      or type is null
      or type not in ('shopCash', 'primaryOnline', 'secondaryBank')
      or balance is null
      or balance = 'NaN'::numeric
      or abs(balance) = 'Infinity'::numeric
      or balance <> trunc(balance)
      or "createdAt" is null
      or ("ownerShopId" is not null and "ownerShopId" <> "shopId");

  if v_bad_accounts > 0 then
    raise exception 'Migration stopped: % existing row(s) in public.finance_accounts have null or invalid fields.', v_bad_accounts;
  end if;

  if exists (select 1 from public.finance_accounts where "ownerShopId" is null) then
    update public.finance_accounts
       set "ownerShopId" = "shopId",
           "isOverdrawn" = (balance < 0)
     where "ownerShopId" is null;
  end if;

  select count(*) into v_bad_txs
    from public.finance_transactions t
    left join public.finance_accounts a on a.id = t."accountId"
   where t."shopId" is null
      or t."accountId" is null
      or a.id is null
      or t.type is null
      or t.type not in ('sale', 'saleReversal', 'transferIn', 'transferOut', 'payout', 'expense', 'expenseReversal', 'creditPayment', 'opening', 'adjustment')
      or t.direction is null
      or t.direction not in ('in', 'out')
      or t.amount is null
      or t.amount = 'NaN'::numeric
      or abs(t.amount) = 'Infinity'::numeric
      or t.amount <= 0
      or t.amount <> trunc(t.amount)
      or t.amount >= 1000000000000
      or t."createdAt" is null
      or (t."ownerShopId" is not null and t."ownerShopId" <> a."ownerShopId");

  if v_bad_txs > 0 then
    raise exception 'Migration stopped: % existing row(s) in public.finance_transactions have null or invalid fields.', v_bad_txs;
  end if;

  if exists (select 1 from public.finance_transactions where "ownerShopId" is null) then
    update public.finance_transactions t
       set "ownerShopId" = a."ownerShopId"
      from public.finance_accounts a
     where a.id = t."accountId"
       and t."ownerShopId" is null;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_accounts' and column_name='ownerShopId' and is_nullable='YES') then
    alter table public.finance_accounts alter column "ownerShopId" set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_accounts' and column_name='name' and is_nullable='YES') then
    alter table public.finance_accounts alter column name set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_accounts' and column_name='type' and is_nullable='YES') then
    alter table public.finance_accounts alter column type set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_accounts' and column_name='balance' and is_nullable='YES') then
    alter table public.finance_accounts alter column balance set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_accounts' and column_name='createdAt' and is_nullable='YES') then
    alter table public.finance_accounts alter column "createdAt" set not null;
  end if;
end $$;

alter table public.finance_accounts
  alter column balance set default 0,
  alter column "createdAt" set default now();

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_transactions' and column_name='ownerShopId' and is_nullable='YES') then
    alter table public.finance_transactions alter column "ownerShopId" set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_transactions' and column_name='accountId' and is_nullable='YES') then
    alter table public.finance_transactions alter column "accountId" set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_transactions' and column_name='type' and is_nullable='YES') then
    alter table public.finance_transactions alter column type set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_transactions' and column_name='direction' and is_nullable='YES') then
    alter table public.finance_transactions alter column direction set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_transactions' and column_name='amount' and is_nullable='YES') then
    alter table public.finance_transactions alter column amount set not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='finance_transactions' and column_name='createdAt' and is_nullable='YES') then
    alter table public.finance_transactions alter column "createdAt" set not null;
  end if;
end $$;

alter table public.finance_transactions
  alter column "createdAt" set default now();

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_accounts_type_check' and conrelid = 'public.finance_accounts'::regclass) then
    alter table public.finance_accounts add constraint finance_accounts_type_check
      check (type in ('shopCash', 'primaryOnline', 'secondaryBank'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_accounts_name_nonempty' and conrelid = 'public.finance_accounts'::regclass) then
    alter table public.finance_accounts add constraint finance_accounts_name_nonempty
      check (coalesce(btrim(name), '') <> '');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_accounts_owner_matches_shop' and conrelid = 'public.finance_accounts'::regclass) then
    alter table public.finance_accounts add constraint finance_accounts_owner_matches_shop
      check ("ownerShopId" = "shopId");
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_accounts_balance_integer' and conrelid = 'public.finance_accounts'::regclass) then
    alter table public.finance_accounts add constraint finance_accounts_balance_integer
      check (balance <> 'NaN'::numeric and abs(balance) <> 'Infinity'::numeric and balance = trunc(balance));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_accounts_overdrawn_sync' and conrelid = 'public.finance_accounts'::regclass) then
    alter table public.finance_accounts add constraint finance_accounts_overdrawn_sync
      check ("isOverdrawn" = (balance < 0));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_accounts_system_not_archived' and conrelid = 'public.finance_accounts'::regclass) then
    alter table public.finance_accounts add constraint finance_accounts_system_not_archived
      check (not ("isArchived" and type in ('shopCash', 'primaryOnline')));
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_transactions_direction_check' and conrelid = 'public.finance_transactions'::regclass) then
    alter table public.finance_transactions add constraint finance_transactions_direction_check
      check (direction in ('in', 'out'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_transactions_type_check' and conrelid = 'public.finance_transactions'::regclass) then
    alter table public.finance_transactions add constraint finance_transactions_type_check
      check (type in ('sale', 'saleReversal', 'transferIn', 'transferOut', 'payout', 'expense', 'expenseReversal', 'creditPayment', 'opening', 'adjustment'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_transactions_amount_positive_int' and conrelid = 'public.finance_transactions'::regclass) then
    alter table public.finance_transactions add constraint finance_transactions_amount_positive_int
      check (amount <> 'NaN'::numeric and abs(amount) <> 'Infinity'::numeric and amount > 0 and amount < 1000000000000 and amount = trunc(amount));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_transactions_ref_type_check' and conrelid = 'public.finance_transactions'::regclass) then
    alter table public.finance_transactions add constraint finance_transactions_ref_type_check
      check ("referenceType" is null or "referenceType" in ('sale', 'saleReversal', 'transfer', 'payout', 'expense', 'expenseReversal', 'credit', 'opening', 'adjustment'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_transactions_payout_fields_check' and conrelid = 'public.finance_transactions'::regclass) then
    alter table public.finance_transactions add constraint finance_transactions_payout_fields_check
      check (type <> 'payout' or (category in ('supplierPayment', 'ownerWithdrawal', 'staffAdvance', 'generalPayout') and coalesce(btrim("paidTo"), '') <> ''));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'finance_transactions_transfer_fields_check' and conrelid = 'public.finance_transactions'::regclass) then
    alter table public.finance_transactions add constraint finance_transactions_transfer_fields_check
      check (type not in ('transferIn', 'transferOut') or ("transferId" is not null and "counterpartyAccountId" is not null and "counterpartyAccountId" <> "accountId"));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'credits_payment_method_check' and conrelid = 'public.credits'::regclass) then
    alter table public.credits add constraint credits_payment_method_check
      check ("paymentMethod" is null or "paymentMethod" in ('cash', 'online'));
  end if;
end $$;

-- Partial unique indexes & query indexes
create unique index if not exists finance_accounts_one_cash_per_shop
  on public.finance_accounts ("ownerShopId")
  where type = 'shopCash' and not "isArchived";

create unique index if not exists finance_accounts_one_primary_per_shop
  on public.finance_accounts ("ownerShopId")
  where type = 'primaryOnline' and not "isArchived";

create index if not exists finance_accounts_owner_type_idx
  on public.finance_accounts ("ownerShopId", type)
  where not "isArchived";

create unique index if not exists finance_transactions_transfer_leg_unique
  on public.finance_transactions ("transferId", direction)
  where "transferId" is not null;

-- Note: 'expense' is intentionally excluded so repeated expense edits do not collide.
-- 'adjustment' guarantees at most one reversal per original referenceId (transaction id).
create unique index if not exists finance_transactions_single_ref_unique
  on public.finance_transactions ("referenceType", "referenceId")
  where "referenceType" in ('credit', 'opening', 'adjustment') and "referenceId" is not null;

create index if not exists finance_transactions_owner_occurred_idx
  on public.finance_transactions ("ownerShopId", "occurredAt" desc, id);

create index if not exists finance_transactions_account_occurred_idx
  on public.finance_transactions ("accountId", "occurredAt" desc, id);

create index if not exists finance_transactions_shop_occurred_idx
  on public.finance_transactions ("shopId", "occurredAt" desc, id);

create index if not exists finance_transactions_ref_idx
  on public.finance_transactions ("referenceType", "referenceId")
  where "referenceId" is not null;

create index if not exists expenses_paid_from_account_idx
  on public.expenses ("paidFromAccountId")
  where "paidFromAccountId" is not null;

-- ---------------------------------------------------------------------
-- 2. Private helpers & ledger balance trigger
-- ---------------------------------------------------------------------
create or replace function private.is_cashier()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'cashier'
     );
$$;

create or replace function private.are_shops_directly_linked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null
     and p_b is not null
     and p_a <> p_b
     and exists (
       select 1 from public.shop_links l
        where l."shopA" = least(p_a, p_b)
          and l."shopB" = greatest(p_a, p_b)
     );
$$;

create or replace function private.ensure_shop_finance_accounts(p_shop uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_shop is null then
    return;
  end if;

  insert into public.finance_accounts (
    id, "shopId", "ownerShopId", name, type, balance, "isOverdrawn", "isArchived", "createdAt", "updatedAt"
  )
  values (
    pg_catalog.gen_random_uuid()::text, p_shop, p_shop, 'Shop Cash', 'shopCash', 0, false, false, now(), now()
  )
  on conflict ("ownerShopId") where (type = 'shopCash' and not "isArchived") do nothing;

  insert into public.finance_accounts (
    id, "shopId", "ownerShopId", name, type, balance, "isOverdrawn", "isArchived", "createdAt", "updatedAt"
  )
  values (
    pg_catalog.gen_random_uuid()::text, p_shop, p_shop, 'Primary Online', 'primaryOnline', 0, false, false, now(), now()
  )
  on conflict ("ownerShopId") where (type = 'primaryOnline' and not "isArchived") do nothing;
end;
$$;

create or replace function private.finance_tx_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select a."ownerShopId" into v_owner
    from public.finance_accounts a
   where a.id = new."accountId";
  if v_owner is null then
    raise exception 'Finance account % not found.', new."accountId" using errcode = '23503';
  end if;
  new."ownerShopId" := v_owner;
  if new."occurredAt" is null then
    new."occurredAt" := now();
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transactions_before_insert on public.finance_transactions;
create trigger finance_transactions_before_insert
  before insert on public.finance_transactions
  for each row execute function private.finance_tx_before_insert();

create or replace function private.finance_tx_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric;
begin
  v_delta := case when new.direction = 'in' then new.amount else -new.amount end;
  update public.finance_accounts
     set balance       = balance + v_delta,
         "isOverdrawn" = (balance + v_delta) < 0,
         "updatedAt"   = now()
   where id = new."accountId";
  return new;
end;
$$;

drop trigger if exists finance_transactions_after_insert on public.finance_transactions;
create trigger finance_transactions_after_insert
  after insert on public.finance_transactions
  for each row execute function private.finance_tx_after_insert();

drop trigger if exists finance_transactions_append_only on public.finance_transactions;
create trigger finance_transactions_append_only
  before update or delete on public.finance_transactions
  for each row execute function private.append_only_guard();

drop trigger if exists finance_transactions_no_truncate on public.finance_transactions;
create trigger finance_transactions_no_truncate
  before truncate on public.finance_transactions
  for each statement execute function private.append_only_guard();

create or replace function private.profiles_provision_finance_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'admin' and new."shopId" = new.id then
    perform private.ensure_shop_finance_accounts(new."shopId");
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_provision_finance_accounts on public.profiles;
create trigger profiles_provision_finance_accounts
  after insert on public.profiles
  for each row execute function private.profiles_provision_finance_accounts();

do $$
declare
  r record;
begin
  for r in
    select distinct s.sid from (
      select "shopId" as sid from public.profiles where "shopId" is not null
      union
      select "shopId" as sid from public.settings where "shopId" is not null
    ) s
  loop
    perform private.ensure_shop_finance_accounts(r.sid);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Rights, Row Level Security (SELECT-only), and Realtime publication
-- ---------------------------------------------------------------------
alter table public.finance_accounts enable row level security;
alter table public.finance_transactions enable row level security;

revoke all on table public.finance_accounts, public.finance_transactions from public, anon, authenticated;
grant select on table public.finance_accounts, public.finance_transactions to authenticated;

select private.drop_all_policies('public', 'finance_accounts');
create policy finance_accounts_select on public.finance_accounts
  for select to authenticated
  using (
    (
      private.is_shop_member("ownerShopId")
      and (type = 'shopCash' or not private.is_cashier())
    )
    or (
      not private.is_cashier()
      and type = 'secondaryBank'
      and private.are_shops_directly_linked((select auth.uid()), "ownerShopId")
    )
  );

select private.drop_all_policies('public', 'finance_transactions');
create policy finance_transactions_select on public.finance_transactions
  for select to authenticated
  using (
    (
      private.is_shop_member("ownerShopId")
      and (
        not private.is_cashier()
        or exists (
          select 1 from public.finance_accounts a
           where a.id = finance_transactions."accountId" and a.type = 'shopCash'
        )
      )
    )
    or (
      not private.is_cashier()
      and private.are_shops_directly_linked((select auth.uid()), "ownerShopId")
      and exists (
        select 1 from public.finance_accounts a
         where a.id = finance_transactions."accountId" and a.type = 'secondaryBank'
      )
    )
  );

do $$
declare
  t text;
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['finance_accounts', 'finance_transactions', 'shop_links'] loop
      if not exists (
        select 1 from pg_catalog.pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Update process_checkout & process_reversal (identical to
--    pre_20261127100000 except for [FINANCE_START]/[FINANCE_END] blocks)
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
  -- [FINANCE_START]
  v_cash_amt   numeric := 0;
  v_online_amt numeric := 0;
  v_cash_acc   text;
  v_online_acc text;
  v_epoch      text;
  v_tx_prefix  text;
  -- [FINANCE_END]
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
  -- [FINANCE_START]
  -- 8. Atomic Finance Ledger entries (append-only, deterministic idempotent IDs)
  v_cash_amt := case v_pm
                  when 'cash' then round(greatest(v_total, 0))
                  when 'split' then round(greatest(coalesce(private.finite_numeric(p_sale_data->'splitAmounts'->>'cash'), 0), 0))
                  else 0
                end;
  v_online_amt := case v_pm
                    when 'online' then round(greatest(v_total, 0))
                    when 'split' then round(greatest(coalesce(private.finite_numeric(p_sale_data->'splitAmounts'->>'online'), 0), 0))
                    else 0
                  end;

  if v_cash_amt > 0 or v_online_amt > 0 then
    perform private.ensure_shop_finance_accounts(v_shop);
    v_epoch := nullif(btrim(coalesce(p_sale_data->>'ledgerEpoch', '')), '');
    v_tx_prefix := case when v_epoch is not null then v_sale_id || ':' || v_epoch else v_sale_id end;

    if v_cash_amt > 0 then
      select id into v_cash_acc
        from public.finance_accounts
       where "ownerShopId" = v_shop and type = 'shopCash' and not "isArchived"
       limit 1;
      if v_cash_acc is not null then
        insert into public.finance_transactions (
          id, "shopId", "ownerShopId", "accountId", type, direction, amount,
          description, "referenceId", "referenceType", "actorName", "actorRole",
          "createdBy", "occurredAt", "createdAt", "updatedAt"
        )
        values (
          v_tx_prefix || ':cash', v_shop, v_shop, v_cash_acc, 'sale', 'in', v_cash_amt,
          'Sale #' || upper(right(v_sale_id, 6)) || case when v_pm = 'split' then ' (Cash)' else '' end,
          v_sale_id, 'sale', coalesce(v_actor_name, p_sale_data->>'actorName'),
          coalesce(v_actor_role, p_sale_data->>'actorRole'), v_uid::text, v_sale_date, now(), now()
        )
        on conflict (id) do nothing;
      end if;
    end if;

    if v_online_amt > 0 then
      select id into v_online_acc
        from public.finance_accounts
       where "ownerShopId" = v_shop and type = 'primaryOnline' and not "isArchived"
       limit 1;
      if v_online_acc is not null then
        insert into public.finance_transactions (
          id, "shopId", "ownerShopId", "accountId", type, direction, amount,
          description, "referenceId", "referenceType", "actorName", "actorRole",
          "createdBy", "occurredAt", "createdAt", "updatedAt"
        )
        values (
          v_tx_prefix || ':online', v_shop, v_shop, v_online_acc, 'sale', 'in', v_online_amt,
          'Sale #' || upper(right(v_sale_id, 6)) || case when v_pm = 'split' then ' (Online)' else '' end,
          v_sale_id, 'sale', coalesce(v_actor_name, p_sale_data->>'actorName'),
          coalesce(v_actor_role, p_sale_data->>'actorRole'), v_uid::text, v_sale_date, now(), now()
        )
        on conflict (id) do nothing;
      end if;
    end if;
  end if;
  -- [FINANCE_END]

  return jsonb_build_object('status', 'applied', 'saleId', v_sale_id);
end;
$$;

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
  -- [FINANCE_START]
  v_rev_seq    integer;
  v_cash_acc   text;
  v_online_acc text;
  v_net_cash   numeric := 0;
  v_net_online numeric := 0;
  -- [FINANCE_END]
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
  -- [FINANCE_START]
  select count(*)::integer into v_rev_seq
    from private.deleted_rows d
   where d."table" = 'sales' and d."rowId" = v_sale.id;
  -- [FINANCE_END]

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
  -- [FINANCE_START]
  -- 4. Reverse only what this sale actually credited on the finance ledger (skip pre-go-live sales).
  select id into v_cash_acc
    from public.finance_accounts
   where "ownerShopId" = p_shop_id and type = 'shopCash' and not "isArchived"
   limit 1;
  select id into v_online_acc
    from public.finance_accounts
   where "ownerShopId" = p_shop_id and type = 'primaryOnline' and not "isArchived"
   limit 1;

  if v_cash_acc is not null then
    select coalesce(sum(case when ft.direction = 'in' then ft.amount else -ft.amount end), 0)
      into v_net_cash
      from public.finance_transactions ft
     where ft."shopId" = p_shop_id
       and ft."accountId" = v_cash_acc
       and ft."referenceId" = v_sale.id
       and ft."referenceType" in ('sale', 'saleReversal');
    if v_net_cash > 0 then
      perform 1 from public.finance_accounts where id = v_cash_acc for update;
      insert into public.finance_transactions (
        id, "shopId", "ownerShopId", "accountId", type, direction, amount,
        description, "referenceId", "referenceType", "actorName", "actorRole",
        "createdBy", "occurredAt", "createdAt", "updatedAt"
      )
      values (
        'rev:' || v_sale.id || ':' || v_rev_seq || ':cash',
        p_shop_id, p_shop_id, v_cash_acc, 'saleReversal', 'out', v_net_cash,
        case when p_delete_sale is false then 'Sale edited (reversed) #' else 'Sale voided #' end || v_tag || ' (Cash)',
        v_sale.id, 'saleReversal', coalesce(v_actor_name, 'System'), coalesce(v_actor_role, 'admin'),
        v_uid::text, now(), now(), now()
      )
      on conflict (id) do nothing;
    end if;
  end if;

  if v_online_acc is not null then
    select coalesce(sum(case when ft.direction = 'in' then ft.amount else -ft.amount end), 0)
      into v_net_online
      from public.finance_transactions ft
     where ft."shopId" = p_shop_id
       and ft."accountId" = v_online_acc
       and ft."referenceId" = v_sale.id
       and ft."referenceType" in ('sale', 'saleReversal');
    if v_net_online > 0 then
      perform 1 from public.finance_accounts where id = v_online_acc for update;
      insert into public.finance_transactions (
        id, "shopId", "ownerShopId", "accountId", type, direction, amount,
        description, "referenceId", "referenceType", "actorName", "actorRole",
        "createdBy", "occurredAt", "createdAt", "updatedAt"
      )
      values (
        'rev:' || v_sale.id || ':' || v_rev_seq || ':online',
        p_shop_id, p_shop_id, v_online_acc, 'saleReversal', 'out', v_net_online,
        case when p_delete_sale is false then 'Sale edited (reversed) #' else 'Sale voided #' end || v_tag || ' (Online)',
        v_sale.id, 'saleReversal', coalesce(v_actor_name, 'System'), coalesce(v_actor_role, 'admin'),
        v_uid::text, now(), now(), now()
      )
      on conflict (id) do nothing;
    end if;
  end if;
  -- [FINANCE_END]

  return jsonb_build_object('status', 'applied', 'saleId', v_sale.id,
                            'linesRestored', v_restored, 'creditRestored', v_credit);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Finance RPCs (all writes go exclusively through SECURITY DEFINER RPCs)
-- ---------------------------------------------------------------------
create or replace function private.finance_check_write_account(p_shop uuid, p_account_id text)
returns public.finance_accounts
language plpgsql
stable
set search_path = ''
as $$
declare
  v_acc public.finance_accounts%rowtype;
begin
  select * into v_acc from public.finance_accounts where id = p_account_id;
  if not found or v_acc."isArchived" then
    raise exception 'Account not found or archived.' using errcode = '22023';
  end if;
  if v_acc."ownerShopId" = p_shop then
    if private.is_cashier() and v_acc.type <> 'shopCash' then
      raise exception 'Cashiers can only use Shop Cash.' using errcode = '42501';
    end if;
    return v_acc;
  end if;
  if v_acc.type = 'secondaryBank'
     and not private.is_cashier()
     and private.are_shops_directly_linked(p_shop, v_acc."ownerShopId") then
    return v_acc;
  end if;
  raise exception 'Unauthorized account access.' using errcode = '42501';
end;
$$;

create or replace function public.ensure_shop_finance_accounts(p_shop_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shop uuid := coalesce(p_shop_id, auth.uid());
begin
  if not private.is_shop_member(v_shop) then
    raise exception 'Unauthorized shop access.' using errcode = '42501';
  end if;
  perform private.ensure_shop_finance_accounts(v_shop);
  return jsonb_build_object('status', 'ok', 'shopId', v_shop);
end;
$$;

create or replace function public.create_finance_account(
  p_id text,
  p_shop_id uuid,
  p_name text,
  p_type text,
  p_bank_name text default null,
  p_account_number text default null,
  p_opening_balance numeric default 0,
  p_opening_tx_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_name       text := btrim(coalesce(p_name, ''));
  v_open       numeric := coalesce(p_opening_balance, 0);
  v_actor_name text;
  v_actor_role text;
begin
  if not private.legacy_is_shop_admin(p_shop_id) then
    raise exception 'Only the shop admin can create bank accounts.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' then
    raise exception 'Account id is required.' using errcode = '22023';
  end if;
  if p_type <> 'secondaryBank' then
    raise exception 'Only secondaryBank accounts can be created; edit the existing Primary Online account instead.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'Account name is required.' using errcode = '22023';
  end if;
  if v_open = 'NaN'::numeric or abs(v_open) = 'Infinity'::numeric
     or v_open < 0 or v_open <> trunc(v_open) or v_open >= 1000000000000 then
    raise exception 'Opening balance must be a whole number of rupees >= 0.' using errcode = '22023';
  end if;

  insert into public.finance_accounts (
    id, "shopId", "ownerShopId", name, type, "bankName", "accountNumber",
    balance, "isOverdrawn", "isArchived", "createdAt", "updatedAt"
  )
  values (
    p_id, p_shop_id, p_shop_id, v_name, 'secondaryBank',
    nullif(btrim(coalesce(p_bank_name, '')), ''),
    nullif(btrim(coalesce(p_account_number, '')), ''),
    0, false, false, now(), now()
  )
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'id', p_id);
  end if;

  if v_open > 0 then
    select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;
    insert into public.finance_transactions (
      id, "shopId", "ownerShopId", "accountId", type, direction, amount,
      description, "referenceId", "referenceType", "actorName", "actorRole",
      "createdBy", "occurredAt", "createdAt", "updatedAt"
    )
    values (
      coalesce(nullif(btrim(coalesce(p_opening_tx_id, '')), ''), p_id || ':opening'),
      p_shop_id, p_shop_id, p_id, 'opening', 'in', v_open,
      'Opening balance: ' || v_name, p_id, 'opening',
      coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
      v_uid::text, now(), now(), now()
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object('status', 'applied', 'id', p_id);
end;
$$;

create or replace function public.update_finance_account(
  p_id text,
  p_name text,
  p_bank_name text default null,
  p_account_number text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_acc  public.finance_accounts%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then
    raise exception 'Account name is required.' using errcode = '22023';
  end if;
  select * into v_acc from public.finance_accounts where id = p_id for update;
  if not found then
    raise exception 'Finance account not found.' using errcode = '22023';
  end if;
  if not private.legacy_is_shop_admin(v_acc."ownerShopId") then
    raise exception 'Only the owning shop admin can edit this account.' using errcode = '42501';
  end if;

  update public.finance_accounts
     set name            = v_name,
         "bankName"      = nullif(btrim(coalesce(p_bank_name, '')), ''),
         "accountNumber" = nullif(btrim(coalesce(p_account_number, '')), ''),
         "updatedAt"     = now()
   where id = p_id;

  return jsonb_build_object('status', 'applied', 'id', p_id);
end;
$$;

create or replace function public.archive_finance_account(p_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_acc public.finance_accounts%rowtype;
begin
  select * into v_acc from public.finance_accounts where id = p_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'id', p_id);
  end if;
  if not private.legacy_is_shop_admin(v_acc."ownerShopId") then
    raise exception 'Only the owning shop admin can archive this account.' using errcode = '42501';
  end if;
  if v_acc.type <> 'secondaryBank' then
    raise exception 'Shop Cash and Primary Online accounts cannot be archived.' using errcode = '22023';
  end if;
  if v_acc.balance <> 0 then
    raise exception 'Transfer or zero out the balance (Rs %) before archiving this account.', v_acc.balance using errcode = '22023';
  end if;

  update public.finance_accounts
     set "isArchived" = true,
         "archivedAt" = now(),
         "updatedAt"  = now()
   where id = p_id and not "isArchived";

  return jsonb_build_object('status', 'applied', 'id', p_id);
end;
$$;

create or replace function public.record_opening_balance(
  p_id text,
  p_shop_id uuid,
  p_account_id text,
  p_amount numeric,
  p_notes text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_acc        public.finance_accounts%rowtype;
  v_occurred   timestamptz := coalesce(p_occurred_at, now());
  v_actor_name text;
  v_actor_role text;
begin
  if not private.legacy_is_shop_admin(p_shop_id) then
    raise exception 'Only the shop admin can record opening balances.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or abs(p_amount) = 'Infinity'::numeric
     or p_amount <= 0 or p_amount <> trunc(p_amount) or p_amount >= 1000000000000 then
    raise exception 'Amount must be a whole number of rupees above 0.' using errcode = '22023';
  end if;
  if v_occurred > now() + interval '10 minutes' then
    v_occurred := now();
  end if;

  v_acc := private.finance_check_write_account(p_shop_id, p_account_id);
  perform 1 from public.finance_accounts where id = p_account_id for update;
  select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;

  insert into public.finance_transactions (
    id, "shopId", "ownerShopId", "accountId", type, direction, amount,
    description, notes, "referenceId", "referenceType",
    "actorName", "actorRole", "createdBy", "occurredAt", "createdAt", "updatedAt"
  )
  values (
    p_id, p_shop_id, v_acc."ownerShopId", p_account_id, 'opening', 'in', p_amount,
    'Opening balance: ' || v_acc.name,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_id, 'opening',
    coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
    v_uid::text, v_occurred, now(), now()
  )
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'id', p_id);
  end if;
  return jsonb_build_object('status', 'applied', 'id', p_id);
end;
$$;

create or replace function public.transfer_funds(
  p_transfer_id text,
  p_out_tx_id text,
  p_in_tx_id text,
  p_shop_id uuid,
  p_from_account_id text,
  p_to_account_id text,
  p_amount numeric,
  p_description text default null,
  p_notes text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_from       public.finance_accounts%rowtype;
  v_to         public.finance_accounts%rowtype;
  v_occurred   timestamptz := coalesce(p_occurred_at, now());
  v_actor_name text;
  v_actor_role text;
  v_desc       text;
begin
  if not private.legacy_is_shop_admin(p_shop_id) then
    raise exception 'Only the shop admin can transfer funds.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_transfer_id), '') = '' or coalesce(btrim(p_out_tx_id), '') = '' or coalesce(btrim(p_in_tx_id), '') = '' then
    raise exception 'Transfer ids are required.' using errcode = '22023';
  end if;
  if p_out_tx_id = p_in_tx_id then
    raise exception 'Transfer legs must have distinct ids.' using errcode = '22023';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'Source and destination accounts cannot be the same.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or abs(p_amount) = 'Infinity'::numeric
     or p_amount <= 0 or p_amount <> trunc(p_amount) or p_amount >= 1000000000000 then
    raise exception 'Amount must be a whole number of rupees above 0.' using errcode = '22023';
  end if;
  if v_occurred > now() + interval '10 minutes' then
    v_occurred := now();
  end if;

  if exists (select 1 from public.finance_transactions where "transferId" = p_transfer_id) then
    return jsonb_build_object('status', 'duplicate', 'transferId', p_transfer_id);
  end if;

  v_from := private.finance_check_write_account(p_shop_id, p_from_account_id);
  v_to   := private.finance_check_write_account(p_shop_id, p_to_account_id);

  perform 1 from public.finance_accounts
   where id in (p_from_account_id, p_to_account_id)
   order by id
   for update;

  select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;
  v_desc := coalesce(nullif(btrim(coalesce(p_description, '')), ''), v_from.name || ' -> ' || v_to.name);

  insert into public.finance_transactions (
    id, "shopId", "ownerShopId", "accountId", "counterpartyAccountId",
    type, direction, amount, "transferId", description, notes,
    "referenceId", "referenceType", "actorName", "actorRole",
    "createdBy", "occurredAt", "createdAt", "updatedAt"
  )
  values
    (
      p_out_tx_id, p_shop_id, v_from."ownerShopId", p_from_account_id, p_to_account_id,
      'transferOut', 'out', p_amount, p_transfer_id, v_desc,
      nullif(btrim(coalesce(p_notes, '')), ''),
      p_transfer_id, 'transfer', coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
      v_uid::text, v_occurred, now(), now()
    ),
    (
      p_in_tx_id, p_shop_id, v_to."ownerShopId", p_to_account_id, p_from_account_id,
      'transferIn', 'in', p_amount, p_transfer_id, v_desc,
      nullif(btrim(coalesce(p_notes, '')), ''),
      p_transfer_id, 'transfer', coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
      v_uid::text, v_occurred, now(), now()
    )
  on conflict (id) do nothing;

  return jsonb_build_object('status', 'applied', 'transferId', p_transfer_id);
end;
$$;

create or replace function public.record_payout(
  p_id text,
  p_shop_id uuid,
  p_account_id text,
  p_amount numeric,
  p_paid_to text,
  p_category text,
  p_description text default null,
  p_notes text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_acc        public.finance_accounts%rowtype;
  v_occurred   timestamptz := coalesce(p_occurred_at, now());
  v_actor_name text;
  v_actor_role text;
  v_paid_to    text := btrim(coalesce(p_paid_to, ''));
begin
  if not private.legacy_is_shop_admin(p_shop_id) then
    raise exception 'Only the shop admin can record payouts.' using errcode = '42501';
  end if;
  if p_category not in ('supplierPayment', 'ownerWithdrawal', 'staffAdvance', 'generalPayout') then
    raise exception 'Invalid payout category.' using errcode = '22023';
  end if;
  if v_paid_to = '' then
    raise exception 'Recipient (paidTo) is required.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or abs(p_amount) = 'Infinity'::numeric
     or p_amount <= 0 or p_amount <> trunc(p_amount) or p_amount >= 1000000000000 then
    raise exception 'Amount must be a whole number of rupees above 0.' using errcode = '22023';
  end if;
  if v_occurred > now() + interval '10 minutes' then
    v_occurred := now();
  end if;

  v_acc := private.finance_check_write_account(p_shop_id, p_account_id);
  perform 1 from public.finance_accounts where id = p_account_id for update;
  select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;

  insert into public.finance_transactions (
    id, "shopId", "ownerShopId", "accountId", type, direction, amount,
    category, "paidTo", description, notes, "referenceId", "referenceType",
    "actorName", "actorRole", "createdBy", "occurredAt", "createdAt", "updatedAt"
  )
  values (
    p_id, p_shop_id, v_acc."ownerShopId", p_account_id, 'payout', 'out', p_amount,
    p_category, v_paid_to,
    coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Payout to ' || v_paid_to),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_id, 'payout', coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
    v_uid::text, v_occurred, now(), now()
  )
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'id', p_id);
  end if;
  return jsonb_build_object('status', 'applied', 'id', p_id);
end;
$$;

create or replace function public.record_expense(
  p_expense_id text,
  p_tx_id text,
  p_shop_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_expense_date timestamptz,
  p_account_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_acc        public.finance_accounts%rowtype;
  v_actor_name text;
  v_actor_role text;
  v_exp_date   timestamptz := coalesce(p_expense_date, now());
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Unauthorized shop access.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or abs(p_amount) = 'Infinity'::numeric
     or p_amount <= 0 or p_amount <> trunc(p_amount) or p_amount >= 1000000000000 then
    raise exception 'Expense amount must be a whole number of rupees above 0.' using errcode = '22023';
  end if;
  if v_exp_date > now() + interval '10 minutes' then
    v_exp_date := now();
  end if;

  v_acc := private.finance_check_write_account(p_shop_id, p_account_id);
  perform 1 from public.finance_accounts where id = p_account_id for update;
  select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;

  insert into public.expenses (
    id, "shopId", category, description, amount, "expenseDate", "paidFromAccountId",
    "createdAtClient", "createdAt", "updatedAt", "actorName", "actorRole", "createdBy"
  )
  values (
    p_expense_id, p_shop_id, p_category, p_description, p_amount, v_exp_date, p_account_id,
    to_char(v_exp_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    now(), now(), coalesce(v_actor_name, 'System'), coalesce(v_actor_role, 'admin'), v_uid::text
  )
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'expenseId', p_expense_id);
  end if;

  insert into public.finance_transactions (
    id, "shopId", "ownerShopId", "accountId", type, direction, amount,
    category, description, "referenceId", "referenceType",
    "actorName", "actorRole", "createdBy", "occurredAt", "createdAt", "updatedAt"
  )
  values (
    p_tx_id, p_shop_id, v_acc."ownerShopId", p_account_id, 'expense', 'out', p_amount,
    p_category, coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Expense: ' || coalesce(p_category, 'General')),
    p_expense_id, 'expense', coalesce(v_actor_name, 'System'), coalesce(v_actor_role, 'admin'),
    v_uid::text, v_exp_date, now(), now()
  )
  on conflict (id) do nothing;

  return jsonb_build_object('status', 'applied', 'expenseId', p_expense_id);
end;
$$;

create or replace function public.update_expense(
  p_expense_id text,
  p_shop_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_expense_date timestamptz,
  p_account_id text default null,
  p_rev_tx_id text default null,
  p_new_tx_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_old        public.expenses%rowtype;
  v_acc_old    public.finance_accounts%rowtype;
  v_acc_new    public.finance_accounts%rowtype;
  v_actor_name text;
  v_actor_role text;
  v_exp_date   timestamptz := coalesce(p_expense_date, now());
  v_target_acc text;
begin
  if not private.legacy_is_shop_admin(p_shop_id) then
    raise exception 'Only the shop admin can edit expenses.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or abs(p_amount) = 'Infinity'::numeric
     or p_amount <= 0 or p_amount <> trunc(p_amount) or p_amount >= 1000000000000 then
    raise exception 'Expense amount must be a whole number of rupees above 0.' using errcode = '22023';
  end if;

  select * into v_old from public.expenses where id = p_expense_id and "shopId" = p_shop_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'expenseId', p_expense_id);
  end if;

  v_target_acc := coalesce(nullif(btrim(coalesce(p_account_id, '')), ''), v_old."paidFromAccountId");
  select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;

  update public.expenses
     set category            = p_category,
         description         = p_description,
         amount              = p_amount,
         "expenseDate"       = v_exp_date,
         "paidFromAccountId" = v_target_acc,
         "actorName"         = coalesce(v_actor_name, "actorName"),
         "actorRole"         = coalesce(v_actor_role, "actorRole"),
         "updatedAt"         = now()
   where id = p_expense_id and "shopId" = p_shop_id;

  if v_old."paidFromAccountId" is null and v_target_acc is null then
    return jsonb_build_object('status', 'applied', 'expenseId', p_expense_id);
  end if;

  if v_old."paidFromAccountId" is not null
     and (v_old.amount <> p_amount or v_old."paidFromAccountId" <> v_target_acc) then
    perform 1 from public.finance_accounts where id = v_old."paidFromAccountId" for update;
    select * into v_acc_old from public.finance_accounts where id = v_old."paidFromAccountId";
    insert into public.finance_transactions (
      id, "shopId", "ownerShopId", "accountId", type, direction, amount,
      category, description, "referenceId", "referenceType",
      "actorName", "actorRole", "createdBy", "occurredAt", "createdAt", "updatedAt"
    )
    values (
      coalesce(nullif(btrim(coalesce(p_rev_tx_id, '')), ''), gen_random_uuid()::text),
      p_shop_id, v_acc_old."ownerShopId", v_old."paidFromAccountId", 'expenseReversal', 'in', v_old.amount,
      v_old.category, 'Expense edited (reversed): ' || coalesce(v_old.description, v_old.category, ''),
      p_expense_id, 'expenseReversal', coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
      v_uid::text, now(), now(), now()
    )
    on conflict (id) do nothing;
  end if;

  if v_target_acc is not null
     and (v_old."paidFromAccountId" is null or v_old.amount <> p_amount or v_old."paidFromAccountId" <> v_target_acc) then
    v_acc_new := private.finance_check_write_account(p_shop_id, v_target_acc);
    perform 1 from public.finance_accounts where id = v_target_acc for update;
    insert into public.finance_transactions (
      id, "shopId", "ownerShopId", "accountId", type, direction, amount,
      category, description, "referenceId", "referenceType",
      "actorName", "actorRole", "createdBy", "occurredAt", "createdAt", "updatedAt"
    )
    values (
      coalesce(nullif(btrim(coalesce(p_new_tx_id, '')), ''), gen_random_uuid()::text),
      p_shop_id, v_acc_new."ownerShopId", v_target_acc, 'expense', 'out', p_amount,
      p_category, coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Expense: ' || coalesce(p_category, 'General')),
      p_expense_id, 'expense', coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
      v_uid::text, v_exp_date, now(), now()
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object('status', 'applied', 'expenseId', p_expense_id);
end;
$$;

create or replace function public.delete_expense(
  p_expense_id text,
  p_shop_id uuid,
  p_rev_tx_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_old        public.expenses%rowtype;
  v_acc        public.finance_accounts%rowtype;
  v_actor_name text;
  v_actor_role text;
begin
  if not private.legacy_is_shop_admin(p_shop_id) then
    raise exception 'Only the shop admin can delete expenses.' using errcode = '42501';
  end if;

  delete from public.expenses
   where id = p_expense_id and "shopId" = p_shop_id
  returning * into v_old;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'expenseId', p_expense_id);
  end if;

  -- Note: expenses_api_delete_guard (api_delete_guard) checks current_user <> 'authenticated'
  -- and returns early inside SECURITY DEFINER calls, so we archive the deleted row directly.
  insert into private.deleted_rows ("table", "rowId", "shopId", "row", "deletedBy", "clientBuild", reason)
  values ('expenses', v_old.id, p_shop_id, to_jsonb(v_old), v_uid, private.client_build(), 'expense delete');

  if v_old."paidFromAccountId" is not null then
    select * into v_acc from public.finance_accounts where id = v_old."paidFromAccountId" for update;
    select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;
    insert into public.finance_transactions (
      id, "shopId", "ownerShopId", "accountId", type, direction, amount,
      category, description, "referenceId", "referenceType",
      "actorName", "actorRole", "createdBy", "occurredAt", "createdAt", "updatedAt"
    )
    values (
      coalesce(nullif(btrim(coalesce(p_rev_tx_id, '')), ''), 'rev:exp:' || v_old.id),
      p_shop_id, v_acc."ownerShopId", v_old."paidFromAccountId", 'expenseReversal', 'in', v_old.amount,
      v_old.category, 'Expense deleted (reversed): ' || coalesce(v_old.description, v_old.category, ''),
      v_old.id, 'expenseReversal', coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
      v_uid::text, now(), now(), now()
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object('status', 'applied', 'expenseId', p_expense_id);
end;
$$;

create or replace function public.record_credit_payment(
  p_credit_id text,
  p_tx_id text,
  p_shop_id uuid,
  p_customer_id text,
  p_amount numeric,
  p_payment_method text default 'cash',
  p_description text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_pm         text := lower(btrim(coalesce(p_payment_method, 'cash')));
  v_acc_type   text := case when v_pm = 'online' then 'primaryOnline' else 'shopCash' end;
  v_acc_id     text;
  v_actor_name text;
  v_actor_role text;
  v_cust_name  text;
  v_cust_phone text;
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Unauthorized shop access.' using errcode = '42501';
  end if;
  if v_pm not in ('cash', 'online') then
    raise exception 'Payment method must be cash or online.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or abs(p_amount) = 'Infinity'::numeric
     or p_amount <= 0 or p_amount <> trunc(p_amount) or p_amount >= 1000000000000 then
    raise exception 'Credit payment amount must be a whole number of rupees above 0.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_customer_id), '') = '' then
    raise exception 'Customer is required.' using errcode = '22023';
  end if;

  select name, phone into v_cust_name, v_cust_phone
    from public.customers
   where id = p_customer_id and "shopId" = p_shop_id and "deletedAt" is null
   for update;
  if not found then
    raise exception 'Customer not found.' using errcode = '22023';
  end if;

  perform private.ensure_shop_finance_accounts(p_shop_id);
  select id into v_acc_id
    from public.finance_accounts
   where "ownerShopId" = p_shop_id and type = v_acc_type and not "isArchived"
   limit 1;

  select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;

  insert into public.credits (
    id, "shopId", "creditType", "customerId", "entityName", "entityContact",
    amount, description, "transactionType", "paymentMethod", "accountId",
    "actorName", "actorRole", "createdBy", "createdAt"
  )
  values (
    p_credit_id, p_shop_id, 'customer', p_customer_id, v_cust_name, v_cust_phone,
    p_amount, coalesce(p_description, ''),
    'taken', v_pm, v_acc_id,
    coalesce(v_actor_name, 'System'), coalesce(v_actor_role, 'admin'), v_uid::text, now()
  )
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate', 'creditId', p_credit_id);
  end if;

  update public.customers
     set "creditBalance" = round((coalesce("creditBalance", 0) - p_amount) * 100) / 100,
         "updatedAt"     = now()
   where id = p_customer_id and "shopId" = p_shop_id;

  if v_acc_id is not null then
    perform 1 from public.finance_accounts where id = v_acc_id for update;
    insert into public.finance_transactions (
      id, "shopId", "ownerShopId", "accountId", type, direction, amount,
      description, "referenceId", "referenceType", "actorName", "actorRole",
      "createdBy", "occurredAt", "createdAt", "updatedAt"
    )
    values (
      coalesce(nullif(btrim(coalesce(p_tx_id, '')), ''), 'cred:' || p_credit_id),
      p_shop_id, p_shop_id, v_acc_id, 'creditPayment', 'in', p_amount,
      'Udhaar payment: ' || coalesce(v_cust_name, 'Customer') || ' (' || initcap(v_pm) || ')',
      p_credit_id, 'credit', coalesce(v_actor_name, 'System'), coalesce(v_actor_role, 'admin'),
      v_uid::text, now(), now(), now()
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object('status', 'applied', 'creditId', p_credit_id, 'accountId', v_acc_id);
end;
$$;

create or replace function public.reverse_finance_transaction(
  p_id text,
  p_shop_id uuid,
  p_original_tx_id text,
  p_reason text,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
  v_orig       public.finance_transactions%rowtype;
  v_acc        public.finance_accounts%rowtype;
  v_dir        text;
  v_occurred   timestamptz := coalesce(p_occurred_at, now());
  v_actor_name text;
  v_actor_role text;
begin
  if not private.legacy_is_shop_admin(p_shop_id) then
    raise exception 'Only the shop admin can reverse finance transactions.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' then
    raise exception 'Adjustment transaction id is required.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_original_tx_id), '') = '' then
    raise exception 'Original transaction id is required.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to reverse a transaction.' using errcode = '22023';
  end if;
  if v_occurred > now() + interval '10 minutes' then
    v_occurred := now();
  end if;

  if exists (select 1 from public.finance_transactions where id = p_id) then
    return jsonb_build_object('status', 'duplicate', 'id', p_id);
  end if;

  select * into v_orig from public.finance_transactions where id = p_original_tx_id;
  if not found then
    raise exception 'Original transaction not found.' using errcode = '22023';
  end if;

  v_acc := private.finance_check_write_account(p_shop_id, v_orig."accountId");
  perform 1 from public.finance_accounts where id = v_acc.id for update;

  if v_orig.type in ('adjustment', 'saleReversal', 'expenseReversal') then
    raise exception 'Transaction type % cannot be reversed.', v_orig.type using errcode = '22023';
  end if;
  if exists (
    select 1 from public.finance_transactions
     where "referenceType" = 'adjustment' and "referenceId" = p_original_tx_id
  ) then
    raise exception 'This transaction has already been reversed.' using errcode = '22023';
  end if;

  v_dir := case when v_orig.direction = 'in' then 'out' else 'in' end;
  select p.username, p.role into v_actor_name, v_actor_role from public.profiles p where p.id = v_uid;

  insert into public.finance_transactions (
    id, "shopId", "ownerShopId", "accountId", type, direction, amount,
    description, notes, "referenceId", "referenceType",
    "actorName", "actorRole", "createdBy", "occurredAt", "createdAt", "updatedAt"
  )
  values (
    p_id, p_shop_id, v_acc."ownerShopId", v_acc.id, 'adjustment', v_dir, v_orig.amount,
    'Adjustment (reversal of ' || v_orig.type || '): ' || coalesce(v_orig.description, v_orig.id),
    v_reason, p_original_tx_id, 'adjustment',
    coalesce(v_actor_name, 'Admin'), coalesce(v_actor_role, 'admin'),
    v_uid::text, v_occurred, now(), now()
  );

  return jsonb_build_object('status', 'applied', 'id', p_id);
end;
$$;

create or replace function public.get_linked_shops_finance_summary()
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
    raise exception 'Only the shop admin can view linked shop balances.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shopId', o.other_shop,
      'shopName', private.transfer_shop_name(o.other_shop),
      'shopCashBalance', coalesce((
        select a.balance from public.finance_accounts a
         where a."ownerShopId" = o.other_shop and a.type = 'shopCash' and not a."isArchived" limit 1
      ), 0),
      'shopCashOverdrawn', coalesce((
        select a."isOverdrawn" from public.finance_accounts a
         where a."ownerShopId" = o.other_shop and a.type = 'shopCash' and not a."isArchived" limit 1
      ), false),
      'primaryOnlineBalance', coalesce((
        select a.balance from public.finance_accounts a
         where a."ownerShopId" = o.other_shop and a.type = 'primaryOnline' and not a."isArchived" limit 1
      ), 0),
      'primaryOnlineName', coalesce((
        select a.name from public.finance_accounts a
         where a."ownerShopId" = o.other_shop and a.type = 'primaryOnline' and not a."isArchived" limit 1
      ), 'Primary Online'),
      'primaryOnlineOverdrawn', coalesce((
        select a."isOverdrawn" from public.finance_accounts a
         where a."ownerShopId" = o.other_shop and a.type = 'primaryOnline' and not a."isArchived" limit 1
      ), false)
    ) order by lower(private.transfer_shop_name(o.other_shop)), o.other_shop)
    from (
      select case when l."shopA" = v_shop then l."shopB" else l."shopA" end as other_shop
        from public.shop_links l
       where l."shopA" = v_shop or l."shopB" = v_shop
    ) o
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Function privileges (fixed search_path, none callable by public/anon)
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

revoke all on function private.is_cashier() from public, anon;
grant execute on function private.is_cashier() to authenticated;
revoke all on function private.are_shops_directly_linked(uuid, uuid) from public, anon;
grant execute on function private.are_shops_directly_linked(uuid, uuid) to authenticated;
revoke all on function private.ensure_shop_finance_accounts(uuid) from public, anon, authenticated;
revoke all on function private.finance_check_write_account(uuid, text) from public, anon, authenticated;
revoke all on function private.finance_tx_before_insert() from public, anon, authenticated;
revoke all on function private.finance_tx_after_insert() from public, anon, authenticated;
revoke all on function private.profiles_provision_finance_accounts() from public, anon, authenticated;

grant execute on function public.ensure_shop_finance_accounts(uuid) to authenticated;
grant execute on function public.create_finance_account(text, uuid, text, text, text, text, numeric, text) to authenticated;
grant execute on function public.update_finance_account(text, text, text, text) to authenticated;
grant execute on function public.archive_finance_account(text) to authenticated;
grant execute on function public.record_opening_balance(text, uuid, text, numeric, text, timestamptz) to authenticated;
grant execute on function public.transfer_funds(text, text, text, uuid, text, text, numeric, text, text, timestamptz) to authenticated;
grant execute on function public.record_payout(text, uuid, text, numeric, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.record_expense(text, text, uuid, text, text, numeric, timestamptz, text) to authenticated;
grant execute on function public.update_expense(text, uuid, text, text, numeric, timestamptz, text, text, text) to authenticated;
grant execute on function public.delete_expense(text, uuid, text) to authenticated;
grant execute on function public.record_credit_payment(text, text, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.reverse_finance_transaction(text, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.get_linked_shops_finance_summary() to authenticated;
grant execute on function public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric) to authenticated;
grant execute on function public.process_reversal(uuid, text, boolean, jsonb, jsonb, jsonb, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Self-validation checks + migration ledger
-- ---------------------------------------------------------------------
create or replace function private.cash_and_bank_checks()
returns table (check_name text, ok boolean, detail text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_missing text;
begin
  ok := exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'finance_accounts' and column_name = 'ownerShopId')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'transferId')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'occurredAt')
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'balanceAfter')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'expenses' and column_name = 'paidFromAccountId')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'credits' and column_name = 'paymentMethod');
  check_name := 'schema_columns_match_plan';
  detail := 'finance_accounts, finance_transactions (no balanceAfter), expenses, credits columns match plan';
  return next;

  ok := has_table_privilege('authenticated', 'public.finance_accounts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.finance_accounts', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and has_table_privilege('authenticated', 'public.finance_transactions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.finance_transactions', 'INSERT,UPDATE,DELETE,TRUNCATE');
  check_name := 'finance_tables_select_only';
  detail := 'authenticated has SELECT only on finance_accounts and finance_transactions';
  return next;

  ok := not exists (
    select 1 from (select distinct "shopId" as sid from public.profiles where "shopId" is not null) s
     where not exists (select 1 from public.finance_accounts a where a."ownerShopId" = s.sid and a.type = 'shopCash' and not a."isArchived")
        or not exists (select 1 from public.finance_accounts a where a."ownerShopId" = s.sid and a.type = 'primaryOnline' and not a."isArchived")
  );
  check_name := 'every_shop_has_cash_and_primary';
  detail := 'every existing shop has one shopCash and one primaryOnline account';
  return next;

  select string_agg(sig, ', ') into v_missing
    from unnest(array[
      'public.ensure_shop_finance_accounts(uuid)',
      'public.create_finance_account(text,uuid,text,text,text,text,numeric,text)',
      'public.update_finance_account(text,text,text,text)',
      'public.archive_finance_account(text)',
      'public.record_opening_balance(text,uuid,text,numeric,text,timestamptz)',
      'public.transfer_funds(text,text,text,uuid,text,text,numeric,text,text,timestamptz)',
      'public.record_payout(text,uuid,text,numeric,text,text,text,text,timestamptz)',
      'public.record_expense(text,text,uuid,text,text,numeric,timestamptz,text)',
      'public.update_expense(text,uuid,text,text,numeric,timestamptz,text,text,text)',
      'public.delete_expense(text,uuid,text)',
      'public.record_credit_payment(text,text,uuid,text,numeric,text,text)',
      'public.reverse_finance_transaction(text,uuid,text,text,timestamptz)',
      'public.get_linked_shops_finance_summary()'
    ]) as sig
   where to_regprocedure(sig) is null
      or not has_function_privilege('authenticated', to_regprocedure(sig), 'EXECUTE')
      or has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE');
  ok := v_missing is null;
  check_name := 'finance_rpcs_present_and_scoped';
  detail := coalesce('missing/misconfigured: ' || v_missing, 'all 13 finance RPCs present and restricted to authenticated');
  return next;

  ok := exists (select 1 from private.function_snapshots where label = 'pre_20261127100000' and signature like 'public.process_checkout%')
    and exists (select 1 from private.function_snapshots where label = 'pre_20261127100000' and signature like 'public.process_reversal%');
  check_name := 'pre_migration_snapshots_saved';
  detail := 'pre_20261127100000 snapshots stored';
  return next;
end;
$$;

revoke all on function private.cash_and_bank_checks() from public, anon, authenticated;

select private.mark_migration('20261127100000', '20261127100000_cash_and_bank_management.sql',
  'Cash & Bank Account Management ledger, RLS, and RPCs.');

notify pgrst, 'reload schema';

do $$
declare
  v_failed text;
begin
  select string_agg(c.check_name || ' (' || c.detail || ')', '; ') into v_failed
    from private.cash_and_bank_checks() c where c.ok is not true;
  if v_failed is not null then
    raise exception 'VALIDATION FAILED, nothing was changed: %', v_failed;
  end if;
end $$;

commit;

-- Read-only validation output
select x.check_name as "check", x.ok, x.detail
  from (
    select 0 as pos, 'all_checks_passed' as check_name, bool_and(c.ok) as ok,
           count(*) || ' checks' as detail
      from private.cash_and_bank_checks() c
    union all
    select 1, c.check_name, c.ok, c.detail from private.cash_and_bank_checks() c
  ) x
 order by x.pos, x.check_name;

-- =====================================================================
-- ROLLBACK REFERENCE (run manually inside a transaction if rolling back)
-- =====================================================================
-- begin;
-- select private.restore_functions('pre_20261127100000');
-- select private.restore_policies('pre_20261127100000', 'public', 'finance_accounts');
-- select private.restore_policies('pre_20261127100000', 'public', 'finance_transactions');
-- revoke all on table public.finance_accounts, public.finance_transactions from authenticated;
-- grant select, insert, update, delete on table public.finance_accounts, public.finance_transactions to authenticated;
-- drop trigger if exists profiles_provision_finance_accounts on public.profiles;
-- drop trigger if exists finance_transactions_before_insert on public.finance_transactions;
-- drop trigger if exists finance_transactions_after_insert on public.finance_transactions;
-- drop trigger if exists finance_transactions_append_only on public.finance_transactions;
-- drop trigger if exists finance_transactions_no_truncate on public.finance_transactions;
-- drop function if exists public.ensure_shop_finance_accounts(uuid);
-- drop function if exists public.create_finance_account(text, uuid, text, text, text, text, numeric, text);
-- drop function if exists public.update_finance_account(text, text, text, text);
-- drop function if exists public.archive_finance_account(text);
-- drop function if exists public.record_opening_balance(text, uuid, text, numeric, text, timestamptz);
-- drop function if exists public.transfer_funds(text, text, text, uuid, text, text, numeric, text, text, timestamptz);
-- drop function if exists public.record_payout(text, uuid, text, numeric, text, text, text, text, timestamptz);
-- drop function if exists public.record_expense(text, text, uuid, text, text, numeric, timestamptz, text);
-- drop function if exists public.update_expense(text, uuid, text, text, numeric, timestamptz, text, text, text);
-- drop function if exists public.delete_expense(text, uuid, text);
-- drop function if exists public.record_credit_payment(text, text, uuid, text, numeric, text, text);
-- drop function if exists public.reverse_finance_transaction(text, uuid, text, text, timestamptz);
-- drop function if exists public.get_linked_shops_finance_summary();
-- drop function if exists private.is_cashier();
-- drop function if exists private.are_shops_directly_linked(uuid, uuid);
-- drop function if exists private.ensure_shop_finance_accounts(uuid);
-- drop function if exists private.finance_check_write_account(uuid, text);
-- drop function if exists private.finance_tx_before_insert();
-- drop function if exists private.finance_tx_after_insert();
-- drop function if exists private.profiles_provision_finance_accounts();
-- delete from private.schema_migrations where version = '20261127100000';
-- notify pgrst, 'reload schema';
-- commit;
