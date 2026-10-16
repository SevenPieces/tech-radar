// tests/sweep11-independent-regression.test.mjs
// Independent regression tests for TR-165, TR-166 and TR-167: the three collector degradations
// the sweep over 3285be4 recorded. Every case drives a public seam -- collectAll, the shipped
// transport shaper, the notice normaliser the push applies, or the shipped CLI through a real
// child process -- and every boundary a case depends on (the lowest accepted notice cap, and the
// largest snippet bound that cap accepts) is found by bisection through the shipped code rather
// than named, so a fix that moves a floor is still measured against the new one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, neutraliseNoticeText } from '../scripts/collect.mjs';
import { neutraliseUrl, shapeHttpError, shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const SHIPPED_SETTINGS = readSettings(join(CONFIG_DIR, 'settings.md'));
const RUN_SETTINGS = { ...SHIPPED_SETTINGS, github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const PROBE = 'https://api.github.com/rate_limit';
const FEED = 'https://a.example/feed.xml';

// The failure shape execFileSync raises when curl exits nonzero: status is curl's own process exit
// code, so the shaper reads it and maps it to the fixed cause. Nothing here is curl's diagnostic
// line, which the shaper never quotes.
const TRANSPORT_FAILURE = {
  status: 6,
  signal: null,
  stdout: Buffer.from('\n000'),
  stderr: Buffer.from('curl: (6) Could not resolve the host\n'),
  message: 'Command failed: curl -sSL -- ' + FEED,
};
const TRANSPORT_CAUSE = 'could not resolve the host (curl exit 6)';
const rateLimit = () => JSON.stringify({
  resources: { core: { limit: 5000, remaining: 5000, reset: 1790177128, used: 0 } },
});

// A transport whose every request fails with the shape curl raises for exit 6, shaped by the
// shipped shaper at the bound the collector passes it -- so the failure text is the run's own.
function failingTransport() {
  return {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      if (url === PROBE) return rateLimit();
      throw shapeTransportError(TRANSPORT_FAILURE, url, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
}

// The largest snippet bound a given notice cap accepts, found by bisection through the shipped
// collectAll seam: an empty selection exercises configuration validation alone, so probing costs
// no request and no network.
async function pairAccepted(cap, snippet) {
  try {
    await collectAll(
      { settings: { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet }, watchlist: [] },
      { ...WINDOW, net: { fetchText: async () => { throw new Error('an acceptance probe issues no request'); } } },
    );
    return true;
  } catch {
    return false;
  }
}

async function largestAcceptedSnippet(cap) {
  if (!(await pairAccepted(cap, 1))) return 0;
  let lo = 1;
  let hi = Math.max(1, cap);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (await pairAccepted(cap, mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

let lowestPairCache;
async function lowestAcceptedPair() {
  if (lowestPairCache) return lowestPairCache;
  for (let cap = 128; cap <= 4096; cap += 1) {
    const snippet = await largestAcceptedSnippet(cap);
    if (snippet > 0) { lowestPairCache = { cap, snippet }; return lowestPairCache; }
  }
  throw new Error('no (notice_max_chars, error_snippet_max_chars) pair was accepted');
}

// The run's own notice of the failed request, found by what any wording of it carries: the
// shaped transport text is the only notice one failing row produces.
async function transportNotice(row, settings) {
  const pool = await collectAll({ settings, watchlist: [row] }, { ...WINDOW, net: failingTransport() });
  const notice = pool.notices.find((n) => /request failed/.test(n));
  assert.ok(notice, 'the failed request produced no transport notice: ' + JSON.stringify(pool.notices));
  return notice;
}

// ---------------------------------------------------------------------------------------
// TR-165 -- the push normalises the assembled notice a second time, and the shaped error text's
// own link seams grow on that pass. The room the pre-request check reserved is then not the room
// that survives: at an accepted pair the notice is cut at the cap and the cause -- the last thing
// in the shaped text -- is sliced away, while the operator warning that repeats the cause loses
// its tail with it. The fix is a normalisation that is a fixed point, and a shaped text that
// crosses it before its length is priced. The cases below pin both halves: a hand-built input
// proves the second application changes nothing, a fuzz over the same vocabulary proves it in
// general, a seam-heavy request proves the shaped text is priced where it survives, and the
// operator warning proves the reason is not lost with it.
// ---------------------------------------------------------------------------------------

// Every fragment the normalisation vocabulary reads, so the fuzz reaches the interactions
// between its rules: a marker and the bracket that follows it, a tag span beside a bracket, an
// entity spelling of the tag opener, and the control bytes the tag rules read past -- the
// shipped rule that spells a whitespace control as a space is exercised too. A marker's own
// closer sits immediately before the two-character seam in the corpus, which is the order the
// marker rule runs in and the one that can build a seam the following rule then reaches.
const HOSTILE_FRAGMENTS = [
  '](', '] (', '(x', 'x]', '[' , ']', '(', ')', '[src:Example Wire](https://e.example/p)',
  '[prov:primary]', '[alt:text]', '[src', ':', '] (', '#new', '#followup', '#watch',
  '**bold**', '*', '#', '&lt;a href=x&gt;', '&lt;script', '<a href=x>', '</a>', '<img src=x>',
  '<id>', '<!DOCTYPE html>', '&amp;', 'a < b', ' ', '\t', '\n', String.fromCharCode(0),
  String.fromCharCode(1), String.fromCharCode(0x7f), String.fromCharCode(0x9f), String.fromCharCode(0x80),
];

function seeded(seed) {
  let state = seed >>> 0;
  return (bound) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % bound;
  };
}

// Normalising an already-normalised text must return it byte-identical: that is what makes the
// push's own pass a no-op on whatever the notice was assembled from, so the room a source or a
// shaped text was measured against is the room it survives with.
function assertFixedPoint(text, label) {
  const once = neutraliseNoticeText(text);
  const twice = neutraliseNoticeText(once);
  assert.equal(twice, once,
    label + ': the normalisation changed its own output, so it is not a fixed point: input='
    + JSON.stringify(text) + ' once=' + JSON.stringify(once) + ' twice=' + JSON.stringify(twice));
  return once;
}

test('TR-165 the notice normalisation is a fixed point on the shapes its own rules build', () => {
  // The shapes one rule can hand the next: a marker's closer immediately before a seam's '('
  // (the marker rule runs first, so it is that rule's own output the seam rule then reads), a
  // marker beside another marker, a tag span beside a bracket, the entity spelling of the tag
  // opener, and a status token whose '#' follows a bracket. Every one of them can arrive from
  // an upstream answer, and every one has to come back byte-identical from a second
  // application of the whole rewriting.
  const inputs = ['[src:x](y)', '[prov:a][alt:b]', '<a href=x>](', '](x[src:y]', '&lt;a>&](',
    '**](x**', '#new](', '](x](x'];
  for (const input of inputs) assertFixedPoint(input, 'hand-built input');
});

test('TR-165 the notice normalisation does not change a random hostile text on a second pass', () => {
  const next = seeded(0x51ee7);
  let rewroteSomething = 0;
  for (let i = 0; i < 6000; i += 1) {
    const parts = 1 + next(7);
    let text = '';
    for (let j = 0; j < parts; j += 1) text += HOSTILE_FRAGMENTS[next(HOSTILE_FRAGMENTS.length)];
    const once = assertFixedPoint(text, 'fuzz case ' + i + ' (' + JSON.stringify(text) + ')');
    if (once !== text) rewroteSomething += 1;
  }
  // A corpus the normaliser never rewrites would prove nothing about its fixed point.
  assert.ok(rewroteSomething > 500,
    'the fuzz corpus is too weak: only ' + rewroteSomething + ' of 6000 texts were rewritten at all');
});

test('TR-165 an accepted pair keeps the shaped transport text whole for a seam-heavy request', async () => {
  const { cap, snippet } = await lowestAcceptedPair();
  const settings = { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet };

  const lost = [];
  for (const seams of [1, 8, 20, 40, 60]) {
    for (const [label, row] of [
      ['rss', { kind: 'rss', target: 'https://a.example/' + '](x'.repeat(seams) }],
      ['github-org', { kind: 'github-org', target: 'acme' + '](x'.repeat(seams) }],
      ['npm', { kind: 'npm', target: 'pkg' + '](x'.repeat(seams) }],
    ]) {
      const notice = await transportNotice(row, settings);
      assert.ok(notice.length <= cap,
        'the ' + label + ' notice is ' + notice.length + ' characters at notice_max_chars ' + cap);
      if (!notice.includes(TRANSPORT_CAUSE)) {
        lost.push(label + ' x' + seams + ': ' + JSON.stringify(notice));
      }
    }
  }
  assert.deepEqual(lost, [],
    'at the lowest accepted pair (' + cap + '/' + snippet + ') the assembled notice cut the shaped '
    + 'error text for these seam counts, and the cause went with it: ' + lost.join(' | '));
});

// The lowest pair the fuzz above reaches through a seam count is not the lowest pair at which the
// shaped text can be pushed past the cap: the shaped half has to be long enough to carry the
// growth the push applies, which a request the snippet bound cuts short cannot be. This case
// measures every accepted cap from the floor to the shipped one at the largest snippet bound it
// accepts, which is the pair the room is tightest for, and pins the seam count that used to lose
// the cause there.
test('TR-165 a seam-heavy request at every accepted cap keeps the cause in the notice', async () => {
  const lost = [];
  for (const cap of [164, 200, 300, 402, 500, SHIPPED_SETTINGS.notice_max_chars]) {
    const snippet = await largestAcceptedSnippet(cap);
    if (snippet === 0) continue;
    const settings = { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet };
    for (const seams of [12, 20, 40]) {
      const notice = await transportNotice({ kind: 'rss', target: 'https://a.example/' + '](x'.repeat(seams) }, settings);
      assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at cap ' + cap);
      if (!notice.includes(TRANSPORT_CAUSE)) lost.push('cap ' + cap + '/' + snippet + ' x' + seams + ': ' + JSON.stringify(notice));
    }
  }
  assert.deepEqual(lost, [],
    'these accepted pairs cut the cause out of the assembled notice: ' + lost.join(' | '));
});

// The operator line repeats the run's transport cause, and it reads the notice's tail to find it.
// A notice whose tail the cap cut published the count with no reason at all, which is the same
// loss seen one layer up.
test('TR-165 the operator line still names the transport cause at the lowest accepted pair', async () => {
  const { cap, snippet } = await lowestAcceptedPair();
  const pool = await collectAll(
    { settings: { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet },
      watchlist: [{ kind: 'rss', target: 'https://a.example/' + '](x'.repeat(20), domain: 'ai-llm' }] },
    { ...WINDOW, net: failingTransport() },
  );
  assert.ok(pool.notices.length > 0, 'the failing row produced no notice');
  const { operatorWarning } = await import('../scripts/collect.mjs');
  const line = operatorWarning(pool.notices);
  assert.match(line, /could not resolve the host/,
    'the operator line lost the transport reason the notice carries: ' + JSON.stringify(line));
});

// ---------------------------------------------------------------------------------------
// TR-166 -- the truncation report is unreachable with a conformant answer: the request asks for
// exactly the configured number of entries and reads one page, so the retained slice can never be
// smaller than what the answer returned. The real silent loss is the opposite one -- a listing
// that fills the page holds more than the page carried, and the run neither asks for the next
// page nor says so. The cases below pin the reachable loss, the silence when nothing can have
// been lost, and that the report quotes no upstream text.
// ---------------------------------------------------------------------------------------

function listingTransport(entries) {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit();
      if (url.includes('/orgs/acme/repos')) {
        return JSON.stringify(Array.from({ length: entries }, (_, i) => ({
          full_name: 'acme/repo-' + i,
          updated_at: new Date(Date.UTC(2026, 8, 20, 0, 0, entries - i)).toISOString(),
        })));
      }
      if (url.includes('/releases') || url.includes('/tags')) return '[]';
      throw new Error('unexpected request: ' + url);
    },
  };
  return { net, calls };
}

async function orgPool(entries, bound) {
  const stub = listingTransport(entries);
  const pool = await collectAll(
    { settings: { ...RUN_SETTINGS, github_org_repos: bound },
      watchlist: [{ kind: 'github-org', target: 'acme', domain: 'ai-llm', note: '' }] },
    { ...WINDOW, net: stub.net },
  );
  return { pool, calls: stub.calls };
}

const TRUNCATION = /truncat|cap|drop|ignor|beyond|exceed|fewer|partial|incomplete|page|only\s+\d|more\s+than/i;

test('TR-166 a listing that fills the requested page reports the loss of the entries beyond it', async () => {
  const bound = 10;
  const { pool, calls } = await orgPool(bound, bound);

  assert.ok(calls.some((url) => url.includes('/orgs/acme/repos')), 'the listing was never requested');
  const reported = pool.notices.filter((n) => TRUNCATION.test(n));
  assert.equal(reported.length, 1,
    'a listing that answered with exactly the requested page produced ' + reported.length
    + ' notices about it, so the entries past the first page stay invisible: '
    + JSON.stringify(pool.notices));
  assert.match(reported[0], new RegExp('\\b' + bound + '\\b'),
    'the notice names no count, so the operator cannot tell how much may be missing: '
    + JSON.stringify(reported[0]));
  assert.match(reported[0], /page|more|only|first/i,
    'the notice does not say that only the first page was read: ' + JSON.stringify(reported[0]));
  assert.doesNotMatch(reported[0], /https?:\/\//,
    'the notice quotes the request the run made, which the page report must not: '
    + JSON.stringify(reported[0]));
  // The configured organisation row is the run's own text and may be named; the answer's entry
  // names are not, and neither is anything the answer carried.
  assert.doesNotMatch(reported[0], /repo-\d|full_name|updated_at/,
    'the notice quotes upstream entry text, which the page report must not: ' + JSON.stringify(reported[0]));
});

test('TR-166 a listing shorter than the requested page reports nothing, and a longer answer still does', async () => {
  const bound = 10;
  for (const entries of [0, 1, bound - 1]) {
    const { pool } = await orgPool(entries, bound);
    assert.deepEqual(pool.notices, [],
      'a listing of ' + entries + ' entries cannot have lost an entry past the first page, and it '
      + 'reported: ' + JSON.stringify(pool.notices));
  }
  // The same report covers an answer that ignores the bound: the page it filled is still all that
  // was read, and the entries the run never saw are still invisible without it.
  const over = await orgPool(bound + 6, bound);
  const reported = over.pool.notices.filter((n) => TRUNCATION.test(n));
  assert.equal(reported.length, 1,
    'an oversized listing produced ' + reported.length + ' page reports: '
    + JSON.stringify(over.pool.notices));
});

// ---------------------------------------------------------------------------------------
// TR-167 -- the shipped comment claimed the notice rewriting is idempotent when it was not, and
// both bound documents promised that the cross-check alone leaves the shaped error text whole.
// The fix makes the rewriting a fixed point and prices the shaped text on the normalised text,
// so the property the documents may state is the one the code now holds: every text that reaches
// the assembled notice has crossed the rewriting, so the rewriting changes nothing about the
// notice, and the check reserves the room the shaped text is bounded by.
// ---------------------------------------------------------------------------------------

test('TR-167 the shipped notice normalisation is the push and the shaped text is priced after it', async () => {
  // The normaliser the push applies is the one the module exports, and it is a fixed point: what
  // the shaper measures is what the push publishes.
  const once = neutraliseNoticeText('a ](x [prov:y] b');
  assert.equal(neutraliseNoticeText(once), once,
    'the exported normaliser is not a fixed point: ' + JSON.stringify(once));

  // The shaped text itself crosses it: normalising the message the shaper built changes nothing,
  // which is the property that makes its length the length the notice carries.
  const { cap, snippet } = await lowestAcceptedPair();
  const shaped = shapeTransportError(TRANSPORT_FAILURE, 'https://a.example/' + '](x'.repeat(20), snippet, {});
  assert.equal(neutraliseNoticeText(shaped.message), shaped.message,
    'the shaped transport text has not crossed the notice rewriting: ' + JSON.stringify(shaped.message));

  const http = shapeHttpError(429, 'answer', 'https://a.example/' + '](x'.repeat(20), snippet, {}, false);
  assert.equal(neutraliseNoticeText(http.message), http.message,
    'the shaped HTTP text has not crossed the notice rewriting: ' + JSON.stringify(http.message));

  // And the guarantee those two properties buy is the one an accepted pair is measured against:
  // a notice assembled from a seam-heavy source and a seam-heavy request stays within the cap and
  // carries the whole shaped text.
  const target = 'https://a.example/' + '](x'.repeat(20);
  const notice = await transportNotice({ kind: 'rss', target }, { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet });
  assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at cap ' + cap);
  assert.ok(notice.includes(TRANSPORT_CAUSE), 'the cause was cut: ' + JSON.stringify(notice));
});

// The two documents that stated the promise are checked where they are published, so a claim that
// drifts back to the old absolute wording fails here rather than in a reader's run.
test('TR-167 neither bound document promises that the cross-check alone leaves the shaped text whole', () => {
  const skill = readFileSync(join(CONFIG_DIR, '..', 'SKILL.md'), 'utf8');
  const settings = readFileSync(join(CONFIG_DIR, 'settings.md'), 'utf8');
  for (const [name, text] of [['SKILL.md', skill], ['config/settings.md', settings]]) {
    assert.doesNotMatch(text, /an accepted pair leaves the shaped error text the room the check reserved/i,
      name + ' still states the absolute promise the code does not keep');
  }
});

