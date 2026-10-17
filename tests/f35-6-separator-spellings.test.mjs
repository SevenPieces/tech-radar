// tests/f35-6-separator-spellings.test.mjs
// Closing sweep F35-6 (Low, pre-existing). The comment on the header separator's class claimed 'every
// spelling a surface writes it', and Batch 72's own list held four characters and three entity
// spellings. Six colon-shaped separators and the SEMICOLON-LESS numeric character reference were read
// by nothing, so the credential behind them was published byte for byte on both entry points.
//
// The class now reads them. It is anchored immediately after the header NAME (in every spelling of
// the name), so what widens is only the text a surface that has already spelled 'authorization' can
// hand over -- and the measurement below is the other direction: ordinary prose carrying these
// characters anywhere else is byte-identical.
//
// Two bounds are recorded rather than hidden, both pinned at the bottom: a numeric reference that
// runs on into another character ('&#580;' is U+0244, '&#x3A0;' is U+03A0) is NOT this separator and
// is not read as one, and a NAMED reference without its semicolon ('&colon') is not read either,
// because HTML resolves no named reference without a semicolon unless it is in its legacy list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const LF = String.fromCharCode(10);
const CRED = 'tok_' + '9f3a2c7d1e5b';

// Every spelling the class reads, the six this sweep measured included.
const SEPARATORS = [
  ['ascii colon', ':'],
  ['fullwidth U+FF1A', String.fromCharCode(0xFF1A)],
  ['small U+FE55', String.fromCharCode(0xFE55)],
  ['ratio U+2236', String.fromCharCode(0x2236)],
  ['vertical U+FE13', String.fromCharCode(0xFE13)],
  ['modifier letter U+A789', String.fromCharCode(0xA789)],
  ['triangular U+02D0', String.fromCharCode(0x2D0)],
  ['two-dot U+205A', String.fromCharCode(0x205A)],
  ['armenian full stop U+0589', String.fromCharCode(0x589)],
  ['ethiopic wordspace U+1361', String.fromCharCode(0x1361)],
  ['entity &#58;', '&#58;'],
  ['entity &#058;', '&#058;'],
  ['entity &#x3A;', '&#x3A;'],
  ['entity &#X3a;', '&#X3a;'],
  ['entity &#x03A;', '&#x03A;'],
  ['entity &colon;', '&colon;'],
  ['entity &COLON;', '&COLON;'],
  ['numeric reference, no semicolon &#58', '&#58'],
  ['numeric reference, no semicolon &#058', '&#058'],
  ['hex reference, no semicolon &#x3A', '&#x3A'],
  ['hex reference, no semicolon &#X3a', '&#X3a'],
];

test('F35-6: every separator spelling is read, on both entry points', () => {
  for (const [name, separator] of SEPARATORS) {
    for (const [shape, value] of [['a bare token', CRED], ['a scheme value', 'Basic dXNlcjpwYXNz'],
      ['a quoted token', '"' + CRED + '"']]) {
      const text = 'authorization' + separator + ' ' + value;
      const out = redactSecrets(text, []);
      assert.equal(out.includes(CRED), false,
        name + ' / ' + shape + ' published the credential: ' + JSON.stringify(out));
      assert.equal(redactCredentialShapes(text), out,
        name + ' / ' + shape + ' split the two entry points: ' + JSON.stringify(out));
      assert.equal(redactSecrets(out, []), out,
        name + ' / ' + shape + ' is not a fixed point');
    }
  }
});

test('F35-6: the separator reads the value exactly as the ASCII colon does', () => {
  // The widened spellings are not a second rule: for every value shape the run of text after the
  // separator is read the way the ASCII colon's is, so one row per separator must equal the ASCII
  // row byte for byte.
  // Credential-bearing values only: a PROSE value behind an ENTITY spelling is the recorded bound
  // pinned by the test below (the entity puts digits inside the name's own run), so the equality
  // rows here are the ones the class is for.
  const VALUES = ['tok_' + '9f3a2c7d1e5b', 'Basic dXNlcjpwYXNz', 'username="u" response="deadbeef1234"',
    '"' + 'tok_' + '9f3a2c7d1e5b' + '"'];
  for (const [name, separator] of SEPARATORS) {
    for (const value of VALUES) {
      const out = redactSecrets('authorization' + separator + ' ' + value, []);
      // The separator itself is the only text that may differ: normalize it and the two rows must
      // be byte-identical, which is what 'read exactly as the ASCII colon does' means.
      assert.equal(out.replace(separator, ':'), redactSecrets('authorization: ' + value, []),
        name + ' read the value differently from the ASCII colon for ' + JSON.stringify(value)
        + ': ' + JSON.stringify(out));
    }
    // The non-entity spellings leave the notice's source label and its diagnosis byte for byte.
    // The entity spellings are the recorded bound pinned below: the name's own run carries the
    // reference's digits, so the label is reaped and the diagnosis beside it is not.
    if (!name.startsWith('entity') && !name.includes('reference')) {
      const notice = 'rss https://a.example/x?p=authorization' + separator + ' HTTP 503 for https://a.example/x';
      assert.equal(redactSecrets(notice, []), notice,
        name + ' deformed a notice diagnosis: ' + JSON.stringify(redactSecrets(notice, [])));
    }
  }
});

test('F35-6: the recorded bound for a PROSE value behind an entity spelling (pre-existing, unmoved)', () => {
  // The declined-value scan reads the value's runs with the module's own shape test, and an entity
  // spelling of the separator puts digits INSIDE the header name's own run: 'authorization&#58' is
  // long enough and carries digits, so a prose value behind it loses the name and keeps the prose.
  // Measured byte for byte at HEAD (861aeb0) and unchanged by this batch, which is why it is pinned
  // here as a bound rather than claimed for the widened class. The non-entity spellings carry no
  // digits, so their prose values are published whole.
  for (const [separator, expected] of [['&#58;', '[redacted]; the run covered 43 domains'],
    ['&#x3A;', '[redacted]; the run covered 43 domains']]) {
    const text = 'authorization' + separator + ' the run covered 43 domains';
    assert.equal(redactSecrets(text, []), expected,
      'the recorded bound moved for ' + JSON.stringify(separator) + ': ' + JSON.stringify(redactSecrets(text, [])));
  }
  for (const [name, separator] of SEPARATORS.filter(([n2]) => !n2.startsWith('entity') && !n2.includes('reference'))) {
    const text = 'authorization' + separator + ' the run covered 43 domains';
    assert.equal(redactSecrets(text, []), text,
      name + ' reaped a prose value: ' + JSON.stringify(redactSecrets(text, [])));
  }
  // The same bound beside a notice: the SOURCE LABEL's name run is reaped, and the status and the
  // cause the module protects survive byte for byte. Measured identically at HEAD (861aeb0).
  for (const diagnose of ['HTTP 503 for https://a.example/x',
    'request failed for https://a.example/x: could not resolve the host (curl exit 6)']) {
    const notice = 'rss https://a.example/x?p=authorization&#58; ' + diagnose;
    assert.equal(redactSecrets(notice, []), 'rss https://a.example/x?p=[redacted]; ' + diagnose,
      'the entity-spelling bound moved: ' + JSON.stringify(redactSecrets(notice, [])));
  }
});

test('F35-6: the widened class does not reap ordinary prose that carries these characters', () => {
  // The other direction, measured over the repository's own text as well (0 of 28,884 lines changed
  // by this class). Each row here is byte-identical on both entry points.
  const PROSE = [
    'a vertical separator' + String.fromCharCode(0xFE13) + 'stands alone',
    'a two-dot leader' + String.fromCharCode(0x205A) + 'ends the paragraph',
    'an armenian sentence ends here' + String.fromCharCode(0x589) + 'and another begins',
    'the ratio 3' + String.fromCharCode(0x2236) + '1 is written with the ratio character',
    'a modifier letter' + String.fromCharCode(0xA789) + 'inside a word',
    'a triangular colon' + String.fromCharCode(0x2D0) + 'in a phonetic spelling',
    'an ethiopic wordspace' + String.fromCharCode(0x1361) + 'between two words',
    'an entity spelled in prose: &#58; and &#x3A;',
    'the run covered 43 domains' + LF + 'and merged 0 items',
    'the header below names nothing',
  ];
  for (const text of PROSE) {
    assert.equal(redactSecrets(text, []), text,
      'ordinary prose was rewritten: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text,
      'the shape path rewrote ordinary prose: ' + JSON.stringify(redactCredentialShapes(text)));
  }
});

test('F35-6: the recorded bounds -- a reference that runs on, and a named reference with no semicolon', () => {
  // '&#580;' is U+0244 and '&#x3A0;' is U+03A0; neither is this separator, so the text stands. The
  // named reference without its semicolon is not in HTML's legacy list, so it is not read either.
  for (const separator of ['&#580;', '&#x3A0;', '&#580', '&#x3a0;', '&colon']) {
    const text = 'authorization' + separator + ' ' + CRED;
    assert.equal(redactSecrets(text, []), text,
      'a reference that is not this separator was read as one: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text,
      'the two entry points disagree about ' + JSON.stringify(separator));
  }
});
