# supabase/

Everything that touches the live Supabase database lives here.

- The live database is described by `diagnostics/live-snapshot-2026-10-11.md`, **not** by the old top-level `.sql` files.
- It is changed only by the files in `migrations/`, run by the owner in the Supabase SQL Editor, in filename order.
- `MIGRATIONS_LOG.md` records what has run on live and what its validation returned.

## Folder map

| Path | What it is | Who runs it, where |
|---|---|---|
| `migrations/` | Timestamped changes (`YYYYMMDDHHMMSS_name.sql`), applied in filename order. Applied files are never edited. | The owner, SQL Editor |
| `diagnostics/` | Read-only checks. Each returns one cell of JSON (never NULL) to paste back, and has no transaction statement and no `set transaction`; the rehearsal refuses anything else. `verify_<version>.sql` validates one migration. | The owner, SQL Editor |
| `ops/` | Operational scripts, such as `snapshot_public.sql` (backup copy before a risky change). | The owner, SQL Editor |
| `scripts/` | One-off scripts that have **already run**, kept as a record. Never run them again. | Nobody |
| `tests/` | SQL smoke tests (from step 0.3). Each is `begin;` … `rollback;` `select 'ALL TESTS PASSED';`, so it leaves nothing behind and its last line is what the owner sees; every failed check raises an error. The rehearsal refuses any other shape (see "Writing a SQL smoke test"). Files starting with `_` are helpers. | The rehearsal first, then the SQL Editor as a second check |
| `rehearsal/` | The local database rehearsal (PGlite). | Developers, on their own computer |
| `MIGRATIONS_LOG.md` | What ran on live, when, and its validation result. | Updated after each run |
| top-level `*.sql` | Retired snapshots. Each starts with a `DO NOT RUN` block that stops it. Step 1.2 moves them to `archive/`. | Never |

## Running a diagnostic (owner)

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the **whole** file and click **Run**.
3. Click the single result cell, copy its JSON and paste it back.

Every file in `diagnostics/` is read-only: it changes nothing. The rehearsal checks this before any file reaches the owner: it refuses a file with a transaction statement (`begin`, `commit`, `rollback`, …) or a change of the transaction mode (`set transaction read write`, …), runs the rest inside a read-only transaction, compares the whole database before and after, and requires one JSON cell that is not NULL.

| File | Shows |
|---|---|
| `01_security_status.sql` | RLS and anonymous access per table, function security |
| `02_schema.sql` | Columns, constraints, indexes, triggers, extensions |
| `03_function_definitions.sql` | Full source of every public function |
| `04_data_profile.sql` | Row counts, date formats, data quality (no personal data) |
| `05_find_users.sql` | Every login account and what it is linked to (**contains emails**: share it only with the developer) |
| `06_negative_stock_history.sql` | When and how stock went below zero |
| `07_integrity_probe.sql` | One JSON report for the next migrations: function fingerprints, security settings, value classes, id shapes, mismatches. **No personal data.** |
| `08_lost_sales.sql` | (After `20261012100000`.) Sales removed by **Edit** that never came back, with everything needed to ring them again (**contains customer names**: share it only with the developer) |
| `verify_<version>.sql` | Whether that migration is fully in place (`all_checks_passed`) |

## Running a smoke test (owner)

`tests/00_lockdown_smoke.sql` (who can see and change what) and `tests/01_legacy_rpc_smoke.sql` (selling, replaying, deleting and editing sales) are run the same way, right after the migration they belong to.

- Each one creates throwaway shops and logins (`example.invalid` emails), acts as them the way the app does, and **rolls everything back** at the end: nothing is left behind and the real shop's rows are never touched.
- Success: the result shows `ALL TESTS PASSED` (the file's last line, which runs after the rollback). Paste it back.
- A failed check stops with an error starting `SMOKE FAIL`: copy it back. Nothing was changed.

## Taking a snapshot before a risky change (owner)

Run `ops/snapshot_public.sql` the same way as a diagnostic.

- It copies every app table, plus the list of login accounts (id, email, created date), into a new locked schema named `app_backup_YYYYMMDD_HHMI` (Pakistan time).
- The app, the public key and logged-in users can never read it.
- It runs as one transaction that sees a single moment, so a sale saved while it runs cannot leave the copy half-done.
- Paste back the result cell. `"all_counts_match": true` means the copy is complete, and `"consistent_copy": true` means every table was copied at the same moment.
- Each snapshot takes about as much space as the data itself (the Free plan has 500 MB). Step 1.2 adds `ops/prune_snapshots.sql` to remove old ones.

## The rehearsal (developers)

The rehearsal tests SQL on a **local, in-memory Postgres 17 (PGlite) copy of the live schema** before the owner ever sees it. Nothing in it connects to Supabase.

```bash
npm install                        # once
npm run sql:rehearse               # the full rehearsal (about a minute)
npm run sql:rehearse -- 01 04      # partial: every section, but only test files whose name has 01 or 04
npm run sql:check                  # syntax check only, every .sql under supabase/
```

`run.mjs` exits non-zero if anything fails, including a filter that matches no test file. A filtered run ends with `PARTIAL REHEARSAL`, never `REHEARSAL PASSED`: run it unfiltered before any SQL goes to the owner. It runs, in order:

1. A syntax check of every `.sql` file under `supabase/`, with the real Postgres 17 parser.
2. A check that migration file names follow `YYYYMMDDHHMMSS_name.sql` and versions are unique.
3. `replica.sql`, `fixtures.sql` and `ops/snapshot_public.sql` (live has `app_backup_*` schemas with same-named copies of every table, so every migration is rehearsed with one present), then **every migration in filename order, the whole sequence twice**. Then, on a copy of that final state, **each migration once more on its own**: it must change nothing (functions, rights, policies, constraints, row counts, row contents). A file that is not safe to run again after later files is listed in `RERUN_UNSAFE` in `lib.mjs`, with the reason and a "never run again" line in `MIGRATIONS_LOG.md`; it runs on the first pass only, and for it the check is reversed (re-running it must change something or fail), so the list stays honest. Today that is `20261011120000` and `20261011140000`: since `20261012100000` both fail when re-run (the sale functions now return jsonb), and before that they would have undone the later files.
4. Invariants on the result:
   - RLS is on for every public table;
   - anon has no table rights;
   - anon cannot execute any app function;
   - every app function has a fixed `search_path`;
   - no allow-everyone policy exists;
   - no fixture row was lost;
   - the `app_backup_*` snapshot is untouched (tables, columns, rights, RLS, row counts and contents).
5. Every `diagnostics/*.sql` (`checkDiagnostic()`): the parser first refuses any transaction statement (`begin`, `commit`, `rollback`, `savepoint`, …) and any change of the transaction mode (`set transaction read write`, `set session characteristics`, `transaction_read_only`, …), because either could end or lift the read-only transaction the check relies on. The file then runs inside a read-only transaction on the migrated schema; it must raise no error, change nothing (the whole database is compared before and after), and end with one JSON cell that is not NULL.
6. Every `tests/*.sql` smoke test (`checkSmokeTest()`) is first checked with the parser: it must be `begin;` … `rollback;` `select 'ALL TESTS PASSED';`, with only savepoints in between (no `commit` or `end`), and the last line may hold nothing but constants. A file of any other shape fails without being run. It then runs **bare, with no transaction added by the harness**, exactly as the SQL Editor runs it (the SQL Editor commits whatever a file leaves open). It fails on any error, on any change it leaves behind (rows, row contents, rights, functions, policies), if its last result is not `ALL TESTS PASSED`, and if any result row or notice starts with `FAIL` or `SMOKE FAIL` (the owner never sees those: a failed check must raise an error). See "Writing a SQL smoke test" below.
7. `replica.sql` and `fixtures.sql` refuse to run outside the rehearsal.
8. Every `rehearsal/tests/*.mjs` runs in its own process.

| File in `rehearsal/` | What it is |
|---|---|
| `replica.sql` | The live schema as it was just before `20261011120000`: every table, constraint, policy, grant, function signature, the realtime publication, Supabase's roles, `auth.uid()` / `auth.role()` / `auth.email()` / `auth.jwt()` exactly as Supabase defines them, the `extensions` schema (uuid-ossp, pgcrypto) and Supabase's default privileges. Its header lists the known differences from live. |
| `fixtures.sql` | Synthetic edge cases only (no real data). Includes `rehearsal.v1_payloads`: RPC payloads in the exact shape the deployed app sends. |
| `lib.mjs` | Helpers: `replica()`, `migrate()` (with before-hooks), `asUser()` (PostgREST-style role and JWT claims), `rpc()` (named-argument calls like `supabase.rpc`), `rowCounts()`, `cloneDb()` (a copy that keeps the session's `search_path` and rehearsal marker; a bare PGlite clone loses them), `dbState()` / `stateDiff()` (a fingerprint of everything a file could change, and what differs between two), `checkDiagnostic()` / `diagnosticProblems()`, `checkSmokeTest()` / `smokeShapeProblems()`, `reporter()`. |
| `run.mjs` / `check.mjs` | The rehearsal and the syntax check. |
| `tests/00_baseline.mjs` | Lockdown guarantees (anon locked out, no self-escalation, shop-scoped and replay-safe RPCs) after all migrations. |
| `tests/01_stock_rules.mjs` | The owner's stock rules: never below zero, shortfall kept and alerted, 0.5 ml refills, NaN guards. |
| `tests/02_delete_script.mjs` | The one-off delete script and its safety aborts. |
| `tests/03_legacy_guard.mjs` | Retired SQL files stop at their `DO NOT RUN` guard and change nothing. |
| `tests/04_integrity_probe.mjs` | The probe is read-only, has no personal data, finds every planted edge case, and its function fingerprints match the migration files. |
| `tests/05_snapshot_op.mjs` | The snapshot runs as one repeatable-read transaction, copies everything, is locked down, and changes no live data. |
| `tests/06_v1_payloads.mjs` | Replays the captured app payloads (sales, refills, split payments, deletes, edits, queue retries). |
| `tests/07_harness_guards.mjs` | The rehearsal's own guards fire: the smoke-test shape check and run (a FAIL row or notice fails), the diagnostic check (no way out of the read-only transaction, no NULL cell), `cloneDb()` keeping the `search_path`, the state comparison of a bare run, and why `20261011120000` and `20261011140000` are in `RERUN_UNSAFE`. |
| `tests/08_lockdown_followup.mjs` | `20261012100000`: its validation (including the real-user check), shop isolation, cashier linking, settings, personal expenses, closed tables, archive-on-delete and the 25-row limit, append-only udhaar and stock history, the owner's stock rules inside the new `process_checkout`, telemetry, dates, udhaar worked out by the server, `process_reversal` from the stored sale, **every write path of the deployed app**, and the snapshot helpers. |

### Writing a rehearsal test

```js
import { replica, migrate, asUser, rpc, reporter, MAIN_SHOP } from '../lib.mjs';

const { ok, expectError, done } = reporter();
const db = await replica({ fixtures: true });           // or replica() for an empty copy
await migrate(db, {                                     // all migrations, twice
  before: { '20261011140000_stock_never_negative_refill_steps.sql': async db => { /* rows that existed on live before this file ran */ } },
});
ok('something holds', (await asUser(db, MAIN_SHOP, 'select 1 as x')).rows[0].x === 1);
await expectError('anon is refused', () => asUser(db, '', 'select * from public.sales'), /permission denied/);
done();                                                 // prints "N passed, M failed" and sets the exit code
```

Always finish with `done()`. Never call `process.exit()`: exiting right after PGlite work can crash Node on Windows.

### Writing a SQL smoke test

The owner pastes these files into the live SQL Editor, which **commits whatever a file leaves open** and **shows only the last result**. So every file in `tests/` has exactly this shape:

```sql
begin;

-- A failed check raises an error. pg_temp functions vanish with the rollback.
create function pg_temp.assert(ok boolean, what text) returns void language plpgsql as $f$
begin
  if ok is not true then raise exception 'SMOKE FAIL: %', what; end if;
end $f$;

select pg_temp.assert(not has_table_privilege('anon', 'public.products', 'select'), 'anon cannot read products');
-- ... more checks ...

rollback;
select 'ALL TESTS PASSED' as result;   -- constants only; more constant columns are allowed
```

- **Pass**: no error, and the result shows `ALL TESTS PASSED`. That line is what the owner pastes back.
- **Fail**: the first failed check stops the file with its error (`SMOKE FAIL: ...`), the rest is skipped, and nothing is committed, because an aborted transaction can only roll back. The owner pastes back the error.
- Never report a failure only in a result row (`select case when ... then 'ok' else 'FAIL' end`) or a `raise notice`: the SQL Editor shows neither, so the owner would see a pass. The rehearsal fails a test with a result row or notice starting with `FAIL` or `SMOKE FAIL`.
- The last line runs after the rollback, in a transaction of its own, so it may hold nothing but constants (no `from`, function call, cast or subquery): anything else could change live data. A count of passed checks cannot be shown there, because the rollback has already removed it.

## Rules for every new migration

- **Name**: `supabase/migrations/YYYYMMDDHHMMSS_name.sql` (the existing convention), lowercase with underscores, later than every applied file.
- **One transaction** (`begin; … commit;`) that is **safe to run twice**: `if not exists`, `create or replace`, guarded `do` blocks. It must also stay safe to run again **on its own after later files** (the rehearsal checks every file this way). When a new file makes an earlier one unsafe to re-run (for example by replacing a function the earlier file also creates), add the earlier file to `RERUN_UNSAFE` in `rehearsal/run.mjs` and a "never run again" line to `MIGRATIONS_LOG.md`.
- **Filter catalog loops by schema** (`pg_class`, `pg_policies`, `pg_proc`, `information_schema`): live has `app_backup_*` schemas holding same-named copies of every public table.
- **`npm run sql:rehearse` must be green before the file is sent to the owner.** That includes applying it twice. Add a `rehearsal/tests/NN_*.mjs` test or a `tests/*.sql` smoke test for what it changes. If it must cope with existing live data, add that data with a `before` hook or to `fixtures.sql`.
- **New functions**: add `set search_path = ''` and explicitly `revoke all … from public, anon`. Postgres lets PUBLIC execute every new function, and the lockdown's per-schema default does not change that. The rehearsal fails otherwise.
- **New tables**: `enable row level security` and add their policies in the same file. Supabase grants new tables to `authenticated` automatically, and the replica copies that default.
- **Keep the owner's rules**: stock never below zero (CHECKs, guarded deduction, shortfall handling), refills in 0.5 ml steps, whole-number quantities, whole-rupee prices.
- **Never edit an applied migration** (see `MIGRATIONS_LOG.md`). A fix is a new file.
- **From `20261012100000` on**: start with `select private.require_migration(array['<earlier versions>']);`, take `private.snapshot_functions('pre_<version>', ...)` / `private.snapshot_policies('pre_<version>')` before replacing anything, end with `select private.mark_migration('<version>', '<file name>');`, and keep the owner's rules inside any new sale or stock function. `private.legacy_shop_ids()` is the one membership source; deletes made by the app are archived or copied (`private.deleted_rows`) and capped at 25 rows per request; `credits` and `inventory_logs` are append-only.
- Ship a read-only `diagnostics/verify_<version>.sql` that returns `all_checks_passed`.
- After the owner runs it, add a row to `MIGRATIONS_LOG.md`.

Step 1.2 extends these conventions (prelude-based SQL tests, `require_migration`, snapshots and drains before risky files).
