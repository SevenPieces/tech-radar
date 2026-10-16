// tests/credential-name-family.test.mjs
// F27-1 (the High the closing verification re-measured at aabc3dd): the credential-name rule
// collected the value under 'token', 'digest', 'apikey' and the rest of the curated stems, but an
// entire family the early rows had already named was still missed -- password, passwd, passphrase,
// passcode, sessionid, secrets, credentials, cookies, hash, mac, st, sso, clientid, client_id,
// state, uuid, sid, authorization. A request sends its own credential under the operator's own
// spelling, so a server that echoed it published it verbatim: the candidate pool is redacted
// against the credential positions only (TR-110), and a name the rule does not read is not one.
// These cases pin every name in the family, and pin beside them the ordinary names the
// token-or-suffix rule keeps out -- the over-redaction controls TR-116 filed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOf, isDiscoveryOnly, redactSecrets, requestSecretSets, requestSecrets, shapeHttpError,
} from '../scripts/lib/net.mjs';
import { collectAll } from '../scripts/collect.mjs';

const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const SETTINGS = {
  user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
  error_snippet_max_chars: 200, notice_max_chars: 402, request_timeout_ms: 20000,
};
const NET = (fetchText) => ({ fetchText, hostOf, isDiscoveryOnly });
const VALUE = 'PLAINTEXTpw';

// Every spelling the F27-1 filing names, plus the fused and the delimited forms of the same names.
const FAMILY = [
  'password', 'passwd', 'passphrase', 'passcode', 'sessionid', 'secrets', 'credentials',
  'cookies', 'hash', 'mac', 'st', 'sso', 'clientid', 'client_id', 'state', 'uuid', 'sid',
  'authorization',
];
// The same names as the server reads them when they arrive percent-encoded.
const encoded = (name) => name.split('').map((ch) => '%' + ch.charCodeAt(0).toString(16)).join('');

test('F27-1 each name of the family is a credential position in both sets', () => {
  for (const name of FAMILY) {
    for (const spelled of [name, encoded(name), name.toUpperCase()]) {
      const sets = requestSecretSets('https://feeds.example/rss?' + spelled + '=' + VALUE, {});
      assert.ok(sets.all.includes(VALUE),
        'the value of ?' + spelled + '= never reached the notice set: ' + JSON.stringify(sets));
      assert.ok(sets.credentials.includes(VALUE),
        'the value of ?' + spelled + '= never reached the candidate set: ' + JSON.stringify(sets));
      assert.ok(requestSecrets('https://feeds.example/rss?' + spelled + '=' + VALUE, {}).includes(VALUE),
        'the run union does not carry the value of ?' + spelled + '=');
    }
  }
});

test('F27-1 an answer that echoes a value under any of the family publishes it nowhere', async () => {
  for (const name of FAMILY) {
    const target = 'https://feeds.example/releases.xml?' + name + '=' + VALUE;
    const feed = '<rss><channel><item><title>the server echoed ' + VALUE + ' back</title>'
      + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
      + '<description>summary echoing ' + VALUE + '</description></item></channel></rss>';
    const pool = await collectAll(
      { settings: SETTINGS, watchlist: [{ kind: 'rss', target, domain: 'languages-runtimes', note: '' }] },
      { ...WINDOW, net: NET(async () => feed) },
    );
    assert.ok(pool.candidates.length > 0, 'the fixture published no candidate for ?' + name + '=');
    for (const candidate of pool.candidates) {
      for (const [field, value] of Object.entries(candidate)) {
        if (typeof value !== 'string') continue;
        assert.ok(!value.includes(VALUE),
          'the value sent under ?' + name + '= reached the pool field ' + field + ': ' + JSON.stringify(value));
      }
    }
    for (const notice of pool.notices) {
      assert.ok(!notice.includes(VALUE),
        'the value sent under ?' + name + '= reached a notice: ' + JSON.stringify(notice));
    }
  }
});

test('F27-1 a shaped notice that quotes the request keeps the value out', async () => {
  const target = 'https://feeds.example/SECRET42/feed.xml?password=SECRET42';
  const pool = await collectAll(
    { settings: SETTINGS, watchlist: [{ kind: 'rss', target, domain: 'languages-runtimes', note: '' }] },
    {
      ...WINDOW,
      net: NET(async (url) => {
        throw shapeHttpError(500, Buffer.from('upstream rejected ?password=SECRET42'), url, 200);
      }),
    },
  );
  assert.equal(pool.notices.length, 1, 'the run published ' + pool.notices.length + ' notices');
  assert.ok(!pool.notices[0].includes('SECRET42'),
    'the password value reached the notice: ' + JSON.stringify(pool.notices[0]));
});

test('F27-1 the ordinary names stay out of the credential rule', () => {
  // TR-116's own list, plus the names the new whole-token stems could have taken by suffix.
  const ordinary = [
    'author', 'design', 'statuscode', 'keyword', 'countrycode', 'zipcode', 'recode', 'decoder',
    'manifest', 'tarmac', 'glasshouse', 'hashmap', 'realestate', 'download', 'postal', 'contest',
    'stamp', 'sideline', 'statements',
  ];
  for (const name of ordinary) {
    const sets = requestSecretSets('https://feeds.example/rss?' + name + '=descending', {});
    assert.equal(sets.all.includes('descending'), false,
      name + ' was read as a credential position: ' + JSON.stringify(sets));
  }
});

test('F27-1 the floors still keep a short ordinary value under a family name out of the prose', () => {
  const sets = requestSecretSets('https://feeds.example/releases.xml?state=new', {});
  assert.ok(sets.credentials.length === 0,
    'a three-character ordinary value reached the candidate set: ' + JSON.stringify(sets.credentials));
  const prose = 'Rust 1.90 is a new release with new APIs';
  assert.equal(redactSecrets(prose, sets.credentials), prose,
    'the candidate pass reaped ordinary prose under ?state=');
  // The name rule makes the parameter a credential position; it does not make the word a target.
  const named = 'the state of the release notes is unchanged';
  assert.equal(redactSecrets(named, sets.all), named.replace(/new/g, '[redacted]'),
    'the stem itself became a removal target in prose');
});
