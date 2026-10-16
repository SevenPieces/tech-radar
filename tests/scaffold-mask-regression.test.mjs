// tests/scaffold-mask-regression.test.mjs
// The Batch 40 mechanism replaced the shaper's status and cause with one private-use character for
// the removals and restored them afterwards, and the closing verification measured four failures
// against it. All four were the same shape -- an internal character standing in the scanned text:
//   - an input that carried the mask switched the protection off (a private-use character reached
//     the pool, and the status and cause became ordinary removal targets);
//   - the authorization rule's token class matched the mask, so a source whose path ends in
//     'authorization' published 'rss https://a.example/[redacted]' with no status and, for a
//     transport failure, no cause at all;
//   - a collected value that SPELLED the mask matched every mask (a one-character value is removed
//     by the word-bounded rule), so one crafted watchlist row stripped the diagnosis from every
//     other row's notice;
//   - the four scaffold alternatives' wildcards were masked too, so a server that echoed the
//     request's own credential inside one of them ('curl could not be started (SECRET42)') had it
//     published verbatim -- the value was masked out of the by-value removal's reach.
// The redesign protects only the FIXED vocabulary (the status token and the cause phrase) and
// normalises the private-use character out of the input text and out of every value, so the
// protection cannot be disabled, matched or spelled. These cases pin each of the six properties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, shapeHttpError, shapeTransportError } from '../scripts/lib/net.mjs';
import { assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';

const MASK = '\uE000';
const SENTINEL = '\uFFFF';
const CAPS = [128, 129, 200, 402, 1000];
const value = (t) => JSON.stringify(t);

test('scaffold (1) the TR-111 notice keeps its status while the value is removed elsewhere', () => {
  const notice = assembleNotice(
    'rss https://feeds.example/dead.xml',
    shapeHttpError(500, Buffer.from('the server broke'), 'https://feeds.example/dead.xml', 200),
    ['500'],
    402,
  );
  assert.match(notice, /HTTP 500 for /,
    'the notice lost the status to the configured value: ' + value(notice));
  assert.ok(!notice.includes('[redacted]'),
    'the configured value rewrote the notice: ' + value(notice));
  assert.equal(redactSecrets('rss https://feeds.example/500/feed.xml: HTTP 500 for it', ['500']),
    'rss https://feeds.example/[redacted]/feed.xml: HTTP 500 for it',
    'the status protection is not the whole line: the value stands in the source');
});

test('scaffold (2) no credential is published from any of the four alternatives', () => {
  const secret = 'SECRET42';
  // The four alternatives the mask covered: the status, the URL slot, the spawn-code slot and the
  // signal slot.
  const frames = [
    'HTTP 503 for https://x.example/a',
    'request failed for https://x.example/a: curl could not be started (' + secret + ')',
    'request failed: curl was terminated with ' + secret + ' attached',
    'curl could not be started (' + secret + ')',
    'curl was terminated ' + secret,
    'request failed: failed to connect (curl exit 7) ' + secret,
    'request failed for https://x.example/' + secret + ': failed to connect (curl exit 7)',
  ];
  for (const frame of frames) {
    const redacted = redactSecrets('rss https://x.example/feed: ' + frame, [secret]);
    assert.ok(!redacted.includes(secret),
      'the credential survived in the whole-line redaction: ' + value(redacted));
    const notice = assembleNotice('rss https://x.example/feed', frame, [secret], 1000);
    assert.ok(!notice.includes(secret),
      'the credential survived in the notice: ' + value(notice));
    const shaped = assembleNotice(
      'rss https://x.example/feed',
      shapeTransportError({ code: secret }, 'https://x.example/feed', 200),
      [secret],
      1000,
    );
    assert.ok(!shaped.includes(secret),
      'the credential survived as a spawned-tool code: ' + value(shaped));
  }
});

test('scaffold (3) a source path ending in authorization keeps its status and cause at every cap', () => {
  for (const cap of CAPS) {
    const transport = assembleNotice(
      'rss https://a.example/authorization',
      shapeTransportError({ status: 6 }, 'https://a.example/authorization', 63),
      [],
      cap,
    );
    assert.match(transport, /could not resolve the host \(curl exit 6\)/,
      'cap ' + cap + ' lost the transport cause: ' + value(transport));
    const http = assembleNotice(
      'rss https://a.example/authorization',
      shapeHttpError(503, Buffer.from('x'), 'https://a.example/authorization', 63),
      [],
      cap,
    );
    assert.match(http, /HTTP 503/,
      'cap ' + cap + ' lost the status: ' + value(http));
  }
});

test('scaffold (4) an input carrying the mask cannot disable the protection or reach text', () => {
  const text = 'rss https://a.example/x: HTTP 503 for ' + MASK + ' tail';
  const redacted = redactSecrets(text, ['503', MASK]);
  assert.ok(!redacted.includes(MASK), 'the mask reached published text: ' + value(redacted));
  assert.ok(!redacted.includes(SENTINEL), 'the sentinel reached published text: ' + value(redacted));
  assert.match(redacted, /HTTP 503/,
    'the input\'s own mask switched the protection off: ' + value(redacted));
  // A collected value that IS the mask cannot match the placeholder either: the private-use
  // character is normalised out of the value set before any rule reads it.
  const masked = redactSecrets('rss https://a.example/x: HTTP 503 for tail', [MASK]);
  assert.match(masked, /HTTP 503/, 'a mask-equal value deleted the status: ' + value(masked));
  assert.ok(!masked.includes(MASK), 'a mask-equal value published the mask: ' + value(masked));
});

test('scaffold (5) the whole-line seam class stays closed', () => {
  const spanning = 'pw: the';
  const notice = assembleNotice(
    'rss https://a.example/pw',
    shapeTransportError({ status: 6 }, 'https://b.example/x', 200),
    [spanning],
    128,
  );
  assert.ok(!notice.includes(spanning),
    'the seam-spanning value was published: ' + value(notice));
  assert.equal(redactSecrets('PW: the value', ['PW: the']), '[redacted] value',
    'the value spanning the separator is not removed from the whole line');
});

test('scaffold (6) the redaction is a fixed point and never lengthens what it republishes', () => {
  const cases = [
    'rss https://feeds.example/dead.xml: HTTP 500 for https://feeds.example/dead.xml',
    'rss https://a.example/x:' + MASK + 'HTTP 503 for ' + MASK + ' tail',
    'rss https://a.example/pw: request failed for https://b.example/x: could not resolve the host (curl exit 6)',
    'rss https://a.example/authorization: a failure with no message',
    'see [redacted] here and timed out (curl exit 28)',
  ];
  const values = ['SECRET42', 'HTTP 503', 'rss', 'the', 'host', 'pw: the', '500'];
  for (const text of cases) {
    const once = redactSecrets(text, values);
    const twice = redactSecrets(once, values);
    assert.equal(twice, once, 'the redaction is not a fixed point: ' + value(text));
    assert.equal(neutraliseNoticeText(once), once,
      'the notice rewriting is not a fixed point: ' + value(once));
  }
});
