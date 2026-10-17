// tests/f35-5-fold-guard-position.test.mjs
// Closing sweep F35-5 (Low, test integrity). Batch 73 replaced the fold's keyword guard with sticky,
// position-tested matchers ('AUTHORIZATION_KEYWORDS_AT', 'authorizationKeywordStartsAt') so that a
// long folded value stops costing one full scan of the remainder per continuation line. The comment
// says the verdict 'is the one the index test made -- the same match, starting at the same
// position', and the sweep's mutant N13 -- restoring the pre-Batch-73 spelling, a GLOBAL matcher with
// no index test -- published a folded credential while the whole 699-test suite stayed green.
//
// What the global matcher changes: asked at position p, it answers 'is there a keyword ANYWHERE after
// p', so the fold stops at the FIRST continuation line of any text that later names a credential
// header, and the continuation -- where the wrapped credential stands -- is published. The rows below
// are whole-output assertions on exactly that text: the credential header first, its wrapped
// continuation second, and a later header somewhere after it. Each row fails if the fold's guard
// stops asking about THIS position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const LF = String.fromCharCode(10);
const CRED = 'tok_' + '9f3a2c7d1e5b';
const HEX = 'deadbeef1234';

// The later header is the discriminator: without it the global matcher's answer and the position
// test's answer agree. Four spellings of it, so the row cannot be bought by one matcher's absence.
const LATER = [
  ['a plain later header', 'authorization: ' + CRED],
  ['a later British header', 'authorisation: ' + CRED],
  ['a later underscored header', 'HTTP_AUTHORIZATION: ' + CRED],
  ['a later entity-colon header', 'authorization&#58; ' + CRED],
];

test('F35-5: a continuation whose line opens no keyword is folded, whatever the text names later', () => {
  for (const [label, later] of LATER) {
    for (const [headName, head] of [['a scheme head', 'authorization: Basic dXNlcjpwYXNzd29yZA=='],
      ['an attribute head', 'authorization: Digest username="u"']]) {
      for (const [contName, continuation, secret] of [
        ['an attribute continuation', '  response="' + HEX + '"', HEX],
        ['a bare-token continuation', '  ' + CRED, CRED],
        ['a tab-indented continuation', String.fromCharCode(9) + CRED, CRED],
      ]) {
        const text = head + LF + continuation + LF + LF + later;
        const out = redactSecrets(text, []);
        assert.equal(out.includes(secret), false,
          label + ' / ' + headName + ' / ' + contName + ' published the folded credential: ' + JSON.stringify(out));
        assert.equal(redactCredentialShapes(text), out,
          label + ' / ' + headName + ' / ' + contName + ' split the two entry points');
        assert.equal(redactSecrets(out, []), out,
          label + ' / ' + headName + ' / ' + contName + ' is not a fixed point');
      }
    }
  }
});

test('F35-5: the same fold with prose between the value and the later header', () => {
  // The discriminator is not adjacency: the later keyword only has to exist somewhere after the
  // continuation for a global matcher to answer 'yes' at that position.
  const rows = [
    ['a later header two lines on', 'authorization: Basic dXNlcjpwYXNz' + LF + '  response="' + HEX + '"'
      + LF + 'trailer: note' + LF + 'HTTP_AUTHORIZATION: ' + CRED],
    ['a later header after a blank line and prose',
      'authorization: Digest username="u"' + LF + '  ' + CRED + LF + LF + 'the run covered 43 domains'
      + LF + 'authorization: ' + HEX],
    ['three folded lines then the header',
      'authorization: a="1"' + LF + ' b="2"' + LF + ' ' + CRED + LF + 'authorization: ' + HEX],
  ];
  for (const [label, text] of rows) {
    for (const [name, redact] of [['the credential-free pass', (t) => redactSecrets(t, [])],
      ['the shape pass', (t) => redactCredentialShapes(t)]]) {
      const out = redact(text);
      assert.equal(out.includes(CRED), false,
        name + ' published the folded credential (' + label + '): ' + JSON.stringify(out));
      assert.equal(out.includes(HEX), false,
        name + ' published the later credential (' + label + '): ' + JSON.stringify(out));
      assert.equal(redact(out), out, name + ' is not a fixed point (' + label + '): ' + JSON.stringify(out));
    }
  }
});

test('F35-5: the guard still stops at a line that OPENS with a keyword', () => {
  // The other direction: the position test must keep reading a real next field as a field. These rows
  // are the corpus's own fold limit, pinned here beside the discriminator.
  const rows = [
    ['an indented next header', 'authorization: Digest username="u"' + LF + '  Authorization: Basic dXNlcjpwYXNz',
      '[redacted]' + LF + '  [redacted]'],
    ['an unindented next header', 'authorization: Digest username="u"' + LF + 'authorization: ' + CRED,
      '[redacted]' + LF + '[redacted]'],
  ];
  for (const [label, text, expected] of rows) {
    assert.equal(redactSecrets(text, []), expected,
      'the fold limit moved (' + label + '): ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), expected,
      'the two entry points disagree about the fold limit (' + label + ')');
  }
});
