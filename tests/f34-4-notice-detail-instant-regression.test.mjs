// tests/f34-4-notice-detail-instant-regression.test.mjs
// Independent regression test for F34-4 (Low, over-reaping Batch 67 introduced): the declined-value
// scan reaped a credential-shaped run out of a NOTICE'S OWN DETAIL when the source label ended in
// the bare word 'authorization'. The run it reaped was the run's own reset stamp -- the shape test
// calls an ISO-8601 instant credential-shaped, because it is long and carries digits -- and the
// token class took the ')' glued to it, so 'resets 2026-10-16T20:48:42.000Z); 55 ... not checked'
// came back as 'resets [redacted]; 55 ... not checked', with the bracket that closed the
// parenthetical gone. Measured at ded9b8c and at HEAD: 9 of 84 assembly rows.
//
// Batch 75 closes it in the scan itself, in two clauses that are both needed: the token class stops
// before a closing bracket, and a token that IS an ISO-8601 instant is the diagnosis vocabulary this
// module writes rather than a credential. The leak direction the scan exists for -- a credential
// standing in a value the reader declined (closing sweep F33-5, F33-1) -- is asserted here beside
// it, so the repair cannot be bought by dropping the scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleNotice } from '../scripts/collect.mjs';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const CRED = 'tok_' + '9f3a2c7d1e5b';
const STAMP = '2026-10-16T20:48:42.000Z';
// The run's own rate-limit detail, byte for byte (collect.mjs's budgetNotice writes this sentence).
const DETAIL = 'rate limit reached (remaining 0 of 60, resets ' + STAMP + '); 55 repository release listings not checked';
// The source shapes the shipped noticeSource builds for a watchlist row whose target or name ends in
// the bare word 'authorization'.
const SOURCES = ['rss https://a.example/x?p=authorization', 'api.example.com authorization',
  'github authorization', 'rss https://a.example/authorization'];

test('F34-4: a notice detail behind an authorization source label keeps its reset stamp', () => {
  for (const cap of [402, 1000]) {
    for (const source of SOURCES) {
      const notice = assembleNotice(source, DETAIL, [], cap);
      assert.equal(notice.includes('[redacted]'), false,
        'the notice detail was reaped at cap ' + cap + ': ' + JSON.stringify(notice));
      assert.equal(notice, source + ': ' + DETAIL,
        'the notice moved at cap ' + cap + ': ' + JSON.stringify(notice));
      assert.equal(redactSecrets(notice, []), notice,
        'the notice is not a fixed point: ' + JSON.stringify(notice));
      assert.equal(redactCredentialShapes(notice), notice,
        'the credential-free path disagrees about the notice: ' + JSON.stringify(notice));
    }
  }
});

test('F34-4: at the shipped 128 cap the detail is bounded, never reaped', () => {
  for (const source of SOURCES) {
    const notice = assembleNotice(source, DETAIL, [], 128);
    assert.equal(notice.includes('[redacted]'), false,
      'the notice detail was reaped at the 128 cap: ' + JSON.stringify(notice));
    assert.match(notice, /rate limit reached/,
      'the diagnosis lost its reason at the 128 cap: ' + JSON.stringify(notice));
    assert.match(notice, /resets 2026-10/,
      'the reset stamp was reaped at the 128 cap: ' + JSON.stringify(notice));
    assert.ok(notice.length <= 128, 'the notice passed its cap: ' + notice.length);
    assert.equal(redactSecrets(notice, []), notice,
      'the notice is not a fixed point at the 128 cap: ' + JSON.stringify(notice));
  }
});

test('F34-4: the leak the declined-value scan exists for is still closed', () => {
  // The rows the scan was added for: a credential standing in a value the reader declined. If the
  // repair had been to drop the scan, the credential would be published here.
  for (const [text, expected] of [
    ['authorization: request failed ' + CRED, 'authorization: request failed [redacted]'],
    ['authorization: see Also ' + CRED + ' status=200', 'authorization: see Also [redacted] [redacted]'],
    // A bracket glued to a credential is not part of the credential either, and the credential
    // still goes: the class change cannot buy a leak by splitting the run.
    ['authorization: request failed ' + CRED + ')', 'authorization: request failed [redacted])'],
    // The clause is exact: a run that merely BEGINS with an instant is not an instant.
    ['authorization: request failed ' + STAMP + CRED, 'authorization: request failed [redacted]'],
  ]) {
    assert.equal(redactSecrets(text, []), expected,
      'the declined-value scan moved: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), expected,
      'the two entry points disagree: ' + JSON.stringify(redactCredentialShapes(text)));
  }
});

test('F34-4: the notice diagnoses beside the detail are unchanged at every cap', () => {
  // The two other diagnoses a source label ending in 'authorization' carries. They were clean
  // before Batch 75 and must be byte-identical after it.
  for (const cap of [128, 402, 1000]) {
    for (const source of SOURCES) {
      for (const detail of ['HTTP 503 for https://a.example/x',
        'request failed for https://a.example/x: could not resolve the host (curl exit 6)']) {
        const notice = assembleNotice(source, detail, [], cap);
        assert.equal(notice, source + ': ' + detail,
          'a notice diagnosis moved at cap ' + cap + ' for ' + JSON.stringify(source));
        assert.equal(redactSecrets(notice, []), notice,
          'the notice is not a fixed point: ' + JSON.stringify(notice));
      }
    }
  }
});
