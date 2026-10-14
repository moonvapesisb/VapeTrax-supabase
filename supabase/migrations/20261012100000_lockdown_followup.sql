-- =====================================================================
-- 20261012100000_lockdown_followup.sql
-- PHASE 0 (plan step 0.3): follow-up on the applied lockdown.
--
-- What it does (the deployed app keeps working unchanged):
--   0. A migration ledger and private helpers (snapshots, telemetry, safe
--      date and number parsing, one source of shop membership).
--   1. Re-asserts: Row Level Security on every table, nothing for anonymous
--      visitors, no function callable by them.
--   2. profiles: an admin can link a cashier only to a login created in the
--      last hour that has no profile yet (nobody can claim an existing
--      account); role and shop can never be changed from the app.
--   3. settings: every member of the shop can read them (cashier invoices
--      get the shop name); only the shop admin can save them.
--   4. products, bottles, customers, sales, expenses: shop-scoped rules for
--      logged-in users only (a cashier's shop is only the one their profile
--      points at). credits and inventory_logs become append-only
--      (read and add; never change or remove).
--   5. personal_expenses: the shop admin only.
--   6. Unused tables (finance_accounts, finance_transactions,
--      daily_summaries, stock_alerts, users, suppliers, purchases): no
--      rules at all, so nobody can use them. inventory_alerts (the Stock
--      page's shortfall alerts) is NOT touched.
--   7. Text ids get a default, so the Stock page's bottle inserts and the
--      product-delete log work. Archive columns are added, and
--      inventory_logs gets "refId".
--   8. Deleting a product, customer or bottle from the app ARCHIVES it
--      (hidden, kept for old sales). Other deletes from the app keep a copy.
--      One request can delete at most 25 rows.
--   9. process_checkout and process_reversal now answer
--      {status: 'applied' | 'duplicate', saleId}. Checkout keeps every owner
--      rule (never below zero, shortfall kept and alerted, 0.5 ml refills,
--      whole quantities, NaN and absurd amounts refused), locks products in
--      id order, derives udhaar from the payment itself and stamps its logs.
--      Reversal is for the shop admin, always deletes the stored sale (a
--      copy is kept), and restores stock, bottles and udhaar from the
--      STORED sale; what a short sale never took off is not put back.
--      process_stock_adjustment is retired (nothing uses it).
--  10. Records itself in the ledger, then validates everything, including
--      a check AS each real user. Any failure rolls the whole file back.
--
-- Requires 20261011120000 and 20261011140000 (both applied on 2026-10-11).
-- Safe to run more than once. One transaction: all or nothing.
--
-- BEFORE RUNNING:
--   1. Every POS device online, its sync badge showing 0 waiting.
--   2. Run supabase/ops/snapshot_public.sql and keep its result.
--   3. Run it during closed hours.
-- How to run: SQL Editor -> New query -> paste this whole file -> Run.
-- Paste back the result table (check / ok / detail). Every ok must be true.
-- =====================================================================

begin;

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

commit;

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
