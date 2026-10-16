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
//
// Batch 48 correction, stated here because the first closure was FALSE: the spelling the first rule
// read ('&#93;&#40;(' with a literal '(' after an entity) is not the spelling the defect has. What
// leaked -- and what this file now pins -- is both halves written as references, including the
// semicolon-less numeric form a browser decodes and the named form '&rbrack;&lpar;(' (verification
// F28-2, sweep F28-3).
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

// The spellings that actually leak, and the reason this list is longer than the first one: the
// Batch 45 rule read an entity for ')' or '(' followed by a LITERAL '(' -- '&#93;&#40;(' and
// '&#41;(' -- which is not the defect. The defect is both halves written as references, and the
// semicolon-less numeric reference is the same link to a browser (the HTML Standard's
// 'missing-semicolon-after-character-reference'). The list below carries those spellings, and the
// assertion beside it is the family-wide one: after the rewrite no closing spelling stands
// immediately before an opening spelling, whatever form each takes.
const ENCODED_TIGHT = /(?:&#0*(?:93|41|40);?|&#x0*(?:5d|29|28);?|&(?:rbrack|rsqb|rpar|lpar);)(?=\(|&#0*40;?|&#x0*28;?|&lpar;)/i;

test('F27-7 / G2-4 an entity-encoded link seam is ended like the literal one', () => {
  for (const seam of [
    '&#93;&#40;(url)', '&#41;(url)', '&#x29;(url)', 'text &#41;(url)',
    // The spellings the first rule missed.
    '&#91;a&#93;&#40;url&#41', '&#x5B;a&#x5D;&#x28;(url)', '&rbrack;&lpar;(url)',
    '&#91;a&#93;&#40(url)', '&lsqb;a&rsqb;&lpar;url&rpar;',
  ]) {
    const rewritten = neutraliseNoticeText(seam);
    assert.doesNotMatch(rewritten, /(?:&#0*4[01];|&#x0*2[89];)\(/,
      'the encoded seam survived a notice: ' + JSON.stringify(rewritten));
    assert.doesNotMatch(rewritten, ENCODED_TIGHT,
      'an entity-encoded seam survived a notice: ' + JSON.stringify(rewritten));
    assert.equal(neutraliseNoticeText(rewritten), rewritten,
      'the encoded-seam rewrite is not a fixed point: ' + JSON.stringify(rewritten));
  }
  // A longer reference that merely starts with one of these digits is not a seam and is untouched.
  for (const untouched of ['&#401;', '&#93;&#401;', '&#x281;', '&rbracket;', 'a &#91;remark&#93; (here)']) {
    assert.equal(neutraliseNoticeText(untouched), untouched,
      'a reference that is not a seam was rewritten: ' + JSON.stringify(untouched));
  }
  // Ordinary punctuation and the text around the seam are untouched.
  assert.equal(neutraliseNoticeText('a normal (remark) here'), 'a normal (remark) here');
  assert.equal(neutraliseNoticeText('text &#40; alone'), 'text &#40; alone',
    'an entity with no link grammar after it was rewritten');
  const notice = assembleNotice('nvd', 'see &#91;click here&#93;&#40;(https://evil.example/pwn) for details', [], 1000);
  assert.doesNotMatch(notice, /&#0*41;\(/, 'the published notice still draws a link: ' + JSON.stringify(notice));
  // The spellings the sweep measured published unchanged at b2a7dc9.
  for (const leaked of [
    'see &#91;click here&#93;&#40;https://evil.example/pwn&#41; for details',
    'see &#x5B;click here&#x5D;&#x28;https://evil.example/pwn&#x29; for details',
    'see &rbrack;&lpar;https://evil.example/pwn&rpar; for details',
  ]) {
    const published = assembleNotice('nvd', leaked, [], 1000);
    assert.doesNotMatch(published, ENCODED_TIGHT,
      'the published notice still draws a link: ' + JSON.stringify(published));
  }
});

// F27-5, the residual, closed by Batch 52 and stated here because this is the file that filed
// F27-5: the first closure took the published bytes from the whole-line redaction, and the
// assembly still COMPOSED two things after that pass -- the ': ' separator and, for a detail with
// no readable message, the module's own reason. A value that spelled either one therefore took
// the assembly's structure rather than a credential: '?token=x%3A%20' collects 'x: ', the whole
// line 'x: ' was removed with the seam, and the empty-detail rebuild put the source and the
// separator back, so the run's own re-redaction removed them again and the notice grew by a
// marker per pass. The separator and the reason are now the assembly's own structure, protected
// by the same scaffold the shaper's status and cause are, and a value that is only the separator
// is removed nowhere.
test('F27-5 residual the assembly keeps its own separator and reason through the run pass', () => {
  const separator = ': ';
  const source = 'rss https://b.example/';
  const detail = 'HTTP 500 for https://b.example/';
  for (const cap of [128, 402]) {
    const notice = assembleNotice(source, detail, [separator], cap);
    assert.ok(notice.includes(separator),
      'the published notice carries no separator at cap ' + cap + ': ' + JSON.stringify(notice));
    assert.equal(redactSecrets(notice, [separator]), notice,
      'the run redaction rewrote the published notice at cap ' + cap + ': ' + JSON.stringify(notice));
    assert.equal(assembleNotice('rss', '', ['failure'], cap).includes('a failure with no message'), true,
      'the module reason was reaped at cap ' + cap);
  }
});
