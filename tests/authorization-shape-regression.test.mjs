// tests/authorization-shape-regression.test.mjs
// Verification F28-3 (Low) and sweep F28-4 (Low): the two halves of the authorization rule that
// still published or deleted something they should not.
//
// F28-3 -- a source LABEL ending in the bare word 'authorization' lost the HTTP status at every cap.
// Batch 44's refusals kept the PATH form ('rss https://a.example/authorization') but only the
// '(?<!\/)' one fires for it; for a bare word the keyword is preceded by a space, the token after
// the colon is the scaffold placeholder (the masked status) rather than a word, and the whitespace
// refusal does not fire, so the rule consumed the placeholder and the span was never restored. The
// transport detail lost the word 'request' from 'request failed for' the same way.
//
// Sweep F28-4 -- the rule consumed one token and stopped, so an attribute list kept its quoted
// credential, and a URL-shaped header value was refused whole, so its userinfo password was
// published.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactSecrets, requestSecretSets, requestSecrets, shapeHttpError, shapeTransportError,
} from '../scripts/lib/net.mjs';
import { assembleNotice } from '../scripts/collect.mjs';

const CODE_POINT = String.fromCharCode(0xE000);

test('F28-3 a source label ending in the bare word authorization keeps its status and its cause', () => {
  for (const source of ['github authorization', 'npm authorization', 'arxiv authorization',
    'rss authorization', 'rss https://a.example/x?p=authorization']) {
    for (const cap of [128, 402, 1000]) {
      const http = assembleNotice(source, shapeHttpError(503, Buffer.from('x'), 'https://a.example/x', 100), [], cap);
      assert.match(http, /HTTP 503/,
        'the status was deleted from ' + JSON.stringify(source) + ' at cap ' + cap + ': ' + JSON.stringify(http));
      const transport = assembleNotice(source, shapeTransportError({ status: 6 }, 'https://a.example/x', 100), [], cap);
      assert.match(transport, /could not resolve the host \(curl exit 6\)/,
        'the cause was deleted from ' + JSON.stringify(source) + ' at cap ' + cap + ': ' + JSON.stringify(transport));
      assert.match(transport, /request failed for /,
        'the notice\'s own request wording was deleted from ' + JSON.stringify(source) + ': ' + JSON.stringify(transport));
    }
  }
  // The path form of Batch 44 is unchanged.
  const path = assembleNotice('rss https://a.example/authorization',
    shapeHttpError(503, Buffer.from('x'), 'https://a.example/authorization', 100), [], 402);
  assert.match(path, /HTTP 503 for https:\/\/a\.example\/authorization/,
    'the path form lost its status: ' + JSON.stringify(path));
});

test('F28-3 the notice of such a source is a fixed point of the run redaction', () => {
  // The placeholder the rule must not consume only exists inside a pass, so the property is
  // observable on what the pass publishes: a notice that keeps its status and its cause must also be
  // returned byte-identical by a second redaction, with and without a value equal to its own words.
  for (const source of ['github authorization', 'rss authorization']) {
    for (const secrets of [[], [CODE_POINT], ['request'], ['HTTP 503'], ['failed to connect']]) {
      for (const detail of [
        shapeHttpError(503, Buffer.from('x'), 'https://a.example/x', 100),
        shapeTransportError({ status: 7 }, 'https://a.example/x', 100),
      ]) {
        const notice = assembleNotice(source, detail, secrets, 402);
        assert.equal(redactSecrets(notice, secrets), notice,
          'the published notice is not a fixed point: ' + JSON.stringify({ source, secrets, notice }));
      }
    }
  }
});

test('sweep F28-4 an authorization attribute list is removed whole', () => {
  const cases = [
    'Authorization: OAuth oauth_consumer_key="abc", oauth_token="SECRETTOKEN123"',
    'Authorization: Digest username="u", response="deadbeef12345678"',
    'Authorization: OAuth oauth_consumer_key="abc", oauth_token="SECRETTOKEN123", oauth_signature="deadbeef"',
    "Authorization: OAuth oauth_token='SECRETTOKEN123'",
  ];
  for (const text of cases) {
    const out = redactSecrets(text, []);
    assert.ok(!out.includes('SECRETTOKEN123') && !out.includes('deadbeef12345678') && !out.includes('deadbeef'),
      'the attribute list published its credential: ' + JSON.stringify(out));
    assert.equal(redactSecrets(out, []), out,
      'the authorization rewrite is not a fixed point: ' + JSON.stringify(out));
  }
});

test('sweep F28-4 a URL-shaped header value gives up its userinfo credential', () => {
  for (const text of [
    'authorization: https://user:s3cr3tp4ss@host/path',
    'Authorization: https://user:s3cr3tp4ss@host/path',
    'authorization: //user:s3cr3tp4ss@host/path',
  ]) {
    const out = redactSecrets(text, []);
    assert.ok(!out.includes('s3cr3tp4ss'),
      'the userinfo password was published: ' + JSON.stringify(out));
  }
  // A URL with no userinfo is the assembly's own seam beside a request and is still refused: there
  // is no credential in it to remove, and the notice that names such a source keeps its text.
  assert.equal(redactSecrets('a authorization: https://x.example/a both', []),
    'a authorization: https://x.example/a both',
    'a URL with no credential was consumed');
  assert.equal(redactSecrets('authorization: token1 token2', []), '[redacted] token2',
    'the second token of an unrecognised value is no longer preserved');
});

test('the run\'s own authorization header is still collected whole and removed', () => {
  const headers = { Authorization: 'OAuth oauth_consumer_key="abc", oauth_token="SECRETTOKEN123"' };
  const secrets = requestSecrets('https://api.github.com/repos/a/b/releases', headers);
  assert.ok(secrets.includes('OAuth oauth_consumer_key="abc", oauth_token="SECRETTOKEN123"'),
    'the header value is not collected whole: ' + JSON.stringify(secrets));
  const echoed = 'a server echoed Authorization: OAuth oauth_consumer_key="abc", oauth_token="SECRETTOKEN123" back';
  const out = redactSecrets(echoed, secrets);
  assert.ok(!out.includes('SECRETTOKEN123'),
    'an echo of the run\'s own header published the credential: ' + JSON.stringify(out));
});
