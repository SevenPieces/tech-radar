// tests/basic-chain-fixed-point.test.mjs
// The Basic rule replaced only the token, so in a back-to-back unpadded chain
// ('Basic <blob>Basic <blob>...') every keyword after the first is glued to the tail of the blob
// before it. A lookbehind over the original text saw only the first occurrence, the pass removed one
// shape, the sentinel exposed the next keyword, and one removal pass was needed per shape: a chain
// of about 200 ran past the loop's 64-pass bound, so the published text was not a fixed point and a
// later pass kept removing (and lengthening) text whose cap had already been charged. The scan is a
// single sweep now and a keyword that stands at the resume point of the token it just removed is
// accepted, so a chain of any length is a fixed point of one call. These cases pin that, and pin
// beside them the back-to-back-blob behaviour the sweep must not regress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../scripts/lib/net.mjs';

const TOKEN = 'dXNlcjpw'; // base64 of 'user:pw', so the rule reads it as a Basic credential
const chain = (k) => 'abcdefgh'.repeat(k) + Array.from({ length: k }, () => 'Basic ' + TOKEN).join('');

test('a long back-to-back Basic chain is a fixed point in one call and never lengthens', () => {
  // 200 is the length the pass bound failed on; the longer chains show the sweep is complete and
  // not merely inside the bound.
  for (const k of [2, 65, 200, 400]) {
    const text = chain(k);
    const p1 = redactSecrets(text, ['abcdefgh']);
    const p2 = redactSecrets(p1, ['abcdefgh']);
    const p3 = redactSecrets(p2, ['abcdefgh']);
    assert.equal(p1, p2, 'the chain of ' + k + ' is not a fixed point: ' + p1.length + ' -> ' + p2.length);
    assert.equal(p2, p3, 'the chain of ' + k + ' is still moving on a third pass');
    assert.ok(p2.length <= p1.length,
      'a later pass lengthened the chain of ' + k + ': ' + p1.length + ' -> ' + p2.length);
    assert.equal(p1.includes('Basic ' + TOKEN), false,
      'a Basic credential survived the published text at chain ' + k);
    assert.equal((p1.match(/Basic /g) ?? []).length, k,
      'the sweep did not reach every keyword at chain ' + k);
    assert.equal(p1.includes('\uFFFF'), false, 'a sentinel survived the published text');
  }
});

test('the back-to-back-blob behaviour the bound was added for is unchanged', () => {
  // The sweep's own regression: a token glued to the word before it is still removed, and one
  // alone or separated by a space is removed without swallowing its neighbour's keyword.
  assert.equal(redactSecrets('XabcdefghBasic ' + TOKEN, ['abcdefgh']), 'X[redacted]Basic [redacted]',
    'the back-to-back pair is no longer removed as two shapes');
  assert.equal(redactSecrets('Basic ' + TOKEN + 'Basic ' + TOKEN, ['abcdefgh']),
    'Basic [redacted]Basic [redacted]',
    'two adjacent shapes are not removed in one call');
  // A keyword glued to a word the sweep did NOT remove is prose, not a credential.
  assert.equal(redactSecrets('nBasic ' + TOKEN, ['abcdefgh']), 'nBasic ' + TOKEN,
    'a keyword glued to an ordinary word was read as a credential');
  assert.equal(redactSecrets('Basic authentication is used', []), 'Basic authentication is used',
    'ordinary prose carrying the keyword was rewritten');
});

test('a chain inside a notice is a fixed point at a cap that was already charged', () => {
  const notice = 'rss https://feeds.example/feed.xml: the answer carried ' + chain(200);
  // The cut lands after the run of removed values and inside the chain, which is where a pass that
  // had not finished removing shapes kept going after the cap was applied.
  const priced = redactSecrets(notice, ['abcdefgh']).slice(0, 4600);
  const again = redactSecrets(priced, ['abcdefgh']);
  assert.equal(again, priced, 'the priced notice changed on the pass after its cap was applied');
  assert.ok(again.length <= priced.length, 'the pass after the cap lengthened the notice');
});
