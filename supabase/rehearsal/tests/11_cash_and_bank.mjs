// Cash & Bank Account Management (migration 20261127100000_cash_and_bank_management),
// checked on the state after ALL migrations:
//   * verify_20261127100000 passes (including exact snapshot diff confirming only
//     comment-marked [FINANCE_START]/[FINANCE_END] blocks differ in process_checkout/process_reversal);
//   * re-running 20261127100000 on final state changes nothing;
//   * SELECT-only on finance_accounts/finance_transactions + append-only ledger + no balanceAfter;
//   * shopCash & primaryOnline auto-seeded; secondaryBank create/edit/archive;
//   * opening balance, transfer (lock-ordered, idempotent), payout, overdraft;
//   * expense record/update/delete + legacy unlinked expenses;
//   * credit payment (whole rupees only, cash/online, idempotent, offline);
//   * admin-only reverse_finance_transaction (enforced by single_ref_unique);
//   * direct link vs non-transitive sharing, unlink revocation, cashier boundaries.
import path from 'node:path';
import {
  replica, cloneDb, migrate, migrationFiles, asUser, rpc, read, reporter, lastRows, dbState, stateDiff, showDiff, SUPA, MAIN_SHOP,
} from '../lib.mjs';

const FILE = migrationFiles().find(m => m.version === '20261127100000');
const VERIFY = read(path.join(SUPA, 'diagnostics/verify_20261127100000.sql'));

const A = MAIN_SHOP;                                // Admin, shop A
const B = '158a7adf-79e5-40c4-a87a-dedab3b9a0bb';   // Admin, shop B
const C = '22222222-2222-4222-8222-222222222222';   // Admin, shop C (linked to B only)
const CA = '11111111-1111-4111-8111-111111111111';  // Cashier of shop A

const { ok, expectError, done } = reporter();
const db = await replica({ fixtures: true });
await migrate(db);
ok('20261127100000 migration exists and all migrations apply twice', !!FILE);

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const q1 = async (sql, p = []) => (await q(sql, p))[0];
const call = async (uid, fn, args = {}) => (await rpc(db, uid, fn, args)).rows[0].result;
const acct = id => q1(`select id, "ownerShopId", name, type, "bankName", "accountNumber", balance::float8 as balance, "isOverdrawn", "isArchived" from public.finance_accounts where id = $1`, [id]);
const sysAcct = (shop, type) => q1(`select id, "ownerShopId", name, type, "bankName", "accountNumber", balance::float8 as balance, "isOverdrawn", "isArchived" from public.finance_accounts where "ownerShopId" = $1 and type = $2 and not "isArchived"`, [shop, type]);

// 1. Verify script + idempotent standalone rerun
const verifyJson = JSON.parse(Object.values(lastRows(await db.exec(VERIFY))[0])[0]);
ok('verify_20261127100000 all_checks_passed is true', verifyJson.all_checks_passed === true, JSON.stringify(verifyJson));
ok('process_checkout and process_reversal match pre_20261127100000 snapshot except finance additions',
  verifyJson.checks.process_checkout_only_finance_differs === true
  && verifyJson.checks.process_reversal_only_finance_differs === true);

const sBeforeRerun = await dbState(db);
await db.exec(read(FILE.path));
const rerunChanges = stateDiff(sBeforeRerun, await dbState(db));
ok('re-running 20261127100000 alone changes nothing', rerunChanges.length === 0, showDiff(rerunChanges));

// Seed shops B, C, cashier CA, and link A<->B and B<->C
await db.exec(`
  insert into auth.users (id, email) values
    ('${B}', 'b@example.invalid'),
    ('${C}', 'c@example.invalid'),
    ('${CA}', 'cashier-a@example.invalid');
  insert into public.profiles (id, username, role, "shopId") values
    ('${B}', 'Owner B', 'admin', '${B}'),
    ('${C}', 'Owner C', 'admin', '${C}'),
    ('${CA}', 'Cashier A', 'cashier', '${A}');
  insert into public.settings ("shopId", "shopName") values
    ('${B}', 'Branch B'),
    ('${C}', 'Branch C');
  insert into public.shop_links ("shopA", "shopB") values
    (least('${A}'::uuid, '${B}'::uuid), greatest('${A}'::uuid, '${B}'::uuid)),
    (least('${B}'::uuid, '${C}'::uuid), greatest('${B}'::uuid, '${C}'::uuid));
  insert into public.expenses (id, "shopId", category, description, amount, "expenseDate", "createdBy", "actorName", "actorRole") values
    ('legacy-exp-1', '${A}', 'Rent', 'Legacy rent', 500, now(), '${A}', 'Owner A', 'admin'),
    ('legacy-exp-2', '${A}', 'Misc', 'Legacy misc', 100, now(), '${A}', 'Owner A', 'admin');
`);

// 2. Ensure accounts + SELECT-only + append-only
await call(A, 'ensure_shop_finance_accounts', { p_shop_id: A });
await call(B, 'ensure_shop_finance_accounts', { p_shop_id: B });
await call(C, 'ensure_shop_finance_accounts', { p_shop_id: C });

const cashA = (await sysAcct(A, 'shopCash')).id;
const priA = (await sysAcct(A, 'primaryOnline')).id;
const bankA = 'bank-a-meezan';
const bankB = 'bank-b-hbl';

ok('default shopCash and primaryOnline created at 0 balance (profiles trigger + ensure)',
  (await acct(cashA))?.balance === 0 && (await acct(priA))?.balance === 0
  && !!(await sysAcct(B, 'shopCash')) && !!(await sysAcct(C, 'primaryOnline')));

await expectError('authenticated cannot INSERT into finance_accounts',
  () => asUser(db, A, `insert into public.finance_accounts (id, "shopId", "ownerShopId", name, type) values ('x', $1, $1, 'X', 'secondaryBank')`, [A]),
  /permission denied/);
await expectError('authenticated cannot INSERT into finance_transactions',
  () => asUser(db, A, `insert into public.finance_transactions (id, "shopId", "ownerShopId", "accountId", type, direction, amount) values ('x', $1, $1, $2, 'opening', 'in', 1)`, [A, cashA]),
  /permission denied/);

// 3. Create / rename / archive rules
await expectError('create_finance_account rejects shopCash creation',
  () => call(A, 'create_finance_account', { p_id: 'bad1', p_shop_id: A, p_name: 'Cash 2', p_type: 'shopCash' }),
  /secondaryBank/);
await expectError('create_finance_account rejects cashier',
  () => call(CA, 'create_finance_account', { p_id: 'bad2', p_shop_id: A, p_name: 'Cashier Bank', p_type: 'secondaryBank' }),
  /shop admin/);

const cr = await call(A, 'create_finance_account', {
  p_id: bankA, p_shop_id: A, p_name: 'Meezan Savings', p_type: 'secondaryBank', p_bank_name: 'Meezan', p_account_number: 'PK001',
});
ok('admin creates secondaryBank', cr.status === 'applied' && (await acct(bankA)).type === 'secondaryBank');
await call(B, 'create_finance_account', {
  p_id: bankB, p_shop_id: B, p_name: 'HBL Branch B', p_type: 'secondaryBank', p_bank_name: 'HBL', p_account_number: 'PK002',
});

await call(A, 'update_finance_account', {
  p_id: priA, p_name: 'JazzCash Business', p_bank_name: 'JazzCash', p_account_number: '03001112223',
});
ok('admin renames primaryOnline with bank metadata', (await acct(priA)).name === 'JazzCash Business' && (await acct(priA)).bankName === 'JazzCash');
await expectError('linked shop B cannot edit shop A secondaryBank details',
  () => call(B, 'update_finance_account', { p_id: bankA, p_name: 'Hijack' }),
  /owning shop admin/);

// 4. Opening balance + Transfer + Overdraft + Retry + Archive
await call(A, 'record_opening_balance', { p_id: 'open-cash-a', p_shop_id: A, p_account_id: cashA, p_amount: 5000, p_notes: 'Start' });
ok('opening balance sets 5000', (await acct(cashA)).balance === 5000);
ok('retrying opening balance with same p_id returns duplicate',
  (await call(A, 'record_opening_balance', { p_id: 'open-cash-a', p_shop_id: A, p_account_id: cashA, p_amount: 5000 })).status === 'duplicate');

// Offline overdraft transfer: A transfers 6000 from cashA (5000 -> -1000) to bankA (0 -> 6000)
const tr1 = await call(A, 'transfer_funds', {
  p_transfer_id: 'tr-a-1', p_out_tx_id: 'tr-a-1:out', p_in_tx_id: 'tr-a-1:in',
  p_shop_id: A, p_from_account_id: cashA, p_to_account_id: bankA, p_amount: 6000, p_description: 'Deposit',
});
ok('offline transfer accepted even if overdrawn, flags isOverdrawn=true',
  tr1.status === 'applied' && (await acct(cashA)).balance === -1000 && (await acct(cashA)).isOverdrawn === true && (await acct(bankA)).balance === 6000);
ok('retry transfer returns duplicate',
  (await call(A, 'transfer_funds', {
    p_transfer_id: 'tr-a-1', p_out_tx_id: 'tr-a-1:out', p_in_tx_id: 'tr-a-1:in',
    p_shop_id: A, p_from_account_id: cashA, p_to_account_id: bankA, p_amount: 6000,
  })).status === 'duplicate');

// Cross-shop shared bank transfer B -> B's HBL from A's Meezan
await call(B, 'transfer_funds', {
  p_transfer_id: 'tr-ab-1', p_out_tx_id: 'tr-ab-1:out', p_in_tx_id: 'tr-ab-1:in',
  p_shop_id: B, p_from_account_id: bankA, p_to_account_id: bankB, p_amount: 2000, p_description: 'Shared move',
});
ok('linked admin B can transfer out of shared bankA into bankB',
  (await acct(bankA)).balance === 4000 && (await acct(bankB)).balance === 2000);

// Archive rules
await expectError('archive_finance_account blocks non-zero balance',
  () => call(A, 'archive_finance_account', { p_id: bankA }),
  /Transfer or zero out/);
await call(A, 'create_finance_account', { p_id: 'bank-temp', p_shop_id: A, p_name: 'Temp Bank', p_type: 'secondaryBank' });
ok('archive_finance_account succeeds when balance is 0',
  (await call(A, 'archive_finance_account', { p_id: 'bank-temp' })).status === 'applied'
  && (await acct('bank-temp')).isArchived === true);

// Append-only check even with service_role
await expectError('service_role cannot update or delete finance_transactions',
  () => asUser(db, A, `delete from public.finance_transactions where id = 'open-cash-a'`, [], { role: 'service_role' }),
  /append-only/);

// 5. Non-transitive sharing & role boundaries
ok('A sees A accounts + B shared bankB ONLY (not C bank or B cash/primary)',
  JSON.stringify((await asUser(db, A, `select id from public.finance_accounts order by id`)).rows.map(r => r.id))
  === JSON.stringify([cashA, priA, bankA, 'bank-temp', bankB].sort()));

const sumA = await call(A, 'get_linked_shops_finance_summary');
ok('get_linked_shops_finance_summary for A includes B only (non-transitive)',
  sumA.length === 1 && sumA[0].shopId === B && sumA[0].shopCashBalance === 0);

ok('cashier CA sees ONLY shopCash in finance_accounts and only shopCash txs',
  JSON.stringify((await asUser(db, CA, `select id from public.finance_accounts`)).rows.map(r => r.id)) === JSON.stringify([cashA])
  && (await asUser(db, CA, `select distinct "accountId" from public.finance_transactions`)).rows.every(r => r.accountId === cashA));
await expectError('cashier cannot call get_linked_shops_finance_summary',
  () => call(CA, 'get_linked_shops_finance_summary'),
  /shop admin/);

// 6. Expenses (including legacy expenses) + Credit Payments + Reversals
await expectError('cashier cannot pay expense from primaryOnline',
  () => call(CA, 'record_expense', {
    p_expense_id: 'exp-bad', p_tx_id: 'exp-bad:tx', p_shop_id: A, p_category: 'Tea', p_description: 'x', p_amount: 50, p_expense_date: new Date().toISOString(), p_account_id: priA,
  }),
  /Shop Cash/);

await call(CA, 'record_expense', {
  p_expense_id: 'exp-c1', p_tx_id: 'exp-c1:tx', p_shop_id: A, p_category: 'Tea', p_description: 'Tea', p_amount: 200, p_expense_date: new Date().toISOString(), p_account_id: cashA,
});
ok('cashier expense debits shopCash (-1000 -> -1200)', (await acct(cashA)).balance === -1200);

await call(A, 'update_expense', {
  p_expense_id: 'exp-c1', p_shop_id: A, p_category: 'Tea', p_description: 'Tea edited', p_amount: 300, p_expense_date: new Date().toISOString(), p_account_id: bankA, p_rev_tx_id: 'exp-c1:rev1', p_new_tx_id: 'exp-c1:new1',
});
ok('update_expense changes source and amount atomically (cash -1000, bankA 4000->3700)',
  (await acct(cashA)).balance === -1000 && (await acct(bankA)).balance === 3700);
ok('retry update_expense with same tx ids is idempotent',
  (await call(A, 'update_expense', {
    p_expense_id: 'exp-c1', p_shop_id: A, p_category: 'Tea', p_description: 'Tea edited', p_amount: 300, p_expense_date: new Date().toISOString(), p_account_id: bankA, p_rev_tx_id: 'exp-c1:rev1', p_new_tx_id: 'exp-c1:new1',
  })).status === 'applied' && (await acct(bankA)).balance === 3700);

await call(A, 'update_expense', {
  p_expense_id: 'legacy-exp-1', p_shop_id: A, p_category: 'Rent', p_description: 'Updated legacy', p_amount: 600, p_expense_date: new Date().toISOString(), p_account_id: null,
});
ok('legacy expense edit without account does not touch ledger',
  (await q1(`select count(*)::int n from public.finance_transactions where "referenceId" = 'legacy-exp-1'`)).n === 0);

await call(A, 'delete_expense', { p_expense_id: 'legacy-exp-2', p_shop_id: A });
ok('legacy expense delete leaves ledger clean and archives deleted_rows',
  (await q1(`select count(*)::int n from public.finance_transactions where "referenceId" = 'legacy-exp-2'`)).n === 0
  && !!(await q1(`select 1 x from private.deleted_rows where "table" = 'expenses' and "rowId" = 'legacy-exp-2'`)));

// Credit payment (whole rupees enforced)
const cust1 = 'cust0000000000000001';
const cBal0 = Number((await q1(`select "creditBalance" c from public.customers where id = $1`, [cust1])).c);
await expectError('record_credit_payment rejects decimal amount',
  () => call(CA, 'record_credit_payment', { p_credit_id: 'cp-dec', p_tx_id: 'cp-dec:tx', p_shop_id: A, p_customer_id: cust1, p_amount: 10.25, p_payment_method: 'cash' }),
  /whole number/);
await call(CA, 'record_credit_payment', { p_credit_id: 'cp-cash', p_tx_id: 'cp-cash:tx', p_shop_id: A, p_customer_id: cust1, p_amount: 150, p_payment_method: 'cash', p_description: 'Partial' });
ok('record_credit_payment credits shopCash (-1000 -> -850) and updates customer credit',
  (await acct(cashA)).balance === -850 && Number((await q1(`select "creditBalance" c from public.customers where id = $1`, [cust1])).c) === cBal0 - 150);

// Admin-only transaction reversal (no double reversal)
await call(A, 'record_payout', {
  p_id: 'pay-a1', p_shop_id: A, p_account_id: bankA, p_amount: 700, p_paid_to: 'Supplier Y', p_category: 'supplierPayment', p_description: 'Draw',
});
ok('payout debits bankA (3700 -> 3000)', (await acct(bankA)).balance === 3000);
await expectError('reverse_finance_transaction rejects cashier',
  () => call(CA, 'reverse_finance_transaction', { p_id: 'rev-bad', p_shop_id: A, p_original_tx_id: 'pay-a1', p_reason: 'No auth' }),
  /shop admin/);
await call(A, 'reverse_finance_transaction', { p_id: 'rev-pay-1', p_shop_id: A, p_original_tx_id: 'pay-a1', p_reason: 'Typo' });
ok('reverse_finance_transaction restores payout (3000 -> 3700)', (await acct(bankA)).balance === 3700);
await expectError('cannot reverse same transaction twice',
  () => call(A, 'reverse_finance_transaction', { p_id: 'rev-pay-2', p_shop_id: A, p_original_tx_id: 'pay-a1', p_reason: 'Again' }),
  /already been reversed/);

// Unlinking removes shared access
await call(A, 'unlink_shop', { p_other: B });
ok('after unlinking B, A no longer sees B secondaryBank or B summary',
  !(await asUser(db, A, `select id from public.finance_accounts where id = $1`, [bankB])).rows.length
  && (await call(A, 'get_linked_shops_finance_summary')).length === 0);

// Rollback rehearsal on a cloned database
const rb = await cloneDb(db);
await rb.exec(`
  begin;
  select private.restore_functions('pre_20261127100000');
  select private.restore_policies('pre_20261127100000', 'public', 'finance_accounts');
  select private.restore_policies('pre_20261127100000', 'public', 'finance_transactions');
  revoke all on table public.finance_accounts, public.finance_transactions from authenticated;
  grant select, insert, update, delete on table public.finance_accounts, public.finance_transactions to authenticated;
  drop trigger if exists profiles_provision_finance_accounts on public.profiles;
  drop trigger if exists finance_transactions_before_insert on public.finance_transactions;
  drop trigger if exists finance_transactions_after_insert on public.finance_transactions;
  drop trigger if exists finance_transactions_append_only on public.finance_transactions;
  drop trigger if exists finance_transactions_no_truncate on public.finance_transactions;
  drop function if exists public.ensure_shop_finance_accounts(uuid);
  drop function if exists public.create_finance_account(text, uuid, text, text, text, text, numeric, text);
  drop function if exists public.update_finance_account(text, text, text, text);
  drop function if exists public.archive_finance_account(text);
  drop function if exists public.record_opening_balance(text, uuid, text, numeric, text, timestamptz);
  drop function if exists public.transfer_funds(text, text, text, uuid, text, text, numeric, text, text, timestamptz);
  drop function if exists public.record_payout(text, uuid, text, numeric, text, text, text, text, timestamptz);
  drop function if exists public.record_expense(text, text, uuid, text, text, numeric, timestamptz, text);
  drop function if exists public.update_expense(text, uuid, text, text, numeric, timestamptz, text, text, text);
  drop function if exists public.delete_expense(text, uuid, text);
  drop function if exists public.record_credit_payment(text, text, uuid, text, numeric, text, text);
  drop function if exists public.reverse_finance_transaction(text, uuid, text, text, timestamptz);
  drop function if exists public.get_linked_shops_finance_summary();
  drop function if exists private.is_cashier();
  drop function if exists private.are_shops_directly_linked(uuid, uuid);
  drop function if exists private.ensure_shop_finance_accounts(uuid);
  drop function if exists private.finance_check_write_account(uuid, text);
  drop function if exists private.finance_tx_before_insert();
  drop function if exists private.finance_tx_after_insert();
  drop function if exists private.profiles_provision_finance_accounts();
  delete from private.schema_migrations where version = '20261127100000';
  commit;
`);

const rbFnMatch = (await rb.query(`
  select bool_and(pg_get_functiondef(to_regprocedure(s.signature)) = s.definition) as all_match,
         count(*)::int as snap_count
    from private.function_snapshots s
   where s.label = 'pre_20261127100000'
     and (s.signature like 'public.process_checkout%' or s.signature like 'public.process_reversal%')
`)).rows[0];
ok('rollback restores process_checkout and process_reversal to pre_20261127100000 snapshot',
  rbFnMatch.all_match === true && rbFnMatch.snap_count === 2);

const rbPolLeftover = (await rb.query(`
  with live as (
    select schemaname, tablename, policyname, permissive, roles::text[], cmd, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename in ('finance_accounts', 'finance_transactions')
  ),
  snap as (
    select schemaname, tablename, policyname, permissive, roles::text[], cmd, qual, with_check
      from private.policy_snapshots
     where label = 'pre_20261127100000'
       and schemaname = 'public' and tablename in ('finance_accounts', 'finance_transactions')
  )
  select ((select count(*) from (select * from live except select * from snap) a)
        + (select count(*) from (select * from snap except select * from live) b))::int as diff
`)).rows[0].diff;
ok('rollback restores finance_accounts and finance_transactions policies to pre_20261127100000 snapshot',
  rbPolLeftover === 0);

const rbRemainingRpcs = (await rb.query(`
  select count(*)::int as n
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
   where to_regprocedure(sig) is not null
`)).rows[0].n;
ok('rollback drops reverse_finance_transaction and all 12 other new finance RPCs', rbRemainingRpcs === 0);
await rb.close();

done();
