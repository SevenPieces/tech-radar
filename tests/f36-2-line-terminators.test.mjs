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
// The row below (F37-1, Batch 86) is the shape that sentence was missing: the KEYWORD's own bridging
// whitespace was still JavaScript's '\s', which does not contain U+0085, so a value position that IS
// a NEL published the credential where LF removed it. It is pinned at both bridge positions -- the
// value position itself, and the scheme token's gap -- and against LF's own answer.
// Closing sweep F38-1 (Medium, Batch 88) is the same sentence false at the two GENERIC keyword rules
// the F37-1 row does not reach: redactBasicCredentials' own gap and its second half inside
// decodedBasicToken, and the one generic Bearer rule's gap and value run. Their rows stand with the
// F37-1 row below, on the same equality-with-LF property and through both entry points.
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

test('F37-1: a value position that IS the terminator answers exactly as LF does, at both bridge positions', () => {
  // The value position IS the terminator: the header name is followed by the line end itself, with no
  // inline space between them. Batch 85 gave the value's run and the token class one boundary, but the
  // KEYWORD's trailing whitespace and the scheme token's gap were still JavaScript's '\s', which is
  // every character of AUTH_INLINE_SPACE plus LS and PS -- and NOT U+0085. A NEL therefore stood where
  // neither the keyword nor the token class could read it, readAuthorizationValue returned null, and
  // the null branch published the match and the credential: measured at c8beb59 on both entry points,
  // 'authorization:' + U+0085 + CRED came back byte for byte while LF, CR, LS and PS removed it, and
  // 'authorization: Basic' + U+0085 + CRED published the scheme's token. The bridge the keyword reads
  // is now AUTH_BRIDGE_SPACE -- AUTH_INLINE_SPACE plus the same five terminators -- so the two
  // positions below are indistinguishable from LF's. This is the row Batch 85's file was missing: its
  // sentence was broader than the shapes it built, and the suite stayed green while it was false.
  const shapes = [
    // (1) the value position itself is the terminator,
    (s) => 'authorization:' + s + CRED,
    (s) => 'authorization: ' + s + CRED,
    // (2) the scheme's own token stands behind it (the NEXT_AUTH_TOKEN gap),
    (s) => 'authorization: Basic' + s + CRED,
    (s) => 'authorization: Bearer ' + s + CRED,
    // (3) every name spelling and a non-ASCII colon, so the bridge is not read by the value reader's
    //     widened separator alone.
    (s) => 'HTTP_AUTHORIZATION:' + s + CRED,
    (s) => 'authorisation:' + s + CRED,
  ];
  const asLf = (text, separator) => text.split(separator).join(LF);
  for (const shape of shapes) {
    const want = redactSecrets(shape(LF), []);
    // The row is only load-bearing if LF's own answer removes the credential: an equality against LF
    // would pass vacuously if LF published it too. (LF's answer is not always bare '[redacted]' --
    // 'authorization: Bearer ' + LF + CRED keeps its keyword and loses the scheme with its value, the
    // F32-1 reading -- so the property asserted is that the credential is gone, not a fixed shape.)
    assert.ok(!want.includes(CRED), 'LF is not the removal on ' + JSON.stringify(shape('<SEP>')) + ': ' + JSON.stringify(want));
    for (const [name, separator] of [['CR', CR], ['CRLF', CRLF]].concat(SEPARATORS)) {
      assert.equal(asLf(redactSecrets(shape(separator), []), separator), want,
        name + ' at the value position is not read as the line end LF is: ' + JSON.stringify(redactSecrets(shape(separator), [])));
      assert.equal(asLf(redactCredentialShapes(shape(separator)), separator), want,
        'the two entry points disagree about ' + name + ' at the value position');
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

// Closing sweep F38-1 (Medium) and Batch 88, the same boundary at the two GENERIC keyword rules. The
// F37-1 row above is scoped to the two positions Batch 86 moved -- the authorization keyword's own
// bridging whitespace and the scheme token's gap -- and both sentences this file opens with ('one
// boundary, read everywhere the code means the end of this line'; 'every shape the reader has') were
// still false for two other rules in the same shape pipeline: redactBasicCredentials' own gap
// (/^\s+/ on the text after 'Basic') and its second half, the base64 run's leading gap inside
// decodedBasicToken (/^\s*/, which is why 'Basic' + SP + NEL + <base64> failed even with the first
// gap read), and the ONE generic Bearer rule's gap and value run (BEARER_VALUE). JavaScript's \s is
// exactly AUTH_INLINE_SPACE + CR/LF/LS/PS and NOT U+0085, so 'auth=Basic' + NEL + <base64> and
// 'Bearer' + NEL + <token> were PUBLISHED byte for byte at 87bddfd on both entry points -- and
// redactCredentialShapes is the shipped keyless candidate pass (collect.mjs runs it over every string
// field of every candidate), so a feed title, summary or release body carrying that spelling reached
// the published pool and digest where LF, CR, CRLF, LS, PS and all eight inline spellings removed it.
// The assembled notice published it readably and the notice's own C1 neutralisation then DROPPED the
// NEL, gluing 'Basic' to the blob, so no later pass ever removed it.
// Batch 88 reads AUTH_BRIDGE_SPACE at all four positions: the property asserted is once again
// equality with LF's own answer, on the shapes the two rules have, through BOTH entry points.
test('F38-1: the two generic keyword rules answer for NEL exactly as they do for LF', () => {
  const B64 = Buffer.from('alice:' + 's3cr3tp4ssw0rd').toString('base64');
  const shapes = [
    // the Basic keyword's own gap ...
    (s) => 'auth=Basic' + s + B64,
    // ... and its second half: the caller's gap consumes the inline space, so the run's own leading
    // gap is the one that has to read the NEL (decodedBasicToken).
    (s) => 'auth=Basic ' + s + B64,
    // the shipped keyless candidate pass, over a candidate-shaped field.
    (s) => 'release notes: auth=Basic' + s + B64 + ' shipped',
    // the one generic Bearer rule: its gap ...
    (s) => 'Bearer' + s + CRED,
    (s) => 'bearer' + s + CRED,
    (s) => 'Bearer ' + s + CRED,
    // ... and its value run's own boundary, so a NEL is a line end there too and the run cannot
    // swallow the text on the next line.
    (s) => 'Bearer' + s + CRED + s + 'the run covered 43 domains',
    (s) => 'commit msg: Bearer' + s + CRED + ' (rotated)',
  ];
  const asLf = (text, separator) => text.split(separator).join(LF);
  for (const shape of shapes) {
    const want = redactSecrets(shape(LF), []);
    // Load-bearing: an equality against LF would pass vacuously if LF published the credential too.
    assert.ok(!want.includes(CRED) && !want.includes(B64),
      'LF is not the removal on ' + JSON.stringify(shape('<SEP>')) + ': ' + JSON.stringify(want));
    for (const [name, separator] of [['CR', CR], ['CRLF', CRLF]].concat(SEPARATORS)) {
      const got = redactSecrets(shape(separator), []);
      assert.ok(!got.includes(CRED) && !got.includes(B64),
        name + ' publishes the credential on ' + JSON.stringify(shape('<SEP>')) + ': ' + JSON.stringify(got));
      assert.equal(asLf(got, separator), want,
        name + ' is not read as the line end LF is, on ' + JSON.stringify(shape('<SEP>')) + ': ' + JSON.stringify(got));
      assert.equal(asLf(redactCredentialShapes(shape(separator)), separator), want,
        'the two entry points disagree about ' + name + ' on ' + JSON.stringify(shape('<SEP>')));
    }
  }
});

test('the recorded residual: a NEL at the value position still answers for the scaffold', () => {
  // RECORDED RATHER THAN CLOSED. A value position that IS the terminator answers as LF does only
  // while the line carries no scaffold: the module's own diagnosis ('HTTP 503', a mapped transport
  // cause) is masked as a span and restored after the pass, and the two spellings reach that span
  // through different branches of the value reader. With a span in the line the NEL spelling falls
  // to the reader's null branch -- the whole matched region is consumed, span and all -- while the
  // LF spelling consumes only the value and keeps the keyword beside it. Measured first-hand at the
  // tip: 'authorization:' + NEL + CRED + ' HTTP 503' answers '[redacted] HTTP 503' where the same
  // line with LF answers 'authorization:' + LF + '[redacted] HTTP 503'.
  //
  // This is the same shape the closing sweep measured as NEL-versus-LF parity violations in the
  // scaffold class, and it is NOT F38-1's class (that one PUBLISHED the credential and is closed).
  // Here the credential is removed on BOTH spellings and on BOTH entry points; what differs is the
  // surrounding text, and what is at stake is the notice diagnosis on the NEL spelling alone. The
  // reach is therefore the module surface and the assembled notice for a NEL-spelling value
  // position, and NOT the shipped collector: plainText normalises the NEL to the inline space
  // before a candidate field is formed, so no shipped keyless path reaches this spelling. It is
  // pinned here so a later pass cannot close it silently or regress it the other way.
  const span = ' HTTP 503';
  const nelLine = 'authorization:' + SEPARATORS.find(([n]) => n === 'U+0085 NEXT LINE')[1] + CRED + span;
  const lfLine = 'authorization:' + LF + CRED + span;
  // The credential is removed and the status survives on both spellings.
  assert.ok(!redactSecrets(nelLine, []).includes(CRED), 'the NEL spelling published the credential');
  assert.ok(!redactSecrets(lfLine, []).includes(CRED), 'the LF spelling published the credential');
  assert.ok(redactSecrets(nelLine, []).includes('HTTP 503'), 'the NEL spelling lost the status');
  assert.ok(redactSecrets(lfLine, []).includes('HTTP 503'), 'the LF spelling lost the status');
  // The two ENTRY POINTS agree with each other on the NEL spelling ...
  const nel = redactSecrets(nelLine, []);
  assert.equal(redactCredentialShapes(nelLine), nel, 'the two entry points disagree about the NEL spelling');
  // ... and the divergence is NEL against LF alone, which is the recorded residual.
  assert.equal(nel, '[redacted]' + span, 'the recorded NEL answer moved: ' + JSON.stringify(nel));
  assert.equal(redactSecrets(lfLine, []), 'authorization:' + LF + '[redacted]' + span,
    'the recorded LF answer moved: ' + JSON.stringify(redactSecrets(lfLine, [])));
});

test('F36-2: prose that merely carries these characters is byte-identical', () => {
  for (const [name, separator] of SEPARATORS) {
    const text = 'the run covered 43 domains' + separator + 'and merged 0 items';
    assert.equal(redactSecrets(text, []), text, name + ' rewrote prose: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text, 'the shape path rewrote prose carrying ' + name);
  }
});
