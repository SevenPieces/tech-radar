// tests/hygiene.test.mjs
// Publication hygiene. Every file the reader receives is public, so the guards here
// cover the two things a published skill must never carry -- the author's private build
// process, and anything shaped like a credential -- plus the rule that decides what
// ships from docs/ and the one configuration value the probe record quotes by name.
// What counts as shipped is decided in tests/lib/shipped-files.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_UA } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { SKILL_ROOT, shippedFiles } from './lib/shipped-files.mjs';

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
