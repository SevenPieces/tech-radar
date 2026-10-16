// tests/sweep5-regression.test.mjs
// Independent regression tests for TR-127, TR-129 and TR-131: the notice-boundary
// degradations recorded against 0f61d3d by sweep 5 and the pass that followed it. The rule
// they read is the one in force for this batch: a notice records the degradation -- the
// source, the status and the cause -- and never quotes the upstream answer's text, including
// a value the answer supplied that then becomes a request target. Every case drives a public
// seam (collectGithub, collectAll, coreBudget, the shipped configuration) rather than a
// private helper, so a fix that only moves the symptom cannot satisfy it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { collectAll, collectGithub, coreBudget } from '../scripts/collect.mjs';
import { shapeHttpError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { render } from '../scripts/render-html.mjs';

const PROBE = 'https://api.github.com/rate_limit';
const RESET = 1790177128;
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const SHIPPED_SETTINGS = readSettings(CONFIG_DIR + 'settings.md');

// The settings a run reads: the shipped rows themselves, so each case is bounded by the same
// configuration a real run is, plus the GitHub reserve the block spends against.
const RUN_SETTINGS = { ...SHIPPED_SETTINGS, github_rate_limit_reserve: 2 };

const rateLimit = (remaining, limit = 60, reset = RESET) => JSON.stringify({
  resources: { core: { limit, remaining, reset, used: limit - remaining } },
});

const githubCtx = (net, overrides = {}) => ({
  ...WINDOW, timeout: 5000, settings: { ...RUN_SETTINGS, ...overrides }, net,
});

const repoRows = (n) => Array.from({ length: n }, (_, i) => (
  { kind: 'github-repo', target: 'org/one' + i, domain: 'languages-runtimes', note: '' }
));

// An internal-error spelling is never what a notice is for: where the degradation belongs, a
// raw runtime message must not stand.
const INTERNAL_ERROR = /Invalid time value|RangeError|TypeError|Invalid Date|\bNaN\b|\bundefined\b|\[object /;

// ---------------------------------------------------------------------------------------
// TR-127 -- a repository name taken out of the organisation listing, then interpolated into
// the notice as its source and into the URL the cause quotes.
// ---------------------------------------------------------------------------------------

const ORG_ROW = 'kubernetes';
// The refused entry is the second one in the listing, so the notice names it by its position
// there: 1-based, as the listing reads to a person.
const ORDINAL_ROW = 2;
const MARKER = 'TR127-UPSTREAM-MARKER-VALUE';
const ORG_LISTING = JSON.stringify([
  { full_name: 'kubernetes/kubernetes' },
  { full_name: MARKER + '/' + MARKER },
  { full_name: 'kubernetes/k8s.io' },
]);
const K8S_RELEASES = JSON.stringify([
  { tag_name: 'v1.0.0', html_url: 'https://github.com/kubernetes/kubernetes/releases/tag/v1.0.0',
    published_at: '2026-09-21T10:00:00Z', draft: false, body: 'notes' },
]);

// The listing answers a repository whose name is the answer's own text, and the releases
// request for that entry is refused: the degradation the notice records is that entry's.
const orgNet = {
  fetchText: async (url) => {
    if (url === PROBE) return rateLimit(55);
    if (url.includes('/orgs/' + ORG_ROW + '/repos')) return ORG_LISTING;
    if (url.includes(MARKER)) throw shapeHttpError(500, Buffer.from('{"message":"boom"}'), url, 200);
    if (url.includes('kubernetes/kubernetes/releases')) return K8S_RELEASES;
    if (url.includes('/releases')) return '[]';
    if (url.includes('/tags')) return '[]';
    throw new Error('unexpected request: ' + url);
  },
};

// A position is named by a listing word near the number, in either order, so the case pins
// the requirement and not one phrasing of it.
const POSITION_BEFORE = /(?:repositor(?:y|ies)|repo|entry|ordinal|listing|item)\b[^0-9\n]{0,24}\b\d\b/i;
const POSITION_AFTER = /\b\d\b[^0-9\n]{0,24}(?:repositor(?:y|ies)|repo|entry|listing|item)\b/i;

test('TR-127 a repository name the organisation listing supplied reaches no notice, no pool field and no rendered coverage note', async () => {
  const pool = await collectAll(
    { settings: RUN_SETTINGS, watchlist: [{ kind: 'github-org', target: ORG_ROW, domain: 'infra-cloud', note: '' }] },
    { ...WINDOW, net: orgNet },
  );
  const refused = pool.notices.filter((n) => /HTTP 500/.test(n));
  assert.equal(refused.length, 1,
    'the refused releases request is reported once: ' + JSON.stringify(pool.notices));
  const notice = refused[0];

  // What the answer supplied is reproduced nowhere the notice travels.
  assert.equal(JSON.stringify(pool).includes(MARKER), false,
    'the answer-supplied repository name reached the pool: ' + JSON.stringify(pool));
  for (const n of pool.notices) {
    assert.equal(n.includes(MARKER), false,
      'the answer-supplied repository name reached a notice: ' + n);
  }
  // The listing still contributes what it can, so the pool scan above is a reading of a pool
  // that carried something rather than of an empty one.
  assert.ok(pool.candidates.length > 0,
    'the listing contributes no candidate at all: ' + JSON.stringify(pool.candidates));

  // ... and the notice still identifies the row it came from, the entry's place in the
  // listing, the status and the cause.
  assert.ok(new RegExp('\\b' + ORG_ROW + '\\b').test(notice),
    'the notice does not name the organisation row: ' + notice);
  assert.ok(POSITION_BEFORE.test(notice) || POSITION_AFTER.test(notice),
    'the notice does not name the repository\'s position in the listing: ' + notice);
  assert.ok(new RegExp('\\b' + ORDINAL_ROW + '\\b').test(notice),
    'the notice does not name the entry the listing put at position ' + ORDINAL_ROW + ': ' + notice);
  assert.ok(/HTTP 500/.test(notice), 'the notice does not carry the status: ' + notice);
  // The request URL is the remaining carrier of the discovered name (the URL serializer spells a
  // dot segment differently than the by-value removal matches), so a notice about a discovered
  // repository carries no request at all: the endpoint noun is the cause it records instead.
  assert.equal(/https:\/\/api\.github\.com/.test(notice), false,
    'the notice carries the request URL, which spells the discovered name: ' + notice);
  assert.ok(/releases/.test(notice), 'the notice does not carry the cause: ' + notice);

  // The Coverage note is Markdown and the reader renders it, so the case renders it too. The
  // reading is exercised on a planted marker first: a reading that surfaced no marker could
  // not make the case mean anything.
  const coverage = ['# Tech Radar - 2026-09-23', '', '## Coverage note',
    '- Collector notices: ' + pool.notices.length,
    ...pool.notices.map((n) => '- ' + n)].join('\n');
  const planted = coverage.replace(notice,
    '- github ' + MARKER + ': HTTP 500 for https://api.github.com/repos/' + MARKER + '/releases');
  assert.ok(render(planted, { domains: [], short_max_chars: 18 }).includes(MARKER),
    'the reading does not surface a marker a notice carries, so the case cannot mean anything');
  assert.equal(render(coverage, { domains: [], short_max_chars: 18 }).includes(MARKER), false,
    'the answer-supplied repository name reached the rendered coverage note');
});

// ---------------------------------------------------------------------------------------
// TR-129 -- a hardcoded notice length cap, in no configuration file, slices a long notice
// and removes the status and the cause with it.
// ---------------------------------------------------------------------------------------

const NOTICE_CAP_KEYS = Object.keys(SHIPPED_SETTINGS)
  .filter((k) => /notice/i.test(k) && /max_chars/i.test(k));

// The row the run reads. When the configuration carries no such row the conventional name is
// still handed to the run, so the behavioural cases below fail on the bound itself rather than
// on a missing row, and the case above is the one that fails on the row.
const NOTICE_CAP_KEY = NOTICE_CAP_KEYS.length === 1 ? NOTICE_CAP_KEYS[0] : 'notice_max_chars';

// A source long enough to swallow any notice on its own, refused with the shaped error a
// failed request produces -- so the notice reads 'npm <long source>: <status> for <url>' and
// the cap has to decide which half survives.
const LONG_TARGET = 'x'.repeat(3000);
const LONG_URL = 'https://registry.npmjs.org/' + LONG_TARGET;

async function noticeForLongSource(cap) {
  const settings = { ...RUN_SETTINGS, [NOTICE_CAP_KEY]: cap };
  const net = {
    fetchText: async () => { throw shapeHttpError(503, Buffer.from('{"message":"upstream"}'), LONG_URL, 200); },
  };
  const pool = await collectAll(
    { settings, watchlist: [{ kind: 'npm', target: LONG_TARGET, domain: 'languages-runtimes', note: '' }] },
    { ...WINDOW, net },
  );
  assert.equal(pool.notices.length, 1,
    'the refused registry request is reported once: ' + JSON.stringify(pool.notices));
  return pool.notices[0];
}

test('TR-129 the notice length cap is a configuration row, not a literal in the script', () => {
  assert.equal(NOTICE_CAP_KEYS.length, 1,
    'config/settings.md must carry the notice length cap as one *_max_chars row; found '
    + JSON.stringify(NOTICE_CAP_KEYS));
  const cap = SHIPPED_SETTINGS[NOTICE_CAP_KEYS[0]];
  assert.ok(Number.isInteger(cap) && cap > 0,
    'the notice length cap must be a positive integer setting, got ' + JSON.stringify(cap));
});

test('TR-129 a notice whose source is very long still carries the status and the cause', async () => {
  const notice = await noticeForLongSource(600);
  assert.ok(notice.length <= 600,
    'the configured cap does not bound the notice (' + notice.length + ' chars): ' + notice);
  assert.ok(/^npm\b/.test(notice), 'the notice no longer names the source: ' + notice);
  assert.ok(/HTTP 503/.test(notice),
    'the status is lost to the cap: ' + notice.slice(-120));
  assert.ok(/registry\.npmjs\.org/.test(notice),
    'the cause is lost to the cap: ' + notice.slice(-120));
});

test('TR-129 a lowered notice cap is honoured', async () => {
  const notice = await noticeForLongSource(300);
  assert.ok(notice.length <= 300,
    'a lowered configured cap does not bound the notice (' + notice.length + ' chars): ' + notice);
  assert.ok(/HTTP 503/.test(notice),
    'the status is lost to the lowered cap: ' + notice.slice(-120));
  assert.ok(/registry\.npmjs\.org/.test(notice),
    'the cause is lost to the lowered cap: ' + notice.slice(-120));
});

// ---------------------------------------------------------------------------------------
// TR-131 -- an out-of-range reset in the rate-limit answer makes the time conversion throw,
// so the probe degrades to a notice naming an internal error.
// ---------------------------------------------------------------------------------------

test('TR-131 an out-of-range rate-limit reset is read as absent', () => {
  for (const reset of [1e15, 1e20, Number.MAX_VALUE]) {
    const budget = coreBudget({ resources: { core: { limit: 60, remaining: 55, reset } } });
    assert.deepEqual(budget, { remaining: 55, limit: 60, resetAt: null },
      'reset ' + reset + ' is not read as absent: ' + JSON.stringify(budget));
  }
  // A reset the clock can represent keeps its reading.
  assert.equal(
    coreBudget({ resources: { core: { limit: 60, remaining: 55, reset: RESET } } }).resetAt,
    new Date(RESET * 1000).toISOString(),
  );
});

test('TR-131 the probe with an unreadable reset still reports the allowance and names no internal error', async () => {
  const net = { fetchText: async (url) => (url === PROBE ? rateLimit(3, 60, 1e20) : '[]') };
  const { candidates, notices } = await collectGithub(
    repoRows(5), githubCtx(net, { github_rate_limit_reserve: 0 }),
  );
  assert.deepEqual(candidates, []);
  assert.ok(notices.length > 0, 'the degraded probe is reported, never swallowed');
  for (const n of notices) {
    assert.equal(INTERNAL_ERROR.test(n), false,
      'a notice names an internal error instead of the degradation: ' + n);
  }
  const budget = notices.find((n) => n.startsWith('github: rate limit reached '));
  assert.ok(budget, 'the allowance the probe read is still reported: ' + JSON.stringify(notices));
  assert.ok(/remaining \d+ of 60/.test(budget), 'the allowance is not named: ' + budget);
  assert.ok(!/resets/.test(budget),
    'a reset time the answer cannot give is claimed anyway: ' + budget);
});
