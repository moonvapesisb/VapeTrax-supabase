// supabase/diagnostics/07_integrity_probe.sql
//   * is ONE read-only SELECT: no statement that writes, and no write
//     keyword outside comments and string values (dynamic SQL included);
//   * runs inside a READ ONLY transaction and returns one JSON cell, both
//     after ALL migrations and on live as recorded in MIGRATIONS_LOG.md;
//   * contains no personal data (no fixture name, phone, email or user id
//     appears in its output, and no phone as bare digits either);
//   * on live as recorded (replica + fixtures + the two applied migrations)
//     reports exactly what fixtures.sql plants (every count below was worked
//     out by hand from fixtures.sql);
//   * its expected md5 values are the bodies in the migration files (checked
//     straight from the files, independently of Postgres), they match on the
//     state the migrations log records as live, and they do NOT match on the
//     pre-lockdown replica (so the check cannot pass vacuously).
import crypto from 'node:crypto';
import path from 'node:path';
import { parse, loadModule } from 'libpg-query';
import { replica, migrate, migrationFiles, read, reporter, lastRows, SUPA } from '../lib.mjs';

if (loadModule) await loadModule();
const PROBE_FILE = path.join(SUPA, 'diagnostics/07_integrity_probe.sql');
const PROBE = read(PROBE_FILE);
const { ok, done } = reporter();

// ---------------------------------------------------------------------
// 1. Static: one SELECT, nothing that writes
// ---------------------------------------------------------------------
const tree = await parse(PROBE);
ok('probe parses as exactly one statement', tree.stmts.length === 1, `(${tree.stmts.length})`);
ok('that statement is a SELECT', Object.keys(tree.stmts[0].stmt)[0] === 'SelectStmt');

const nodeNames = new Set(), funcNames = new Set();
(function walk(n) {
  if (Array.isArray(n)) return n.forEach(walk);
  if (!n || typeof n !== 'object') return;
  for (const [k, v] of Object.entries(n)) {
    if (/^[A-Z]/.test(k)) nodeNames.add(k);
    if (k === 'FuncCall') funcNames.add((v.funcname || []).map(x => x.String?.sval).join('.').toLowerCase());
    walk(v);
  }
})(tree);
const writeNodes = [...nodeNames].filter(k => /Stmt$/.test(k) && k !== 'SelectStmt');
ok('no writing statement anywhere in the tree (no data-modifying CTE)', writeNodes.length === 0, writeNodes.join(', '));
const SIDE_EFFECT = /(^|\.)(set_config|nextval|setval|pg_notify|pg_advisory\w*|pg_try_advisory\w*|dblink\w*|lo_\w+|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_switch_wal|pg_create_restore_point|pg_rotate_logfile|pg_file_write)$/;
const badFuncs = [...funcNames].filter(f => SIDE_EFFECT.test(f));
ok('no function call with side effects', badFuncs.length === 0, badFuncs.join(', '));

// Code as Postgres runs it: comments and '...' string values removed;
// $q$...$q$ bodies (dynamic SQL) kept and scanned too.
function codeOnly(sql) {
  let out = '', i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') i++; out += ' '; continue; }
    if (c === '/' && n === '*') {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      out += ' '; continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) { i += 2; continue; }
        if (sql[i] === c) { i++; break; }
        i++;
      }
      out += ' x '; continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        out += ' ' + codeOnly(sql.slice(i + m[0].length, end)) + ' ';
        i = end + m[0].length; continue;
      }
    }
    out += c; i++;
  }
  return out;
}
// The plan's own check, literally: no such word on any line outside "--" comments.
const planWords = PROBE.split('\n').map(l => l.replace(/--.*$/, ''))
  .filter(l => /\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i.test(l));
ok('plan check: no insert/update/delete/alter/create/drop/grant/revoke outside comments', planWords.length === 0, planWords.join(' | '));
const WRITE_WORDS =/\b(insert|update|delete|merge|alter|create|drop|grant|revoke|truncate|copy|call|execute|do|lock|comment|refresh|vacuum|reindex|cluster|set|reset|listen|notify|prepare|begin|commit|rollback|savepoint)\b/gi;
const words = [...new Set((codeOnly(PROBE).match(WRITE_WORDS) || []).map(w => w.toLowerCase()))];
ok('no write keyword outside comments and string values', words.length === 0, words.join(', '));

// ---------------------------------------------------------------------
// 2. Expected md5 values come straight from the migration files
// ---------------------------------------------------------------------
const expected = [...PROBE.matchAll(/\('((?:public|private)\.\w+\([^)]*\))',\s*'([0-9a-f]{32})',\s*'(\d{14})'\)/g)]
  .map(m => ({ signature: m[1], md5: m[2], version: m[3] }));
ok('probe lists 4 expected function bodies', expected.length === 4, JSON.stringify(expected));
for (const e of expected) {
  const file = migrationFiles().find(m => m.version === e.version);
  const fnName = e.signature.slice(0, e.signature.indexOf('('));
  const defs = file ? [...read(file.path).matchAll(new RegExp(
    `create or replace function ${fnName.replace('.', '\\.')}\\([\\s\\S]*?\\bas \\$\\$([\\s\\S]*?)\\$\\$;`, 'gi'))] : [];
  const body = defs.length ? defs[defs.length - 1][1] : null;
  const md5 = body === null ? null : crypto.createHash('md5').update(body.replace(/\r/g, '')).digest('hex');
  ok(`expected md5 of ${fnName} equals its body in ${file ? file.name : e.version}`, md5 === e.md5, `(file: ${md5})`);
}

// ---------------------------------------------------------------------
// 3. Run it: read-only transaction, one JSON cell, no personal data
// ---------------------------------------------------------------------
async function runProbe(db) {
  await db.exec('begin transaction read only');
  try {
    const rows = lastRows(await db.exec(PROBE));
    return { rows, json: rows.length === 1 ? JSON.parse(Object.values(rows[0])[0]) : null };
  } finally {
    await db.exec('rollback').catch(() => {});
  }
}
// Every name, phone, email and user id in the database must be absent from the output.
async function leaks(db, json) {
  const text = JSON.stringify(json).toLowerCase();
  const personal = (await db.query(`
    select v from (
      select email as v from auth.users union all select id::text from auth.users
      union all select username from public.profiles union all select email from public.profiles
      union all select name from public.customers union all select phone from public.customers
      union all select email from public.customers
      union all select "entityName" from public.credits union all select "entityContact" from public.credits
      union all select "shopName" from public.settings
    ) s where coalesce(btrim(v), '') <> ''`)).rows.map(r => r.v.trim().toLowerCase());
  // Phones also as bare digits, in case the output ever shows a normalised phone.
  const phoneDigits = personal.filter(v => /^[+\d][\d\s-]{6,}$/.test(v)).map(v => v.replace(/\D/g, ''));
  return { checked: personal.length, phones: phoneDigits.length,
           leaked: [...personal.filter(v => text.includes(v)), ...phoneDigits.filter(d => text.includes(d))] };
}
// jsonb reorders object keys, so compare with keys sorted (arrays keep order).
const canon = v => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const eq = (name, actual, want) => ok(name, JSON.stringify(canon(actual)) === JSON.stringify(canon(want)),
  `(got ${JSON.stringify(actual)}, want ${JSON.stringify(want)})`);

// 3a. After ALL migrations (each twice) it must keep working, stay
//     read-only, leak nothing, and report the security baseline.
const all = await replica({ fixtures: true });
await migrate(all);
const ra = await runProbe(all);
ok('after all migrations: one row with one column', ra.rows.length === 1 && Object.keys(ra.rows[0]).length === 1);
ok('after all migrations: its cell is JSON', !!ra.json && typeof ra.json === 'object');
const la = await leaks(all, ra.json);
ok(`after all migrations: no name, phone, email or user id in the output (${la.checked} values checked)`, la.leaked.length === 0, la.leaked.join(', '));
// Controls: the check has phones to look for, and it does catch one that is
// printed only as normalised digits (fixture '+923004445556').
ok(`control: the leak check also looks for phones as bare digits (${la.phones} phones)`, la.phones >= 3, `(${la.phones})`);
ok('control: a phone printed as bare digits is caught',
  (await leaks(all, { duplicate_phone_groups: [{ key: '923004445556', rows: 2 }] })).leaked.includes('923004445556'));
eq('after all migrations: RLS everywhere, anon has no table rights, anon can call no function, nothing below zero',
  [ra.json.summary.rls_on_every_public_table, ra.json.summary.anon_has_no_table_privileges,
   ra.json.summary.functions_anon_can_call, ra.json.summary.products_below_zero, ra.json.summary.bottles_below_zero],
  [true, true, [], 0, 0]);

// 3b. The probe is meant for live as recorded in MIGRATIONS_LOG.md: the
//     replica plus the two applied migrations, each run once, as they ran.
//     The exact findings below are asserted on that state, so later
//     migrations that legitimately change data do not need to touch them.
const LIVE_THROUGH = '20261011140000';
const db = await replica({ fixtures: true });
await migrate(db, { through: LIVE_THROUGH, passes: 1 });
const { rows, json: p } = await runProbe(db);
ok('live as recorded: one row with one column, JSON', rows.length === 1 && !!p);
const ll = await leaks(db, p);
ok(`live as recorded: no name, phone, email or user id in the output (${ll.checked} values checked)`, ll.leaked.length === 0, ll.leaked.join(', '));

// ---------------------------------------------------------------------
// 4. It finds every edge case fixtures.sql plants (live as recorded)
// ---------------------------------------------------------------------
const s = p.summary;
eq('summary: rls on every public table', s.rls_on_every_public_table, true);
eq('summary: anon has no table privileges', s.anon_has_no_table_privileges, true);
eq('summary: no function callable by anon', s.functions_anon_can_call, []);
eq('summary: only rls_auto_enable lacks a fixed search_path', s.functions_without_fixed_search_path, ['public.rls_auto_enable()']);
eq('summary: new public functions are executable by everyone by default (Supabase default kept by the lockdown)',
  s.new_public_functions_executable_by_everyone, true);
eq('summary: nothing below zero', [s.products_below_zero, s.bottles_below_zero], [0, 0]);

eq('bottleSize classes per category', p.products_bottleSize.classes_by_category, {
  'device': { null: 1 }, 'Device': { empty: 1 }, 'accessory': { null: 1, other: 1 },
  'e-liquid': { empty: 1, numeric: 1, with_ml: 2 }, ' E-Liquid ': { with_ml: 1 },
});
eq('bottleSize "other" values', p.products_bottleSize.other_values, [{ n: 1, value: 'n/a' }]);

const b = p.bottles;
eq('bottles: total, ml above size, negative, orphan, cross-shop',
  [b.total, b.remaining_more_than_size, b.negative_ml, b.orphans_product_missing, b.cross_shop_product_in_other_shop], [12, 1, 0, 1, 1]);
eq('bottles: status distribution', b.status, { sold: 1, empty: 2, closed: 5, opened: 4 });
const e = b.eliquid_stock_vs_active_bottle_ml;
eq('e-liquid stock vs active bottle ml',
  [e.products, e.mismatched_products, e.total_abs_mismatch_ml, e.stock_ml_total, e.active_bottle_ml_total,
   e.stock_more_than_bottles, e.bottles_more_than_stock, e.stock_but_no_active_bottles], [5, 3, 110, 205, 185, 2, 1, 1]);

eq('category spelling variants', p.value_variants['products.category'],
  [{ normalized: 'device', spellings: ['Device', 'device'] }, { normalized: 'e-liquid', spellings: [' E-Liquid ', 'e-liquid'] }]);
eq('paymentMethod spelling variants', p.value_variants['sales.paymentMethod'], [{ normalized: 'cash', spellings: ['Cash ', 'cash'] }]);
eq('saleType spelling variants', p.value_variants['sales.items.saleType'], [{ normalized: 'refill', spellings: ['Refill ', 'refill'] }]);
eq('raw paymentMethod values (with spaces kept)', p.raw_values['sales.paymentMethod'].map(v => v.value).sort(), [' online', 'Cash ', 'cash', 'credit', 'split']);

const id = t => { const x = p.ids[t]; return [x.total, x.uuid_like, x.firestore_20, x.other]; };
eq('ids: sales (total, uuid, firestore, other)', id('sales'), [9, 1, 8, 0]);
eq('ids: products', id('products'), [9, 1, 8, 0]);
eq('ids: bottles', id('bottles'), [12, 1, 11, 0]);
eq('ids: customers', id('customers'), [6, 0, 6, 0]);
eq('ids: credits', id('credits'), [7, 0, 7, 0]);
eq('ids: inventory_logs (incl. the migration\'s correction log)', id('inventory_logs'), [4, 2, 1, 1]);
ok('ids: only tables with text ids are listed (no settings, no uuid tables)',
  !('settings' in p.ids) && !('inventory_alerts' in p.ids) && !('users' in p.ids));

const si = p.sales_items;
eq('sales.items: lines, not objects, without productId',
  [si.lines, si.lines_not_an_object, si.lines_without_productId, si.sales_with_items_not_an_array], [9, 1, 1, 0]);
eq('sales.items: bottleChanges / refillMl / refillAmount / costPrice line counts',
  [si.lines_with_bottleChanges, si.lines_with_nonempty_bottleChanges, si.lines_with_refillMl, si.lines_with_refillAmount, si.lines_with_costPrice],
  [2, 1, 1, 2, 7]);
eq('sales.items: unit price not in whole rupees', si.unit_price_not_whole_rupees, 1);

eq('missing customers (sales, sales other shop, credits)',
  [p.missing_customers.sales_customer_not_found, p.missing_customers.sales_customer_in_other_shop, p.missing_customers.credits_customer_not_found],
  [1, 1, 1]);
const o = p.others_credits;
eq("'others' credits grouped by lower(trim(name))",
  [o.rows, o.rows_without_name, o.distinct_names_as_typed, o.groups_after_lower_trim, o.groups_with_spelling_variants, o.rows_in_groups_with_variants, o.largest_group_rows],
  [4, 1, 3, 2, 1, 2, 2]);
const cb = p.credit_balance;
eq('creditBalance vs derived (credits + credit sales; credits only)',
  [cb.customers, cb.mismatch_vs_credits_and_credit_sales, cb.total_abs_difference_vs_credits_and_credit_sales, cb.mismatch_vs_credits_only, cb.balance_without_any_history],
  [6, 1, 100, 2, 1]);

const m = c => [p.money[c].more_than_2_decimals, p.money[c].not_whole_rupees];
eq('money: products.costPrice', m('products.costPrice'), [1, 1]);
eq('money: products.sellingPrice', m('products.sellingPrice'), [0, 1]);
eq('money: sales.totalProfit', m('sales.totalProfit'), [1, 2]);
eq('money: sales.totalAmount', m('sales.totalAmount'), [0, 1]);
eq('money: expenses.amount', m('expenses.amount'), [1, 1]);

const sd = p.sale_dates;
eq('sale dates: client formats', sd.client_format, { iso: 5, null: 1, postgres_text: 1, firestore_json: 2 });
eq('sale dates: unparseable, >10 min, >1 h, >1 day, max minutes',
  [sd.client_unparseable, sd.differs_more_than_10_minutes, sd.differs_more_than_1_hour, sd.differs_more_than_1_day, sd.max_difference_minutes],
  [0, 1, 1, 0, 120]);

const d = p.duplicates;
eq('duplicates: product names, name+category+size, phones exact, phones normalised',
  [d.product_name_groups, d.product_name_rows, d.product_name_category_size_groups, d.customer_phone_exact_groups,
   d.customer_phone_exact_rows, d.customer_phone_normalized_groups, d.customer_phone_normalized_rows],
  [1, 2, 1, 1, 2, 2, 5]);

const a = p.accounts;
eq('accounts: users, confirmed, unconfirmed, without profile, providers, roles',
  [a.auth_users, a.confirmed, a.unconfirmed, a.without_profile, a.providers, a.profiles_by_role],
  [3, 2, 1, 1, { email: 2, google: 1 }, { admin: 2 }]);

eq('row counts', [p.row_counts.sales, p.row_counts.products, p.row_counts.bottles, p.row_counts.customers, p.row_counts.credits, p.row_counts.inventory_logs],
  [9, 9, 12, 6, 7, 4]);
const tables = Object.fromEntries(p.tables.map(t => [t.table, t]));
eq('tables: inventory_alerts keeps its single shop policy', tables.inventory_alerts.policies.map(x => x.name), ['inventory_alerts_shop']);
eq('tables: profiles policies', tables.profiles.policies.map(x => x.name).sort(),
  ['profiles_delete', 'profiles_insert_cashier', 'profiles_insert_self', 'profiles_select', 'profiles_update']);
eq('tables: anon has no right on any table', p.tables.filter(t => t.anon !== '').map(t => t.table), []);
eq('tables: inventory_alerts: authenticated may only read, plus update resolved / resolved_at',
  [tables.inventory_alerts.authenticated, tables.inventory_alerts.authenticated_column_rights], ['SELECT', ['resolved:UPDATE', 'resolved_at:UPDATE']]);
eq('tables: profiles: no table-wide update; only username, email, updatedAt are updatable',
  [tables.profiles.authenticated.split(',').includes('UPDATE'), tables.profiles.authenticated_column_rights],
  [false, ['email:UPDATE', 'updatedAt:UPDATE', 'username:UPDATE']]);
ok('rls_auto_enable definition is reported in full', /create or replace function public\.rls_auto_enable\(\)/i.test(p.rls_auto_enable_definition || ''));
eq('event trigger reported (disabled in the replica)', p.event_triggers.map(t => [t.name, t.enabled]), [['ensure_rls', 'D']]);

// ---------------------------------------------------------------------
// 5. Bodies: match on live as recorded; not before the lockdown
// ---------------------------------------------------------------------
const pl = p;
eq('live as recorded: repo_bodies_match', pl.summary.repo_bodies_match, true);
eq('... and every expected function is present and matches',
  pl.functions.filter(f => f.repo_version).map(f => f.matches_repo), [true, true, true, true]);
eq('... and its markers show the lockdown and stock rules are in place',
  ['membership_check', 'replay_safe_insert', 'refill_half_ml_rule', 'shortfall_rule', 'nan_and_huge_guard']
    .map(k => pl.functions.find(f => f.signature.startsWith('public.process_checkout')).markers[k]), [true, true, true, true, true]);

const before = await replica();
const pb = (await runProbe(before)).json;
eq('control: on the pre-lockdown replica repo_bodies_match is false', pb.summary.repo_bodies_match, false);
eq('control: ... is_shop_member is reported missing', pb.expected_functions_missing, ['private.is_shop_member(uuid)']);
eq('control: ... process_checkout does not match', pb.functions.find(f => f.signature.startsWith('public.process_checkout')).matches_repo, false);
eq('control: ... anon could call the old functions', pb.summary.functions_anon_can_call.length > 0, true);
eq('control: ... anon had table rights', pb.summary.anon_has_no_table_privileges, false);
eq('control: ... profiles had RLS off', pb.summary.rls_on_every_public_table, false);

done();
