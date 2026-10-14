// Makes (or updates) the local branch "share/friend": a clean copy of the
// current code for another shop owner to deploy on their OWN Supabase and
// Vercel. It contains NO business data and NO history of this repository:
// each run adds one commit whose files are the current branch's files
// minus the private paths below.
//
// Usage:
//   node scripts/make-friend-copy.mjs "Friend Name" "friend@gmail.com"
// The name and email should be the friend's GitHub account, so their free
// Vercel plan accepts the commits. Then push it to the friend's repository:
//   git push https://github.com/<friend>/<repo>.git share/friend:main
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [name, email] = process.argv.slice(2);
if (!name || !email || !email.includes('@')) {
  console.error('Usage: node scripts/make-friend-copy.mjs "Friend Name" "friend@gmail.com"');
  process.exit(1);
}

// Never shared with another shop.
const PRIVATE_PATHS = [
  'data',                                   // this shop's business data
  'private',
  'supabase/scripts',                       // one-off scripts run on this shop's database
  'supabase/MIGRATIONS_LOG.md',             // this shop's apply log
  'supabase/diagnostics/live-snapshot-2026-10-11.md',
  'docs/history',
];

const git = (args, env = {}) =>
  execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, ...env } }).trim();

const status = git(['status', '--porcelain']);
if (status) {
  console.error('Commit or stash your changes first; the copy is made from the last commit.');
  process.exit(1);
}

const tmpIndex = path.join(os.tmpdir(), `vapetrax-share-index-${process.pid}`);
const env = { GIT_INDEX_FILE: tmpIndex };
try {
  git(['read-tree', 'HEAD'], env);
  for (const p of PRIVATE_PATHS) {
    try { git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', p], env); } catch { /* not present */ }
  }
  const tree = git(['write-tree'], env);
  const source = git(['rev-parse', '--short', 'HEAD']);
  let parent = '';
  try { parent = git(['rev-parse', '--verify', '--quiet', 'refs/heads/share/friend']); } catch { /* first copy */ }
  if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) {
    console.log('share/friend is already up to date.');
    process.exit(0);
  }
  const message = `VapeTrax update (from ${source})`;
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], {
    GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email,
  });
  git(['update-ref', 'refs/heads/share/friend', commit, ...(parent ? [parent] : [])]);
  const leaked = git(['ls-tree', '-r', '--name-only', commit]).split('\n')
    .filter(f => PRIVATE_PATHS.some(p => f === p || f.startsWith(p + '/')));
  if (leaked.length) throw new Error(`private files still in the copy: ${leaked.join(', ')}`);
  console.log(`share/friend -> ${commit.slice(0, 7)} (clean copy of ${source}, authored by ${name})`);
  console.log('Push it to the friend\'s repository with:');
  console.log('  git push https://github.com/<friend>/<repo>.git share/friend:main');
} finally {
  fs.rmSync(tmpIndex, { force: true });
}
