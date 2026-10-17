// tests/f35-2-unreadable-value-resume.test.mjs
// Closing sweep F35-2 (Medium, pre-existing at c241163 and at ded9b8c). Batch 74 moved the pass's
// resume point in the branch that DECLINED a value, and left the other exit where it stood: when
// 'readAuthorizationValue' returns null -- the value position is a ',' or a ';' the atom class
// cannot start -- the loop did 'if (value === null) continue' with 'at' unmoved, and its next
// question, earliestAfter(match.index, at), answers only with a match strictly after the index it
// is given. The pass then ended, and ONE 'authorization:,' silenced the whole rule for the rest of
// the text: a credential header on any later line was published byte for byte on both entry points,
// for 11 of the 11 keyword spellings.
//
// This file pins both halves of the repair. The resume point now advances past the header it read,
// so every later header in the same text is still read; and the separator-led value position is
// READ rather than declined, because the value position ',' or ';' also published the credential
// standing behind it at an unindented continuation and at space, tab and no-break-space
// indentation -- a publication the resume-point repair alone cannot reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleNotice } from '../scripts/collect.mjs';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const CRED = 'tok_' + '9f3a2c7d1e5b';
const HEX = 'deadbeef1234';

// A silencer line, then one or more real credential headers. The silencer's value position is the
// separator itself; everything after it must still be read.
const SILENCERS = [
  ['comma then a header', 'authorization:,' + LF + 'authorization: ' + CRED],
  ['semicolon then a header', 'authorization:;' + LF + 'authorization: ' + CRED],
  ['comma and a word on its own line', 'authorization:, see the notes' + LF + 'authorization: ' + CRED],
  ['semicolon and a word on its own line', 'authorization:; see the notes' + LF + 'authorization: ' + CRED],
  ['space then comma', 'authorization: ,' + LF + 'authorization: ' + CRED],
  ['comma then the British spelling', 'authorization:,' + LF + 'authorisation: ' + CRED],
  ['comma then the underscored spelling', 'authorization:,' + LF + 'HTTP_AUTHORIZATION: ' + CRED],
  ['comma then the entity-colon spelling', 'authorization:,' + LF + 'authorization&#58; ' + CRED],
  ['comma then a CRLF-separated header', 'authorization:,' + CRLF + 'authorization: ' + CRED],
  ['comma, a header, prose, and a second header',
    'authorization:,' + LF + 'authorization: ' + CRED + LF + 'x: y' + LF + 'authorization: ' + HEX],
];

test('F35-2: a value the reader cannot start does not silence the rule for the rest of the text', () => {
  for (const [label, text] of SILENCERS) {
    const out = redactSecrets(text, []);
    const shapes = redactCredentialShapes(text);
    for (const secret of [CRED, HEX]) {
      assert.equal(out.includes(secret), false,
        'a later header published its credential on the credential-free path (' + label + '): ' + JSON.stringify(out));
      assert.equal(shapes.includes(secret), false,
        'a later header published its credential on the shape path (' + label + '): ' + JSON.stringify(shapes));
    }
    assert.equal(shapes, out, 'the two entry points disagree (' + label + '): ' + JSON.stringify(out));
    assert.equal(redactSecrets(out, []), out, 'the repair is not a fixed point (' + label + '): ' + JSON.stringify(out));
  }
});

test('F35-2: the separator-led value position is read, at every indentation spelling', () => {
  // The value position is the separator, and the credential stands behind it on the next line. The
  // atom class cannot START there, so this reader used to return null and the token was published.
  const INDENTS = ['  ', String.fromCharCode(9), String.fromCharCode(0xA0), String.fromCharCode(0xC),
    String.fromCharCode(0xB), String.fromCharCode(0x3000), String.fromCharCode(0x2003),
    String.fromCharCode(0x202F), ''];
  for (const indent of INDENTS) {
    for (const separator of [',', ';']) {
      for (const terminator of [LF, CRLF]) {
        const text = 'authorization:' + terminator + indent + separator + CRED;
        const out = redactSecrets(text, []);
        assert.equal(out.includes(CRED), false,
          'the separator-led value position published a credential: ' + JSON.stringify(out));
        assert.equal(redactCredentialShapes(text), out,
          'the two entry points disagree about ' + JSON.stringify(text));
      }
    }
  }
});

test('F35-2: the two spellings on ONE line are still read after a silencer', () => {
  for (const [label, text] of [
    ['comma, word, then a header on the SAME line', 'authorization:, see the notes and authorization: ' + CRED],
    ['semicolon, word, then a header on the SAME line', 'authorization:; see the notes and authorization: ' + CRED],
  ]) {
    const out = redactSecrets(text, []);
    assert.equal(out.includes(CRED), false, label + ' published the credential: ' + JSON.stringify(out));
    assert.equal(redactCredentialShapes(text), out, label + ' split the two entry points');
  }
});

test('F35-2: the silencer and the prose beside it are published byte for byte', () => {
  // The repair advances the resume point and reads a separator-led value. Neither may consume or
  // deform text the reader declines: every row here is byte-identical on both entry points.
  const PROSE = [
    'authorization:,',
    'authorization:;',
    'authorization:, see the notes',
    'authorization:; see the notes',
    'authorization: see the notes',
    'authorization:, see the notes' + LF + 'the run covered 43 domains',
    'authorization:,' + LF + 'the next line is ordinary prose',
    'a failure with no message',
  ];
  for (const text of PROSE) {
    assert.equal(redactSecrets(text, []), text,
      'the declined reading was not published unchanged: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text,
      'the shape path reaped a declined reading: ' + JSON.stringify(redactCredentialShapes(text)));
  }
});

test('F35-2: the notice-diagnosis rows keep their status and cause at every cap', () => {
  const SOURCES = ['github authorization', 'api.example.com authorization',
    'rss https://a.example/x?p=authorization', 'rss https://a.example/authorization'];
  const DIAGNOSES = [
    'HTTP 503 for https://a.example/x',
    'request failed for https://a.example/x: could not resolve the host (curl exit 6)',
  ];
  for (const cap of [128, 402, 1000]) {
    for (const source of SOURCES) {
      for (const detail of DIAGNOSES) {
        const notice = assembleNotice(source, detail, [], cap);
        assert.equal(notice, source + ': ' + detail,
          'the notice diagnosis moved at cap ' + cap + ' for ' + JSON.stringify(source) + ': ' + JSON.stringify(notice));
        assert.equal(redactSecrets(notice, []), notice,
          'the notice is not a fixed point: ' + JSON.stringify(notice));
        assert.equal(redactCredentialShapes(notice), notice,
          'the shape path is not a fixed point on the notice: ' + JSON.stringify(notice));
      }
    }
  }
});
