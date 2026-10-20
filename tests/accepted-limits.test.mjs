// tests/accepted-limits.test.mjs
// The executable half of reference/accepted-limits.md: one pin per accepted limit, named by its id.
// These tests assert the ACCEPTED behaviour, not the ideal one. A red test here means the behaviour
// behind an accepted limit changed -- update the register deliberately, never silently. An entry is
// re-openable only by evidence that its recorded reach is understated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactCredentialShapes, decodeEntities } from '../scripts/lib/net.mjs';

const ZWSP = '\u200b';
const FEFF = '\ufeff';
const B64 = Buffer.from('u:s3cr3tp4ssw0rd').toString('base64'); // dTpzM2NyM3RwNHNzdzByZA==

test('A-6 accepted: an all-alphabetic credential is published, unsplit and split', () => {
  assert.equal(redactSecrets('authorization: abcdefghijklmnop', []), 'authorization: abcdefghijklmnop');
  assert.equal(redactCredentialShapes('authorization: abcdefghijklmnop'), 'authorization: abcdefghijklmnop');
  assert.equal(redactSecrets('authorization: abcdefghijklmnop', []).includes('abcdefghijklmnop'), true);
});

test('A-37 / D-24 accepted: a credential split by an ordinary space publishes the part after the gap', () => {
  const split = B64.slice(0, 12) + ' ' + B64.slice(12);
  const out = redactSecrets('release: Basic ' + split + ' and prose', []);
  // the head is removed by value-independent shape reading; the tail after the visible gap publishes
  assert.equal(out.includes(B64.slice(12)), true);
  assert.equal(out.includes(B64), false, 'the whole credential must not be present');
  assert.equal(out.startsWith('release: Basic '), true);
});

test('A-54 accepted: a value split into more than 64 separator runs publishes whole', () => {
  const value = 'a'.repeat(70) + '1' + 'b'.repeat(29);
  const split = value.split('').join(FEFF);
  const out = redactSecrets('authorization: ' + split + ' end', []);
  assert.equal(out.split(FEFF).join('').includes(value), true);
});

test('TR-383 accepted: a curated body split across split evidence reaps the following word', () => {
  const out = redactSecrets('a commit carried gh' + ZWSP + 'p_' + 'a'.repeat(36) + ZWSP + 'fix landed', []);
  assert.equal(out.includes('fix'), false, 'the accepted over-reap removes the word after the body');
  assert.equal(out.includes('a'.repeat(36)), false, 'the body itself is removed');
});

test('A-60 accepted: a three-quote spelling publishes the whole credential', () => {
  const out = redactSecrets('release: Basic """' + B64 + '" and prose', []);
  assert.equal(out.includes(B64), true);
});

test('A-61 accepted: the second-quote jam spelling publishes the whole credential', () => {
  const out = redactSecrets('release: Basic \\" \\"' + B64 + '\\" and prose', []);
  assert.equal(out.includes(B64), true);
});

test('A-59 accepted: an orphan closing quote stands after the payload is removed', () => {
  const out = redactSecrets('Basic ' + B64 + '"', []);
  assert.equal(out.includes(B64), false, 'the payload is removed');
  assert.equal(out.endsWith('"'), true, 'the closing quote is left standing');
});

test('A-62 accepted: an entity outside the separator vocabulary is left as text', () => {
  assert.equal(decodeEntities('a &mdash; b'), 'a &mdash; b');
});

test('D-13 accepted: a sentence that spells a header name loses its tail', () => {
  assert.equal(redactSecrets('authorization: token rotation is scheduled', []), '[redacted]');
  assert.equal(redactSecrets('Authorization: Basic abcdefgh and then prose', []), '[redacted]');
});
