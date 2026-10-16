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
// The two questions are asked apart now: a name is credential-BEARING when a genuinely
// credential-bearing spelling (a stem, or a fused session/CSRF spelling) spells it, and a value
// under a token-only name is a candidate value only when the value is itself credential-shaped
// (it carries a digit, a capital, or a non-alphanumeric, non-space character). The notice set is
// unchanged: every credential position still collects from three characters up.
//
// The F27-1 (High) closure rests on the other half: a name that is credential-bearing by its own
// spelling ('password', 'token', 'clientid', 'sessionid', ...) is collected for BOTH sets whatever
// its value spells, and a token-named position whose value really is a credential is collected for
// both as well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, isDiscoveryOnly, requestSecretSets, requestSecrets } from '../scripts/lib/net.mjs';
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

test('F27-1 a credential-shaped value under a token name keeps both sets, end to end', async () => {
  for (const name of ['state', 'status', 'uuid', 'authorization']) {
    const value = 'Q7x2K9fLmZq4';
    const title = await poolTitle('https://feeds.example/feed.xml?' + name + '=' + value,
      'the server echoed ' + value + ' back');
    assert.ok(!title.includes(value),
      'the credential-shaped value under ?' + name + '= reached the pool: ' + JSON.stringify(title));
  }
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
    assert.ok(requestSecretSets('https://feeds.example/x?' + name + '=Q7x2K9fLmZq4', {}).credentials
      .includes('Q7x2K9fLmZq4'), '?' + name + '= lost its credential-shaped value');
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
