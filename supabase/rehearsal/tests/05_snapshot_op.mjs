// supabase/ops/snapshot_public.sql, on the replica with fixtures after ALL
// migrations:
//   * runs as one repeatable-read transaction (one moment for every copy
//     and for the counts), and its result cell says so;
//   * copies every public table, plus auth.users (id, email, created_at
//     only), into one new schema app_backup_YYYYMMDD_HHMI;
//   * row counts of the copy equal the live tables, and its own result cell
//     says so;
//   * nobody but the owner can use the copy (no rights for PUBLIC, anon,
//     authenticated or service_role; RLS on);
//   * live data is untouched;
//   * a second run in the same minute stops with "already exists" and
//     changes nothing.
import path from 'node:path';
import { parse, loadModule } from 'libpg-query';
import { replica, migrate, asUser, read, reporter, rowCounts, lastRows, dbState, stateDiff, showDiff, SUPA, MAIN_SHOP } from '../lib.mjs';

if (loadModule) await loadModule();
const SNAP = read(path.join(SUPA, 'ops/snapshot_public.sql'));
const { ok, expectError, done } = reporter();

const parsed = (await parse(SNAP)).stmts.map(s => s.stmt);
const stmts = parsed.map(s => Object.keys(s)[0]);
ok('file is SET TRANSACTION, a DO block, then one SELECT', JSON.stringify(stmts) === JSON.stringify(['VariableSetStmt', 'DoStmt', 'SelectStmt']), stmts.join(', '));
const setTx = parsed[0].VariableSetStmt || {};
ok('... and the first statement sets isolation level repeatable read',
  setTx.kind === 'VAR_SET_MULTI' && setTx.name === 'TRANSACTION'
  && setTx.args?.[0]?.DefElem?.defname === 'transaction_isolation' && setTx.args[0].DefElem.arg?.A_Const?.sval?.sval === 'repeatable read',
  JSON.stringify(parsed[0]));

const db = await replica({ fixtures: true });
await migrate(db);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const fingerprint = async () => (await q(`select md5(string_agg(t::text, '|' order by t.id)) as f from public.sales t`))[0].f;

const liveBefore = await rowCounts(db);
const salesBefore = await fingerprint();
const liveStateBefore = await dbState(db, { schemas: ['public', 'private', 'auth'] });
const result = JSON.parse(Object.values(lastRows(await db.exec(SNAP))[0])[0]);

const schemas = (await q(`select nspname from pg_namespace where nspname like 'app\\_backup\\_%' order by 1`)).map(r => r.nspname);
ok('exactly one snapshot schema, named app_backup_YYYYMMDD_HHMI', schemas.length === 1 && /^app_backup_\d{8}_\d{4}$/.test(schemas[0]), schemas.join(', '));
const name = schemas[0];
ok('result cell names that snapshot and says all counts match', result.snapshot === name && result.all_counts_match === true, JSON.stringify(result).slice(0, 300));
ok('result cell says the copy is consistent (it ran as one repeatable-read transaction)', result.consistent_copy === true, JSON.stringify(result.consistent_copy));
// Control: the flag is not always true. The result SELECT on its own runs
// at the default level (read committed) and must say so.
const selectOnly = SNAP.slice(SNAP.indexOf('-- Result:'));
const alone = JSON.parse(Object.values(lastRows(await db.exec(selectOnly))[0])[0]);
ok('control: the result SELECT run outside that transaction says consistent_copy false',
  SNAP.indexOf('-- Result:') > 0 && alone.snapshot === name && alone.consistent_copy === false, JSON.stringify(alone.consistent_copy));

const copied = await rowCounts(db, name);
const live = await rowCounts(db);
const missing = Object.keys(live).filter(t => !(t in copied));
ok('every public table was copied', missing.length === 0, missing.join(', '));
const differ = Object.keys(live).filter(t => copied[t] !== live[t]);
ok('row counts of the copy equal the live tables', differ.length === 0, differ.map(t => `${t}: ${copied[t]} vs ${live[t]}`).join('; '));
ok('the copy is not empty (fixtures were copied)', copied.sales === 9 && copied.products === 9 && copied.bottles === 12);

const authCols = (await q(`select column_name from information_schema.columns where table_schema = $1 and table_name = 'auth_users' order by ordinal_position`, [name])).map(r => r.column_name);
ok('auth_users copy has only id, email, created_at', JSON.stringify(authCols) === JSON.stringify(['id', 'email', 'created_at']), authCols.join(', '));
ok('auth_users copy has every login account', copied.auth_users === (await q(`select count(*)::int n from auth.users`))[0].n);

const rights = await q(`
  select r.role, bool_or(has_schema_privilege(r.role, n.oid, 'USAGE')) as schema_usage,
         bool_or(has_table_privilege(r.role, c.oid, 'SELECT') or has_table_privilege(r.role, c.oid, 'INSERT')
              or has_table_privilege(r.role, c.oid, 'UPDATE') or has_table_privilege(r.role, c.oid, 'DELETE')) as table_rights
    from (values ('anon'), ('authenticated'), ('service_role')) r(role)
    cross join pg_namespace n join pg_class c on c.relnamespace = n.oid
   where n.nspname = $1 group by r.role`, [name]);
ok('anon, authenticated and service_role have no rights on the copy', rights.length === 3 && rights.every(r => !r.schema_usage && !r.table_rights), JSON.stringify(rights));
const publicAcl = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1 and exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0)`, [name]);
ok('PUBLIC has no rights on any copied table', publicAcl.length === 0, publicAcl.map(r => r.relname).join(', '));
const noRls = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind = 'r' and not c.relrowsecurity`, [name]);
ok('RLS is on for every copied table', noRls.length === 0, noRls.map(r => r.relname).join(', '));
await expectError('a logged-in user cannot read the copy',
  () => asUser(db, MAIN_SHOP, `select count(*) from "${name}".sales`), /permission denied/);

ok('live row counts unchanged', JSON.stringify(await rowCounts(db)) === JSON.stringify(liveBefore));
ok('live sales rows byte-for-byte unchanged', (await fingerprint()) === salesBefore);

const liveChanges = stateDiff(liveStateBefore, await dbState(db, { schemas: ['public', 'private', 'auth'] }));
ok('live schemas public, private and auth unchanged (rights, policies, functions, row contents)', liveChanges.length === 0, showDiff(liveChanges));

// Same minute again. The file is its own transaction (its SET TRANSACTION
// must come first), so it runs bare, exactly as the SQL Editor runs it.
// Make sure the name it will compute is taken: this minute's and the next
// minute's (the first run may already have used this minute).
const minuteNames = (await q(`select 'app_backup_' || to_char(now() at time zone 'Asia/Karachi' + make_interval(mins => i), 'YYYYMMDD_HH24MI') as n
                                from generate_series(0, 1) i`)).map(r => r.n);
for (const n of minuteNames) await db.exec(`create schema if not exists "${n}"`);
const stateBefore = await dbState(db);
let err = null;
try { await db.exec(SNAP); } catch (e) { err = e; }
await db.exec('rollback').catch(() => {});
ok('second run in the same minute stops with "already exists"', !!err && /already exists/.test(err.message) && /Nothing was changed/.test(err.message), err ? err.message : '(no error)');
const changes = stateDiff(stateBefore, await dbState(db));
ok('... and changed nothing (schemas, tables, rights, row counts, contents)', changes.length === 0, showDiff(changes));

done();
