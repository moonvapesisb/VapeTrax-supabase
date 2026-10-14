// clonetheproject/database_setup.sql on a NEW, EMPTY Supabase project:
// it builds the same database the original reaches through its migrations,
// refuses to run twice, and a brand-new shop can sign up, sell and reverse.
import path from 'node:path';
import { newDb, replica, migrate, read, lastRows, rpc, asUser, dbState, stateDiff, showDiff, REHEARSAL, ROOT } from '../lib.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); }
};
const expectError = async (name, fn, re) => {
  try { await fn(); ok(name, false, '(no error)'); }
  catch (e) { ok(name, re.test(e.message), `(got: ${e.message})`); }
};

// A fresh Supabase project: roles, extensions, auth schema, default privileges
// and an empty realtime publication, taken from replica.sql's Supabase part.
const replicaSql = read(path.join(REHEARSAL, 'replica.sql'));
const supabasePart = replicaSql.slice(
  replicaSql.indexOf('-- Roles and extensions'),
  replicaSql.indexOf('-- public tables'));
const fresh = async () => {
  const db = await newDb();
  await db.exec(supabasePart.replace(/^-- -+\s*$/gm, ''));
  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create publication supabase_realtime;`);
  return db;
};

const SETUP = read(path.join(ROOT, 'clonetheproject', 'database_setup.sql'));
const db = await fresh();
const out = JSON.parse(lastRows(await db.exec(SETUP))[0].result);
ok('setup runs on an empty project and reports all_ok', out.all_ok === true, JSON.stringify(out));

await expectError('running it a second time stops and changes nothing', () => db.exec(SETUP), /STOPPED: this project already has VapeTrax tables/);
await db.exec('rollback'); // the SQL Editor ends the failed transaction itself; this test session must do it

// Same database as the original after its migrations (public and private schemas).
const ref = await replica();
await migrate(ref, { passes: 1 });
const ignore = line =>
  /rls_auto_enable/.test(line)  // Supabase's own helper exists only on the original project
  || /^rows /.test(line);       // row contents: timestamps and bookkeeping differ, and there is no shop data
const a = (await dbState(ref, { schemas: ['public', 'private'] })).filter(l => !ignore(l));
const b = (await dbState(db, { schemas: ['public', 'private'] })).filter(l => !ignore(l));
// Function bodies are compared without carriage returns: the migration files
// may be checked out with Windows line endings, the generated file uses LF,
// and the code is the same either way.
const fnDef = async (d, sig) => (await d.query(
  `select md5(replace(pg_get_functiondef($1::regprocedure), chr(13), '')) as h`, [sig])).rows[0]?.h;
const fnLines = stateDiff(a, b).filter(l => /^[-+] function /.test(l));
const sameFns = new Set();
for (const sig of new Set(fnLines.map(l => l.slice(11).replace(/ def=[\s\S]*$/, '')))) {
  if (await fnDef(ref, sig) === await fnDef(db, sig)) sameFns.add(sig);
}
const diff = stateDiff(a, b).filter(l =>
  !(/^[-+] function /.test(l) && sameFns.has(l.slice(11).replace(/ def=[\s\S]*$/, ''))));
ok('same tables, columns, rules, functions and triggers as the original', diff.length === 0, showDiff(diff, 20));

// A brand-new shop: sign up, first login creates the admin profile, sell, reverse.
const OWNER = '11111111-1111-4111-8111-111111111111';
const CASHIER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
await db.exec(`insert into auth.users (id, email, created_at) values
  ('${OWNER}', 'owner@example.invalid', now()), ('${CASHIER}', 'cashier@example.invalid', now()),
  ('${STRANGER}', 'other@example.invalid', now())`);
await asUser(db, OWNER, `insert into public.profiles (id, username, email, role, "shopId") values ($1, 'Owner', 'owner@example.invalid', 'admin', $1)`, [OWNER]);
await asUser(db, STRANGER, `insert into public.profiles (id, username, email, role, "shopId") values ($1, 'Other', 'other@example.invalid', 'admin', $1)`, [STRANGER]);
ok('first login creates the admin profile', (await db.query(`select role from public.profiles where id = $1`, [OWNER])).rows[0]?.role === 'admin');

await asUser(db, OWNER, `insert into public.products (id, "shopId", name, category, "sellingPrice", "stockQuantity") values ('p1', $1, 'Pod', 'device', 1500, 5)`, [OWNER]);
await asUser(db, OWNER, `insert into public.settings ("shopId", "shopName") values ($1, 'Friend Shop')`, [OWNER]);
const sale = { id: 'S0000000000000000001', totalAmount: 1500, paymentMethod: 'cash', items: [{ productId: 'p1', productName: 'Pod', saleType: 'regular', quantity: 1, unitPrice: 1500 }], saleDate: new Date().toISOString() };
const r1 = (await rpc(db, OWNER, 'process_checkout', { p_shop_id: OWNER, p_sale_data: sale, p_product_updates: [{ id: 'p1', deduction: 1 }], p_bottle_updates: [], p_inventory_logs: [] })).rows[0].result;
const stock = async () => Number((await db.query(`select "stockQuantity" s from public.products where id = 'p1'`)).rows[0].s);
ok('a sale goes through and deducts stock', r1?.status === 'applied' && await stock() === 4, JSON.stringify(r1));
const r2 = (await rpc(db, OWNER, 'process_checkout', { p_shop_id: OWNER, p_sale_data: sale, p_product_updates: [{ id: 'p1', deduction: 1 }], p_bottle_updates: [], p_inventory_logs: [] })).rows[0].result;
ok('a repeated sale is recognised and not counted twice', r2?.status === 'duplicate' && await stock() === 4);
await rpc(db, OWNER, 'process_reversal', { p_shop_id: OWNER, p_sale_id: sale.id, p_delete_sale: true, p_inventory_logs: null, p_bottle_updates: null, p_product_updates: null, p_customer_id: null, p_credit_decrement: 0 });
ok('deleting the sale restores the stock', await stock() === 5);

await asUser(db, OWNER, `insert into public.profiles (id, username, email, role, "shopId") values ($1, 'Cashier', 'cashier@example.invalid', 'cashier', $2)`, [CASHIER, OWNER]);
ok('the owner can add a cashier', (await asUser(db, CASHIER, `select id from public.products`)).rows.length === 1);
ok('the cashier sees the shop name for invoices', (await asUser(db, CASHIER, `select "shopName" from public.settings`)).rows[0]?.shopName === 'Friend Shop');
ok('another shop cannot see this shop\'s products', (await asUser(db, STRANGER, `select id from public.products`)).rows.length === 0);
await expectError('nobody logged out can read anything', () => asUser(db, '', `select * from public.products`), /permission denied/);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
