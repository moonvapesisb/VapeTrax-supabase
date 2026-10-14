// Baseline security (migration 20261011120000_emergency_security_lockdown),
// checked on the state after ALL migrations, each applied twice.
//   * the replica reproduces the live hole before any migration;
//   * anon is locked out; no self-escalation; profiles are safe;
//   * process_checkout / process_reversal are membership-checked,
//     shop-scoped, replay-safe and double-delete-safe (since 20261012100000
//     a reversal is admin-only and restores from the stored sale, and
//     process_stock_adjustment is retired);
//   * verify_20261011120000.sql still reports all_checks_passed.
// Ported from the former supabase/tests/pglite/test_lockdown.mjs (42 checks).
import path from 'node:path';
import { replica, migrate, asUser, read, reporter, SUPA, MAIN_SHOP } from '../lib.mjs';

const VERIFY = read(path.join(SUPA, 'diagnostics/verify_20261011120000.sql'));

const A = MAIN_SHOP;                                // admin, shop A (main)
const B = '158a7adf-79e5-40c4-a87a-dedab3b9a0bb';   // admin, shop B (the former test shop)
const C = '11111111-1111-4111-8111-111111111111';   // cashier of shop B
const D = '22222222-2222-4222-8222-222222222222';   // new user, no profile (future cashier)
const X = '33333333-3333-4333-8333-333333333333';   // stranger who signs up
const X2 = '44444444-4444-4444-8444-444444444444';  // another stranger

const { ok, expectError, done } = reporter();
const db = await replica();
const as = (role, uid, sql, params = []) => asUser(db, uid, sql, params, { role });
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// ---------- before state ----------
await db.exec(`
  insert into auth.users (id) values ('${A}'),('${B}'),('${C}'),('${D}'),('${X}'),('${X2}');
  insert into public.profiles (id, username, role, "shopId") values
    ('${A}','ownerA','admin','${A}'), ('${B}','ownerB','admin','${B}'), ('${C}','cash','cashier','${B}');
  insert into public.products (id, "shopId", name, "stockQuantity") values ('pA1','${A}','Prod A',10), ('pB1','${B}','Prod B',10);
  insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status) values
    ('bA1','pA1','${A}',30,30,'closed'), ('bB1','pB1','${B}',30,30,'closed');
  insert into public.customers (id, "shopId", name, "creditBalance") values ('cA1','${A}','Cust A',0), ('cB1','${B}','Cust B',0);
  insert into public.expenses (id, "shopId", amount) values ('eA1','${A}',50);
`);

// prove the harness reproduces the live hole
await as('anon', '', `update public.profiles set role='cashier' where id=$1`, [A]);
ok('BEFORE: anon could edit any profile (live hole reproduced)', (await q1(`select role from public.profiles where id=$1`, [A])).role === 'cashier');
await db.query(`update public.profiles set role='admin' where id=$1`, [A]);

// ---------- every migration, twice ----------
await migrate(db);
ok('every migration runs twice without error', true);

const vj = JSON.parse((await q1(VERIFY)).jsonb_pretty);
ok('verify script: all_checks_passed', vj.all_checks_passed === true, JSON.stringify(vj.checks));

// ---------- auth.uid() matches Supabase's definition ----------
ok('auth.uid() reads request.jwt.claims (PostgREST 12)',
  (await asUser(db, C, `select auth.uid() as u`)).rows[0].u === C);
ok('auth.uid() reads the legacy request.jwt.claim.sub',
  (await asUser(db, C, `select auth.uid() as u`, [], { legacyClaim: true })).rows[0].u === C);
ok('auth.uid() is null for anon',
  (await asUser(db, '', `select auth.uid() as u`)).rows[0].u === null);

// ---------- anonymous ----------
await expectError('anon cannot read profiles', () => as('anon', '', `select * from public.profiles`), /permission denied/);
await expectError('anon cannot read products', () => as('anon', '', `select * from public.products`), /permission denied/);
await expectError('anon cannot run process_checkout', () => as('anon', '',
  `select public.process_checkout('${A}', '{"id":"s0","totalAmount":1}'::jsonb, '[]','[]','[]')`), /permission denied/);
await expectError('anon cannot run process_reversal', () => as('anon', '',
  `select public.process_reversal('${A}', 'x', true, null, null, null, null, 0)`), /permission denied/);

// ---------- signup / profiles ----------
await as('authenticated', X, `insert into public.profiles (id, username, role, "shopId") values ($1,'x','admin',$1)`, [X]);
ok('first login: user creates own admin profile for own shop', !!(await q1(`select 1 as ok from public.profiles where id=$1`, [X])));
await expectError('stranger cannot join another shop as admin', () => as('authenticated', X2,
  `insert into public.profiles (id, username, role, "shopId") values ($1,'x2','admin',$2)`, [X2, A]), /row-level security/);
await expectError('stranger cannot join another shop as cashier', () => as('authenticated', X2,
  `insert into public.profiles (id, username, role, "shopId") values ($1,'x2','cashier',$2)`, [X2, A]), /row-level security/);
await expectError('cashier cannot promote self to admin', () => as('authenticated', C,
  `update public.profiles set role='admin' where id=$1`, [C]), /permission denied/);
await expectError('cashier cannot move self to another shop', () => as('authenticated', C,
  `update public.profiles set "shopId"=$2 where id=$1`, [C, A]), /permission denied/);
await expectError('stranger cannot edit another shop\'s profile', () => as('authenticated', X,
  `update public.profiles set role='cashier' where id=$1`, [A]), /permission denied/);
const xEdit = await as('authenticated', X, `update public.profiles set username='hacked' where id=$1 returning id`, [A]);
ok('stranger updating another user\'s username affects 0 rows', xEdit.rows.length === 0);
await as('authenticated', C, `update public.profiles set username='Cashier One', "updatedAt"=now() where id=$1`, [C]);
ok('cashier can edit own name (+updatedAt now exists)', (await q1(`select username from public.profiles where id=$1`, [C])).username === 'Cashier One');
await as('authenticated', B, `insert into public.profiles (id, username, email, role, "shopId") values ($1,'new cashier','d@x','cashier',$2)`, [D, B]);
ok('admin adds a cashier to own shop', (await q1(`select "shopId" from public.profiles where id=$1`, [D])).shopId === B);
await expectError('admin cannot add a cashier to another shop', () => as('authenticated', B,
  `insert into public.profiles (id, username, role, "shopId") values ($1,'z','cashier',$2)`, [X2, A]), /row-level security/);
await as('authenticated', B, `update public.profiles set username='Renamed', email='c@x', "updatedAt"=now() where id=$1`, [C]);
ok('admin edits cashier name/email', (await q1(`select username from public.profiles where id=$1`, [C])).username === 'Renamed');
await expectError('admin cannot change cashier role', () => as('authenticated', B,
  `update public.profiles set role='admin' where id=$1`, [C]), /permission denied/);
const selfDel = await as('authenticated', B, `delete from public.profiles where id=$1 returning id`, [B]);
ok('admin cannot delete own profile', selfDel.rows.length === 0);
const listCash = await as('authenticated', B, `select id from public.profiles where "shopId"=$1`, [B]);
ok('admin can list own shop members', listCash.rows.length === 3);

// ---------- business tables still work through profiles ----------
const cProds = await as('authenticated', C, `select id from public.products order by id`);
ok('cashier sees only own shop products', cProds.rows.map(r => r.id).join() === 'pB1', JSON.stringify(cProds.rows));
await as('authenticated', A, `update public.expenses set amount=60, "updatedAt"=now() where id='eA1'`);
ok('expense edit with updatedAt works', Number((await q1(`select amount from public.expenses where id='eA1'`)).amount) === 60);

// ---------- checkout ----------
// Each deduction is also a sale line: since 20261012100000 a reversal
// restores from the stored sale's lines.
const sale = (id, prods = [], cust = null) => JSON.stringify({ id, totalAmount: 100, paymentMethod: 'credit', customerId: cust, saleDate: '2026-10-10T10:00:00.000Z',
  items: prods.map(p => ({ productId: p.id, productName: 'Prod', quantity: p.deduction, saleType: 'regular' })) });
const chk = (uid, shop, id, prods, bots, cust, credit) => as('authenticated', uid,
  `select public.process_checkout($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
  [shop, sale(id, prods, cust), JSON.stringify(prods), JSON.stringify(bots),
   JSON.stringify([{ id: 'log-' + id, productId: 'pB1', productName: 'Prod B', action: 'sale', type: 'sale', change: -2, quantityChange: -2, shopId: A }]),
   cust, credit]);

await chk(C, B, 'S1', [{ id: 'pB1', deduction: 2 }], [{ id: 'bB1', productId: 'pB1', bottleSize: 30, remainingMl: 20, status: 'opened' }], 'cB1', 100);
let pB1 = await q1(`select "stockQuantity" from public.products where id='pB1'`);
let cB1 = await q1(`select "creditBalance" from public.customers where id='cB1'`);
const log1 = await q1(`select "shopId", "createdBy" from public.inventory_logs where id='log-S1'`);
const s1 = await q1(`select "saleDate" from public.sales where id='S1'`);
ok('checkout deducts stock', Number(pB1.stockQuantity) === 8);
ok('checkout adds udhaar', Number(cB1.creditBalance) === 100);
ok('checkout log forced to own shop + real user id', log1.shopId === B && log1.createdBy === C, JSON.stringify(log1));
ok('checkout keeps client sale date', new Date(s1.saleDate).toISOString() === '2026-10-10T10:00:00.000Z');
ok('checkout updates own bottle', Number((await q1(`select "remainingMl" from public.bottles where id='bB1'`)).remainingMl) === 20);

await chk(C, B, 'S1', [{ id: 'pB1', deduction: 2 }], [], 'cB1', 100);
pB1 = await q1(`select "stockQuantity" from public.products where id='pB1'`);
cB1 = await q1(`select "creditBalance" from public.customers where id='cB1'`);
ok('REPLAY of same sale does not deduct stock twice', Number(pB1.stockQuantity) === 8);
ok('REPLAY of same sale does not add udhaar twice', Number(cB1.creditBalance) === 100);

await chk(C, B, 'S2', [{ id: 'pA1', deduction: 5 }], [{ id: 'bA1', productId: 'pA1', bottleSize: 30, remainingMl: 0, status: 'empty' }], 'cA1', 999);
ok('cannot deduct another shop\'s product', Number((await q1(`select "stockQuantity" from public.products where id='pA1'`)).stockQuantity) === 10);
ok('cannot overwrite another shop\'s bottle', Number((await q1(`select "remainingMl" from public.bottles where id='bA1'`)).remainingMl) === 30);
ok('cannot add udhaar to another shop\'s customer', Number((await q1(`select "creditBalance" from public.customers where id='cA1'`)).creditBalance) === 0);
await expectError('non-member cannot checkout into another shop', () => chk(C, A, 'S3', [], [], null, 0), /Unauthorized/);

// ---------- reversal ----------
await expectError('non-member cannot reverse in another shop', () => as('authenticated', X,
  `select public.process_reversal($1, 'S1', true, null, null, null, null, 0)`, [B]), /Unauthorized/);
// Since 20261012100000 only the shop admin may reverse, and the amounts come
// from the stored sale (the client arrays are ignored).
const rev = (uid = B) => as('authenticated', uid,
  `select public.process_reversal($1, 'S1', true, $2::jsonb, null, $3::jsonb, 'cB1', 100)`,
  [B, JSON.stringify([{ id: crypto.randomUUID(), shopId: A, productId: 'pB1', productName: 'Prod B', type: 'return', action: 'return', change: 2 }]),
   JSON.stringify([{ productId: 'pB1', addition: 2 }])]);
await expectError('a cashier cannot reverse a sale (admin only since 20261012100000)', () => rev(C), /Only the shop admin/);
await rev();
ok('delete-sale reversal restores stock', Number((await q1(`select "stockQuantity" from public.products where id='pB1'`)).stockQuantity) === 10);
ok('delete-sale reversal reduces udhaar', Number((await q1(`select "creditBalance" from public.customers where id='cB1'`)).creditBalance) === 0);
ok('reversal log forced to own shop', (await q1(`select count(*)::int n from public.inventory_logs where "shopId"=$1 and type='return'`, [A])).n === 0);
await rev();
ok('DOUBLE delete does not restore stock twice', Number((await q1(`select "stockQuantity" from public.products where id='pB1'`)).stockQuantity) === 10);
ok('DOUBLE delete does not reduce udhaar twice', Number((await q1(`select "creditBalance" from public.customers where id='cB1'`)).creditBalance) === 0);

// ---------- edit-sale flow used by the current app ----------
await chk(C, B, 'S4', [{ id: 'pB1', deduction: 1 }], [], null, 0);
await as('authenticated', B, `select public.process_reversal($1, 'S4', false, null, null, $2::jsonb, null, 0)`, [B, JSON.stringify([{ productId: 'pB1', addition: 1 }])]);
await as('authenticated', B, `delete from public.sales where id='S4'`);
await chk(C, B, 'S4', [{ id: 'pB1', deduction: 3 }], [], null, 0);
ok('edit-sale flow (reverse, delete, re-checkout same id) applies new sale', Number((await q1(`select "stockQuantity" from public.products where id='pB1'`)).stockQuantity) === 7);

// ---------- stock adjustment (retired by 20261012100000) ----------
await expectError('stock adjustment: single overload resolves, and it is retired (PT410)', () => as('authenticated', C,
  `select public.process_stock_adjustment(p_shop_id => $1::uuid, p_product_id => 'pB1', p_product_update => null, p_bottle_updates => null, p_bottle_inserts => $2::jsonb, p_inventory_logs => null)`,
  [B, JSON.stringify([{ productId: 'pB1', bottleSize: 30, remainingMl: 30, shopId: A }])]), /retired/);
ok('stock adjustment: nothing was inserted', !(await q1(`select 1 as x from public.bottles where "productId"='pB1' and id <> 'bB1'`)));

done();
