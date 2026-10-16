// tests/credential-free-shape-regression.test.mjs
// Closing sweep F30-1 (High, pre-existing, first measured by the closing sweep): the published
// candidate pool carried upstream credential-shaped text BYTE FOR BYTE on every run that issued no
// credential. scripts/collect.mjs chose normalizeInternalChars over redactSecrets whenever
// credentialUnion was empty, and normalizeInternalChars normalises the two internal characters and
// runs no removal rule at all - so the curated SECRET_SHAPES, the authorization rule and the Basic
// rule never ran on any candidate field. The keyless run is the shipped default: githubHeaders()
// adds an Authorization header only when GITHUB_TOKEN or GH_TOKEN is set, and no configured target
// carries a query parameter, so requestSecretSets returns no credential for any shipped row. The
// identical text was '[redacted]' as soon as ONE credential was configured elsewhere in the run.
//
// The fix, and what it deliberately does not do: the empty-union branch crosses the SHAPE half of
// the redaction (net.mjs redactCredentialShapes - the curated vendor shapes, the authorization
// rule and the Basic rule), because an empty value set means there is nothing to remove BY VALUE,
// not that there is no credential to remove BY SHAPE. The BY-VALUE removal stays conditional on
// the credential positions, which is TR-110's contract. The shape half is bound to
// credential-shaped values on this path, because the candidate fields are the prose the digest is
// written from: 'The bearer credential held by the gateway', 'authorization: required for this
// feed' and 'the basic setup is documented' are ordinary prose and are returned byte-identically.
//
// Both directions are asserted below, end to end through the shipped collectAll: every shape the
// sweep published is removed on a credential-free run, ordinary prose carrying the same words is
// untouched, and a run WITH a credential behaves exactly as it did before this change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, isDiscoveryOnly, redactCredentialShapes } from '../scripts/lib/net.mjs';
import { collectAll } from '../scripts/collect.mjs';

const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const SETTINGS = {
  user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
  error_snippet_max_chars: 200, notice_max_chars: 402, request_timeout_ms: 20000,
};
const NET = (fetchText) => ({ fetchText, hostOf, isDiscoveryOnly });
const feed = (text) => '<rss><channel><item><title>' + text + '</title>'
  + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
  + '<description>' + text + '</description></item></channel></rss>';

// The fixtures are assembled from fragments so this file never carries a credential-shaped string
// (the same convention as tests/net.test.mjs).
const CLASSIC_TOKEN = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const FINE_GRAINED = 'github_pat_' + 'A'.repeat(30);
const BEARER_VALUE = 'abcdefghijklmnopqrstuvwxyz012345';
const QUOTED_VALUE = 'tok_' + '9f3a2c7d1e5b';
const SIGV4 = 'AWS4-HMAC-SHA256 Credential=' + 'AKIAEXAMPLE' + '/20261017, Signature=' + 'deadbeef1234';

// The five shapes the sweep measured published, each inside the plain rss row's title and summary.
const SHAPE_ROWS = [
  ['a classic ghp_ token', 'release note: ' + CLASSIC_TOKEN, CLASSIC_TOKEN],
  ['a fine-grained PAT', 'release note: ' + FINE_GRAINED, FINE_GRAINED],
  ['a Bearer value', 'release note: Bearer ' + BEARER_VALUE, BEARER_VALUE],
  ['a quoted authorization header', 'release note: authorization: "' + QUOTED_VALUE + '"', QUOTED_VALUE],
  ['an AWS SigV4 attribute list', 'release note: authorization: ' + SIGV4, 'AKIAEXAMPLE'],
];

// Ordinary prose that merely carries the same words. Every row is a marker the shape half must
// return byte-identically on the credential-free path.
const ORDINARY_ROWS = [
  'The bearer credential held by the gateway is rotated weekly',
  'authorization: required for this feed',
  'the basic setup is documented',
  'a Bearer token is required',
  'the documentation pipeline and the architecture of the release notes',
];

async function poolTitles(watchlist, text) {
  const pool = await collectAll(
    { settings: SETTINGS, watchlist },
    { ...WINDOW, net: NET(async () => feed(text)) },
  );
  return { titles: pool.candidates.map((c) => c.title), summaries: pool.candidates.map((c) => c.summary) };
}

const PLAIN_ROW = { kind: 'rss', target: 'https://feeds.example/feed.xml', domain: 'languages-runtimes', note: '' };
// The credential configured ELSEWHERE in the run, which is what made the identical text
// '[redacted]' before this change.
const CREDENTIAL_ROW = {
  kind: 'rss', target: 'https://feeds.example/other?token=' + QUOTED_VALUE, domain: 'languages-runtimes', note: '',
};

test('F30-1 every shape the sweep published is removed on a credential-free run', async () => {
  for (const [what, text, secret] of SHAPE_ROWS) {
    const { titles, summaries } = await poolTitles([PLAIN_ROW], text);
    assert.ok(titles.length >= 1, 'the row produced no candidate at all: ' + JSON.stringify(titles));
    for (const field of [...titles, ...summaries]) {
      assert.ok(!field.includes(secret),
        'the credential-free pool published ' + what + ': ' + JSON.stringify(field));
    }
  }
});

test('F30-1 ordinary prose carrying the same words is byte-identical on a credential-free run', async () => {
  for (const text of ORDINARY_ROWS) {
    const { titles, summaries } = await poolTitles([PLAIN_ROW], text);
    assert.equal(titles[0], text,
      'the credential-free shape pass reaped ordinary pool prose: ' + JSON.stringify(titles[0]));
    assert.equal(summaries[0], text,
      'the credential-free shape pass reaped ordinary pool prose: ' + JSON.stringify(summaries[0]));
  }
});

test('F30-1 a run WITH a credential behaves as it did before the change', async () => {
  for (const [what, text, secret] of SHAPE_ROWS) {
    const free = await poolTitles([PLAIN_ROW], text);
    const withCredential = await poolTitles([PLAIN_ROW, CREDENTIAL_ROW], text);
    for (const field of withCredential.titles) {
      assert.ok(!field.includes(secret),
        'the credentialed pool published ' + what + ': ' + JSON.stringify(field));
    }
    // The two paths agree on the shape rows: the credentialed path removes them by shape (the
    // value is not the configured credential), and so does the credential-free path now.
    assert.deepEqual(withCredential.titles, free.titles,
      'the credentialed run and the credential-free run disagree on ' + what);
  }
  // The credentialed path is deliberately unchanged, over-redaction included: the wider Bearer
  // shape still reaps an ordinary 'bearer credential' there, because a notice or a pool field on
  // that path is priced against a real value set and a missed Bearer value is a disclosure.
  const prose = 'The bearer credential held by the gateway is rotated weekly';
  const withCredential = await poolTitles([PLAIN_ROW, CREDENTIAL_ROW], prose);
  assert.equal(withCredential.titles[0], 'The [redacted] held by the gateway is rotated weekly',
    'the credentialed path changed: ' + JSON.stringify(withCredential.titles[0]));
});

test('F30-1 the credential-free pass is a fixed point and keeps F28-4 closed', async () => {
  for (const [what, text] of SHAPE_ROWS.map((r) => [r[0], r[1]]).concat(ORDINARY_ROWS.map((t) => ['ordinary prose', t]))) {
    const once = redactCredentialShapes(text);
    assert.equal(redactCredentialShapes(once), once,
      'the credential-free shape pass is not a fixed point on ' + what + ': ' + JSON.stringify(once));
  }
  // The two internal characters are still normalised out on the credential-free path (F28-4).
  const mark = String.fromCharCode(0xE000) + 'a' + String.fromCharCode(0xFFFF) + 'b';
  const normalized = redactCredentialShapes(mark);
  assert.equal(normalized, ' a b', 'an internal character survived the credential-free pass: ' + JSON.stringify(normalized));
});

test('F30-1 the credential-free reading leaves no fragment of a bare value', () => {
  // The shipped reading reads a bare token with a trailing lookahead that backtracks to the
  // token's last-but-one character when a separator and a space follow it (measured on the notice
  // path at a54a744: 'authorization: tok_..., more' -> '[redacted]b, more'). That is harmless where
  // it is the only reading, but the credential-free path is the one that must publish nothing of
  // the value, so its own pattern reads the bare token greedily. Both spellings are asserted, and
  // the credential is the whole of what has to go.
  const value = 'tok_' + '9f3a2c7d1e5b';
  for (const text of [
    'authorization: ' + value + ', more',
    'authorization: ' + value + '  more',
    'authorization: ' + value + '; more',
    'authorization: ' + value + ' more',
    'authorization: ' + value,
  ]) {
    const out = redactCredentialShapes(text);
    assert.ok(!out.includes(value.slice(0, value.length - 1)),
      'a fragment of the value survived: ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
    assert.equal(redactCredentialShapes(out), out,
      'the credential-free rewrite is not a fixed point: ' + JSON.stringify(out));
  }
});

test('F30-1 the shape half removes only credential-shaped values', () => {
  // Both directions at the module surface, so the bound is pinned where it is written.
  for (const text of [
    'authorization: read-only',
    'authorization: required for this feed',
    'authorization: a failure with no message',
    'The bearer credential held by the gateway',
    'the basic setup is documented',
  ]) {
    assert.equal(redactCredentialShapes(text), text,
      'the bounded shape pass reaped ordinary prose: ' + JSON.stringify(redactCredentialShapes(text)));
  }
  for (const text of [
    'release note: ' + CLASSIC_TOKEN,
    'release note: ' + FINE_GRAINED,
    'release note: Bearer ' + BEARER_VALUE,
    'release note: authorization: "' + QUOTED_VALUE + '"',
    'release note: authorization: ' + SIGV4,
    'authorization: Basic ' + Buffer.from('user:password').toString('base64'),
  ]) {
    assert.notEqual(redactCredentialShapes(text), text,
      'the bounded shape pass missed a credential: ' + JSON.stringify(text));
  }
});
