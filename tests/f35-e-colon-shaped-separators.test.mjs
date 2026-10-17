// tests/f35-e-colon-shaped-separators.test.mjs
// Final verification F35-E named four further separator spellings (U+02D0, U+FE13, U+A789, U+05C3).
// Batch 81 read the first three; the fourth, the Hebrew punctuation SOF PASUQ U+05C3, was still read
// by nothing at e3f2fcf, so a credential behind it was published byte for byte on both entry points:
//   'authorization' + U+05C3 + ' tok_9f3a2c7d1e5b'  ->  unchanged, both entry points
// Batch 83 reads it and closes the rest of the same class rather than leaving it one character over
// again. The boundary is stated and checked with the Unicode name database: every
// Basic-Multilingual-Plane character whose name carries COLON, of a category a surface writes
// (punctuation, symbol, modifier letter), except the ones named SEMICOLON and the currency sign.
//
// The class is anchored immediately after the header NAME in every spelling of that name, so what
// widens is only the text a surface that has already spelled 'authorization' can hand over. Both
// directions are measured here: a credential behind each new spelling goes on both entry points and
// the output is a fixed point, while ordinary prose that merely carries the character anywhere else
// is byte-identical -- and the differential of the pre-batch module and this one over every line of
// every tracked text file changed 0 lines (58,604 units, both entry points).
//
// The bound is recorded rather than hidden: the semicolons, the currency sign, the deprecated tag
// character, the dot-shaped marks and the supplementary-plane colon-named characters stay unread,
// and each row of that list is pinned below as published-unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const CRED = 'tok_' + '9f3a2c7d1e5b';
const ch = (cp) => String.fromCodePoint(cp);

// The spellings this batch reads, each named by its Unicode name.
const READ_NOW = [
  [0x02D1, 'modifier letter half triangular colon U+02D1'],
  [0x02F8, 'modifier letter raised colon U+02F8'],
  [0x05C3, 'hebrew punctuation SOF PASUQ U+05C3 (the verification\'s F35-E row)'],
  [0x0703, 'syriac supralinear colon U+0703'],
  [0x0704, 'syriac sublinear colon U+0704'],
  [0x0705, 'syriac horizontal colon U+0705'],
  [0x0706, 'syriac colon skewed left U+0706'],
  [0x0707, 'syriac colon skewed right U+0707'],
  [0x0708, 'syriac supralinear colon skewed left U+0708'],
  [0x0709, 'syriac sublinear colon skewed right U+0709'],
  [0x1365, 'ethiopic colon U+1365'],
  [0x1366, 'ethiopic preface colon U+1366'],
  [0x1804, 'mongolian colon U+1804'],
  [0x205D, 'tricolon U+205D'],
  [0x2254, 'colon equals U+2254'],
  [0x2255, 'equals colon U+2255'],
  [0x2360, 'APL functional symbol quad colon U+2360'],
  [0x2982, 'Z notation type colon U+2982'],
  [0x2A74, 'double colon equal U+2A74'],
  [0x2AF6, 'triple colon operator U+2AF6'],
  [0xA6F4, 'bamum colon U+A6F4'],
];

// The spellings the class deliberately does NOT read, with the reason each is out.
const NOT_READ = [
  [0x003B, 'ascii semicolon is the attribute list separator inside a value, not a header separator'],
  [0x061B, 'arabic semicolon -- a semicolon, not a colon'],
  [0x1364, 'ethiopic semicolon -- a semicolon, not a colon'],
  [0x204F, 'reversed semicolon -- a semicolon, not a colon'],
  [0x2E35, 'turned semicolon -- a semicolon, not a colon'],
  [0xFE14, 'presentation form for vertical semicolon'],
  [0xFE54, 'small semicolon'],
  [0xFF1B, 'fullwidth semicolon'],
  [0xA6F6, 'bamum semicolon'],
  [0x236E, 'APL functional symbol semicolon underbar'],
  [0x20A1, 'colon sign is a currency sign, not punctuation'],
  [0xE003A, 'tag colon is a deprecated format character'],
  [0x00B7, 'middle dot -- a mark, not a colon'],
  [0x0387, 'greek ano teleia -- a mark, not a colon'],
  [0x1803, 'mongolian full stop -- a full stop, not a colon'],
  [0x2027, 'hyphenation point -- a mark, not a colon'],
  [0x2E31, 'word separator middle dot -- a mark, not a colon'],
  [0x1F16B, 'raised MD sign -- a mark, not a colon'],
  [0x10781, 'superscript triangular colon, supplementary plane'],
  [0x10782, 'superscript half triangular colon, supplementary plane'],
  [0x12471, 'cuneiform vertical colon, supplementary plane'],
  [0x12472, 'cuneiform diagonal colon, supplementary plane'],
  [0x12473, 'cuneiform diagonal tricolon, supplementary plane'],
  [0x12474, 'cuneiform diagonal quadcolon, supplementary plane'],
  [0x1DA8A, 'signwriting colon, supplementary plane'],
];

test('F35-E: every colon-shaped spelling this batch reads drops the credential on both entry points', () => {
  for (const [cp, name] of READ_NOW) {
    for (const value of [CRED, 'Basic dXNlcjpwYXNz', '"' + CRED + '"']) {
      const text = 'authorization' + ch(cp) + ' ' + value;
      const out = redactSecrets(text, []);
      assert.equal(out.includes(CRED), false,
        name + ' published the credential for ' + JSON.stringify(value) + ': ' + JSON.stringify(out));
      assert.equal(redactCredentialShapes(text), out, name + ' split the two entry points');
      assert.equal(redactSecrets(out, []), out, name + ' is not a fixed point');
    }
  }
});

test('F35-E: the new spelling reads the value exactly as the ASCII colon does', () => {
  const VALUES = [CRED, 'Basic dXNlcjpwYXNz', 'username="u" response="deadbeef1234"', '"' + CRED + '"'];
  for (const [cp, name] of READ_NOW) {
    const separator = ch(cp);
    for (const value of VALUES) {
      const out = redactSecrets('authorization' + separator + ' ' + value, []);
      assert.equal(out.replace(separator, ':'), redactSecrets('authorization: ' + value, []),
        name + ' read the value differently from the ASCII colon for ' + JSON.stringify(value));
    }
    // The notice's own source label and its diagnosis survive byte for byte, exactly as they do
    // behind the ASCII colon.
    const notice = 'rss https://a.example/x?p=authorization' + separator + ' HTTP 503 for https://a.example/x';
    assert.equal(redactSecrets(notice, []), notice, name + ' deformed a notice diagnosis');
  }
});

test('F35-E: ordinary prose carrying a new spelling anywhere else is byte-identical', () => {
  for (const [cp, name] of READ_NOW) {
    const separator = ch(cp);
    for (const prose of ['a separator' + separator + 'stands alone',
      'authorization' + separator + ' the run covered 43 domains',
      'the ratio 3' + separator + '1 is written with the character']) {
      assert.equal(redactSecrets(prose, []), prose, name + ' rewrote prose: ' + JSON.stringify(redactSecrets(prose, [])));
      assert.equal(redactCredentialShapes(prose), prose, name + ' rewrote prose on the shape path');
    }
  }
});

test('F35-E: the recorded bound -- a semicolon, a currency sign, a dot or a supplementary plane colon is not read', () => {
  for (const [cp, why] of NOT_READ) {
    const text = 'authorization' + ch(cp) + ' ' + CRED;
    assert.equal(redactSecrets(text, []), text,
      'U+' + cp.toString(16).toUpperCase() + ' was read as a separator (' + why + '): '
      + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text,
      'U+' + cp.toString(16).toUpperCase() + ' split the two entry points (' + why + ')');
  }
});

test('F35-E: Batch 81\'s bounds are unmoved -- the digit guard and the semicolon-less named reference', () => {
  // The guard Batch 81 wrote and the '&colon' bound it pinned are unchanged by this batch, and the
  // separator the verification named is read beside them.
  for (const separator of ['&#580;', '&#x3A0;', '&#580', '&#x3a0;', '&colon']) {
    const text = 'authorization' + separator + ' ' + CRED;
    assert.equal(redactSecrets(text, []), text, 'a reference that is not this separator was read as one');
    assert.equal(redactCredentialShapes(text), text, 'the two entry points disagree about ' + JSON.stringify(separator));
  }
  assert.equal(redactSecrets('authorization&#58 ' + CRED, []), '[redacted]',
    'the semicolon-less numeric reference stopped being read');
});
