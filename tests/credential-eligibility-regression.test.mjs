// tests/credential-eligibility-regression.test.mjs
// Sweep F28-1 (Med, a regression of Batch 43) and the compound / fused-name Lows beside it
// (F28-5, F28-6 / sweep F28-2).
//
// Batch 43 added the whole-token names 'st', 'state', 'status', 'sid', 'sso', 'mac', 'hash',
// 'uuid' and 'authorization' and read them for EVERY purpose the credential rule serves. But the
// rule answers two different questions - 'is this a credential position to collect from?' and 'may
// a value under this name rewrite published prose?' - and the candidate pass asks only the second.
// An ordinary configured value under one of those names ('?state=archived', '?status=releases',
// '?uuid=identifier', '?authorization=required') became a candidate value and the candidate pass
// rewrote the published prose of an unrelated source: 'the archived releases' became 'the
// [redacted] releases'. That is the exact class TR-110 closed, reopened.
//
// The two questions are asked apart, and Batch 53 finished the split: a name is credential-BEARING
// when a genuinely credential-bearing spelling (a stem, or a fused session/CSRF spelling) spells it,
// and the candidate half of the rule asks that question of the NAME ALONE. A token-only name is
// therefore not a candidate position at all - not for any value, at any length, in any shape.
//
// Batch 46 had made the value's own shape the second question (a digit, a capital or a
// non-alphanumeric, non-space mark) and Batch 51 added a length reading to it (a pure lower-case
// word of at least twelve characters). Two independent verification passes measured that gate
// failing in BOTH directions on the shipped paths: '?state=abcdefghijk' (11, no mark) was published
// in the candidate pool while the identical value under '?token=' was redacted, and
// '?state=configuration', '?state=documentation', '?state=architecture' and
// '?status=infrastructure' are ordinary English words of twelve or more characters with no mark
// either, so an ordinary configured value reaped a feed's published prose ('[redacted] drift in the
// podspec is a common failure'), including through the ordinary compounds '?mac-address=',
// '?x-state=' and '?state-of-the-art='. The gate and its threshold were deleted rather than
// re-tuned, because no threshold separates a random short token from a short English word.
//
// **This is a deliberate residual, and it is recorded here as one.** A credential standing under a
// TOKEN-ONLY name is not candidate-protected: an answer that echoes it publishes it in the pool
// fields, and the tests at the end of this file assert exactly that instead of asserting the
// protection that does not exist. The trade is TR-110's: 'a value that is ordinary configuration is
// not a credential and never rewrites published prose' (scripts/collect.mjs), and over-redaction of
// the published digest is the worse failure. The notice surface is unchanged - every credential
// position, token-only names included, still collects from three characters up, so a notice that
// quotes the run's own request still redacts the value - and the shipped config/watchlist.md carries
// no query parameter on any of its 93 rows, so the shipped configuration cannot reach the residual
// at all.
//
// The F27-1 (High) closure rests on the other half: a name that is credential-bearing by its own
// spelling ('password', 'token', 'clientid', 'sessionid', ...) is collected for BOTH sets whatever
// its value spells, at every length and in every shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, isDiscoveryOnly, redactSecrets, requestSecretSets, requestSecrets } from '../scripts/lib/net.mjs';
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

async function poolTitle(target, text) {
  const pool = await collectAll(
    { settings: SETTINGS, watchlist: [{ kind: 'rss', target, domain: 'languages-runtimes', note: '' }] },
    { ...WINDOW, net: NET(async () => feed(text)) },
  );
  return pool.candidates[0] ? pool.candidates[0].title : '(no candidate)';
}

// The rows the sweep measured, and the two TR-110 controls that must stay untouched.
const ORDINARY_ROWS = [
  ['?state=archived', 'the archived releases were moved to the archived shelf'],
  ['?status=releases', 'the releases page lists the releases we published'],
  ['?uuid=identifier', 'the identifier names the work identifier we use'],
  ['?authorization=required', 'a credential is required for this feed'],
  ['?sortOrder=descending', 'the results are sorted in descending order'],
  ['?max_results=40', 'we list 40 entries per page'],
];

test('F28-1 an ordinary configured value under an ordinary token name rewrites no candidate prose', async () => {
  for (const [query, text] of ORDINARY_ROWS) {
    const title = await poolTitle('https://feeds.example/feed.xml' + query, text);
    assert.equal(title, text,
      'the ordinary value of ' + query + ' rewrote published prose: ' + JSON.stringify(title));
  }
});

test('F28-1 the value under a token name is still a notice credential position', () => {
  for (const name of ['st', 'state', 'status', 'sid', 'sso', 'mac', 'hash', 'uuid', 'authorization']) {
    const sets = requestSecretSets('https://feeds.example/rss?' + name + '=archived', {});
    assert.ok(sets.all.includes('archived'),
      'the value of ?' + name + '= left the notice set: ' + JSON.stringify(sets));
    assert.ok(requestSecrets('https://feeds.example/rss?' + name + '=archived', {}).includes('archived'),
      'the value of ?' + name + '= left the run union');
  }
});

test('F27-1 a genuinely credential-bearing name keeps both sets whatever its value spells', () => {
  for (const name of ['password', 'passwd', 'passphrase', 'passcode', 'sessionid', 'secrets',
    'credentials', 'cookies', 'clientid', 'token', 'apikey', 'secret', 'code']) {
    for (const value of ['landscape', 'PLAINTEXTpw', 'Q7x2K9fLmZq4']) {
      const sets = requestSecretSets('https://feeds.example/rss?' + name + '=' + value, {});
      assert.ok(sets.all.includes(value),
        'the value of ?' + name + '=' + value + ' left the notice set: ' + JSON.stringify(sets));
      assert.ok(sets.credentials.includes(value),
        'the value of ?' + name + '=' + value + ' left the candidate set: ' + JSON.stringify(sets));
    }
  }
});

// Batch 53 correction. This test asserted that a credential-SHAPED value (a digit, a capital, a
// separator) under a token-only name keeps both sets. That expectation is the shape half of the
// gate Batch 46/51 built, and the shipped rule does not have it any more: eligibility is decided by
// the name, and a token-only name is not credential-bearing. The value's shape changes nothing
// either way, which is the point - the shape is exactly what could not separate a short random
// token from a short English word. What the test now pins is the residual itself, in contrast with
// the credential-bearing name beside it.
test('F27-1 residual: no value under a token-only name is candidate-protected, in any shape', async () => {
  for (const name of ['state', 'status', 'uuid', 'authorization']) {
    const value = 'Q7x2K9fLmZq4';
    const sets = requestSecretSets('https://feeds.example/x?' + name + '=' + value, {});
    assert.ok(sets.all.includes(value),
      '?' + name + '= left the notice set: ' + JSON.stringify(sets));
    assert.deepEqual(sets.credentials, [],
      '?' + name + '= entered the candidate set: ' + JSON.stringify(sets));
    const title = await poolTitle('https://feeds.example/feed.xml?' + name + '=' + value,
      'the server echoed ' + value + ' back');
    assert.ok(title.includes(value),
      'the recorded residual changed: ?' + name + '= is candidate-protected after all: ' + JSON.stringify(title));
  }
  // The contrast, unchanged: the same shape under a credential-BEARING name is removed end to end.
  const plain = await poolTitle('https://feeds.example/feed.xml?token=PLAINTEXTpw',
    'the server echoed PLAINTEXTpw back');
  assert.ok(!plain.includes('PLAINTEXTpw'),
    'the credential of ?token= reached the pool: ' + JSON.stringify(plain));
});

// F28-5 / sweep F28-2: the compound-ordinary-name class. 'state-of-the-art', 'x-state',
// 'mac-address', 'hash-of-x', 'sid-note', 'uuid-ish', 'st-panel', 'sso-note' and the camelCase and
// snake_case spellings all carry a token-only stem as ONE token, so they are credential positions
// for the notice set; none of them is credential-BEARING, so an ordinary word under one of them
// leaves the candidate prose alone, while a credential-shaped value still goes.
const COMPOUNDS = [
  'state-of-the-art', 'stateOfTheArt', 'state_of_the_art', 'x-state', 'mac-address', 'hash-of-x',
  'sid-note', 'uuid-ish', 'st-panel', 'sso-note',
];

test('F28-5 an ordinary compound of a token name does not rewrite candidate prose', async () => {
  for (const name of COMPOUNDS) {
    const sets = requestSecretSets('https://feeds.example/x?' + name + '=landscape', {});
    assert.ok(sets.all.includes('landscape'),
      '?' + name + '= is not a notice credential position: ' + JSON.stringify(sets));
    assert.deepEqual(sets.credentials, [],
      '?' + name + '= put an ordinary configured word into the candidate set: ' + JSON.stringify(sets));
    const title = await poolTitle('https://feeds.example/feed.xml?' + name + '=landscape',
      'The landscape of Rust in 2026');
    assert.equal(title, 'The landscape of Rust in 2026',
      '?' + name + '= rewrote published prose: ' + JSON.stringify(title));
    // Batch 53 correction: the candidate half belongs to the NAME, so a compound of a token-only
    // name is not a candidate position for a credential-shaped value either - the shape no longer
    // decides anything. The corrected expectation is the whole token-only rule: no candidate value,
    // whatever it spells, while the name stays a notice position.
    assert.deepEqual(requestSecretSets('https://feeds.example/x?' + name + '=Q7x2K9fLmZq4', {}).credentials,
      [], '?' + name + '= became a candidate position after all');
  }
});

test('F28-5 the ordinary names the token rule keeps out are still kept out', () => {
  for (const name of ['author', 'design', 'statuscode', 'manifest', 'glasshouse', 'tarmac',
    'hashmap', 'realestate', 'keyword', 'statements', 'stateless', 'sideline', 'download', 'postal',
    'contest', 'stamp']) {
    const sets = requestSecretSets('https://feeds.example/x?' + name + '=Q7x2K9fLmZq4', {});
    assert.deepEqual(sets.all, [],
      'the ordinary name ?' + name + '= became a credential position: ' + JSON.stringify(sets));
  }
});

// F28-6 / sweep F28-2: the fused spellings the stem rule cannot reach. The session and anti-CSRF
// spellings a server actually uses are taken; 'identity' and 'salt' are not, and the reason is in
// net.mjs: an identity is an ordinary descriptive parameter's value and a salt is public by
// construction, so neither is a credential.
test('F28-6 the fused session and anti-CSRF spellings are credential positions', () => {
  for (const name of ['phpsessid', 'sessid', 'ssoid', '_csrf', 'xsrf', 'mfa', 'webhook', 'pwdhash']) {
    for (const spelled of [name, name.toUpperCase()]) {
      const sets = requestSecretSets('https://feeds.example/x?' + spelled + '=Q7x2K9fLmZq4', {});
      assert.ok(sets.all.includes('Q7x2K9fLmZq4'),
        '?' + spelled + '= is not a credential position: ' + JSON.stringify(sets));
      assert.ok(sets.credentials.includes('Q7x2K9fLmZq4'),
        '?' + spelled + '= is not a candidate credential position: ' + JSON.stringify(sets));
    }
  }
  for (const name of ['identity', 'salt']) {
    const sets = requestSecretSets('https://feeds.example/x?' + name + '=Q7x2K9fLmZq4', {});
    assert.deepEqual(sets.all, [],
      'the ordinary name ?' + name + '= became a credential position: ' + JSON.stringify(sets));
  }
});

test('F28-6 a credential-shaped value under a fused name is kept out of the pool', async () => {
  const value = 'RESIDUAL01';
  const title = await poolTitle('https://feeds.example/feed.xml?PHPSESSID=' + value,
    'the server echoed ' + value + ' back');
  assert.ok(!title.includes(value),
    'the value sent under ?PHPSESSID= reached the pool: ' + JSON.stringify(title));
});


// ---------------------------------------------------------------------------------------
// Batch 53: the token-only rule at every length and in every shape, both directions.
//
// Batch 46 made the value's shape the second half of the candidate gate and Batch 51 added a
// twelve-character length reading to it. Both halves are gone: the candidate half asks the NAME
// question alone, so a token-only name contributes no candidate value at all. The two tests below
// replace the length-boundary pair that pinned the deleted threshold - the ordinary side, which the
// threshold got right, and the credential side, which it got wrong and which is now the recorded
// residual rather than a protection.
const TOKEN_NAMES = ['st', 'state', 'status', 'sid', 'sso', 'mac', 'hash', 'uuid', 'authorization'];

test('F28-1: no ordinary value, at any length, enters the candidate set under a token-only name', () => {
  // The values the threshold's own evidence named, the twelve-plus-character English words that
  // proved the threshold wrong in the over-redaction direction, and a phrase. None of them may
  // rewrite published prose, and none may enter the candidate set under any token-only name.
  const ordinary = [
    'archived', 'releases', 'required', 'landscape', 'identifier', 'descending',
    'performance', 'environment', 'description', 'temperature', 'unavailable',
    'architecture', 'introduction', 'configuration', 'documentation', 'infrastructure',
    'international', 'transmission', 'organisation', 'communication',
    // A phrase is a value a source publishes, never a credential, whatever its length.
    'the archived releases were moved',
  ];
  for (const name of TOKEN_NAMES) {
    for (const value of ordinary) {
      const sets = requestSecretSets('https://feeds.example/x?' + name + '=' + encodeURIComponent(value), {});
      assert.equal(sets.credentials.includes(value), false,
        '?' + name + '= put the ordinary value ' + JSON.stringify(value) + ' into the candidate set: '
        + JSON.stringify(sets));
      assert.equal(sets.all.includes(value), true,
        '?' + name + '= lost the notice position for ' + JSON.stringify(value) + ': '
        + JSON.stringify(sets));
    }
  }
});

test('F29-1 the recorded residual: every token name leaves every value out of the candidate set', () => {
  // 'abcdefghijk' (8-11, no mark) is the window the verification pass filed as F29-1; the three
  // longer spellings are the ones Batch 51 was written for. All of them are notice positions and
  // none is a candidate position, which is the trade this file records rather than a protection it
  // asserts. Corrected from the Batch 51 expectation that the 12+ spellings crossed into both sets.
  for (const name of TOKEN_NAMES) {
    for (const value of ['abcdefghijk', 'abcdefghijkl', 'abcdefghijklmnop', 'openssltoken',
      'lowercaseonlysecret']) {
      const sets = requestSecretSets('https://feeds.example/x?' + name + '=' + value, {});
      assert.ok(sets.all.includes(value),
        '?' + name + '=' + value + ' left the notice set: ' + JSON.stringify(sets));
      assert.deepEqual(sets.credentials, [],
        '?' + name + '=' + value + ' entered the candidate set: ' + JSON.stringify(sets));
      // The notice surface still redacts it: the value is a notice position, and a notice that
      // quotes the run's own request gives it up.
      const notice = 'rss https://feeds.example/feed.xml: HTTP 503 for https://feeds.example/x?'
        + name + '=' + value;
      assert.ok(!redactSecrets(notice, sets.all).includes(value),
        'the notice echo of ?' + name + '= published the value');
    }
  }
});

test('F29-1 the residual end to end, and the ordinary prose that must survive byte for byte', async () => {
  // The recorded residual, measured on the shipped path: a token-named value echoed by an answer is
  // published in the candidate pool. This is the price of TR-110's rule and it is what the test now
  // pins; it was previously expected to be redacted.
  for (const [name, value] of [['state', 'abcdefghijk'], ['state', 'abcdefghijklmnop'],
    ['status', 'openssltoken'], ['authorization', 'lowercaseonlysecret']]) {
    const title = await poolTitle('https://feeds.example/feed.xml?' + name + '=' + value,
      'the server echoed ' + value + ' back');
    assert.ok(title.includes(value),
      'the recorded residual changed: ?' + name + '=' + value + ' is candidate-protected: '
      + JSON.stringify(title));
  }
  // The over-redaction direction, which is the worse failure TR-110 names, is closed at every
  // length: the ordinary value is published prose and must survive byte for byte.
  for (const [name, value] of [['state', 'archived'], ['status', 'releases'],
    ['uuid', 'identifier'], ['state', 'performance'], ['state', 'configuration'],
    ['state', 'architecture'], ['status', 'infrastructure'], ['mac-address', 'documentation'],
    ['x-state', 'architecture'], ['state-of-the-art', 'configuration']]) {
    const text = 'the ' + value + ' list was published';
    const title = await poolTitle('https://feeds.example/feed.xml?' + name + '=' + value, text);
    assert.equal(title, text,
      '?' + name + '=' + value + ' rewrote published prose: ' + JSON.stringify(title));
  }
});
