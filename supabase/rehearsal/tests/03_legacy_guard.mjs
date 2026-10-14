// Retired SQL files must refuse to run.
//
// The old hand-written SQL files kept in supabase/ (top level now, and
// supabase/archive/ once step 1.2 moves them) predate the applied migrations.
// Pasting one into the SQL Editor would undo the security lockdown and the
// stock rules. Each one therefore starts with a DO block that raises
// 'DO NOT RUN', so the editor stops before any later statement runs.
//
// This test builds the replica with fixtures plus every migration (twice),
// runs each retired file, and checks that it raised the guard error and that
// functions, policies, grants, tables, columns, constraints, triggers,
// indexes and row counts are exactly as before.
// Ported from the former supabase/tests/pglite/test_legacy_guard.mjs.
import path from 'node:path';
import { parse, loadModule } from 'libpg-query';
import { replica, migrate, migrationFiles, read, rel, reporter, sqlIn, SUPA } from '../lib.mjs';

if (loadModule) await loadModule();
const { ok, done } = reporter();

const RETIRED = [...sqlIn(SUPA), ...sqlIn(path.join(SUPA, 'archive'))];

const SNAPSHOT = `
select coalesce(jsonb_agg(x order by x), '[]'::jsonb) as items from (
  select 'function ' || p.oid::regprocedure::text || ' def=' || md5(pg_get_functiondef(p.oid)) || ' acl=' || coalesce(p.proacl::text, 'default') as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'auth') and p.prokind in ('f', 'p')
  union all
  select 'policy ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text
         || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
    from pg_policies
  union all
  select 'relation ' || c.oid::regclass::text || ' kind=' || c.relkind::text || ' rls=' || c.relrowsecurity
         || ' force=' || c.relforcerowsecurity || ' acl=' || coalesce(c.relacl::text, 'default')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'p', 'S')
  union all
  select 'column ' || c.oid::regclass::text || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || ' notnull=' || a.attnotnull || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v') and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint
   where connamespace in (select oid from pg_namespace where nspname in ('public', 'private'))
  union all
  select 'trigger ' || tgrelid::regclass::text || ' ' || tgname || ' enabled=' || tgenabled::text
    from pg_trigger where not tgisinternal
  union all
  select 'index ' || pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
  union all
  select 'schema ' || nspname || ' acl=' || coalesce(nspacl::text, 'default')
    from pg_namespace where nspname in ('public', 'private', 'auth')
  union all
  select 'default-acl ' || coalesce(defaclnamespace::regnamespace::text, '') || ' ' || defaclobjtype::text || ' ' || defaclacl::text
    from pg_default_acl
  union all
  select 'event-trigger ' || evtname || ' ' || evtevent || ' enabled=' || evtenabled::text
    from pg_event_trigger
) s`;

const db = await replica({ fixtures: true });
await migrate(db);

async function snapshot() {
  const items = (await db.query(SNAPSHOT)).rows[0].items;
  const tables = (await db.query(`select c.oid::regclass::text t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`)).rows;
  for (const { t } of tables) items.push(`rows ${t} ${(await db.query(`select count(*)::int n from ${t}`)).rows[0].n}`);
  return items;
}
const diff = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const lines = [...a.filter(x => !B.has(x)).map(x => '- ' + x), ...b.filter(x => !A.has(x)).map(x => '+ ' + x)];
  return lines.slice(0, 12).join('\n  ') + (lines.length > 12 ? `\n  ... ${lines.length - 12} more` : '');
};
const sameAs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log(`Schema: replica.sql + fixtures.sql + ${migrationFiles().length} migration(s) x2. Retired files: ${RETIRED.length}.`);
ok('found the retired SQL files (update this test if they are ever removed)', RETIRED.length > 0, `(looked in ${SUPA})`);

// Control 1: statements after a raising DO block in the same script never run.
const probeGuard = `DO $do_not_run$ BEGIN RAISE EXCEPTION 'DO NOT RUN: probe'; END $do_not_run$;`;
try { await db.exec(`${probeGuard}\ncreate table public.guard_probe (x int);`); ok('control: guard error raised', false, '(no error)'); }
catch (e) { ok('control: guard error raised', /DO NOT RUN/.test(e.message), `(got: ${e.message})`); }
await db.exec('rollback').catch(() => {});
ok('control: statements after the guard did not run',
  (await db.query(`select to_regclass('public.guard_probe') is null as gone`)).rows[0].gone === true);

// Each file is compared with the state just before it ran, so a failure
// shows only that file's own changes.
let current = await snapshot();
for (const file of RETIRED) {
  const name = rel(file);
  const text = read(file);
  let first = '';
  try { first = JSON.stringify((await parse(text)).stmts[0].stmt); } catch (e) { first = `parse error: ${e.message}`; }
  ok(`${name}: first statement is the DO NOT RUN guard`, first.startsWith('{"DoStmt"') && first.includes('DO NOT RUN'), first.slice(0, 160));

  let err = null;
  try { await db.exec(text); } catch (e) { err = e; }
  await db.exec('rollback').catch(() => {});
  ok(`${name}: running it stops with the guard error`, !!err && /DO NOT RUN/.test(err.message), err ? `(got: ${err.message})` : '(no error: the file ran)');
  const after = await snapshot();
  ok(`${name}: the database is unchanged`, sameAs(current, after), '\n  ' + diff(current, after));
  current = after;
}

// Control 2: the snapshot does notice the kind of change the old files make.
await db.exec(`grant execute on all functions in schema public to anon`);
ok('control: snapshot detects an anon grant', !sameAs(current, await snapshot()));

done();
