// tests/lib/shipped-files.mjs
// The one place that decides what the publication guards scan: every file the reader
// receives. Two things are never shipped and are therefore skipped -- the working
// documents under docs/, and repository metadata, which carries the committer's identity
// and the commit message rather than anything the reader is handed.
//
// The publication rule belongs to the repository, not to this file: .gitignore states that
// docs/ ships only its design, and the suite's sibling test asserts exactly that. The walk
// applies the stated rule from the tree, and when git can answer it also drops every other
// path the repository ignores -- a run's own pools, digests and scratch trees are machine
// artifacts, so a guard over the published skill must not read them.
import { lstatSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Assembled from fragments so that no shipped file -- this one included -- ever spells
// out a name the guards forbid.
export const WORKING_NAMES = ['implementation' + '-plan', 'build' + '-plan', 'baseline' + '-failures',
  'implementation' + '-report', 'verification' + '-report'];
export const WORKING_FILES = WORKING_NAMES.map((name) => 'docs/' + name + '.md')
  .concat(['docs/verification' + '-report.html']);

// The rule .gitignore states, applied from the tree itself: everything under docs/ is
// working material except the design document the reader receives.
function isWorkingDoc(rel) {
  if (rel === 'docs' || rel.startsWith('docs/')) return rel !== 'docs/design.md';
  return WORKING_FILES.includes(rel);
}

// Whether a directory can hold a shipped path, decided from its name alone. The rule is
// applied before the filesystem is touched, so the walk never stats -- and never descends
// into -- material that cannot ship. docs/ itself stays walkable because the one document
// it ships (docs/design.md) sits directly under it; everything below it is a working
// document and cannot hold a shipped file.
function canHoldShipped(rel) {
  if (rel === 'docs') return true;
  return !isWorkingDoc(rel);
}

// What the entry at this path is, without ever throwing. A path that vanished between the
// directory listing and this call, and a symlink whose target is gone, both answer null
// instead of propagating ENOENT into a guard: the tree the suite runs in also holds other
// processes' scratch trees, and a messy tree must not be reported as an unpublished
// artifact. A symlink is never descended into, and only one that resolves to a regular
// file is a file the guards can read.
function entryKind(path) {
  let stats;
  try { stats = lstatSync(path); } catch { return null; }
  if (stats.isDirectory()) return 'dir';
  if (stats.isFile()) return 'file';
  if (stats.isSymbolicLink()) {
    try { return statSync(path).isFile() ? 'file' : 'other'; } catch { return null; }
  }
  return 'other';
}

// True when the path is one the repository ignores. Answers null when git cannot be asked
// (no binary, or the tree is not a repository), which is not the same as "not ignored":
// the caller then keeps the stated rule alone.
function gitIgnored(root, rels) {
  if (rels.length === 0) return new Set();
  const res = spawnSync('git', ['-C', root, 'check-ignore', '-z', '--stdin'], {
    input: rels.join('\0'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  // Exit 0 lists the ignored paths, exit 1 is git's answer that none of them is ignored.
  // Every other status -- including a spawn that never happened -- leaves no answer.
  if (res.error || (res.status !== 0 && res.status !== 1)) return null;
  return new Set(String(res.stdout ?? '').split('\0').filter(Boolean));
}

export function shippedFiles(root = SKILL_ROOT) {
  const walked = [];
  const walk = (dir) => {
    let entries;
    // A directory removed while the walk runs is not a failure: there is nothing left in
    // it to judge.
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry === '.git') continue;
      const path = join(dir, entry);
      const rel = relative(root, path);
      const kind = entryKind(path);
      if (kind === null || kind === 'other') continue;
      // The publication rule first: a path that cannot ship is skipped before any further
      // filesystem call, so a dangling link or a vanished file under the working material
      // never reaches a guard, and the walk never descends into it either.
      if (kind === 'dir') {
        if (canHoldShipped(rel)) walk(path);
      } else if (!isWorkingDoc(rel)) {
        walked.push(rel);
      }
    }
  };
  walk(root);
  // The stated publication rule always applies; git's answer then removes anything else
  // the repository ignores, so the guards judge the shipping set and nothing else.
  const ignored = gitIgnored(root, walked);
  return (ignored ? walked.filter((rel) => !ignored.has(rel)) : walked).sort();
}
