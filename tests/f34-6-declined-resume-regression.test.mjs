// tests/f34-6-declined-resume-regression.test.mjs
// Independent regression test for F34-6 (Medium, pre-existing at c241163 and at ded9b8c): the
// header pass stopped at the first header line it DECLINED and left unchanged. The resume point
// ('at') was moved only by a branch that fired, and the pass asks for its next match with
// earliestAfter(match.index, at), which answers only with a match whose index is strictly greater
// than the index it is given -- so the pass asked for a match after the one it had just read, got
// null, and ended. ONE prose header line therefore silenced the authorization rule for the whole
// rest of the text, and a credential header on any later line was published byte for byte on BOTH
// entry points, for 11 of the 11 keyword spellings. Batch 74 publishes the declined match unchanged
// and moves the resume point to its end, so every later header in the same text is still read.
//
// The controls below name the mechanism: the rows cleaned by ANOTHER rule (the Basic rule, the
// curated shape list) or by the scaffold branch are not evidence that this pass resumes, and the
// ordinary-prose rows and the notice-diagnosis rows must be byte-identical, because the repair
// advances the resume point and must not consume or deform anything the declined reading kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleNotice } from '../scripts/collect.mjs';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const CRED = 'tok_' + '9f3a2c7d1e5b';

// Each of these carries a header the reader DECLINES (ordinary prose) on one line and a real
// credential header on a later one. The declined line must not silence the rule.
const LEAKING = [
  ['a prose header line, then a credential header', 'authorization: see the notes' + LF + 'authorization: ' + CRED],
  ['the same with a CR terminator', 'authorization: see the notes' + CR + 'authorization: ' + CRED],
  ['two declined lines, then a credential header',
    'authorization: see the notes' + LF + 'authorization: read-only' + LF + 'authorization: ' + CRED],
  ['a declined line, an ordinary prose line, then a credential header',
    'authorization: see the notes' + LF + 'the run covered 43 domains' + LF + 'authorization: ' + CRED],
  ['a declined line, then a credential-shaped value with no keyword',
    'authorization: see the notes' + LF + 'x-authorization: ' + CRED],
];
// Rows another rule cleans, or that were already clean: they are not evidence that THIS pass
// resumes, so they are asserted as fixed behaviour rather than as the repair.
const CONTROLS = [
  ['the two headers on ONE line', 'authorization: see the notes and authorization: ' + CRED, true],
  ['a prose line, then a Basic header', 'authorization: required for this feed' + LF + 'Authorization: Basic dXNlcjpwYXNz', true],
  ['a prose line, then a curated shape', 'authorization: read-only' + LF + 'Authorization: Bearer gh' + 'p_AAAA1111bbbb2222', true],
];
// The keyword spellings the module reads. A prose line before ANY of them must not silence the rule.
const SPELLINGS = ['authorization: ', 'Authorization: ', 'authorisation: ', 'HTTP_AUTHORIZATION: ',
  'X_AUTHORIZATION: ', 'proxy-authorization: ', 'PROXY_AUTHORISATION: ', 'authorization&#58; ',
  'authorization&colon; ', 'authorization&#x3A; ', 'authorization' + String.fromCharCode(0xFF1A)];

test('F34-6: a declined header line does not silence the rule for a later credential header', () => {
  for (const [label, text] of LEAKING) {
    for (const [path, out] of [['redactSecrets', redactSecrets(text, [])], ['redactCredentialShapes', redactCredentialShapes(text)]]) {
      assert.equal(out.includes(CRED), false,
        'the credential on a later line survived on ' + path + ' (' + label + '): ' + JSON.stringify(out));
    }
    const out = redactSecrets(text, []);
    assert.equal(redactSecrets(out, []), out, 'the repair is not a fixed point: ' + JSON.stringify(out));
    assert.equal(redactCredentialShapes(text), out, 'the two entry points disagree: ' + JSON.stringify(out));
  }
});

test('F34-6: every keyword spelling is still read after a declined line', () => {
  for (const kw of SPELLINGS) {
    const text = 'authorization: see the notes' + LF + kw + CRED;
    assert.equal(redactSecrets(text, []).includes(CRED), false,
      'the spelling was silenced by the declined line: ' + JSON.stringify(kw));
    assert.equal(redactCredentialShapes(text).includes(CRED), false,
      'the spelling was silenced on the credential-free path: ' + JSON.stringify(kw));
  }
});

test('F34-6: the branch that fires and the branches that already moved the resume point still do', () => {
  for (const [label, text, credential] of CONTROLS) {
    const out = redactSecrets(text, []);
    assert.equal(out.includes(credential), false,
      'the control row published its credential (' + label + '): ' + JSON.stringify(out));
    assert.equal(redactCredentialShapes(text), out,
      'the two entry points disagree about the control row (' + label + ')');
  }
});

test('F34-6: a declined header line is published unchanged, with or without a later header', () => {
  // The repair publishes the declined match and advances the resume point. It must not consume,
  // lengthen or reorder the text it declines: every row here is byte-identical.
  const PROSE = [
    'authorization: see the notes',
    'authorization: see the notes' + LF + 'authorization: read-only',
    'authorization: see the notes' + LF + 'the run covered 43 domains and merged 0 items',
    'authorization: required for this feed',
    'authorization: a failure with no message',
    'authorization: "HTTP 503"',
    'rss https://a.example/authorization: request failed for x',
  ];
  for (const text of PROSE) {
    assert.equal(redactSecrets(text, []), text,
      'the declined reading was not published unchanged: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text,
      'the credential-free path reaped a declined reading: ' + JSON.stringify(redactCredentialShapes(text)));
  }
});

test('F34-6: the notice-diagnosis rows are unchanged at every cap', () => {
  // A source label ending in the bare word 'authorization' is followed by the assembly's own ': '
  // and the shaper's diagnosis. The resume-point repair must leave both diagnoses byte for byte,
  // at the shipped caps.
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
      }
    }
  }
});
