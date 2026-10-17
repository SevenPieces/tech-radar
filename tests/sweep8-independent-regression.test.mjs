// tests/sweep8-independent-regression.test.mjs
// Independent regression tests for TR-151, TR-152, TR-153 and TR-154: the four bound-and-listing
// degradations the final sweep recorded against e20fec1. Written as a second, independent design:
// every case drives a public seam -- the shipped CLI through main(), the collectAll seam, the
// shipped transport shaper -- rather than a private helper, and every boundary the cases depend on
// (the lowest accepted cap, the lowest accepted snippet bound) is found by bisection through the
// shipped configuration reader instead of being named, so a fix that moves a floor is still
// measured against the new one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, main } from '../scripts/collect.mjs';
import { shapeHttpError, shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { curlAvailable } from './lib/commands.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const SHIPPED_SETTINGS = readSettings(join(CONFIG_DIR, 'settings.md'));
const RUN_SETTINGS = { ...SHIPPED_SETTINGS, github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const PROBE = 'https://api.github.com/rate_limit';
const ORG = 'acme';
const REPO_SHAPE = /(^|[^A-Za-z0-9._-])(acme\/valid-repo)([^A-Za-z0-9._-]|$)/;
const SKIPPED = /skipped|could not be read|not a repository name/i;

// ---------------------------------------------------------------------------------------
// Shared seams: a temporary configuration built from the shipped one, and the shipped CLI
// driven with its console and process.exitCode captured, exactly as the reader would receive it.
// ---------------------------------------------------------------------------------------

function tempConfig(overrides, watchlistLines) {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-sweep8-'));
  const cfg = join(dir, 'config');
  mkdirSync(cfg, { recursive: true });
  for (const name of ['domains.md', 'sources.md']) copyFileSync(join(CONFIG_DIR, name), join(cfg, name));
  let settings = readFileSync(join(CONFIG_DIR, 'settings.md'), 'utf8');
  for (const [key, value] of Object.entries(overrides)) {
    const row = new RegExp('^\\| ' + key + ' \\|[^|]*\\|', 'm');
    assert.ok(row.test(settings), 'the shipped settings file carries no row for ' + key);
    settings = settings.replace(row, '| ' + key + ' | ' + value + ' |');
  }
  writeFileSync(join(cfg, 'settings.md'), settings);
  writeFileSync(join(cfg, 'watchlist.md'), watchlistLines.join('\n'));
  return { dir, cfg, out: join(dir, '.pool.json') };
}

async function runMain(config, extraArgs = []) {
  const errors = [];
  const output = [];
  const logged = console.log;
  const failed = console.error;
  const savedExit = process.exitCode;
  console.log = (...a) => output.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));
  let code;
  try {
    code = await main(['--config', config.cfg, '--out', config.out, '--timeout', '1500', ...extraArgs]);
  } finally {
    console.log = logged;
    console.error = failed;
    process.exitCode = savedExit;
  }
  return { code, errors: errors.join('\n'), output: output.join('\n') };
}

// A row the collector refuses without issuing a request, so an acceptance probe costs no network
// and no transport dependency. A row with a target the collector will skip is enough to exercise
// configuration validation alone.
const REFUSED_ROW = [
  '| kind | target | domain | note |',
  '|---|---|---|---|',
  '| rss | file:///etc/passwd | ai-llm | a scheme the collector refuses without a request |',
  '',
];
const NO_ROWS = ['| kind | target | domain | note |', '|---|---|---|---|', ''];

const rateLimit = (remaining, limit = 60) => JSON.stringify({
  resources: { core: { limit, remaining, reset: 1790177128, used: limit - remaining } },
});

// ---------------------------------------------------------------------------------------
// TR-151 -- a run whose selection contains no rows skips the selection-gated notice-cap check
// and then reaches the unconditional room check inside collectAll, whose error is classified as
// an internal failure. The same configuration is a documented configuration error (exit 2) when
// the selection has rows. Two ways to reach an empty selection are exercised: an empty
// watchlist, and a --domain that deselects every row present.
// ---------------------------------------------------------------------------------------

const BAD_CAPS = ['1', '127', '100001'];

// The runMain of a configuration whose watchlist is present and whose --domain deselects it all.
const DESELECTED_DOMAIN = 'infra-cloud';

test('TR-151 with rows the shipped CLI refuses a bad notice cap as a configuration error', async () => {
  for (const cap of BAD_CAPS) {
    const config = tempConfig({ notice_max_chars: cap }, REFUSED_ROW);
    try {
      const { code, errors } = await runMain(config);
      assert.equal(code, 2,
        'with rows, notice_max_chars = ' + cap + ' must be a configuration error (exit 2), not '
        + code + ': ' + errors);
      assert.match(errors, /notice_max_chars/,
        'with rows, the refusal of notice_max_chars = ' + cap + ' does not name the setting: ' + errors);
    } finally {
      rmSync(config.dir, { recursive: true, force: true });
    }
  }
});

test('TR-151 an empty selection still refuses a bad notice cap with the configuration exit code', async () => {
  for (const cap of BAD_CAPS) {
    const config = tempConfig({ notice_max_chars: cap }, NO_ROWS);
    try {
      const { code, errors } = await runMain(config);
      assert.equal(code, 2,
        'the selection has no rows, so notice_max_chars = ' + cap + ' must still be refused as a '
        + 'configuration error (exit 2), not exit ' + code + ': ' + errors);
      assert.match(errors, /notice_max_chars/,
        'the refusal must name the setting even with no rows selected: ' + errors);
    } finally {
      rmSync(config.dir, { recursive: true, force: true });
    }
  }
});

test('TR-151 a --domain that deselects every row still refuses a bad notice cap with exit 2', async () => {
  const cap = BAD_CAPS[0];
  const config = tempConfig({ notice_max_chars: cap }, REFUSED_ROW);
  try {
    const { code, errors } = await runMain(config, ['--domain', DESELECTED_DOMAIN]);
    assert.equal(code, 2,
      'a --domain that deselects every row leaves the same bad notice_max_chars = ' + cap
      + ' and must still exit 2, not ' + code + ': ' + errors);
    assert.match(errors, /notice_max_chars/,
      'the deselecting run does not name the setting: ' + errors);
  } finally {
    rmSync(config.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// TR-152 -- one organisation listing can carry an unbounded number of non-conforming entries,
// and each one used to become its own notice, so one upstream answer decided the volume of the
// run's published output. The entries of one listing must be summarised in a single notice that
// carries the count.
// ---------------------------------------------------------------------------------------

// A listing entry whose name is not a repository name: answer text the run refuses. The count of
// them is what the answer chooses, never the run.
const NON_CONFORMING = (n) => Array.from({ length: n }, (_, i) => 'answer entry ' + i + ' ?token=x&y=');
// The first conforming entry is the one the stub answers with a payload that yields a candidate,
// so the cases below can show the usable half of a listing survived aggregation instead of
// asserting on a pool the stub guaranteed would be empty. Every other repository keeps the shaped
// refusal, and a repository whose releases carried no candidate is answered with an empty tag
// list.
const RELEASED = ORG + '/valid-repo';
const CONFORMING = (n) => Array.from(
  { length: n },
  (_, i) => (i === 0 ? RELEASED : ORG + '/repo-' + i),
);
const RELEASES = JSON.stringify([{
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/' + RELEASED + '/releases/tag/v1.0.0',
  published_at: '2026-09-21T10:00:00Z',
  draft: false,
  body: 'notes',
}]);

function orgNet(entries) {
  const listing = JSON.stringify(entries.map((full_name) => ({ full_name })));
  return {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      if (url === PROBE) return rateLimit(55);
      if (url.includes('/orgs/' + ORG + '/repos')) return listing;
      if (url.includes('/repos/' + RELEASED + '/releases')) return RELEASES;
      if (url.includes('/tags')) return '[]';
      if (url.includes('/repos/')) {
        throw shapeHttpError(500, Buffer.from('{"message":"boom"}'), url, limit, headers ?? {}, Boolean(omitUrl));
      }
      throw new Error('unexpected request: ' + url);
    },
  };
}

function orgPool(entries, cap) {
  return collectAll(
    {
      settings: cap === undefined ? RUN_SETTINGS : { ...RUN_SETTINGS, notice_max_chars: cap },
      watchlist: [{ kind: 'github-org', target: ORG, domain: 'infra-cloud', note: '' }],
    },
    { ...WINDOW, net: orgNet(entries) },
  );
}

// The notices that report the refused listing entries. Read on a shape the run's own vocabulary
// bounds, so a fix that rewrites the sentence still reports one.
function listingNotices(pool) {
  return pool.notices.filter((n) => /listing entry/i.test(n));
}

test('TR-152 a listing whose entries are mostly non-conforming produces one aggregate notice carrying the count', async () => {
  const hostile = NON_CONFORMING(200);
  const pool = await orgPool([...CONFORMING(4), ...hostile]);

  const about = listingNotices(pool);
  assert.equal(about.length, 1,
    'the listing produced ' + about.length + ' notices for its non-conforming entries; precisely one '
    + 'aggregate notice carrying the count is required: ' + JSON.stringify(about));
  assert.ok(about[0].includes(String(hostile.length)),
    'the aggregate notice does not carry the count of ' + hostile.length + ' non-conforming entries: '
    + JSON.stringify(about[0]));
  assert.ok(SKIPPED.test(about[0]),
    'the aggregate notice does not say the entries were skipped or could not be read: ' + about[0]);
});

test('TR-152 the number of notices does not grow with the number of non-conforming entries', async () => {
  const small = NON_CONFORMING(8);
  const large = NON_CONFORMING(200);
  const smallPool = await orgPool([...CONFORMING(4), ...small]);
  const largePool = await orgPool([...CONFORMING(4), ...large]);

  assert.equal(smallPool.notices.length, largePool.notices.length,
    'a larger answer grew the published notice count (' + smallPool.notices.length + ' -> '
    + largePool.notices.length + '); one answer must not decide the volume of the run\'s output. '
    + 'small: ' + JSON.stringify(smallPool.notices));

  const smallAbout = listingNotices(smallPool);
  const largeAbout = listingNotices(largePool);
  assert.equal(smallAbout.length, 1,
    'the smaller listing produced ' + smallAbout.length + ' notices for its non-conforming entries: '
    + JSON.stringify(smallAbout));
  assert.equal(largeAbout.length, 1,
    'the larger listing produced ' + largeAbout.length + ' notices for its non-conforming entries: '
    + JSON.stringify(largeAbout));
  assert.ok(smallAbout[0].includes(String(small.length)),
    'the aggregate notice of ' + small.length + ' entries carries no count: ' + JSON.stringify(smallAbout[0]));
  assert.ok(largeAbout[0].includes(String(large.length)),
    'the aggregate notice of ' + large.length + ' entries carries no count: ' + JSON.stringify(largeAbout[0]));

  // The conforming entries are still used: aggregation must not swallow the usable half of a
  // listing. The stub answers one conforming repository with a payload that yields a candidate,
  // so this reads a pool that carries something rather than one the stub emptied.
  assert.ok(largePool.candidates.some((c) => REPO_SHAPE.test(String(c.source)) || REPO_SHAPE.test(JSON.stringify(c))),
    'the listing conforming entries stopped contributing candidates: ' + JSON.stringify(largePool.candidates.slice(0, 2)));
  assert.notEqual(largePool.candidates.length, 0, 'the listing contributed no candidate at all');
});

// ---------------------------------------------------------------------------------------
// TR-153 -- the source a notice names is cut from the right, so at a legal cap the arithmetic
// position of the offending listing entry is the first thing to go. The position is what makes
// the notice actionable, so it must survive the cut.
// ---------------------------------------------------------------------------------------

// The lowest notice cap the shipped configuration reader accepts. Acceptance is monotonic in the
// cap, so the boundary is found by bisection through the shipped CLI rather than named here.
async function capAcceptedByCli(cap) {
  const config = tempConfig({ notice_max_chars: cap }, REFUSED_ROW);
  try {
    const { code } = await runMain(config);
    return code !== 2;
  } finally {
    rmSync(config.dir, { recursive: true, force: true });
  }
}

const acceptedCapCache = new Map();
async function lowestAcceptedCap() {
  if (acceptedCapCache.has('cap')) return acceptedCapCache.get('cap');
  const high = 4096;
  assert.equal(await capAcceptedByCli(1), false,
    'a notice cap of 1 cannot carry a notice and must be refused');
  assert.equal(await capAcceptedByCli(high), true,
    'a notice cap of ' + high + ' must be accepted by the shipped reader');
  let lo = 1;
  let hi = high;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await capAcceptedByCli(mid)) hi = mid; else lo = mid;
  }
  acceptedCapCache.set('cap', hi);
  return hi;
}

test('TR-153 at a legal lowered cap a long organisation row keeps the entry\'s position in the notice', async () => {
  const cap = await lowestAcceptedCap();
  // The organisation row is configuration and may be any length; the position is arithmetic. With
  // the source cut from the right, a row this long pushes the position out of the notice.
  const longOrg = 'org-' + 'a'.repeat(500);
  const position = 1;
  const pool = await collectAll(
    {
      settings: { ...RUN_SETTINGS, notice_max_chars: cap },
      watchlist: [{ kind: 'github-org', target: longOrg, domain: 'infra-cloud', note: '' }],
    },
    {
      ...WINDOW,
      net: {
        fetchText: async (url) => {
          if (url === PROBE) return rateLimit(55);
          if (url.includes('/orgs/')) return JSON.stringify([{ full_name: 'a name that is not a repository name?' }]);
          throw new Error('unexpected request: ' + url);
        },
      },
    },
  );

  const about = listingNotices(pool);
  assert.equal(about.length, 1,
    'the long organisation row produced ' + about.length + ' listing notices: ' + JSON.stringify(about));
  assert.ok(about[0].length <= cap,
    'the cap does not bound the notice (' + about[0].length + ' chars at cap ' + cap + '): ' + about[0]);
  const shown = about[0].match(/repository\s+(\d+)/);
  assert.ok(shown,
    'at cap ' + cap + ' the notice no longer carries the entry\'s position (no "repository <n>"): '
    + JSON.stringify(about[0]));
  assert.equal(Number(shown[1]), position,
    'the notice names the wrong position at cap ' + cap + ': ' + JSON.stringify(about[0]));
});

// ---------------------------------------------------------------------------------------
// TR-154 -- the shaped transport text is bounded by error_snippet_max_chars, and below the length
// of the fixed transport cause the compact fallback is sliced, so the cause disappears. The
// lowest value the shipped configuration accepts is found by bisection, and at it the cause must
// still be present: the request text is what gives way, never the diagnosis.
// ---------------------------------------------------------------------------------------

async function boundAcceptedByCli(bound) {
  const config = tempConfig({ error_snippet_max_chars: bound }, REFUSED_ROW);
  try {
    const { code } = await runMain(config);
    return code !== 2;
  } finally {
    rmSync(config.dir, { recursive: true, force: true });
  }
}

const acceptedBoundCache = new Map();
async function lowestAcceptedSnippetBound() {
  if (acceptedBoundCache.has('bound')) return acceptedBoundCache.get('bound');
  // A value the shipped configuration plainly accepts: this bound also has to leave the notice cap
  // room for it, so the upper probe is the shipped snippet bound rather than the largest integer.
  const high = Number(SHIPPED_SETTINGS.error_snippet_max_chars);
  // The floor is measured, not named: whatever the shipped reader refuses below is found by
  // bisection between the smallest positive value and one that is plainly accepted.
  const floor = 1;
  assert.equal(await boundAcceptedByCli(high), true,
    'a snippet bound of ' + high + ' must be accepted by the shipped reader');
  let lo = floor;
  let hi = high;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await boundAcceptedByCli(mid)) hi = mid; else lo = mid;
  }
  acceptedBoundCache.set('bound', hi);
  return hi;
}

// Exactly the failure shape execFileSync raises when curl exits nonzero: status is curl's process
// exit code, stdout carries the -w status line, stderr is curl's own diagnostic.
const LONG_TARGET = 'http://127.0.0.1:4471/' + 'y'.repeat(400);
const TRANSPORT_FAILURE = {
  status: 6,
  signal: null,
  stdout: Buffer.from('\n000'),
  stderr: Buffer.from('curl: (6) Could not resolve host\n'),
  message: 'Command failed: curl -sSL -- ' + LONG_TARGET,
};
const TRANSPORT_CAUSE = 'could not resolve the host (curl exit 6)';

// The named value today's settings validation accepts, pinned so the defect is asserted on a
// fixed quantity as well as on the measured floor: a bound of 1 leaves the shaped text one
// character, and no configuration may accept that and then publish a notice with no cause.
const SMALLEST_BOUND = 1;

test('TR-154 a snippet bound the configuration accepts never removes the transport cause', async () => {
  const shaped = shapeTransportError(TRANSPORT_FAILURE, LONG_TARGET, SMALLEST_BOUND, {});
  assert.ok(shaped.message.includes(TRANSPORT_CAUSE),
    'at snippet bound ' + SMALLEST_BOUND + ' the shaped text lost the fixed transport cause: '
    + JSON.stringify(shaped.message));
});

test('TR-154 at the lowest accepted snippet bound the transport cause survives in the shaped text', async () => {
  const bound = await lowestAcceptedSnippetBound();
  const shaped = shapeTransportError(TRANSPORT_FAILURE, LONG_TARGET, bound, {});
  assert.ok(shaped.message.includes(TRANSPORT_CAUSE),
    'at the lowest accepted snippet bound (' + bound + ') the shaper cut the transport cause away: '
    + JSON.stringify(shaped.message));
  assert.equal(shaped.cause, TRANSPORT_CAUSE,
    'the shaper no longer reads the fixed cause from curl\'s exit code: ' + JSON.stringify(shaped.cause));
});

test('TR-154 at the lowest accepted snippet bound the cause reaches the run\'s notice', async () => {
  const bound = await lowestAcceptedSnippetBound();
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      throw shapeTransportError(TRANSPORT_FAILURE, url, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
  const pool = await collectAll(
    {
      settings: { ...RUN_SETTINGS, error_snippet_max_chars: bound },
      watchlist: [{ kind: 'arxiv-category', target: 'cs.AI', domain: 'ai-llm', note: '' }],
    },
    { ...WINDOW, net },
  );
  const notice = pool.notices.find((n) => /could not resolve|curl exit/.test(n));
  assert.ok(notice,
    'at the lowest accepted snippet bound (' + bound + ') no notice carries the transport cause: '
    + JSON.stringify(pool.notices));
  assert.ok(notice.includes(TRANSPORT_CAUSE),
    'at the lowest accepted snippet bound (' + bound + ') the notice lost part of the cause: '
    + JSON.stringify(notice));
});

// The published path, with no net seam: a configuration whose snippet bound is the smallest value
// the reader accepts, and a real failed request against a closed local port. The notice the
// operator is handed must still name the transport cause.
//
// This case runs curl, and the cause it asserts on is the one curl's own exit code maps to
// ('failed to connect (curl exit 7)'). On a machine with no curl there is no transport to test: the
// spawn itself fails, and the collector's notice names the missing binary honestly
// ('curl could not be started (ENOENT)'). The assertion would then fail on a statement about a
// different environment, so the case skips with its reason named - exactly as the real-transport
// case in tests/net.test.mjs and the operator-line case in tests/collect-core.test.mjs do. Where
// curl starts, the whole case runs unskipped and its expectation is unchanged.
test('TR-154 the published notice of a real failed request keeps the cause at a small accepted bound', async (t) => {
  if (!curlAvailable()) {
    t.skip('curl is not on PATH, so the real transport cannot be attempted and the notice carries the missing-binary cause');
    return;
  }
  const config = tempConfig({ error_snippet_max_chars: SMALLEST_BOUND }, [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | http://127.0.0.1:1/feed.xml | ai-llm | a closed local port, so the request fails at once |',
    '',
  ]);
  try {
    const { code, errors } = await runMain(config, ['--since', WINDOW.since]);
    if (code === 2) {
      assert.fail('snippet bound ' + SMALLEST_BOUND + ' is accepted by the shipped reader, so the '
        + 'run must not be a configuration error: ' + errors);
    }
    const pool = JSON.parse(readFileSync(config.out, 'utf8'));
    assert.ok(pool.notices.length >= 1,
      'the real transport failure produced no notice at all: ' + JSON.stringify(pool.notices));
    assert.ok(pool.notices.some((n) => /failed to connect \(curl exit 7\)/.test(n)),
      'the published notice of a real transport failure names no transport cause at snippet bound '
      + SMALLEST_BOUND + ': ' + JSON.stringify(pool.notices));
  } finally {
    rmSync(config.dir, { recursive: true, force: true });
  }
});
