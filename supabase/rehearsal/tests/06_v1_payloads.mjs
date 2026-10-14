// Replays the captured v1 payloads in fixtures.sql (rehearsal.v1_payloads)
// on the replica with fixtures after ALL migrations, the way the deployed
// app sends them: supabase.rpc(name, args) with named arguments, as the
// main shop's admin. Covers NewSale.handleCompleteSale (regular, refill on
// credit, full bottle with split payment, refill opening an unseen bottle,
// the three-step edit flow) and salesReversal.ts (delete, edit), plus a
// sync-queue retry of a sale the server already saved.
// Later migrations must keep every one of these payloads working.
import { replica, migrate, rpc, asUser, reporter, MAIN_SHOP } from '../lib.mjs';

const { ok, done } = reporter();
const db = await replica({ fixtures: true });
await migrate(db);

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const stock = async id => Number((await one(`select "stockQuantity" s from public.products where id = $1`, [id])).s);
const bottle = async id => one(`select "remainingMl"::float8 as ml, status, "shopId" from public.bottles where id = $1`, [id]);
const credit = async id => Number((await one(`select "creditBalance" c from public.customers where id = $1`, [id])).c);
const saleExists = async id => !!(await one(`select 1 as x from public.sales where id = $1`, [id]));

const P1 = 'prodPod0000000000001', P3 = 'prodMango00000000003', P4 = 'prodGrape00000000004', P6 = 'prodBerry00000000006';
const B3 = 'botl0000000000000003', B4 = 'botl0000000000000004', NEW_BOTTLE = 'b0c1d2e3-f4a5-4b6c-9d7e-000000000001';
const C1 = 'cust0000000000000001';
const SALE = n => `f1e2d3c4-b5a6-4978-8a1b-2c3d4e5f6a0${n}`;

const payloads = (await db.query(`select seq, name, kind, target, args from rehearsal.v1_payloads order by seq`)).rows;
ok('fixtures hold the 8 captured payloads', payloads.length === 8, `(${payloads.length})`);
const byseq = Object.fromEntries(payloads.map(p => [p.seq, p]));

async function replay(seq) {
  const p = byseq[seq];
  if (p.kind === 'rpc') return rpc(db, MAIN_SHOP, p.target, p.args);
  return asUser(db, MAIN_SHOP, `delete from public.${p.target} where id = $1`, [p.args.id]);
}

// starting point (fixtures after the migrations)
ok('start: Pod 10, Mango 75 (bottle 3 at 15 ml), Grape 40, Berry 60, customer credit 850',
  await stock(P1) === 10 && await stock(P3) === 75 && (await bottle(B3)).ml === 15 && await stock(P4) === 40
  && await stock(P6) === 60 && await credit(C1) === 850);

await replay(1);
ok('1 regular cash sale: saved, Pod 10 -> 9', await saleExists(SALE(1)) && await stock(P1) === 9);
const s1 = await one(`select "saleDate", "saleDateClient", "actorName" from public.sales where id = $1`, [SALE(1)]);
ok('1 ... keeps the client sale date and fields', new Date(s1.saleDate).toISOString() === '2026-10-11T09:15:00.000Z'
  && s1.saleDateClient === '2026-10-11T09:15:00.000Z' && s1.actorName === 'main-shop');
const log1 = await one(`select "shopId", "createdBy", "newStock"::float8 as ns from public.inventory_logs where id = 'a0b1c2d3-e4f5-4a6b-8c7d-000000000001'`);
ok('1 ... its log is saved in the shop with the real user id', log1 && log1.shopId === MAIN_SHOP && log1.createdBy === MAIN_SHOP && log1.ns === 9);

await replay(2);
ok('2 refill 1.5 ml x 2 on credit: Mango 75 -> 72, bottle 15 -> 12 opened, credit 850 -> 1060',
  await stock(P3) === 72 && (await bottle(B3)).ml === 12 && (await bottle(B3)).status === 'opened' && await credit(C1) === 1060);

await replay(3);
ok('3 full bottle, split with credit: Grape 40 -> 10, bottle sold at 0, credit 1060 -> 1360',
  await stock(P4) === 10 && (await bottle(B4)).ml === 0 && (await bottle(B4)).status === 'sold' && await credit(C1) === 1360);

// The sync queue retries a sale whose first attempt reached the server.
await replay(3);
ok('retry of 3 (queue resend) changes nothing: Grape 10, credit 1360',
  await stock(P4) === 10 && await credit(C1) === 1360);

await replay(4);
const nb = await bottle(NEW_BOTTLE);
ok('4 refill opening an unseen bottle: Berry 60 -> 58, new bottle saved at 58 ml, opened, in this shop',
  await stock(P6) === 58 && nb && nb.ml === 58 && nb.status === 'opened' && nb.shopId === MAIN_SHOP);

await replay(5);
ok('5 delete of sale 2 with reversal: sale gone, Mango 72 -> 75, bottle back to 15, credit 1360 -> 1150',
  !(await saleExists(SALE(2))) && await stock(P3) === 75 && (await bottle(B3)).ml === 15 && await credit(C1) === 1150);
// Since 20261012100000 the server writes the return log itself (from the
// stored sale, refId = sale id); the client's log rows are ignored.
const rlog = await one(`select "shopId", type, "createdBy" from public.inventory_logs where "refId" = $1 and type = 'return'`, [SALE(2)]);
ok('5 ... return log saved in the shop with the real user id', rlog && rlog.shopId === MAIN_SHOP && rlog.type === 'return' && rlog.createdBy === MAIN_SHOP);
await replay(5);
ok('5 again (double click) restores nothing twice: Mango 75, credit 1150', await stock(P3) === 75 && await credit(C1) === 1150);

await replay(6);
// Since 20261012100000 the reversal always deletes the stored sale (the
// app's own delete right after then affects 0 rows, without error).
ok('6 edit step 1 (reverse): Pod 9 -> 10, the sale is deleted by the reversal', await stock(P1) === 10 && !(await saleExists(SALE(1))));
const r7 = await replay(7);
ok('7 edit step 2 (delete the row directly): 0 rows, no error, stock untouched', r7.affectedRows === 0 && await stock(P1) === 10);
await replay(8);
const s8 = await one(`select "totalAmount"::float8 as t, "saleDate" from public.sales where id = $1`, [SALE(1)]);
ok('8 edit step 3 (same id, quantity 2): sale saved again, Pod 10 -> 8, original sale date kept',
  s8 && s8.t === 3000 && await stock(P1) === 8 && new Date(s8.saleDate).toISOString() === '2026-10-11T09:15:00.000Z');

const neg = await one(`select (select count(*) from public.products where "stockQuantity" < 0)::int as p,
                              (select count(*) from public.bottles where "remainingMl" < 0)::int as b`);
ok('nothing went below zero along the way', neg.p === 0 && neg.b === 0);

done();
