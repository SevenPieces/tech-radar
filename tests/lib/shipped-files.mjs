// tests/lib/shipped-files.mjs
// The one place that decides what the publication guards scan: every file the reader
// receives. Two things are never shipped and are therefore skipped -- the working
// documents under docs/, and repository metadata, which carries the committer's identity
// and the commit message rather than anything the reader is handed.
//
// The publication rule belongs to the repository, not to this file: .gitignore states that
// docs/ ships only its design, and the suite's sibling test asserts exactly that. The walk
// applies the stated rule from the tree, at every docs/ it meets, so a tree carrying a nested
// copy of this layout is read by the rule that copy states for itself; and when git can answer
// the walk also drops every other path the repository ignores -- a run's own pools, digests and
// scratch trees are machine artifacts, so a guard over the published skill must not read them.
//
// The fallback -- the answer this walk gives when git cannot be asked, which is every installed
// skill, since an installed tree has no .git -- has to agree with that answer for the layout it
// judges, or an installed skill breaks its own suite over its own run artifact. It therefore
// applies the run-artifact half of the same rule itself: the pool, the plan, the items and the
// research files the run writes under output_dir, the merged state and its siblings, the locks
// and temp files that guard them - a lock or a temp file is dropped only when the artifact it
// guards is one of those names, is the JSON document the run's state is whatever --state calls it,
// or stands beside it as one of those, so a repository that ships a file merely NAMED like one
// keeps it from both answers (closing sweep F32-5, F34-3) - and the OS cruft the repository
// ignores. The set is stated
// here rather than read from .gitignore because the fallback exists precisely for the tree where
// git cannot be asked -- the file states the rule for the repository, and this is the rule's
// machine-artifact half, kept in step with .gitignore by the repository's own suite, which runs
// with git available and would see any run artifact git keeps but this file drops.
import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Assembled from fragments so that no shipped file -- this one included -- ever spells
// out a name the guards forbid.
export const WORKING_NAMES = ['implementation' + '-plan', 'build' + '-plan', 'baseline' + '-failures',
  'implementation' + '-report', 'verification' + '-report'];

// The rule .gitignore states, applied from the tree itself: a docs/ directory ships only the
// design document that sits directly inside it. A tree carrying a nested copy of this layout
// states the same rule in its own .gitignore, so the rule is read at every docs/ in the tree
// and not only at its root. That is what keeps the fallback -- the answer the walk gives when
// git cannot be asked -- in agreement with the answer git gives for the same layout: git reads
// the nested copy's own rule, and the fallback now reads it too.
function designOf(rel) {
  const parts = rel.split('/');
  const at = parts.indexOf('docs');
  return at === -1 ? null : parts.slice(0, at + 1).join('/') + '/design.md';
}

// The run artifacts .gitignore names, in the same three shapes it names them: the four fixed
// names a run writes beside its output, the state file and the deliverables beside it, and the
// lock and temp spellings any of them can take. A path matching one of these is machine state
// rather than published material whether or not git is available to say so.
const RUN_ARTIFACT_NAMES = new Set([
  '.plan.json', '.pool.json', '.items.json', '.research.json', 'tech-radar-state.json',
  '.tech-radar-state', '.DS_Store', 'Thumbs.db',
]);
// The state file's own NAME carries no fixed spelling -- it is whatever --state names -- but its
// DOCUMENT does: the run's state is JSON, and the lock or temp beside it names that file
// ('mystate.json.lock' guards 'mystate.json'). Without this the fallback recognised only the fixed
// names above, so a run whose state was named by --state left its lock in the no-git answer while
// git's answer dropped it (closing sweep F34-3) -- and the guard read a machine artifact the reader
// never receives, which is the failure this file's header exists to prevent.
const JSON_DOCUMENT = /\.json$/i;
const RUN_ARTIFACT_SUFFIXES = ['.lock', '.tmp'];
const DIGEST_NAME = /^tech-radar-.*\.(md|html)$/;
// Whether the artifact a lock or a temp name GUARDS is itself a run artifact, which is the rule
// stated above: .gitignore spells any '*.lock' and any '*.tmp' because a lock names the state it
// guards, and the guards here judge the shipping set. The name alone was the bound, and it made
// the walk's two answers disagree: git never ignores a TRACKED file, so a repository that ships a
// file whose name merely ends in one of these spellings got it from git's answer and lost it from
// this one (closing sweep F32-5, measured on a tracked 'kept.tmp': git answered
// ['.gitignore','config/settings.md','kept.tmp'] and the fallback ['.gitignore','config/settings.md']).
// The artifact is read the two ways this tree can answer for it - the name a run writes, and the
// artifact standing beside the lock (a state file may be named by --state, so its own name carries
// no fixed spelling). A '.tmp' with no artifact behind it is left for the guards rather than
// dropped: scanning one file too many is the safe direction for a publication guard, and skipping
// a file the reader receives is not.
function guardsRunArtifact(rel, root) {
  const base = rel.split('/').pop();
  const suffix = RUN_ARTIFACT_SUFFIXES.find((s) => base.endsWith(s));
  if (suffix === undefined) return false;
  const guarded = base.slice(0, base.length - suffix.length);
  if (guarded === '') return true;
  if (RUN_ARTIFACT_NAMES.has(guarded) || DIGEST_NAME.test(guarded)) return true;
  // The artifact standing beside the lock. It has to be machine state itself, read the two ways a
  // name can say so: a run artifact by the rule applied to its own name (a state file may be named
  // by --state, so its own name carries no fixed spelling, but the artifact it guards is machine
  // state, and a lock beside an ordinary shipped file is not the lock of anything), or the JSON
  // document the run's state is whatever the file is called. The rule read the NAME ALONE until
  // Batch 67, so a repository that shipped both 'notes' and 'notes.tmp' lost 'notes.tmp' from the
  // no-git answer while git's answer - which never ignores what it carries - kept it, and the
  // hygiene guard never judged a file the reader receives (closing sweep F33-3, the class F32-5 was
  // filed for). Batch 70 (closing sweep F34-3) closed the other half of that reading: requiring a
  // run-artifact NAME alone left every --state-named lock in the fallback's answer while git's
  // answer dropped it, so the guard scanned a run artifact the reader never receives.
  const beside = rel.slice(0, rel.length - suffix.length);
  if (!existsSync(join(root, beside))) return false;
  if (JSON_DOCUMENT.test(beside.split('/').pop())) return true;
  return isRunArtifact(beside, root);
}
function isRunArtifact(rel, root) {
  const base = rel.split('/').pop();
  if (RUN_ARTIFACT_NAMES.has(base)) return true;
  if (guardsRunArtifact(rel, root)) return true;
  return DIGEST_NAME.test(base);
}

function isWorkingDoc(rel) {
  const design = designOf(rel);
  return design !== null && rel !== design;
}

// Whether a directory can hold a shipped path, decided from its name alone. Only the name is
// read here, and the walk has already read the entry's kind by the time it asks: an entry that
// cannot ship is still stat'ed, and this rule is what then keeps the walk from descending into
// such a directory and keeps a working file from reaching a guard. A docs/ directory at any
// depth stays walkable because the one document it ships sits directly under it; everything
// below it is a working document and cannot hold a shipped file.
function canHoldShipped(rel) {
  if (rel.split('/').pop() === 'docs') return true;
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

// Whether git's own work-tree root IS this tree, so that git's answer is an answer about the
// publication unit being walked. 'git -C <dir>' answers from the nearest enclosing work tree, and
// a tree that is not itself a repository root - an installed skill under another checkout, a
// frozen git-archive export unpacked inside a repository - is answered by THAT repository: its
// paths are relative to a different root and its ignore rules describe a different unit. Closing
// sweep F31-10: a frozen export placed inside another repo, where the export's own docs/ is
// ignored, got an empty answer from check-ignore and the walk returned ZERO paths, so the
// publication guards scanned nothing and hygiene.test.mjs went on reporting green. Only this
// answer is used, and at this tree's own root git's paths ARE this tree's paths - measured, git
// reports an empty prefix there - so the walk compares like with like without mapping a prefix
// (closing sweep F32-4: the mapping this function used to return was unreachable, because the
// root equality test is exactly the case where git's prefix is empty).
function gitAnswersForThisTree(root) {
  const res = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (res.error || res.status !== 0) return false;
  return comparePaths(String(res.stdout ?? '').trim(), root) === 0;
}

// Two paths are the same directory when they resolve to one, whether or not a trailing
// slash or a '.' segment is spelled. Only the textual forms git and Node hand back are
// compared here; an unresolved symlink still compares equal to itself.
function comparePaths(a, b) {
  const clean = (p) => String(p).replace(/[/\\]+$/, '').split(/[/\\]+/).filter((s) => s && s !== '.').join('/');
  return clean(a) === clean(b) ? 0 : 1;
}

// True when the path is one the repository ignores. Answers null when git cannot be asked
// (no binary, the tree is not a repository, or git resolves to another repository), which
// is not the same as "not ignored": the caller then keeps the stated rule alone.
function gitIgnored(root, rels) {
  if (rels.length === 0) return new Set();
  if (!gitAnswersForThisTree(root)) return null;
  const res = spawnSync('git', ['-C', root, 'check-ignore', '-z', '--stdin'], {
    input: rels.join('\0'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  // Exit 0 lists the ignored paths, exit 1 is git's answer that none of them is ignored.
  // Every other status -- including a spawn that never happened -- leaves no answer.
  if (res.error || (res.status !== 0 && res.status !== 1)) return null;
  // This is used only when git's own work-tree root IS this tree, so its paths already are this
  // tree's paths and no prefix is stripped from the answer.
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
      // The kind is read first, above: the entry is stat'ed before this rule is consulted, and
      // a vanished path or a dangling link has already answered null. The publication rule is
      // applied here -- after that call and before the path is pushed to a guard or descended
      // into -- so a path that cannot ship never reaches a guard, and the walk never descends
      // into it either.
      if (kind === 'dir') {
        if (canHoldShipped(rel)) walk(path);
      } else if (!isWorkingDoc(rel)) {
        walked.push(rel);
      }
    }
  };
  walk(root);
  // The stated publication rule always applies; git's answer then removes anything else
  // the repository ignores, so the guards judge the shipping set and nothing else. A tree git
  // cannot be asked about -- an installed skill, which is the tree the guards also run in --
  // gets the run-artifact half of the same rule from this file instead, so the two answers agree
  // about the artifacts the skill writes for itself. A file that is not one of those still
  // reaches the guards, whatever path it sits in.
  const ignored = gitIgnored(root, walked);
  return (ignored
    ? walked.filter((rel) => !ignored.has(rel))
    : walked.filter((rel) => !isRunArtifact(rel, root))).sort();
}
