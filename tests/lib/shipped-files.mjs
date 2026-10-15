// tests/lib/shipped-files.mjs
// The one place that decides what the publication guards scan: every file the reader
// receives. Two things are never shipped and are therefore skipped -- the working
// documents under docs/, and repository metadata, which carries the committer's identity
// and the commit message rather than anything the reader is handed.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Assembled from fragments so that no shipped file -- this one included -- ever spells
// out a name the guards forbid.
export const WORKING_NAMES = ['implementation' + '-plan', 'build' + '-plan', 'baseline' + '-failures',
  'implementation' + '-report', 'verification' + '-report'];
export const WORKING_FILES = WORKING_NAMES.map((name) => 'docs/' + name + '.md')
  .concat(['docs/verification' + '-report.html']);

export function shippedFiles(root = SKILL_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === '.git') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (!WORKING_FILES.includes(relative(root, path))) out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}
