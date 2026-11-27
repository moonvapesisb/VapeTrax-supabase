-- =====================================================================
-- supabase/tests/02_cash_and_bank_smoke.sql
-- Smoke test for Cash & Bank Account Management (20261127100000):
-- executes EVERY new/updated RPC at least once as authenticated users
-- (admins, cashiers, directly linked, transitive/unlinked) under
-- throwaway shops (example.invalid emails) and rolls everything back.
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

insert into auth.users (id, email, created_at) values
  ('5a0e5a0e-0000-4000-8000-0000000000a1', 'cash-owner-a@example.invalid', now() - interval '2 days'),
  ('5a0e5a0e-0000-4000-8000-0000000000b1', 'cash-owner-b@example.invalid', now() - interval '2 days'),
  ('5a0e5a0e-0000-4000-8000-0000000000c1', 'cash-owner-c@example.invalid', now() - interval '2 days'),
  ('5a0e5a0e-0000-4000-8000-0000000000d1', 'cash-cashier-a@example.invalid', now() - interval '2 days');

insert into public.profiles (id, username, role, "shopId") values
  ('5a0e5a0e-0000-4000-8000-0000000000a1', 'Cash Owner A', 'admin',   '5a0e5a0e-0000-4000-8000-0000000000a1'),
  ('5a0e5a0e-0000-4000-8000-0000000000b1', 'Cash Owner B', 'admin',   '5a0e5a0e-0000-4000-8000-0000000000b1'),
  ('5a0e5a0e-0000-4000-8000-0000000000c1', 'Cash Owner C', 'admin',   '5a0e5a0e-0000-4000-8000-0000000000c1'),
  ('5a0e5a0e-0000-4000-8000-0000000000d1', 'Cash Cashier', 'cashier', '5a0e5a0e-0000-4000-8000-0000000000a1');

-- Direct link A<->B and B<->C (so A and C are NOT directly linked: non-transitive)
insert into public.shop_links ("shopA", "shopB") values
  (least('5a0e5a0e-0000-4000-8000-0000000000a1'::uuid, '5a0e5a0e-0000-4000-8000-0000000000b1'::uuid),
   greatest('5a0e5a0e-0000-4000-8000-0000000000a1'::uuid, '5a0e5a0e-0000-4000-8000-0000000000b1'::uuid)),
  (least('5a0e5a0e-0000-4000-8000-0000000000b1'::uuid, '5a0e5a0e-0000-4000-8000-0000000000c1'::uuid),
   greatest('5a0e5a0e-0000-4000-8000-0000000000b1'::uuid, '5a0e5a0e-0000-4000-8000-0000000000c1'::uuid));

insert into public.products (id, "shopId", name, category, "stockQuantity") values
  ('cb-pod-a', '5a0e5a0e-0000-4000-8000-0000000000a1', 'Smoke Pod A', 'device', 20);
insert into public.customers (id, "shopId", name, phone, "creditBalance") values
  ('cb-cust-a', '5a0e5a0e-0000-4000-8000-0000000000a1', 'Udhaar Customer', '0300-1234567', 500);
-- Legacy expenses (paidFromAccountId IS NULL) and pre-go-live historical sale
insert into public.expenses (id, "shopId", category, description, amount, "expenseDate", "createdBy", "actorName", "actorRole") values
  ('cb-exp-legacy-stay',   '5a0e5a0e-0000-4000-8000-0000000000a1', 'Rent',  'Legacy unlinked', 200, now(), '5a0e5a0e-0000-4000-8000-0000000000a1', 'Cash Owner A', 'admin'),
  ('cb-exp-legacy-assign', '5a0e5a0e-0000-4000-8000-0000000000a1', 'Bills', 'Legacy assign',   300, now(), '5a0e5a0e-0000-4000-8000-0000000000a1', 'Cash Owner A', 'admin'),
  ('cb-exp-legacy-del',    '5a0e5a0e-0000-4000-8000-0000000000a1', 'Tea',   'Legacy delete',   150, now(), '5a0e5a0e-0000-4000-8000-0000000000a1', 'Cash Owner A', 'admin');
insert into public.sales (id, "shopId", "totalAmount", "paymentMethod", items) values
  ('cb-sale-legacy', '5a0e5a0e-0000-4000-8000-0000000000a1', 900, 'cash', '[{"productId":"cb-pod-a","productName":"Smoke Pod A","quantity":1,"saleType":"regular"}]');

do $$
declare
  v_a       uuid := '5a0e5a0e-0000-4000-8000-0000000000a1';
  v_b       uuid := '5a0e5a0e-0000-4000-8000-0000000000b1';
  v_c       uuid := '5a0e5a0e-0000-4000-8000-0000000000c1';
  v_cashier uuid := '5a0e5a0e-0000-4000-8000-0000000000d1';
  v_cash_a  text;
  v_pri_a   text;
  v_bank_a  text := 'cb-bank-a';
  v_bank_z  text := 'cb-bank-zero';
  r         jsonb;
  v_bal     numeric;
begin
  -- 1. All reads & writes below execute as role authenticated via pg_temp.act_as(...)
  perform pg_temp.act_as(v_a);
  r := public.ensure_shop_finance_accounts(v_a);
  perform pg_temp.check('ensure_shop_finance_accounts ok', r->>'status' = 'ok');
  select id into v_cash_a from public.finance_accounts where "ownerShopId" = v_a and type = 'shopCash' and not "isArchived";
  select id into v_pri_a  from public.finance_accounts where "ownerShopId" = v_a and type = 'primaryOnline' and not "isArchived";
  perform pg_temp.check('shop A has auto-seeded cash and primaryOnline', v_cash_a is not null and v_pri_a is not null);
  perform pg_temp.act_as_owner();

  perform pg_temp.act_as(v_b);
  perform public.ensure_shop_finance_accounts(v_b);
  perform pg_temp.act_as_owner();

  begin
    perform pg_temp.act_as(v_a);
    insert into public.finance_accounts (id, "shopId", "ownerShopId", name, type) values ('hack', v_a, v_a, 'Hack', 'secondaryBank');
    perform pg_temp.check('direct insert into finance_accounts denied', false);
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as_owner();

  begin
    perform pg_temp.act_as(v_a);
    insert into public.finance_transactions (id, "shopId", "ownerShopId", "accountId", type, direction, amount)
    values ('hack-tx', v_a, v_a, v_cash_a, 'opening', 'in', 100);
    perform pg_temp.check('direct insert into finance_transactions denied', false);
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as_owner();

  -- 2. create_finance_account + update_finance_account + archive_finance_account (as authenticated admin A)
  perform pg_temp.act_as(v_a);
  r := public.create_finance_account(v_bank_a, v_a, 'Meezan Secondary', 'secondaryBank', 'Meezan Bank', '0123', 0, null);
  perform pg_temp.check('create_finance_account created secondaryBank', r->>'status' = 'applied');
  r := public.create_finance_account(v_bank_z, v_a, 'Zero Bank', 'secondaryBank', 'UBL', '9999', 0, null);
  perform pg_temp.check('create_finance_account second bank ok', r->>'status' = 'applied');
  r := public.update_finance_account(v_pri_a, 'Shop Easypaisa', 'Easypaisa', '03001112223');
  perform pg_temp.check('update_finance_account renamed primaryOnline', r->>'status' = 'applied');
  r := public.archive_finance_account(v_bank_z);
  perform pg_temp.check('archive_finance_account archives zero-balance bank', r->>'status' = 'applied');

  -- 3. record_opening_balance + transfer_funds + record_payout + reverse_finance_transaction (as authenticated admin A)
  r := public.record_opening_balance('cb-open-cash', v_a, v_cash_a, 1000, 'Drawer float');
  perform pg_temp.check('record_opening_balance applied',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_cash_a) = 1000);
  r := public.transfer_funds('cb-tr-1', 'cb-tr-1:out', 'cb-tr-1:in', v_a, v_cash_a, v_bank_a, 400, 'Deposit to Meezan');
  perform pg_temp.check('transfer_funds applied (1000->600, 0->400)',
    r->>'status' = 'applied'
    and (select balance from public.finance_accounts where id = v_cash_a) = 600
    and (select balance from public.finance_accounts where id = v_bank_a) = 400);
  r := public.record_payout('cb-pay-1', v_a, v_bank_a, 100, 'Owner', 'ownerWithdrawal', 'Owner draw');
  perform pg_temp.check('record_payout applied (400->300)',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_bank_a) = 300);
  r := public.reverse_finance_transaction('cb-rev-1', v_a, 'cb-pay-1', 'Entered by mistake');
  perform pg_temp.check('reverse_finance_transaction restores payout (300->400)',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_bank_a) = 400);
  perform pg_temp.act_as_owner();

  begin
    perform pg_temp.act_as(v_a);
    perform public.reverse_finance_transaction('cb-rev-dup', v_a, 'cb-pay-1', 'Second try');
    perform pg_temp.check('cannot reverse same transaction twice', false);
  exception when invalid_parameter_value then null;
  end;
  perform pg_temp.act_as_owner();

  -- 4. Linked shop B admin & unlinked/transitive shop C admin (running STRICTLY as authenticated role)
  perform pg_temp.act_as(v_b);
  perform pg_temp.check('linked shop B (authenticated) sees secondaryBank A',
    exists (select 1 from public.finance_accounts where id = v_bank_a));
  perform pg_temp.check('linked shop B (authenticated) sees secondaryBank A txs',
    exists (select 1 from public.finance_transactions where "accountId" = v_bank_a));
  perform pg_temp.check('linked shop B (authenticated) cannot select shop A shopCash',
    not exists (select 1 from public.finance_accounts where id = v_cash_a));
  r := public.record_payout('cb-pay-b-on-a', v_b, v_bank_a, 50, 'Vendor X', 'supplierPayment', 'Shared payout');
  perform pg_temp.check('linked shop B can payout from shared secondaryBank (400->350)',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_bank_a) = 350);
  r := public.get_linked_shops_finance_summary();
  perform pg_temp.check('get_linked_shops_finance_summary shows B linked to A and C only',
    jsonb_array_length(r) = 2);
  perform pg_temp.act_as_owner();

  perform pg_temp.act_as(v_c);
  perform pg_temp.check('transitive shop C (authenticated) cannot see Shop A secondaryBank',
    not exists (select 1 from public.finance_accounts where id = v_bank_a));
  perform pg_temp.check('transitive shop C (authenticated) cannot see Shop A txs',
    not exists (select 1 from public.finance_transactions where "ownerShopId" = v_a));
  perform pg_temp.act_as_owner();

  -- 5. Cashier role permissions (running STRICTLY as authenticated cashier role)
  perform pg_temp.act_as(v_cashier);
  perform pg_temp.check('cashier (authenticated) sees only shopCash in finance_accounts',
    (select count(*) from public.finance_accounts) = 1
    and (select type from public.finance_accounts limit 1) = 'shopCash');
  perform pg_temp.check('cashier (authenticated) sees only shopCash txs in finance_transactions',
    not exists (select 1 from public.finance_transactions where "accountId" <> v_cash_a));
  r := public.record_expense('cb-exp-cashier', 'cb-exp-cashier:tx', v_a, 'Tea', 'Morning tea', 100, now(), v_cash_a);
  perform pg_temp.check('cashier record_expense from shopCash (600->500)',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_cash_a) = 500);
  perform pg_temp.act_as_owner();

  begin
    perform pg_temp.act_as(v_cashier);
    perform public.record_expense('cb-exp-cashier-bad', 'cb-exp-cashier-bad:tx', v_a, 'Tea', 'Bad', 50, now(), v_pri_a);
    perform pg_temp.check('cashier blocked from primaryOnline expense', false);
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as_owner();

  begin
    perform pg_temp.act_as(v_cashier);
    perform public.get_linked_shops_finance_summary();
    perform pg_temp.check('cashier blocked from get_linked_shops_finance_summary', false);
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as_owner();

  -- 6. Admin edits & deletes linked + legacy expenses (as authenticated admin A)
  perform pg_temp.act_as(v_a);
  r := public.record_expense('cb-exp-admin', 'cb-exp-admin:tx0', v_a, 'Supplies', 'Paper', 150, now(), v_bank_a);
  perform pg_temp.check('admin record_expense from secondaryBank (350->200)',
    (select balance from public.finance_accounts where id = v_bank_a) = 200);
  r := public.update_expense('cb-exp-admin', v_a, 'Supplies', 'Paper + ink', 120, now(), v_bank_a, 'cb-exp-rev-1', 'cb-exp-new-1');
  perform pg_temp.check('admin update_expense adjusts ledger (200+150-120=230)',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_bank_a) = 230);
  r := public.update_expense('cb-exp-admin', v_a, 'Supplies', 'More paper', 100, now(), v_bank_a, 'cb-exp-rev-2', 'cb-exp-new-2');
  perform pg_temp.check('repeated update_expense succeeds (230+120-100=250)',
    (select balance from public.finance_accounts where id = v_bank_a) = 250);
  r := public.delete_expense('cb-exp-admin', v_a, 'cb-exp-del-1');
  perform pg_temp.check('delete_expense reverses ledger (250+100=350)',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_bank_a) = 350);

  -- Legacy expense tests (paidFromAccountId IS NULL)
  r := public.update_expense('cb-exp-legacy-stay', v_a, 'Rent', 'Legacy still null', 250, now(), null, null, null);
  perform pg_temp.check('update_expense on legacy expense without account leaves ledger untouched',
    r->>'status' = 'applied'
    and not exists (select 1 from public.finance_transactions where "referenceId" = 'cb-exp-legacy-stay'));
  r := public.update_expense('cb-exp-legacy-assign', v_a, 'Bills', 'Assigned now', 300, now(), v_cash_a, null, 'cb-leg-assign-tx');
  perform pg_temp.check('update_expense assigning account to legacy expense debits cash once (500->200)',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_cash_a) = 200);
  r := public.delete_expense('cb-exp-legacy-del', v_a, 'cb-leg-del-tx');
  perform pg_temp.check('delete_expense on legacy expense leaves cash at 200',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_cash_a) = 200);
  perform pg_temp.act_as_owner();

  perform pg_temp.check('deleted expenses archived in private.deleted_rows',
    exists (select 1 from private.deleted_rows where "table" = 'expenses' and "rowId" = 'cb-exp-admin')
    and exists (select 1 from private.deleted_rows where "table" = 'expenses' and "rowId" = 'cb-exp-legacy-del'));

  -- 7. record_credit_payment (whole rupees + decimal rejection + idempotent retry, as authenticated cashier/admin)
  begin
    perform pg_temp.act_as(v_cashier);
    perform public.record_credit_payment('cb-cp-dec', 'cb-cp-dec:tx', v_a, 'cb-cust-a', 50.5, 'cash', 'Decimal');
    perform pg_temp.check('record_credit_payment rejects decimal amounts', false);
  exception when invalid_parameter_value then null;
  end;
  perform pg_temp.act_as_owner();

  perform pg_temp.act_as(v_cashier);
  r := public.record_credit_payment('cb-cp-1', 'cb-cp-1:tx', v_a, 'cb-cust-a', 200, 'cash', 'Paid cash');
  perform pg_temp.check('record_credit_payment cash credits shopCash (200->400) and lowers udhaar (500->300)',
    r->>'status' = 'applied'
    and (select balance from public.finance_accounts where id = v_cash_a) = 400
    and (select "creditBalance" from public.customers where id = 'cb-cust-a') = 300);
  r := public.record_credit_payment('cb-cp-1', 'cb-cp-1:tx', v_a, 'cb-cust-a', 200, 'cash', 'Paid cash');
  perform pg_temp.check('record_credit_payment retry is duplicate', r->>'status' = 'duplicate');
  perform pg_temp.act_as_owner();

  perform pg_temp.act_as(v_a);
  r := public.record_credit_payment('cb-cp-2', 'cb-cp-2:tx', v_a, 'cb-cust-a', 100, 'online', 'Paid online');
  perform pg_temp.check('record_credit_payment online credits primaryOnline (0->100)',
    r->>'status' = 'applied'
    and (select balance from public.finance_accounts where id = v_pri_a) = 100
    and (select "paymentMethod" from public.credits where id = 'cb-cp-2') = 'online');
  perform pg_temp.act_as_owner();

  -- 8. process_checkout + process_reversal (as authenticated cashier & admin)
  perform pg_temp.act_as(v_cashier);
  r := public.process_checkout(
    v_a::text,
    '{"id":"cb-sale-1","customerId":"cb-cust-a","totalAmount":1000,"paymentMethod":"split","splitAmounts":{"cash":400,"online":300,"credit":300},
      "items":[{"productId":"cb-pod-a","productName":"Smoke Pod A","quantity":1,"saleType":"regular"}]}'::jsonb,
    '[{"id":"cb-pod-a","deduction":1}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'cb-cust-a', 300
  );
  perform pg_temp.check('cashier process_checkout split credits shopCash (400->800)',
    r->>'status' = 'applied' and (select balance from public.finance_accounts where id = v_cash_a) = 800);
  perform pg_temp.act_as_owner();

  perform pg_temp.act_as(v_a);
  perform pg_temp.check('admin sees primaryOnline credited (100->400) from split sale',
    (select balance from public.finance_accounts where id = v_pri_a) = 400);
  -- Drain 700 from shopCash (800->100), then void the split sale (cash void 400 -> -300 OVERDRAWN!)
  perform public.record_payout('cb-pay-drain', v_a, v_cash_a, 700, 'Owner', 'ownerWithdrawal', 'Cash draw');
  r := public.process_reversal(v_a, 'cb-sale-1', true, null, null, null, null, 0);
  select balance into v_bal from public.finance_accounts where id = v_cash_a;
  perform pg_temp.check('process_reversal allows negative shopCash and sets isOverdrawn=true (100-400=-300)',
    r->>'status' = 'applied'
    and v_bal = -300
    and (select "isOverdrawn" from public.finance_accounts where id = v_cash_a) is true
    and (select balance from public.finance_accounts where id = v_pri_a) = 100);

  -- Pre-go-live legacy sale reversal must NOT touch shopCash
  r := public.process_reversal(v_a, 'cb-sale-legacy', true, null, null, null, null, 0);
  perform pg_temp.check('process_reversal on pre-go-live sale leaves shopCash at -300',
    r->>'status' = 'applied'
    and (select balance from public.finance_accounts where id = v_cash_a) = -300);
  perform pg_temp.act_as_owner();
end $$;

rollback;

select 'ALL TESTS PASSED' as result, '02_cash_and_bank_smoke.sql: every check passed; everything is rolled back' as detail;
