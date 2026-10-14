-- =====================================================================
-- 20261012200000_shop_links_and_transfers.sql
-- Shop-to-shop stock transfers (first version, for today's one-admin-per-
-- shop model; plan phase 2 later maps these tables onto organisations).
--
-- What it adds:
--   1. Linked shops. A shop admin creates a one-time link code (10
--      characters, valid 30 minutes, one active code per shop, only its hash
--      is stored). The admin of the OTHER shop enters it, and the two shops
--      are linked. Wrong codes are counted: at most 10 per hour per user.
--      Either admin can unlink.
--   2. Stock transfers between linked shops, in ONE server transaction:
--        - only the admin of the sending shop, only to a linked shop;
--        - whole quantities (1 to 10000); e-liquid moves as SEALED BOTTLES
--          (quantity = bottles, ml = bottles x bottle size);
--        - refused, with nothing changed, when the sending shop does not
--          have enough stock: stock can never go below zero. A stock figure
--          that is not a number (NaN, Infinity) is refused too;
--        - the receiving shop's product is found (an earlier transfer's
--          link, if it is still counted the same way, else exactly one
--          product with the same name and category and, for e-liquid, the
--          same bottle size) or created with the sender's prices. An
--          existing product's prices are NEVER changed; its cost becomes
--          the weighted average;
--        - the newest full sealed bottles move with the stock; missing ones
--          are created at the receiving shop;
--        - a 'transfer_out' and a 'transfer_in' inventory log in each shop;
--        - safe to retry: the same transfer id (clientMutationId) is applied
--          once, a retry answers 'duplicate'. A refusal made after that
--          check carries the hint 'transfer_not_applied';
--        - products are locked in id order in each shop (the order a sale
--          uses), and the link is checked under the shop locks.
--   3. Read-only history for both shops (stock_transfers and their lines).
--      Nobody can write these tables directly: only the functions above.
--
-- Works whether or not 20261012100000_lockdown_followup.sql was applied
-- before it (it uses none of that file's helpers; archived products and
-- bottles are skipped when those columns exist). It adds
-- inventory_logs."refId" if it is missing. When the migration ledger
-- (private.schema_migrations, from 20261012100000) exists, it records
-- itself there.
--
-- Safe to run more than once. One transaction: all or nothing. A check at
-- the end rolls everything back if anything is not in place.
--
-- BEFORE RUNNING:
--   1. Run it right after 20261012100000 has been validated, before the
--      app push. Either order works: before this file the Shop Transfers
--      page only says it is not set up.
--   2. If 20261012100000_lockdown_followup.sql is going to be applied,
--      apply it first.
-- How to run: SQL Editor -> New query -> paste this whole file -> Run.
-- Paste back the result table (check / ok / detail). Every ok must be true.
-- Then run supabase/diagnostics/verify_20261012200000.sql.
-- =====================================================================

begin;

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

commit;

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
