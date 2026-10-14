// Diagnostic 09: finds sales lost by the old "Edit sale" flow, and only those.
import path from 'node:path';
import { replica, migrate, read, lastRows, SUPA, MAIN_SHOP } from '../lib.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); }
};

const db = await replica();
await migrate(db, { passes: 1 });
await db.exec(`
  insert into auth.users (id) values ('${MAIN_SHOP}') on conflict do nothing;
  -- AAAAAA: edited and re-created (sale exists) -> not lost
  insert into public.sales (id, "shopId", "totalAmount") values ('xxxxxxxxxxxxxxAAAAAA', '${MAIN_SHOP}', 100);
  insert into public.inventory_logs (id, "shopId", "productName", type, action, "mlChange", reason)
    values ('l1', '${MAIN_SHOP}', 'Mango', 'return', 'return', 3, 'Sale edited (restored old): AAAAAA');
  -- BBBBBB: edited, never re-created -> LOST
  insert into public.inventory_logs (id, "shopId", "productName", type, action, "mlChange", reason)
    values ('l2', '${MAIN_SHOP}', 'Mint', 'return', 'return', 5, 'Sale edited (restored old): BBBBBB');
  insert into public.inventory_logs (id, "shopId", "productName", type, action, "quantityChange", reason)
    values ('l3', '${MAIN_SHOP}', 'Pod', 'return', 'return', 1, 'Sale edited (restored old): BBBBBB');
  -- CCCCCC: edited, then deleted on purpose -> not lost
  insert into public.inventory_logs (id, "shopId", "productName", type, action, "quantityChange", reason)
    values ('l4', '${MAIN_SHOP}', 'Coil', 'return', 'return', 2, 'Sale edited (restored old): CCCCCC'),
           ('l5', '${MAIN_SHOP}', 'Coil', 'return', 'return', 2, 'Sale deleted (restored): CCCCCC');
`);

const sql = read(path.join(SUPA, 'diagnostics/09_lost_edits_before_update.sql'));
const out = JSON.parse(lastRows(await db.exec(sql))[0].jsonb_pretty);
ok('counts every edited sale', out.edits_found === 3, JSON.stringify(out));
ok('finds exactly the lost one', out.possibly_lost === 1 && out.lost_sales[0]?.sale_ref === 'BBBBBB', JSON.stringify(out));
ok('lists what was restored for the lost sale', out.lost_sales[0]?.items_restored?.length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
