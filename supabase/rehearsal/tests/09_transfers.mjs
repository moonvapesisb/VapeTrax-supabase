// Shop-to-shop stock transfers (migration 20261012200000_shop_links_and_transfers),
// checked on the state after ALL migrations, each applied twice:
//   * linking with a one-time code: own, expired, reused, replaced and
//     wrong codes refused; 10 wrong codes per hour; cashiers and anon refused;
//   * transfers: admin of the sending shop only, linked shops only, whole
//     quantities, each product once, refused with NOTHING changed when
//     stock is short (stock never below zero);
//   * a device transfer creates the product at the receiver with the
//     sender's prices; an e-liquid transfer moves full sealed bottles and
//     creates the missing ones; an existing receiver product keeps its
//     prices and gets the weighted-average cost; archived products, other
//     bottle sizes and ambiguous names are never merged into;
//   * a retry with the same transfer id answers 'duplicate' and moves nothing;
//     refusals made after that check carry the hint 'transfer_not_applied';
//     retrying a link that worked answers 'linked' again;
//   * the newest sealed bottles move; NaN / Infinity stock is refused and
//     NaN costs count as unknown; a linked product now counted another way
//     (pieces vs ml) is not used;
//   * transfer_out / transfer_in logs on both sides, with refId;
//   * RLS: a shop still cannot read the other shop's products or bottles;
//     both shops (and their cashiers) read the transfer, strangers do not;
//   * running the migration again changes nothing; verify_20261012200000
//     reports all_checks_passed; it records itself in the migration ledger.
// Works with or without 20261012100000 (lockdown follow-up) applied before
// (section 14 applies it without, then records it once the ledger exists).
import path from 'node:path';
import {
  replica, migrate, migrationFiles, asUser, rpc, read, reporter, lastRows, dbState, stateDiff, showDiff, SUPA, MAIN_SHOP,
} from '../lib.mjs';

const FILE = migrationFiles().find(m => m.version === '20261012200000');
const VERIFY = read(path.join(SUPA, 'diagnostics/verify_20261012200000.sql'));

const A = MAIN_SHOP;                                // admin, shop A (main)
const B = '158a7adf-79e5-40c4-a87a-dedab3b9a0bb';   // admin, shop B (the second shop)
const C = '11111111-1111-4111-8111-111111111111';   // cashier of shop A
const X = '33333333-3333-4333-8333-333333333333';   // admin of an unlinked shop
const Y = '44444444-4444-4444-8444-444444444444';   // admin who guesses codes

const { ok, expectError, done } = reporter();
const db = await replica();
await migrate(db);
ok('every migration runs twice without error', !!FILE);

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const q1 = async (sql, p = []) => (await q(sql, p))[0];
const num = v => (v === null || v === undefined ? v : Number(v));
const call = async (uid, fn, args = {}) => (await rpc(db, uid, fn, args)).rows[0].result;
const preview = async (uid, to, ids) => (await asUser(db, uid,
  `select public.preview_transfer($1::uuid, $2::text[]) as r`,
  [to, '{' + ids.map(i => '"' + i + '"').join(',') + '}'])).rows[0].r;
const transfer = (uid, mid, to, items, note = null) =>
  call(uid, 'transfer_stock', { p_client_mutation_id: mid, p_to_shop: to, p_items: items, p_note: note });
const product = id => q1(`select id, "shopId", name, category, "stockQuantity"::float8 as stock, "costPrice"::float8 as cost,
  "sellingPrice"::float8 as sell, "pricePerMl"::float8 as ppm, "unitCostPerMl"::float8 as cpm, "bottleSize"
  from public.products where id = $1`, [id]);
const stock = async id => (await product(id)).stock;
// Everything a refused call must leave untouched.
const snap = async () => JSON.stringify(await q(`select
  (select json_agg(json_build_object('i', id, 's', "shopId", 'q', "stockQuantity", 'c', "costPrice", 'p', "sellingPrice", 'm', "unitCostPerMl") order by id) from public.products) as products,
  (select json_agg(json_build_object('i', id, 's', "shopId", 'p', "productId", 'st', status, 'r', "remainingMl") order by id) from public.bottles) as bottles,
  (select count(*) from public.inventory_logs) as logs,
  (select count(*) from public.stock_transfers) as transfers,
  (select count(*) from public.stock_transfer_items) as items,
  (select count(*) from public.product_links) as links`));

// ---------------------------------------------------------------------
// Two shops, a cashier, two strangers. The archive columns come from
// 20261012100000; they are added here when that file is not present.
// ---------------------------------------------------------------------
await db.exec(`
  alter table public.products add column if not exists "deletedAt" timestamptz;
  alter table public.bottles add column if not exists "archivedAt" timestamptz;
  insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}'), ('${X}'), ('${Y}');
  insert into public.profiles (id, username, role, "shopId") values
    ('${A}', 'ownerA', 'admin', '${A}'), ('${B}', 'ownerB', 'admin', '${B}'),
    ('${C}', 'cashierA', 'cashier', '${A}'), ('${X}', 'ownerX', 'admin', '${X}'), ('${Y}', 'ownerY', 'admin', '${Y}');
  insert into public.settings ("shopId", "shopName") values ('${A}', 'Lodhran Main');
  insert into public.products (id, "shopId", name, category, "costPrice", "sellingPrice", "stockQuantity", "bottleSize", "pricePerMl", "unitCostPerMl", unit, brand, "minStockLevel") values
    ('aPod',    '${A}', 'Pod X',    'device',   1000, 1500,  10, null,   0,  0, 'piece',  'Voopoo', 2),
    ('aMango',  '${A}', 'Mango Ice','e-liquid', 1500, 2000, 120, '30ml', 70, 50, 'bottle', 'Juicy', 60),
    ('aGrape',  '${A}', 'Grape',    'e-liquid', 1200, 1800,  60, '',     60, 40, 'bottle', null, 60),
    ('aCoil',   '${A}', 'Coil 0.8', 'coil',      200,  350,  25, null,   0,  0, 'piece',  null, 2),
    ('aDup',    '${A}', 'Dup Pod',  'device',    500,  800,   5, null,   0,  0, 'piece',  null, 2),
    ('aLychee', '${A}', 'Lychee',   'e-liquid', 2400, 3000, 120, '60',   60, 40, 'bottle', null, 120),
    ('aOld',    '${A}', 'Old Mod',  'device',   3000, 4500,   3, null,   0,  0, 'piece',  null, 1),
    ('bCoil',   '${B}', ' coil 0.8 ', 'Coil',    300,  400,   5, null,   0,  0, 'piece',  null, 2),
    ('bDup1',   '${B}', 'Dup Pod',  'device',    500,  900,   1, null,   0,  0, 'piece',  null, 2),
    ('bDup2',   '${B}', 'dup pod',  'device',    500,  900,   1, null,   0,  0, 'piece',  null, 2),
    ('bLychee', '${B}', 'Lychee',   'e-liquid', 1200, 1600,  30, '30',   55, 40, 'bottle', null, 60),
    ('bOld',    '${B}', 'OLD MOD',  'device',   3000, 5000,   0, null,   0,  0, 'piece',  null, 1),
    ('xPod',    '${X}', 'Pod X',    'device',   1000, 1500,   4, null,   0,  0, 'piece',  null, 2);
  update public.products set "deletedAt" = now() where id = 'bOld';
  -- Shop A's Mango bottle rows are typical live data: not all match stock.
  insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status, "createdAt") values
    ('aB0', 'aMango', '${A}', 30, 30, 'closed', '2026-09-01T00:00:00Z'),
    ('aB1', 'aMango', '${A}', 30, 30, 'closed', '2026-09-02T00:00:00Z'),
    ('aB2', 'aMango', '${A}', 30, 30, 'closed', '2026-09-03T00:00:00Z'),
    ('aB3', 'aMango', '${A}', 30, 15, 'opened', '2026-09-04T00:00:00Z'),
    ('aB4', 'aMango', '${A}', 60, 30, 'closed', '2026-09-05T00:00:00Z'),
    ('aB5', 'aMango', '${A}', 30,  0, 'sold',   '2026-09-06T00:00:00Z'),
    ('bB1', 'bLychee', '${B}', 30, 30, 'closed', '2026-09-01T00:00:00Z');
  update public.bottles set "archivedAt" = now() where id = 'aB0';
`);

// ---------------------------------------------------------------------
// 1. Nothing for anon; no direct writes; link codes unreadable
// ---------------------------------------------------------------------
await expectError('anon cannot create a link code', () => rpc(db, '', 'create_shop_link_code'), /permission denied/);
await expectError('anon cannot transfer', () => rpc(db, '', 'transfer_stock',
  { p_client_mutation_id: 'anon1', p_to_shop: B, p_items: [{ productId: 'aPod', quantity: 1 }] }), /permission denied/);
await expectError('anon cannot read shop_links', () => asUser(db, '', `select * from public.shop_links`), /permission denied/);
await expectError('anon cannot read stock_transfers', () => asUser(db, '', `select * from public.stock_transfers`), /permission denied/);
await expectError('a logged-in user cannot write shop_links directly', () => asUser(db, X,
  `insert into public.shop_links ("shopA", "shopB") values ($1, $2)`, [A < X ? A : X, A < X ? X : A]), /permission denied/);
await expectError('a logged-in user cannot write stock_transfers directly', () => asUser(db, A,
  `insert into public.stock_transfers ("clientMutationId", "fromShop", "toShop", "createdBy") values ('fake', $1, $2, $1)`, [A, B]), /permission denied/);
await expectError('a logged-in user cannot read the link codes', () => asUser(db, A, `select * from private.shop_link_codes`), /permission denied/);

// ---------------------------------------------------------------------
// 2. Linking with a code
// ---------------------------------------------------------------------
await expectError('a cashier cannot create a link code', () => call(C, 'create_shop_link_code'), /Only a shop admin/);
const code1 = await call(A, 'create_shop_link_code');
ok('a link code is 10 characters from the unambiguous alphabet', /^[A-HJ-NP-Z2-9]{10}$/.test(code1.code), JSON.stringify(code1));
const minutes = (new Date(code1.expiresAt) - Date.now()) / 60000;
ok('it expires in 30 minutes', minutes > 29 && minutes <= 30.1, String(minutes));
ok('only its sha256 hash is stored, never the code itself',
  (await q1(`select count(*)::int as n from private.shop_link_codes where "codeHash" = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [code1.code])).n === 1
  && (await q1(`select count(*)::int as n from private.shop_link_codes c where to_jsonb(c)::text like '%' || $1 || '%'`, [code1.code])).n === 0);

const code2 = await call(A, 'create_shop_link_code');
ok('one active code per shop: a new code replaces the unused one',
  (await q1(`select count(*)::int as n from private.shop_link_codes where "shopId" = $1 and "usedAt" is null`, [A])).n === 1);
let r = await call(B, 'link_shop_with_code', { p_code: code1.code });
ok('the replaced code is refused', r.status === 'refused' && r.reason === 'invalid', JSON.stringify(r));
r = await call(A, 'link_shop_with_code', { p_code: code2.code });
ok("a shop's own code is refused", r.status === 'refused' && r.reason === 'own' && /OTHER shop/.test(r.message), JSON.stringify(r));
await expectError('a cashier cannot link shops', () => call(C, 'link_shop_with_code', { p_code: code2.code }), /Only a shop admin/);

const typed = `${code2.code.slice(0, 5).toLowerCase()}-${code2.code.slice(5)} `;
r = await call(B, 'link_shop_with_code', { p_code: typed });
ok('the other shop links with the code (typed in lower case with a dash)',
  r.status === 'linked' && r.linkedShopId === A && r.linkedShopName === 'Lodhran Main', JSON.stringify(r));
ok('the link is stored once, smaller shop id first',
  (await q1(`select count(*)::int as n from public.shop_links where "shopA" = least($1::uuid, $2::uuid) and "shopB" = greatest($1::uuid, $2::uuid)`, [A, B])).n === 1);
const attemptsB = async () => (await q1(`select count(*)::int as n from private.shop_link_attempts where "userId" = $1`, [B])).n;
const attemptsBefore = await attemptsB();   // 1: the replaced code above
r = await call(B, 'link_shop_with_code', { p_code: code2.code });
ok('retrying a link that worked (its answer was lost) answers "linked" again, not "used"',
  r.status === 'linked' && r.linkedShopId === A && r.linkedShopName === 'Lodhran Main', JSON.stringify(r));
ok('... counts no wrong attempt and stores no second link',
  attemptsBefore === 1 && await attemptsB() === attemptsBefore
  && (await q1(`select count(*)::int as n from public.shop_links`)).n === 1, String(attemptsBefore));
r = await call(X, 'link_shop_with_code', { p_code: code2.code });
ok('a used code is refused', r.status === 'refused' && r.reason === 'used', JSON.stringify(r));
ok('... and links nothing', (await q1(`select count(*)::int as n from public.shop_links`)).n === 1);

const code3 = await call(B, 'create_shop_link_code');
await db.query(`update private.shop_link_codes set "expiresAt" = now() - interval '1 minute' where "shopId" = $1 and "usedAt" is null`, [B]);
r = await call(X, 'link_shop_with_code', { p_code: code3.code });
ok('an expired code is refused', r.status === 'refused' && r.reason === 'expired', JSON.stringify(r));

const code4 = await call(A, 'create_shop_link_code');
r = await call(B, 'link_shop_with_code', { p_code: code4.code });
ok('linking shops that are already linked is refused', r.status === 'refused' && r.reason === 'already_linked', JSON.stringify(r));

for (let i = 0; i < 10; i++) {
  r = await call(Y, 'link_shop_with_code', { p_code: `WRONG${String(i).padStart(5, '2')}` });
}
ok('wrong codes are refused and counted (they survive the call)', r.status === 'refused' && r.reason === 'invalid'
  && (await q1(`select count(*)::int as n from private.shop_link_attempts where "userId" = $1`, [Y])).n === 10);
const code5 = await call(B, 'create_shop_link_code');
r = await call(Y, 'link_shop_with_code', { p_code: code5.code });
ok('after 10 wrong codes in an hour even a valid code is refused', r.status === 'refused' && r.reason === 'too_many_attempts', JSON.stringify(r));
ok('... and Y is not linked to B', (await q1(`select count(*)::int as n from public.shop_links`)).n === 1);
ok('... and the valid code is still unused', (await q1(`select count(*)::int as n from private.shop_link_codes where "shopId" = $1 and "usedAt" is null`, [B])).n === 1);

const listA = await call(A, 'list_linked_shops');
const listB = await call(B, 'list_linked_shops');
ok('A lists B by its admin name (B has no shop name in settings)', listA.length === 1 && listA[0].shopId === B && listA[0].name === 'ownerB', JSON.stringify(listA));
ok('B lists A by its shop name', listB.length === 1 && listB[0].shopId === A && listB[0].name === 'Lodhran Main', JSON.stringify(listB));
ok('an unlinked shop lists nothing', (await call(X, 'list_linked_shops')).length === 0);
await expectError('a cashier cannot list linked shops', () => call(C, 'list_linked_shops'), /Only a shop admin/);
ok('both shops and the cashier of A can read the link; a stranger cannot',
  (await asUser(db, A, `select * from public.shop_links`)).rows.length === 1
  && (await asUser(db, B, `select * from public.shop_links`)).rows.length === 1
  && (await asUser(db, C, `select * from public.shop_links`)).rows.length === 1
  && (await asUser(db, X, `select * from public.shop_links`)).rows.length === 0);

// ---------------------------------------------------------------------
// 3. Refusals change nothing
// ---------------------------------------------------------------------
let s0 = await snap();
await expectError('a cashier cannot transfer', () => transfer(C, 'c1', B, [{ productId: 'aPod', quantity: 1 }]), /Only a shop admin/);
await expectError('a transfer to an unlinked shop is refused', () => transfer(A, 'x1', X, [{ productId: 'aPod', quantity: 1 }]), /not linked/);
await expectError('a transfer to the own shop is refused', () => transfer(A, 'x2', A, [{ productId: 'aPod', quantity: 1 }]), /another shop/);
await expectError('a transfer with no lines is refused', () => transfer(A, 'v1', B, []), /at least one product/);
await expectError('a fractional quantity is refused', () => transfer(A, 'v2', B, [{ productId: 'aPod', quantity: 1.5 }]), /whole number/);
await expectError('a zero quantity is refused', () => transfer(A, 'v3', B, [{ productId: 'aPod', quantity: 0 }]), /whole number/);
await expectError('a negative quantity is refused', () => transfer(A, 'v4', B, [{ productId: 'aPod', quantity: -2 }]), /whole number/);
await expectError('a quantity above 10000 is refused', () => transfer(A, 'v5', B, [{ productId: 'aPod', quantity: 10001 }]), /whole number/);
await expectError('NaN is refused', () => transfer(A, 'v6', B, [{ productId: 'aPod', quantity: 'NaN' }]), /whole number/);
await expectError('text is refused', () => transfer(A, 'v7', B, [{ productId: 'aPod', quantity: 'abc' }]), /whole number/);
await expectError('the same product twice is refused', () => transfer(A, 'v8', B,
  [{ productId: 'aPod', quantity: 1 }, { productId: 'aPod', quantity: 2 }]), /listed twice/);
await expectError("another shop's product is refused", () => transfer(A, 'v9', B, [{ productId: 'bCoil', quantity: 1 }]), /not found in this shop/);
await expectError('an e-liquid without a numeric bottle size is refused', () => transfer(A, 'v10', B, [{ productId: 'aGrape', quantity: 1 }]), /bottle size/);
await expectError('a missing transfer id is refused', () => transfer(A, '', B, [{ productId: 'aPod', quantity: 1 }]), /transfer id/);
ok('none of the refused calls changed anything', (await snap()) === s0);

// The app retries an unconfirmed transfer with the same id. Only a refusal
// made AFTER the duplicate check proves the earlier attempt was not saved;
// those carry the hint 'transfer_not_applied', the earlier ones do not.
const errOf = async fn => { try { await fn(); return null; } catch (e) { return e; } };
let e1 = await errOf(() => transfer(A, 'h1', X, [{ productId: 'aPod', quantity: 1 }]));
ok("'not linked' (after the duplicate check) carries the hint transfer_not_applied, code 42501",
  e1?.hint === 'transfer_not_applied' && e1?.code === '42501' && /not linked/.test(e1?.message), `${e1?.code} ${e1?.hint} ${e1?.message}`);
e1 = await errOf(() => transfer(A, 'h2', B, [{ productId: 'aPod', quantity: 1.5 }]));
ok('a line refusal keeps its own code (22023) and message, with the hint',
  e1?.hint === 'transfer_not_applied' && e1?.code === '22023' && /whole number/.test(e1?.message), `${e1?.code} ${e1?.hint} ${e1?.message}`);
e1 = await errOf(() => transfer(C, 'h3', B, [{ productId: 'aPod', quantity: 1 }]));
ok("'only a shop admin' (before the duplicate check) has no such hint", e1 && e1.code === '42501' && !e1.hint, `${e1?.code} ${e1?.hint}`);
e1 = await errOf(() => transfer(A, '', B, [{ productId: 'aPod', quantity: 1 }]));
ok('a missing transfer id (before the duplicate check) has no such hint', e1 && e1.code === '22023' && !e1.hint, `${e1?.code} ${e1?.hint}`);
ok('... and still nothing changed', (await snap()) === s0);

// ---------------------------------------------------------------------
// 4. Preview
// ---------------------------------------------------------------------
const pv = await preview(A, B, ['aPod', 'aMango', 'aCoil', 'aDup', 'aLychee', 'aOld', 'aGrape', 'bCoil', 'aPod']);
const line = id => pv.lines.find(l => l.fromProductId === id);
ok('preview names the other shop and keeps the order, each product once',
  pv.toShopName === 'ownerB' && pv.lines.map(l => l.fromProductId).join() === 'aPod,aMango,aCoil,aDup,aLychee,aOld,aGrape,bCoil', JSON.stringify(pv.lines.map(l => l.fromProductId)));
ok('preview: a product B lacks will be created with the sender price',
  line('aPod').match === 'new' && line('aPod').newSellingPrice === 1500 && line('aPod').toProductId === null);
ok('preview: e-liquid shows its bottle size', line('aMango').isLiquid === true && line('aMango').bottleSize === 30 && line('aMango').match === 'new');
ok("preview: the same name and category (any case, spaces) matches B's product, with B's stock and price",
  line('aCoil').match === 'name' && line('aCoil').toProductId === 'bCoil' && line('aCoil').toStock === 5 && line('aCoil').toSellingPrice === 400,
  JSON.stringify(line('aCoil')));
ok('preview: two products with that name at B means a new one', line('aDup').match === 'new' && line('aDup').nameMatches === 2);
ok('preview: an e-liquid with another bottle size is not merged', line('aLychee').match === 'new');
ok('preview: an archived product at B is not used', line('aOld').match === 'new');
ok('preview: an e-liquid without a bottle size is flagged', /bottle size/.test(line('aGrape').problem || ''));
ok("preview: another shop's product is flagged", /not found/.test(line('bCoil').problem || ''));
await expectError('a cashier cannot preview', () => preview(C, B, ['aPod']), /Only a shop admin/);
await expectError('preview to an unlinked shop is refused', () => preview(A, X, ['aPod']), /not linked/);
ok('preview changed nothing', (await snap()) === s0);

// ---------------------------------------------------------------------
// 5. A device transfer, then its retry
// ---------------------------------------------------------------------
const t1 = await transfer(A, 'mut-pod-1', B, [{ productId: 'aPod', quantity: 3 }], 'first');
const bPodId = t1.lines?.[0]?.toProductId;
ok('device transfer completes', t1.status === 'completed' && !!t1.transferId && t1.lines.length === 1, JSON.stringify(t1));
ok('sender: Pod X 10 -> 7', await stock('aPod') === 7);
const bPod = await product(bPodId);
ok('receiver: the product is created with the sender price and cost, 3 in stock',
  bPod && bPod.shopId === B && bPod.name === 'Pod X' && bPod.category === 'device'
  && bPod.sell === 1500 && bPod.cost === 1000 && bPod.stock === 3 && t1.lines[0].createdProduct === true, JSON.stringify(bPod));
const out1 = await q1(`select * from public.inventory_logs where "refId" = $1 and "shopId" = $2`, [t1.transferId, A]);
const in1 = await q1(`select * from public.inventory_logs where "refId" = $1 and "shopId" = $2`, [t1.transferId, B]);
ok('log in the sending shop: transfer_out, -3, 10 -> 7, reason and transfer id',
  out1 && out1.type === 'transfer_out' && out1.action === 'transfer_out' && num(out1.quantityChange) === -3 && num(out1.change) === -3
  && num(out1.previousStock) === 10 && num(out1.newStock) === 7 && out1.reason === 'Transfer to ownerB'
  && out1.notes.includes(t1.transferId) && out1.createdBy === A && out1.productId === 'aPod', JSON.stringify(out1));
ok('log in the receiving shop: transfer_in, +3, 0 -> 3, reason and transfer id',
  in1 && in1.type === 'transfer_in' && num(in1.quantityChange) === 3 && num(in1.previousStock) === 0 && num(in1.newStock) === 3
  && in1.reason === 'Transfer from Lodhran Main' && in1.notes.includes(t1.transferId) && in1.productId === bPodId, JSON.stringify(in1));
const h1 = await q1(`select * from public.stock_transfers where id = $1`, [t1.transferId]);
ok('the transfer is recorded with both shop names, the note and who made it',
  h1.fromShop === A && h1.toShop === B && h1.status === 'completed' && h1.note === 'first' && h1.lineCount === 1
  && h1.fromShopName === 'Lodhran Main' && h1.toShopName === 'ownerB' && h1.createdBy === A && h1.createdByName === 'ownerA', JSON.stringify(h1));

s0 = await snap();
const t1again = await transfer(A, 'mut-pod-1', B, [{ productId: 'aPod', quantity: 3 }], 'first');
ok("a retry with the same transfer id answers 'duplicate' with the same transfer",
  t1again.status === 'duplicate' && t1again.transferId === t1.transferId && t1again.lines.length === 1, JSON.stringify(t1again));
ok('... and moves nothing twice (stock, bottles, logs, history unchanged)', (await snap()) === s0);
await expectError("another shop cannot reuse a transfer id", () => transfer(B, 'mut-pod-1', A, [{ productId: bPodId, quantity: 1 }]), /another shop/);

const t2 = await transfer(A, 'mut-pod-2', B, [{ productId: 'aPod', quantity: 2 }]);
ok('the next transfer of the same product goes to the same product at B (linked)',
  t2.lines[0].toProductId === bPodId && t2.lines[0].matchedBy === 'linked' && t2.lines[0].createdProduct === false
  && await stock('aPod') === 5 && await stock(bPodId) === 5
  && (await q1(`select count(*)::int as n from public.products where "shopId" = $1 and name = 'Pod X'`, [B])).n === 1);

// ---------------------------------------------------------------------
// 6. E-liquid: sealed bottles move, the missing ones are created
// ---------------------------------------------------------------------
const t3 = await transfer(A, 'mut-mango-1', B, [{ productId: 'aMango', quantity: 3 }]);
const l3 = t3.lines[0];
const bMangoId = l3.toProductId;
ok('e-liquid transfer: 3 sealed bottles of 30 ml = 90 ml', t3.status === 'completed' && l3.quantity === 3 && l3.mlPerUnit === 30 && l3.stockMoved === 90, JSON.stringify(l3));
ok('sender: Mango 120 ml -> 30 ml', await stock('aMango') === 30);
const bMango = await product(bMangoId);
ok('receiver: Mango created with 90 ml, the same bottle size and the sender prices and costs',
  bMango.stock === 90 && bMango.bottleSize === '30ml' && bMango.sell === 2000 && bMango.ppm === 70 && bMango.cpm === 50 && bMango.cost === 1500, JSON.stringify(bMango));
const bot = id => q1(`select "shopId", "productId", status, "remainingMl"::float8 as ml from public.bottles where id = $1`, [id]);
ok('the 2 full closed bottles of 30 ml moved to B under the new product (same ids)',
  (await bot('aB1')).shopId === B && (await bot('aB1')).productId === bMangoId
  && (await bot('aB2')).shopId === B && (await bot('aB2')).productId === bMangoId);
ok('archived, opened, other-size and sold bottles stayed in A',
  (await bot('aB0')).shopId === A && (await bot('aB3')).shopId === A && (await bot('aB4')).shopId === A && (await bot('aB5')).shopId === A);
const bBottles = await q(`select status, "remainingMl"::float8 as ml, "bottleSize"::float8 as size from public.bottles where "shopId" = $1 and "productId" = $2`, [B, bMangoId]);
ok('one new closed 30 ml bottle was created for the rest: B holds 3 sealed bottles = its 90 ml',
  bBottles.length === 3 && bBottles.every(b => b.status === 'closed' && b.ml === 30 && b.size === 30)
  && l3.bottlesMoved === 2 && l3.bottlesCreated === 1, JSON.stringify(bBottles));
const out3 = await q1(`select * from public.inventory_logs where "refId" = $1 and "shopId" = $2`, [t3.transferId, A]);
const in3 = await q1(`select * from public.inventory_logs where "refId" = $1 and "shopId" = $2`, [t3.transferId, B]);
ok('e-liquid logs: ml on both sides, bottles in quantityChange',
  num(out3.mlChange) === -90 && num(out3.newStockMl) === 30 && num(out3.quantityChange) === -3
  && num(in3.mlChange) === 90 && num(in3.newStockMl) === 90 && num(in3.quantityChange) === 3 && /3 sealed bottle\(s\) x 30 ml = 90 ml/.test(in3.notes),
  JSON.stringify([out3, in3]));

// ---------------------------------------------------------------------
// 7. Existing receiver product: prices kept, cost = weighted average
// ---------------------------------------------------------------------
const t4 = await transfer(A, 'mut-coil-1', B, [{ productId: 'aCoil', quantity: 10 }]);
const bCoil = await product('bCoil');
ok("matched by name: B's price stays 400", t4.lines[0].toProductId === 'bCoil' && t4.lines[0].matchedBy === 'name' && bCoil.sell === 400);
ok('... cost is the weighted average (5 x 300 + 10 x 200) / 15 = 233.33, stock 5 -> 15', bCoil.cost === 233.33 && bCoil.stock === 15, JSON.stringify(bCoil));
ok('... sender: Coil 25 -> 15', await stock('aCoil') === 15);
ok('the product pair is remembered both ways',
  (await q1(`select "toProductId" from public.product_links where "fromShop" = $1 and "fromProductId" = 'aCoil' and "toShop" = $2`, [A, B]))?.toProductId === 'bCoil'
  && (await q1(`select "toProductId" from public.product_links where "fromShop" = $1 and "fromProductId" = 'bCoil' and "toShop" = $2`, [B, A]))?.toProductId === 'aCoil');

// A new purchase price at A; B's own prices must not follow.
await db.query(`update public.products set "unitCostPerMl" = 60, "costPrice" = 1800, "sellingPrice" = 2500, "pricePerMl" = 90 where id = 'aMango'`);
const t5 = await transfer(A, 'mut-mango-2', B, [{ productId: 'aMango', quantity: 1 }]);
const bMango2 = await product(bMangoId);
ok('e-liquid into the existing product: prices unchanged (2000, 70 per ml)',
  t5.lines[0].toProductId === bMangoId && bMango2.sell === 2000 && bMango2.ppm === 70, JSON.stringify(bMango2));
ok('... cost per ml weighted (90 x 50 + 30 x 60) / 120 = 52.5, bottle cost 1575, stock 120 ml',
  bMango2.cpm === 52.5 && bMango2.cost === 1575 && bMango2.stock === 120, JSON.stringify(bMango2));
ok('... sender has no full sealed bottle row left, so the bottle is created at B', t5.lines[0].bottlesMoved === 0 && t5.lines[0].bottlesCreated === 1
  && await stock('aMango') === 0);

// ---------------------------------------------------------------------
// 8. Several lines at once; never merged into the wrong product
// ---------------------------------------------------------------------
const t6 = await transfer(A, 'mut-multi-1', B, [
  { productId: 'aOld', quantity: 1 }, { productId: 'aDup', quantity: 1 }, { productId: 'aLychee', quantity: '1' }]);
const l6 = id => t6.lines.find(l => l.fromProductId === id);
ok('a 3-line transfer completes with 3 lines', t6.status === 'completed' && t6.lines.length === 3);
ok('ambiguous name at B (2 matches): a new product is created, the two others untouched',
  l6('aDup').createdProduct && !['bDup1', 'bDup2'].includes(l6('aDup').toProductId)
  && await stock('bDup1') === 1 && await stock('bDup2') === 1);
ok('other bottle size: a new 60 ml Lychee is created, the 30 ml one untouched',
  l6('aLychee').createdProduct && (await product(l6('aLychee').toProductId)).bottleSize === '60'
  && await stock('bLychee') === 30 && l6('aLychee').stockMoved === 60);
ok('archived product at B: a new one is created, the archived one untouched',
  l6('aOld').createdProduct && l6('aOld').toProductId !== 'bOld' && await stock('bOld') === 0);

// ---------------------------------------------------------------------
// 9. Short stock: refused, nothing changed, never below zero
// ---------------------------------------------------------------------
s0 = await snap();
await expectError('a transfer with one short line is refused with a clear message',
  () => transfer(A, 'mut-short-1', B, [{ productId: 'aCoil', quantity: 5 }, { productId: 'aPod', quantity: 99 }]),
  /Not enough stock of "Pod X": 99 asked, but only 5 in stock\. Nothing was transferred\./);
ok('... and nothing changed, not even the line that had enough stock', (await snap()) === s0);
e1 = await errOf(() => transfer(A, 'mut-short-1', B, [{ productId: 'aPod', quantity: 99 }]));
ok("'not enough stock' is P0001 with the hint transfer_not_applied", e1?.code === 'P0001' && e1?.hint === 'transfer_not_applied', `${e1?.code} ${e1?.hint}`);
await expectError('a short e-liquid transfer explains it in bottles and ml',
  () => transfer(A, 'mut-short-2', B, [{ productId: 'aMango', quantity: 1 }]),
  /Not enough stock of "Mango Ice": 1 sealed bottle\(s\) = 30 ml asked, but only 0 ml is in stock/);
ok('... and nothing changed', (await snap()) === s0);
const t7 = await transfer(A, 'mut-short-1', B, [{ productId: 'aPod', quantity: 5 }]);
ok('a refused transfer id can be used again (nothing was saved under it); all 5 left are sent, A at 0',
  t7.status === 'completed' && await stock('aPod') === 0);
await expectError('then even 1 more is refused', () => transfer(A, 'mut-short-3', B, [{ productId: 'aPod', quantity: 1 }]), /Not enough stock/);
const neg = await q1(`select (select count(*) from public.products where "stockQuantity" < 0)::int as p,
                             (select count(*) from public.bottles where "remainingMl" < 0)::int as b`);
ok('nothing is below zero anywhere', neg.p === 0 && neg.b === 0);

// ---------------------------------------------------------------------
// 10. The other way: B sends back to A's original product
// ---------------------------------------------------------------------
const t8 = await transfer(B, 'mut-back-1', A, [{ productId: bPodId, quantity: 1 }]);
ok("B -> A goes back into A's original product (remembered pair)",
  t8.lines[0].toProductId === 'aPod' && t8.lines[0].matchedBy === 'linked' && await stock('aPod') === 1 && await stock(bPodId) === 9);
ok("... A's log says where it came from",
  (await q1(`select reason from public.inventory_logs where "refId" = $1 and "shopId" = $2`, [t8.transferId, A]))?.reason === 'Transfer from ownerB');

// ---------------------------------------------------------------------
// 10b. The newest sealed bottles move; numbers that are not numbers (NaN,
//      Infinity) never pass; a linked product that is now counted another
//      way (pieces vs ml) is not used.
// ---------------------------------------------------------------------
await db.exec(`
  insert into public.products (id, "shopId", name, category, "costPrice", "sellingPrice", "stockQuantity", "bottleSize", "pricePerMl", "unitCostPerMl") values
    ('aMint',  '${A}', 'Mint',          'e-liquid', 1500,                 2000,            90,                   '30', 70, 50),
    ('aNan',   '${A}', 'NaN Pod',       'device',   1000,                 1500,            'NaN'::numeric,       null, 0,  0),
    ('aInf',   '${A}', 'Inf Pod',       'device',   1000,                 1500,            'Infinity'::numeric,  null, 0,  0),
    ('aCoilZ', '${A}', 'Coil Z',        'coil',     'NaN'::numeric,       350,             5,                    null, 0,  0),
    ('bCoilZ', '${B}', 'Coil Z',        'coil',     200,                  400,             4,                    null, 0,  0),
    ('aPrNan', '${A}', 'Price NaN Pod', 'device',   'Infinity'::numeric,  'NaN'::numeric,  2,                    null, 0,  0),
    ('aPodN',  '${A}', 'Pod N',         'device',   900,                  1400,            3,                    null, 0,  0),
    ('bPodN',  '${B}', 'Pod N',         'device',   900,                  1400,            'NaN'::numeric,       null, 0,  0);
  insert into public.bottles (id, "productId", "shopId", "bottleSize", "remainingMl", status, "createdAt") values
    ('mi1', 'aMint', '${A}', 30, 30, 'closed', '2026-09-01T00:00:00Z'),
    ('mi2', 'aMint', '${A}', 30, 30, 'closed', '2026-09-02T00:00:00Z'),
    ('mi3', 'aMint', '${A}', 30, 30, 'closed', null);
`);

const t9 = await transfer(A, 'mut-mint-1', B, [{ productId: 'aMint', quantity: 1 }]);
ok('e-liquid: the NEWEST full sealed bottle moves (the POS opens the oldest first); the older and the undated one stay',
  t9.lines[0].bottlesMoved === 1 && t9.lines[0].bottlesCreated === 0
  && (await bot('mi2')).shopId === B && (await bot('mi2')).productId === t9.lines[0].toProductId
  && (await bot('mi1')).shopId === A && (await bot('mi3')).shopId === A && await stock('aMint') === 60, JSON.stringify(t9.lines[0]));

s0 = await snap();
await expectError('a sender stock of NaN is refused with a clear message (it would pass "stock < asked")',
  () => transfer(A, 'mut-nan-1', B, [{ productId: 'aNan', quantity: 1 }]), /stock figure of "NaN Pod" in this shop is not a number/);
await expectError('a sender stock of Infinity is refused',
  () => transfer(A, 'mut-inf-1', B, [{ productId: 'aInf', quantity: 10000 }]), /stock figure of "Inf Pod" in this shop is not a number/);
await expectError('a receiving product whose stock is NaN is refused',
  () => transfer(A, 'mut-nan-2', B, [{ productId: 'aPodN', quantity: 1 }]), /stock figure of "Pod N" at ownerB is not a number/);
ok('... and none of them changed anything', (await snap()) === s0);
const pvNan = await preview(A, B, ['aNan', 'aInf', 'aPodN']);
ok('preview flags them: not a number here (stock shown as 0), not a number at the other shop',
  /in this shop|here is not a number/.test(pvNan.lines[0].problem || '') && /not a number/.test(pvNan.lines[1].problem || '')
  && /at ownerB is not a number/.test(pvNan.lines[2].problem || '')
  && pvNan.lines[0].fromStock === 0 && pvNan.lines[1].fromStock === 0 && pvNan.lines[2].toStock === 0, JSON.stringify(pvNan.lines));

const t10 = await transfer(A, 'mut-nancost-1', B, [{ productId: 'aCoilZ', quantity: 1 }, { productId: 'aPrNan', quantity: 2 }]);
const l10 = id => t10.lines.find(l => l.fromProductId === id);
const bCoilZ = await product('bCoilZ');
ok("a sender cost that is not a number counts as unknown: B's existing cost stays 200 (never NaN), price 400 kept",
  l10('aCoilZ').toProductId === 'bCoilZ' && bCoilZ.cost === 200 && bCoilZ.sell === 400 && bCoilZ.stock === 5
  && num(l10('aCoilZ').costPerUnit) === 0, JSON.stringify([bCoilZ, l10('aCoilZ')]));
const bPrNan = await product(l10('aPrNan').toProductId);
ok('a product created from one whose cost and price are not numbers gets 0 (unknown), never NaN',
  l10('aPrNan').createdProduct && bPrNan.cost === 0 && bPrNan.sell === 0 && bPrNan.stock === 2, JSON.stringify(bPrNan));

// B turns the product A's Pod X went into into a 30 ml e-liquid.
await db.query(`update public.products set category = 'e-liquid', "bottleSize" = '30' where id = $1`, [bPodId]);
const pvU = await preview(A, B, ['aPod']);
ok('preview: a linked product that is now an e-liquid is not used for pieces', pvU.lines[0].match === 'new', JSON.stringify(pvU.lines[0]));
const t11 = await transfer(A, 'mut-unit-1', B, [{ productId: 'aPod', quantity: 1 }]);
const newPod = t11.lines[0].toProductId;
ok("... the transfer creates a new piece product at B; the e-liquid's ml stock is untouched",
  t11.lines[0].createdProduct === true && newPod !== bPodId && await stock(bPodId) === 9
  && (await product(newPod)).category === 'device' && await stock(newPod) === 1 && await stock('aPod') === 0);
ok('... and the product pair now points to the new product',
  (await q1(`select "toProductId" from public.product_links where "fromShop" = $1 and "fromProductId" = 'aPod' and "toShop" = $2`, [A, B]))?.toProductId === newPod);

// ---------------------------------------------------------------------
// 11. Row Level Security
// ---------------------------------------------------------------------
ok("A still cannot read B's products or bottles (also the ones it sent)",
  (await asUser(db, A, `select id from public.products where "shopId" = $1`, [B])).rows.length === 0
  && (await asUser(db, A, `select id from public.bottles where "shopId" = $1`, [B])).rows.length === 0
  && (await asUser(db, A, `select id from public.products where id = $1`, [bPodId])).rows.length === 0);
ok("B still cannot read A's products", (await asUser(db, B, `select id from public.products where "shopId" = $1`, [A])).rows.length === 0);
const total = (await q1(`select count(*)::int as n from public.stock_transfers`)).n;
const seen = async uid => (await asUser(db, uid, `select id from public.stock_transfers`)).rows.length;
ok('both shops read every transfer between them (both directions)', total === 11 && await seen(A) === total && await seen(B) === total, String(total));
ok("A's cashier reads them too; a stranger reads none", await seen(C) === total && await seen(X) === 0);
const items = async uid => (await asUser(db, uid, `select * from public.stock_transfer_items where "transferId" = $1`, [t6.transferId])).rows.length;
ok('transfer lines: both shops read them, a stranger does not', await items(A) === 3 && await items(B) === 3 && await items(X) === 0);
ok('product pairs: both shops read them, a stranger does not',
  (await asUser(db, A, `select * from public.product_links`)).rows.length > 0
  && (await asUser(db, B, `select * from public.product_links`)).rows.length > 0
  && (await asUser(db, X, `select * from public.product_links`)).rows.length === 0);
await expectError('history cannot be edited', () => asUser(db, B, `update public.stock_transfers set note = 'x'`), /permission denied/);
await expectError('history cannot be deleted', () => asUser(db, A, `delete from public.stock_transfer_items`), /permission denied/);

// ---------------------------------------------------------------------
// 12. Unlinking
// ---------------------------------------------------------------------
ok('unlinking shops that are not linked says so', (await call(X, 'unlink_shop', { p_other: B })).status === 'not_linked');
await expectError('a cashier cannot unlink', () => call(C, 'unlink_shop', { p_other: B }), /Only a shop admin/);
ok('either admin can unlink', (await call(B, 'unlink_shop', { p_other: A })).status === 'unlinked'
  && (await call(A, 'list_linked_shops')).length === 0);
await expectError('after unlinking, transfers are refused', () => transfer(A, 'mut-after-1', B, [{ productId: 'aCoil', quantity: 1 }]), /not linked/);
ok('the history stays readable by both shops', await seen(A) === total && await seen(B) === total);

// ---------------------------------------------------------------------
// 13. The migration again, and its verify script
// ---------------------------------------------------------------------
const before = await dbState(db);
const rows = lastRows(await db.exec(read(FILE.path)));
const diff = stateDiff(before, await dbState(db));
ok('running the migration again changes nothing (schema, rights, policies, functions, rows)', diff.length === 0, showDiff(diff));
ok('its validation table: every check ok', rows.length > 5 && rows.every(x => x.ok === true), JSON.stringify(rows));
const v = JSON.parse((await q1(VERIFY)).jsonb_pretty);
ok('verify_20261012200000: all_checks_passed', v.all_checks_passed === true, JSON.stringify(v.checks));
ok('verify_20261012200000: counts the transfers', v.counts.stock_transfers === total && v.counts.transfer_lines === 14 && v.counts.transfer_logs === 2 * v.counts.transfer_lines, JSON.stringify(v.counts));
ok('the migration ledger records it (once), and its validation table says so',
  (await q1(`select count(*)::int as n from private.schema_migrations where version = '20261012200000'`)).n === 1
  && rows.some(x => x.check === 'migration_ledger' && x.ok === true && /recorded/.test(x.detail)), JSON.stringify(rows));

await db.close();

// ---------------------------------------------------------------------
// 14. Without 20261012100000 (no migration ledger yet): it still applies,
//     twice, and records nothing; once that file has run, running this one
//     again records it.
// ---------------------------------------------------------------------
const bare = await replica();
await migrate(bare, { through: '20261011140000' });
const bareRows = lastRows(await bare.exec(read(FILE.path)));
const bareAgain = lastRows(await bare.exec(read(FILE.path)));
ok('without the ledger: it applies twice, every check ok, the ledger check says there is none yet',
  [bareRows, bareAgain].every(r => r.length > 5 && r.every(x => x.ok === true)
    && r.some(x => x.check === 'migration_ledger' && /no ledger yet/.test(x.detail)))
  && (await bare.query(`select to_regclass('private.schema_migrations') as t`)).rows[0].t === null,
  JSON.stringify(bareRows));
await bare.exec(read(migrationFiles().find(m => m.version === '20261012100000').path));
const afterLedger = lastRows(await bare.exec(read(FILE.path)));
ok('... and after 20261012100000, running it again records it in the ledger',
  afterLedger.every(x => x.ok === true)
  && (await bare.query(`select count(*)::int as n from private.schema_migrations where version = '20261012200000'`)).rows[0].n === 1,
  JSON.stringify(afterLedger));
await bare.close();
done();
