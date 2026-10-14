// The owner's stock rules (migration 20261011140000_stock_never_negative_refill_steps),
// checked on the state after ALL migrations, each applied twice:
//   * negative stock / bottle ml left from the past is reset to 0 and logged;
//   * CHECK rules refuse negative stock and negative bottle ml;
//   * a short sale is KEPT, stock stops at 0, a 'shortfall' log and a
//     best-effort inventory_alerts row are written;
//   * refills only in 0.5 ml steps, whole-number quantities, NaN/Infinity
//     refused; a reversal restores from the STORED sale (since
//     20261012100000), so a negative client "restore" cannot reduce stock;
//   * shop members read and resolve their own alerts only.
// The rows that existed before 20261011140000 ran are created by a
// before-hook, so the repair path is exercised exactly as it ran live.
// Ported from the former supabase/tests/pglite/test_stock_rules.mjs (40 checks).
import path from 'node:path';
import { replica, migrate, asUser, read, reporter, SUPA, MAIN_SHOP } from '../lib.mjs';

const STOCK_RULES = '20261011140000_stock_never_negative_refill_steps.sql';
const VERIFY = read(path.join(SUPA, 'diagnostics/verify_20261011140000.sql'));
const HIST = read(path.join(SUPA, 'diagnostics/06_negative_stock_history.sql'));
const S = MAIN_SHOP, OTHER = '33333333-3333-4333-8333-333333333333';

const { ok, expectError, done } = reporter();
const db = await replica();
const as = (uid, sql, params = []) => asUser(db, uid, sql, params);
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const stock = async id => Number((await q1(`select "stockQuantity" s from public.products where id=$1`, [id])).s);

await migrate(db, {
  before: {
    [STOCK_RULES]: async () => {
      // live state just before the stock rules: negative stock and ml existed
      await db.exec(`
        insert into auth.users (id) values ('${S}'),('${OTHER}');
        insert into public.profiles (id, username, role, "shopId") values ('${S}','owner','admin','${S}'),('${OTHER}','x','admin','${OTHER}');
        insert into public.products (id,"shopId",name,category,"stockQuantity") values
          ('neg','${S}','Was Negative','device',-3), ('pod','${S}','Pod','device',2), ('juice','${S}','Mango','e-liquid',30),
          ('otherp','${OTHER}','Other shop','device',5);
        insert into public.bottles (id,"productId","shopId","bottleSize","remainingMl",status) values ('bneg','juice','${S}',30,-2,'opened');
        insert into public.inventory_logs (id,"shopId","productName",type,action,"newStock") values ('old1','${S}','Pod','sale','sale',-1);
      `);
      const hist = JSON.parse((await q1(HIST)).jsonb_pretty);
      ok('history query runs and finds the past negative entry',
        hist.log_entries_that_left_stock_below_zero === 1 && hist.products_below_zero_right_now.length === 1,
        JSON.stringify(hist).slice(0, 300));
      // worst case from the review: product_id still uuid (the table was empty live)
      await db.exec(`alter table public.inventory_alerts alter column product_id type uuid using null`);
    },
  },
});
ok('every migration runs twice without error', true);
ok('alert product_id converted to text by the migration',
  (await q1(`select data_type from information_schema.columns where table_name='inventory_alerts' and column_name='product_id'`)).data_type === 'text');
ok('negative stock reset to 0', await stock('neg') === 0);
ok('correction log written for the reset',
  (await q1(`select count(*)::int n from public.inventory_logs where "productId"='neg' and reason='Automatic correction: stock was below zero'`)).n === 1);
ok('negative bottle ml reset to 0', Number((await q1(`select "remainingMl" r from public.bottles where id='bneg'`)).r) === 0);
const v = JSON.parse((await q1(VERIFY)).jsonb_pretty);
ok('verify script: all_checks_passed', v.all_checks_passed === true, JSON.stringify(v.checks));

await expectError('direct write of negative stock is refused',
  () => as(S, `update public.products set "stockQuantity" = -1 where id='pod'`), /products_stock_not_negative/);
await expectError('direct write of negative bottle ml is refused',
  () => as(S, `update public.bottles set "remainingMl" = -1 where id='bneg'`), /bottles_remaining_not_negative/);

const sale = (id, items) => JSON.stringify({ id, totalAmount: 100, paymentMethod: 'cash', items, saleDate: '2026-10-11T10:00:00.000Z' });
const chk = (id, items, prods) => as(S,
  `select public.process_checkout($1, $2::jsonb, $3::jsonb, '[]'::jsonb, '[]'::jsonb, null, 0)`,
  [S, sale(id, items), JSON.stringify(prods)]);

await chk('A1', [{ productId: 'pod', productName: 'Pod', saleType: 'regular', quantity: 1 }], [{ id: 'pod', deduction: 1 }]);
ok('normal sale deducts stock (2 -> 1)', await stock('pod') === 1);

await chk('A2', [{ productName: 'Pod', saleType: 'regular', quantity: 3 }], [{ id: 'pod', deduction: 3 }]);
ok('short sale is KEPT (customer already took it)', !!(await q1(`select 1 x from public.sales where id='A2'`)));
ok('short sale stops stock at 0, never negative', await stock('pod') === 0);
const sl = await q1(`select reason, "previousStock", "newStock" from public.inventory_logs where "productId"='pod' and action='shortfall'`);
ok('shortfall log explains it', !!sl && /sold 3 pcs but only 1 pcs was in stock/.test(sl.reason), JSON.stringify(sl));
ok('shortfall alert raised for the owner',
  (await q1(`select count(*)::int n from public.inventory_alerts where product_id='pod'`)).n === 1);

await expectError('refill of 2.3 ml is refused',
  () => chk('R1', [{ productName: 'Mango', saleType: 'refill', refillAmount: 2.3, quantity: 1 }], [{ id: 'juice', deduction: 2.3 }]), /0\.5 ml steps/);
ok('refused sale left nothing behind (no sale, stock unchanged)',
  !(await q1(`select 1 x from public.sales where id='R1'`)) && await stock('juice') === 30);
await expectError('refill of 0.56 ml is refused',
  () => chk('R2', [{ productName: 'Mango', saleType: 'refill', refillAmount: 0.56, quantity: 1 }], [{ id: 'juice', deduction: 0.56 }]), /0\.5 ml steps/);
await chk('R3', [{ productName: 'Mango', saleType: 'refill', refillAmount: 1.5, quantity: 2 }], [{ id: 'juice', deduction: 3 }]);
ok('refill of 1.5 ml x2 accepted (30 -> 27)', await stock('juice') === 27);
await chk('R4', [{ productName: 'Mango', saleType: 'refill', refillAmount: 0.5, quantity: 1 }], [{ id: 'juice', deduction: 0.5 }]);
ok('refill of 0.5 ml accepted (27 -> 26.5)', await stock('juice') === 26.5);
await expectError('fractional quantity refused',
  () => chk('Q1', [{ productName: 'Pod', saleType: 'regular', quantity: 1.5 }], []), /whole number/);
await expectError('negative deduction refused',
  () => chk('N1', [{ productName: 'Pod', saleType: 'regular', quantity: 1 }], [{ id: 'pod', deduction: -5 }]), /Invalid stock deduction/);

await db.query(`insert into public.sales (id,"shopId","totalAmount",items) values ('OLD','${S}',1,'[{"saleType":"refill","refillAmount":2.3,"quantity":1}]')`);
await chk('OLD', [{ productName: 'Mango', saleType: 'refill', refillAmount: 2.3, quantity: 1 }], [{ id: 'juice', deduction: 2.3 }]);
ok('replay of an already-saved sale is still a silent no-op', await stock('juice') === 26.5);

await chk('X1', [{ productName: 'Other', saleType: 'regular', quantity: 1 }], [{ id: 'otherp', deduction: 1 }]);
ok("still cannot touch another shop's product", await stock('otherp') === 5);

await as(S, `select public.process_reversal($1,'A1',false,null,null,$2::jsonb,null,0)`, [S, JSON.stringify([{ productId: 'pod', addition: -1 }])]);
ok('a negative client "restore" is ignored: the reversal restores the stored line (0 -> 1)', await stock('pod') === 1);
await as(S, `select public.process_reversal($1,'A1',true,null,null,$2::jsonb,null,0)`, [S, JSON.stringify([{ productId: 'pod', addition: 1 }])]);
ok('a second delete-reversal of the same sale restores nothing (still 1)', await stock('pod') === 1);
await expectError('anon still blocked',
  () => as('', `select public.process_checkout('${S}', '{"id":"z","totalAmount":1}'::jsonb, '[]','[]','[]')`), /permission denied/);

// ---- review fixes ----
await expectError('NaN quantity refused', () => chk('B1', [{ productName: 'Pod', saleType: 'regular', quantity: 'NaN' }], []), /whole number/);
await expectError('Infinity quantity refused', () => chk('B2', [{ productName: 'Pod', saleType: 'regular', quantity: 'Infinity' }], []), /whole number/);
await expectError('NaN refill refused', () => chk('B3', [{ productName: 'Mango', saleType: 'refill', refillAmount: 'NaN', quantity: 1 }], []), /0\.5 ml steps/);
await expectError('NaN deduction refused', () => chk('B4', [{ productName: 'Pod', saleType: 'regular', quantity: 1 }], [{ id: 'pod', deduction: 'NaN' }]), /Invalid stock deduction/);
ok('NaN attempts left stock untouched', await stock('pod') === 1);

// a broken alerts table must never lose a sale
await db.exec(`alter table public.inventory_alerts rename to inventory_alerts_gone`);
await chk('C1', [{ productName: 'Pod', saleType: 'regular', quantity: 5 }], [{ id: 'pod', deduction: 5 }]);
await db.exec(`alter table public.inventory_alerts_gone rename to inventory_alerts`);
ok('short sale kept even when the alert cannot be written', !!(await q1(`select 1 x from public.sales where id='C1'`)) && await stock('pod') === 0);
ok('shortfall log still written without the alert', (await q1(`select count(*)::int n from public.inventory_logs where action='shortfall' and reason like '%sale %C1%'`)).n === 1);

// alerts are visible and resolvable only inside the shop
const mine = await as(S, `select id from public.inventory_alerts`);
ok('owner can read their shortfall alerts', mine.rows.length === 1);
const theirs = await as(OTHER, `select id from public.inventory_alerts`);
ok("another shop cannot see this shop's alerts", theirs.rows.length === 0);
await as(S, `update public.inventory_alerts set resolved = true, resolved_at = now() where id = $1`, [mine.rows[0].id]);
ok('owner can mark an alert recounted', (await q1(`select resolved from public.inventory_alerts where id=$1`, [mine.rows[0].id])).resolved === true);
await expectError('members cannot create alerts themselves', () => as(S, `insert into public.inventory_alerts (shop_id, product_id, product_name, message) values ($1,'x','x','x')`, [S]), /permission denied/);
await expectError('members cannot delete alerts', () => as(S, `delete from public.inventory_alerts`), /permission denied/);

const v2 = JSON.parse((await q1(VERIFY)).jsonb_pretty);
ok('verify script (with new checks): all_checks_passed', v2.all_checks_passed === true, JSON.stringify(v2.checks));
const hist2 = JSON.parse((await q1(HIST)).jsonb_pretty);
ok('history query reports old odd refills/quantities', typeof hist2.old_sales_with_refills_not_in_half_ml_steps === 'number' && hist2.old_sales_with_refills_not_in_half_ml_steps >= 1, JSON.stringify(hist2).slice(0, 200));

done();
