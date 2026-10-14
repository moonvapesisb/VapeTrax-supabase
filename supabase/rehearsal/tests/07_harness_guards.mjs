// The rehearsal's own safety checks must actually catch what they are for
// (run.mjs relies on them; a guard that can never fire is worse than none).
//
//   * smokeShapeProblems(): a supabase/tests/*.sql smoke test is refused
//     unless it is begin; ...; rollback; select 'ALL TESTS PASSED'; with
//     only savepoints in between. The SQL Editor commits whatever a file
//     leaves open, so a missing rollback would commit test rows to live; it
//     also shows only the last result, so that line is what the owner sees.
//   * checkSmokeTest(): a failed check must raise an exception. A FAIL in a
//     result row or a notice (invisible in the SQL Editor) fails the test.
//   * checkDiagnostic(): a diagnostic that could end or lift the read-only
//     transaction it is checked in (commit, set transaction read write, ...)
//     is refused before it runs; a write, a change, or anything but one
//     non-NULL JSON cell fails it.
//   * cloneDb(): copies run with the main pass's search_path ("$user",
//     public, extensions, as on live); a bare PGlite clone has public only.
//   * dbState() / stateDiff(): running a file bare (as the SQL Editor does)
//     and comparing states catches rows it leaves behind, changed contents,
//     grants and function bodies. An outer begin ... rollback, as the
//     harness used before, hides exactly the mistake that matters.
//   * 20261011120000 is NOT safe to run again after 20261011140000: its
//     create or replace puts back process_checkout without the stock guard,
//     and a short sale is then refused instead of kept. That is why it is
//     in RERUN_UNSAFE (lib.mjs) and MIGRATIONS_LOG.md says never run it
//     again. Since 20261012100000 (the RPCs return jsonb) re-running it, or
//     20261011140000, on the final state fails and changes nothing.
import {
  replica, cloneDb, migrate, migrationFiles, asUser, read, reporter, dbState, stateDiff, changedObjects,
  smokeShapeProblems, checkSmokeTest, checkDiagnostic, SMOKE_PASSED, MAIN_SHOP,
} from '../lib.mjs';

const { ok, done } = reporter();
const P = `select '${SMOKE_PASSED}'`;

// ---------------------------------------------------------------------
// 1. Smoke-test shape (parser only, nothing runs)
// ---------------------------------------------------------------------
const shape = {
  [`begin; select 1; rollback; ${P};`]: true,
  [`BEGIN;\n-- comment\nselect 1;\nROLLBACK;\nSELECT '${SMOKE_PASSED}' AS result;`]: true,
  [`start transaction; savepoint a; select 1; rollback to savepoint a; release a; rollback; ${P};`]: true,
  [`begin; do $$ begin perform 1; end $$; abort; ${P};`]: true,
  [`begin; select 1; rollback; ${P} as result, '00_x.sql: everything is rolled back' as detail;`]: true,
  [`begin; select 1; rollback; ${P}, 1, null;`]: true,
  // The line the owner sees must be there, last, and be constants only:
  // it runs after the rollback, so anything else in it would be committed.
  'begin; select 1; rollback;': false,
  [`begin; select 1; ${P}; rollback;`]: false,
  [`begin; select 1; rollback; select 'ok';`]: false,
  [`begin; select 1; rollback; select 'all tests passed';`]: false,
  [`begin; select 1; rollback; select '${SMOKE_PASSED}'::text;`]: false,
  [`begin; select 1; rollback; ${P} as result, current_setting('smoke.passed', true) as detail;`]: false,
  [`begin; select 1; rollback; select 'detail', '${SMOKE_PASSED}';`]: false,
  [`begin; select 1; rollback; ${P} from public.products;`]: false,
  [`begin; select 1; rollback; ${P} where now() is not null;`]: false,
  [`begin; select 1; rollback; select coalesce('${SMOKE_PASSED}', public.process_checkout(null, null, null, null, null, null, null)::text);`]: false,
  [`begin; select 1; rollback; ${P} into zz_marker;`]: false,
  [`begin; select 1; rollback; ${P} union select 'x';`]: false,
  [`begin; select 1; rollback; with d as (delete from public.products returning 1) ${P};`]: false,
  [`begin; select 1; rollback; values ('${SMOKE_PASSED}');`]: false,
  [`begin; select 1; rollback; ${P}; ${P};`]: false,
  [`begin; select 1; rollback; insert into public.products (id) values ('x'); ${P};`]: false,
  [`${P};`]: false,
  // The transaction rules (each also has the line, so only they refuse it).
  "insert into public.products (id) values ('x');": false,
  [`begin; select 1; ${P};`]: false,
  [`begin; select 1; commit; ${P};`]: false,
  [`begin; select 1; end; ${P};`]: false,
  [`select 1; rollback; ${P};`]: false,
  [`begin; select 1; rollback; insert into public.products (id) values (1); begin; rollback; ${P};`]: false,
  [`begin; select 1; rollback and chain; ${P};`]: false,
  [`begin; prepare transaction 'x'; rollback; ${P};`]: false,
  [`begin; commit prepared 'x'; rollback; ${P};`]: false,
  [`begin; begin; rollback; ${P};`]: false,
  'begin;': false,
  [`rollback; ${P};`]: false,
  [`begin; select (; rollback; ${P};`]: false,
};
for (const [sql, safe] of Object.entries(shape)) {
  const problems = await smokeShapeProblems(sql);
  ok(`smoke shape: ${safe ? 'accepts' : 'refuses'} ${JSON.stringify(sql).slice(0, 120)}`, safe ? problems.length === 0 : problems.length > 0,
    JSON.stringify(problems));
}

// ---------------------------------------------------------------------
// 2. State comparison catches what a bare run leaves behind
// ---------------------------------------------------------------------
const db = await replica({ fixtures: true });
await migrate(db);
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// The reviewer's case: a smoke test that forgot its begin/rollback.
const FORGOT = `
insert into auth.users (id, email) values ('0f0f0f0f-0000-4000-8000-00000000000f', 'smoke@example.invalid');
insert into public.products (id, "shopId", name, category, "stockQuantity") values ('smokeProduct', '${MAIN_SHOP}', 'Smoke', 'device', 1);
`;
ok('the forgot-rollback file is refused before it runs', (await smokeShapeProblems(FORGOT)).length > 0);

const pathBefore = (await q1(`select current_setting('search_path') as p`)).p;
let s0 = await dbState(db);
ok('dbState puts the caller\'s search_path back', (await q1(`select current_setting('search_path') as p`)).p === pathBefore, pathBefore);
await db.exec('begin');
await db.exec(FORGOT);
await db.exec('rollback');
ok('control: inside an outer begin ... rollback (the old harness) it leaves no trace, which hid the mistake',
  stateDiff(s0, await dbState(db)).length === 0);

await db.exec(FORGOT);                                    // bare, as the SQL Editor runs it
let d = stateDiff(s0, await dbState(db));
ok('run bare, the rows it leaves behind are caught (auth.users and products)',
  changedObjects(d).sort().join() === 'rows "auth"."users",rows "public"."products"', d.join('\n'));
await db.exec(`delete from public.products where id = 'smokeProduct'; delete from auth.users where id = '0f0f0f0f-0000-4000-8000-00000000000f';`);
ok('control: after removing them the state matches again', stateDiff(s0, await dbState(db)).length === 0);

const WRAPPED = `begin;\n${FORGOT}\nrollback;\n${P};`;
ok('the same file as begin ... rollback; select ALL TESTS PASSED is accepted', (await smokeShapeProblems(WRAPPED)).length === 0);
const wrappedProblems = await checkSmokeTest(db, WRAPPED);
ok('... and checkSmokeTest runs it bare: it passes and leaves nothing behind',
  wrappedProblems.length === 0 && stateDiff(s0, await dbState(db)).length === 0, JSON.stringify(wrappedProblems));

// Same row count, different contents.
await db.exec(`update public.products set "sellingPrice" = "sellingPrice" + 1 where id = 'prodPod0000000000001'`);
d = stateDiff(s0, await dbState(db));
ok('a changed value with the same row count is caught', d.length === 2 && changedObjects(d).join() === 'rows "public"."products"', d.join('\n'));
await db.exec(`update public.products set "sellingPrice" = "sellingPrice" - 1 where id = 'prodPod0000000000001'`);

await db.exec(`grant select on public.products to anon`);
d = stateDiff(s0, await dbState(db));
ok('a grant is caught', changedObjects(d).join() === 'relation public.products', d.join('\n'));
await db.exec(`revoke select on public.products from anon`);
ok('control: after revoking it the state matches again', stateDiff(s0, await dbState(db)).length === 0);

// Each case: [name, sql, expected problem (null = must pass)]. Every case
// must also leave the database exactly as it found it.
const cases = async (label, check, list) => {
  for (const [name, sql, re] of list) {
    const before = await dbState(db);
    const problems = await check(db, sql);
    const changes = stateDiff(before, await dbState(db));
    ok(`${label}: ${name}`, (re ? problems.length > 0 && re.test(problems.join('; ')) : problems.length === 0) && changes.length === 0,
      JSON.stringify(problems) + (changes.length ? ` (changed: ${changedObjects(changes).join('; ')})` : ''));
  }
};

// ---------------------------------------------------------------------
// 2b. A smoke test reports a failed check by raising an exception
// ---------------------------------------------------------------------
// The SQL Editor shows only the last result (the ALL TESTS PASSED line) and
// no notices, so a FAIL row or notice would never reach the owner.
const ASSERT = `create function pg_temp.assert(ok boolean, what text) returns void language plpgsql as $f$
begin
  if ok is not true then raise exception 'FAIL: %', what; end if;
end $f$;`;
await cases('smoke run', checkSmokeTest, [
  ['a test whose checks all hold passes (pg_temp.assert)',
    `begin;\n${ASSERT}\nselect pg_temp.assert((select count(*) from public.products) > 0, 'the shop has products');\nrollback;\n${P};`, null],
  ['a failed check raises, and the test fails with its message',
    `begin;\n${ASSERT}\nselect pg_temp.assert(false, 'anon cannot read products');\nrollback;\n${P};`, /FAIL: anon cannot read products/],
  ["the reviewer's case: a FAIL result row (right shape, no error, nothing left behind) fails the test",
    `begin;\nselect case when false then 'ok' else 'FAIL: products visible' end;\nrollback;\n${P};`, /result row reports a failure/],
  ['a FAIL notice fails the test',
    `begin;\ndo $$ begin raise notice 'FAIL: products visible'; end $$;\nrollback;\n${P};`, /notice reports a failure/],
  ['a SMOKE FAIL result row fails the test (the prefix tests/00 and 01 raise)',
    `begin;\nselect 'SMOKE FAIL: products visible' as result;\nrollback;\n${P};`, /result row reports a failure/],
  ['the line may carry more constant columns, even with the same name',
    `begin;\nselect 1;\nrollback;\n${P}, 'everything is rolled back';`, null],
  ['a file without the ALL TESTS PASSED line is not run', 'begin; select 1; rollback;', /^not run: /],
  ['a file with the line before the rollback is not run (the SQL Editor would show the rollback)',
    `begin;\nselect 1;\n${P};\nrollback;`, /^not run: /],
]);

// ---------------------------------------------------------------------
// 2c. Diagnostics: refused if they could escape the read-only check
// ---------------------------------------------------------------------
const POD_WRITE = `update public.products set "stockQuantity" = 999 where id = 'prodPod0000000000001'`;
await cases('diagnostic', checkDiagnostic, [
  ['one jsonb object is accepted', `select jsonb_build_object('ok', true) as result;`, null],
  ['one text cell holding a JSON array is accepted', `-- comment\nselect '[1, 2]'::text as result;`, null],
  ['a harmless set local before it is accepted', `set local work_mem = '8MB';\nselect '{}'::jsonb;`, null],
  ["the reviewer's case: set transaction read write, then a write (it would commit on live)",
    `set transaction read write; ${POD_WRITE}; select jsonb_build_object('ok', true) as result;`, /^not run: .*transaction mode \(set transaction\)/],
  ["the reviewer's case: commit ends the read-only transaction, then a write",
    `select 1; commit; ${POD_WRITE}; select '{}'::jsonb;`, /^not run: .*transaction statement \(commit\)/],
  ['rollback, then begin read write', `rollback; begin read write; ${POD_WRITE}; select '{}'::jsonb;`, /^not run: .*transaction statement \(rollback\)/],
  ['set session characteristics as transaction read write',
    `set session characteristics as transaction read write; select '{}'::jsonb;`, /^not run: .*transaction mode/],
  ['set transaction_read_only = off', `set transaction_read_only = off; ${POD_WRITE}; select '{}'::jsonb;`, /^not run: .*transaction mode/],
  ['set local default_transaction_read_only to off', `set local default_transaction_read_only to off; select '{}'::jsonb;`, /^not run: .*transaction mode/],
  ['reset transaction_read_only', `reset transaction_read_only; select '{}'::jsonb;`, /^not run: .*transaction mode/],
  ['savepoint', `savepoint a; select '{}'::jsonb;`, /^not run: .*transaction statement \(savepoint\)/],
  ['a plain write is stopped by the read-only transaction', `${POD_WRITE}; select '{}'::jsonb;`, /read-only transaction/],
  ["the reviewer's case: a NULL cell (jsonb_agg over no rows) fails",
    `select jsonb_pretty(jsonb_agg(x)) from (select 1 as x) s where false;`, /NULL/],
  ["the text 'null' fails", `select 'null'::text;`, /NULL/],
  ['a number fails', `select 42;`, /expected a JSON object or array/],
  ['text that is not JSON fails', `select 'hello';`, /not JSON/],
  ['two rows fail', `select '{}'::jsonb from generate_series(1, 2);`, /2 row\(s\)/],
  ['two columns with the same name fail', `select '{}'::jsonb, '{}'::jsonb;`, /2 column\(s\)/],
  ['a last statement without a result fails', `select '{}'::jsonb; set local work_mem = '8MB';`, /returns no result/],
  ['an error fails', `select 1 / 0;`, /division by zero/],
]);

// ---------------------------------------------------------------------
// 2d. cloneDb(): a copy runs with the main pass's session settings
// ---------------------------------------------------------------------
const SETTINGS = `select current_setting('search_path') as sp, current_setting('rehearsal.replica', true) as marker`;
const mainSettings = await q1(SETTINGS);
const c1 = await cloneDb(db);
const copySettings = (await c1.query(SETTINGS)).rows[0];
ok('cloneDb: the copy has the main db\'s search_path ("$user", public, extensions, as on live)',
  copySettings.sp === mainSettings.sp && mainSettings.sp === '"$user", public, extensions', JSON.stringify({ mainSettings, copySettings }));
ok('cloneDb: the copy keeps the rehearsal marker', copySettings.marker === 'on' && mainSettings.marker === 'on', JSON.stringify(copySettings));
// The reviewer's case: safe to re-run on live, but it calls an extensions
// function unqualified. Applied once (the main pass), then again on a copy
// (the re-run-alone check of run.mjs section 3).
const DEMO = `begin;
create table if not exists public.zz_demo (id uuid primary key);
alter table public.zz_demo enable row level security;
alter table public.zz_demo alter column id set default uuid_generate_v4();
revoke all on public.zz_demo from anon;
commit;`;
await c1.exec(DEMO);
const c2 = await cloneDb(c1);
const demoBefore = await dbState(c2);
let demoErr = null;
try { await c2.exec(DEMO); } catch (e) { demoErr = e; await c2.exec('rollback').catch(() => {}); }
ok("cloneDb: the reviewer's re-run-safe migration (unqualified uuid_generate_v4) re-runs on a copy without error and changes nothing",
  !demoErr && stateDiff(demoBefore, await dbState(c2)).length === 0, demoErr ? demoErr.message : '');
const bareClone = await c1.clone();
console.log(`  (for reference: a bare PGlite clone runs with search_path = ${(await bareClone.query(`select current_setting('search_path') as sp`)).rows[0].sp})`);
await bareClone.close();
await c2.close();
await c1.close();

// ---------------------------------------------------------------------
// 3. Why 20261011120000 is in RERUN_UNSAFE
// ---------------------------------------------------------------------
const LOCKDOWN = migrationFiles().find(m => m.version === '20261011120000');
// Pod X has 10 in stock; this sale takes 12.
const shortSale = (target, id) => asUser(target, MAIN_SHOP,
  `select public.process_checkout($1, $2::jsonb, $3::jsonb, '[]'::jsonb, '[]'::jsonb, null, 0)`,
  [MAIN_SHOP,
   JSON.stringify({ id, totalAmount: 18000, paymentMethod: 'cash', saleDate: '2026-10-11T10:00:00.000Z',
                    items: [{ productId: 'prodPod0000000000001', productName: 'Pod X', saleType: 'regular', quantity: 12 }] }),
   JSON.stringify([{ id: 'prodPod0000000000001', deduction: 12 }])]);
const pod = async () => Number((await q1(`select "stockQuantity" s from public.products where id = 'prodPod0000000000001'`)).s);

const copy = await cloneDb(db);
// On the real final state: Pod X has 10, a sale of 12 is kept, stock stops at 0.
await shortSale(db, 'guardShortSale1');
ok('final state: a short sale (10 in stock, 12 sold) is kept, stock stops at 0, shortfall logged',
  !!(await q1(`select 1 x from public.sales where id = 'guardShortSale1'`)) && await pod() === 0
  && (await q1(`select count(*)::int n from public.inventory_logs where "productId" = 'prodPod0000000000001' and action = 'shortfall'`)).n === 1);

// Since 20261012100000 the two RPCs return jsonb, so re-running either
// older file alone after everything else now FAILS ("cannot change return
// type") and, being one transaction, changes nothing.
for (const m of migrationFiles().filter(f => ['20261011120000', '20261011140000'].includes(f.version))) {
  s0 = await dbState(copy);
  let rerr = null;
  try { await copy.exec(read(m.path)); } catch (e) { rerr = e; await copy.exec('rollback').catch(() => {}); }
  ok(`re-running ${m.version} alone on the final state fails (cannot change return type) and changes nothing`,
    !!rerr && /return type/.test(rerr.message) && stateDiff(s0, await dbState(copy)).length === 0, rerr ? rerr.message : '(it ran)');
}
await copy.close();

// Why 20261011120000 must never run again even so: on the state it was
// last safe to compare with (both older files applied, as live was before
// 20261012100000), re-running it puts back bodies without the stock guard.
const old = await replica({ fixtures: true });
await migrate(old, { through: '20261011140000' });
s0 = await dbState(old);
await old.exec(read(LOCKDOWN.path));
d = stateDiff(s0, await dbState(old));
const changed = changedObjects(d).sort();
ok('re-running 20261011120000 after 20261011140000 puts back other bodies of process_checkout and process_reversal',
  changed.includes('function public.process_checkout(text,jsonb,jsonb,jsonb,jsonb,text,numeric)')
  && changed.includes('function public.process_reversal(uuid,text,boolean,jsonb,jsonb,jsonb,text,numeric)'), changed.join('; '));
let err = null;
try { await shortSale(old, 'guardShortSale2'); } catch (e) { err = e; }
ok('... and the same short sale is then REFUSED (stock check constraint) and not saved',
  !!err && /products_stock_not_negative/.test(err.message)
  && !(await old.query(`select 1 from public.sales where id = 'guardShortSale2'`)).rows.length, err ? err.message : '(no error)');
await old.close();
await db.close();

done();
