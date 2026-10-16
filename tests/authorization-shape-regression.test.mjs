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

// Closing sweep F29-3 (Med, pre-existing): the shape's token class excluded both quote characters,
// so a BARE quoted value never matched at all and was published byte for byte at every cap -
// 'authorization: "tok_..."', "authorization: 'tok_...'", the real 'authorization: "Bearer <token>"'
// and an AWS SigV4 'authorization: "AWS4-HMAC-SHA256 Credential=..., Signature=..."'. It reaches a
// notice whenever a body with no readable message carries one. The rule now reads a quoted value as
// ONE token, refuses or consumes by the value INSIDE the quotes (so the URL-userinfo removal of
// Batch 49 still fires for a quoted URL), and leaves ordinary quoted prose alone - it never starts
// without the header keyword.
test('sweep F29-3 a bare quoted authorization value is removed, single or double quoted', () => {
  for (const text of [
    'authorization: "tok_9f3a2c7d1e5b"',
    "authorization: 'tok_9f3a2c7d1e5b'",
    'authorization: "Bearer tok_9f3a2c7d1e5b"',
    "authorization: 'Bearer tok_9f3a2c7d1e5b'",
    'authorization: "AWS4-HMAC-SHA256 Credential=example-key-id/20261017, Signature=deadbeef1234"',
    'Proxy-Authorization: "Basic dXNlcjpwYXNz"',
    'an authorization: "tok_9f3a2c7d1e5b" value',
  ]) {
    const out = redactSecrets(text, []);
    assert.ok(!/tok_9f3a2c7d1e5b|deadbeef1234|dXNlcjpwYXNz/.test(out),
      'the quoted header value was published: ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
    assert.equal(redactSecrets(out, []), out,
      'the quoted-header rewrite is not a fixed point: ' + JSON.stringify(out));
  }
  // The quoted URL keeps the userinfo removal of Batch 49, and a URL with no userinfo is still the
  // assembly's own seam and is refused.
  for (const text of ['authorization: "https://user:s3cr3tp4ss@host/path"',
    "authorization: 'https://user:s3cr3tp4ss@host/path'"]) {
    const out = redactSecrets(text, []);
    assert.ok(!out.includes('s3cr3tp4ss'),
      'the quoted URL published its userinfo: ' + JSON.stringify(out));
  }
  assert.equal(redactSecrets('authorization: "https://evil.example/x?t=abcdefgh"', []),
    'authorization: "https://evil.example/x?t=abcdefgh"',
    'a URL with no userinfo inside quotes was consumed');
});

// Batch 56 (sweep F30-3, Low) corrected this test's own stated reason. The three prose rows do
// survive because the header shape is absent, but the two rows that carry the header keyword did
// not: 'xauthorization: "tok_9f3a2c7d1e5b"' survives because the keyword has no word boundary in
// front of it, and 'authorization: "HTTP 503"' survived because the scaffold placeholder for the
// status stood inside the value and the rule skipped the WHOLE match. That skip is what published
// 'authorization: "HTTP 503 tok_9f3a2c7d1e5b"' byte for byte, so the fixture was passing for the
// reason the comment denied and could not catch the leak beside it. The correction: the rows are
// kept (each still survives, byte for byte) and the reason for each is stated, and the leak the
// old rationale hid is asserted in the new test below.
test('sweep F29-3 ordinary quoted prose survives, and the two header-shaped rows for their own reasons', () => {
  for (const text of [
    // No header shape at all: the rule never starts.
    'the release said "the architecture is documented" in the notes',
    "he said 'hello world' loudly",
    'quote before: "the archived releases were moved"',
    'a "quoted" word and a plain one',
    // The keyword is there but has no word boundary in front of it, so the rule still never starts.
    'xauthorization: "tok_9f3a2c7d1e5b"',
    // The keyword IS there: this row survives because the value holds only the scaffold span the
    // module wrote for the status ('HTTP 503') and two quote characters, and neither carries a
    // credential-shaped token. It is NOT a row about the shape being absent.
    'authorization: "HTTP 503"',
  ]) {
    assert.equal(redactSecrets(text, []), text,
      'a quoted-prose row was rewritten: ' + JSON.stringify(text) + ' -> '
      + JSON.stringify(redactSecrets(text, [])));
  }
});

// Batch 56 (sweep F30-2, Med; sweep F30-3b, Low; sweep F30-3, Low). The Batch 54 quoted-value rule
// read only the ONE spelling the sweep measured it against: a quoted value with nothing after the
// closing quote. The trailing lookahead was outside the alternation, so it applied to the quoted
// alternatives too, and a quoted alternative cannot backtrack inside its quotes - one separator and
// one space after the closing quote, or two whitespace characters, and the regex found no match at
// all. The escaped quote ended the run early, the refusal read the match's LAST colon instead of the
// header's own, and a scaffold span inside the value skipped the whole match.
test('sweep F30-2 a quoted value is one token however it is followed', () => {
  const VALUE = 'tok_9f3a2c7d1e5b';
  const cases = [
    'authorization: "' + VALUE + '", more',      // a separator and a space
    'authorization: "' + VALUE + '"; more',      // the other separator and a space
    'authorization: "' + VALUE + '"  more',      // two spaces
    'authorization: "' + VALUE + '"\n\nmore',  // a blank line
    'authorization: "' + VALUE + '"\r\nmore',  // one CRLF terminator
    'authorization: "' + VALUE + '"\t\tmore',  // a tab indent
    'authorization: "' + VALUE + '"\u00a0\u00a0more', // two no-break spaces
    'authorization: "' + VALUE + '", realm=example',    // a trailing attribute
    'authorization: "' + VALUE + "'",    // a mismatched closing delimiter
  ];
  for (const text of cases) {
    const out = redactSecrets(text, []);
    assert.ok(!out.includes(VALUE),
      'the quoted header value survived: ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
    assert.equal(redactSecrets(out, []), out,
      'the quoted-value rewrite is not a fixed point: ' + JSON.stringify(out));
  }
});

test('sweep F30-2 an escaped quote inside the value does not end the run', () => {
  const VALUE = 'tok_9f3a2c7d1e5b';
  const out = redactSecrets('authorization: "tok\\"' + VALUE + '"', []);
  assert.equal(out, '[redacted]',
    'the escaped quote ended the quoted run early and published the rest: ' + JSON.stringify(out));
});

test('sweep F30-2 an unterminated quote runs to the end of the text and is consumed', () => {
  // The decision is deliberate and is stated here: a header value that opens a quote and never
  // closes it is read as a value to the end of the text. The alternative - leave it where it stands
  // - publishes the credential, and the two things a notice's own diagnosis needs are protected
  // before the rule reads the text: a scaffold span inside the match is kept byte for byte, and a
  // value that begins 'request failed' is refused. Both halves are asserted below, so the decision
  // cannot be reversed without failing this file.
  const VALUE = 'tok_9f3a2c7d1e5b';
  for (const text of ['authorization: "' + VALUE, "authorization: '" + VALUE]) {
    const out = redactSecrets(text, []);
    assert.ok(!out.includes(VALUE),
      'the unterminated quoted value survived: ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
  }
  const seam = 'rss https://a.example/authorization: request failed for x';
  assert.equal(redactSecrets(seam, []), seam, 'the transport seam was consumed: ' + JSON.stringify(redactSecrets(seam, [])));
});

test('sweep F30-3 the scaffold span survives and the credential beside it does not', () => {
  const VALUE = 'tok_9f3a2c7d1e5b';
  for (const [text, expected] of [
    ['authorization: "HTTP 503 ' + VALUE + '"', 'authorization: "HTTP 503 [redacted]"'],
    ['authorization: "HTTP 503 for ' + VALUE + '"', 'authorization: "HTTP 503 for [redacted]"'],
    ['authorization: "ok HTTP 503"', 'authorization: "ok HTTP 503"'],
    ['authorization: "HTTP 503"', 'authorization: "HTTP 503"'],
  ]) {
    const out = redactSecrets(text, []);
    assert.equal(out, expected,
      'the scaffold span and the credential did not part company: ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
    assert.equal(redactSecrets(out, []), out,
      'the scaffold rewrite is not a fixed point: ' + JSON.stringify(out));
  }
});

test('sweep F30-3b the refusal reads the value from the header\'s own colon', () => {
  const VALUE = 'tok_9f3a2c7d1e5b';
  // Direction 1 (disclosure): a colon inside the value used to move the read into the value's own
  // words, so a value that happened to carry 'request failed' after its last colon was refused whole
  // and the credential was published.
  for (const text of [
    'authorization: "note: request failed ' + VALUE + '"',
    'authorization: "x: request failed ' + VALUE + '"',
  ]) {
    const out = redactSecrets(text, []);
    assert.ok(!out.includes(VALUE),
      'a colon inside the value moved the refusal read: ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
  }
  // Direction 2 (over-redaction): the assembly's own seam is a URL with no userinfo, and a seam
  // target that carries a port or a colon in its query was consumed while the read was the match's
  // last colon. Read from the header's own colon it is refused, like every other URL with no
  // userinfo in it.
  for (const text of [
    'authorization: "https://a.example:8443/x"',
    'authorization: "https://a.example/x?t=1:2"',
    'authorization: https://a.example/x?t=1:2',
  ]) {
    assert.equal(redactSecrets(text, []), text,
      'the assembly\'s own seam URL was consumed: ' + JSON.stringify(redactSecrets(text, [])));
  }
});

// Recorded residues of the same rule, measured at Batch 56 and left standing: a value that NESTS
// its quotes, a quoted value behind a bare attribute, and an unbalanced single quote (an apostrophe
// inside the value) are still published at this module surface. They are pre-existing (identical at
// aabc3dd, b2a7dc9 and 6ee1f64, before Batch 54 read a quoted value at all), Batch 54 and Batch 56
// both narrowed the class, and the shipped collectors never hand this rule a detail carrying one
// (an upstream body does not reach a notice; only query values and userinfo do, and those are
// collected by value). Asserted so a later change that closes them is a deliberate one, and so
// nobody mistakes the class for closed.
test('sweep F30-2 recorded residues: nested quotes, a leading attribute, an unbalanced single quote', () => {
  const VALUE = 'tok_9f3a2c7d1e5b';
  const residues = [
    'authorization: "pre "' + VALUE + '" post"',
    'authorization: realm=example, "' + VALUE + '"',
    "authorization: 'user's " + VALUE + "'",
  ];
  for (const text of residues) {
    assert.ok(redactSecrets(text, []).includes(VALUE),
      'a recorded residue was closed, so this record is stale: ' + JSON.stringify(redactSecrets(text, [])));
  }
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
