// Shared helpers for the database rehearsal (supabase/rehearsal).
//
// Everything here runs on a local, in-memory PGlite (Postgres 17) database.
// Nothing in this folder connects to Supabase or to production.
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { parse, loadModule } from 'libpg-query';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REHEARSAL = path.dirname(fileURLToPath(import.meta.url));
export const SUPA = path.resolve(REHEARSAL, '..');
export const ROOT = path.resolve(SUPA, '..');

/** The one live shop. Its admin account id is also the shop id. */
export const MAIN_SHOP = 'c7587ec2-753c-4767-a9f3-8bcf6b30e685';

/** Decodes a SQL file: UTF-8 (BOM stripped) or UTF-16 with a BOM. */
export function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}
export const read = p => decode(fs.readFileSync(p));

/** The .sql files directly inside a folder, sorted by name ([] if the folder is missing). */
export const sqlIn = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => path.join(dir, f))
  : [];

/** Repo-relative path with forward slashes, for messages. */
export const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

export const MIGRATION_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/**
 * Migrations that are NOT safe to run again once later files have run.
 * Each one needs the reason, and a "never run again" line for the owner in
 * MIGRATIONS_LOG.md. run.mjs (section 3) checks that each entry still
 * changes the database or fails when re-run (so the list stays honest), and
 * migrate() runs them on the first pass only.
 */
export const RERUN_UNSAFE = new Map([
  // Its `create or replace` would put back process_checkout and
  // process_reversal WITHOUT the never-below-zero guard that 20261011140000
  // added, while the CHECK constraints stay: short or offline sales would
  // then be refused and stuck in the sync queue. Since 20261012100000 the
  // two functions return jsonb, so a re-run now fails ("cannot change
  // return type") and rolls back; it must still never be run again. Its own
  // header still says "Safe to run more than once" (true only before
  // 20261011140000); the file is immutable.
  ['20261011120000_emergency_security_lockdown.sql', 'it would undo 20261011140000 and 20261012100000 (today it fails: the two RPCs now return jsonb)'],
  // Its `create or replace` of process_checkout / process_reversal (returns
  // void) would put back the pre-20261012100000 bodies: client-supplied
  // restore amounts, cashier reversals, no ordered locks. Since
  // 20261012100000 a re-run fails ("cannot change return type") and rolls
  // back; it must still never be run again.
  ['20261011140000_stock_never_negative_refill_steps.sql', 'it would undo 20261012100000 (today it fails: the two RPCs now return jsonb)'],
  // Its `create or replace` of process_checkout / process_reversal and its
  // `drop_all_policies` on finance_accounts / finance_transactions would
  // overwrite 20261127100000's finance ledger hooks and SELECT policies.
  ['20261012100000_lockdown_followup.sql', 'it would overwrite 20261127100000 process_checkout/process_reversal and drop finance SELECT policies'],
]);

/** Every migration in supabase/migrations, in filename (= apply) order. */
export function migrationFiles() {
  return sqlIn(path.join(SUPA, 'migrations')).map(p => {
    const name = path.basename(p);
    return { name, version: name.slice(0, 14), path: p };
  });
}

/** A fresh, empty PGlite database with the extensions Supabase provides. */
export async function newDb() {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } });
  await db.waitReady;
  return db;
}

/**
 * A fresh replica of the live database as it was before 20261011120000.
 * fixtures: also load supabase/rehearsal/fixtures.sql (synthetic edge cases).
 */
export async function replica({ fixtures = false } = {}) {
  const db = await newDb();
  // replica.sql and fixtures.sql refuse to run unless this marker is set,
  // so pasting them into the Supabase SQL Editor does nothing.
  await db.exec(`set rehearsal.replica = 'on'`);
  await db.exec(read(path.join(REHEARSAL, 'replica.sql')));
  if (fixtures) await db.exec(read(path.join(REHEARSAL, 'fixtures.sql')));
  return db;
}

/**
 * A copy of db (PGlite clone) that runs with the same session settings.
 * A clone is a new session, and PGlite does not apply ALTER DATABASE ... SET
 * to it. Without this the copy would run with search_path = public instead
 * of Supabase's "$user", public, extensions (set by replica.sql, used on
 * live), so an unqualified uuid_generate_v4() or digest() would fail on the
 * copy only, and the copy would lack the rehearsal marker. Throws if the
 * copy's settings still differ from db's.
 */
export async function cloneDb(db) {
  const settings = async d => (await d.query(
    `select current_setting('search_path') as search_path,
            coalesce(current_setting('rehearsal.replica', true), '') as marker,
            current_user::text as role`)).rows[0];
  const want = await settings(db);
  const copy = await db.clone();
  await copy.query(`select set_config('search_path', $1, false), set_config('rehearsal.replica', $2, false)`,
    [want.search_path, want.marker]);
  const got = await settings(copy);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    await copy.close();
    throw new Error(`cloneDb: the copy runs with ${JSON.stringify(got)}, the original with ${JSON.stringify(want)}`);
  }
  return copy;
}

/**
 * Applies the migrations in filename order, the whole sequence `passes`
 * times (2 by default: every file must be safe to run again). Files listed
 * in RERUN_UNSAFE (applied on live, never to be run again) run on the
 * first pass only.
 *   through: only migrations whose version (or name) is <= this value.
 *   before:  { '<migration file name>': async db => {...} } runs once, just
 *            before the first application of that file. Use it to create
 *            the live state a migration must cope with (for example rows
 *            that existed before it ran).
 *   log:     optional (message) => void.
 */
export async function migrate(db, { passes = 2, through, before = {}, log } = {}) {
  const files = migrationFiles().filter(m => !through || m.version <= through || m.name <= through);
  const unknown = Object.keys(before).filter(k => !files.some(f => f.name === k));
  if (unknown.length) throw new Error(`before-hook for a migration that is not applied: ${unknown.join(', ')}`);
  for (let pass = 1; pass <= passes; pass++) {
    for (const m of files) {
      if (pass > 1 && RERUN_UNSAFE.has(m.name)) continue;
      if (pass === 1 && before[m.name]) await before[m.name](db);
      const t0 = Date.now();
      try {
        await db.exec(read(m.path));
      } catch (e) {
        await db.exec('rollback').catch(() => {});
        throw new Error(`${m.name} failed on pass ${pass}: ${e.message}`);
      }
      log?.(`pass ${pass}: ${m.name} (${Date.now() - t0} ms)`);
    }
  }
  return files;
}

const ROLES = new Set(['anon', 'authenticated', 'service_role']);

/**
 * Runs one statement the way PostgREST does for a request: inside its own
 * transaction, as role `authenticated` (or `anon` when uid is empty), with
 * request.jwt.claims set like PostgREST 12. Throws on error.
 */
export async function asUser(db, uid, sql, params = [], { role, legacyClaim = false } = {}) {
  const r = role || (uid ? 'authenticated' : 'anon');
  if (!ROLES.has(r)) throw new Error(`unknown role ${r}`);
  return db.transaction(async tx => {
    await tx.exec(`set local role ${r}`);
    if (legacyClaim) {
      // Older PostgREST versions set one setting per claim.
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
    } else {
      const claims = uid ? { sub: uid, role: r, aud: 'authenticated' } : { role: r };
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    }
    return tx.query(sql, params);
  });
}

const ident = s => '"' + String(s).replace(/"/g, '""') + '"';

/**
 * Calls a database function with named arguments, the way
 * supabase.rpc(name, args) does through PostgREST: the overload is chosen by
 * argument names, JSON values go to jsonb parameters as JSON, everything else
 * as text cast to the parameter type.
 */
export async function rpc(db, uid, fn, args = {}) {
  const [schema, name] = fn.includes('.') ? fn.split('.') : ['public', fn];
  const { rows } = await db.query(
    `select p.proargnames as names, p.pronargdefaults as ndefaults,
            array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 and p.proname = $2`, [schema, name]);
  const keys = Object.keys(args);
  const fits = rows.filter(r => {
    const names = r.names || [];
    const required = names.slice(0, r.types.length - r.ndefaults);
    return keys.every(k => names.includes(k)) && required.every(a => keys.includes(a));
  });
  if (fits.length !== 1) throw new Error(`rpc ${fn}(${keys.join(', ')}): ${fits.length} matching functions`);
  const f = fits[0];
  const params = [];
  const parts = keys.map(k => {
    const type = f.types[f.names.indexOf(k)];
    const v = args[k];
    params.push(v === null || v === undefined ? null
      : (type === 'jsonb' || type === 'json') ? JSON.stringify(v) : String(v));
    return `${ident(k)} => $${params.length}::text::${type}`;
  });
  return asUser(db, uid, `select ${ident(schema)}.${ident(name)}(${parts.join(', ')}) as result`, params);
}

/** Row count of every table in a schema, as { table: n }. */
export async function rowCounts(db, schema = 'public') {
  const { rows } = await db.query(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind in ('r', 'p') order by 1`, [schema]);
  const out = {};
  for (const { t } of rows) out[t] = (await db.query(`select count(*)::int as n from ${ident(schema)}.${ident(t)}`)).rows[0].n;
  return out;
}

/** The last result set of a multi-statement script that returned rows. */
export const lastRows = results => [...results].reverse().find(r => r.fields?.length)?.rows ?? [];

// Everything a SQL file could change, one line per object, as
// "<kind> <name> field=value ...". Runs with search_path = pg_catalog, so
// every name is schema-qualified. $1 = schemas, $2 = also include
// database-wide objects (roles, extensions, default privileges, event
// triggers, publications).
const STATE_SQL = `
select x from (
  select 'schema ' || n.nspname || ' owner=' || n.nspowner::regrole::text || ' acl=' || coalesce(n.nspacl::text, 'default') as x
    from pg_namespace n where n.nspname = any($1)
  union all
  select 'function ' || n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')'
         || ' def=' || md5(pg_get_functiondef(p.oid)) || ' acl=' || coalesce(p.proacl::text, 'default')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = any($1) and p.prokind in ('f', 'p')
  union all
  select 'relation ' || c.oid::regclass::text || ' kind=' || c.relkind::text || ' rls=' || c.relrowsecurity
         || ' force=' || c.relforcerowsecurity || ' acl=' || coalesce(c.relacl::text, 'default')
         || case when c.relkind in ('v', 'm') then ' def=' || md5(pg_get_viewdef(c.oid)) else '' end
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  union all
  select 'column ' || c.oid::regclass::text || '.' || quote_ident(a.attname) || ' type=' || format_type(a.atttypid, a.atttypmod)
         || ' notnull=' || a.attnotnull || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
         || ' acl=' || coalesce(a.attacl::text, 'default')
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint ' || coalesce(nullif(co.conrelid, 0)::regclass::text, nullif(co.contypid, 0)::regtype::text, n.nspname)
         || '.' || quote_ident(co.conname) || ' def=' || pg_get_constraintdef(co.oid)
    from pg_constraint co join pg_namespace n on n.oid = co.connamespace
   where n.nspname = any($1)
  union all
  select 'index ' || c.oid::regclass::text || ' def=' || pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any($1)
  union all
  select 'trigger ' || c.oid::regclass::text || '.' || quote_ident(t.tgname) || ' enabled=' || t.tgenabled::text
         || ' def=' || md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any($1) and not t.tgisinternal
  union all
  select 'policy ' || p.schemaname || '.' || p.tablename || '.' || quote_ident(p.policyname) || ' permissive=' || p.permissive
         || ' cmd=' || p.cmd || ' roles=' || p.roles::text || ' using=' || coalesce(p.qual, '') || ' check=' || coalesce(p.with_check, '')
    from pg_policies p where p.schemaname = any($1)
  union all
  select 'role ' || r.rolname || ' super=' || r.rolsuper || ' login=' || r.rolcanlogin || ' bypassrls=' || r.rolbypassrls
         || ' inherit=' || r.rolinherit || ' createrole=' || r.rolcreaterole || ' createdb=' || r.rolcreatedb
    from pg_roles r where $2::boolean and r.rolname !~ '^pg_'
  union all
  select 'extension ' || e.extname || ' version=' || e.extversion || ' schema=' || e.extnamespace::regnamespace::text
    from pg_extension e where $2::boolean
  union all
  select 'default-acl ' || coalesce(nullif(d.defaclnamespace, 0)::regnamespace::text, '*') || '/' || d.defaclrole::regrole::text
         || '/' || d.defaclobjtype::text || ' acl=' || d.defaclacl::text
    from pg_default_acl d where $2::boolean
  union all
  select 'event-trigger ' || t.evtname || ' event=' || t.evtevent || ' fn=' || t.evtfoid::regprocedure::text || ' enabled=' || t.evtenabled::text
    from pg_event_trigger t where $2::boolean
  union all
  select 'publication ' || p.pubname || ' all=' || p.puballtables || ' ins=' || p.pubinsert || ' upd=' || p.pubupdate
         || ' del=' || p.pubdelete || ' trunc=' || p.pubtruncate
    from pg_publication p where $2::boolean
  union all
  select 'publication-table ' || t.pubname || '/' || t.schemaname || '.' || t.tablename
    from pg_publication_tables t where $2::boolean
) s`;

/**
 * A fingerprint of the database: one line per schema, function (full
 * definition and rights), table or view (RLS, rights), column, constraint,
 * index, trigger and policy, plus the row count and an md5 of the contents of
 * every table. Compare two with stateDiff(). Sequence positions are left
 * out: a rolled-back nextval() still moves them.
 *   schemas: only these schemas. Default: every non-system schema, plus
 *            roles, extensions, default privileges, event triggers and
 *            publications.
 */
export async function dbState(db, { schemas } = {}) {
  // Fixed search_path while reading, so names print the same whatever a
  // migration left it at; the caller's setting is put back afterwards.
  const { sp } = (await db.query(`select current_setting('search_path') as sp`)).rows[0];
  await db.query(`select set_config('search_path', 'pg_catalog', false)`);
  try {
    const list = schemas ?? (await db.query(
      `select nspname from pg_namespace where nspname <> 'information_schema' and nspname !~ '^pg_' order by 1`)).rows.map(r => r.nspname);
    const items = (await db.query(STATE_SQL, [list, !schemas])).rows.map(r => r.x);
    const { rows: tables } = await db.query(
      `select n.nspname as s, c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any($1) and c.relkind in ('r', 'p') order by 1, 2`, [list]);
    for (const { s, t } of tables) {
      const name = `${ident(s)}.${ident(t)}`;
      const r = (await db.query(
        `select count(*)::int as n, md5(coalesce(string_agg(x::text, E'\\n' order by x::text), '')) as h from ${name} x`)).rows[0];
      items.push(`rows ${name} n=${r.n} contents=${r.h}`);
    }
    return items.sort();
  } finally {
    await db.query(`select set_config('search_path', $1, false)`, [sp]);
  }
}

/** What changed between two dbState() results: '- old line' / '+ new line'. [] when nothing did. */
export function stateDiff(a, b) {
  const A = new Set(a), B = new Set(b);
  return [...a.filter(x => !B.has(x)).map(x => '- ' + x), ...b.filter(x => !A.has(x)).map(x => '+ ' + x)];
}

/** The objects a stateDiff() touches, e.g. 'function public.process_checkout(text,jsonb,...)'. */
export const changedObjects = lines => [...new Set(lines.map(l => l.slice(2).replace(/ [a-z_]+=[\s\S]*$/, '')))];

/** A stateDiff() for a failure message: at most `max` lines, then a count. */
export const showDiff = (lines, max = 12) =>
  '\n    ' + lines.slice(0, max).map(l => (l.length > 240 ? l.slice(0, 240) + ' ...' : l)).join('\n    ')
  + (lines.length > max ? `\n    ... ${lines.length - max} more` : '');

/** The statements of a SQL text as libpg-query parse trees. Throws if it does not parse. */
async function parseStmts(sql) {
  if (loadModule) await loadModule();
  return (await parse(sql)).stmts.map(s => s.stmt);
}

/** Every object node of a parse tree, depth first. */
function* treeNodes(n) {
  if (Array.isArray(n)) for (const x of n) yield* treeNodes(x);
  else if (n && typeof n === 'object') { yield n; for (const v of Object.values(n)) yield* treeNodes(v); }
}

/** 'TRANS_STMT_ROLLBACK_TO' -> 'rollback to'. */
const txWord = kind => kind.replace('TRANS_STMT_', '').toLowerCase().replace(/_/g, ' ');

// ---------------------------------------------------------------------
// Diagnostics (supabase/diagnostics/*.sql)
// ---------------------------------------------------------------------

// set transaction ..., set session characteristics as transaction ...,
// transaction_read_only, default_transaction_read_only, transaction_isolation ...
const TX_SETTING = /transaction|session characteristics/i;

/**
 * Why a supabase/diagnostics/*.sql file cannot be proven read-only by
 * running it inside a read-only transaction. [] when it can. A transaction
 * statement (begin, commit, rollback, savepoint, ...) would end or replace
 * that transaction, and `set transaction read write` (or any other change
 * of the transaction mode) before the file's first query would lift it. The
 * file could then write here, and it certainly writes on live, where the
 * SQL Editor runs it with no read-only transaction at all.
 */
export async function diagnosticProblems(sql) {
  let stmts;
  try { stmts = await parseStmts(sql); } catch (e) { return [`it does not parse: ${e.message}`]; }
  if (!stmts.length) return ['it has no statement'];
  const problems = new Set();
  for (const n of treeNodes(stmts)) {
    if (n.TransactionStmt)
      problems.add(`it has a transaction statement (${txWord(n.TransactionStmt.kind)}): a diagnostic must not end or replace the read-only transaction it is checked in`);
    const v = n.VariableSetStmt;
    if (v && TX_SETTING.test(v.name || ''))
      problems.add(`it changes the transaction mode (set ${v.name.toLowerCase()}): a diagnostic must not lift the read-only transaction it is checked in`);
  }
  return [...problems];
}

/**
 * Why a query result is not the one JSON cell a diagnostic must end with.
 * The SQL Editor shows only the last statement's result, and the owner
 * pastes that cell back. null when it is: one row, one column, holding a
 * JSON object or array (jsonb, json, or text with JSON in it), never NULL.
 */
export function jsonCellProblem(result) {
  if (!result?.fields?.length) return 'its last statement returns no result (the SQL Editor shows only the last one)';
  const { rows, fields } = result;
  if (rows.length !== 1 || fields.length !== 1)
    return `its last result has ${rows.length} row(s) and ${fields.length} column(s); expected one JSON cell`;
  let v = Object.values(rows[0])[0];
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return 'its one cell is not JSON'; }
  }
  if (v === null || v === undefined) return 'its one cell is NULL; expected a JSON object or array';
  if (typeof v !== 'object') return `its one cell is ${JSON.stringify(v).slice(0, 60)}; expected a JSON object or array`;
  return null;
}

/**
 * Checks a supabase/diagnostics/*.sql file and returns what is wrong with
 * it ([] = nothing): diagnosticProblems() first (a refused file is not
 * run), then the file inside `begin transaction read only` ... rollback,
 * then a comparison of dbState() before and after (nothing may change),
 * then jsonCellProblem() on its last result.
 */
export async function checkDiagnostic(db, sql) {
  const refused = await diagnosticProblems(sql);
  if (refused.length) return [`not run: ${refused.join('; ')}`];
  const before = await dbState(db);
  let err = null, results = [];
  try {
    await db.exec('begin transaction read only');
    results = await db.exec(sql);
  } catch (e) { err = e; }
  await db.exec('rollback').catch(() => {});
  const problems = [];
  if (err) problems.push(err.message);
  const changes = stateDiff(before, await dbState(db));
  if (changes.length) problems.push(`it changed the database:${showDiff(changes)}`);
  const cell = err ? null : jsonCellProblem(results[results.length - 1]);
  if (cell) problems.push(cell);
  return problems;
}

// ---------------------------------------------------------------------
// Smoke tests (supabase/tests/*.sql)
// ---------------------------------------------------------------------

/** The line every smoke test prints last, after its final rollback. */
export const SMOKE_PASSED = 'ALL TESTS PASSED';
const FAIL_TEXT = /^\s*(SMOKE\s+)?FAIL/i;
const SAVEPOINT_KINDS = new Set(['TRANS_STMT_SAVEPOINT', 'TRANS_STMT_RELEASE', 'TRANS_STMT_ROLLBACK_TO']);

// select 'ALL TESTS PASSED' [as name] [, more constants [as name]], and
// nothing more (no from, where, function call, cast, into, with, union):
// constants only, so it can change nothing although it runs after the
// rollback.
function isPassedLine(stmt) {
  const only = (o, keys) => !!o && typeof o === 'object' && Object.keys(o).every(k => keys.includes(k));
  const s = stmt?.SelectStmt;
  if (!only(s, ['targetList', 'limitOption', 'op']) || s.op !== 'SETOP_NONE' || !s.targetList?.length) return false;
  if (s.limitOption && s.limitOption !== 'LIMIT_OPTION_DEFAULT') return false;
  const cols = s.targetList.map(t => t.ResTarget);
  if (!cols.every(t => only(t, ['name', 'val', 'location']) && only(t.val, ['A_Const']))) return false;
  const first = cols[0].val.A_Const;
  return only(first, ['sval', 'location']) && first.sval?.sval === SMOKE_PASSED;
}

/**
 * Why a supabase/tests/*.sql smoke test does not have the required shape
 * ([] when it has it):
 *
 *   begin;
 *   ...checks; every failed check raises an exception ('FAIL: ...')...
 *   rollback;
 *   select 'ALL TESTS PASSED' as result;   -- more constant columns allowed
 *
 * The SQL Editor COMMITS whatever a file leaves open, so the first
 * statement must be begin (or start transaction) and the final rollback a
 * plain one, with no transaction statement in between except savepoints
 * (no commit, end, other rollback, prepare transaction). The SQL Editor
 * also shows only the last result, so the file ends with that constant
 * line: it is what the owner sees and pastes back. A failed check stops the
 * file before that line, and the owner sees the error instead.
 */
export async function smokeShapeProblems(sql) {
  let stmts;
  try { stmts = await parseStmts(sql); } catch (e) { return [`it does not parse: ${e.message}`]; }
  const problems = [];
  const passedLine = stmts.length > 0 && isPassedLine(stmts[stmts.length - 1]);
  if (!passedLine)
    problems.push(`its last statement must be select '${SMOKE_PASSED}' (constants only; the SQL Editor shows only the last result: it is the line the owner pastes back)`);
  const body = passedLine ? stmts.slice(0, -1) : stmts;
  const tx = body.map(s => s.TransactionStmt || null);
  const first = tx[0], last = tx[tx.length - 1];
  if (!first || !['TRANS_STMT_BEGIN', 'TRANS_STMT_START'].includes(first.kind))
    problems.push('its first statement must be begin');
  if (body.length < 2 || !last || last.kind !== 'TRANS_STMT_ROLLBACK' || last.chain)
    problems.push(`a plain rollback must come just before select '${SMOKE_PASSED}' (the SQL Editor commits whatever is left open)`);
  tx.slice(1, -1).forEach((t, i) => {
    if (t && !SAVEPOINT_KINDS.has(t.kind))
      problems.push(`statement ${i + 2} is ${txWord(t.kind)}: only savepoints may come between begin and the final rollback`);
  });
  return problems;
}

/**
 * Runs a supabase/tests/*.sql smoke test exactly as the SQL Editor runs it:
 * bare, with no transaction added (after smokeShapeProblems(): a file of the
 * wrong shape is not run). Returns what is wrong ([] = it passed): an error
 * (a failed check raises one), anything it left behind (it would be
 * committed on live), a last result other than the one line
 * ALL TESTS PASSED, or a failure reported only in a result row or a notice,
 * which the owner would never see.
 */
export async function checkSmokeTest(db, sql) {
  const shape = await smokeShapeProblems(sql);
  if (shape.length) return [`not run: ${shape.join('; ')}`];
  const before = await dbState(db);
  const notices = [];
  let err = null, results = [];
  try {
    // Rows as arrays: columns with the same name stay apart.
    results = await db.exec(sql, { rowMode: 'array', onNotice: n => notices.push(n.message) });
  } catch (e) {
    err = e;
    // Its transaction is left aborted (the rest of the file is skipped, as
    // in the SQL Editor): end it.
    await db.exec('rollback').catch(() => {});
  }
  const problems = [];
  if (err) problems.push(err.message);
  const changes = stateDiff(before, await dbState(db));
  if (changes.length) problems.push(`it left changes behind; they would be committed on live:${showDiff(changes)}`);
  const last = results[results.length - 1];
  if (!err && !(last?.rows?.length === 1 && last.rows[0][0] === SMOKE_PASSED))
    problems.push(`its last result is not the one line ${SMOKE_PASSED}`);
  const quote = list => list.slice(0, 3).map(v => JSON.stringify(v.slice(0, 80))).join(', ');
  const failRows = results.flatMap(r => r.rows).flat().filter(v => typeof v === 'string' && FAIL_TEXT.test(v));
  if (failRows.length)
    problems.push(`a result row reports a failure (${quote(failRows)}): the SQL Editor shows only the last result, so a failed check must raise an exception`);
  const failNotices = notices.filter(m => typeof m === 'string' && FAIL_TEXT.test(m));
  if (failNotices.length)
    problems.push(`a notice reports a failure (${quote(failNotices)}): the SQL Editor does not show notices, so a failed check must raise an exception`);
  return problems;
}

/**
 * Pass/fail bookkeeping for a test file. Call done() at the end: it prints
 * "N passed, M failed" (run.mjs reads that line) and sets the exit code.
 * Use process.exitCode, never process.exit(): exiting right after PGlite
 * work can trip a libuv assertion on Windows.
 */
export function reporter() {
  let pass = 0, fail = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra); }
  };
  const expectError = async (name, fn, re) => {
    try { await fn(); ok(name, false, '(no error)'); }
    catch (e) { ok(name, re.test(e.message), `(got: ${e.message})`); }
  };
  const done = () => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail ? 1 : 0;
  };
  return { ok, expectError, done };
}
