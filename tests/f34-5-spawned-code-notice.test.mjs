// tests/f34-5-spawned-code-notice.test.mjs
// Independent regression test for F34-5 (Low), the closing sweep's second spelling: the transport
// shaper publishes the cause it mapped beside the request, and the parenthesised slot that cause
// carries is the spawned tool's own error code or the signal that ended it. The curated shape list
// removes a vendor-shaped code, but a code the module's OWN shape test calls a credential - a
// digit-bearing run of at least MIN_SECRET_CHARS characters - was published byte for byte, because
// the phrase beside it is a scaffold span (kept byte for byte) and the shaped text goes out as it
// is. Measured at ded9b8c: 'rss https://a.example/x: request failed for https://a.example/x: curl
// could not be started (tok_...)'.
//
// The slot is given up when it is shaped, and kept when it is what Node really reports: every real
// code and signal Node raises for a child process is an alphabetic name, so no diagnosis is lost.
// The phrase itself always survives, so the notice still says what became of the tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleNotice } from '../scripts/collect.mjs';
import { redactSecrets, shapeTransportError } from '../scripts/lib/net.mjs';

const CRED = 'tok_' + '9f3a2c7d1e5b';
const VENDOR = 'gh' + 'p_' + 'AAAA1111bbbb2222';
const URL = 'https://a.example/x';
const SOURCE = 'rss ' + URL;

// A code or signal a real Node child-process failure reports. None of these is credential-shaped by
// the module's own test (a digit is required and a run of digits alone is not one), so all of them
// are still published: the fix must not cost the run its diagnosis.
const REAL = [
  [{ code: 'ENOENT' }, 'curl could not be started (ENOENT)'],
  [{ code: 'EACCES' }, 'curl could not be started (EACCES)'],
  [{ signal: 'SIGTERM' }, 'curl was terminated (SIGTERM)'],
  [{ signal: 'SIGKILL' }, 'curl was terminated (SIGKILL)'],
  [{ signal: 'SIGUSR1' }, 'curl was terminated (SIGUSR1)'],
  [{ code: 'ENOBUFS', signal: 'SIGTERM' }, 'curl was terminated (SIGTERM) at the 64 MiB capture ceiling'],
  [{ status: 6 }, 'could not resolve the host (curl exit 6)'],
];
// A slot the module's own shape test calls a credential. It carries no diagnosis -- a real code is a
// name -- and nothing removes it where it stands, so the slot is given up rather than published.
const SHAPED = [
  [{ code: CRED }, 'curl could not be started'],
  [{ code: VENDOR }, 'curl could not be started'],
  [{ signal: 'ABCDEFGH12345678' }, 'curl was terminated'],
  [{ code: 'ENOBUFS', signal: 'ABCDEFGH12345678' }, 'curl was terminated at the 64 MiB capture ceiling'],
];

test('F34-5: a credential-shaped spawn code or signal is not published in a notice', () => {
  for (const [err, cause] of SHAPED) {
    const shaped = shapeTransportError(err, URL, 402, {});
    assert.equal(shaped.cause, cause,
      'the shaped slot reached the cause: ' + JSON.stringify(shaped.cause));
    const notice = assembleNotice(SOURCE, shaped, [], 402);
    for (const credential of [CRED, VENDOR]) {
      assert.equal(notice.includes(credential), false,
        'a credential-shaped spawn code reached the notice: ' + JSON.stringify(notice));
    }
    assert.equal(notice, SOURCE + ': request failed for ' + URL + ': ' + cause,
      'the notice kept a slot it must give up: ' + JSON.stringify(notice));
    assert.equal(redactSecrets(notice, []), notice, 'the notice is not a fixed point: ' + JSON.stringify(notice));
    assert.ok(notice.length <= 402, 'the notice passed its cap: ' + notice.length);
  }
});

test('F34-5: every real spawn code and signal is still published', () => {
  for (const [err, cause] of REAL) {
    const shaped = shapeTransportError(err, URL, 402, {});
    assert.equal(shaped.cause, cause,
      'a real diagnosis was reaped: ' + JSON.stringify(shaped.cause) + ', recorded ' + JSON.stringify(cause));
    const notice = assembleNotice(SOURCE, shaped, [], 402);
    assert.equal(notice, SOURCE + ': request failed for ' + URL + ': ' + cause,
      'the notice moved: ' + JSON.stringify(notice));
    assert.equal(redactSecrets(notice, []), notice, 'the notice is not a fixed point: ' + JSON.stringify(notice));
  }
});
