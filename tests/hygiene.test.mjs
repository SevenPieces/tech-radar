// tests/hygiene.test.mjs
// Publication hygiene. Every file the reader receives is public, so the guards here
// cover the two things a published skill must never carry -- the author's private build
// process, and anything shaped like a credential -- plus the rule that decides what
// ships from docs/ and the one configuration value the probe record quotes by name.
// What counts as shipped is decided in tests/lib/shipped-files.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEFAULT_UA } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { SKILL_ROOT, shippedFiles } from './lib/shipped-files.mjs';

// True when the ignore rules of the repository rooted at `root` exclude a path, false when
// they do not, and null when git cannot be asked at all (no binary, or the tree is not a
// repository). The root is a parameter so a case can ask a tree it owns.
function gitSaysIgnored(rel, root = SKILL_ROOT) {
  const res = spawnSync('git', ['-C', root, 'check-ignore', '-q', rel], { encoding: 'utf8' });
  if (res.error || (res.status !== 0 && res.status !== 1)) return null;
  return res.status === 0;
}


// The answer the walk gives in the tree the fallback exists for: the same tree with no git on PATH.
// Every case below that compares the two answers asks the child this one way, so a difference in the
// comparison is a difference in the walk and never in how it was invoked.
function noGitWalk(dir) {
  const moduleUrl = pathToFileURL(join(SKILL_ROOT, 'tests', 'lib', 'shipped-files.mjs')).href;
  const child = spawnSync(process.execPath, ['-e',
    'import(process.argv[1]).then((m) => process.stdout.write(JSON.stringify(m.shippedFiles(process.argv[2]))))',
    moduleUrl, dir],
    { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
  if (child.status !== 0) return 'ERR:' + String(child.stderr).split(String.fromCharCode(10))[0];
  return JSON.parse(String(child.stdout));
}

// A throwaway repository built under the OS temp directory: this repository's own .gitignore, copied
// in verbatim, and the files a case names. The named paths are force-added, which is how a case
// builds the layout git answers for with a TRACKED file its ignore rules would otherwise exclude.
// Returns null when git cannot be started, so a case skips with a named reason rather than failing.
function walkerFixture(files, tracked = []) {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-walker-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const made = spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
  if (made.error || made.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  if (tracked.length > 0) spawnSync('git', ['-C', dir, 'add', '-f', ...tracked], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'fixture'],
    { encoding: 'utf8' });
  return dir;
}

// Every pattern is written with \s+ where a phrase would otherwise be a literal space,
// so this file never matches its own scan.
const PROCESS = [
  ['a build task number', /\btasks?\s+[A-Z]?\d/i],
  ['a named working report', /\bd\d\s+report\b/i],
  ['an unreleased baseline snapshot', /recorded\s+baseline/i],
  ['a related private skill', /sibling\s+(?:skill|briefing)/i],
  ['a review round', /\bround[-\s]\d+/i],
  ['an internal controller role', /\bthe\s+controller\b/i],
  ['an internal owner role', /\bthe\s+owner\b/i],
  ['an internal verifier role', /\bthe\s+verifier\b/i],
  ['a defect label', /(?:defect|finding)s?\s+[A-Z][0-9]+/],
];

const SECRET = [
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{6,}/],
  ['a fine-grained GitHub token', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an API key', /\bsk-[A-Za-z0-9]{20,}/],
  ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];

function scan(root, table, verb) {
  const offenders = [];
  for (const rel of shippedFiles(root)) {
    const text = readFileSync(join(root, rel), 'utf8');
    for (const [what, re] of table) if (re.test(text)) offenders.push(rel + ' ' + verb + ' ' + what);
  }
  return offenders;
}

test('no shipped file carries the build process vocabulary', () => {
  assert.deepEqual(scan(SKILL_ROOT, PROCESS, 'names'), [],
    'shipped files naming the build process: ' + scan(SKILL_ROOT, PROCESS, 'names').join('; '));
});

test('no shipped file carries a credential-shaped string', () => {
  assert.deepEqual(scan(SKILL_ROOT, SECRET, 'carries'), [],
    'shipped files carrying credentials: ' + scan(SKILL_ROOT, SECRET, 'carries').join('; '));
});

// The skip is load-bearing: repository metadata records the commit message and the
// committer's identity, and the whole point of this guard is what the reader is handed,
// not what the author's tooling left on disk. Proven by planting both kinds of leak in
// metadata and in a shipped file of a throwaway tree.
test('the shipping scan ignores repository metadata, which never ships', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-shipped-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, '.git', 'COMMIT_EDITMSG'), 'Task ' + '21 ran the probes\n');
  writeFileSync(join(dir, '.git', 'config'), '[user]\n\temail = ' + 'ghp_' + 'fakefakefakefake' + '\n');
  writeFileSync(join(dir, 'config', 'settings.md'), 'a shipped file\n');
  assert.deepEqual(shippedFiles(dir), ['config/settings.md'], 'only shipped files are scanned');
  assert.deepEqual(scan(dir, PROCESS, 'names'), [], 'metadata is not scanned for the build process');
  assert.deepEqual(scan(dir, SECRET, 'carries'), [], 'metadata is not scanned for credentials');
});

test('.gitignore keeps the publication rule: docs/ ships only its design', () => {
  const lines = readFileSync(join(SKILL_ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('docs/*'), '.gitignore must ignore every file under docs/');
  assert.ok(lines.includes('!docs/design.md'), '.gitignore must re-include docs/design.md');
});

test('the shipped user agent is the transport default the probe record quotes', () => {
  const settings = readSettings(join(SKILL_ROOT, 'config', 'settings.md'));
  assert.equal(settings.user_agent, DEFAULT_UA, 'config/settings.md and the transport default must agree');
});

// Regression test: the walker enumerated the whole working tree and skipped only .git and
// a list of names, so any gitignored working file under docs/ turned the guard red over
// content that never ships - this run's own backlog did exactly that. The scan set is the
// shipping set now: the rule .gitignore states, and every path the repository ignores.
test('the shipping scan judges the shipping set, not the working tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-shipping-'));
  try {
    for (const sub of ['docs', 'config', 'tests']) mkdirSync(join(dir, sub), { recursive: true });
    const processLeak = 'Task ' + '7 ' + 'ran the probes\n';
    const secretLeak = 'ghp_' + 'fakefakefakefake' + '\n';
    writeFileSync(join(dir, 'docs', 'working-notes.md'), processLeak + secretLeak);
    writeFileSync(join(dir, 'docs', 'design.md'), '# the specification\n');
    writeFileSync(join(dir, 'config', 'settings.md'), processLeak);
    writeFileSync(join(dir, 'tests', 'helper.mjs'), secretLeak);
    assert.deepEqual(shippedFiles(dir), ['config/settings.md', 'docs/design.md', 'tests/helper.mjs'],
      'only the design document ships from docs/');
    // The extension is the point: ignoring the working tree must not blunt the guard.
    assert.deepEqual(scan(dir, PROCESS, 'names'), ['config/settings.md names a build task number'],
      'a shipped file naming the build process is still caught');
    assert.deepEqual(scan(dir, SECRET, 'carries'), ['tests/helper.mjs carries a GitHub token'],
      'a shipped file carrying a credential shape is still caught');
    // A tree can carry a nested copy of this layout, and that copy states the publication rule
    // in its own .gitignore -- which is the rule git reads when it answers for such a tree. The
    // walk's fallback applied the rule only at the root, so the copy's working material entered
    // the shipping set and both scans above went red over paths the reader never receives. The
    // stated rule is read at every docs/ in the tree now, so the fallback agrees with git's own
    // answer for the same layout instead of reporting the copy's scratch work as unpublished.
    const nested = join(dir, 'nested-copy');
    mkdirSync(join(nested, 'docs'), { recursive: true });
    writeFileSync(join(nested, '.gitignore'), readFileSync(join(SKILL_ROOT, '.gitignore')));
    writeFileSync(join(nested, 'docs', 'design.md'), '# the specification\n');
    writeFileSync(join(nested, 'docs', 'working-notes.md'), processLeak + secretLeak);
    const walked = shippedFiles(dir);
    assert.equal(walked.includes('nested-copy/docs/design.md'), true,
      'a nested copy of this layout ships the document its own docs/ publishes');
    assert.equal(walked.includes('nested-copy/docs/working-notes.md'), false,
      "a nested copy's working material never enters the shipping set");
    assert.deepEqual(scan(dir, PROCESS, 'names'), ['config/settings.md names a build task number'],
      "a nested copy's working material never reaches the build-process guard");
    assert.deepEqual(scan(dir, SECRET, 'carries'), ['tests/helper.mjs carries a GitHub token'],
      "a nested copy's credential shape never reaches the credential guard");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression test: the walker statted every entry before it applied the publication rule,
// so a dangling symlink anywhere in the tree - including under the working material that
// never ships - threw ENOENT out of every guard that consults the walk, and an entry that
// vanished between the directory listing and the stat raced the same way. The rule is read
// from the path first, and an entry the walk cannot read is skipped rather than thrown
// over, while a leak planted in a file that does ship is still caught.
test('a dangling symlink does not break the guards, and a shipped leak is still caught', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-dangling-'));
  try {
    mkdirSync(join(dir, 'docs', 'planted'), { recursive: true });
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'design.md'), '# the specification\n');
    writeFileSync(join(dir, 'config', 'settings.md'), 'Task ' + '7 ' + 'ran the probes\n');
    // A broken link under the working material, where a sibling run's scratch tree leaves one.
    symlinkSync(join(dir, 'docs', 'planted', 'nowhere.json'), join(dir, 'docs', 'planted', 'dangling.json'));
    // One beside a shipped file too, where the rule does not prune it: the walk has to
    // survive an entry whose stat cannot answer.
    symlinkSync(join(dir, 'config', 'absent.md'), join(dir, 'config', 'dangling.md'));
    assert.deepEqual(shippedFiles(dir), ['config/settings.md', 'docs/design.md'],
      'the walk survives a broken link and still judges the shipping set');
    assert.deepEqual(scan(dir, PROCESS, 'names'), ['config/settings.md names a build task number'],
      'a leak in a file that ships is still caught');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The walker asks the repository itself, so a path the ignore rules exclude is skipped even
// when it sits beside shipped files, while the same leak planted in a shipped file fails.
// The fixture is a repository this case builds for itself, under a name unique to the
// process, and removes in the finally: nothing is written into the working tree the suite
// runs in, so a second copy of the suite checked out inside this one -- or a run overlapping
// this one -- can neither see the fixture nor change the verdict, and the walk judged here is
// the one rooted at this case's own tree. The rule it applies is this repository's own
// .gitignore, copied in verbatim, so the walk still consults the publication rule the
// checkout states.
test('a gitignored path is skipped while a shipped file is still scanned', (t) => {
  const tag = 'planted-' + process.pid + '-' + Date.now().toString(36);
  const ignoredRel = 'tests/' + tag + '.tmp';
  const shippedRel = 'tests/' + tag + '-fixture.txt';
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-ignored-'));
  const leak = 'Task ' + '7 ' + 'ran the probes\n';
  const secret = 'ghp_' + 'fakefakefakefake' + '\n';
  try {
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), readFileSync(join(SKILL_ROOT, '.gitignore')));
    writeFileSync(join(dir, ignoredRel), leak + secret);
    writeFileSync(join(dir, shippedRel), leak + secret);
    // The rule is answered only inside a work tree, so the fixture tree is made one.
    const made = spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
    const ignored = made.error || made.status !== 0 ? null : gitSaysIgnored(ignoredRel, dir);
    const files = shippedFiles(dir);
    const named = scan(dir, PROCESS, 'names');
    const carried = scan(dir, SECRET, 'carries');
    // This half holds whatever git can answer: the guard must not be blunted by the skip.
    assert.equal(files.includes(shippedRel), true, 'a file the repository ships is scanned');
    assert.equal(named.includes(shippedRel + ' names a build task number'), true,
      'the shipped leak is still caught: ' + named.join('; '));
    assert.equal(carried.includes(shippedRel + ' carries a GitHub token'), true,
      'the shipped credential shape is still caught: ' + carried.join('; '));
    if (ignored === null) {
      t.skip('git is not available, so the repository ignore rule was not consulted');
      return;
    }
    assert.equal(ignored, true, 'the fixture name is one the repository ignores: ' + ignoredRel);
    assert.equal(files.includes(ignoredRel), false, 'a gitignored run artifact is never scanned');
    assert.equal(named.some((o) => o.startsWith(ignoredRel)), false, 'the ignored leak is not reported');
    assert.equal(carried.some((o) => o.startsWith(ignoredRel)), false, 'the ignored credential shape is not reported');
    // The same shape is one this checkout ignores, asked without planting anything in it.
    const realIgnored = gitSaysIgnored(ignoredRel);
    if (realIgnored !== null) {
      assert.equal(realIgnored, true,
        'this repository ignores a run artifact under tests/: ' + ignoredRel);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


// Closing sweep F31-10 (Med, test integrity; reproduced by the sweep): the walker asked
// 'git -C <tree> check-ignore' whenever git answered at all, and 'git -C' answers from the
// NEAREST ENCLOSING work tree. A tree that is not itself a repository root - a frozen
// git-archive export unpacked inside another repository, which is exactly how every
// verification pass runs - was therefore answered by the OUTER repository, whose ignore
// rules (and whose docs/ entry) have nothing to do with this tree: the walk returned ZERO
// paths while both guards above still reported green, so the whole suite's no-credential
// claim rested on a scan of nothing. The walk now uses git's answer only when git's own
// work-tree root IS the tree it is walking, and falls back to the stated rule otherwise.
test('the shipping scan is not inert when git resolves to an outer repository', (t) => {
  const outer = mkdtempSync(join(tmpdir(), 'tech-radar-outer-'));
  const leak = 'Task ' + '7 ' + 'ran the probes\n';
  const secret = 'ghp_' + 'fakefakefakefake' + '\n';
  try {
    const skill = join(outer, 'skill');
    mkdirSync(join(skill, 'config'), { recursive: true });
    mkdirSync(join(skill, 'docs'), { recursive: true });
    writeFileSync(join(skill, '.gitignore'), 'docs/*\n!docs/design.md\n');
    writeFileSync(join(skill, 'config', 'settings.md'), leak + secret);
    writeFileSync(join(skill, 'docs', 'design.md'), '# the specification\n');
    writeFileSync(join(outer, '.gitignore'), 'skill/\n');
    const made = spawnSync('git', ['-C', outer, 'init', '-q'], { encoding: 'utf8' });
    if (made.error || made.status !== 0) {
      t.skip('git is not available, so the outer-repository case cannot be built');
      return;
    }
    // The premise: git's answer for this tree comes from the outer repository and says the
    // whole tree is ignored - the state the frozen export is in when a verification pass
    // unpacks it inside a checkout.
    const viaOuter = spawnSync('git', ['-C', skill, 'check-ignore', '-q', 'config/settings.md'], { encoding: 'utf8' });
    if (viaOuter.error || (viaOuter.status !== 0 && viaOuter.status !== 1)) {
      t.skip('git cannot answer for the fixture tree');
      return;
    }
    assert.equal(viaOuter.status, 0, 'the outer repository ignores the whole fixture tree');
    // The walker must not turn that into 'nothing ships': the guard has to judge the files
    // the reader receives, and the leak planted in a shipped file must still be caught.
    const files = shippedFiles(skill);
    assert.ok(files.length > 0, 'the walker returned no paths while git resolved to an outer repository');
    assert.equal(files.includes('config/settings.md'), true,
      'a shipped file was dropped because an outer repository ignores it: ' + JSON.stringify(files));
    assert.equal(files.includes('docs/design.md'), true, 'the design document still ships');
    assert.equal(files.includes('docs/working-notes.md'), false);
    assert.deepEqual(scan(skill, PROCESS, 'names'), ['config/settings.md names a build task number'],
      'a silently inert scan: the planted leak was not reported');
    assert.deepEqual(scan(skill, SECRET, 'carries'), ['config/settings.md carries a GitHub token'],
      'a silently inert scan: the planted credential shape was not reported');
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

// .gitignore covered only the two documented lock spellings, so the lock of a state file
// with any other name was trackable and a stray `git add -A` could publish it. The rule is
// general now; this asks the repository about a name the shipped list never mentions.
test('.gitignore ignores the lock of a state file it does not name', (t) => {
  const ignored = gitSaysIgnored('custom-state.json.lock');
  if (ignored === null) {
    t.skip('git is not available, so the ignore rule cannot be consulted');
    return;
  }
  assert.equal(ignored, true,
    '.gitignore must cover the lock of any state file, not only the documented spellings');
});

// Regression test: the earlier ignore rule was written as *.json.lock, so the lock of a
// state file named without that suffix - "run the update with --state foo" - stayed
// trackable and a stray `git add -A` can publish it along with the hostname it
// records. The pattern covers any lock, whatever the state beside it is called.
test('.gitignore ignores the lock of a state named without the .json suffix', (t) => {
  const ignored = gitSaysIgnored('custom.lock');
  if (ignored === null) {
    t.skip('git is not available, so the ignore rule cannot be consulted');
    return;
  }
  assert.equal(ignored, true,
    '.gitignore must cover a lock for any state name, not only the .json spellings');
});

// Closing sweep F32-5: the walk's two answers disagreed about a TRACKED file whose name merely
// ends in one of the run-artifact spellings. 'git check-ignore' never reports a tracked path -
// git does not ignore what it carries - so the repository's answer kept 'kept.tmp' while the
// fallback dropped it on the '*.tmp' suffix alone, and a file the reader receives went unjudged in
// exactly the tree where the fallback is the only answer there is. The suffix rule now reads the
// artifact the lock or temp name GUARDS (the name a run writes, or the artifact standing beside
// it), so both answers keep this file and the guard judges it - while a run artifact is still
// dropped, which the CV-4 cases above pin for '.pool.json'.
test('a tracked file merely named like a run artifact is kept by both answers, and is judged', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-lookalike-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), readFileSync(join(SKILL_ROOT, '.gitignore')));
    writeFileSync(join(dir, 'config', 'settings.md'), 'a shipped file\n');
    writeFileSync(join(dir, 'kept.tmp'), 'Task ' + '7 ' + 'ran the probes\n');
    const made = spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
    if (made.error || made.status !== 0) {
      t.skip('git is not available, so the repository answer was not exercised');
      return;
    }
    // '.gitignore' ignores the spelling, so the fixture has to force the file in: the case under
    // test is a file the repository SHIPS whose name the rule would otherwise drop.
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'add', '-f', 'kept.tmp'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'fixture'],
      { encoding: 'utf8' });
    assert.equal(gitSaysIgnored('kept.tmp', dir), false,
      'the fixture file is not tracked, so the case under test was not built');
    const withGit = shippedFiles(dir);
    assert.equal(withGit.includes('kept.tmp'), true,
      "the repository's own answer dropped a file it ships: " + JSON.stringify(withGit));
    assert.deepEqual(scan(dir, PROCESS, 'names'), ['kept.tmp names a build task number'],
      'a shipped leak beside a run-artifact name was not judged');
    // The fallback answer: the same tree with no git on PATH, which is the tree the rule exists
    // for. The two answers must name the same files.
    const moduleUrl = pathToFileURL(join(SKILL_ROOT, 'tests', 'lib', 'shipped-files.mjs')).href;
    const child = spawnSync(process.execPath, ['-e',
      'import(process.argv[1]).then((m) => process.stdout.write(JSON.stringify(m.shippedFiles(process.argv[2]))))',
      moduleUrl, dir],
      { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
    assert.equal(child.status, 0, 'the fallback walk did not run: ' + String(child.stderr).split('\n')[0]);
    assert.deepEqual(JSON.parse(String(child.stdout)), withGit,
      'the two answers disagree about a file the repository ships');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Closing sweep F33-3 (the class F32-5 was filed for, narrowed but not closed by Batch 66). The
// F32-5 case above is a lookalike with NO artifact of its own name beside it. This case is the one
// Batch 66's 'beside it' clause still got wrong: the repository tracks BOTH 'notes' and 'notes.tmp',
// so the temp file guards an ordinary shipped file rather than a run artifact, and the rule - which
// read the name alone - dropped it from the no-git answer while git's answer kept it. Batch 67
// requires the artifact standing beside the lock to be a run artifact by its own name, so both
// answers keep 'notes.tmp' and the hygiene guard judges a file the reader receives.

// Closing sweep F34-3 (Low, a regression Batch 68 introduced) asked for one thing, and closing
// sweep F35-3 asked for its mirror image. Batch 68 required the artifact beside a lock to be a run
// artifact BY NAME, and the fixed names carry no spelling for a state file named by --state:
// 'mystate.json.lock' was therefore kept by the no-git answer while git's answer dropped it (the
// '.gitignore' rule ignores any '*.lock'), so the guard read a run artifact the reader never
// receives. Batch 70 answered that by dropping any lock whose guarded sibling merely ENDED IN
// '.json', which made the two answers disagree the other way, on a TRACKED lock git keeps (the next
// case but one). Batch 78 (closing sweep F35-3) reverses Batch 70's clause. The two layouts cannot
// be told apart without git -- the same two files, one tracked lock and one untracked, are
// byte-identical on disk -- so this file takes the direction its own header names as acceptable:
// 'scanning one file too many is the safe direction for a publication guard, and skipping a file
// the reader receives is not'. This case pins the cost: git's answer drops the --state-named lock
// and temp (they are ignored run artifacts), and the no-git answer keeps them.
test('a --state-named lock is dropped by the repository and kept by the no-git answer (the safe direction)', (t) => {
  const dir = walkerFixture({
    '.gitignore': readFileSync(join(SKILL_ROOT, '.gitignore')),
    'config/settings.md': 'a shipped file\n',
    'mystate.json': '{"runs":[]}\n',
    'mystate.json.lock': '{"host":"the builder"}\n',
    'mystate.json.tmp': 'ghp_' + 'fakefakefakefake' + '\n',
  });
  if (dir === null) {
    t.skip('git is not available, so the repository answer was not exercised');
    return;
  }
  try {
    const withGit = shippedFiles(dir);
    assert.deepEqual(withGit, ['.gitignore', 'config/settings.md', 'mystate.json'],
      'the state-named lock or temp entered the repository answer: ' + JSON.stringify(withGit));
    const without = noGitWalk(dir);
    assert.deepEqual(without,
      ['.gitignore', 'config/settings.md', 'mystate.json', 'mystate.json.lock', 'mystate.json.tmp'],
      'the fallback dropped a file it has no tracking information about: ' + JSON.stringify(without));
    assert.deepEqual(scan(dir, SECRET, 'carries'), [],
      'the repository answer read a run artifact the reader never receives');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The other half of the same reading, and the direction Batch 68 was filed for: the run artifact
// ITSELF -- the fixed name the reader never receives -- is dropped by both answers, and a credential
// planted in it reaches no guard. The fixture is the layout the run writes for itself: '.pool.json'
// and its lock and temp spellings.
//
// Batch 84 (closing sweep F36-1) changed what the fallback does about the LOCK and the TEMP, and this
// case now pins that direction rather than an agreement it never had: the fixed name is a name fact
// and both answers drop it, while whether a lock or temp is dropped is a TRACKEDNESS fact that only
// git can answer. Git answers here -- the fixture's ignore rules cover '*.lock' and '*.tmp' and
// nothing tracks them -- so git's answer drops both; the no-git answer keeps both and hands them to
// the guards, which is the direction this file's header names as safe ('skipping a file the reader
// receives is not'). The sweep measured that direction as the only one available: the two layouts (a
// tracked lock and an untracked one) are byte-identical on disk.
test('the run artifact both answers drop is dropped by both, and its untracked lock and temp are kept by the no-git answer', (t) => {
  const dir = walkerFixture({
    '.gitignore': readFileSync(join(SKILL_ROOT, '.gitignore')),
    'config/settings.md': 'a shipped file\n',
    '.pool.json': '[]\n',
    '.pool.json.lock': '{"host":"the builder"}\n',
    '.pool.json.tmp': 'ghp_' + 'fakefakefakefake' + '\n',
  });
  if (dir === null) {
    t.skip('git is not available, so the repository answer was not exercised');
    return;
  }
  try {
    const withGit = shippedFiles(dir);
    assert.deepEqual(withGit, ['.gitignore', 'config/settings.md'],
      'a run artifact entered the repository answer: ' + JSON.stringify(withGit));
    assert.deepEqual(noGitWalk(dir),
      ['.gitignore', '.pool.json.lock', '.pool.json.tmp', 'config/settings.md'],
      'the fallback dropped a lock or temp it has no tracking information about');
    assert.deepEqual(scan(dir, SECRET, 'carries'), [], 'a guard read the run artifact itself');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Closing sweep F36-1 (Medium): Batch 78 closed only the '*.json' spelling of the same disagreement
// and left every FIXED name in RUN_ARTIFACT_NAMES and every DIGEST_NAME spelling dropped from the
// no-git answer on the NAME alone. 'git check-ignore' never reports a TRACKED path -- git does not
// ignore what it carries -- so a TRACKED '.pool.json.lock', '.plan.json.lock',
// 'tech-radar-state.json.lock', 'tech-radar-2026-10-15.html.lock' or '.pool.json.tmp' is in git's
// answer and was dropped from the fallback's, and a repository that force-adds its own run artifact's
// lock never had it judged by a publication guard -- the sweep's fixture carried a credential shape
// in exactly such a lock, and 10 of its 11 layouts disagreed. The lock's name says nothing about
// trackedness, so the fallback no longer decides on the name: a lock or temp is dropped only when git
// can be asked and says it does not carry the file, and where nothing is knowable it is kept. The
// eleven layouts the sweep measured are built here as one tracked set; every one must be in BOTH
// answers, and the publication guard must read the credential shape each carries.
test('every TRACKED lock and temp of a fixed run-artifact name is kept by BOTH answers and judged', (t) => {
  const names = ['.tech-radar-state.lock', 'tech-radar-state.json.lock', '.pool.json.lock',
    '.plan.json.lock', '.items.json.lock', '.research.json.lock',
    'tech-radar-2026-10-15.html.lock', 'tech-radar-2026-10-15.md.lock', '.pool.json.tmp',
    'tech-radar-state.json.tmp'];
  const files = { '.gitignore': readFileSync(join(SKILL_ROOT, '.gitignore')), 'config/settings.md': 'a shipped file\n' };
  for (const name of names) files[name] = 'ghp_' + 'fakefakefakefake' + '\n';
  const dir = walkerFixture(files, names);
  if (dir === null) {
    t.skip('git is not available, so the repository answer was not exercised');
    return;
  }
  try {
    const withGit = shippedFiles(dir);
    for (const name of names) {
      assert.equal(withGit.includes(name), true,
        name + ' is not in the repository answer, so the case under test was not built');
    }
    assert.deepEqual(noGitWalk(dir), withGit,
      'the two walker answers disagree about a TRACKED lock or temp of a fixed run-artifact name');
    assert.deepEqual(scan(dir, SECRET, 'carries').sort(),
      names.map((name) => name + ' carries a GitHub token').sort(),
      'a TRACKED run-artifact lock the reader receives was not judged by the publication guard');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// F37-2 (final verification; a Low residual of F36-1, RECORDED rather than closed). Batch 84's
// trackedness read decides the LOCK and TEMP half of the machine-artifact rule; the fixed-name half is
// still answered by the NAME alone, before git is consulted. So a repository that FORCE-ADDS a file
// whose own name is a fixed run artifact or a digest -- the only way to track a name .gitignore
// ignores -- ships a file the reader receives: git's answer keeps it, the no-git answer drops it on
// the name, and no publication guard reads it. Measured on this fixture: 10 of 10 fixed names
// disagree. That is the bound, and this case pins BOTH of its halves so a later round cannot close it
// silently or regress it the other way: the repository answer carries the names (and the guard reads
// the credential in them), and the no-git answer still drops them. The alternative direction -- keep
// every fixed name wherever git cannot be asked, as the lock and temp half does -- was rejected
// because it would hand an installed skill's own '.pool.json' and digests to the guards, which is the
// failure the fallback exists to prevent. Reach: a repository, or an export inside one, that
// force-adds one of these names. Batch 84's commit subject claimed every TRACKED run-artifact
// spelling agrees; it covers the lock and temp spellings only.
test('a TRACKED fixed run-artifact name is kept by the repository and dropped by the no-git answer (the recorded F37-2 bound)', (t) => {
  const names = ['.pool.json', 'tech-radar-state.json', 'tech-radar-2026-10-15.md', 'tech-radar-2026-10-15.html'];
  const files = { '.gitignore': readFileSync(join(SKILL_ROOT, '.gitignore')), 'config/settings.md': 'a shipped file\n' };
  for (const name of names) files[name] = 'ghp_' + 'fakefakefakefake' + '\n';
  const dir = walkerFixture(files, names);
  if (dir === null) {
    t.skip('git is not available, so the repository answer was not exercised');
    return;
  }
  try {
    const withGit = shippedFiles(dir);
    assert.deepEqual(withGit, names.concat(['.gitignore', 'config/settings.md']).sort(),
      'the repository answer does not carry the force-added fixed names, so the case under test was not built');
    assert.deepEqual(scan(dir, SECRET, 'carries').sort(),
      names.map((name) => name + ' carries a GitHub token').sort(),
      'the repository answer carried a fixed name the publication guard did not read');
    assert.deepEqual(noGitWalk(dir), ['.gitignore', 'config/settings.md'],
      'the no-git answer no longer drops the fixed names, so the recorded bound no longer describes the walk');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The trackedness read itself, and the clause that makes it load-bearing (Batch 84; closing sweep
// F36-1). The sweep's own fixtures cannot distinguish this clause from its absence, because every
// one of them is read through the PATH-without-git form of the fallback. A tree that sits INSIDE a
// repository -- the export-inside-a-repository layout every verification pass uses -- is not
// answered by 'git check-ignore' (git's own work-tree root is not this tree), so the fallback runs
// with git reachable: 'git ls-files' rooted at that repository then answers, and a lock the
// repository does not carry is dropped while one it carries is kept. Both directions are measured
// here, against the same tree read with no git at all, where neither is knowable and both are kept.
test('a lock the repository above the tree does not carry is dropped, and one it carries is kept', (t) => {
  const outer = mkdtempSync(join(tmpdir(), 'tech-radar-outer-'));
  const inner = join(outer, 'export');
  try {
    mkdirSync(join(inner, 'config'), { recursive: true });
    writeFileSync(join(outer, '.gitignore'), readFileSync(join(SKILL_ROOT, '.gitignore')));
    writeFileSync(join(inner, '.gitignore'), readFileSync(join(SKILL_ROOT, '.gitignore')));
    writeFileSync(join(inner, 'config', 'settings.md'), 'a shipped file\n');
    writeFileSync(join(inner, '.pool.json.lock'), '{"host":"the builder"}\n');
    writeFileSync(join(inner, '.plan.json.tmp'), '{"host":"the builder"}\n');
    const made = spawnSync('git', ['-C', outer, 'init', '-q'], { encoding: 'utf8' });
    if (made.error || made.status !== 0) {
      t.skip('git is not available, so the repository answer was not exercised');
      return;
    }
    spawnSync('git', ['-C', outer, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', outer, 'add', '-f', 'export/.pool.json.lock'], { encoding: 'utf8' });
    spawnSync('git', ['-C', outer, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'fixture'],
      { encoding: 'utf8' });
    assert.equal(spawnSync('git', ['-C', outer, 'ls-files', '--', 'export/.pool.json.lock'],
      { encoding: 'utf8' }).stdout.trim(), 'export/.pool.json.lock',
      'the fixture lock is not tracked, so the case under test was not built');
    assert.deepEqual(shippedFiles(inner), ['.gitignore', '.pool.json.lock', 'config/settings.md'],
      'the fallback did not use the trackedness the repository above the tree can answer');
    assert.deepEqual(noGitWalk(inner),
      ['.gitignore', '.plan.json.tmp', '.pool.json.lock', 'config/settings.md'],
      'where nothing is knowable the fallback dropped a lock or temp the reader may receive');
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

// The state lock's own legacy spelling is named by .gitignore itself ('.tech-radar-state.lock').
// Batch 70 recognised the state's dotted spelling as machine state, which made both answers drop an
// UNTRACKED one; Batch 84 (closing sweep F36-1) moved that verdict to the trackedness read, because
// the same name can be TRACKED (git's answer then keeps it, and the fallback's name-only drop skipped
// a file the reader receives). This case now pins the direction: git drops the ignored lock, the no-git
// answer keeps it for the guards.
test('the state lock spelling .gitignore names for itself is dropped by the repository and kept by the no-git answer', (t) => {
  const dir = walkerFixture({
    '.gitignore': readFileSync(join(SKILL_ROOT, '.gitignore')),
    'config/settings.md': 'a shipped file\n',
    '.tech-radar-state.lock': '{"host":"the builder"}\n',
  });
  if (dir === null) {
    t.skip('git is not available, so the repository answer was not exercised');
    return;
  }
  try {
    const withGit = shippedFiles(dir);
    assert.deepEqual(withGit, ['.gitignore', 'config/settings.md'],
      'the state lock entered the repository answer: ' + JSON.stringify(withGit));
    assert.deepEqual(noGitWalk(dir), ['.gitignore', '.tech-radar-state.lock', 'config/settings.md'],
      'the fallback dropped a state lock it has no tracking information about');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Closing sweep F35-3 (Low, a regression Batch 70 introduced), pinned on the layout the sweep
// measured. A lock the repository TRACKS is kept by git's answer whatever the ignore rules say - git
// does not ignore what it carries - and Batch 70's clause dropped it from the no-git answer on the
// guarded sibling's '.json' NAME alone, so the two answers disagreed on a file the reader receives.
// One of the sweep's fixtures carried a credential shape in just such a tracked lock, so the
// publication guard never judged it. Batch 78 reverses that clause: the name-only rule keeps the
// file, the fallback's set holds it beside git's, and the guard judges what it carries. The two
// layouts (tracked and untracked lock, same two files on disk) cannot be told apart without git;
// this is the direction this file's header names, and the case above pins its cost.
test('a TRACKED lock of a state file is kept by BOTH answers, and the guard judges what it carries', (t) => {
  const dir = walkerFixture({
    '.gitignore': readFileSync(join(SKILL_ROOT, '.gitignore')),
    'config/settings.md': 'a shipped file\n',
    'mystate.json': '{"runs":[]}\n',
    'mystate.json.lock': 'ghp_' + 'fakefakefakefake' + '\n',
  }, ['mystate.json', 'mystate.json.lock']);
  if (dir === null) {
    t.skip('git is not available, so the repository answer was not exercised');
    return;
  }
  try {
    const withGit = shippedFiles(dir);
    assert.equal(withGit.includes('mystate.json.lock'), true,
      'the fixture lock is not tracked, so the case under test was not built');
    assert.deepEqual(noGitWalk(dir), withGit,
      'the two answers disagree about a tracked lock of a state file');
    assert.deepEqual(scan(dir, SECRET, 'carries'), ['mystate.json.lock carries a GitHub token'],
      'a file the reader receives was not judged by the publication guard');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The same class in its two other spellings, both measured by the F35-3 sweep: a TRACKED
// '*.json.tmp' beside its document, and the case-insensitive '.JSON.lock' spelling. Each is kept by
// git and was dropped by Batch 70's clause; both answers must keep it now.
test('a tracked .json.tmp and a tracked .JSON.lock are kept by both answers', (t) => {
  const dir = walkerFixture({
    '.gitignore': readFileSync(join(SKILL_ROOT, '.gitignore')),
    'config/settings.md': 'a shipped file\n',
    'data.json': '{}\n',
    'data.json.tmp': '{"host":"the builder"}\n',
    'mystate.JSON': '{}\n',
    'mystate.JSON.lock': '{"host":"the builder"}\n',
  }, ['data.json', 'data.json.tmp', 'mystate.JSON', 'mystate.JSON.lock']);
  if (dir === null) {
    t.skip('git is not available, so the repository answer was not exercised');
    return;
  }
  try {
    const withGit = shippedFiles(dir);
    for (const rel of ['data.json.tmp', 'mystate.JSON.lock']) {
      assert.equal(withGit.includes(rel), true,
        rel + ' is not in the repository answer, so the case under test was not built');
    }
    assert.deepEqual(noGitWalk(dir), withGit,
      'the two answers disagree about a tracked temp or lock of a JSON document');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tracked temp file beside a tracked file of its own name is kept and judged', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-pair-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), readFileSync(join(SKILL_ROOT, '.gitignore')));
    writeFileSync(join(dir, 'config', 'settings.md'), 'a shipped file\n');
    writeFileSync(join(dir, 'notes'), 'ordinary notes\n');
    writeFileSync(join(dir, 'notes.tmp'), 'Task ' + '7 ' + 'ran the probes\n');
    const made = spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
    if (made.error || made.status !== 0) {
      t.skip('git is not available, so the repository answer was not exercised');
      return;
    }
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'add', '-f', 'notes', 'notes.tmp'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'fixture'],
      { encoding: 'utf8' });
    assert.equal(gitSaysIgnored('notes.tmp', dir), false,
      'the fixture temp file is not tracked, so the case under test was not built');
    const withGit = shippedFiles(dir);
    assert.equal(withGit.includes('notes.tmp'), true,
      "the repository's own answer dropped a file it ships: " + JSON.stringify(withGit));
    assert.equal(withGit.includes('notes'), true,
      "the repository's own answer dropped the file the temp name guards: " + JSON.stringify(withGit));
    assert.deepEqual(scan(dir, PROCESS, 'names'), ['notes.tmp names a build task number'],
      'a shipped leak beside a tracked lookalike was not judged');
    const moduleUrl = pathToFileURL(join(SKILL_ROOT, 'tests', 'lib', 'shipped-files.mjs')).href;
    const child = spawnSync(process.execPath, ['-e',
      'import(process.argv[1]).then((m) => process.stdout.write(JSON.stringify(m.shippedFiles(process.argv[2]))))',
      moduleUrl, dir],
      { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
    assert.equal(child.status, 0, 'the fallback walk did not run: ' + String(child.stderr).split('\n')[0]);
    assert.deepEqual(JSON.parse(String(child.stdout)), withGit,
      'the two answers disagree about a temp file whose guarded artifact is an ordinary shipped file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
