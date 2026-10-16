// tests/f36-2-line-terminators.test.mjs
// Closing sweep F36-2 (Medium) and F36-6 (Low), the same boundary read two ways. The module's
// LINE_TERMINATOR was /\r\n|\n|\r/, so U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR --
// ECMAScript LineTerminator productions and Unicode categories Zl/Zp -- and U+0085 NEXT LINE, which
// is White_Space=Yes, were not line ends. authorizationValueLineEndsAt walks from the value and asks
// that set; when it found none it returned source.length, so an ACCEPTED header's value became the
// whole rest of the document and the accepted branch replaced that whole span with the redaction.
// Measured on both entry points and identically at 861aeb0: 'authorization: tok_...' + U+2028 + 'the
// run covered 43 domains and merged 0 items' came back as '[redacted]' alone -- the tail of the
// document was deleted rather than kept. The token class had the same hole for U+0085 alone, because
// JavaScript's \s is four line terminators and NEL is not one of them, so a bare token could span
// the NEL and put the value's end past the line end before the walk was asked.
//
// Batch 85 gives the module ONE boundary (AUTH_LINE_TERMINATORS) and reads it everywhere the code
// means 'the end of this line': the value's run, the token class, and the whitespace the attribute
// list's own separator may cross. The property asserted here is the one the finding names -- the three
// characters answer exactly as LF does, on every shape the reader has -- rather than a set of
// hand-written outputs that would drift from LF's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const CRLF = CR + LF;
const CRED = 'tok_' + '9f3a2c7d1e5b';
const TAIL = 'the run covered 43 domains and merged 0 items';
// The three characters the sweep measured, beside the four the module already read.
const SEPARATORS = [['U+2028 LINE SEPARATOR', String.fromCharCode(0x2028)],
  ['U+2029 PARAGRAPH SEPARATOR', String.fromCharCode(0x2029)],
  ['U+0085 NEXT LINE', String.fromCharCode(0x85)]];

test('F36-2: a header value ends at LS, PS and NEL, so the document after it survives', () => {
  for (const [name, separator] of SEPARATORS) {
    const text = 'authorization: ' + CRED + separator + TAIL;
    // The accepted value is the header's own line, and only that line: the tail the document carried
    // after the line end is not a header value and must be published byte for byte.
    assert.equal(redactSecrets(text, []), '[redacted]' + separator + TAIL,
      name + ' consumed the rest of the document: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), redactSecrets(text, []),
      'the two entry points disagree about ' + name);
  }
});

test('F36-2: every shape the reader has answers for LS, PS and NEL exactly as it does for LF', () => {
  // Four shapes, and the assertion is EQUALITY WITH LF rather than a written-out answer: the finding
  // is that these characters are line ends, so the only thing to pin is that they are
  // indistinguishable from the line end the module always read. The shapes are an accepted value with
  // a document after it, a prose value with a credential on the next line (the line rule: a value is
  // one line, so what stands on the next line is not that value), an INDENTED continuation (the
  // obs-fold, which must still fold), and an attribute list wrapped after the terminator.
  const shapes = [
    (s) => 'authorization: ' + CRED + s + TAIL,
    (s) => 'authorization: tok_x' + s + CRED,
    (s) => 'authorization: tok_x' + s + '  ' + CRED,
    (s) => 'authorization: Credential=x,' + s + 'Signature=' + CRED,
  ];
  // The answer is compared with the SEPARATOR IT CARRIES normalised back to LF, so the comparison is
  // about where the reader put the boundary and not about which character wrote it.
  const asLf = (text, separator) => text.split(separator).join(LF);
  for (const shape of shapes) {
    const want = redactSecrets(shape(LF), []);
    for (const [name, separator] of SEPARATORS.concat([['CR', CR], ['CRLF', CRLF]])) {
      assert.equal(asLf(redactSecrets(shape(separator), []), separator), want,
        name + ' is not read as the line end LF is, on shape ' + JSON.stringify(shape('<SEP>')));
      assert.equal(asLf(redactCredentialShapes(shape(separator)), separator), want,
        'the two entry points disagree about ' + name);
    }
  }
});

test('F36-6: the fold stops at the same boundary, and a line end is not an indentation', () => {
  // The fold's indentation class is built from AUTH_INLINE_SPACE, whose complement among the
  // whitespace-and-line-end characters is exactly AUTH_LINE_TERMINATORS, so no line end is an
  // indentation: an indented continuation may be indented only with whitespace that is not one.
  for (const [name, separator] of SEPARATORS) {
    // An INDENTED line after the terminator continues the value and its credential is read.
    const folded = 'authorization: tok_x' + separator + '  ' + CRED;
    assert.equal(redactSecrets(folded, []).split(separator).join(LF),
      redactSecrets('authorization: tok_x' + LF + '  ' + CRED, []),
      name + ' did not fold an indented continuation the way LF does');
    // The character ITSELF is a line end, not an indentation: a token standing where the indentation
    // would have to be is the next line's own content, exactly as it is behind LF (the recorded
    // direction, and the same answer LF gives for 'authorization: x' + LF + LF + CRED).
    const unindented = 'authorization: x' + LF + separator + CRED;
    assert.equal(redactSecrets(unindented, []).split(separator).join(LF),
      redactSecrets('authorization: x' + LF + LF + CRED, []),
      name + ' is not read as a line end where the fold looks for an indentation');
  }
});

test('F36-2: prose that merely carries these characters is byte-identical', () => {
  for (const [name, separator] of SEPARATORS) {
    const text = 'the run covered 43 domains' + separator + 'and merged 0 items';
    assert.equal(redactSecrets(text, []), text, name + ' rewrote prose: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text, 'the shape path rewrote prose carrying ' + name);
  }
});
