// tests/sweep6-regression.test.mjs
// Independent regression tests for TR-134, TR-135 and TR-136: the three degradations the
// closing sweep recorded against 3e98b14, after the operator put the notice rule in force --
// a notice records the degradation (the source, the status and the cause) and never quotes
// the upstream answer's text, nor environment-supplied text. Every case drives a public seam
// (collectAll, shapeTransportError, the shipped CLI) rather than a private helper, so a fix
// that only moves the symptom cannot satisfy it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, main } from '../scripts/collect.mjs';
import { shapeHttpError, shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { render } from '../scripts/render-html.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const SHIPPED_SETTINGS = readSettings(join(CONFIG_DIR, 'settings.md'));
const RUN_SETTINGS = { ...SHIPPED_SETTINGS, github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const PROBE = 'https://api.github.com/rate_limit';

const rateLimit = (remaining, limit = 60, reset = 1790177128) => JSON.stringify({
  resources: { core: { limit, remaining, reset, used: limit - remaining } },
});

// The Coverage note is Markdown and the reader renders it, so every case renders it too. The
// reading is exercised on a planted marker first: a reading that surfaced no marker could not
// make a case mean anything.
function coverageNote(pool) {
  return ['# Tech Radar - 2026-09-23', '', '## Coverage note',
    '- Collector notices: ' + pool.notices.length,
    ...pool.notices.map((n) => '- ' + n)].join('\n');
}

function assertMarkerNotRendered(pool, marker, label) {
  const coverage = coverageNote(pool);
  const notice = String(pool.notices[0] ?? '');
  const planted = coverage.replace(notice,
    '- rss https://example.invalid/feed.xml: request failed for https://example.invalid/feed.xml: ' + marker);
  assert.ok(render(planted, { domains: [], short_max_chars: 18 }).includes(marker),
    'the reading does not surface a marker a notice carries, so the case cannot mean anything');
  assert.equal(render(coverage, { domains: [], short_max_chars: 18 }).includes(marker), false,
    label + ': ' + coverage);
}

// ---------------------------------------------------------------------------------------
// TR-134 -- the transport notice quotes curl's own stderr line, and curl follows redirects
// (and honours the environment's proxy), so a hostname the answer chose for a redirect - or a
// proxy name from the environment - is published in the notice, the pool and the coverage
// note. Neither value is the request's own, so no by-value redaction can cover it; the cause
// has to be shaped from curl's exit code through a fixed vocabulary instead of quoted.
// ---------------------------------------------------------------------------------------

// The request's own target: the notice must still name it. Neither exit digit below (5, 6)
// occurs in this spelling, so the status assertions read the status and not the URL.
const OWN_TARGET = 'http://127.0.0.1:4471/redirect';
const REDIRECT_HOST = 'tr134-redirect-target.invalid';
const PROXY_HOST = 'tr134-bogus-proxy.invalid';

// Exactly the failure shape execFileSync raises when curl exits nonzero: status is curl's
// process exit code, stdout carries the -w status line, and stderr is curl's own diagnostic.
function transportFailure(exit, line) {
  return {
    status: exit,
    signal: null,
    stdout: Buffer.from('\n000'),
    stderr: Buffer.from(line + '\n'),
    message: 'Command failed: curl -sSL -- ' + OWN_TARGET + '\n' + line,
  };
}

// The transport the collector really uses: on a nonzero curl exit, curlBuffer hands the
// failure to shapeTransportError and throws what it shaped. Only the child process is stubbed;
// the shaper, the notice boundary, the pool and the renderer are the shipped ones.
function failingTransport(failure) {
  return {
    fetchText: async (url, timeout, headers, ua, snippetLimit) => {
      throw shapeTransportError(failure, url, snippetLimit, headers ?? {});
    },
  };
}

async function transportPool(exit, line) {
  const pool = await collectAll(
    {
      settings: RUN_SETTINGS,
      watchlist: [{ kind: 'rss', target: OWN_TARGET, domain: 'languages-runtimes', note: '' }],
    },
    { ...WINDOW, net: failingTransport(transportFailure(exit, line)) },
  );
  assert.equal(pool.notices.length, 1,
    'the failed request is reported once: ' + JSON.stringify(pool.notices));
  return pool;
}

test('TR-134 a redirect target the answer chose reaches no notice, no pool field and no rendered note', async () => {
  const pool = await transportPool(6, 'curl: (6) Could not resolve host: ' + REDIRECT_HOST);
  const notice = pool.notices[0];

  assert.equal(JSON.stringify(pool).includes(REDIRECT_HOST), false,
    'the answer-chosen redirect target reached the pool: ' + JSON.stringify(pool.notices));
  for (const n of pool.notices) {
    assert.equal(n.includes(REDIRECT_HOST), false,
      'the answer-chosen redirect target reached a notice: ' + n);
  }
  assertMarkerNotRendered(pool, REDIRECT_HOST,
    'the answer-chosen redirect target reached the rendered coverage note');

  // ... and the notice still records the degradation: the request's own target, the failure
  // kind and curl's exit status.
  assert.ok(/127\.0\.0\.1:4471/.test(notice),
    "the notice no longer names the request's own target: " + notice);
  assert.ok(/(?:request failed|transport|curl)/i.test(notice),
    'the notice no longer names the failure kind: ' + notice);
  assert.ok(/(?:^|\D)6(?:\D|$)/.test(notice),
    "curl's exit status is not named in the notice: " + notice);
});

test('TR-134 a proxy name from the environment reaches no notice, no pool field and no rendered note', async () => {
  const pool = await transportPool(5, 'curl: (5) Could not resolve proxy: ' + PROXY_HOST);
  const notice = pool.notices[0];

  assert.equal(JSON.stringify(pool).includes(PROXY_HOST), false,
    'the environment-supplied proxy name reached the pool: ' + JSON.stringify(pool.notices));
  for (const n of pool.notices) {
    assert.equal(n.includes(PROXY_HOST), false,
      'the environment-supplied proxy name reached a notice: ' + n);
  }
  assertMarkerNotRendered(pool, PROXY_HOST,
    'the environment-supplied proxy name reached the rendered coverage note');

  assert.ok(/127\.0\.0\.1:4471/.test(notice),
    "the notice no longer names the request's own target: " + notice);
  assert.ok(/(?:request failed|transport|curl)/i.test(notice),
    'the notice no longer names the failure kind: ' + notice);
  assert.ok(/(?:^|\D)5(?:\D|$)/.test(notice),
    "curl's exit status is not named in the notice: " + notice);
});

// ---------------------------------------------------------------------------------------
// TR-135 -- the organisation-listing path leaked a discovered repository name when the name
// was transformed by the URL parser (a dot segment), spelled percent-encoded, or long enough
// that a bound truncated it before the by-value redaction ran. TR-141 closes that path at its
// source: a name that is not a repository name is never used for anything, so it is never a
// request at all. These cases keep the original requirement -- the name reaches neither the
// notice, nor a pool field, nor the rendered note -- and add the stronger one: the entry is
// skipped with a notice naming the organisation row and its position.
// ---------------------------------------------------------------------------------------

const ORG_ROW = 'kubernetes';
const ORDINAL = 2;
const DOT_MARKER = 'tr135-dot-segment-value';
const ENC_MARKER = 'tr135-percent-encoded-value';
const LONG_MARKER = 'tr135-overlong-value';

// A name longer than any bound in the configuration: the marker sits at its head, where the
// URL parser and the shaper have to carry it, and the tail is longer than the notice cap.
const OVERLONG = LONG_MARKER + '/' + 'y'.repeat(1200);

const HOSTILE_NAMES = [
  ['a dot segment', 'aaa/../../etc/' + DOT_MARKER, DOT_MARKER],
  ['a percent-encoded dot segment', 'aaa/%2e%2e/' + ENC_MARKER, ENC_MARKER],
  ['a name longer than any bound', OVERLONG, LONG_MARKER],
];

const BENIGN_RELEASES = JSON.stringify([{
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/kubernetes/kubernetes/releases/tag/v1.0.0',
  published_at: '2026-09-21T10:00:00Z',
  draft: false,
  body: 'notes',
}]);

async function orgListingPool(fullName) {
  const listing = JSON.stringify([{ full_name: 'kubernetes/kubernetes' }, { full_name: fullName }]);
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit(55);
      if (url.includes('/orgs/' + ORG_ROW + '/repos')) return listing;
      if (url.includes('/tags')) return '[]';
      if (url.includes('kubernetes/kubernetes/releases')) return BENIGN_RELEASES;
      if (url.includes('/releases')) throw shapeHttpError(500, Buffer.from('{"message":"boom"}'), url, 200);
      throw new Error('unexpected request: ' + url);
    },
  };
  const pool = await collectAll(
    {
      settings: RUN_SETTINGS,
      watchlist: [{ kind: 'github-org', target: ORG_ROW, domain: 'infra-cloud', note: '' }],
    },
    { ...WINDOW, net },
  );
  return { pool, calls };
}

// A position is named by a listing word near the number, in either order, so the case pins the
// requirement and not one phrasing of it.
const POSITION_BEFORE = /(?:repositor(?:y|ies)|repo|entry|ordinal|listing|item)\b[^0-9\n]{0,24}\b\d\b/i;
const POSITION_AFTER = /\b\d\b[^0-9\n]{0,24}(?:repositor(?:y|ies)|repo|entry|listing|item)\b/i;

for (const [what, fullName, marker] of HOSTILE_NAMES) {
  test('TR-135 an organisation-listing repository name with ' + what
    + ' is skipped before it becomes a request and reaches no notice, pool field or rendered note',
  async () => {
    const { pool, calls } = await orgListingPool(fullName);

    // The listing still contributes what it can, so the pool scan is a reading of a pool that
    // carried something rather than of an empty one.
    assert.ok(pool.candidates.length > 0,
      'the listing contributes no candidate at all: ' + JSON.stringify(pool.notices));

    // What the answer supplied is reproduced nowhere the notice travels.
    assert.equal(JSON.stringify(pool).includes(marker), false,
      'the discovered repository name reached a pool field: ' + JSON.stringify(pool));
    for (const n of pool.notices) {
      assert.equal(n.includes(marker), false,
        'the discovered repository name reached a notice: ' + n);
    }
    assertMarkerNotRendered(pool, marker,
      'the discovered repository name reached the rendered coverage note');

    // The name is refused before it is used for anything (TR-141): no request carries it, so
    // the URL serializer's spelling of it is never a target and never a redaction value.
    assert.equal(calls.some((u) => u.includes(marker)), false,
      'a request was made from a name that is not a repository name: ' + calls.join('; '));

    // ... and the skip is still reported: the organisation row and the entry's position in the
    // listing are named, and nothing the answer supplied is.
    const skipped = pool.notices.filter((n) => /skip/i.test(n));
    assert.equal(skipped.length, 1,
      'the non-conforming entry is not reported exactly once: ' + JSON.stringify(pool.notices));
    const notice = skipped[0];
    assert.ok(new RegExp('\\b' + ORG_ROW + '\\b').test(notice),
      'the notice does not name the organisation row: ' + notice);
    assert.ok(POSITION_BEFORE.test(notice) || POSITION_AFTER.test(notice),
      "the notice does not name the repository's position in the listing: " + notice);
    assert.ok(new RegExp('\\b' + ORDINAL + '\\b').test(notice),
      'the notice does not name the entry the listing put at position ' + ORDINAL + ': ' + notice);
  });
}

// ---------------------------------------------------------------------------------------
// TR-136 -- the notice cap has no usable range: a value of 1 yields a notice with no status,
// and a very large value is accepted and disables the cap, where both are configuration
// errors that name the setting. A valid value still bounds a notice, and the transport-shaped
// text is bounded by the bound it claims (S6-4).
// ---------------------------------------------------------------------------------------

const CAP_ROW = '| notice_max_chars |';

function configWithCap(raw) {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-notice-cap-'));
  const cfg = join(dir, 'config');
  mkdirSync(cfg, { recursive: true });
  for (const name of ['domains.md', 'settings.md', 'sources.md']) {
    copyFileSync(join(CONFIG_DIR, name), join(cfg, name));
  }
  const settings = readFileSync(join(CONFIG_DIR, 'settings.md'), 'utf8')
    .split('\n')
    .map((line) => (line.startsWith(CAP_ROW)
      ? '| notice_max_chars | ' + raw + ' | a notice cap under test |'
      : line))
    .join('\n');
  writeFileSync(join(cfg, 'settings.md'), settings);
  writeFileSync(join(cfg, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | file:///etc/passwd | ai-llm | a scheme the collector refuses without a request |',
    '',
  ].join('\n'));
  return { dir, cfg, out: join(dir, '.pool.json') };
}

async function runWithCap(raw) {
  const { dir, cfg, out } = configWithCap(raw);
  const errors = [];
  const logged = console.log;
  const failed = console.error;
  const savedExit = process.exitCode;
  console.log = () => {};
  console.error = (...a) => errors.push(a.join(' '));
  let code;
  try {
    code = await main(['--config', cfg, '--out', out, '--timeout', '2000',
      '--since', '2026-09-16T00:00:00Z']);
  } finally {
    console.log = logged;
    console.error = failed;
    process.exitCode = savedExit;
    rmSync(dir, { recursive: true, force: true });
  }
  return { code, errors: errors.join('\n') };
}

test('TR-136 a notice cap too small to carry a status and the cause is a named configuration error', async () => {
  for (const cap of [1, 8, 14]) {
    const { code, errors } = await runWithCap(cap);
    assert.equal(code, 2,
      'a cap of ' + cap + ' must be a configuration error (exit 2), not a degraded run (exit '
      + code + '): ' + errors);
    assert.match(errors, /notice_max_chars/,
      'the refusal does not name the setting: ' + errors);
  }
});

test('TR-136 an absurdly large notice cap is a named configuration error', async () => {
  for (const cap of ['1e21', '999999999999999999999']) {
    const { code, errors } = await runWithCap(cap);
    assert.equal(code, 2,
      'a cap of ' + cap + ' must be a configuration error (exit 2), not a degraded run (exit '
      + code + '): ' + errors);
    assert.match(errors, /notice_max_chars/,
      'the refusal does not name the setting: ' + errors);
  }
});

// A source long enough to swallow any notice on its own, refused with the shaped error a
// failed request produces, so the assembled notice has to be cut and the cap decides where.
const LONG_TARGET = 'x'.repeat(3000);
const LONG_URL = 'https://registry.npmjs.org/' + LONG_TARGET;

test('TR-136 a valid notice cap still bounds a notice exactly', async () => {
  // The lowest cap that carries the whole shaped error text under the shipped snippet bound:
  // below it the cap is a configuration error rather than a notice that lost its cause (TR-142).
  const cap = 403;
  const settings = { ...RUN_SETTINGS, notice_max_chars: cap };
  const net = {
    fetchText: async () => {
      throw shapeHttpError(503, Buffer.from('{"message":"upstream"}'), LONG_URL, 200);
    },
  };
  const pool = await collectAll(
    {
      settings,
      watchlist: [{ kind: 'npm', target: LONG_TARGET, domain: 'languages-runtimes', note: '' }],
    },
    { ...WINDOW, net },
  );
  assert.equal(pool.notices.length, 1,
    'the refused registry request is reported once: ' + JSON.stringify(pool.notices));
  const notice = pool.notices[0];
  assert.ok(notice.length <= cap,
    'the configured cap does not bound the notice (' + notice.length + ' chars): ' + notice);
  assert.equal(notice.length, cap,
    'a notice the cap has to cut is not bounded exactly at ' + cap + ' chars ('
    + notice.length + '): ' + notice);
  assert.ok(/^npm\b/.test(notice), 'the notice no longer names the source: ' + notice);
  assert.ok(/HTTP 503/.test(notice),
    'the status is lost to the cap: ' + notice.slice(-120));
  assert.ok(/registry\.npmjs\.org/.test(notice),
    'the cause is lost to the cap: ' + notice.slice(-120));
});

// S6-4: the transport half of the bound is not a bound at all - the shaped text is
// 'request failed for ' + the redacted URL + ': ' + curl's capped line, so with curl's line at
// the cap the shaped text is longer than the cap it claims.
test('TR-136 a valid error-snippet value bounds the shaped transport text exactly', () => {
  const limit = 200;
  const long = shapeTransportError(
    transportFailure(7, 'curl: (7) Failed to connect to ' + 'x'.repeat(400)), OWN_TARGET, limit, {});
  assert.ok(long.message.length <= limit,
    'the shaped transport text is not bounded by the ' + limit + '-character value it claims ('
    + long.message.length + ' chars): ' + long.message.slice(0, 80) + '...');
  assert.ok(/(?:^|\D)7(?:\D|$)/.test(long.message),
    "curl's exit status is lost to the bound: " + long.message);
});
