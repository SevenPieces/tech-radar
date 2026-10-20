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
// guards is one of those names, or stands beside it as one of them, so a repository that ships a
// file merely NAMED like one keeps it from both answers (closing sweep F32-5, F34-3, F35-3) - and
// the OS cruft the repository
// ignores. The set is stated
// here rather than read from .gitignore because the fallback exists precisely for the tree where
// git cannot be asked -- the file states the rule for the repository, and this is the rule's
// machine-artifact half, kept in step with .gitignore by the repository's own suite, which runs
// with git available and would see any run artifact git keeps but this file drops.
import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Assembled from fragments so that no shipped file -- this one included -- ever spells
// out a name the guards forbid.
export const WORKING_NAMES = ['implementation' + '-plan', 'build' + '-plan', 'baseline' + '-failures',
  'implementation' + '-report', 'verification' + '-report',
  // The review pass's own working directory, named from fragments for the reason above. It is
  // here because shipped test comments used to record where a measurement came from by pointing
  // into it, which handed the reader a path to material that never ships.
  'hardening-' + '2026-' + '10-15'];

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
// THE DIRECTION THIS FILE CHOOSES ON THAT BOUND (Batch 78; closing sweep F35-3, reversing Batch 70's
// clause; Batch 84, closing sweep F36-1). Batch 70 also dropped a lock or temp whose guarded sibling
// merely ENDED IN '.json', which made the two answers disagree the other way: git never ignores a
// file it carries, so a TRACKED 'domains.json.lock' is in git's answer and the fallback dropped it --
// and one fixture's tracked lock carried a credential shape, so a file the reader receives was never
// judged. Batch 78 reversed that clause so the NAME-ONLY rule keeps such a lock, and Batch 84
// (closing sweep F36-1) measured that the reversal was only half done: every FIXED name in
// RUN_ARTIFACT_NAMES and every DIGEST_NAME spelling was still dropped from the fallback's subset on
// the name alone, so a TRACKED '.pool.json.lock', 'tech-radar-state.json.tmp' or
// 'tech-radar-2026-10-15.html.lock' -- all of which git's answer keeps, because git does not ignore
// what it carries -- was still never handed to a publication guard. 10 of the sweep's 11 layouts
// disagreed.
//
// THE BOUND THAT NAME VERDICT LEAVES (Batch 87; final verification F37-2, recorded rather than
// closed). A name is the whole story only while trackedness is not asked about: a repository that
// FORCE-ADDS a file whose own name is one of these -- 'git add -f .pool.json', or a digest -- ships a
// file the reader receives. Git's answer keeps it (git never ignores what it carries) and this
// fallback still drops it on the name alone, so no publication guard reads it. Measured on a fixture
// that force-adds every fixed name: 10 of 10 TRACKED names disagree with the repository's answer.
// The other direction is available and deliberately not taken: keeping every fixed name wherever git
// cannot be asked -- the direction the lock and temp half below takes -- would hand an installed
// skill's own '.pool.json', and its digests, to the guards, which is the failure this fallback exists
// to prevent, and a pool carries whatever the feeds spelled. The bound is therefore recorded with its
// reach (a repository, or an export inside one, that force-adds one of these names), and Batch 84's
// commit subject -- 'every TRACKED run-artifact spelling agrees with the repository's answer' --
// covers the lock and temp spellings only and overstates its subject for this class. tests/hygiene.
// test.mjs pins the bound in both answers.
// A LOCK'S NAME IS NOT A TRACKEDNESS QUESTION, so the fallback no longer answers one with a name.
// The fallback's two verdicts are answered by two different things. A path whose OWN name is one of
// the fixed artifacts the reader never receives -- the pool, the plan, the items, the research file,
// the state, the OS cruft, a digest -- is dropped by the fallback whenever it is met, because that
// is a fact about a name and needs no repository. A LOCK or a TEMP is not: the reader may still be
// handed it, and whether git carries it is a trackedness question only git can answer. So it is
// dropped only when git can be asked and says it does not carry the file, and KEPT otherwise.
//
// When a repository is reachable above the tree -- the export-inside-a-repository layout every
// verification pass uses, and the layout the sweep's own fixtures build -- the tree's trackedness IS
// knowable once git can be run ('git ls-files' rooted at the reachable repository, read against the
// tree's prefix), so it is read rather than guessed. Where nothing is knowable -- no git on PATH,
// which is the form the suite reads both answers through, and no repository anywhere above the tree,
// which is every installed skill -- the lock or temp is KEPT and handed to the guards: 'scanning one
// file too many is the safe direction for a publication guard, and skipping a file the reader
// receives is not'. That is the one direction this file takes wherever the two answers are genuinely
// indistinguishable, and it is why the recorded cost below is a kept file rather than a dropped one.
//
// The measured answers for the sweep's eleven TRACKED layouts (the lock and temp spelling of every
// fixed name, a digest, and the --state-named control) are pinned by tests/hygiene.test.mjs: all
// eleven agree with git's answer now, where ten disagreed before. THEY ARE THE LOCK AND TEMP
// SPELLINGS: the fixed-name class is the bound recorded above, not an agreement. The cost is the
// other half of the
// same reading, and it is recorded and pinned there too: a run artifact's own UNTRACKED lock or temp
// -- which git ignores and drops -- is kept by the no-git answer, because no name can say whether a
// repository carries it and the safe direction is to hand it to a guard.
const RUN_ARTIFACT_SUFFIXES = ['.lock', '.tmp'];
const DIGEST_NAME = /^tech-radar-.*\.(md|html)$/;
// WHICH paths the fallback names as CANDIDATES for the machine-artifact half of the rule (Batch 84;
// closing sweep F36-1 -- it no longer decides the drop by itself, because whether a candidate IS
// dropped is a trackedness question and only git can answer one). A candidate is dropped only when
// git can be asked and says it does not carry the file; where git cannot be asked the candidate is
// kept. Whether the artifact a lock or a temp name GUARDS is itself a run artifact, read from the
// name .gitignore spells: .gitignore spells any '*.lock' and any '*.tmp' because a lock names the
// state it guards, and the guards here judge the shipping set. The name alone was the bound, and it made
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
  // A candidate, not a verdict: the fixed names and the digest spellings say which paths the fallback
  // ASKS about, and the trackedness read below decides whether git's answer already keeps them.
  if (RUN_ARTIFACT_NAMES.has(guarded) || DIGEST_NAME.test(guarded)) return true;
  // The artifact standing beside the lock. It has to be machine state itself, read the one way a
  // name can say so: a run artifact by the rule applied to its own name. A lock beside an ordinary
  // shipped file is not the lock of anything, so it is kept and judged. The rule read the NAME ALONE until
  // Batch 67, so a repository that shipped both 'notes' and 'notes.tmp' lost 'notes.tmp' from the
  // no-git answer while git's answer - which never ignores what it carries - kept it, and the
  // hygiene guard never judged a file the reader receives (closing sweep F33-3, the class F32-5 was
  // filed for). Batch 70 (closing sweep F34-3) then made the guarded sibling's '.json' NAME a run
  // artifact by itself, and Batch 78 (closing sweep F35-3) reverses that clause: it dropped TRACKED
  // locks git keeps -- and one of the sweep's fixtures carried a credential shape in just such a
  // lock, so a file the reader receives went unjudged -- while the two layouts it tried to separate
  // are byte-identical on disk and cannot be told apart without git. The accepted cost, and the
  // direction this file chooses, are stated above the suffix list.
  const beside = rel.slice(0, rel.length - suffix.length);
  if (!existsSync(join(root, beside))) return false;
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

// THE REPOSITORY REACHABLE ABOVE THIS TREE, or null when there is none to ask (Batch 84; closing
// sweep F36-1). This is a different question from gitAnswersForThisTree's, and it is the one the
// fallback needs: git's answer about the SHIPPING SET is only usable when git's own root IS this
// tree, but git's answer about TRACKEDNESS is usable whenever a repository stands above the tree,
// because 'git -C <tree> ls-files' resolves the tree inside that repository and reports paths
// relative to the repository's root. A frozen export unpacked inside a repository -- the layout the
// verifier's own passes and the sweep's fixtures both use -- has exactly this shape, and there the
// tree's trackedness is knowable even though its shipping set is not.
//
// The nearest ancestor carrying a '.git' entry is found first, and git is then asked to confirm it
// and to name the work-tree root; a missing binary, a repository that does not contain this tree, or
// a git that answers with a root outside this tree's ancestry all answer null -- 'nothing is
// knowable', which is the direction that keeps files rather than dropping them.
function reachableRepoRoot(root) {
  let dir = root;
  for (;;) {
    if (existsSync(join(dir, '.git'))) break;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  const res = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (res.error || res.status !== 0) return null;
  const top = String(res.stdout ?? '').trim();
  if (top === '') return null;
  const inside = relative(top, root);
  if (inside !== '' && (inside.startsWith('..') || isAbsolute(inside))) return null;
  return top;
}

// The paths in THIS tree that git CARRIES, as a Set of tree-relative paths, or null when git cannot
// be asked (Batch 84; closing sweep F36-1). One 'git ls-files' call rooted at the reachable
// repository answers for the whole tree: the pathspec is the tree's own prefix inside that
// repository, so the answer is exactly the tracked set of the tree being walked, and it is mapped
// back to the tree's own relative spellings. An index -- not a commit -- is what is read, because
// that is the trackedness 'git check-ignore' answers against: a path git stages is a path git
// carries.
function gitTrackedUnder(root, repoRoot) {
  if (repoRoot === null) return null;
  const prefix = relative(repoRoot, root).split(/[/\\]+/).filter(Boolean).join('/');
  const res = spawnSync('git', ['-C', repoRoot, 'ls-files', '-z', '--', prefix === '' ? '.' : prefix], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return null;
  const strip = prefix === '' ? '' : prefix + '/';
  const tracked = new Set();
  for (const path of String(res.stdout ?? '').split('\0').filter(Boolean)) {
    if (strip === '') tracked.add(path);
    else if (path.startsWith(strip)) tracked.add(path.slice(strip.length));
  }
  return tracked;
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
  // ... and the fallback, which is the answer an installed skill gets (Batch 84; closing sweep
  // F36-1). Two verdicts, and they are answered by different things. A path whose OWN name is one of
  // the fixed artifacts the reader never receives is dropped, whatever git would say: that is a name
  // fact, knowable without git. A LOCK or a TEMP is not -- the reader may still be handed it, and
  // whether git carries it is a trackedness question only git can answer -- so it is dropped only
  // when git can be asked about this tree's trackedness and answers that it does not carry the file.
  // Where nothing is knowable -- a genuinely gitless tree, or the PATH-without-git form the suite
  // reads both answers through -- the lock or temp is KEPT and handed to the guards, because 'a file
  // the reader receives must reach a guard'.
  const ignored = gitIgnored(root, walked);
  if (ignored) return walked.filter((rel) => !ignored.has(rel)).sort();
  const tracked = gitTrackedUnder(root, reachableRepoRoot(root));
  return walked.filter((rel) => !fallbackDrops(rel, root, tracked)).sort();
}

// Whether the fallback drops a path (Batch 84; closing sweep F36-1). The two verdicts above, in the
// one place the fallback asks for them. 'git ls-files' answering with the tree's tracked set is the
// only thing that can drop a lock or a temp; an absent answer keeps it, and so does an answer that
// carries it.
function fallbackDrops(rel, root, tracked) {
  const base = rel.split('/').pop();
  if (RUN_ARTIFACT_NAMES.has(base) || DIGEST_NAME.test(base)) return true;
  if (!guardsRunArtifact(rel, root)) return false;
  return tracked !== null && !tracked.has(rel);
}
