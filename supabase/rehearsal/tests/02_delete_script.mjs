// The one-off script supabase/scripts/2026-10-11_delete_test_shop_and_users.sql
// (run on live on 2026-10-11) and its safety aborts, checked on the state
// after ALL migrations, each applied twice.
// The committed script is a redacted record: the real emails were replaced
// with placeholders (account-N@example.invalid; the original lives in the
// owner's local private/ folder). Seeding the same placeholders proves the
// guards still work as written, and that re-running the committed file
// against the real database (where these placeholders match nobody) aborts.
// Ported from the former supabase/tests/pglite/test_delete.mjs (12 checks).
import path from 'node:path';
import { replica, migrate, read, reporter, lastRows, SUPA, MAIN_SHOP } from '../lib.mjs';

const SCRIPT = read(path.join(SUPA, 'scripts/2026-10-11_delete_test_shop_and_users.sql'));
const MAIN = MAIN_SHOP, TEST = '158a7adf-79e5-40c4-a87a-dedab3b9a0bb',
  HUS = 'e358337f-3b9e-4a64-80e3-339a26592b97', SAL = 'ffc5ce0b-b670-4928-b9eb-cd3fc5fe6b15';
const MAIN_EMAIL = 'main-shop@example.invalid', TEST_EMAIL = 'account-1@example.invalid',
  HUS_EMAIL = 'account-2@example.invalid', SAL_EMAIL = 'account-3@example.invalid';

const { ok, done } = reporter();

ok('script holds no personal email addresses', !/[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook)\.com/i.test(SCRIPT));

async function setup(emailForTest = TEST_EMAIL) {
  const db = await replica();
  await migrate(db);
  await db.exec(`
    insert into auth.users (id, email) values ('${MAIN}','${MAIN_EMAIL}'),('${TEST}','${emailForTest}'),('${SAL}','${SAL_EMAIL}'),('${HUS}','${HUS_EMAIL}');
    insert into auth.sessions (user_id) values ('${TEST}'),('${HUS}');
    insert into public.profiles (id, username, role, "shopId") values ('${MAIN}','main','admin','${MAIN}'),('${TEST}','test','admin','${TEST}'),('${HUS}','hus','cashier','${TEST}');
    insert into public.products (id,"shopId",name) values ('m1','${MAIN}','Main P'),('t1','${TEST}','Test P'),('t2','${TEST}','Test P2');
    insert into public.stock_alerts (id,"shopId","productId") values ('sa1','${TEST}','t1');
    insert into public.bottles (id,"productId","shopId") values ('mb','m1','${MAIN}'),('tb','t1','${TEST}');
    insert into public.inventory_logs (id,"shopId") values ('ml','${MAIN}'),('tl','${TEST}');
    insert into public.credits (id,"shopId") values ('mc','${MAIN}'),('tc','${TEST}');
    insert into public.sales (id,"shopId","totalAmount") values ('ms','${MAIN}',10);
    insert into public.customers (id,"shopId",name) values ('mcu','${MAIN}','C');
    insert into public.settings ("shopId") values ('${MAIN}');`);
  return db;
}

// happy path
let db = await setup();
const out = JSON.parse(lastRows(await db.exec(SCRIPT))[0].jsonb_pretty);
console.log(JSON.stringify(out));
ok('only main account remains', JSON.stringify(out.remaining_accounts) === JSON.stringify([MAIN_EMAIL]));
ok('main shop data intact', out.main_shop_still_has.sales === 1 && out.main_shop_still_has.products === 1 && out.main_shop_still_has.customers === 1);
ok('test shop rows gone', out.test_shop_rows_left === 0);
ok('main bottles/logs/credits intact', (await db.query(`select (select count(*) from public.bottles)+(select count(*) from public.inventory_logs)+(select count(*) from public.credits) n`)).rows[0].n == 3);
ok('test stock_alerts gone', (await db.query(`select count(*)::int n from public.stock_alerts`)).rows[0].n === 0);
ok('main profile intact', (await db.query(`select count(*)::int n from public.profiles`)).rows[0].n === 1);
ok('sessions of deleted users cascaded', (await db.query(`select count(*)::int n from auth.sessions`)).rows[0].n === 0);

// guard: email mismatch -> abort, nothing deleted
db = await setup('someone-else@example.invalid');
try { await db.exec(SCRIPT); ok('guard aborts on email mismatch', false); }
catch (e) { ok('guard aborts on email mismatch', /ABORTED/.test(e.message), e.message); }
await db.exec('rollback').catch(() => {});
ok('nothing deleted after abort', (await db.query(`select count(*)::int n from auth.users`)).rows[0].n === 4 && (await db.query(`select count(*)::int n from public.products`)).rows[0].n === 3);

// guard: test shop has a sale -> abort
db = await setup();
await db.exec(`insert into public.sales (id,"shopId","totalAmount") values ('ts','${TEST}',5)`);
try { await db.exec(SCRIPT); ok('guard aborts if test shop has sales', false); }
catch (e) { ok('guard aborts if test shop has sales', /ABORTED/.test(e.message), e.message); }
await db.exec('rollback').catch(() => {});
ok('nothing deleted after sales abort', (await db.query(`select count(*)::int n from auth.users`)).rows[0].n === 4 && (await db.query(`select count(*)::int n from public.products`)).rows[0].n === 3);

done();
