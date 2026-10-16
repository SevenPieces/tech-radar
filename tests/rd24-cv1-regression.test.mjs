// tests/rd24-cv1-regression.test.mjs
// Regression tests for CV-1 (the notice cap and the push's redaction) and CV-4 (an installed
// tree without .git that carries the skill's own run artifact). CV-1 was recorded independently
// by two passes over 976b549: docs/hardening-2026-10-15/scratch-close-verify (section 5(b),
// cv-redact-cap.mjs) and docs/hardening-2026-10-15/scratch-close-sweep12 (F1, probe-redact-cap.mjs
// and probe-shipped-plus-listing.mjs). Both report the same mechanism, and it is the one this file
// pins.
//
// The cap and the shaped-error bound are one guarantee: a notice is the source it names, the
// ': ' separator and the shaped error text, the room is split between the two halves, and a pair
// the configuration accepts is supposed to leave the transport cause (or the HTTP status) whole.
// The notice rewriting is a fixed point, so the source cannot take the room back by growing. The
// push's redaction, however, runs AFTER that pricing and BEFORE the slice to notice_max_chars, and
// '[redacted]' is ten characters long, so a value shorter than the marker that the run redacts
// grows an already-priced part, the slice removes the tail, and the tail is where the cause sits.
// The operator's stderr line then loses the reason entirely (its pattern is anchored at the end of
// the notice). The same loss happens through three seams -- the per-request push in collectFeeds,
// the per-collector pass redactNotices, and the final global union pass in collectAll -- so the
// cases below drive the shipped collectAll (which runs all three) and the shipped CLI.
//
// CV-4: tests/lib/shipped-files.mjs falls back to the stated publication rule alone when git
// cannot answer, so an installed skill (no .git) that carries its own run artifact under
// ./tech-radar scans a file that never ships and the hygiene guard goes red over it. The cases
// below exercise the walker directly and then run the shipped hygiene guard in a copy of this
// tree without .git, with a control that plants the same offending text in a shipping path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectAll, collectFeeds, operatorWarning } from '../scripts/collect.mjs';
import { redactSecrets, requestSecrets, shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { shippedFiles } from './lib/shipped-files.mjs';

const SKILL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const CLI = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
// The guard this file drives in a copy of the tree. It is named relative to the copy's own root,
// never by this checkout's absolute path: the child process runs with its cwd at the copy, and a
// copied guard must resolve the copied SKILL_ROOT, not the tree it was copied from.
const SUITE_REL = join('tests', 'hygiene.test.mjs');
const RUN_ARTIFACT = join(SKILL_ROOT, 'tech-radar', '.pool.json');
const SHIPPED_SETTINGS = readSettings(join(CONFIG_DIR, 'settings.md'));
const RUN_SETTINGS = { ...SHIPPED_SETTINGS, github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const PROBE = 'https://api.github.com/rate_limit';
const pad = (n, ch) => ch.repeat(n);

// The failure shape execFileSync raises when curl exits nonzero: status is curl's own process exit
// code, so the shipped shaper maps it to the fixed cause. Nothing here is curl's diagnostic line.
const TRANSPORT_FAILURE = {
  status: 6,
  signal: null,
  stdout: Buffer.from('\n000'),
  stderr: Buffer.from('curl: (6) Could not resolve the host\n'),
  message: 'Command failed: curl -sSL -- ' + PROBE,
};
const TRANSPORT_CAUSE = 'could not resolve the host (curl exit 6)';
const rateLimit = () => JSON.stringify({
  resources: { core: { limit: 5000, remaining: 5000, reset: 1790177128, used: 0 } },
});

// Every request fails with the shape curl raises for exit 6, shaped by the shipped shaper at the
// bound the collector passes it -- so the failure text is the run's own and not a case's copy.
function failingTransport() {
  return {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      if (url === PROBE) return rateLimit();
      throw shapeTransportError(TRANSPORT_FAILURE, url, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
}

// One rss row per target, at the settings a case names.
function rssRows(targets, domain = 'ai-llm') {
  return targets.map((target) => ({ kind: 'rss', target, domain, note: '' }));
}

function settingsAt(cap, snippet) {
  return { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet };
}

async function runAt(targets, cap, snippet) {
  return collectAll(
    { settings: settingsAt(cap, snippet), watchlist: rssRows(Array.isArray(targets) ? targets : [targets]) },
    { ...WINDOW, net: failingTransport() },
  );
}

// The values the run's own secret union holds: every request the run issues registers its own
// requestSecrets, and the union pass redacts every notice against all of them. A case that drives
// the run through configuration can rebuild the same set from the rows it passed, so the final
// pass's inputs are known without instrumenting the shipped module.
function runUnion(targets) {
  const out = new Set();
  for (const target of targets) for (const secret of requestSecrets(target, {})) out.add(secret);
  return [...out];
}

// The three shapes the two reports measured. Each is a real target the run redacts: the value is
// a credential-named query parameter's value, and the same value sits in the path the notice
// publishes, so the redaction lengthens the notice the cap was priced against.
function trigger402() {
  // 'tok12345' is 8 characters; '[redacted]' is 10, so each occurrence adds two.
  return 'https://a.example/tok12345/' + pad(220, 'x') + '?token=tok12345';
}
function triggerShippedPair() {
  // 'api' is 3 characters and the path repeats it 140 times: each removal adds seven, so the
  // source overflows its half by far more than the slack the shipped pair leaves.
  return 'https://a.example/' + 'api/'.repeat(140) + '?key=api';
}
// A credential-free target: the notice it produces is the one the current code's pricing is
// supposed to leave byte-identical.
function credentialFree() {
  return 'https://acme.feeds.example.com/' + pad(230, 'x') + '?per_page=50';
}

// ---------------------------------------------------------------------------------------
// CV-1 -- the published notice at the tight accepted pair.
// ---------------------------------------------------------------------------------------

test('CV-1 a redaction that lengthens a priced notice does not cut the transport cause at 402/200', async () => {
  const cap = 402;
  const pool = await runAt(trigger402(), cap, 200);
  assert.equal(pool.notices.length, 1,
    'the failing row produced ' + pool.notices.length + ' notices: ' + JSON.stringify(pool.notices));
  const notice = pool.notices[0];
  assert.ok(notice.length <= cap,
    'the published notice is ' + notice.length + ' characters at notice_max_chars ' + cap
    + ': ' + JSON.stringify(notice.slice(-60)));
  assert.ok(notice.includes(TRANSPORT_CAUSE),
    'at 402/200 -- the pair config/settings.md documents as the least acceptable one -- the run '
    + 'redacts a value shorter than \'[redacted]\' out of a notice priced at its cap, the slice '
    + 'removes the tail, and the transport cause goes with it. Published notice ('
    + notice.length + ' characters): ' + JSON.stringify(notice));
});

test('CV-1 the operator stderr line still names the transport reason at 402/200', async () => {
  const cap = 402;
  const pool = await runAt(trigger402(), cap, 200);
  assert.ok(pool.notices.length > 0, 'the failing row produced no notice');
  assert.match(operatorWarning(pool.notices), /could not resolve the host/,
    'the operator line lost the transport reason the run read from the notice tail: '
    + JSON.stringify(operatorWarning(pool.notices)));
});

// The same loss through the real CLI: a curl that exits 6 and no network. The shim is the only
// curl on PATH, so the transport is a real child process and the operator line is the shipped one.
test('CV-1 the shipped CLI keeps the cause in the notice and the reason on stderr at 402/200', () => {
  const cap = 402;
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-rd24-cli-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const shim = join(bin, 'curl');
    writeFileSync(shim, '#!/bin/sh\nexit 6\n');
    chmodSync(shim, 0o755);
    const cfg = join(dir, 'config');
    mkdirSync(cfg, { recursive: true });
    for (const name of ['domains.md', 'sources.md', 'settings.md']) {
      cpSync(join(CONFIG_DIR, name), join(cfg, name));
    }
    const settingsPath = join(cfg, 'settings.md');
    let text = readFileSync(settingsPath, 'utf8');
    const patchRow = (key, value) => {
      const lines = text.split('\n');
      const at = lines.findIndex((line) => line.startsWith('| ' + key + ' |'));
      assert.ok(at >= 0, 'the shipped settings carry no usable ' + key + ' row');
      const cells = lines[at].split('|');
      cells[2] = ' ' + value + ' ';
      lines[at] = cells.join('|');
      text = lines.join('\n');
    };
    patchRow('notice_max_chars', cap);
    patchRow('error_snippet_max_chars', 200);
    writeFileSync(settingsPath, text);
    writeFileSync(join(cfg, 'watchlist.md'), [
      '| kind | target | domain | note |',
      '|---|---|---|---|',
      '| rss | ' + trigger402() + ' | ai-llm | the tool in PATH answers |',
      '',
    ].join('\n'));

    const res = spawnSync(process.execPath, [
      CLI, '--config', cfg, '--out', join(dir, '.pool.json'), '--timeout', '10000', '--domain', 'ai-llm',
    ], { encoding: 'utf8', env: { ...process.env, PATH: bin, TECH_RADAR_DIR: '' } });
    assert.equal(res.error, undefined, 'the collector could not be spawned: ' + res.error);
    const pool = JSON.parse(res.stdout);
    assert.equal(pool.notices.length, 1,
      'the failing row produced ' + pool.notices.length + ' notices: ' + JSON.stringify(pool.notices));
    const notice = pool.notices[0];
    assert.ok(notice.length <= cap,
      'the published notice is ' + notice.length + ' characters at notice_max_chars ' + cap);
    assert.ok(notice.includes(TRANSPORT_CAUSE),
      'the shipped CLI lost the cause of a real exit-6 request at an accepted pair: the notice ends '
      + JSON.stringify(notice.slice(-56)));
    assert.match(res.stderr, /could not resolve the host/,
      'the operator line on stderr names no reason: ' + JSON.stringify(res.stderr));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// CV-1 -- the amplifier, at the shipped pair.
// ---------------------------------------------------------------------------------------

test('CV-1 the shipped pair 1000/200 keeps the cause of an amplified redaction inside the cap', async () => {
  const cap = SHIPPED_SETTINGS.notice_max_chars;
  const snippet = SHIPPED_SETTINGS.error_snippet_max_chars;
  const pool = await runAt(triggerShippedPair(), cap, snippet);
  assert.equal(pool.notices.length, 1,
    'the failing row produced ' + pool.notices.length + ' notices: ' + JSON.stringify(pool.notices));
  const notice = pool.notices[0];
  assert.ok(notice.length <= cap,
    'the published notice is ' + notice.length + ' characters at the shipped cap ' + cap);
  assert.ok(notice.includes(TRANSPORT_CAUSE),
    'a three-character value repeated through the target is redacted 140 times, each removal ten '
    + 'characters wide, and the whole shaped error text is sliced away at the shipped pair ('
    + cap + '/' + snippet + ') -- even the status would go with it. Published notice ('
    + notice.length + ' characters): ' + JSON.stringify(notice.slice(-80)));
});

// ---------------------------------------------------------------------------------------
// CV-1 -- the cross-row union pass.
// ---------------------------------------------------------------------------------------

test('CV-1 the final union pass over two rows on one host does not cut the first notice', async () => {
  const cap = 402;
  // The first row's notice publishes, in its source half, a value only the second row sends as a
  // credential-named query value: the first row's own request registers no secret, so only the
  // run's global union reaches it. The second row is short, so it stays inside the cap.
  const first = 'https://a.example/' + pad(19, 'y') + '/abcdefgh/' + pad(210, 'w');
  const second = 'https://a.example/' + pad(60, 'z') + '?key=abcdefgh';
  assert.deepEqual(requestSecrets(first, {}), [],
    'the fixture no longer leaves the first row outside the per-request secret set');
  const union = runUnion([first, second]);
  assert.ok(union.includes('abcdefgh'),
    'the fixture no longer puts the second row\'s value in the run\'s union: ' + JSON.stringify(union));

  const pool = await runAt([first, second], cap, 200);
  assert.equal(pool.notices.length, 2,
    'the two failing rows produced ' + pool.notices.length + ' notices: ' + JSON.stringify(pool.notices));
  const notice = pool.notices[0];
  assert.ok(notice.length <= cap,
    'the published notice is ' + notice.length + ' characters at notice_max_chars ' + cap);
  assert.ok(notice.includes(TRANSPORT_CAUSE),
    'the run\'s final union pass redacted a value from the first row\'s notice that only the second '
    + 'row\'s request carried, lengthened the notice the per-collector pass had already published at '
    + 'its cap, and the slice removed the tail -- the cause. Published notice (' + notice.length
    + ' characters): ' + JSON.stringify(notice));
  assert.match(operatorWarning(pool.notices), /could not resolve the host/,
    'the operator line lost the transport reason with the notice tail: '
    + JSON.stringify(operatorWarning(pool.notices)));
});

// ---------------------------------------------------------------------------------------
// CV-1 -- the general fixed point, and the controls that keep a fix honest.
// ---------------------------------------------------------------------------------------

test('CV-1 every notice a run publishes carries its cause whole, and redacting it again changes nothing', async () => {
  // The general invariant both reports state, measured over the shapes the run redacts: the
  // notice a run publishes is priced at the cap, carries its transport cause whole, and is a fixed
  // point of redacting it with the run's own secret union. The last half is what makes a later
  // pass safe: a pass that can still rewrite an already-published notice is a pass that can
  // lengthen it, and the run then slices the growth off the cap -- where the cause sits. The cases
  // below are the ones the two reports reproduced: one value in the source at the tight pair, a
  // value only a second row's request carried (the cross-row union), the amplified value at the
  // shipped pair, and the same shape at the tightest accepted pair.
  const cases = [
    { name: '402/200, one value in the source', cap: 402, snippet: 200, targets: [trigger402()] },
    { name: '402/200, the second row\'s value', cap: 402, snippet: 200,
      targets: ['https://a.example/' + pad(19, 'y') + '/abcdefgh/' + pad(210, 'w'),
        'https://a.example/' + pad(60, 'z') + '?key=abcdefgh'] },
    { name: 'shipped pair, an amplified value', cap: SHIPPED_SETTINGS.notice_max_chars,
      snippet: SHIPPED_SETTINGS.error_snippet_max_chars, targets: [triggerShippedPair()] },
    { name: '128/63, one value in the source', cap: 128, snippet: 63,
      targets: ['https://a.example/tok12345/' + pad(90, 'x') + '?token=tok12345'] },
  ];
  const overCap = [];
  const lost = [];
  const moved = [];
  let measured = 0;
  for (const one of cases) {
    const union = runUnion(one.targets);
    assert.ok(union.length > 0, one.name + ': the fixture redacts nothing, so it measures nothing');
    const ctx = { settings: settingsAt(one.cap, one.snippet), timeout: 10000, net: failingTransport() };
    const perSource = await collectFeeds(rssRows(one.targets), ctx);
    const pool = await runAt(one.targets, one.cap, one.snippet);
    assert.equal(pool.notices.length, perSource.notices.length,
      one.name + ': the run published ' + pool.notices.length + ' notices where the collector '
      + 'produced ' + perSource.notices.length);
    for (let i = 0; i < pool.notices.length; i += 1) {
      measured += 1;
      const notice = pool.notices[i];
      const again = redactSecrets(notice, union);
      if (notice.length > one.cap) {
        overCap.push(one.name + ' notice ' + i + ': ' + notice.length + ' characters at cap ' + one.cap);
      }
      if (!notice.includes(TRANSPORT_CAUSE)) {
        lost.push(one.name + ' notice ' + i + ': ' + JSON.stringify(notice.slice(-52)));
      }
      if (again !== notice) {
        moved.push(one.name + ' notice ' + i + ': ' + notice.length + ' -> ' + again.length
          + ' characters under the run\'s own union: ' + JSON.stringify(again.slice(-52)));
      }
    }
  }
  assert.ok(measured >= 4, 'the cases produced only ' + measured + ' notices, so nothing was measured');
  assert.deepEqual(moved, [],
    'a run published ' + moved.length + ' notice(s) that the run\'s own secret union would still '
    + 'rewrite, so a redaction pass lengthens an already-published notice, the run slices the '
    + 'growth off the cap, and the tail -- the transport cause or the HTTP status -- goes with it: '
    + moved.join(' | '));
  assert.deepEqual(overCap, [],
    'a published notice is longer than its own cap: ' + overCap.join(' | '));
  assert.deepEqual(lost, [],
    'a published notice lost the transport cause the run shaped: ' + lost.join(' | '));
});

test('CV-1 a credential-free target publishes the notice the pricing already produces, byte-identical', async () => {
  const cap = 402;
  const pool = await runAt(credentialFree(), cap, 200);
  assert.deepEqual(requestSecrets(credentialFree(), {}), [],
    'the control target is no longer credential-free, so it proves nothing');
  assert.equal(pool.notices.length, 1,
    'the control row produced ' + pool.notices.length + ' notices: ' + JSON.stringify(pool.notices));
  const notice = pool.notices[0];
  assert.ok(notice.includes(TRANSPORT_CAUSE),
    'the credential-free control lost the cause: ' + JSON.stringify(notice.slice(-56)));
  assert.match(operatorWarning(pool.notices), /could not resolve the host/,
    'the credential-free control lost the operator reason');
  // The published notice is exactly what re-redacting it with an empty union (the run issued no
  // secret at all) and re-applying the shipped normalisation produce -- no pass may rewrite it a
  // second time, so a fix cannot buy the case above by shortening or re-wrapping this notice.
  const net = await import('../scripts/lib/net.mjs');
  assert.equal(net.redactSecrets(notice, []), notice,
    'a credential-free notice was rewritten by a redaction with no secret to remove: '
    + JSON.stringify(notice.slice(-56)));
  const collect = await import('../scripts/collect.mjs');
  assert.equal(collect.neutraliseNoticeText(notice), notice,
    'a published credential-free notice was rewritten by the notice normalisation again');
});

test('CV-1 the accepted and refused boundary of the two settings is unchanged', async () => {
  const refused = async (cap, snippet) => {
    try {
      await collectAll(
        { settings: settingsAt(cap, snippet), watchlist: [] },
        { ...WINDOW, net: { fetchText: async () => { throw new Error('an acceptance probe issues no request'); } } },
      );
      return null;
    } catch (err) {
      return String(err.message);
    }
  };
  for (const [cap, snippet] of [[402, 200], [128, 63], [128, 1], [1000, 200]]) {
    assert.equal(await refused(cap, snippet), null,
      'the pair ' + cap + '/' + snippet + ' must be accepted');
  }
  for (const [cap, snippet, least] of [[401, 200, 402], [128, 64, 130]]) {
    const message = await refused(cap, snippet);
    assert.ok(message !== null, 'the pair ' + cap + '/' + snippet + ' must be refused');
    assert.match(message, /notice_max_chars/,
      'the refusal at ' + cap + '/' + snippet + ' does not name notice_max_chars: ' + JSON.stringify(message));
    assert.match(message, /error_snippet_max_chars/,
      'the refusal at ' + cap + '/' + snippet + ' does not name error_snippet_max_chars: ' + JSON.stringify(message));
    assert.match(message, new RegExp('\\b' + least + '\\b'),
      'the refusal at ' + cap + '/' + snippet + ' does not name the least cap it accepts: ' + JSON.stringify(message));
  }
});

// ---------------------------------------------------------------------------------------
// CV-4 -- an installed tree (no .git) that carries the skill's own run artifact.
// ---------------------------------------------------------------------------------------

// The offending text is the run artifact's own upstream paragraph, rebuilt here from fragments so
// this file never spells a phrase the hygiene guard forbids.
function artifactLeak() {
  return 'the ' + 'verifier' + ' then applies a candidate-dependent query word';
}

// A throwaway copy of this tree. keepGit builds a real repository at the copy (git init plus the
// shipped .gitignore), which is what makes the walker's git answer available; without it the
// walker must fall back to the rule the .gitignore states, which is the fallback CV-4 is about.
function copyOfTree(keepGit) {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-rd24-tree-'));
  cpSync(SKILL_ROOT, dir, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).includes('.git'),
  });
  cpSync(join(SKILL_ROOT, '.gitignore'), join(dir, '.gitignore'));
  if (keepGit) {
    const made = spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8', env: childEnv() });
    return { dir, git: !made.error && made.status === 0 };
  }
  return { dir, git: false };
}

function plantPoolFixture(dir) {
  mkdirSync(join(dir, 'tech-radar'), { recursive: true });
  writeFileSync(join(dir, 'tech-radar', '.pool.json'), JSON.stringify({ summary: artifactLeak() }));
}

// A child of this file inherits the runner's own context through the environment, and a node
// started with it refuses to run a file ("node:test run() is being called recursively"): it exits
// 0 without executing anything, which would make every case below pass on a tree that fails. The
// contexts are stripped here, so the guard the copy carries is the one that runs.
function childEnv() {
  const env = { ...process.env, TECH_RADAR_DIR: '' };
  for (const name of Object.keys(env)) {
    if (name.startsWith('NODE_TEST_')) delete env[name];
  }
  return env;
}

function runHygieneGuard(dir) {
  const res = spawnSync(process.execPath, ['--test', SUITE_REL], {
    cwd: dir, encoding: 'utf8', env: childEnv(),
  });
  const out = String(res.stdout ?? '') + String(res.stderr ?? '');
  const assertion = out.split('\n').find((line) => /AssertionError|shipped files naming|shipped files carrying/.test(line));
  return { status: res.status, out, assertion: (assertion ?? '').trim() };
}

test('CV-4 the shipping walk excludes a gitignored run artifact in a tree without .git', () => {
  const { dir } = copyOfTree(false);
  try {
    plantPoolFixture(dir);
    const walked = shippedFiles(dir);
    assert.equal(existsSync(join(dir, 'tech-radar', '.pool.json')), true,
      'the fixture run artifact was not written');
    assert.equal(walked.includes('tech-radar/.pool.json'), false,
      'a tree without .git still scans its own run artifact: ' + walked.filter((rel) => rel.startsWith('tech-radar/')).join(', '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CV-4 an installed tree without .git that carries the run artifact passes the hygiene guard', (t) => {
  const { dir } = copyOfTree(false);
  try {
    plantPoolFixture(dir);
    const guard = runHygieneGuard(dir);
    assert.equal(guard.status, 0,
      'the shipped hygiene guard fails in a tree without .git that carries the skill\'s own run '
      + 'artifact, so an installed skill breaks its own suite after one run (exit ' + guard.status
      + '): ' + guard.assertion);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CV-4 a tree without .git still fails the guard over an offending file in a shipping path', () => {
  const { dir } = copyOfTree(false);
  try {
    // The same offending text, in a file of a shipping path rather than the run artifact: the
    // guard must still name it, so a fix cannot buy the case above by relaxing the walk.
    writeFileSync(join(dir, 'reference', 'stray-notes.json'), artifactLeak() + '\n');
    const guard = runHygieneGuard(dir);
    assert.notEqual(guard.status, 0,
      'the hygiene guard passed a tree that ships a file naming the build process');
    assert.match(guard.out, /stray-notes\.json/,
      'the guard failed without naming the offending shipping path: ' + guard.assertion);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CV-4 the run artifact is not itself a shipped file, so it never reaches a guard', (t) => {
  const { dir, git } = copyOfTree(true);
  try {
    if (!git) { t.skip('git is not available, so the repository answer was not exercised'); return; }
    plantPoolFixture(dir);
    const walked = shippedFiles(dir);
    assert.equal(walked.includes('tech-radar/.pool.json'), false,
      'the run artifact entered the shipping set even with a repository answer available');
    const guard = runHygieneGuard(dir);
    assert.equal(guard.status, 0,
      'the hygiene guard fails over a gitignored run artifact even where git answers: ' + guard.assertion);
    writeFileSync(join(dir, 'reference', 'stray-notes.json'), artifactLeak() + '\n');
    const planted = runHygieneGuard(dir);
    assert.notEqual(planted.status, 0,
      'the guard passed after the offending text was planted in a shipping path');
    assert.match(planted.out, /stray-notes\.json/,
      'the planted leak was not named: ' + planted.assertion);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
