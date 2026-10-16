// tests/internal-character-fixed-point.test.mjs
// Verification F28-1 (Med) and F28-4 (Low), and the property that closes the class.
//
// F28-1: a credential value that IS, or normalises to, an internal character -- the scaffold mask
// U+E000 or the removal sentinel U+FFFF -- entered the removal set as the one-character value ' ',
// which boundedValue matches at every standalone space (its last character is not a word character,
// so no lookahead is appended). One crafted watchlist row therefore rewrote every notice of the run
// (': ' became '[redacted]', nine characters per space), and on a notice that already sat at its cap
// the growth was cut back at the cap and the transport cause was deleted with it.
//
// F28-4: on a run that issued no credential the candidate pass was skipped entirely, so the same
// two characters reached the published pool byte for byte from a server answer.
//
// The fix: both internal characters are normalised out of the input text AND out of every value
// before any rule reads either, and a value that is (or becomes) empty or whitespace-only is not
// collected at all. The property the class asks for is not the crafted case but the invariant:
// every published notice is a fixed point of the run's redaction, re-redacting one never exceeds its
// cap, and no output carries an internal character.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOf, isDiscoveryOnly, normalizeInternalChars, redactSecrets, requestSecretSets, shapeTransportError,
} from '../scripts/lib/net.mjs';
import { assembleNotice, collectAll } from '../scripts/collect.mjs';

const MASK = '\uE000';
const SENTINEL = '\uFFFF';
const INTERNAL = /[\uE000\uFFFF]/;

const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const SETTINGS = {
  user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
  error_snippet_max_chars: 200, notice_max_chars: 402, request_timeout_ms: 20000,
};
const NET = (fetchText) => ({ fetchText, hostOf, isDiscoveryOnly });
const feed = (text) => '<rss><channel><item><title>' + text + '</title>'
  + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
  + '<description>' + text + '</description></item></channel></rss>';

test('F28-1 an internal character is not a collected value', () => {
  for (const character of [MASK, SENTINEL]) {
    for (const spelling of [character, encodeURIComponent(character)]) {
      const sets = requestSecretSets('https://feeds.example/x?token=' + spelling, {});
      assert.deepEqual(sets.all, [],
        'the internal character reached the notice set: ' + JSON.stringify(sets));
      assert.deepEqual(sets.credentials, [],
        'the internal character reached the candidate set: ' + JSON.stringify(sets));
    }
  }
  // A value that is only whitespace is not collected either, through any of its spellings.
  for (const spelling of ['%20', '%20%20', '+', '%09']) {
    const sets = requestSecretSets('https://feeds.example/x?token=' + spelling, {});
    assert.deepEqual(sets.all, [],
      'a whitespace-only value reached the notice set: ' + JSON.stringify(sets));
  }
  // A userinfo password is collected at any length, so it is the other way in. No value it
  // contributes may BE an internal character, and none may be blank once the internal characters are
  // normalised out: the raw wire spelling of the password ('%EE%80%80') and the base64 of the Basic
  // credential are legitimate spellings of a credential the request sent and stay collected, which
  // is the F27-1 direction.
  const userinfo = requestSecretSets('https://user:' + MASK + '@feeds.example/x', {});
  for (const value of userinfo.all) {
    assert.ok(!INTERNAL.test(value),
      'an internal character was collected as a value: ' + JSON.stringify(userinfo.all));
    assert.notEqual(normalizeInternalChars(value).trim(), '',
      'a blank value was collected: ' + JSON.stringify(userinfo.all));
  }
  assert.ok(!userinfo.all.includes(MASK) && !userinfo.all.includes(SENTINEL),
    'the internal character itself reached the notice set: ' + JSON.stringify(userinfo.all));
});

test('F28-1 an internal character reaps no space from a text and deletes no diagnosis', () => {
  for (const character of [MASK, SENTINEL]) {
    assert.equal(redactSecrets('rss https://a.example/x: HTTP 503 for https://a.example/x', [character]),
      'rss https://a.example/x: HTTP 503 for https://a.example/x',
      'the internal character rewrote the notice text');
    assert.equal(redactSecrets('a b c', [character]), 'a b c',
      'the internal character reaped standalone spaces');
  }
  // The cap case: at the least accepted cap the transport cause is still the tail of the notice.
  const url = 'http://127.0.0.1:9/' + 'z'.repeat(280) + '.xml';
  const detail = shapeTransportError({ status: 7 }, url, 200);
  for (const cap of [128, 402, 1000]) {
    const notice = assembleNotice(url, detail, [MASK], cap);
    assert.ok(notice.length <= cap, 'the notice exceeded its cap: ' + notice.length);
    if (cap === 1000) {
      assert.ok(notice.includes('failed to connect (curl exit 7)'),
        'the transport cause was deleted at a cap with room for it: ' + JSON.stringify(notice));
    }
  }
  const atCap = assembleNotice(url, detail, [MASK], 402);
  assert.ok(atCap.includes('failed to connect (curl exit 7)'),
    'the transport cause was deleted at the accepted cap 402: ' + JSON.stringify(atCap));
});

test('F28-1 the run-level crafted row leaves every notice a fixed point inside its cap', async () => {
  const url = 'http://127.0.0.1:9/' + 'z'.repeat(280) + '.xml';
  const pool = await collectAll({
    settings: SETTINGS,
    watchlist: [
      { kind: 'rss', target: 'https://feeds.example/crafted.xml?token=%EE%80%80', domain: 'languages-runtimes', note: '' },
      { kind: 'rss', target: url, domain: 'languages-runtimes', note: '' },
    ],
  }, {
    ...WINDOW,
    net: NET(async (target) => {
      if (String(target).startsWith('http://127.0.0.1:9/')) throw shapeTransportError({ status: 7 }, url, 200);
      return feed('the crafted row answered');
    }),
  });
  assert.ok(pool.notices.length >= 1, 'the failing row published no notice');
  for (const notice of pool.notices) {
    assert.ok(!INTERNAL.test(notice), 'an internal character reached a notice: ' + JSON.stringify(notice));
    assert.equal(redactSecrets(notice, [MASK, SENTINEL]), notice,
      'the published notice is not a fixed point of the run redaction: ' + JSON.stringify(notice));
    assert.ok(notice.length <= SETTINGS.notice_max_chars, 'the notice exceeded its cap');
  }
  assert.ok(pool.notices.some((n) => n.includes('failed to connect (curl exit 7)')),
    'the crafted row deleted the transport cause of the failing row: ' + JSON.stringify(pool.notices));
});

test('F28-4 no internal character reaches a published pool field on the credential-free path', async () => {
  const text = 'a' + MASK + 'b and c' + SENTINEL + 'd';
  const pool = await collectAll(
    { settings: SETTINGS, watchlist: [{ kind: 'rss', target: 'https://feeds.example/feed.xml', domain: 'languages-runtimes', note: '' }] },
    { ...WINDOW, net: NET(async () => feed(text)) },
  );
  assert.ok(pool.candidates.length > 0, 'the fixture published no candidate');
  for (const candidate of pool.candidates) {
    for (const [field, value] of Object.entries(candidate)) {
      if (typeof value !== 'string') continue;
      assert.ok(!INTERNAL.test(value),
        'an internal character reached the pool field ' + field + ': ' + JSON.stringify(value));
    }
  }
  assert.equal(pool.candidates[0].title, 'a b and c d',
    'the internal characters are not normalised to spaces in the pool');
  assert.equal(normalizeInternalChars(text), 'a b and c d');
});

// The property itself, over a generated corpus rather than the crafted case: the invalid input is
// any value or text carrying an internal character, and the invariant is that no output carries one,
// that every published notice is a fixed point, and that re-redacting one never exceeds its cap.
function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
}

test('the redaction and the assembly are fixed points with no internal character in any output', () => {
  const random = xorshift32(0x51f28e1);
  const pick = (list) => list[random() % list.length];
  const heads = ['rss https://a.example/x', 'nvd', 'github authorization', '', 'arxiv ' + MASK,
    'rss ' + SENTINEL, 'npm authorization'];
  const details = ['HTTP 503 for https://a.example/x', 'request failed for https://a.example/x: failed to connect (curl exit 7)',
    'see &#91;a&#93;&#40;(https://e/p)', 'a ' + MASK + ' b', 'the archived releases ' + SENTINEL,
    'x: ' + MASK + ': y', 'authorization: PLAINTEXTpw', MASK, SENTINEL, 'a failure with no message'];
  const values = [MASK, SENTINEL, ' ', '', MASK + SENTINEL, 'ab', 'x: ', 'PLAINTEXTpw', 'Q7x2K9fLmZq4',
    'archived', 'HTTP 503', 'a' + MASK + 'b', 'token=' + SENTINEL, '[redacted]', 'redacte'];
  // A value that exactly spells a POSITIONAL cause phrase ('timed out', 'failed to connect') is
  // deliberately not among the values here: the module protects such a phrase only where the shaper
  // puts it, so a value that spells one is exempt while the phrase stands at a scaffold position and
  // removed once a sibling removal has moved it -- the pre-existing F27-5 exemption, which needs two
  // coordinated crafted values and is pinned by tests/sweep7*.test.mjs in its own direction (the
  // phrase must survive an answer-nominated spelling). It is outside this batch's class.
  const caps = [128, 129, 200, 402, 1000];
  let cases = 0;
  for (let i = 0; i < 4000; i += 1) {
    const head = pick(heads);
    const detail = pick(details);
    const text = head + ': ' + detail;
    const secrets = [];
    const count = 1 + (random() % 4);
    for (let k = 0; k < count; k += 1) secrets.push(pick(values));
    const once = redactSecrets(text, secrets);
    assert.ok(!INTERNAL.test(once),
      'an internal character survived the redaction: ' + JSON.stringify({ text, secrets, once }));
    assert.equal(redactSecrets(once, secrets), once,
      'the redaction is not a fixed point: ' + JSON.stringify({ text, secrets, once }));
    const cap = pick(caps);
    const notice = assembleNotice(head, detail, secrets, cap);
    const noticeAgain = redactSecrets(notice, secrets);
    assert.ok(!INTERNAL.test(notice), 'an internal character reached a notice: ' + JSON.stringify({ head, detail, secrets, cap, notice }));
    assert.equal(noticeAgain, notice,
      'the published notice is not a fixed point: ' + JSON.stringify({ head, detail, secrets, cap, notice }));
    assert.ok(noticeAgain.length <= cap,
      're-redacting the published notice exceeded its cap: ' + JSON.stringify({ head, detail, secrets, cap, notice, noticeAgain }));
    cases += 1;
  }
  assert.equal(cases, 4000);
});
