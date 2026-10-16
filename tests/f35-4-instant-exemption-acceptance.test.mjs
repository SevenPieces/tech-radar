// tests/f35-4-instant-exemption-acceptance.test.mjs
// Closing sweep F35-4 (Low). Batch 75 made two things true of the declined-value scan: a token that
// IS an ISO-8601 instant is diagnosis vocabulary this module writes rather than a credential, and
// the closing bracket is not part of a token. The first clause was applied in exactly ONE place --
// 'consumeCredentialShapedTokens', which the declined and scaffold branches call -- while
// 'authorizationAtomIsShaped' kept calling the instant credential-shaped. A value whose second atom
// is the instant ('authorization: resets 2026-10-16T21:48:54.000Z') was therefore ACCEPTED as a
// credential header and consumed whole, so the notice's own reset stamp went with it in the branch
// the batch did not touch.
//
// Batch 79 applies the same anchored test in the acceptance path. The test is a test on a token that
// IS an instant: a token that merely begins with, ends with, is glued to or is joined to one is not
// exempt, and the rows at the bottom pin that bound rather than leaving it implicit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleNotice } from '../scripts/collect.mjs';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const STAMP = '2026-10-16T21:48:54.000Z';
const LATER = '2026-10-16T22:49:02.000Z';
const CRED = 'tok_' + '9f3a2c7d1e5b';
// The run's own rate-limit detail, byte for byte (collect.mjs's budgetNotice writes this sentence).
const PROD_DETAIL = 'rate limit reached (remaining 0 of 60, 2 held in reserve, resets ' + LATER
  + '); 29 tag listings not checked; set GITHUB_TOKEN to raise the limit';
const SOURCES = ['github authorization', 'api.example.com authorization',
  'rss https://a.example/x?p=authorization', 'rss https://a.example/authorization'];

test('F35-4: an instant standing in a value position is not accepted as a credential header', () => {
  // The rows the acceptance path consumed whole before Batch 79. Every one is published unchanged.
  const KEPT = [
    'authorization: resets ' + STAMP,
    'authorization: ' + STAMP,
    'authorization: ' + STAMP + ' old',
    'authorization: nothing inside the window ' + STAMP,
    'authorization: resets ' + STAMP + ' and 55 listings were not checked',
  ];
  for (const text of KEPT) {
    assert.equal(redactSecrets(text, []), text,
      'the acceptance path consumed an instant whole: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text,
      'the shape path consumed an instant whole: ' + JSON.stringify(redactCredentialShapes(text)));
  }
});

test('F35-4: a notice behind an authorization label keeps its own reset stamp at every cap', () => {
  for (const cap of [402, 1000]) {
    for (const source of SOURCES) {
      const notice = assembleNotice(source, PROD_DETAIL, [], cap);
      assert.equal(notice.includes('[redacted]'), false,
        'the acceptance path reaped the notice at cap ' + cap + ': ' + JSON.stringify(notice));
      assert.equal(notice, source + ': ' + PROD_DETAIL,
        'the notice moved at cap ' + cap + ': ' + JSON.stringify(notice));
      assert.equal(redactSecrets(notice, []), notice,
        'the notice is not a fixed point at cap ' + cap + ': ' + JSON.stringify(notice));
      assert.equal(redactCredentialShapes(notice), notice,
        'the two entry points disagree about the notice at cap ' + cap);
    }
  }
});

test('F35-4: the production rate-limit notice keeps its stamp, and the diagnoses beside it are intact', () => {
  const notice = assembleNotice('github', PROD_DETAIL, [], 1000);
  assert.equal(notice, 'github: ' + PROD_DETAIL,
    'the production rate-limit notice moved: ' + JSON.stringify(notice));
  assert.match(notice, /resets 2026-10-16T22:49:02\.000Z/,
    'the production notice lost its reset stamp: ' + JSON.stringify(notice));
  assert.equal(redactSecrets(notice, []), notice, 'the production notice is not a fixed point');
  // The two other diagnoses the same label carries, at the shipped caps.
  for (const cap of [128, 402, 1000]) {
    for (const source of SOURCES) {
      for (const detail of ['HTTP 503 for https://api.github.com/repos/a/b/releases',
        'request failed for https://a.example/x: could not resolve the host (curl exit 6)']) {
        const made = assembleNotice(source, detail, [], cap);
        assert.equal(made, source + ': ' + detail,
          'a diagnosis moved at cap ' + cap + ' for ' + JSON.stringify(source) + ': ' + JSON.stringify(made));
        assert.equal(redactSecrets(made, []), made,
          'a diagnosis is not a fixed point at cap ' + cap + ': ' + JSON.stringify(made));
      }
    }
  }
});

test('F35-4: a token that merely CARRIES an instant is still credential-shaped (the recorded bound)', () => {
  // The exemption is anchored: the token has to BE an instant. These four shapes are the ones the
  // sweep's corpus still reaps, and they reap because the module's shape test calls the whole token
  // one -- a class an actual credential can be spelled in -- not because a branch forgot the rule.
  // Pinned so a later widening of the exemption is a deliberate act.
  for (const [text, expected] of [
    // One atom, so the value is an accepted header and goes whole.
    ['authorization: resets=' + STAMP, '[redacted]'],
    ['authorization: resets:' + STAMP, '[redacted]'],
    ['authorization: resets(' + STAMP + ')', '[redacted]'],
    // A declined value: the joined run is a credential-shaped token, the prose around it stays.
    ['authorization: nothing inside the window 2026-10-09T19:04:00.000Z..' + STAMP,
      'authorization: nothing inside the window [redacted]'],
  ]) {
    const out = redactSecrets(text, []);
    assert.equal(out, expected,
      'the recorded bound moved: ' + JSON.stringify(out));
    assert.equal(redactCredentialShapes(text), out,
      'the two entry points disagree about the recorded bound');
  }
  // And the leak direction the rule exists for is unchanged: a credential in the same position goes.
  for (const text of ['authorization: ' + STAMP + CRED, 'authorization: resets ' + CRED,
    'authorization: see the notes ' + CRED]) {
    assert.equal(redactSecrets(text, []).includes(CRED), false,
      'a credential beside an instant was published: ' + JSON.stringify(redactSecrets(text, [])));
  }
});
