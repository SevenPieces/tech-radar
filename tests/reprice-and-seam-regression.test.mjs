// tests/reprice-and-seam-regression.test.mjs
// The Lows the closing verification filed beside the two deciding findings.
//
// F27-4: repriceShapedError read url and omitUrl unguarded, so a forged shaped detail whose property
// read threw escaped the boundary shapedDetailOf's S4-K4 guard (S26-F4) claims to close -- measured
// at the exported assembleNotice, 'hostile=url' and 'hostile=omitUrl' both THREW out of the assembly.
// Every fact the re-price reads is guarded now.
// F27-5: the re-priced branch published 'head' (the head's own pass) rather than a slice of 'whole',
// so a byte the whole-line pass removed could be republished from a text that never crossed it. The
// bytes come from 'whole' now, exactly as they do on every other path.
// F27-6: a collected value shorter than the floor whose LAST character is a separator was not
// removed when a word character followed it ('?token=x%3A%20' collects 'x: ', and 'x: y' published
// it). The word-boundary rule reads its lookahead after the whole value, so the value's own trailing
// separator is now inside the match and the boundary is read where the rule always read it.
// F27-7 / G2-4: an entity-encoded link seam ('&#93;&#40;(') survived the notice rewriting byte for
// byte while the literal form did not, so upstream text could draw a live anchor in the published
// Coverage note. The encoded closer is ended with a space, exactly as the literal rule ends ']('.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, repriceShapedError, shapeTransportError } from '../scripts/lib/net.mjs';
import { assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';

const NOTHING = Symbol('throwing read');

function hostile(overrides) {
  const object = { message: 'x'.repeat(307), httpStatus: null };
  for (const [key, behaviour] of Object.entries(overrides)) {
    Object.defineProperty(object, key, {
      enumerable: true,
      configurable: true,
      get() { throw new Error('hostile getter on ' + key); },
    });
    void behaviour;
  }
  return object;
}

test('F27-4 a hostile url or omitUrl read is refused, never thrown out of the assembly', () => {
  for (const key of ['url', 'omitUrl', 'httpStatus', 'cause', 'message']) {
    const object = key === 'httpStatus' || key === 'cause' ? hostile({ [key]: true }) : hostile({ [key]: true });
    if (key === 'url' || key === 'omitUrl') object.cause = 'reason ' + 'r'.repeat(300);
    let notice;
    assert.doesNotThrow(() => {
      notice = assembleNotice('rss', object, [], 128);
    }, 'a throwing ' + key + ' getter escaped assembleNotice');
    assert.equal(typeof notice, 'string', 'the assembly published nothing for a throwing ' + key + ' getter');
    assert.match(notice, /^(rss|\[redacted\])/,
      'the assembly published an unshaped text: ' + JSON.stringify(notice));
  }
  // The re-price itself refuses rather than throws on the same objects.
  for (const key of ['url', 'omitUrl']) {
    const object = { message: 'm', httpStatus: 500, cause: 'HTTP 500', url: 'https://a.example/x', omitUrl: false };
    Object.defineProperty(object, key, { get() { throw new Error('hostile ' + key); }, enumerable: true, configurable: true });
    assert.doesNotThrow(() => { repriceShapedError(object, [], 128); },
      'a throwing ' + key + ' getter escaped repriceShapedError');
  }
});

test('F27-5 the re-priced line takes its bytes from the whole-line redaction', () => {
  // The head's own pass removes what the whole-line pass removes here, and the re-priced branch is
  // the one whose bytes used to come from the head: the published line must be a run of 'whole'.
  const source = 'rss https://a.example/pw';
  const spanning = 'pw: the';
  const detail = shapeTransportError({ status: 28 }, 'https://b.example/x', 200);
  const notice = assembleNotice(source, detail, [spanning], 128);
  const whole = neutraliseNoticeText(redactSecrets(source + ': ' + detail.message, [spanning]));
  assert.ok(notice.length <= whole.length,
    'the published notice is longer than the whole-line redaction: ' + JSON.stringify(notice));
  assert.equal(notice, whole.slice(0, notice.length),
    'the published notice is not the leading run of the whole-line redaction: '
    + JSON.stringify(notice) + ' vs ' + JSON.stringify(whole));
});

test('F27-6 a short value ending in a separator is removed where it stands as a token', () => {
  assert.equal(redactSecrets('x: y', ['x: ']), '[redacted]y',
    'a collected value ending in a separator was published');
  assert.equal(redactSecrets('end a: ', ['a: ']), 'end [redacted]',
    'a collected value ending a text was published');
  assert.equal(redactSecrets('x:y', ['x:']), '[redacted]y',
    'a value ending in punctuation is not removed before a word character');
  // The floor still keeps an occurrence inside a longer word: the boundary is a word character.
  assert.equal(redactSecrets('cabin ab', ['ab']), 'cabin [redacted]',
    'the standalone value is not removed');
  assert.equal(redactSecrets('scabin', ['ab']), 'scabin',
    'a value inside a longer word was reaped');
});

test('F27-7 / G2-4 an entity-encoded link seam is ended like the literal one', () => {
  for (const seam of ['&#93;&#40;(url)', '&#41;(url)', '&#x29;(url)', 'text &#41;(url)']) {
    const rewritten = neutraliseNoticeText(seam);
    assert.doesNotMatch(rewritten, /(?:&#0*4[01];|&#x0*2[89];)\(/,
      'the encoded seam survived a notice: ' + JSON.stringify(rewritten));
    assert.equal(neutraliseNoticeText(rewritten), rewritten,
      'the encoded-seam rewrite is not a fixed point: ' + JSON.stringify(rewritten));
  }
  // Ordinary punctuation and the text around the seam are untouched.
  assert.equal(neutraliseNoticeText('a normal (remark) here'), 'a normal (remark) here');
  assert.equal(neutraliseNoticeText('text &#40; alone'), 'text &#40; alone',
    'an entity with no link grammar after it was rewritten');
  const notice = assembleNotice('nvd', 'see &#91;click here&#93;&#40;(https://evil.example/pwn) for details', [], 1000);
  assert.doesNotMatch(notice, /&#0*41;\(/, 'the published notice still draws a link: ' + JSON.stringify(notice));
});
