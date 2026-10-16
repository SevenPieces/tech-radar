// tests/tr109-digest-parameter.test.mjs
// TR-109 residual: the credential-name rule carried hmac, nonce and otp after the stem list was
// widened, and 'digest' -- the fourth spelling the F1 table named -- was still not a credential
// position, so a value the request sent under it was collected by neither the name rule nor the
// free-text floor and reached the notice, the pool and the published coverage note verbatim.
// The digest stem is in the rule now; these cases pin it, and pin beside it the floors that keep
// a short ordinary value under a credential name from reaping published prose.
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
const FEED = '<rss><channel><item><title>echoed digest=SECRET42 back</title>'
  + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
  + '<description>the server echoed digest=SECRET42 in the answer</description></item></channel></rss>';

test('TR-109 a digest-named parameter is a credential position like hmac, nonce and otp', () => {
  for (const name of ['digest', 'hmac', 'nonce', 'otp']) {
    const sets = requestSecretSets('https://feeds.example/rss?' + name + '=SECRET42', {});
    assert.ok(sets.all.includes('SECRET42'),
      'the value of ?' + name + '= is collected by neither rule: ' + JSON.stringify(sets));
    assert.ok(sets.credentials.includes('SECRET42'),
      'the value of ?' + name + '= never reaches the candidate set: ' + JSON.stringify(sets));
  }
});

test('TR-109 a digest value is removed from a notice that names the request it travelled in', async () => {
  const target = 'https://feeds.example/SECRET42/feed.xml?digest=SECRET42';
  const pool = await collectAll(
    { settings: SETTINGS, watchlist: [{ kind: 'rss', target, domain: 'languages-runtimes', note: '' }] },
    {
      ...WINDOW,
      net: NET(async (url) => {
        throw shapeHttpError(500, Buffer.from('upstream rejected /feed.xml?digest=SECRET42'), url, 200);
      }),
    },
  );
  assert.equal(pool.notices.length, 1, 'the run published ' + pool.notices.length + ' notices');
  assert.ok(!pool.notices[0].includes('SECRET42'),
    'the digest value reached the notice: ' + JSON.stringify(pool.notices[0]));
});

test('TR-109 an answer that echoes a digest value publishes it nowhere', async () => {
  const target = 'https://feeds.example/releases.xml?digest=SECRET42';
  const pool = await collectAll(
    { settings: SETTINGS, watchlist: [{ kind: 'rss', target, domain: 'languages-runtimes', note: '' }] },
    { ...WINDOW, net: NET(async () => FEED) },
  );
  assert.ok(pool.candidates.length > 0, 'the fixture published no candidate to inspect');
  for (const candidate of pool.candidates) {
    for (const [field, value] of Object.entries(candidate)) {
      if (typeof value !== 'string') continue;
      assert.ok(!value.includes('SECRET42'),
        'the digest value reached the pool field ' + field + ': ' + JSON.stringify(value));
    }
  }
  const shaped = shapeHttpError(500, Buffer.from('see /feed.xml?digest=SECRET42'), target, 200);
  assert.ok(!shaped.message.includes('SECRET42'),
    'the shaped text carries the digest value: ' + JSON.stringify(shaped.message));
});

test('TR-109 the floors still keep a short ordinary value under such a name out of the prose', () => {
  const sets = requestSecretSets('https://feeds.example/releases.xml?digest=new', {});
  assert.ok(sets.all.includes('new'),
    'the notice set no longer takes a short value under a credential name: ' + JSON.stringify(sets));
  assert.deepEqual(sets.credentials, [],
    'a three-character ordinary value reached the candidate set: ' + JSON.stringify(sets.credentials));
  const prose = 'Rust 1.90 is a new release with new APIs';
  assert.equal(redactSecrets(prose, sets.credentials), prose, 'the candidate pass reaped ordinary prose');
  // The value rule removes the values it is handed and nothing else: the digest stem makes a
  // parameter a credential position, it does not make the word 'digest' in a feed's own prose one.
  const proseWithStem = 'the digest of the release notes is unchanged';
  assert.equal(redactSecrets(proseWithStem, sets.all), proseWithStem.split('new').join('[redacted]'),
    'the stem itself became a removal target in prose');
  assert.ok(requestSecrets('https://feeds.example/releases.xml?digest=SECRET42', {}).includes('SECRET42'),
    'the run union no longer carries the digest value');
});
