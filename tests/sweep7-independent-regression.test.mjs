// tests/sweep7-independent-regression.test.mjs
// Independent regression tests for TR-141, TR-142, TR-143, TR-144 and TR-146: the
// degradations the closing sweep recorded against 6a956d1. Written as a second, independent
// design: every case drives a public seam -- collectAll, the shipped CLI, the shipped shapers
// and the renderer -- rather than a private helper, so a fix that only moves the symptom
// cannot satisfy it.
//
// TR-141 is the High one and the principle it settles governs the rest: the run must never let
// an upstream answer decide what the run's own output says. A value the answer supplied must
// never enter a redaction set, and must never be interpolated into anything published.
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
const SNIPPET_BOUND = SHIPPED_SETTINGS.error_snippet_max_chars;

const rateLimit = (remaining, limit = 60) => JSON.stringify({
  resources: { core: { limit, remaining, reset: 1790177128, used: limit - remaining } },
});

// The Coverage note the reader receives, built the way the renderer's caller builds it, so the
// published text a case scans is the text the reader is handed.
function coverageNote(pool) {
  return ['# Tech Radar - 2026-09-23', '', '## Coverage note',
    '- Collector notices: ' + pool.notices.length,
    ...pool.notices.map((n) => '- ' + n)].join('\n');
}
function renderedCoverage(pool) {
  return render(coverageNote(pool), { domains: [], short_max_chars: 18 });
}

// The reading is exercised on a planted marker first: a reading that surfaced no marker could not
// make a case mean anything.
function assertNotRendered(pool, marker, label) {
  const coverage = coverageNote(pool);
  const notice = String(pool.notices[0] ?? '(a notice)');
  const planted = coverage.replace(notice,
    '- rss https://example.invalid/feed.xml: request failed for https://example.invalid/feed.xml: ' + marker);
  assert.ok(render(planted, { domains: [], short_max_chars: 18 }).includes(marker),
    'the reading does not surface a marker a notice carries, so the case cannot mean anything');
  assert.equal(renderedCoverage(pool).includes(marker), false, label + ': ' + coverage);
}

// ---------------------------------------------------------------------------------------
// TR-141 -- the organisation-listing path put the answer's repository name into the request URL
// without encoding it and registered that request's secrets in the run-wide sets, so a name
// carrying a credential-shaped query parameter nominated the parameter's value as a string the
// run then deleted from every notice and from candidate prose. The answer therefore decided what
// the run's own output said, and for its own notice it could delete the status, the cause or the
// source. The rule: the name is validated against a repository grammar, a non-conforming entry is
// skipped with a notice naming only the organisation row and the ordinal, and no value the answer
// supplied enters any redaction set.
// ---------------------------------------------------------------------------------------

const ORG = 'acme';
const VALID_REPO = ORG + '/valid-repo';
const ANSWER_DETAIL = 'HTTP 500 for the releases request';

// A name the listing supplied that is not a repository name, whose credential-shaped query
// parameter names 'value'. No grammar that requires owner/name accepts it, whatever the spelling.
function hostileName(value) {
  return 'a?token=' + value.split(' ').join('+') + '&x=';
}

const RELEASES = JSON.stringify([{
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/' + VALID_REPO + '/releases/tag/v1.0.0',
  published_at: '2026-09-21T10:00:00Z',
  draft: false,
  body: 'release notes',
}]);

// The listing the answer returns, and the URLs the run issues. The conforming entry answers with
// a release; every request the collector builds for the answer's own name is refused with 500.
function orgListingNet(entries) {
  const requested = [];
  const listing = JSON.stringify(entries.map((full_name) => ({ full_name })));
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      requested.push(url);
      if (url === PROBE) return rateLimit(55);
      if (url.includes('/orgs/' + ORG + '/repos')) return listing;
      if (url.includes('/repos/' + VALID_REPO + '/releases')) return RELEASES;
      if (url.includes('/tags')) return '[]';
      if (url.includes('/repos/')) {
        throw shapeHttpError(500, Buffer.from('{"message":"boom"}'), url, limit, headers ?? {}, Boolean(omitUrl));
      }
      throw new Error('unexpected request: ' + url);
    },
  };
  return { net, requested };
}

function causeNamed(notice) {
  const rest = String(notice)
    .replace(/\bgithub\b/gi, ' ')
    .replace(new RegExp('\\b' + ORG + '\\b', 'g'), ' ')
    .replace(/\brepositor(?:y|ies)\b/gi, ' ')
    .replace(/HTTP/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^A-Za-z]+/g, '');
  return /[A-Za-z]{4}/.test(rest);
}

test('TR-141 an organisation listing\'s conforming name is used and the answer\'s credential-shaped text reaches no published text', async () => {
  const hostile = hostileName(ANSWER_DETAIL);
  const { net } = orgListingNet([VALID_REPO, hostile]);
  const pool = await collectAll(
    { settings: RUN_SETTINGS, watchlist: [{ kind: 'github-org', target: ORG, domain: 'infra-cloud', note: '' }] },
    { ...WINDOW, net },
  );

  // The conforming entry is used: the listing still contributes the repository it names.
  assert.ok(pool.candidates.some((c) => String(c.source).includes(VALID_REPO)),
    'the conforming entry in the listing was not used: ' + JSON.stringify(pool.notices));
  assert.ok(pool.candidates.some((c) => JSON.stringify(c).includes(VALID_REPO)),
    'the conforming repository name reaches no candidate field: ' + JSON.stringify(pool.candidates));

  // What the answer supplied is reproduced nowhere the run publishes.
  assert.equal(JSON.stringify(pool).includes(hostile), false,
    'the answer\'s credential-shaped name reached a pool field: ' + JSON.stringify(pool));
  for (const notice of pool.notices) {
    assert.equal(notice.includes(hostile), false,
      'the answer\'s credential-shaped name reached a notice: ' + notice);
  }
  // The rendered note is read on a marker it can carry (the answer's own value), and the
  // answer's name is read on the raw note and the pool: the renderer escapes the punctuation a
  // query-parameter spelling carries, so a marker holding it could never be surfaced at all.
  assert.equal(coverageNote(pool).includes(hostile), false,
    'the answer\'s credential-shaped name reached the published coverage note: ' + coverageNote(pool));
  assertNotRendered(pool, ANSWER_DETAIL, 'the answer\'s own credential value reached the rendered coverage note');
});

test('TR-141 a non-conforming repository name is skipped with a notice naming only the organisation row and the ordinal', async () => {
  const hostile = hostileName(ANSWER_DETAIL);
  const { net, requested } = orgListingNet([VALID_REPO, hostile]);
  const pool = await collectAll(
    { settings: RUN_SETTINGS, watchlist: [{ kind: 'github-org', target: ORG, domain: 'infra-cloud', note: '' }] },
    { ...WINDOW, net },
  );

  // Skipped means no request: the run never fetches a name the listing supplied that is not a
  // repository name.
  const asked = requested.filter((u) => u.includes('/repos/a?'));
  assert.deepEqual(asked, [],
    'the run issued a request for the answer\'s non-conforming name: ' + asked.join(' | '));

  const named = pool.notices.filter((n) => new RegExp('\\b' + ORG + '\\b').test(n) && /\b2\b/.test(n));
  assert.ok(named.length >= 1,
    'the skipped entry produced no notice naming the organisation row and its ordinal: '
    + JSON.stringify(pool.notices));
  for (const notice of named) {
    assert.equal(notice.includes(hostile), false,
      'the notice about the skipped entry quotes the answer\'s own name: ' + notice);
    assert.equal(notice.includes(ANSWER_DETAIL), false,
      'the notice about the skipped entry quotes the answer\'s own credential value: ' + notice);
    assert.equal(notice.includes('[redacted]'), false,
      'the answer erased text from the notice about its own entry: ' + notice);
  }
  assert.ok(named.some(causeNamed),
    'the notice about the skipped entry names no cause: ' + JSON.stringify(named));
});

// The other rows a run carries, and the run-authored phrases the answer tries to nominate.
const FEED_TARGET = 'https://example.invalid/feed.xml';
const HTTP_TARGET = 'https://example.invalid/boom.xml';
const PROSE_PHRASE = 'failed to connect';
const FEED = '<rss><channel><item><title>Post</title><link>https://example.invalid/a</link>'
  + '<pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>'
  + '<description>the run ' + PROSE_PHRASE + ' twice</description></item></channel></rss>';

function phraseNet(entries) {
  const listing = JSON.stringify(entries.map((full_name) => ({ full_name })));
  return {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      if (url === PROBE) return rateLimit(55);
      if (url.includes('/orgs/' + ORG + '/repos')) return listing;
      if (url === FEED_TARGET) return FEED;
      if (url === HTTP_TARGET) {
        throw shapeHttpError(503, Buffer.from('{"message":"upstream"}'), url, limit, headers ?? {}, Boolean(omitUrl));
      }
      if (url.includes('/tags')) return '[]';
      if (url.includes('/repos/')) {
        throw shapeHttpError(500, Buffer.from('{"message":"boom"}'), url, limit, headers ?? {}, Boolean(omitUrl));
      }
      throw new Error('unexpected request: ' + url);
    },
  };
}

const OTHER_ROWS = [
  { kind: 'rss', target: HTTP_TARGET, domain: 'ai-llm', note: '' },
  { kind: 'rss', target: 'file:///etc/passwd', domain: 'ai-llm', note: '' },
  { kind: 'github-org', target: ORG, domain: 'infra-cloud', note: '' },
];

const CROSS_NOTICE_CASES = [
  ['the status', 'HTTP 503', (n) => n.includes('boom.xml'), 'HTTP 503'],
  ['the source label', 'rss', (n) => n.includes('boom.xml'), 'rss'],
  ['a cause phrase', 'unsupported scheme', (n) => n.includes('/etc/passwd'), 'unsupported scheme'],
  ['the rest of that cause', 'only http and https are fetched', (n) => n.includes('/etc/passwd'),
    'only http and https are fetched'],
];

for (const [what, value, owns, required] of CROSS_NOTICE_CASES) {
  test('TR-141 an answer-supplied value naming ' + what + ' deletes it from no other row\'s notice', async () => {
    const pool = await collectAll(
      { settings: RUN_SETTINGS, watchlist: OTHER_ROWS },
      { ...WINDOW, net: phraseNet([hostileName(value)]) },
    );
    const mine = pool.notices.filter(owns);
    assert.equal(mine.length, 1,
      'the row that owns the phrase is reported once: ' + JSON.stringify(pool.notices));
    assert.ok(mine[0].includes(required),
      'the answer deleted ' + what + ' (' + required + ') from another row\'s notice: ' + mine[0]);
  });
}

test('TR-141 an answer-supplied value rewrites no published candidate prose', async () => {
  const pool = await collectAll(
    {
      settings: RUN_SETTINGS,
      watchlist: [
        { kind: 'rss', target: FEED_TARGET, domain: 'ai-llm', note: '' },
        { kind: 'github-org', target: ORG, domain: 'infra-cloud', note: '' },
      ],
    },
    { ...WINDOW, net: phraseNet([hostileName(PROSE_PHRASE)]) },
  );
  const summaries = pool.candidates.map((c) => String(c.summary));
  assert.ok(summaries.some((s) => s.includes(PROSE_PHRASE)),
    'the answer rewrote a published word in the pool: ' + JSON.stringify(summaries));
});

for (const [what, value] of [['the organisation row', ORG], ['the detail of its own notice', ANSWER_DETAIL]]) {
  test('TR-141 the notice about that same answer keeps its source and its cause when the answer names '
    + what, async () => {
    const hostile = hostileName(value);
    const { net } = orgListingNet([VALID_REPO, hostile]);
    const pool = await collectAll(
      { settings: RUN_SETTINGS, watchlist: [{ kind: 'github-org', target: ORG, domain: 'infra-cloud', note: '' }] },
      { ...WINDOW, net },
    );
    const about = pool.notices.filter((n) => /^github\b/.test(n));
    assert.ok(about.length >= 1,
      'no notice records the degradation of the organisation listing: ' + JSON.stringify(pool.notices));
    for (const notice of about) {
      assert.equal(notice.includes('[redacted]'), false,
        'the answer erased text from the notice about its own row: ' + notice);
      assert.equal(notice.includes(hostile), false,
        'the notice about the answer quotes the answer\'s own name: ' + notice);
    }
    const named = about.filter((n) => new RegExp('\\b' + ORG + '\\b').test(n) && /\b2\b/.test(n));
    assert.ok(named.length >= 1,
      'no notice about that answer names the organisation row and the ordinal: ' + JSON.stringify(about));
    assert.ok(causeNamed(named[0]),
      'the notice about that answer names no cause: ' + named[0]);
  });
}

// ---------------------------------------------------------------------------------------
// TR-142 -- the accepted notice cap has a floor that does not guarantee a usable notice: with the
// shipped snippet bound an assembled notice is cut inside the shaped text, so the status and the
// cause are lost at the lowest value the configuration accepts. The case finds that value through
// the shipped reader rather than naming it, so a floor the fix moves is still measured.
// ---------------------------------------------------------------------------------------

const LONG_TARGET = 'http://127.0.0.1:4471/' + 'y'.repeat(400);
const CAP_ROW = [{ kind: 'rss', target: LONG_TARGET, domain: 'languages-runtimes', note: '' }];

// A row the collector refuses without making a request, so a probe costs no network and no
// transport dependency.
const ACCEPT_PROBE = [
  '| kind | target | domain | note |',
  '|---|---|---|---|',
  '| rss | file:///etc/passwd | ai-llm | a scheme refused without a request |',
  '',
];

async function capAcceptedByCli(cap) {
  const config = tempConfig({ notice_max_chars: cap }, ACCEPT_PROBE);
  try {
    const { code } = await runMain(config, ['--since', WINDOW.since]);
    return code !== 2;
  } finally {
    rmSync(config.dir, { recursive: true, force: true });
  }
}

// The lowest cap the shipped configuration reader accepts. Acceptance is monotonic in the cap, so
// the boundary is found by bisection between a value that cannot carry a notice and one that can;
// the case reads the number from the shipped reader rather than naming it, so a floor the fix
// moves is still measured.
async function lowestAcceptedCap() {
  const high = 4096;
  assert.equal(await capAcceptedByCli(1), false,
    'a notice cap of 1 cannot carry a notice and must be refused');
  assert.equal(await capAcceptedByCli(high), true,
    'a notice cap of ' + high + ' must be accepted');
  let lo = 1;
  let hi = high;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await capAcceptedByCli(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

async function noticesAtCap(cap, net) {
  const pool = await collectAll(
    { settings: { ...RUN_SETTINGS, notice_max_chars: cap }, watchlist: CAP_ROW },
    { ...WINDOW, net },
  );
  assert.equal(pool.notices.length, 1,
    'the failed request is reported once at cap ' + cap + ': ' + JSON.stringify(pool.notices));
  return pool.notices[0];
}

// Exactly the failure shape execFileSync raises when curl exits nonzero: status is curl's process
// exit code, stdout carries the -w status line, stderr is curl's own diagnostic.
const TRANSPORT_FAILURE = {
  status: 6,
  signal: null,
  stdout: Buffer.from('\n000'),
  stderr: Buffer.from('curl: (6) Could not resolve host\n'),
  message: 'Command failed: curl -sSL -- ' + LONG_TARGET,
};

const transportNet = {
  fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
    throw shapeTransportError(TRANSPORT_FAILURE, url, limit, headers ?? {}, Boolean(omitUrl));
  },
};

const httpNet = {
  fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
    throw shapeHttpError(503, Buffer.from('{"message":"upstream"}'), url, limit, headers ?? {}, Boolean(omitUrl));
  },
};

test('TR-142 at the lowest accepted notice cap a transport failure still carries its cause', async () => {
  const shaped = shapeTransportError(TRANSPORT_FAILURE, LONG_TARGET, SNIPPET_BOUND, {});
  const cap = await lowestAcceptedCap();
  const notice = await noticesAtCap(cap, transportNet);
  assert.ok(notice.length <= cap,
    'the cap does not bound the notice (' + notice.length + ' chars at cap ' + cap + '): ' + notice);
  assert.ok(notice.startsWith('rss '), 'the notice no longer names the source: ' + notice);
  assert.ok(notice.includes(shaped.message),
    'at the lowest accepted cap (' + cap + ') the notice is cut inside the shaped failure, so the '
    + 'cause is lost: ' + notice);
  assert.ok(/could not resolve the host \(curl exit 6\)/.test(notice),
    'the cause is lost at the lowest accepted cap (' + cap + '): ' + notice);
});

test('TR-142 at the lowest accepted notice cap an HTTP failure still carries the status and the cause', async () => {
  const shaped = shapeHttpError(503, Buffer.from('{"message":"upstream"}'), LONG_TARGET, SNIPPET_BOUND, {});
  const cap = await lowestAcceptedCap();
  const notice = await noticesAtCap(cap, httpNet);
  assert.ok(notice.length <= cap,
    'the cap does not bound the notice (' + notice.length + ' chars at cap ' + cap + '): ' + notice);
  assert.ok(notice.startsWith('rss '), 'the notice no longer names the source: ' + notice);
  assert.ok(notice.includes(shaped.message),
    'at the lowest accepted cap (' + cap + ') the notice is cut inside the shaped failure, so the '
    + 'status and the request are lost: ' + notice);
  assert.ok(/HTTP 503/.test(notice),
    'the status is lost at the lowest accepted cap (' + cap + '): ' + notice);
  assert.ok(notice.includes('127.0.0.1:4471'),
    'the notice no longer names the request that failed: ' + notice);
});

// ---------------------------------------------------------------------------------------
// TR-143 -- an absurd window cap reaches Date arithmetic, and the raw RangeError it raises names
// no setting. It is a configuration error like every other mistyped quantity, so it must name
// window_cap_weeks and exit 2.
// ---------------------------------------------------------------------------------------

const DEFAULT_WATCHLIST = [
  '| kind | target | domain | note |',
  '|---|---|---|---|',
  '| rss | http://127.0.0.1:1/feed.xml | ai-llm | a closed port, so the request fails at once |',
  '',
];

function tempConfig(overrides, watchlistLines) {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-sweep7-'));
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

test('TR-143 an absurd window cap is refused with a message naming the setting', async () => {
  for (const raw of ['1e15', '1e308', '999999999']) {
    const config = tempConfig({ window_cap_weeks: raw }, DEFAULT_WATCHLIST);
    try {
      const { code, errors } = await runMain(config);
      assert.equal(code, 2,
        'window_cap_weeks = ' + raw + ' must be a configuration error (exit 2), not exit ' + code
        + ': ' + errors);
      assert.match(errors, /window_cap_weeks/,
        'the refusal of window_cap_weeks = ' + raw + ' does not name the setting: ' + errors);
    } finally {
      rmSync(config.dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------------------
// TR-144 -- the watchlist vocabulary is documented (design 3.1: github-repo, github-org,
// arxiv-category, npm, pypi, crates, gomod, ghsa, nvd, rss) and nothing enforces it: a row of any
// other kind produces no candidate and no notice, against the module's own rule that a failing
// source becomes a notice and never a silent skip.
// ---------------------------------------------------------------------------------------

test('TR-144 a watchlist kind outside the documented vocabulary produces a notice', async () => {
  for (const kind of ['rs', 'npm-registry']) {
    const pool = await collectAll(
      {
        settings: RUN_SETTINGS,
        watchlist: [{ kind, target: 'https://example.invalid/feed.xml', domain: 'ai-llm', note: 'outside the vocabulary' }],
      },
      {
        ...WINDOW,
        net: { fetchText: async (url) => { throw new Error('no request is expected for kind ' + kind + ': ' + url); } },
      },
    );
    assert.ok(pool.notices.some((n) => n.includes(kind)),
      'the watchlist kind ' + kind + ' was skipped silently: ' + JSON.stringify(pool.notices));
  }
});

test('TR-144 the unknown kind reaches the operator through the shipped CLI', async () => {
  const config = tempConfig({}, [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rs | https://example.invalid/feed.xml | ai-llm | a kind outside the vocabulary |',
    '',
  ]);
  try {
    const { code, errors } = await runMain(config, ['--since', WINDOW.since]);
    if (code === 2) {
      assert.fail('a row whose kind is outside the vocabulary must produce a notice, not a '
        + 'configuration error: ' + errors);
    }
    const pool = JSON.parse(readFileSync(config.out, 'utf8'));
    assert.ok(pool.notices.some((n) => n.includes('rs')),
      'the pool carries no notice for the unknown kind: ' + JSON.stringify(pool.notices));
    assert.match(errors, /Collector notices:\s*1/,
      'the operator is not told about the unknown kind: ' + errors);
  } finally {
    rmSync(config.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// TR-146 -- a pool write failure returns before the operator line, so a run that recorded a
// degradation publishes nothing at all: no pool, no stdout and a stderr naming only the write
// error. The degradation the run recorded must still reach the operator.
// ---------------------------------------------------------------------------------------

test('TR-146 the notices the run recorded still reach the operator when the pool cannot be written', async () => {
  const config = tempConfig({}, [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | file:///etc/passwd | ai-llm | a scheme the collector refuses without a request |',
    '',
  ]);
  try {
    // The destination cannot be created: its parent is a regular file, so the write fails whatever
    // the process may do.
    const blocker = join(config.dir, 'blocker');
    writeFileSync(blocker, 'not a directory\n');
    const unwritable = { ...config, out: join(blocker, '.pool.json') };
    const { code, errors } = await runMain(unwritable, ['--since', WINDOW.since]);
    assert.equal(code, 4,
      'a pool that cannot be written is exit 4, not ' + code + ': ' + errors);
    assert.match(errors, /cannot write/,
      'the write failure itself is no longer reported: ' + errors);
    assert.ok(/Collector notices:\s*1/.test(errors) || errors.includes('unsupported scheme'),
      'the notice the run recorded never reached the operator: ' + JSON.stringify(errors));
  } finally {
    rmSync(config.dir, { recursive: true, force: true });
  }
});
