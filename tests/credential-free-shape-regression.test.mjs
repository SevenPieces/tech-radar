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
  // Batch 61: the credentialed path is no longer a WIDER reading of the same sentence. The generic
  // Bearer alternative was bounded to a credential-shaped value on the credential-free candidate
  // path and left wide on the notice/credentialed path, so this prose row was '[redacted]' on one
  // and byte-identical on the other - exactly the drift the one matcher removes. There is ONE
  // Bearer rule now and it is bounded on both paths: the ordinary row is byte-identical on a
  // credentialed run too, while a credential-shaped Bearer value is still removed on both (the
  // curated vendor shapes cover the token classes a curated value set cannot know) and a Bearer
  // value standing in an authorization header is consumed by the header rule whatever it spells.
  const prose = 'The bearer credential held by the gateway is rotated weekly';
  const withCredential = await poolTitles([PLAIN_ROW, CREDENTIAL_ROW], prose);
  assert.equal(withCredential.titles[0], prose,
    'the credentialed path reaps ordinary Bearer prose again: ' + JSON.stringify(withCredential.titles[0]));
  const bearerRow = 'release note: Bearer ' + BEARER_VALUE;
  const freeBearer = await poolTitles([PLAIN_ROW], bearerRow);
  const credentialedBearer = await poolTitles([PLAIN_ROW, CREDENTIAL_ROW], bearerRow);
  assert.ok(!freeBearer.titles[0].includes(BEARER_VALUE)
    && !credentialedBearer.titles[0].includes(BEARER_VALUE),
  'a credential-shaped Bearer value survived on one of the paths');
  assert.deepEqual(credentialedBearer.titles, freeBearer.titles,
    'the two runs disagree about a credential-shaped Bearer value');
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

// ---------------------------------------------------------------------------------------
// Batch 61 (closing sweep F31-1..F31-5). The credential-free pool pass and the notice path used to
// read a credential header differently, and the pool published what the notice removed: an
// attribute list's quoted credential (the gate read the attribute NAME after the scheme, which is
// not credential-shaped, so the whole match was abandoned), a standard SigV4 'Signature=' (the
// tail stopped at ';'), a quoted token after a scheme (read by nobody), a JSON-dumped header (read
// by no path) and the three quoted residues Batch 56 recorded. One matcher reads them now, on both
// paths, with the same acceptance; the pool rows below are the end-to-end measurement of that.
// ---------------------------------------------------------------------------------------
const SWEEP_B64 = Buffer.from('user:' + 'password1').toString('base64');

const SWEEP_POOL_ROWS = [
  ['F31-1 a Digest attribute list',
    'authorization: Digest username="u", response="deadbeef1234"', 'deadbeef1234'],
  ['F31-1 an OAuth attribute list',
    'authorization: OAuth oauth_consumer_key="abc", oauth_token="SECRETTOKEN123"', 'SECRETTOKEN123'],
  ['F31-1 a reordered SigV4 attribute list',
    'authorization: AWS4-HMAC-SHA256 SignedHeaders=host;x-amz-date, Credential=' + 'AKIA'
    + 'EXAMPLE/20261017, Signature=deadbeef1234', 'AKIA' + 'EXAMPLE'],
  ['F31-2 a standard SigV4 attribute list',
    'authorization: AWS4-HMAC-SHA256 Credential=' + 'AKIA'
    + 'EXAMPLE/20261017/us-east-1, SignedHeaders=host;x-amz-date, Signature=9f8e7d6c5b4a3f2e1d0c',
    '9f8e7d6c5b4a' + '3f2e1d0c'],
  ['F31-3 a quoted Basic credential', 'authorization: Basic "' + SWEEP_B64 + '"', SWEEP_B64],
  ['F31-3 a quoted Bearer credential', 'authorization: Bearer "TOKEN9f3a2c7d"', 'TOKEN9f3a2c7d'],
  ['F31-4 a JSON-dumped header', '{"authorization": "' + QUOTED_VALUE + '"}', QUOTED_VALUE],
  ['F31-4 a JSON-dumped proxy header', '{"proxy-authorization":"' + QUOTED_VALUE + '"}', QUOTED_VALUE],
  ['F31-5 nested quotes', 'authorization: "pre "' + QUOTED_VALUE + '" post"', QUOTED_VALUE],
  ['F31-5 a quoted value behind a bare attribute',
    'authorization: realm=example, "' + QUOTED_VALUE + '"', QUOTED_VALUE],
  ['F31-5 an unbalanced single quote', "authorization: it's " + QUOTED_VALUE, QUOTED_VALUE],
];

test('F31 the credential-free pool publishes none of the sweep spellings, and the credentialed run agrees', async () => {
  for (const [what, text, credential] of SWEEP_POOL_ROWS) {
    const free = await poolTitles([PLAIN_ROW], text);
    const withCredential = await poolTitles([PLAIN_ROW, CREDENTIAL_ROW], text);
    assert.ok(free.titles.length >= 1, 'the row produced no candidate at all: ' + JSON.stringify(free));
    for (const [which, fields] of [
      ['the credential-free run', [...free.titles, ...free.summaries]],
      ['the credentialed run', [...withCredential.titles, ...withCredential.summaries]],
    ]) {
      for (const field of fields) {
        assert.ok(!field.includes(credential),
          what + ' published its credential in ' + which + ': ' + JSON.stringify(field));
      }
    }
    // The two runs agree: the shape half reads the same text on both, and the by-value half has
    // nothing left to remove once the shape pass has consumed the header.
    assert.deepEqual(withCredential.titles, free.titles,
      'the credentialed run and the credential-free run disagree about ' + what);
  }
});
