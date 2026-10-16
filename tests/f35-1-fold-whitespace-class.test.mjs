// tests/f35-1-fold-whitespace-class.test.mjs
// Closing sweep F35-1 (Medium, pre-existing at ded9b8c and at c241163; the class Batch 69 left).
// The clause that decides whether the next line is the value's own wrapped continuation says the
// fold's mark is THE INDENTATION and nothing else, but the class it read was '[\t \u00a0]' -- tab,
// space, no-break space. Every other whitespace a surface indents with therefore failed the read,
// the fold returned the previous line's end, and a credential the module's own shape test calls one
// was published byte for byte on BOTH entry points. The eight spellings measured leaking were form
// feed U+000C, vertical tab U+000B, U+3000 (the CJK indentation character), U+2003, U+202F, U+1680,
// U+205F and U+FEFF.
//
// The class is now every character JavaScript's \s matches EXCEPT the four line terminators, which
// is the whole of "the whitespace a value carries on its own line": U+0009, U+000B, U+000C, U+0020,
// U+00A0, U+1680, U+2000..U+200A, U+202F, U+205F, U+3000 and U+FEFF. U+2028 and U+2029 are excluded
// with U+000A and U+000D because they ARE line terminators: a header value is one line, and the
// reader's own line terminator is unchanged.
//
// Both directions are pinned here. The first test is the leak direction: for every spelling, every
// listed head and every continuation shape, the credential is gone on both entry points. The second
// is the ordinary-prose direction: the same characters standing in text that names no header, and
// the same characters standing in a continuation the reader declines, are published byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const TOKEN = 'tok_' + '9f3a2c7d1e5b';
const HEX = 'deadbeef1234';

// Every indentation spelling a surface writes, the eight this sweep measured included.
const INDENTS = [
  ['space', ' '], ['tab', String.fromCharCode(9)], ['no-break space', String.fromCharCode(0xA0)],
  ['form feed U+000C', String.fromCharCode(0xC)], ['vertical tab U+000B', String.fromCharCode(0xB)],
  ['U+3000', String.fromCharCode(0x3000)], ['U+2003', String.fromCharCode(0x2003)],
  ['U+202F', String.fromCharCode(0x202F)], ['U+1680', String.fromCharCode(0x1680)],
  ['U+205F', String.fromCharCode(0x205F)], ['U+FEFF', String.fromCharCode(0xFEFF)],
  ['U+2000', String.fromCharCode(0x2000)], ['U+200A', String.fromCharCode(0x200A)],
  ['space + form feed', ' ' + String.fromCharCode(0xC)],
  ['no-break space + tab', String.fromCharCode(0xA0) + String.fromCharCode(9)],
];
const HEADS = [
  ['a scheme head', 'authorization: Basic dXNlcjpwYXNzd29yZA=='],
  ['a shaped head', 'authorization: ' + TOKEN],
  ['an attribute head', 'authorization: Digest username="u"'],
  ['a prose head', 'authorization: see the notes'],
];
// The continuation shapes the leak was measured with, plus the separator-led shapes the fold reads.
const CONTINUATIONS = [
  ['a bare token', TOKEN], ['an attribute', 'response="' + HEX + '"'],
  ['a comma-led token', ',' + TOKEN], ['a semicolon-led token', ';' + TOKEN],
  ['a JSON body', '{ "token": "' + HEX + '" }'], ['a bare hex run', HEX],
];

test('F35-1: every indentation spelling folds, on both entry points', () => {
  let rows = 0;
  for (const [name, indent] of INDENTS) {
    for (const [headName, head] of HEADS) {
      for (const [contName, continuation] of CONTINUATIONS) {
        for (const terminator of [LF, CRLF]) {
          const text = head + terminator + indent + continuation;
          rows += 1;
          const out = redactSecrets(text, []);
          const shapes = redactCredentialShapes(text);
          for (const secret of [TOKEN, HEX]) {
            assert.equal(out.includes(secret), false,
              name + ' / ' + headName + ' / ' + contName + ' published a credential: ' + JSON.stringify(out));
            assert.equal(shapes.includes(secret), false,
              name + ' / ' + headName + ' / ' + contName + ' published a credential on the shape path: '
              + JSON.stringify(shapes));
          }
          assert.equal(shapes, out, 'the two entry points disagree about ' + name + ' / ' + headName);
          assert.equal(redactSecrets(out, []), out, 'the fold rewrite is not a fixed point: ' + JSON.stringify(out));
        }
      }
    }
  }
  assert.equal(rows, INDENTS.length * HEADS.length * CONTINUATIONS.length * 2,
    'the fold corpus changed size: ' + rows);
});

test('F35-1: the same characters in ordinary text are published byte for byte', () => {
  // The other direction: the class widened, so a text that names no credential header must not be
  // touched, whatever whitespace it carries. Each row is byte-identical on both entry points.
  const PROSE = [
    'the menu' + String.fromCharCode(0x3000) + 'lists three domains',
    'the page break' + String.fromCharCode(0xC) + 'stands between two sections',
    'a vertical tab' + String.fromCharCode(0xB) + 'inside a sentence',
    'a no-break space' + String.fromCharCode(0xA0) + 'between two words',
    'a byte order mark' + String.fromCharCode(0xFEFF) + 'inside a word',
    'authorization' + LF + 'the next line is a different field',
    'the header below names nothing',
    'authorization: see' + String.fromCharCode(0x3000) + 'the notes for the schedule',
    TOKEN + LF + 'a credential standing alone is a property of the corpus',
  ];
  for (const text of PROSE) {
    assert.equal(redactSecrets(text, []), text,
      'ordinary text carrying a widened whitespace character was rewritten: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text,
      'the shape path rewrote ordinary text: ' + JSON.stringify(redactCredentialShapes(text)));
  }
});

test('F35-1: a declined continuation keeps every word the widened fold now takes', () => {
  // A prose head with an indented PROSE continuation: the fold takes the line, the reader declines
  // the value, and the declined branch removes only a credential-shaped run. The words stay.
  for (const [name, indent] of INDENTS) {
    for (const [contName, continuation] of [['a prose line', 'the run covered 43 domains'],
      ['a status line', 'HTTP 503 for the release listing'], ['a prose line with a shaped word', 'the token ' + TOKEN]]) {
      const text = 'authorization: see the notes' + LF + indent + continuation;
      const out = redactSecrets(text, []);
      assert.equal(out.includes(TOKEN), false, name + ' / ' + contName + ' published the shaped word');
      assert.equal(out.includes('see the notes'), true, name + ' / ' + contName + ' reaped the declined head');
      assert.equal(redactCredentialShapes(text), out, name + ' / ' + contName + ' split the two entry points');
    }
  }
});

test('F35-1: the recorded bound is unmoved -- an unindented next line is still another field', () => {
  // The widening adds whitespace characters to the FOLD's class. It must not fold a line that has no
  // indentation at all: that is the limit the corpus records, and it is not this defect.
  const text = 'authorization: Digest username="u"' + LF + TOKEN;
  assert.equal(redactSecrets(text, []), '[redacted]' + LF + TOKEN,
    'the widening folded an unindented next line');
  for (const [name, indent] of INDENTS) {
    const blank = 'authorization: Digest username="u"' + LF + indent + LF + 'ordinary prose';
    assert.equal(redactSecrets(blank, []), '[redacted]' + LF + indent + LF + 'ordinary prose',
      name + ' made an indented blank line a continuation');
  }
});
