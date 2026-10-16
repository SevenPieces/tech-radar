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
