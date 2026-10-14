-- =====================================================================
-- supabase/tests/00_lockdown_smoke.sql
-- Smoke test for 20261012100000_lockdown_followup.sql: who can see and
-- change what. Run it AFTER the migration.
--
-- It creates two throwaway shops and logins (example.invalid emails), acts
-- as each of them the way the app does, checks the rules, and then ROLLS
-- EVERYTHING BACK: it leaves nothing behind and never touches the real
-- shop's rows.
--
-- How to run: SQL Editor -> New query -> paste this whole file -> Run.
-- Success: the result shows "ALL TESTS PASSED" (the file's last line,
-- after the rollback). Any failed check stops with an error that starts
-- with "SMOKE FAIL"; copy it back. Nothing is changed either way.
-- =====================================================================
begin;

-- Helpers (temporary: they vanish with the rollback).
create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create function pg_temp.act_as_owner() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

create function pg_temp.check(p_name text, p_ok boolean) returns void language plpgsql as $f$
begin
  if p_ok is not true then
    raise exception 'SMOKE FAIL: %', p_name;
  end if;
end $f$;

-- Throwaway logins: owner A, owner B, cashier C (shop A), a login made a
-- minute ago (F) and one from last month (D). Shops are their owners' ids.
insert into auth.users (id, email, created_at) values
  ('5a0e5a0e-0000-4000-8000-00000000000a', 'smoke-owner-a@example.invalid', now() - interval '2 days'),
  ('5a0e5a0e-0000-4000-8000-00000000000b', 'smoke-owner-b@example.invalid', now() - interval '2 days'),
  ('5a0e5a0e-0000-4000-8000-00000000000c', 'smoke-cashier@example.invalid', now() - interval '2 days'),
  ('5a0e5a0e-0000-4000-8000-00000000000f', 'smoke-fresh@example.invalid',   now() - interval '1 minute'),
  ('5a0e5a0e-0000-4000-8000-00000000000d', 'smoke-old@example.invalid',     now() - interval '30 days');

insert into public.profiles (id, username, role, "shopId") values
  ('5a0e5a0e-0000-4000-8000-00000000000a', 'Smoke Owner A', 'admin',   '5a0e5a0e-0000-4000-8000-00000000000a'),
  ('5a0e5a0e-0000-4000-8000-00000000000b', 'Smoke Owner B', 'admin',   '5a0e5a0e-0000-4000-8000-00000000000b'),
  ('5a0e5a0e-0000-4000-8000-00000000000c', 'Smoke Cashier', 'cashier', '5a0e5a0e-0000-4000-8000-00000000000a');

insert into public.settings ("shopId", "shopName") values ('5a0e5a0e-0000-4000-8000-00000000000a', 'Smoke Shop A');
insert into public.products (id, "shopId", name, category, "stockQuantity")
  select 'smokeA-p' || g, '5a0e5a0e-0000-4000-8000-00000000000a', 'Smoke product ' || g, 'device', 5
    from generate_series(1, 31) g;
insert into public.products (id, "shopId", name, category, "stockQuantity") values
  ('smokeB-p1', '5a0e5a0e-0000-4000-8000-00000000000b', 'Smoke B product', 'device', 5);
insert into public.customers (id, "shopId", name) values ('smokeA-c1', '5a0e5a0e-0000-4000-8000-00000000000a', 'Smoke customer');
insert into public.sales (id, "shopId", "totalAmount") values ('smokeA-s1', '5a0e5a0e-0000-4000-8000-00000000000a', 100);
insert into public.expenses (id, "shopId", amount) values ('smokeA-e1', '5a0e5a0e-0000-4000-8000-00000000000a', 50);
insert into public.personal_expenses (id, "shopId", amount) values ('smokeA-pe1', '5a0e5a0e-0000-4000-8000-00000000000a', 20);
insert into public.credits (id, "shopId", amount) values ('smokeA-cr1', '5a0e5a0e-0000-4000-8000-00000000000a', 10);
insert into public.inventory_logs (id, "shopId", reason) values ('smokeA-l1', '5a0e5a0e-0000-4000-8000-00000000000a', 'smoke');
insert into public.inventory_alerts (shop_id, product_id, product_name, message)
  values ('5a0e5a0e-0000-4000-8000-00000000000a', 'smokeA-p1', 'Smoke product 1', 'Smoke shortfall');

-- 1. Shop B sees nothing of shop A, and cannot write into it.
do $$
declare
  n bigint;
begin
  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000b');
  select (select count(*) from public.products where id like 'smokeA-%')
       + (select count(*) from public.customers where id like 'smokeA-%')
       + (select count(*) from public.sales where id like 'smokeA-%')
       + (select count(*) from public.expenses where id like 'smokeA-%')
       + (select count(*) from public.personal_expenses where id like 'smokeA-%')
       + (select count(*) from public.credits where id like 'smokeA-%')
       + (select count(*) from public.inventory_logs where id like 'smokeA-%')
       + (select count(*) from public.settings where "shopId" = '5a0e5a0e-0000-4000-8000-00000000000a')
       + (select count(*) from public.inventory_alerts where shop_id = '5a0e5a0e-0000-4000-8000-00000000000a')
    into n;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('another shop sees none of this shop''s rows', n = 0);

  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000b');
    insert into public.products (id, "shopId", name) values ('smokeB-into-A', '5a0e5a0e-0000-4000-8000-00000000000a', 'x');
    perform pg_temp.act_as_owner();
    perform pg_temp.check('another shop cannot add a product to this shop', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('another shop cannot add a product to this shop', true);
end $$;

-- 2. Nobody changes their own role or shop.
do $$
begin
  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000c');
    update public.profiles set role = 'admin' where id = '5a0e5a0e-0000-4000-8000-00000000000c';
    perform pg_temp.act_as_owner();
    perform pg_temp.check('a cashier cannot make herself admin', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('a cashier cannot make herself admin',
    (select role from public.profiles where id = '5a0e5a0e-0000-4000-8000-00000000000c') = 'cashier');

  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000c');
    update public.profiles set "shopId" = '5a0e5a0e-0000-4000-8000-00000000000b' where id = '5a0e5a0e-0000-4000-8000-00000000000c';
    perform pg_temp.act_as_owner();
    perform pg_temp.check('a cashier cannot move to another shop', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('a cashier cannot move to another shop', true);
end $$;

-- 3. Adding a cashier: only a login made moments ago, never an old account.
do $$
begin
  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
  insert into public.profiles (id, username, role, "shopId")
  values ('5a0e5a0e-0000-4000-8000-00000000000f', 'Smoke New Cashier', 'cashier', '5a0e5a0e-0000-4000-8000-00000000000a');
  perform pg_temp.act_as_owner();
  perform pg_temp.check('the admin links a just-created login as cashier',
    exists (select 1 from public.profiles where id = '5a0e5a0e-0000-4000-8000-00000000000f'));

  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
    insert into public.profiles (id, username, role, "shopId")
    values ('5a0e5a0e-0000-4000-8000-00000000000d', 'x', 'cashier', '5a0e5a0e-0000-4000-8000-00000000000a');
    perform pg_temp.act_as_owner();
    perform pg_temp.check('the admin cannot claim an existing account', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('the admin cannot claim an existing account',
    not exists (select 1 from public.profiles where id = '5a0e5a0e-0000-4000-8000-00000000000d'));
end $$;

-- 4. settings and personal_expenses.
do $$
declare
  n_settings bigint;
  n_admin    bigint;
  n_cashier  bigint;
begin
  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000c');
  select count(*) into n_settings from public.settings where "shopId" = '5a0e5a0e-0000-4000-8000-00000000000a';
  select count(*) into n_cashier from public.personal_expenses where id like 'smokeA-%';
  perform pg_temp.act_as_owner();
  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
  select count(*) into n_admin from public.personal_expenses where id like 'smokeA-%';
  update public.settings set "shopName" = 'Smoke Shop A2' where "shopId" = '5a0e5a0e-0000-4000-8000-00000000000a';
  perform pg_temp.act_as_owner();
  perform pg_temp.check('a cashier reads the shop settings', n_settings = 1);
  perform pg_temp.check('the admin saves the shop settings',
    (select "shopName" from public.settings where "shopId" = '5a0e5a0e-0000-4000-8000-00000000000a') = 'Smoke Shop A2');
  perform pg_temp.check('personal expenses: the admin sees them', n_admin = 1);
  perform pg_temp.check('personal expenses: the cashier does not', n_cashier = 0);

  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000c');
  update public.settings set "shopName" = 'hacked' where "shopId" = '5a0e5a0e-0000-4000-8000-00000000000a';
  perform pg_temp.act_as_owner();
  perform pg_temp.check('a cashier cannot change the shop settings',
    (select "shopName" from public.settings where "shopId" = '5a0e5a0e-0000-4000-8000-00000000000a') = 'Smoke Shop A2');
end $$;

-- 5. Deleting from the app: products are archived; more than 25 at once is blocked.
do $$
begin
  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
  delete from public.products where id = 'smokeA-p1';
  perform pg_temp.act_as_owner();
  perform pg_temp.check('deleting a product from the app archives it (row kept, deletedAt set)',
    (select "deletedAt" is not null from public.products where id = 'smokeA-p1'));

  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
    delete from public.products where id like 'smokeA-p%' and id <> 'smokeA-p1';
    perform pg_temp.act_as_owner();
    perform pg_temp.check('a 30-row delete in one request is blocked', false);
  exception when sqlstate 'PT422' then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('a 30-row delete in one request is blocked, nothing archived',
    (select count(*) from public.products where id like 'smokeA-p%' and "deletedAt" is null) = 30);

  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
  perform pg_temp.check('the archived product is hidden from the app',
    not exists (select 1 from public.products where id = 'smokeA-p1'));
  perform pg_temp.act_as_owner();
end $$;

-- 6. credits and inventory_logs are append-only; unused tables are closed;
--    anonymous visitors get nothing; shortfall alerts still work.
do $$
declare
  n bigint;
begin
  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
    update public.credits set amount = 1 where id = 'smokeA-cr1';
    perform pg_temp.act_as_owner();
    perform pg_temp.check('udhaar entries cannot be changed from the app', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('udhaar entries cannot be changed from the app', true);

  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
    delete from public.inventory_logs where id = 'smokeA-l1';
    perform pg_temp.act_as_owner();
    perform pg_temp.check('stock history cannot be deleted from the app', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('stock history cannot be deleted from the app', exists (select 1 from public.inventory_logs where id = 'smokeA-l1'));

  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
    insert into public.finance_accounts (id, "shopId", name) values ('smokeA-fa', '5a0e5a0e-0000-4000-8000-00000000000a', 'x');
    perform pg_temp.act_as_owner();
    perform pg_temp.check('unused tables are closed (finance_accounts)', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('unused tables are closed (finance_accounts)', true);

  begin
    execute 'set local role anon';
    perform 1 from public.products limit 1;
    execute 'reset role';
    perform pg_temp.check('anonymous visitors cannot read products', false);
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
  perform pg_temp.check('anonymous visitors cannot read products', true);

  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
  update public.inventory_alerts set resolved = true, resolved_at = now()
   where shop_id = '5a0e5a0e-0000-4000-8000-00000000000a' and resolved = false;
  get diagnostics n = row_count;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('the Stock page can still mark a shortfall alert recounted', n = 1);
end $$;

-- 7. A cashier works only in the shop her profile points at: she sees its
--    sales, but cannot move one into a "shop" of her own (hiding it).
do $$
declare
  n bigint;
begin
  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000c');
  select count(*) into n from public.sales where id = 'smokeA-s1';
  perform pg_temp.act_as_owner();
  perform pg_temp.check('a cashier sees her shop''s sales', n = 1);

  begin
    perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000c');
    update public.sales set "shopId" = '5a0e5a0e-0000-4000-8000-00000000000c' where id = 'smokeA-s1';
    perform pg_temp.act_as_owner();
    perform pg_temp.check('a cashier cannot move a sale out of her shop', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('a cashier cannot move a sale out of her shop',
    (select "shopId" from public.sales where id = 'smokeA-s1') = '5a0e5a0e-0000-4000-8000-00000000000a');
end $$;

rollback;

-- The SQL Editor shows only this last line. It runs after the rollback, so
-- it holds constants only (the rehearsal refuses anything else). A failed
-- check never gets here: it stops the file with its SMOKE FAIL error.
select 'ALL TESTS PASSED' as result, '00_lockdown_smoke.sql: every check passed; everything is rolled back' as detail;
