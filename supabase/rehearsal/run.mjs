// The database rehearsal: run before any SQL goes to the owner.
//
//   npm run sql:rehearse                 everything
//   npm run sql:rehearse -- 01 04        sections 1-7, then only the test
//                                        files whose name has 01 or 04
//                                        (prints PARTIAL REHEARSAL: run it
//                                        unfiltered before SQL goes out)
//
// Nothing here connects to Supabase. It all runs on a local, in-memory
// PGlite (Postgres 17) copy of the live schema.
//
//  1. Syntax check of every .sql file under supabase/ (libpg-query).
//  2. Migration file names: YYYYMMDDHHMMSS_name.sql, versions unique.
//  3. replica.sql + fixtures.sql + ops/snapshot_public.sql (live has
//     app_backup_* schemas too), then every supabase/migrations/*.sql in
//     filename order, the whole sequence TWICE (files in RERUN_UNSAFE, which
//     must never run again on live, only on the first pass). Then, on a
//     copy of that final state, each migration once more on its own: it
//     must change nothing (schema, rights, policies, row counts, row
//     contents). For the RERUN_UNSAFE files (lib.mjs) the check is
//     reversed, to confirm they still need the warning.
//  4. Invariants on the result (RLS everywhere, anon locked out, fixed
//     search_path, no allow-everyone policy, no rows lost, the snapshot
//     schema untouched).
//  5. Every supabase/diagnostics/*.sql (checkDiagnostic in lib.mjs): the
//     parser refuses transaction statements and changes of the transaction
//     mode (they could lift the read-only transaction), then it runs
//     read-only on the migrated schema, must change nothing, and must end
//     with one non-NULL JSON cell.
//  6. Every supabase/tests/*.sql smoke test (files starting with "_" are
//     helpers; checkSmokeTest in lib.mjs) must be begin; ...; rollback;
//     select 'ALL TESTS PASSED'; (checked with the parser), then runs
//     exactly as the SQL Editor would run it, with no extra transaction
//     around it. A failed check must raise an exception. Any error, any
//     change it leaves behind, a missing ALL TESTS PASSED line, or a
//     failure (FAIL / SMOKE FAIL) shown only in a result row or a notice
//     fails it.
//  7. replica.sql and fixtures.sql refuse to run outside the rehearsal.
//  8. Every supabase/rehearsal/tests/*.mjs runs in its own process.
// Exits non-zero if anything failed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkSql } from './check.mjs';
import {
  REHEARSAL, SUPA, MIGRATION_NAME, RERUN_UNSAFE, migrationFiles, newDb, replica, cloneDb, migrate, read, rel, rowCounts, sqlIn,
  dbState, stateDiff, changedObjects, showDiff, checkDiagnostic, checkSmokeTest,
} from './lib.mjs';

// Functions that anon may call on purpose. Empty today: add a signature
// here (schema.name(arg types)) only with a comment saying why.
const ANON_CALLABLE = new Set([]);
// Functions allowed to run without a fixed search_path: Supabase's own.
const NO_SEARCH_PATH_OK = new Set(['public.rls_auto_enable()']);
// Migrations that are NOT safe to run again once later files have run:
// RERUN_UNSAFE in lib.mjs (migrate() runs them on the first pass only).
// Section 3 checks that each entry still changes the database, or fails,
// when re-run (so the list stays honest).

const filters = process.argv.slice(2);
const failures = [];
let checks = 0;
const t0 = Date.now();
const section = title => console.log(`\n=== ${title} ===`);
const check = (name, cond, extra = '') => {
  checks++;
  if (cond) console.log('PASS', name);
  else { console.log('FAIL', name, extra); failures.push(name); }
};

// ---------------------------------------------------------------------
section('1. Syntax check (Postgres 17 parser)');
const syntax = await checkSql([SUPA]);
check(`all ${syntax.checked} SQL files parse`, syntax.failed === 0 && syntax.checked > 0, `(${syntax.failed} failed)`);

// ---------------------------------------------------------------------
section('2. Migration file names');
const files = migrationFiles();
const badNames = files.filter(m => !MIGRATION_NAME.test(m.name)).map(m => m.name);
check('every migration is named YYYYMMDDHHMMSS_name.sql (lowercase, underscores)', badNames.length === 0, badNames.join(', '));
const versions = files.map(m => m.version);
check('migration versions are unique', new Set(versions).size === versions.length, versions.join(', '));
console.log(files.map(m => `  ${m.name}`).join('\n') || '  (none)');

// ---------------------------------------------------------------------
section('3. Replica + fixtures + a snapshot, every migration twice, then each one again on its own');
const db = await replica({ fixtures: true });
// Live has app_backup_* schemas holding same-named copies of every public
// table (the owner runs ops/snapshot_public.sql before risky changes), so
// every migration is rehearsed with one present. A catalog loop that is not
// filtered by schema shows up here instead of on live.
let backups = [];
try {
  await db.exec(read(path.join(SUPA, 'ops/snapshot_public.sql')));
  backups = (await db.query(`select nspname from pg_namespace where nspname ~ '^app_backup_' order by 1`)).rows.map(r => r.nspname);
} catch (e) {
  console.log('  ' + e.message);
}
check('ops/snapshot_public.sql made one app_backup_* schema on the replica, as live has', backups.length === 1, backups.join(', '));
const backupBefore = await dbState(db, { schemas: backups });
const before = await rowCounts(db);
let migrated = false;
try {
  await migrate(db, { log: m => console.log('  ' + m) });
  migrated = true;
} catch (e) {
  console.log('  ' + e.message);
}
check(`${files.length} migration(s) applied twice in filename order without error`, migrated);

const unknownUnsafe = [...RERUN_UNSAFE.keys()].filter(n => !files.some(m => m.name === n));
check('every RERUN_UNSAFE entry names a migration file', unknownUnsafe.length === 0, unknownUnsafe.join(', '));
const migrationsLog = read(path.join(SUPA, 'MIGRATIONS_LOG.md'));
const unwarned = [...RERUN_UNSAFE.keys()].filter(n => !migrationsLog.includes(`Never run \`${n}\` again`));
check('MIGRATIONS_LOG.md tells the owner "Never run `<file>` again" for every RERUN_UNSAFE entry', unwarned.length === 0, unwarned.join(', '));
if (migrated) {
  // Replaying the whole sequence hides a file that undoes a later one (the
  // later file runs again right after it), so each file also runs alone on
  // the final state, compared with the state just before it ran. All of it
  // happens on a copy, so sections 4-6 see the real final state; a file
  // that changed the copy gets a fresh one for the next file. cloneDb()
  // gives the copy the main pass's search_path ("$user", public,
  // extensions, as on live): a bare PGlite clone runs with public only.
  let copy = await cloneDb(db), dirty = false;
  const runAlone = async m => {
    if (dirty) { await copy.close(); copy = await cloneDb(db); }
    const s0 = await dbState(copy);
    let err = null;
    try { await copy.exec(read(m.path)); } catch (e) { err = e; await copy.exec('rollback').catch(() => {}); }
    const changes = stateDiff(s0, await dbState(copy));
    dirty = !!err || changes.length > 0;
    return { err, changes };
  };
  for (const m of files.filter(f => !RERUN_UNSAFE.has(f.name))) {
    const { err, changes } = await runAlone(m);
    check(`${m.name}: running it again on its own, after every later file, changes nothing`,
      !err && changes.length === 0, err ? `(${err.message})` : showDiff(changes));
  }
  for (const m of files.filter(f => RERUN_UNSAFE.has(f.name))) {
    const { err, changes } = await runAlone(m);
    const objects = changedObjects(changes);
    console.log(`  ${m.name} is listed in RERUN_UNSAFE: ${RERUN_UNSAFE.get(m.name)}.`);
    console.log(err ? `  Re-running it fails: ${err.message}` : `  Re-running it changes: ${objects.slice(0, 6).join('; ')}${objects.length > 6 ? ` and ${objects.length - 6} more` : ''}`);
    check(`${m.name}: still unsafe to run again (never run it again on live)`, !!err || changes.length > 0,
      '(it changed nothing when re-run: remove it from RERUN_UNSAFE and from the MIGRATIONS_LOG.md warning)');
  }
  await copy.close();
}

// ---------------------------------------------------------------------
section('4. Invariants after all migrations');
if (migrated) {
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;

  const noRls = await q(`select c.relname as t from pg_class c where c.relnamespace = 'public'::regnamespace
                           and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`);
  check('RLS is on for every public table', noRls.length === 0, noRls.map(r => r.t).join(', '));

  const anonTables = await q(`select c.relname as t from pg_class c where c.relnamespace = 'public'::regnamespace
                                and c.relkind in ('r', 'p', 'v', 'm')
                                and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
                                  or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
                              order by 1`);
  check('anon has no privilege on any public table or view', anonTables.length === 0, anonTables.map(r => r.t).join(', '));

  const fns = await q(`
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           format_type(p.prorettype, null) as returns,
           exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) s where s like 'search_path=%') as fixed_path
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     order by 1`);
  const anonFns = fns.filter(f => f.anon_exec && !['trigger', 'event_trigger'].includes(f.returns) && !ANON_CALLABLE.has(f.sig));
  check('anon cannot execute any public/private function (new functions get EXECUTE for PUBLIC by default: revoke it)',
    anonFns.length === 0, anonFns.map(f => f.sig).join(', '));
  const noPath = fns.filter(f => !f.fixed_path && !NO_SEARCH_PATH_OK.has(f.sig));
  check('every public/private function sets a fixed search_path', noPath.length === 0, noPath.map(f => f.sig).join(', '));

  const openPolicies = await q(`select tablename || '.' || policyname as p from pg_policies
                                 where schemaname = 'public' and (qual = 'true' or with_check = 'true')`);
  check('no allow-everyone policy (using/with check = true)', openPolicies.length === 0, openPolicies.map(r => r.p).join(', '));

  const after = await rowCounts(db);
  const lost = Object.keys(before).filter(t => t in after && after[t] < before[t]).map(t => `${t}: ${before[t]} -> ${after[t]}`);
  check('no fixture rows were lost by the migrations', lost.length === 0, lost.join('; '));

  const backupChanges = stateDiff(backupBefore, await dbState(db, { schemas: backups }));
  check('the app_backup_* snapshot is untouched by the migrations (tables, columns, rights, RLS, row counts and contents)',
    backups.length > 0 && backupChanges.length === 0, backups.length ? showDiff(backupChanges) : '(no snapshot schema was made)');
} else {
  console.log('  skipped: the migrations did not apply');
}

// ---------------------------------------------------------------------
section('5. Diagnostics: read-only, one JSON cell, on the migrated schema');
// The owner pastes these into the live SQL Editor, which runs them with full
// rights and no read-only transaction, so this is the only proof that they
// change nothing. checkDiagnostic() first refuses (with the parser) anything
// that could end or lift the read-only transaction, then runs the file
// inside one and compares the whole database before and after.
const diagnostics = sqlIn(path.join(SUPA, 'diagnostics'));
for (const file of migrated ? diagnostics : []) {
  const problems = await checkDiagnostic(db, read(file));
  check(`${rel(file)}`, problems.length === 0, `(${problems.join('; ')})`);
}

// ---------------------------------------------------------------------
section(`6. SQL smoke tests (supabase/tests/*.sql): begin ... rollback; select 'ALL TESTS PASSED', run as the SQL Editor runs them`);
// These files are also pasted into the live SQL Editor, which commits
// whatever a file leaves open and shows only the last result. So the
// harness adds no transaction of its own: the shape is checked with the
// parser first (a file of another shape is never even run), then the file
// runs bare, exactly as on live. It must leave nothing behind and end with
// the ALL TESTS PASSED line; a failed check must raise an exception (a
// FAIL row or notice would never reach the owner).
const smoke = sqlIn(path.join(SUPA, 'tests')).filter(f => !path.basename(f).startsWith('_'));
if (!smoke.length) console.log('  none yet (step 0.3 adds the first ones)');
for (const file of migrated ? smoke : []) {
  const problems = await checkSmokeTest(db, read(file));
  check(`${rel(file)}`, problems.length === 0, `(${problems.join('; ')})`);
}

// ---------------------------------------------------------------------
section('7. Rehearsal files refuse to run outside the rehearsal');
for (const name of ['replica.sql', 'fixtures.sql']) {
  const bare = await newDb();
  let err = null;
  try { await bare.exec(read(path.join(REHEARSAL, name))); } catch (e) { err = e; }
  const created = (await bare.query(`select count(*)::int as n from pg_namespace where nspname in ('auth', 'extensions', 'rehearsal')`)).rows[0].n;
  check(`${name} stops with DO NOT RUN when pasted elsewhere, creating nothing`, !!err && /DO NOT RUN/.test(err.message) && created === 0,
    err ? `(${err.message})` : '(it ran)');
  await bare.close();
}
await db.close();

// ---------------------------------------------------------------------
section('8. Test files (supabase/rehearsal/tests/*.mjs)');
const testDir = path.join(REHEARSAL, 'tests');
const tests = fs.readdirSync(testDir).filter(f => f.endsWith('.mjs')).sort()
  .filter(f => !filters.length || filters.some(x => f.includes(x)));
if (filters.length) {
  console.log(`  filtered: only test files whose name has ${filters.map(x => JSON.stringify(x)).join(' or ')}`);
  check('the filter matches at least one test file', tests.length > 0, `(${filters.join(' ')} matches none)`);
}
let testPass = 0, testFail = 0;
for (const t of tests) {
  console.log(`\n--- ${t} ---`);
  const t1 = Date.now();
  const r = spawnSync(process.execPath, [path.join(testDir, t)], { cwd: REHEARSAL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  // PGlite prints its whole minified bundle on a crash: keep lines short.
  for (const line of out.split(/\r?\n/)) if (line.trim()) console.log(line.length > 300 ? line.slice(0, 300) + ' ...' : line);
  const m = /(\d+) passed, (\d+) failed\s*$/.exec(out.trim());
  if (m) { testPass += +m[1]; testFail += +m[2]; }
  const good = r.status === 0 && !!m && +m[2] === 0;
  check(`${t} (${Date.now() - t1} ms)`, good, m ? '' : `(crashed, exit code ${r.status})`);
}

// ---------------------------------------------------------------------
section('Summary');
console.log(`Rehearsal checks: ${checks - failures.length} of ${checks} passed.`);
console.log(`Test files: ${tests.length} run, ${testPass} checks passed, ${testFail} failed.`);
console.log(`Time: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures.length) {
  console.log('\nFAILED:\n' + failures.map(f => '  - ' + f).join('\n'));
  console.log('\nREHEARSAL FAILED: do not send any SQL to the owner until this is green.');
} else if (filters.length) {
  console.log('\nPARTIAL REHEARSAL (filtered): no failures in what ran. Run it without filters before any SQL goes to the owner.');
} else {
  console.log('\nREHEARSAL PASSED.');
}
process.exitCode = failures.length ? 1 : 0;
