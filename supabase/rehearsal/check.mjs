// Syntax-checks SQL files with the real Postgres 17 parser (libpg-query).
// Nothing is executed and nothing connects to a database.
//
//   npm run sql:check                      every .sql file under supabase/
//   node supabase/rehearsal/check.mjs a.sql some/folder ...
import { parse, loadModule } from 'libpg-query';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SUPA, read, rel } from './lib.mjs';

const SKIP_DIRS = new Set(['node_modules', '.temp', 'dist']);

/** Every .sql file under a folder (recursively), sorted. */
export function sqlTree(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) out.push(...sqlTree(p)); }
    else if (entry.name.endsWith('.sql')) out.push(p);
  }
  return out.sort();
}

/** Parses each file; prints OK/FAIL per file. Returns { checked, failed }. */
export async function checkSql(targets = [SUPA]) {
  if (loadModule) await loadModule();
  const files = targets.flatMap(t => fs.statSync(t).isDirectory() ? sqlTree(t) : [t]);
  let failed = 0;
  for (const f of files) {
    try {
      await parse(read(f));
      console.log('OK   ', rel(f));
    } catch (e) {
      failed++;
      console.log('FAIL ', rel(f), '-', e.message);
    }
  }
  return { checked: files.length, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).map(a => path.resolve(a));
  const { checked, failed } = await checkSql(args.length ? args : [SUPA]);
  console.log(`\n${checked - failed} of ${checked} SQL files parse.`);
  process.exitCode = failed || !checked ? 1 : 0;
}
