-- =====================================================================
-- supabase/tests/01_legacy_rpc_smoke.sql
-- Smoke test for the sale functions after 20261012100000_lockdown_followup:
-- process_checkout and process_reversal, called the way the deployed app
-- calls them (payload shapes from NewSale.tsx and salesReversal.ts, a
-- Firestore-style sale id). Run it AFTER the migration.
--
-- It creates two throwaway shops (example.invalid emails), sells, replays,
-- deletes and edits sales there, checks every stock, bottle and udhaar
-- number, and then ROLLS EVERYTHING BACK: it leaves nothing behind and
-- never touches the real shop's rows.
--
-- How to run: SQL Editor -> New query -> paste this whole file -> Run.
-- Success: the result shows "ALL TESTS PASSED" (the file's last line,
-- after the rollback). Any failed check stops with an error that starts
-- with "SMOKE FAIL"; copy it back. Nothing is changed either way.
-- =====================================================================
begin;

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

-- supabase.rpc('process_checkout', ...) as a logged-in user.
create function pg_temp.checkout(p_uid uuid, p_shop uuid, p_sale jsonb, p_prods jsonb,
                                 p_bots jsonb default '[]', p_logs jsonb default '[]',
                                 p_cust text default null, p_credit numeric default 0)
returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  perform pg_temp.act_as(p_uid);
  r := public.process_checkout(p_shop_id => p_shop::text, p_sale_data => p_sale, p_product_updates => p_prods,
                               p_bottle_updates => p_bots, p_inventory_logs => p_logs,
                               p_customer_id => p_cust, p_credit_increment => p_credit);
  perform pg_temp.act_as_owner();
  return r;
end $f$;

-- supabase.rpc('process_reversal', ...) as a logged-in user (the client's
-- arrays are sent, and ignored by the server).
create function pg_temp.reversal(p_uid uuid, p_shop uuid, p_sale text, p_delete boolean)
returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  perform pg_temp.act_as(p_uid);
  r := public.process_reversal(p_shop_id => p_shop, p_sale_id => p_sale, p_delete_sale => p_delete,
                               p_inventory_logs => '[{"id":"smoke-client-log","productId":"smokeA-pod","action":"return","change":-99}]',
                               p_bottle_updates => '[{"bottleId":"smokeA-b1","remainingMl":0,"status":"empty"}]',
                               p_product_updates => '[{"productId":"smokeA-pod","addition":-99}]',
                               p_customer_id => 'smokeA-c1', p_credit_decrement => 99999);
  perform pg_temp.act_as_owner();
  return r;
end $f$;

create function pg_temp.stock(p_id text) returns numeric language sql as $f$
  select "stockQuantity" from public.products where id = p_id
$f$;

insert into auth.users (id, email, created_at) values
  ('5a0e5a0e-0000-4000-8000-00000000000a', 'smoke-owner-a@example.invalid', now() - interval '2 days'),
  ('5a0e5a0e-0000-4000-8000-00000000000b', 'smoke-owner-b@example.invalid', now() - interval '2 days'),
  ('5a0e5a0e-0000-4000-8000-00000000000c', 'smoke-cashier@example.invalid', now() - interval '2 days');
insert into public.profiles (id, username, role, "shopId") values
  ('5a0e5a0e-0000-4000-8000-00000000000a', 'Smoke Owner A', 'admin',   '5a0e5a0e-0000-4000-8000-00000000000a'),
  ('5a0e5a0e-0000-4000-8000-00000000000b', 'Smoke Owner B', 'admin',   '5a0e5a0e-0000-4000-8000-00000000000b'),
  ('5a0e5a0e-0000-4000-8000-00000000000c', 'Smoke Cashier', 'cashier', '5a0e5a0e-0000-4000-8000-00000000000a');
insert into public.products (id, "shopId", name, category, "stockQuantity", "bottleSize") values
  ('smokeA-pod',   '5a0e5a0e-0000-4000-8000-00000000000a', 'Smoke Pod',   'device',   10, null),
  ('smokeA-juice', '5a0e5a0e-0000-4000-8000-00000000000a', 'Smoke Juice', 'e-liquid', 75, '30ml');
insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status) values
  ('smokeA-b1', 'smokeA-juice', '5a0e5a0e-0000-4000-8000-00000000000a', 30, 15, 'opened'),
  ('smokeA-b2', 'smokeA-juice', '5a0e5a0e-0000-4000-8000-00000000000a', 30, 30, 'closed');
insert into public.customers (id, "shopId", name, "creditBalance") values
  ('smokeA-c1', '5a0e5a0e-0000-4000-8000-00000000000a', 'Smoke customer', 0);

-- 1. A regular cash sale with a Firestore-style id; then the queue resends it.
do $$
declare
  r jsonb;
begin
  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"Sm0kEfS7x9QkLmN2pR4t","customerId":null,"totalAmount":1500,"totalCOGS":1000,"totalProfit":500,"paymentMethod":"cash",
      "items":[{"productId":"smokeA-pod","productName":"Smoke Pod","quantity":1,"unitPrice":1500,"saleType":"regular","refillAmount":null}],
      "actorRole":"admin","actorName":"smoke","splitAmounts":null,
      "saleDate":"2026-10-11T09:15:00.000Z","saleDateClient":"2026-10-11T09:15:00.000Z","createdAt":"2026-10-11T09:15:00.000Z"}',
    '[{"id":"smokeA-pod","deduction":1}]', '[]',
    '[{"id":"smoke-log-1","productId":"smokeA-pod","productName":"Smoke Pod","action":"sale","type":"sale","change":-1,"quantityChange":-1,"newStock":9}]');
  perform pg_temp.check('checkout answers applied', r->>'status' = 'applied' and r->>'saleId' = 'Sm0kEfS7x9QkLmN2pR4t');
  perform pg_temp.check('the Firestore-style sale is saved and stock goes 10 -> 9',
    exists (select 1 from public.sales where id = 'Sm0kEfS7x9QkLmN2pR4t') and pg_temp.stock('smokeA-pod') = 9);
  perform pg_temp.check('its stock log is stamped by the server (shop, user, before/after, sale id)',
    exists (select 1 from public.inventory_logs where id = 'smoke-log-1'
              and "shopId" = '5a0e5a0e-0000-4000-8000-00000000000a' and "createdBy" = '5a0e5a0e-0000-4000-8000-00000000000a'
              and "previousStock" = 10 and "newStock" = 9 and "refId" = 'Sm0kEfS7x9QkLmN2pR4t'));

  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"Sm0kEfS7x9QkLmN2pR4t","totalAmount":1500,"paymentMethod":"cash",
      "items":[{"productId":"smokeA-pod","productName":"Smoke Pod","quantity":1,"saleType":"regular"}]}',
    '[{"id":"smokeA-pod","deduction":1}]');
  perform pg_temp.check('the same sale sent again answers duplicate and changes nothing',
    r->>'status' = 'duplicate' and pg_temp.stock('smokeA-pod') = 9
    and (select count(*) from public.sales where id = 'Sm0kEfS7x9QkLmN2pR4t') = 1);
end $$;

-- 2. Refused and recorded cases.
do $$
declare
  r jsonb;
begin
  begin
    r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000b', '5a0e5a0e-0000-4000-8000-00000000000a',
      '{"id":"smoke-foreign","totalAmount":1,"paymentMethod":"cash","items":[]}', '[]');
    perform pg_temp.check('another shop cannot sell into this shop', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.check('another shop cannot sell into this shop', not exists (select 1 from public.sales where id = 'smoke-foreign'));

  begin
    r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
      '{"id":"smoke-bad-refill","totalAmount":100,"paymentMethod":"cash",
        "items":[{"productId":"smokeA-juice","productName":"Smoke Juice","quantity":1,"saleType":"refill","refillAmount":2.3}]}',
      '[{"id":"smokeA-juice","deduction":2.3}]');
    perform pg_temp.check('a refill of 2.3 ml is refused', false);
  exception when invalid_parameter_value then
    null;
  end;
  perform pg_temp.check('a refill of 2.3 ml is refused, nothing saved',
    not exists (select 1 from public.sales where id = 'smoke-bad-refill') and pg_temp.stock('smokeA-juice') = 75);

  begin
    r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
      '{"id":"smoke-bad-refill-2","totalAmount":100,"paymentMethod":"cash",
        "items":[{"productId":"smokeA-juice","productName":"Smoke Juice","quantity":1,"saleType":"Refill","refillAmount":2.3}]}',
      '[{"id":"smokeA-juice","deduction":2.3}]');
    perform pg_temp.check('a refill spelled "Refill" of 2.3 ml is refused too', false);
  exception when invalid_parameter_value then
    null;
  end;
  perform pg_temp.check('a refill spelled "Refill" of 2.3 ml is refused too, nothing saved',
    not exists (select 1 from public.sales where id = 'smoke-bad-refill-2') and pg_temp.stock('smokeA-juice') = 75);

  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"smoke-missing-product","totalAmount":100,"paymentMethod":"cash",
      "items":[{"productId":"smoke-gone","productName":"Gone","quantity":1,"saleType":"regular"}]}',
    '[{"id":"smoke-gone","deduction":1}]');
  perform pg_temp.check('a sale naming a missing product is kept and recorded for review',
    r->>'status' = 'applied' and exists (select 1 from public.sales where id = 'smoke-missing-product')
    and exists (select 1 from private.repair_log where kind = 'missing_product' and "refId" = 'smoke-gone'));

  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"smoke-short","totalAmount":15000,"paymentMethod":"cash",
      "items":[{"productId":"smokeA-pod","productName":"Smoke Pod","quantity":12,"saleType":"regular"}]}',
    '[{"id":"smokeA-pod","deduction":12}]');
  perform pg_temp.check('a short sale (9 in stock, 12 sold) is kept, stock stops at 0 with a shortfall note',
    r->>'status' = 'applied' and pg_temp.stock('smokeA-pod') = 0
    and exists (select 1 from public.inventory_logs where action = 'shortfall' and "refId" = 'smoke-short')
    and exists (select 1 from public.inventory_alerts where product_id = 'smokeA-pod' and resolved = false));
  update public.products set "stockQuantity" = 10 where id = 'smokeA-pod';
end $$;

-- 3. A refill on credit; a later refill from the same bottle; deleting the
--    first sale restores ml by difference and keeps the later refill.
do $$
declare
  r jsonb;
begin
  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"smoke-refill","customerId":"smokeA-c1","totalAmount":210,"paymentMethod":"credit",
      "items":[{"productId":"smokeA-juice","productName":"Smoke Juice","quantity":2,"unitPrice":105,"saleType":"refill","refillAmount":1.5,"bottleSize":30,
                "bottleChanges":[{"bottleId":"smokeA-b1","beforeRemainingMl":15,"afterRemainingMl":12,"beforeStatus":"opened","afterStatus":"opened"}]}]}',
    '[{"id":"smokeA-juice","deduction":3}]',
    '[{"id":"smokeA-b1","productId":"smokeA-juice","bottleSize":30,"remainingMl":12,"status":"opened"}]',
    '[]', 'smokeA-c1', 0);
  perform pg_temp.check('refill sale: 75 -> 72 ml, bottle 15 -> 12, udhaar +210 (worked out by the server)',
    pg_temp.stock('smokeA-juice') = 72
    and (select "remainingMl" from public.bottles where id = 'smokeA-b1') = 12
    and (select "creditBalance" from public.customers where id = 'smokeA-c1') = 210);

  update public.bottles set "remainingMl" = 10 where id = 'smokeA-b1';   -- a later refill took 2 ml

  begin
    r := pg_temp.reversal('5a0e5a0e-0000-4000-8000-00000000000c', '5a0e5a0e-0000-4000-8000-00000000000a', 'smoke-refill', true);
    perform pg_temp.check('a cashier cannot delete a sale', false);
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.check('a cashier cannot delete a sale', exists (select 1 from public.sales where id = 'smoke-refill'));

  r := pg_temp.reversal('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a', 'smoke-refill', true);
  perform pg_temp.check('the admin deletes it: answers applied, sale gone', r->>'status' = 'applied'
    and not exists (select 1 from public.sales where id = 'smoke-refill'));
  perform pg_temp.check('stock back to 75 ml from the stored sale (the client''s -99 is ignored)', pg_temp.stock('smokeA-juice') = 75);
  perform pg_temp.check('bottle restored by difference: 10 + 3 = 13 (the later refill is kept)',
    (select "remainingMl" from public.bottles where id = 'smokeA-b1') = 13);
  perform pg_temp.check('udhaar back to 0 from the stored sale (the client''s 99999 is ignored)',
    (select "creditBalance" from public.customers where id = 'smokeA-c1') = 0);

  r := pg_temp.reversal('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a', 'smoke-refill', true);
  perform pg_temp.check('deleting it twice restores once (answers duplicate)', r->>'status' = 'duplicate'
    and pg_temp.stock('smokeA-juice') = 75 and (select "remainingMl" from public.bottles where id = 'smokeA-b1') = 13);
end $$;

-- 4. Full bottle on a split payment, then the app's edit flow
--    (reverse, delete the row, check out again under the same id).
do $$
declare
  r jsonb;
  n bigint;
begin
  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"smoke-edit","customerId":"smokeA-c1","totalAmount":2000,"paymentMethod":"split","splitAmounts":{"cash":1500,"online":0,"credit":500},
      "items":[{"productId":"smokeA-juice","productName":"Smoke Juice","quantity":1,"saleType":"full_bottle","bottleSize":30,
                "bottleChanges":[{"bottleId":"smokeA-b2","beforeRemainingMl":30,"afterRemainingMl":0,"beforeStatus":"closed","afterStatus":"sold"}]}],
      "saleDate":"2026-10-11T08:00:00.000Z"}',
    '[{"id":"smokeA-juice","deduction":30}]',
    '[{"id":"smokeA-b2","productId":"smokeA-juice","bottleSize":30,"remainingMl":0,"status":"sold"}]',
    '[]', 'smokeA-c1', 500);
  perform pg_temp.check('full bottle sale: 75 -> 45 ml, bottle sold, udhaar +500 (credit part of the split)',
    pg_temp.stock('smokeA-juice') = 45 and (select status from public.bottles where id = 'smokeA-b2') = 'sold'
    and (select "creditBalance" from public.customers where id = 'smokeA-c1') = 500);

  r := pg_temp.reversal('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a', 'smoke-edit', false);
  perform pg_temp.check('edit step 1: the reversal restores 30 ml, the bottle is full and closed again, udhaar back to 0',
    r->>'status' = 'applied' and pg_temp.stock('smokeA-juice') = 75
    and (select status from public.bottles where id = 'smokeA-b2') = 'closed'
    and (select "remainingMl" from public.bottles where id = 'smokeA-b2') = 30
    and (select "creditBalance" from public.customers where id = 'smokeA-c1') = 0);

  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
  delete from public.sales where id = 'smoke-edit';
  get diagnostics n = row_count;
  perform pg_temp.act_as_owner();
  perform pg_temp.check('edit step 2: the app''s own delete finds nothing to delete, without error', n = 0);

  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"smoke-edit","totalAmount":200,"paymentMethod":"cash",
      "items":[{"productId":"smokeA-pod","productName":"Smoke Pod","quantity":2,"saleType":"regular"}],
      "saleDate":"2026-10-11T08:00:00.000Z"}',
    '[{"id":"smokeA-pod","deduction":2}]');
  perform pg_temp.check('edit step 3: the same sale id checks out again, keeping its date',
    r->>'status' = 'applied' and pg_temp.stock('smokeA-pod') = 8
    and (select "saleDate" from public.sales where id = 'smoke-edit') = '2026-10-11T08:00:00.000Z'::timestamptz);
end $$;

-- 5. A sale that arrived short (2 in stock, 5 sold: only 2 taken off), then
--    edited down to 1: the edit puts back only the 2, so stock ends at 1.
do $$
declare
  r jsonb;
  n bigint;
begin
  update public.products set "stockQuantity" = 2 where id = 'smokeA-pod';
  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"smoke-short-edit","totalAmount":7500,"paymentMethod":"cash",
      "items":[{"productId":"smokeA-pod","productName":"Smoke Pod","quantity":5,"saleType":"regular"}]}',
    '[{"id":"smokeA-pod","deduction":5}]');
  perform pg_temp.check('short sale: kept, stock stops at 0', r->>'status' = 'applied' and pg_temp.stock('smokeA-pod') = 0);

  r := pg_temp.reversal('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a', 'smoke-short-edit', false);
  perform pg_temp.check('editing it puts back only the 2 really taken off (stock 2, not 5)',
    r->>'status' = 'applied' and pg_temp.stock('smokeA-pod') = 2);

  perform pg_temp.act_as('5a0e5a0e-0000-4000-8000-00000000000a');
  delete from public.sales where id = 'smoke-short-edit';
  get diagnostics n = row_count;
  perform pg_temp.act_as_owner();

  r := pg_temp.checkout('5a0e5a0e-0000-4000-8000-00000000000a', '5a0e5a0e-0000-4000-8000-00000000000a',
    '{"id":"smoke-short-edit","totalAmount":1500,"paymentMethod":"cash",
      "items":[{"productId":"smokeA-pod","productName":"Smoke Pod","quantity":1,"saleType":"regular"}]}',
    '[{"id":"smokeA-pod","deduction":1}]');
  perform pg_temp.check('the edited sale (quantity 1) leaves stock at 1', r->>'status' = 'applied' and n = 0 and pg_temp.stock('smokeA-pod') = 1);
end $$;

rollback;

-- The SQL Editor shows only this last line. It runs after the rollback, so
-- it holds constants only (the rehearsal refuses anything else). A failed
-- check never gets here: it stops the file with its SMOKE FAIL error.
select 'ALL TESTS PASSED' as result, '01_legacy_rpc_smoke.sql: every check passed; everything is rolled back' as detail;
