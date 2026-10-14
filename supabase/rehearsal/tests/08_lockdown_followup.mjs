// Migration 20261012100000_lockdown_followup, on the replica with fixtures
// after ALL migrations (each applied twice; RERUN_UNSAFE files once):
//   * the plan's list: shop isolation, no self-escalation, replay returns
//     'duplicate', reversing twice restores once, bottles restored by delta,
//     foreign shop 42501, API product delete archives, a 30-row API delete
//     is blocked, personal_expenses admin-only, a missing product keeps the
//     sale and writes repair_log, a Firestore-style sale id end to end;
//   * the owner's rules inside the NEW process_checkout (guarded deduction,
//     shortfall kept + alert, 0.5 ml refills, whole quantities, NaN and
//     absurd values refused, negative deduction refused, CHECKs in place);
//   * telemetry, date clamp, derived udhaar, server-stamped logs;
//   * process_reversal from the STORED sale (admin only, always deletes,
//     client arrays ignored, ml for e-liquid, orphan bottles harmless);
//   * EVERY write path of the deployed app (src/ at commit 2c5de29 and this
//     branch), run as the app runs it (role authenticated + JWT claims);
//   * the snapshot helpers can put the old functions back;
//   * review fixes: a short sale later deleted or edited puts back only
//     what it took; 'Refill' gets the 0.5 ml rule; '60ml' line sizes; a
//     cashier's shop is only her profile's shop; a sale lost by the
//     deployed Edit flow is listed by diagnostics/08_lost_sales.sql.
import path from 'node:path';
import { replica, cloneDb, migrate, migrationFiles, asUser, rpc, read, lastRows, reporter, MAIN_SHOP, SUPA } from '../lib.mjs';

const { ok, expectError, done } = reporter();
const db = await replica({ fixtures: true });
await migrate(db);

const A = MAIN_SHOP;                                  // admin of shop A (fixtures)
const B = 'd2d2d2d2-0000-4000-8000-000000000002';     // admin of shop B (fixtures)
const C = '5a5a5a5a-0000-4000-8000-00000000000c';     // cashier of shop A
const FRESH = '5a5a5a5a-0000-4000-8000-0000000000f1'; // just signed up, no profile yet
const FRESH2 = '5a5a5a5a-0000-4000-8000-0000000000f2';
const OLD = '5a5a5a5a-0000-4000-8000-0000000000d1';   // an account from last month, no profile
const SELF = '5a5a5a5a-0000-4000-8000-0000000000e1';  // a new owner signing up (SaaS)
const POD = 'prodPod0000000000001', MANGO = 'prodMango00000000003', GRAPE = 'prodGrape00000000004';
const B3 = 'botl0000000000000003', B4 = 'botl0000000000000004', ORPHAN = 'botl0000000000000008';

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const as = (uid, sql, p = []) => asUser(db, uid, sql, p);
const stock = async id => Number((await one(`select "stockQuantity" s from public.products where id = $1`, [id])).s);
const bottle = async id => one(`select "remainingMl"::float8 as ml, status, "archivedAt" from public.bottles where id = $1`, [id]);
const credit = async id => Number((await one(`select "creditBalance" c from public.customers where id = $1`, [id])).c);
const repairs = async (kind, ref) => (await one(`select count(*)::int n from private.repair_log where kind = $1 and ($2::text is null or "refId" = $2)`, [kind, ref ?? null])).n;
const sale = (id, extra = {}) => ({
  id, customerId: null, shopId: A, totalAmount: 1500, totalCOGS: 1000, totalProfit: 500, paymentMethod: 'cash',
  items: [{ productId: POD, productName: 'Pod X', quantity: 1, unitPrice: 1500, costPrice: 1000, totalPrice: 1500, saleType: 'regular', refillAmount: null }],
  createdBy: A, actorRole: 'admin', actorName: 'main-shop', splitAmounts: null,
  saleDate: '2026-10-11T09:15:00.000Z', saleDateClient: '2026-10-11T09:15:00.000Z',
  createdAt: '2026-10-11T09:15:00.000Z', updatedAt: '2026-10-11T09:15:00.000Z', ...extra,
});
const checkout = (uid, s, { prods = [{ id: POD, deduction: 1 }], bots = [], logs = [], cust = null, credit: cr = 0, shop = A } = {}) =>
  rpc(db, uid, 'process_checkout', { p_shop_id: shop, p_sale_data: s, p_inventory_logs: logs, p_bottle_updates: bots,
                                     p_product_updates: prods, p_customer_id: cust, p_credit_increment: cr })
    .then(r => r.rows[0].result);
const reverse = (uid, saleId, del = true, extra = {}) =>
  rpc(db, uid, 'process_reversal', { p_shop_id: A, p_sale_id: saleId, p_delete_sale: del, p_inventory_logs: null,
                                     p_bottle_updates: null, p_product_updates: null, p_customer_id: null, p_credit_decrement: 0, ...extra })
    .then(r => r.rows[0].result);

await db.exec(`
  insert into auth.users (id, email, created_at) values
    ('${C}', 'cashier@example.invalid', now() - interval '3 days'),
    ('${FRESH}', 'fresh@example.invalid', now() - interval '1 minute'),
    ('${FRESH2}', 'fresh2@example.invalid', now() - interval '1 minute'),
    ('${OLD}', 'old@example.invalid', now() - interval '30 days'),
    ('${SELF}', 'owner2@example.invalid', now());
  insert into public.profiles (id, username, role, "shopId") values ('${C}', 'Cashier One', 'cashier', '${A}');
`);

// ---------------------------------------------------------------------
// 1. Validation and ledger
// ---------------------------------------------------------------------
const followup = migrationFiles().find(m => m.version === '20261012100000');
const vrows = (await db.exec(read(followup.path))).filter(r => r.fields?.length).pop().rows;
ok('running the file again: every validation row is ok', vrows.length > 20 && vrows.every(r => r.ok === true),
  JSON.stringify(vrows.filter(r => !r.ok)));
ok('... including the real-user check (2 fixture profiles + the cashier)', /3 profile\(s\) checked/.test(vrows.find(r => r.check === 'real_user_check').detail));
ok('after the file, the session is the owner again (reset role)', (await one(`select current_user u`)).u === 'postgres');
ok('ledger has 20261011120000, 20261011140000 and 20261012100000',
  (await one(`select count(*)::int n from private.schema_migrations where version in ('20261011120000','20261011140000','20261012100000')`)).n === 3);
ok('app_config: schema_version 1, min_client_build null',
  JSON.stringify((await q(`select key, value from private.app_config order by key`)).map(r => [r.key, r.value])) === JSON.stringify([['min_client_build', null], ['schema_version', 1]]));
ok('snapshots taken before anything changed (old process_checkout returned void)',
  /returns void/i.test((await one(`select definition from private.function_snapshots where label = 'pre_20261012100000' and signature like 'public.process_checkout%'`)).definition));
ok('policy snapshot holds the old "Shop access" policies',
  (await one(`select count(*)::int n from private.policy_snapshots where label = 'pre_20261012100000' and policyname like 'Shop access%'`)).n >= 5);
await expectError('a later migration can require this one', () => db.query(`select private.require_migration(array['20261012100000','29990101000000'])`), /29990101000000/);
await db.exec('rollback').catch(() => {});

// ---------------------------------------------------------------------
// 2. Shop isolation and profiles
// ---------------------------------------------------------------------
for (const t of ['products', 'bottles', 'customers', 'sales', 'expenses', 'credits', 'inventory_logs', 'settings']) {
  const rows = (await as(B, `select "shopId" from public.${t}`)).rows;
  ok(`shop B sees only its own ${t}`, rows.every(r => r.shopId === B), JSON.stringify(rows.slice(0, 3)));
}
ok("shop B cannot update shop A's product (0 rows)", (await as(B, `update public.products set name = 'x' where id = $1 returning id`, [POD])).rows.length === 0);
await expectError("shop B cannot insert a product into shop A", () => as(B, `insert into public.products (id, "shopId", name) values ('bx', $1, 'x')`, [A]), /row-level security/);
ok("shop B cannot delete shop A's sale (0 rows)", (await as(B, `delete from public.sales where id = 'sale0000000000000001' returning id`)).rows.length === 0);
await expectError('a cashier cannot make herself admin', () => as(C, `update public.profiles set role = 'admin' where id = $1`, [C]), /permission denied/);
await expectError('a cashier cannot move to another shop', () => as(C, `update public.profiles set "shopId" = $2 where id = $1`, [C, B]), /permission denied/);
// The column grants stop it first; the trigger is the second wall (service role).
await expectError('the profile trigger also stops a role change by the API service role', () => asUser(db, A,
  `update public.profiles set role = 'cashier' where id = $1`, [A], { role: 'service_role' }), /cannot be changed/);

// first login (AuthContext.handleAuthChange): a new owner creates their own admin profile
await as(SELF, `insert into public.profiles (id, username, email, role, "shopId") values ($1, 'New Owner', 'owner2@example.invalid', 'admin', $1)`, [SELF]);
ok('first login: a new owner creates their own admin profile (SaaS self sign-up)', !!(await one(`select 1 x from public.profiles where id = $1 and role = 'admin'`, [SELF])));
// createCashier: the admin's session links a login created moments ago
await as(A, `insert into public.profiles (id, username, email, role, "shopId") values ($1, 'New Cashier', 'fresh@example.invalid', 'cashier', $2)`, [FRESH, A]);
ok('createCashier: the admin links a just-created login as cashier of her shop', (await one(`select "shopId" from public.profiles where id = $1`, [FRESH])).shopId === A);
await expectError('the admin cannot claim an existing (30-day-old) account', () => as(A,
  `insert into public.profiles (id, username, role, "shopId") values ($1, 'x', 'cashier', $2)`, [OLD, A]), /row-level security/);
await expectError('nobody can claim an account that already has a profile', () => as(A,
  `insert into public.profiles (id, username, role, "shopId") values ($1, 'x', 'cashier', $2)`, [SELF, A]), /row-level security|duplicate key/);
await expectError('a cashier cannot link cashiers', () => as(C,
  `insert into public.profiles (id, username, role, "shopId") values ($1, 'x', 'cashier', $2)`, [FRESH2, A]), /row-level security/);
await expectError('an admin cannot link a cashier to another shop', () => as(A,
  `insert into public.profiles (id, username, role, "shopId") values ($1, 'x', 'cashier', $2)`, [FRESH2, B]), /row-level security/);
await as(A, `update public.profiles set username = 'Renamed', email = 'c@example.invalid', "updatedAt" = now() where id = $1`, [C]);
ok('Settings: the admin edits a cashier name and email', (await one(`select username from public.profiles where id = $1`, [C])).username === 'Renamed');
await as(A, `update public.profiles set username = 'Owner', "updatedAt" = now() where id = $1`, [A]);
ok('Settings: the admin edits her own name', (await one(`select username from public.profiles where id = $1`, [A])).username === 'Owner');
await as(A, `delete from public.profiles where id = $1`, [FRESH]);
ok('deleteCashier: the profile is removed and a copy kept in private.deleted_rows',
  !(await one(`select 1 x from public.profiles where id = $1`, [FRESH]))
  && (await one(`select count(*)::int n from private.deleted_rows where "table" = 'profiles' and "rowId" = $1`, [FRESH])).n === 1);

// ---------------------------------------------------------------------
// 3. settings, personal_expenses, unused tables
// ---------------------------------------------------------------------
ok('settings: a cashier reads the shop settings (invoice branding)', (await as(C, `select "shopName" from public.settings`)).rows.length === 1);
await as(A, `insert into public.settings ("shopId", "shopName", "updatedAt") values ($1, 'Renamed Shop', now())
             on conflict ("shopId") do update set "shopName" = excluded."shopName", "updatedAt" = excluded."updatedAt"`, [A]);
ok('settings: the admin saves (upsert, as Settings.handleSave)', (await one(`select "shopName" from public.settings where "shopId" = $1`, [A])).shopName === 'Renamed Shop');
await as(A, `update public.settings set "lastBackupDate" = now()::text where "shopId" = $1`, [A]);
ok('settings: the backup stamps lastBackupDate', !!(await one(`select "lastBackupDate" from public.settings where "shopId" = $1`, [A])).lastBackupDate);
await expectError('settings: a cashier cannot save them', () => as(C,
  `insert into public.settings ("shopId", "shopName") values ($1, 'x') on conflict ("shopId") do update set "shopName" = excluded."shopName"`, [A]), /row-level security/);
await expectError('settings: nobody deletes them from the app', () => as(A, `delete from public.settings where "shopId" = $1`, [A]), /permission denied/);
await as(B, `insert into public.settings ("shopId", "shopName") values ($1, 'Shop B') on conflict ("shopId") do update set "shopName" = excluded."shopName"`, [B]);
ok('settings: shop B saves its own for the first time (insert)', (await one(`select "shopName" from public.settings where "shopId" = $1`, [B])).shopName === 'Shop B');

ok('personal_expenses: visible to the admin', (await as(A, `select id from public.personal_expenses`)).rows.length === 1);
ok('personal_expenses: invisible to the cashier', (await as(C, `select id from public.personal_expenses`)).rows.length === 0);
await as(A, `insert into public.personal_expenses (id, "shopId", category, amount) values ('pe2', $1, 'Home', 300)`, [A]);
await as(A, `update public.personal_expenses set amount = 350 where id = 'pe2'`);
await as(A, `delete from public.personal_expenses where id = 'pe2'`);
ok('personal_expenses: the admin adds, edits and deletes (a copy is kept)',
  !(await one(`select 1 x from public.personal_expenses where id = 'pe2'`))
  && (await one(`select count(*)::int n from private.deleted_rows where "table" = 'personal_expenses' and "rowId" = 'pe2'`)).n === 1);
await expectError('personal_expenses: a cashier cannot add one', () => as(C,
  `insert into public.personal_expenses (id, "shopId", amount) values ('pe3', $1, 1)`, [A]), /row-level security/);
for (const t of ['finance_accounts', 'finance_transactions', 'daily_summaries', 'stock_alerts']) {
  ok(`${t}: deny-all (the admin sees nothing)`, (await as(A, `select * from public.${t}`)).rows.length === 0);
  await expectError(`${t}: deny-all (the admin cannot add)`, () => as(A, `insert into public.${t} (id, "shopId") values ('z', $1)`, [A]), /row-level security/);
}

// ---------------------------------------------------------------------
// 4. Stock page, customers, expenses, credits, logs, alerts (deployed app)
// ---------------------------------------------------------------------
await as(A, `insert into public.products (id, name, category, "costPrice", "sellingPrice", "stockQuantity", "minStockLevel", unit, "bottleSize",
                                          "unitCostPerMl", "pricePerMl", brand, "shopId", "createdAt", "updatedAt")
             values ('newJuice', 'New Juice', 'e-liquid', 1500, 2000, 60, 60, 'bottle', '30', 50, 70, '', $1, now(), now())`, [A]);
await as(A, `insert into public.inventory_logs (id, "productId", "productName", "shopId", action, type, change, "quantityChange", "newStock", reason, notes, "createdBy", "actorRole", "actorName", "createdAt", "createdAtClient")
             values (gen_random_uuid()::text, 'newJuice', 'New Juice', $1, 'addition', 'addition', 60, 2, 60, 'Initial stock', 'Initial stock', '${A}', 'admin', 'main-shop', now(), now()::text)`, [A]);
await as(A, `insert into public.bottles ("productId", "shopId", "bottleSize", "remainingMl", status, "createdAt", "updatedAt")
             values ('newJuice', $1, 30, 30, 'closed', now(), now()), ('newJuice', $1, 30, 30, 'closed', now(), now())`, [A]);
ok('Stock: add product + log + bottles WITHOUT ids (old Stock page) now works (id default)',
  (await one(`select count(*)::int n from public.bottles where "productId" = 'newJuice' and id is not null`)).n === 2);
await as(A, `insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status) values (gen_random_uuid()::text, 'newJuice', $1, 30, 30, 'closed')`, [A]);
await as(A, `update public.products set name = 'New Juice 2', "stockQuantity" = 90, "updatedAt" = now(), "shopId" = $1 where id = 'newJuice'`, [A]);
const nb = (await as(A, `select id from public.bottles where "shopId" = $1 and "productId" = 'newJuice' order by "createdAt"`, [A])).rows;
await as(A, `update public.bottles set "remainingMl" = 20, status = 'opened', "openedDate" = now(), "updatedAt" = now() where id = $1`, [nb[0].id]);
ok('Stock: edit product, add a bottle, drain one (ProductModal), BottleModal lists 3 bottles',
  await stock('newJuice') === 90 && nb.length === 3 && (await bottle(nb[0].id)).ml === 20);
await expectError('Stock: a negative stock save is refused (owner rule, CHECK)', () => as(A, `update public.products set "stockQuantity" = -1 where id = 'newJuice'`), /products_stock_not_negative/);
// bulk import (Stock.handleBulkUpload): update an existing product, insert new ones with bottles
await as(A, `update public.products set "costPrice" = 1400, "unitCostPerMl" = 46.67, "stockQuantity" = 120, "updatedAt" = now() where id = 'newJuice'`);
await as(A, `insert into public.products (id, name, category, "costPrice", "sellingPrice", "stockQuantity", "minStockLevel", "lowStockAlert", unit, brand, "shopId", "createdAt", "createdAtClient", "updatedAt")
             values ('imp1', 'Imported Pod', 'device', 900, 1170, 4, 2, 2, 'piece', '', $1, now(), now()::text, now())`, [A]);
await as(A, `insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status, "createdAt", "updatedAt")
             select gen_random_uuid()::text, 'newJuice', $1, 30, 30, 'closed', now(), now() from generate_series(1, 2)`, [A]);
ok('Stock: bulk import (update + insert products, insert bottle rows)', await stock('newJuice') === 120 && await stock('imp1') === 4);
// single product delete (Stock.handleConfirmDelete): log without id, then products.delete()
await as(A, `insert into public.inventory_logs ("productId", "productName", "shopId", action, type, change, "quantityChange", "newStock", reason, notes, "createdBy", "actorRole", "actorName", "createdAt", "createdAtClient")
             values ('imp1', 'Imported Pod', $1, 'deduction', 'deduction', -4, -4, 0, 'Product Deletion', 'old stock', '${A}', 'admin', 'main-shop', now(), now()::text)`, [A]);
const del = await as(A, `delete from public.products where id = 'imp1'`);
const imp1 = await one(`select "deletedAt", "deletedBy" from public.products where id = 'imp1'`);
ok('Stock: deleting a product ARCHIVES it (row kept, deletedAt and deletedBy set, no error)', del.affectedRows === 0 && !!imp1?.deletedAt && imp1.deletedBy === A);
ok('Stock: the archived product is hidden from the app', (await as(A, `select id from public.products where id = 'imp1'`)).rows.length === 0);
ok('Stock: the delete log (no id sent) was saved', (await one(`select count(*)::int n from public.inventory_logs where "productId" = 'imp1' and reason = 'Product Deletion'`)).n === 1);
ok('Stock: deleting it again affects nothing', (await as(A, `delete from public.products where id = 'imp1' returning id`)).rows.length === 0);
// bulk delete (Stock.handleBulkDelete): up to 25 rows in one request works
await db.exec(`insert into public.products (id, "shopId", name, category, "stockQuantity") select 'bulk' || g, '${A}', 'Bulk ' || g, 'device', 1 from generate_series(1, 55) g`);
await as(A, `delete from public.products where id = any($1)`, [Array.from({ length: 25 }, (_, i) => `bulk${i + 1}`)]);
ok('Stock: a bulk delete of 25 products works (all archived)', (await one(`select count(*)::int n from public.products where id like 'bulk%' and "deletedAt" is not null`)).n === 25);
await expectError('Stock: a bulk delete of 30 in one request is blocked (mass_delete_blocked)', () =>
  as(A, `delete from public.products where id = any($1)`, [Array.from({ length: 30 }, (_, i) => `bulk${i + 26}`)]), /mass_delete_blocked/);
ok('... and nothing of those 30 was archived', (await one(`select count(*)::int n from public.products where id like 'bulk%' and "deletedAt" is null`)).n === 30);
const sqlstate = await as(A, `delete from public.products where id = any($1)`, [Array.from({ length: 30 }, (_, i) => `bulk${i + 26}`)]).catch(e => e.code);
ok('... its error code is PT422 (PostgREST answers HTTP 422)', sqlstate === 'PT422', String(sqlstate));
const bArch = await as(A, `delete from public.bottles where id = $1`, [nb[2].id]);
ok('Stock: deleting a bottle archives it (hidden, archivedAt set)', bArch.affectedRows === 0 && !!(await bottle(nb[2].id)).archivedAt
  && (await as(A, `select id from public.bottles where id = $1`, [nb[2].id])).rows.length === 0);
const fromB = await asUser(db, A, `delete from public.products where "shopId" = $1 returning id`, [B]);
ok("Stock: shop A's bulk delete never touches shop B", fromB.rows.length === 0 && await stock('prodShop2Item0000001') === 30);

// customers (CustomerModal, Customers page)
await as(A, `insert into public.customers (id, name, phone, email, "creditBalance", "shopId", "createdAt") values ('custNew', 'New Buyer', '0300-0000000', null, 0, $1, now())`, [A]);
await as(A, `update public.customers set name = 'New Buyer 2', phone = '0300-0000001', "creditBalance" = 0, "shopId" = $1 where id = 'custNew'`, [A]);
await as(A, `delete from public.customers where id = 'custNew'`);
ok('customers: add, edit, delete (archived, hidden)', !!(await one(`select "deletedAt" from public.customers where id = 'custNew'`)).deletedAt
  && (await as(A, `select id from public.customers where id = 'custNew'`)).rows.length === 0);
await as(A, `delete from public.customers where id = any($1)`, [['cust0000000000000004', 'cust0000000000000005']]);
ok('customers: bulk delete (Customers.handleBulkDelete) archives both', (await one(`select count(*)::int n from public.customers where id in ('cust0000000000000004','cust0000000000000005') and "deletedAt" is not null`)).n === 2);

// udhaar (AddCreditModal): credits insert, then customers update
const c2 = await credit('cust0000000000000002');
await as(A, `insert into public.credits (id, "creditType", "customerId", "entityName", description, "transactionType", amount, "shopId", "createdBy", "actorRole", "actorName", "createdAt")
             values (gen_random_uuid()::text, 'customer', 'cust0000000000000002', null, '', 'taken', 40, $1, '${A}', 'admin', 'main-shop', now())`, [A]);
await as(A, `update public.customers set "creditBalance" = $2 where id = 'cust0000000000000002' and "shopId" = $1`, [A, c2 - 40]);
ok('udhaar: AddCreditModal records a payment and updates the balance', await credit('cust0000000000000002') === c2 - 40);
await expectError('credits are append-only: an update from the app is refused loudly', () => as(A, `update public.credits set amount = 1 where id = 'cred0000000000000001'`), /permission denied/);
await expectError('credits are append-only: a delete from the app is refused loudly', () => as(A, `delete from public.credits where id = 'cred0000000000000001'`), /permission denied/);
await expectError('inventory_logs are append-only: an update from the app is refused', () => as(A, `update public.inventory_logs set reason = 'x'`), /permission denied/);
await expectError('inventory_logs are append-only: a delete from the app is refused', () => as(A, `delete from public.inventory_logs`), /permission denied/);
await expectError('append-only also stops the API service role (trigger)', () => asUser(db, A, `delete from public.credits where id = 'cred0000000000000007'`, [], { role: 'service_role' }), /append-only/);

// expenses (Expenses page)
await as(A, `insert into public.expenses (id, category, description, amount, "shopId", "expenseDate", "createdAtClient", "createdBy", "actorRole", "actorName", "createdAt")
             values ('exNew', 'Tea', 'tea', 100, $1, now(), now()::text, '${A}', 'admin', 'main-shop', now())`, [A]);
await as(A, `update public.expenses set category = 'Tea', amount = 120, "shopId" = $1, "expenseDate" = now(), "createdAtClient" = now()::text, "updatedAt" = now() where id = 'exNew'`, [A]);
await as(A, `delete from public.expenses where id = 'exNew'`);
ok('expenses: add, edit, delete (a copy is kept)', !(await one(`select 1 x from public.expenses where id = 'exNew'`))
  && (await one(`select (row->>'amount')::int a from private.deleted_rows where "table" = 'expenses' and "rowId" = 'exNew'`)).a === 120);
await db.exec(`insert into public.expenses (id, "shopId", amount) select 'exb' || g, '${A}', 1 from generate_series(1, 26) g`);
await expectError('expenses: a 26-row bulk delete in one request is blocked', () => as(A, `delete from public.expenses where id like 'exb%'`), /mass_delete_blocked/);
await as(A, `delete from public.expenses where id = any($1)`, [Array.from({ length: 25 }, (_, i) => `exb${i + 1}`)]);
ok('expenses: a 25-row bulk delete works', (await one(`select count(*)::int n from public.expenses where id like 'exb%'`)).n === 1);

// Stock page shortfall alerts: read unresolved, mark recounted
await db.exec(`insert into public.inventory_alerts (shop_id, product_id, product_name, message) values ('${A}', '${POD}', 'Pod X', 'Shortfall: test'), ('${B}', 'prodShop2Item0000001', 'Shop2 Juice', 'Shortfall: other shop')`);
const alerts = (await as(A, `select id, product_name, message, created_at from public.inventory_alerts where shop_id = $1 and resolved = false order by created_at desc limit 20`, [A])).rows;
ok('alerts: the Stock page reads its unresolved shortfall alerts (and not shop B\'s)', alerts.length === 1);
await as(A, `update public.inventory_alerts set resolved = true, resolved_at = now() where id = $1`, [alerts[0].id]);
ok('alerts: "Mark recounted" works', (await one(`select resolved from public.inventory_alerts where id = $1`, [alerts[0].id])).resolved === true);
await expectError('alerts: the app still cannot create alerts', () => as(A, `insert into public.inventory_alerts (shop_id, product_id, product_name, message) values ($1, 'x', 'x', 'x')`, [A]), /permission denied/);

// backup (lib/backup.ts) reads every shop table, personal_expenses included
for (const t of ['products', 'bottles', 'customers', 'sales', 'expenses', 'personal_expenses', 'inventory_logs', 'credits', 'settings']) {
  const r = await as(A, `select count(*)::int n from public.${t} where "shopId" = $1`, [A]);
  ok(`backup: the admin can read ${t}`, r.rows[0].n > 0);
}

// ---------------------------------------------------------------------
// 5. process_checkout: owner rules, replay, telemetry, dates, credit, logs
// ---------------------------------------------------------------------
const FS = 'Fs7x9QkLmN2pR4tV6wYz';   // a 20-character Firestore-style sale id
let pod = await stock(POD);
let r = await checkout(A, sale(FS, { clientBuild: 'build-abc', deviceId: 'dev-1' }),
  { logs: [{ id: 'logFs1', productId: POD, productName: 'Pod X', action: 'sale', type: 'sale', change: -1, quantityChange: -1, newStock: 999, shopId: B }], credit: 5000 });
ok('checkout returns {status: applied, saleId}', r.status === 'applied' && r.saleId === FS, JSON.stringify(r));
ok('Firestore-style sale id: stored, stock deducted by 1', !!(await one(`select 1 x from public.sales where id = $1`, [FS])) && await stock(POD) === pod - 1);
const lf = await one(`select "shopId", "createdBy", "actorName", "actorRole", "previousStock"::float8 p, "newStock"::float8 n, "refId" from public.inventory_logs where id = 'logFs1'`);
ok('its log is stamped by the server: own shop, real user, profile name, stock before/after, refId = sale id',
  lf.shopId === A && lf.createdBy === A && lf.actorName === 'Owner' && lf.actorRole === 'admin' && lf.p === pod && lf.n === pod - 1 && lf.refId === FS, JSON.stringify(lf));
ok('p_credit_increment is ignored: a cash sale adds no udhaar (sent 5000)', (await repairs('credit_increment_ignored', FS)) === 1);
const tel = await one(`select "clientBuild", "deviceId", calls from private.legacy_rpc_calls where fn = 'process_checkout' and "clientBuild" = 'build-abc'`);
ok('telemetry: the call is counted with the payload build and device', tel && tel.deviceId === 'dev-1' && tel.calls === 1, JSON.stringify(tel));
r = await checkout(A, sale(FS, { clientBuild: 'build-abc', deviceId: 'dev-1' }));
ok('the same checkout replayed: returns duplicate and changes nothing', r.status === 'duplicate' && await stock(POD) === pod - 1);
ok('... and both calls were counted', (await one(`select calls from private.legacy_rpc_calls where fn = 'process_checkout' and "clientBuild" = 'build-abc'`)).calls === 2);
await db.transaction(async tx => {
  await tx.exec(`set local role authenticated`);
  await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`,
    [JSON.stringify({ sub: A, role: 'authenticated' }), JSON.stringify({ 'x-client-build': 'hdr-build-7' })]);
  await tx.query(`select public.process_checkout($1, $2::jsonb, '[]', '[]', '[]')`, [A, JSON.stringify(sale('hdrSale', { items: [] }))]);
});
ok('telemetry: an x-client-build header wins over the payload', !!(await one(`select 1 x from private.legacy_rpc_calls where "clientBuild" = 'hdr-build-7'`)));
r = await checkout(A, sale('noBuild', { items: [] }), { prods: [] });
ok("telemetry: no header and no payload build -> 'unknown'", !!(await one(`select 1 x from private.legacy_rpc_calls where "clientBuild" = 'unknown' and "deviceId" = 'unknown'`)));

await expectError('a foreign shop id gets 42501', () => checkout(B, sale('foreign1'), { shop: A }), /Unauthorized/);
const e42501 = await checkout(B, sale('foreign2'), { shop: A }).catch(e => e.code);
ok('... with SQLSTATE 42501', e42501 === '42501', String(e42501));

pod = await stock(POD);
r = await checkout(A, sale('missingProd', { items: [{ productId: 'prodGone000000000099', productName: 'Gone', quantity: 1, saleType: 'regular' }] }),
  { prods: [{ id: 'prodGone000000000099', deduction: 1 }], logs: [{ id: 'logGone', productId: 'prodGone000000000099', action: 'sale' }],
    bots: [{ id: ORPHAN, productId: 'prodGone000000000099', remainingMl: 1, status: 'opened' }] });
ok('a checkout naming a missing product stores the sale', r.status === 'applied' && !!(await one(`select 1 x from public.sales where id = 'missingProd'`)));
ok('... and records it in repair_log, skipping its log and its (orphan) bottle',
  (await repairs('missing_product', 'prodGone000000000099')) === 1 && (await repairs('bottle_skipped_missing_product', ORPHAN)) === 1
  && !(await one(`select 1 x from public.inventory_logs where id = 'logGone'`)) && (await bottle(ORPHAN)).ml === 10);
r = await checkout(A, sale('otherShopProd'), { prods: [{ id: 'prodShop2Item0000001', deduction: 1 }] });
ok("a product of another shop is never deducted (treated as missing)", await stock('prodShop2Item0000001') === 30 && (await repairs('missing_product', 'prodShop2Item0000001')) === 1);

// owner rules
await db.exec(`update public.products set "stockQuantity" = 2 where id = '${POD}'`);
r = await checkout(A, sale('short1', { items: [{ productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 3 }] }), { prods: [{ id: POD, deduction: 3 }] });
ok('a short sale is KEPT, stock stops at 0 (never below)', r.status === 'applied' && await stock(POD) === 0);
const sf = await one(`select reason, "refId" from public.inventory_logs where action = 'shortfall' and "refId" = 'short1'`);
ok('... a shortfall log (with refId) and an alert are written', !!sf && /sold 3 pcs but only 2 pcs was in stock/.test(sf.reason)
  && (await one(`select count(*)::int n from public.inventory_alerts where product_id = $1 and resolved = false`, [POD])).n === 1);
await expectError('refill of 2.3 ml refused', () => checkout(A, sale('ref23', { items: [{ productId: MANGO, productName: 'Mango Ice', saleType: 'refill', refillAmount: 2.3, quantity: 1 }] }), { prods: [{ id: MANGO, deduction: 2.3 }] }), /0\.5 ml steps/);
await expectError('quantity 1.5 refused', () => checkout(A, sale('q15', { items: [{ productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 1.5 }] }), { prods: [] }), /whole number/);
await expectError('quantity 0 refused', () => checkout(A, sale('q0', { items: [{ productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 0 }] }), { prods: [] }), /whole number/);
await expectError('NaN quantity refused', () => checkout(A, sale('qnan', { items: [{ productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 'NaN' }] }), { prods: [] }), /whole number/);
await expectError('Infinity refill refused', () => checkout(A, sale('rinf', { items: [{ productId: MANGO, productName: 'Mango', saleType: 'refill', refillAmount: 'Infinity', quantity: 1 }] }), { prods: [] }), /0\.5 ml steps/);
await expectError('absurd quantity (100000) refused', () => checkout(A, sale('qbig', { items: [{ productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 100000 }] }), { prods: [] }), /whole number/);
await expectError('negative deduction refused', () => checkout(A, sale('dneg'), { prods: [{ id: POD, deduction: -5 }] }), /Invalid stock deduction/);
await expectError('NaN deduction refused', () => checkout(A, sale('dnan'), { prods: [{ id: POD, deduction: 'NaN' }] }), /Invalid stock deduction/);
await expectError('absurd deduction refused', () => checkout(A, sale('dbig'), { prods: [{ id: POD, deduction: 1e7 }] }), /Invalid stock deduction/);
ok('refused sales left nothing behind', (await one(`select count(*)::int n from public.sales where id in ('ref23','q15','q0','qnan','rinf','qbig','dneg','dnan','dbig')`)).n === 0);
ok('the CHECK rules are still in place', (await one(`select count(*)::int n from pg_constraint where conname in ('products_stock_not_negative','bottles_remaining_not_negative') and convalidated`)).n === 2);
ok('checkout locks the products it touches in id order before changing them',
  /order by p\.id\s+for update/.test((await one(`select prosrc from pg_proc where proname = 'process_checkout'`)).prosrc));

// dates
r = await checkout(A, sale('future1', { items: [], saleDate: '2099-01-01T00:00:00.000Z', saleDateClient: '2099-01-01T00:00:00.000Z' }), { prods: [] });
const fut = await one(`select "saleDate", "saleDateClient" from public.sales where id = 'future1'`);
ok('a sale date more than 10 minutes ahead is clamped to now and logged', new Date(fut.saleDate).getFullYear() < 2099 && fut.saleDateClient === '2099-01-01T00:00:00.000Z' && (await repairs('future_sale_date_clamped', 'future1')) === 1);
r = await checkout(A, sale('past1', { items: [], saleDate: '2025-01-02T03:04:05.000Z' }), { prods: [] });
ok('a past sale date is never rewritten', new Date((await one(`select "saleDate" from public.sales where id = 'past1'`)).saleDate).toISOString() === '2025-01-02T03:04:05.000Z');
r = await checkout(A, sale('fsDate', { items: [], saleDate: null, saleDateClient: '{"_seconds":1790830800,"_nanoseconds":0}' }), { prods: [] });
const fsd = await one(`select "saleDate", "saleDateClient" from public.sales where id = 'fsDate'`);
ok('no saleDate: parsed from a Firestore-JSON saleDateClient, which is stored verbatim',
  new Date(fsd.saleDate).getTime() === 1790830800000 && fsd.saleDateClient === '{"_seconds":1790830800,"_nanoseconds":0}');

// derived udhaar
const cust1 = 'cust0000000000000001';
let cb = await credit(cust1);
await checkout(A, sale('cred1', { customerId: cust1, paymentMethod: 'credit', totalAmount: 700, items: [] }), { prods: [], cust: cust1, credit: 0 });
ok("udhaar comes from the payment: 'credit' adds the total even when p_credit_increment is 0", await credit(cust1) === cb + 700);
cb = await credit(cust1);
await checkout(A, sale('split1', { customerId: cust1, paymentMethod: 'split', totalAmount: 1000, splitAmounts: { cash: 0, online: 0, credit: 5000 }, items: [] }), { prods: [], cust: cust1, credit: 5000 });
ok("'split' adds its credit part, capped at the total (5000 -> 1000)", await credit(cust1) === cb + 1000);
await checkout(A, sale('credMissing', { customerId: 'custMissing000000098', paymentMethod: 'credit', totalAmount: 50, items: [] }), { prods: [] });
ok('udhaar for a missing customer: sale kept, recorded in repair_log', !!(await one(`select 1 x from public.sales where id = 'credMissing'`)) && (await repairs('missing_customer', 'custMissing000000098')) >= 1);

// ---------------------------------------------------------------------
// 6. process_reversal from the stored sale
// ---------------------------------------------------------------------
await db.exec(`update public.products set "stockQuantity" = 75 where id = '${MANGO}'; update public.bottles set "remainingMl" = 15, status = 'opened' where id = '${B3}'`);
const REF = 'refillSale0000000001';
await checkout(A, sale(REF, { customerId: cust1, paymentMethod: 'split', totalAmount: 210, splitAmounts: { cash: 10, online: 0, credit: 200 },
  items: [{ productId: MANGO, productName: 'Mango Ice', quantity: 2, unitPrice: 105, saleType: 'refill', refillAmount: 1.5, bottleSize: 30,
            bottleChanges: [{ bottleId: B3, beforeRemainingMl: 15, afterRemainingMl: 12, beforeStatus: 'opened', afterStatus: 'opened' }] }] }),
  { prods: [{ id: MANGO, deduction: 3 }], bots: [{ id: B3, productId: MANGO, bottleSize: 30, remainingMl: 12, status: 'opened' }], cust: cust1 });
cb = await credit(cust1);
ok('refill sale: Mango 75 -> 72, bottle 15 -> 12', await stock(MANGO) === 72 && (await bottle(B3)).ml === 12);
// a refill from the same bottle AFTER the sale (another sale): 12 -> 10
await db.exec(`update public.bottles set "remainingMl" = 10 where id = '${B3}'`);
await expectError('reversal: a cashier is refused (admin only)', () => reverse(C, REF), /Only the shop admin/);
await expectError('reversal: another shop is refused', () => rpc(db, B, 'process_reversal', { p_shop_id: A, p_sale_id: REF, p_delete_sale: true, p_inventory_logs: null, p_bottle_updates: null, p_product_updates: null, p_customer_id: null, p_credit_decrement: 0 }), /Unauthorized/);
r = await reverse(A, REF, true, { p_product_updates: [{ productId: MANGO, addition: -50 }], p_bottle_updates: [{ bottleId: B3, remainingMl: 30, status: 'closed' }], p_credit_decrement: 99999 });
ok('reversal returns {status: applied}', r.status === 'applied' && r.saleId === REF, JSON.stringify(r));
ok('reversal restores e-liquid stock in ml from the stored sale (1.5 ml x 2 = 3: 72 -> 75), client arrays ignored', await stock(MANGO) === 75);
ok('reversal restores the bottle by delta (+3), keeping the later refill (10 -> 13, not back to 15)', (await bottle(B3)).ml === 13 && (await bottle(B3)).status === 'opened');
ok('reversal restores udhaar from the stored split payment (200), not p_credit_decrement', await credit(cust1) === cb - 200);
ok('reversal deleted the sale and kept a copy in private.deleted_rows', !(await one(`select 1 x from public.sales where id = $1`, [REF]))
  && (await one(`select count(*)::int n from private.deleted_rows where "table" = 'sales' and "rowId" = $1`, [REF])).n === 1);
const rl = await one(`select "previousStock"::float8 p, "newStock"::float8 n, "mlChange"::float8 ml, "createdBy", type from public.inventory_logs where "refId" = $1 and type = 'return'`, [REF]);
ok('reversal writes its own return log (refId, before/after, ml, real user)', rl && rl.p === 72 && rl.n === 75 && rl.ml === 3 && rl.createdBy === A, JSON.stringify(rl));
r = await reverse(A, REF);
ok('reversing twice restores once (second call: duplicate)', r.status === 'duplicate' && await stock(MANGO) === 75 && (await bottle(B3)).ml === 13 && await credit(cust1) === cb - 200);

// full bottle + regular + orphan bottle + missing product, in one sale
await db.exec(`update public.bottles set "remainingMl" = 30, status = 'closed' where id = '${B4}'`);
const g0 = await stock(GRAPE), p0 = await stock(POD) + 5;
await db.exec(`update public.products set "stockQuantity" = ${p0} where id = '${POD}'`);
const MIX = 'mixSale0000000000001';
await checkout(A, sale(MIX, { paymentMethod: 'credit', customerId: 'cust0000000000000003', totalAmount: 3300,
  items: [
    { productId: GRAPE, productName: 'Grape', quantity: 1, saleType: 'full_bottle', bottleSize: 30,
      bottleChanges: [{ bottleId: B4, beforeRemainingMl: 30, afterRemainingMl: 0, beforeStatus: 'closed', afterStatus: 'sold' }] },
    { productId: POD, productName: 'Pod X', quantity: 2, saleType: 'regular' },
    { productId: 'prodGone000000000099', productName: 'Gone', quantity: 1, saleType: 'refill', refillAmount: 2, bottleSize: 30,
      bottleChanges: [{ bottleId: ORPHAN, beforeRemainingMl: 10, afterRemainingMl: 8, beforeStatus: 'opened', afterStatus: 'opened' }] },
  ] }),
  { prods: [{ id: GRAPE, deduction: 30 }, { id: POD, deduction: 2 }, { id: 'prodGone000000000099', deduction: 2 }],
    bots: [{ id: B4, productId: GRAPE, bottleSize: 30, remainingMl: 0, status: 'sold' }], cust: 'cust0000000000000003' });
await db.exec(`update public.bottles set "remainingMl" = 8 where id = '${ORPHAN}'`);  // the orphan was drained on the device
ok('mixed sale applied: Grape -30, Pod -2, bottle 4 sold', await stock(GRAPE) === g0 - 30 && await stock(POD) === p0 - 2 && (await bottle(B4)).status === 'sold');
const c3 = await credit('cust0000000000000003');
r = await reverse(A, MIX, false);    // NewSale edit flow: p_delete_sale = false
ok('edit flow step 1: reversal deletes the stored sale even with p_delete_sale = false', r.status === 'applied' && !(await one(`select 1 x from public.sales where id = $1`, [MIX])));
ok('full bottle restores bottle size x quantity (+30 ml) and the bottle goes back to closed and full',
  await stock(GRAPE) === g0 && (await bottle(B4)).ml === 30 && (await bottle(B4)).status === 'closed');
ok('a regular line restores its quantity (+2)', await stock(POD) === p0);
ok('the orphan bottle (product gone) is restored by delta without error (8 -> 10)', (await bottle(ORPHAN)).ml === 10);
ok('the missing product line is recorded, the other lines still restored', (await one(`select count(*)::int n from private.repair_log where kind = 'missing_product' and "refId" = 'prodGone000000000099' and detail->>'from' = 'reversal'`)).n === 1);
ok("udhaar of a 'credit' sale comes back (3300)", await credit('cust0000000000000003') === c3 - 3300);
const del2 = await as(A, `delete from public.sales where id = $1`, [MIX]);
ok('edit flow step 2: the direct sales delete now affects 0 rows, without error', del2.affectedRows === 0);
r = await checkout(A, sale(MIX, { items: [{ productId: POD, productName: 'Pod X', quantity: 1, saleType: 'regular' }] }), { prods: [{ id: POD, deduction: 1 }] });
ok('edit flow step 3: the same sale id checks out again', r.status === 'applied' && await stock(POD) === p0 - 1);

// a bottle that already holds more than its size (fixture: 45 ml in a 30 ml
// bottle) is capped but never LOWERED by a restore
const OVER = 'botl0000000000000006';
await db.exec(`insert into public.sales (id, "shopId", "totalAmount", items) values ('overSale', '${A}', 0,
  '[{"productId":"prodMint000000000005","quantity":1,"saleType":"refill","refillAmount":1,"bottleSize":30,
     "bottleChanges":[{"bottleId":"${OVER}","beforeRemainingMl":46,"afterRemainingMl":45,"beforeStatus":"opened","afterStatus":"opened"}]}]')`);
await reverse(A, 'overSale');
ok('a restore never lowers a bottle that already holds more than its size (45 stays 45)', (await bottle(OVER)).ml === 45);

// an old Firestore sale: no productId, refillMl, odd spellings; and a junk line
const fsOld = await reverse(A, 'sale0000000000000003');
ok('an old Firestore sale (no productId, "Refill ", refillMl) deletes cleanly; its credit comes back',
  fsOld.status === 'applied' && (await repairs('restore_line_without_product', 'sale0000000000000003')) === 1);
ok('a sale with a junk line deletes cleanly', (await reverse(A, 'sale0000000000000008')).status === 'applied');
await db.exec(`insert into public.sales (id, "shopId", "totalAmount", items) values ('negLine', '${A}', 0, '[{"productId":"${POD}","quantity":-4,"saleType":"regular"}]')`);
const podBefore = await stock(POD);
await reverse(A, 'negLine');
ok('a stored negative quantity is never restored (stock not reduced), recorded as "Invalid stock restore amount"',
  await stock(POD) === podBefore && (await one(`select detail->>'message' m from private.repair_log where kind = 'invalid_restore_amount' and detail->>'saleId' = 'negLine'`)).m.startsWith('Invalid stock restore amount'));

// the deployed Sales page remove-item path (direct writes)
await checkout(A, sale('twoItems', { paymentMethod: 'cash', items: [
  { productId: POD, productName: 'Pod X', quantity: 1, saleType: 'regular', totalPrice: 1500, totalCost: 1000, profit: 500 },
  { productId: 'prodPod0000000000002', productName: 'pod x', quantity: 1, saleType: 'regular', totalPrice: 1500, totalCost: 1000, profit: 500 }] }),
  { prods: [{ id: POD, deduction: 1 }, { id: 'prodPod0000000000002', deduction: 1 }] });
const pod2 = await stock('prodPod0000000000002');
await as(A, `update public.products set "stockQuantity" = $2 where id = $1`, ['prodPod0000000000002', pod2 + 1]);
await as(A, `insert into public.inventory_logs (id, "productId", "productName", "shopId", action, type, change, "quantityChange", reason, notes, "createdAt", "createdAtClient")
             values (gen_random_uuid()::text, 'prodPod0000000000002', 'pod x', $1, 'return', 'return', 1, 1, 'Item removed from sale: TWOITE', 'Inventory restored', now(), now()::text)`, [A]);
await as(A, `update public.sales set items = $2::jsonb, "totalAmount" = 1500, "totalCOGS" = 1000, "totalProfit" = 500, "updatedAt" = now() where id = $1`,
  ['twoItems', JSON.stringify([{ productId: POD, productName: 'Pod X', quantity: 1, saleType: 'regular' }])]);
ok('Sales remove-item (direct product, log and sale updates) still works', await stock('prodPod0000000000002') === pod2 + 1
  && Number((await one(`select "totalAmount" t from public.sales where id = 'twoItems'`)).t) === 1500);
await as(A, `update public.bottles set "remainingMl" = 30, status = 'closed', "openedDate" = null, "updatedAt" = now() where id = $1`, [B4]);
await as(A, `update public.customers set "creditBalance" = "creditBalance" - 1 where id = $1`, [cust1]);
ok('Sales remove-item: direct bottle and customer updates still work', (await bottle(B4)).ml === 30);

// ---------------------------------------------------------------------
// 6b. Review fixes: a short sale then edited, 'Refill' spelling, text
//     bottle sizes, cashier membership, sales lost by the deployed Edit
// ---------------------------------------------------------------------
// The reviewer's case: stock 2, an offline sale of 5 arrives (2 taken off,
// stock 0), then the admin edits it to 1. Right answer: stock 1.
await db.exec(`update public.products set "stockQuantity" = 2 where id = '${POD}';
               update public.inventory_alerts set resolved = true, resolved_at = now() where product_id = '${POD}'`);
const SHORT = 'shortEdit00000000001';
r = await checkout(A, sale(SHORT, { items: [{ productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 5 }] }), { prods: [{ id: POD, deduction: 5 }] });
ok('short sale then edit: the sale (5 sold, 2 in stock) is kept, stock 0, the 3 not taken off are noted',
  r.status === 'applied' && await stock(POD) === 0
  && Number((await one(`select sum(requested - applied) m from private.sale_shortfalls where "saleId" = $1`, [SHORT])).m) === 3);
r = await reverse(A, SHORT, false);
ok('... edit step 1: the reversal puts back only the 2 really taken off (stock 2, not 5)', r.status === 'applied' && await stock(POD) === 2);
ok('... the 3 not put back are recorded and the notes are used up',
  (await one(`select (detail->>'notRestored')::int n from private.repair_log where kind = 'shortfall_not_restored' and detail->>'saleId' = $1`, [SHORT])).n === 3
  && (await one(`select count(*)::int n from private.sale_shortfalls where "saleId" = $1`, [SHORT])).n === 0);
ok("... the sale's own recount alert is still open, and no second alert is added",
  JSON.stringify((await q(`select message from public.inventory_alerts where product_id = $1 and coalesce(resolved, false) = false`, [POD])).map(a => /^Shortfall: sold 5 pcs/.test(a.message))) === '[true]');
ok('... its return log says what was not put back', /3 not put back/.test((await one(`select notes from public.inventory_logs where "refId" = $1 and type = 'return'`, [SHORT])).notes));
await as(A, `delete from public.sales where id = $1`, [SHORT]);
r = await checkout(A, sale(SHORT, { items: [{ productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 1 }] }), { prods: [{ id: POD, deduction: 1 }] });
ok("... edit step 3: changed to 1, stock ends at 1 (before this fix: 4)", r.status === 'applied' && await stock(POD) === 1);
r = await reverse(A, SHORT);
ok('... deleting the edited sale later puts back its full 1 (no stale shortfall note)', r.status === 'applied' && await stock(POD) === 2);
// two lines of one product, both short: 3 + 3 sold with 2 in stock -> 4 never taken off
await db.exec(`update public.products set "stockQuantity" = 2 where id = '${POD}'`);
await checkout(A, sale('shortTwice', { items: [{ productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 3 },
                                                { productId: POD, productName: 'Pod X', saleType: 'regular', quantity: 3 }] }),
  { prods: [{ id: POD, deduction: 3 }, { id: POD, deduction: 3 }] });
await as(A, `update public.inventory_alerts set resolved = true, resolved_at = now() where shop_id = $1 and product_id = $2`, [A, POD]);  // "Mark recounted"
await reverse(A, 'shortTwice');
ok('a sale short on two lines of one product puts back exactly what it took (2)', await stock(POD) === 2);
ok('... and, its alerts already marked recounted, a new recount alert says 4 were not put back',
  (await one(`select count(*)::int n from public.inventory_alerts where product_id = $1 and coalesce(resolved, false) = false and message like '%4 pcs not put back%'`, [POD])).n === 1);
// a short sale with a stale note: an earlier sale under the same id was removed without a reversal
await db.exec(`insert into private.sale_shortfalls ("shopId", "saleId", "productId", requested, applied) values ('${A}', 'staleNote', '${POD}', 9, 0)`);
await checkout(A, sale('staleNote'), { prods: [{ id: POD, deduction: 1 }] });
await reverse(A, 'staleNote');
ok("a new sale under an old id ignores the old sale's shortfall notes (full 1 back)", await stock(POD) === 2);

// 'Refill' / ' refill ' get the 0.5 ml rule too (the reversal reads them as refills)
const mango0 = await stock(MANGO);
await expectError("a refill spelled 'Refill' with 2.3 ml is refused", () => checkout(A, sale('refCap', { items: [{ productId: MANGO, productName: 'Mango Ice', saleType: 'Refill', refillAmount: 2.3, quantity: 1 }] }), { prods: [{ id: MANGO, deduction: 2.3 }] }), /0\.5 ml steps/);
await expectError("... and ' refill ' with 2.3 ml", () => checkout(A, sale('refSp', { items: [{ productId: MANGO, productName: 'Mango Ice', saleType: ' refill ', refillAmount: 2.3, quantity: 1 }] }), { prods: [{ id: MANGO, deduction: 2.3 }] }), /0\.5 ml steps/);
ok('... nothing saved, stock unchanged', await stock(MANGO) === mango0 && !(await one(`select 1 x from public.sales where id in ('refCap', 'refSp')`)));
r = await checkout(A, sale('refCapOk', { items: [{ productId: MANGO, productName: 'Mango Ice', saleType: 'Refill', refillAmount: 1.5, quantity: 1 }] }), { prods: [{ id: MANGO, deduction: 1.5 }] });
ok("... while 'Refill' with 1.5 ml is accepted", r.status === 'applied' && await stock(MANGO) === mango0 - 1.5);

// a full-bottle line stored with a text size ('60ml'), product now sized '30'
const grape1 = await stock(GRAPE);
await db.exec(`insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status) values ('botlText60', '${GRAPE}', '${A}', null, 0, 'sold');
  insert into public.sales (id, "shopId", "totalAmount", "paymentMethod", items) values ('textSize', '${A}', 0, 'cash',
  '[{"productId":"${GRAPE}","productName":"Grape","quantity":1,"saleType":"full_bottle","bottleSize":"60ml",
     "bottleChanges":[{"bottleId":"botlText60","beforeRemainingMl":70,"afterRemainingMl":0,"beforeStatus":"closed","afterStatus":"sold"}]}]')`);
await reverse(A, 'textSize');
ok("a full-bottle line sized '60ml' puts back 60 ml (as the app reads it), not the product's 30", await stock(GRAPE) === grape1 + 60);
ok("... and its bottle (no size of its own) is capped at the line's 60 ml, closed again",
  (await bottle('botlText60')).ml === 60 && (await bottle('botlText60')).status === 'closed');

// a cashier's shop is only the one their profile points at
ok("a cashier's membership is exactly her shop (not her own uid)",
  JSON.stringify((await as(C, `select private.legacy_shop_ids() x`)).rows[0].x) === JSON.stringify([A]));
await expectError("a cashier cannot move a shop A sale into a 'shop' of her own uid", () =>
  as(C, `update public.sales set "shopId" = $1 where id = 'twoItems'`, [C]), /row-level security/);
await expectError('... nor add a product to it', () => as(C, `insert into public.products (id, "shopId", name) values ('cx', $1, 'x')`, [C]), /row-level security/);
await expectError('... nor check a sale out into it', () => checkout(C, sale('cashierOwn'), { shop: C }), /Unauthorized/);
ok('... and a new owner with no profile yet still gets her own uid (SaaS sign-up)',
  JSON.stringify((await as(FRESH2, `select private.legacy_shop_ids() x`)).rows[0].x) === JSON.stringify([FRESH2]));

// The deployed Edit flow on a pre-Supabase sale: the app reverses and
// deletes, then throws on the Firestore-JSON saleDateClient ("Invalid time
// value") before the new version is queued. The sale is gone; its copy is
// in private.deleted_rows and diagnostics/08_lost_sales.sql lists it.
const FSJSON = '{"_seconds":1790830800,"_nanoseconds":0}';
let threw = false;
try { new Date(FSJSON).toISOString(); } catch { threw = true; }
ok('the deployed app\'s extractDate(saleDateClient).toISOString() throws on Firestore JSON (src bug, owner warned)', threw);
const LOST = 'OldFsSale00000000001';
await db.exec(`insert into public.sales (id, "shopId", "totalAmount", "paymentMethod", "saleDate", "saleDateClient", items) values
  ('${LOST}', '${A}', 1500, 'cash', '2026-09-30T08:00:00Z', '${FSJSON}',
   '[{"productId":"${POD}","productName":"Pod X","quantity":1,"saleType":"regular","totalPrice":1500}]')`);
const podL = await stock(POD);
r = await reverse(A, LOST, false);
const delL = await as(A, `delete from public.sales where id = $1`, [LOST]);
ok('... edit steps 1-2 ran: sale removed, its stock put back, a copy kept as a "sale edit"', r.status === 'applied' && delL.affectedRows === 0
  && await stock(POD) === podL + 1
  && (await one(`select reason from private.deleted_rows where "table" = 'sales' and "rowId" = $1`, [LOST])).reason === 'sale edit');
const lostReport = async () => {
  const rows = lastRows(await db.exec(read(path.join(SUPA, 'diagnostics', '08_lost_sales.sql'))));
  return JSON.parse(Object.values(rows[0])[0]);
};
let lost = await lostReport();
const lostRow = lost.lost_in_edit.find(x => x.saleId === LOST);
ok('08_lost_sales lists it, with what is needed to ring it again', !!lostRow && lostRow.items[0].productName === 'Pod X'
  && lostRow.items[0].quantity === 1 && Number(lostRow.totalAmount) === 1500 && /^2026-09-30/.test(lostRow.saleDate), JSON.stringify(lostRow));
ok('... but not an edit that completed (same id back) nor a sale deleted on purpose',
  !lost.lost_in_edit.some(x => [MIX, SHORT, REF].includes(x.saleId)) && lost.deleted_on_purpose_count >= 1);
ok('deleted_rows says why: Sales-page delete = "sale delete", app delete = "app delete"',
  (await one(`select reason from private.deleted_rows where "rowId" = $1`, [REF])).reason === 'sale delete'
  && (await one(`select reason from private.deleted_rows where "table" = 'expenses' and "rowId" = 'exNew'`)).reason === 'app delete');
// The fix the app needs (sending saleDateClient unchanged) works with this server:
r = await checkout(A, sale(LOST, { saleDate: '2026-09-30T08:00:00.000Z', saleDateClient: FSJSON }), { prods: [{ id: POD, deduction: 1 }] });
const back = await one(`select "saleDate", "saleDateClient" from public.sales where id = $1`, [LOST]);
ok('an edit that sends saleDateClient unchanged checks out under the same id, date and Firestore value kept',
  r.status === 'applied' && new Date(back.saleDate).toISOString() === '2026-09-30T08:00:00.000Z' && back.saleDateClient === FSJSON);
lost = await lostReport();
ok('... and 08_lost_sales no longer lists it', !lost.lost_in_edit.some(x => x.saleId === LOST));

await expectError('process_stock_adjustment is retired (PT410)', () => rpc(db, A, 'process_stock_adjustment', {
  p_shop_id: A, p_product_id: POD, p_product_update: null, p_bottle_updates: null, p_bottle_inserts: null, p_inventory_logs: null }), /retired/);

// a cashier sells (NewSale) but cannot delete
await checkout(C, sale('cashierSale'), {});
ok('a cashier can still sell', !!(await one(`select 1 x from public.sales where id = 'cashierSale'`)));

// ---------------------------------------------------------------------
// 7. The snapshot helpers can put the old functions back (on a copy)
// ---------------------------------------------------------------------
const copy = await cloneDb(db);
const n = (await copy.query(`select private.restore_functions('pre_20261012100000') n`)).rows[0].n;
const ret = (await copy.query(`select format_type(prorettype, null) t from pg_proc where proname = 'process_checkout'`)).rows;
ok('restore_functions puts back the 4 snapshotted functions (process_checkout returns void again)', n === 4 && ret.length === 1 && ret[0].t === 'void');
ok('... still not callable by anon', !(await copy.query(`select has_function_privilege('anon', 'public.process_checkout(text,jsonb,jsonb,jsonb,jsonb,text,numeric)', 'EXECUTE') x`)).rows[0].x);
const np = (await copy.query(`select private.restore_policies('pre_20261012100000', 'public', 'products') n`)).rows[0].n;
ok('restore_policies puts back the old products policy', np === 1 && (await copy.query(`select policyname from pg_policies where tablename = 'products'`)).rows[0].policyname === 'Shop access products');
await copy.close();

done();
