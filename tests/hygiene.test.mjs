// tests/hygiene.test.mjs
// Publication hygiene. Every file the reader receives is public, so the guards here
// cover the two things a published skill must never carry -- the author's private build
// process, and anything shaped like a credential -- plus the rule that decides what
// ships from docs/ and the one configuration value the probe record quotes by name.
// What counts as shipped is decided in tests/lib/shipped-files.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_UA } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { SKILL_ROOT, shippedFiles } from './lib/shipped-files.mjs';

// True when the repository's own ignore rules exclude a path, false when they do not, and
// null when git cannot be asked at all (no binary, or the tree is not a repository).
function gitSaysIgnored(rel) {
  const res = spawnSync('git', ['-C', SKILL_ROOT, 'check-ignore', '-q', rel], { encoding: 'utf8' });
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The walker asks the repository itself, so a path the ignore rules exclude is skipped even
// when it sits beside shipped files, while the same leak planted in a shipped file fails.
// Both fixtures are removed in the finally and their names are unique per run.
test('a gitignored path is skipped while a shipped file is still scanned', (t) => {
  const tag = 'planted-' + process.pid + '-' + Date.now().toString(36);
  const ignoredRel = 'tests/' + tag + '.tmp';
  const shippedRel = 'tests/' + tag + '-fixture.txt';
  const ignoredPath = join(SKILL_ROOT, ignoredRel);
  const shippedPath = join(SKILL_ROOT, shippedRel);
  const ignored = gitSaysIgnored(ignoredRel);
  const leak = 'Task ' + '7 ' + 'ran the probes\n';
  const secret = 'ghp_' + 'fakefakefakefake' + '\n';
  try {
    writeFileSync(ignoredPath, leak + secret);
    writeFileSync(shippedPath, leak + secret);
    const files = shippedFiles(SKILL_ROOT);
    const named = scan(SKILL_ROOT, PROCESS, 'names');
    const carried = scan(SKILL_ROOT, SECRET, 'carries');
    // This half holds whatever git can answer: the guard must not be blunted by the skip.
    assert.equal(files.includes(shippedRel), true, 'a file under tests/ ships and is scanned');
    assert.equal(named.includes(shippedRel + ' names a build task number'), true,
      'the shipped leak is still caught: ' + named.join('; '));
    assert.equal(carried.includes(shippedRel + ' carries a GitHub token'), true,
      'the shipped credential shape is still caught: ' + carried.join('; '));
    if (ignored === null) {
      t.diagnostic('git is not available, so the repository ignore rule was not consulted');
      return;
    }
    assert.equal(ignored, true, 'the fixture name is one the repository ignores: ' + ignoredRel);
    assert.equal(files.includes(ignoredRel), false, 'a gitignored run artifact is never scanned');
    assert.equal(named.some((o) => o.startsWith(ignoredRel)), false, 'the ignored leak is not reported');
    assert.equal(carried.some((o) => o.startsWith(ignoredRel)), false, 'the ignored credential shape is not reported');
  } finally {
    rmSync(ignoredPath, { force: true });
    rmSync(shippedPath, { force: true });
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
