// Builds clonetheproject/database_setup.sql: ONE file that creates the whole
// VapeTrax database on a new, empty Supabase project.
//   = supabase/clone/base_schema.sql
//   + every supabase/migrations/*.sql in filename order
//   + realtime publication setup
//   + a final check that prints "all_ok".
// Everything up to the check runs as ONE transaction: if anything fails,
// nothing is created and the file can simply be run again after a fix.
// Each migration's own BEGIN/COMMIT is removed with the real Postgres
// parser (libpg-query) so the outer transaction stays whole.
//
// Usage: node scripts/build-clone-sql.mjs   (or: npm run build:clone-sql)
import { parse, loadModule } from 'libpg-query';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (loadModule) await loadModule();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const OUT = path.join(ROOT, 'clonetheproject', 'database_setup.sql');

const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
const migrations = fs.readdirSync(migrationsDir)
  .filter(f => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
  .sort();

// Drop top-level BEGIN / COMMIT / START TRANSACTION statements, keep everything else verbatim.
async function withoutTransactionControl(sql, name) {
  const tree = await parse(sql);
  const parts = [];
  for (const s of tree.stmts) {
    const start = s.stmt_location ?? 0;
    const text = s.stmt_len ? sql.slice(start, start + s.stmt_len) : sql.slice(start);
    if (s.stmt.TransactionStmt) {
      const kind = s.stmt.TransactionStmt.kind;
      if (['TRANS_STMT_BEGIN', 'TRANS_STMT_START', 'TRANS_STMT_COMMIT'].includes(kind)) continue;
      throw new Error(`${name}: unexpected transaction statement ${kind}`);
    }
    parts.push(text.trim() + ';');
  }
  return parts.join('\n\n');
}

const REALTIME = `
-- ---------------------------------------------------------------------
-- Live updates: let the app hear changes on these tables (Supabase Realtime).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['products', 'bottles', 'customers', 'sales', 'credits', 'expenses', 'inventory_logs'] loop
    if to_regclass('public.' || t) is not null and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;`;

const CHECK = `
-- ---------------------------------------------------------------------
-- Final check: the result should say "all_ok": true.
-- ---------------------------------------------------------------------
with expected(t) as (
  values ('profiles'), ('products'), ('bottles'), ('customers'), ('sales'), ('credits'),
         ('inventory_logs'), ('expenses'), ('personal_expenses'), ('settings'), ('inventory_alerts')
),
c as (
  select jsonb_build_object(
    'app_tables_created',
      (select bool_and(to_regclass('public.' || t) is not null) from expected),
    'rls_on_every_table',
      not exists (select 1 from pg_class k where k.relnamespace = 'public'::regnamespace
                  and k.relkind in ('r', 'p') and not k.relrowsecurity),
    'anon_has_no_table_access',
      not exists (select 1 from pg_class k where k.relnamespace = 'public'::regnamespace
                  and k.relkind in ('r', 'p')
                  and (has_table_privilege('anon', k.oid, 'SELECT') or has_table_privilege('anon', k.oid, 'INSERT')
                    or has_table_privilege('anon', k.oid, 'UPDATE') or has_table_privilege('anon', k.oid, 'DELETE'))),
    'checkout_function_ready',
      to_regprocedure('public.process_checkout(text, jsonb, jsonb, jsonb, jsonb, text, numeric)') is not null,
    'stock_never_negative_rule',
      exists (select 1 from pg_constraint where conname = 'products_stock_not_negative'),
    'realtime_on',
      (select count(*) = 7 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename in ('products', 'bottles', 'customers', 'sales', 'credits', 'expenses', 'inventory_logs'))
  ) as checks
)
select jsonb_pretty(jsonb_build_object(
  'all_ok', not exists (select 1 from jsonb_each(c.checks) e where e.value <> 'true'::jsonb),
  'checks', c.checks,
  'database_version', '${migrations.at(-1)?.slice(0, 14) ?? 'none'}'
)) as result
from c;`;

const header = `-- =====================================================================
-- VapeTrax: COMPLETE DATABASE SETUP FOR A NEW SUPABASE PROJECT
-- =====================================================================
-- Paste this WHOLE file into a NEW, EMPTY Supabase project:
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- It takes up to a minute. The last result must show  "all_ok": true
-- (read clonetheproject/HOW_TO_SET_UP.md for every step).
--
-- It creates every table, security rule, function and trigger of the
-- original VapeTrax database. It contains NO shop data.
-- Everything runs as one transaction: if any error appears, NOTHING was
-- created. Copy the error, fix the cause, and run the whole file again.
--
-- Do NOT run this on the original shop's database, and do NOT run it twice
-- on the same project: it is meant for an empty project only.
--
-- GENERATED FILE: do not edit by hand. Rebuild with
--   npm run build:clone-sql
-- Database version: ${migrations.at(-1)?.slice(0, 14) ?? 'none'}
-- Included migrations (in this order):
${migrations.map(m => `--   ${m}`).join('\n')}
-- =====================================================================
`;

const guard = `
-- Stop early if this project already has the VapeTrax tables.
do $guard$
begin
  if to_regclass('public.sales') is not null or to_regclass('public.products') is not null then
    raise exception 'STOPPED: this project already has VapeTrax tables. This file is only for a NEW, EMPTY Supabase project. Nothing was changed.';
  end if;
end $guard$;`;

let body = `begin;\n${guard}\n\n-- ===== Part 1: tables =====\n\n${await withoutTransactionControl(read(path.join(ROOT, 'supabase', 'clone', 'base_schema.sql')), 'base_schema.sql')}\n`;
for (const m of migrations) {
  body += `\n\n-- ===== Migration ${m} =====\n\n${await withoutTransactionControl(read(path.join(migrationsDir, m)), m)}\n`;
}
body += `\n${REALTIME}\n\ncommit;\n${CHECK}\n`;

const out = header + body;
await parse(out); // the whole file must parse
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`Wrote ${path.relative(ROOT, OUT)} (${(out.length / 1024).toFixed(0)} KB, ${migrations.length} migrations)`);
