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
  redactSecrets, redactCredentialShapes, requestSecretSets, requestSecrets, shapeHttpError,
  shapeTransportError,
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
  // Batch 61: the acceptance is ONE gate, applied on both entry points, and 'token1' is a BARE
  // token that is not credential-shaped (six characters, no digit), so this is not a credential
  // header and the text is returned byte for byte - here and on the credential-free path alike
  // (the row below is the half of the old expectation that stays true and is still pinned: the
  // whitespace-separated SECOND token of an unrecognised value survives).
  // Closing sweep F32-1: the reader now crosses that whitespace gap when the atom beyond it is
  // part of a header value's grammar, so the pinned row below is the NARROW half of what it used
  // to say - it holds because 'token2' is not credential-shaped, and a credential-shaped second
  // token would be consumed with the run (the row is pinned in
  // tests/authorization-value-extent.test.mjs, beside the sweep's own leak row
  // 'authorization: tok_9f3a2c7d1e5b SECRETTOKEN123' -> '[redacted]'). The expectation here is
  // unchanged: it was true before the repair and it is true after it.
  assert.equal(redactSecrets('authorization: token1 token2', []), 'authorization: token1 token2',
    'a bare value that is not credential-shaped was consumed');
  assert.equal(redactSecrets('authorization: token1 token2', []),
    redactCredentialShapes('authorization: token1 token2'),
    'the two entry points disagree about a bare value');
  // Batch 67 corrected this expectation. It pinned the NARROW half of the reading ("the second token
  // of an unrecognised value survives"), and that half is false under the whole-value rule: a line
  // that names a credential header gives the WHOLE value, so the bare word after the credential goes
  // with it. Before: '[redacted] token2'  After: '[redacted]'. The rule, not the expectation, is
  // what changed; the credential still goes, which is the property this assertion exists for.
  assert.equal(redactSecrets('authorization: tok_9f3a2c7d1e5b token2', []), '[redacted]',
    'the whole value of a credential header was not consumed');
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
  //
  // Batch 67 corrected this expectation. The refusal is still the right reading of the value --
  // 'request failed' and a URL with no userinfo are the assembly's own seam, and the label ending in
  // 'authorization' must keep its diagnosis -- but the refusals are the READER's, not the rule's:
  // the whole value is consumed by the rule now, and a refused value only stays readable when it is
  // the seam. A VALUE that spells a URL and nothing else is a credential header whose value is a
  // URL, so it goes. Before: the URL rows were returned byte for byte. After: '[redacted]'. The two
  // rows that carry the assembly's own seam (beside a status or a transport cause) are asserted
  // unchanged in tests/authorization-value-extent.test.mjs and tests/scaffold-mask-regression.test.mjs.
  for (const text of [
    'authorization: "https://a.example:8443/x"',
    'authorization: "https://a.example/x?t=1:2"',
    'authorization: https://a.example/x?t=1:2',
  ]) {
    assert.equal(redactSecrets(text, []), '[redacted]',
      'a URL-valued credential header was not consumed: ' + JSON.stringify(redactSecrets(text, [])));
  }
  // The refusal itself still holds: a value beginning 'request failed' keeps its text, and the
  // credential-shaped token standing in it does not go with the refusal (closing sweep F33-5).
  assert.equal(redactSecrets('rss https://a.example/authorization: request failed for x', []),
    'rss https://a.example/authorization: request failed for x',
    'the transport seam was consumed');
});

// The three residues Batch 56 recorded and left standing (its own comment said they were asserted
// "so a later change that closes them is a deliberate one"). Batch 61 closed them: the ONE value
// reading follows a run of atoms, so a quoted value NESTED in quotes, a quoted value behind a bare
// attribute ('realm=example, "tok_..."', which the comma of the attribute list introduces) and an
// unbalanced single quote (an apostrophe inside the value, read as an unterminated quoted atom that
// carries the credential) all give up the credential now, on both entry points. The record is
// inverted here, with the same three spellings.
test('sweep F30-2 the recorded residues are closed by the one value reading', () => {
  const VALUE = 'tok_9f3a2c7d1e5b';
  const residues = [
    'authorization: "pre "' + VALUE + '" post"',
    'authorization: realm=example, "' + VALUE + '"',
    "authorization: 'user's " + VALUE + "'",
  ];
  for (const text of residues) {
    for (const [path, out] of [['the notice path', redactSecrets(text, [])],
      ['the credential-free path', redactCredentialShapes(text)]]) {
      assert.ok(!out.includes(VALUE),
        'a residue still publishes the credential on ' + path + ': '
        + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
      assert.equal(redactSecrets(out, []), out,
        'the rewrite is not a fixed point on ' + path + ': ' + JSON.stringify(out));
    }
    assert.equal(redactSecrets(text, []), redactCredentialShapes(text),
      'the two entry points disagree about a residue: ' + JSON.stringify(text));
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

// ---------------------------------------------------------------------------------------
// Batch 61 (closing sweep F31-1..F31-5, High/Medium/Low). The authorization shape had TWO
// implementations that drifted apart: redactSecrets read the value unbounded, while
// redactCredentialShapes read it behind 'credentialShapedOnly' -- a gate asked of the token AFTER
// the scheme, which is the attribute NAME ('username=', 'oauth_consumer_key='), so an attribute
// list's credential was published byte for byte on the credential-free path while the identical
// text was '[redacted]' on the notice path (F31-1). The tail also stopped at ';' (a standard SigV4
// 'Signature=' survived on EVERY path; F31-2), a quoted token after a scheme was read by nobody
// (F31-3), a JSON-dumped header was read by no path at all (F31-4), and the three quoted residues
// Batch 56 recorded were live on the candidate path (F31-5).
//
// There is ONE matcher, ONE acceptance and ONE reading now, shared by both entry points (net.mjs
// 'readAuthorizationValue' and 'redactShapeRules'), and the only difference left between them is
// whether the by-value removal also runs. The gate Batch 57 added is kept where it belongs: a
// value that names NO recognised scheme is consumed only when one of its atoms is
// credential-shaped, which is what keeps the prose below byte-identical. Both directions are
// asserted here, row by row, together with the agreement property: the same input through both
// entry points publishes the same text.
// ---------------------------------------------------------------------------------------
const SWEEP_VALUE = 'tok_' + '9f3a2c7d1e5b';
const SWEEP_B64 = Buffer.from('user:' + 'password1').toString('base64');
const SWEEP_AWS_KEY = 'AKIA' + 'EXAMPLE';

// Every spelling the closing sweep published, with the credential it published.
const SWEEP_LEAKS = [
  ['F31-1 a Digest attribute list', 'authorization: Digest username="u", response="deadbeef1234"', 'deadbeef1234'],
  ['F31-1 an OAuth attribute list',
    'authorization: OAuth oauth_consumer_key="abc", oauth_token="SECRETTOKEN123"', 'SECRETTOKEN123'],
  ['F31-1 a reordered SigV4 attribute list',
    'authorization: AWS4-HMAC-SHA256 SignedHeaders=host;x-amz-date, Credential=' + SWEEP_AWS_KEY
    + '/20261017, Signature=deadbeef1234', 'dead' + 'beef1234'],
  ['F31-2 a standard SigV4 attribute list',
    'authorization: AWS4-HMAC-SHA256 Credential=' + SWEEP_AWS_KEY
    + '/20261017/us-east-1, SignedHeaders=host;x-amz-date, Signature=' + '9f8e7d6c5b4a' + '3f2e1d0c',
    '9f8e7d6c5b4a' + '3f2e1d0c'],
  ['F31-3 a quoted Basic credential', 'authorization: Basic "' + SWEEP_B64 + '"', SWEEP_B64],
  ['F31-3 a quoted Basic credential, single quotes', "authorization: Basic '" + SWEEP_B64 + "'", SWEEP_B64],
  ['F31-3 the Basic rule alone, quoted', 'Basic "' + SWEEP_B64 + '"', SWEEP_B64],
  ['F31-3 a quoted Bearer credential', 'authorization: Bearer "TOKEN9f3a2c7d"', 'TOKEN9f3a2c7d'],
  ['F31-4 a JSON-dumped header', '{"authorization": "' + SWEEP_VALUE + '"}', SWEEP_VALUE],
  ['F31-4 a JSON-dumped proxy header', '{"proxy-authorization":"' + SWEEP_VALUE + '"}', SWEEP_VALUE],
  ['F31-5 nested quotes', 'authorization: "pre "' + SWEEP_VALUE + '" post"', SWEEP_VALUE],
  ['F31-5 a quoted value behind a bare attribute',
    'authorization: realm=example, "' + SWEEP_VALUE + '"', SWEEP_VALUE],
  ['F31-5 an unbalanced single quote', "authorization: it's " + SWEEP_VALUE, SWEEP_VALUE],
  ['F31-5 an unbalanced single quote behind a quoted pair',
    "authorization: 'user's " + SWEEP_VALUE + "'", SWEEP_VALUE],
];

test('F31 every spelling the closing sweep published is removed, and both entry points agree', () => {
  for (const [what, text, credential] of SWEEP_LEAKS) {
    const notice = redactSecrets(text, []);
    const candidate = redactCredentialShapes(text);
    for (const [path, out] of [['the notice path', notice], ['the credential-free path', candidate]]) {
      assert.ok(!out.includes(credential),
        what + ' published its credential on ' + path + ': '
        + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
      assert.equal(redactSecrets(out, []), out,
        what + ' is not a fixed point on ' + path + ': ' + JSON.stringify(out));
    }
    assert.equal(notice, candidate,
      'the two entry points disagree about ' + what + ': '
      + JSON.stringify(notice) + ' vs ' + JSON.stringify(candidate));
  }
});

// The other direction: the ordinary prose BOTH paths must return byte for byte. Every row carries
// one of the words the rules are named after and none of them is a credential header, so no row
// may be rewritten - and the two paths may not disagree about one either.
const SWEEP_PROSE = [
  'The bearer credential held by the gateway is rotated weekly',
  'authorization: required for this feed',
  'authorization: read-only',
  'authorization: "see the notes"',
  'authorization: a failure with no message',
  'authorization: token1 token2',
  'the basic setup is documented',
  'Basic authentication is used',
  'the release said "the architecture is documented" in the notes',
  'rss https://a.example/authorization: request failed for x',
  'authorization: "HTTP 503"',
];

// The documented reading of a scheme: the credential token goes and the prose after it stays,
// because a value that NAMES a scheme stops at the first run of bare words. This row is NOT in the
// byte-identical list above - it is a credential header and its token goes - but the prose half is
// the property the one reading must keep, on both entry points.
test('F31 a scheme\'s whole value goes, on both entry points (Batch 67 corrected the tail)', () => {
  const text = 'Authorization: Basic abcdefgh and then prose';
  // Batch 67 corrected this expectation. It pinned "the prose after a scheme's token survives", and
  // that is false under the whole-value rule the closing sweep's F33-1 forced: the tail was reachable
  // only because the reader stopped at the first atom that was not part of its idea of a header
  // value, and every stop is a credential that publishes. Before: '[redacted] and then prose'
  // After: '[redacted]'. The design cost is the tail of a sentence that literally spells a header
  // name; it is recorded in docs/hardening-2026-10-15/ and named in the implementation's comment.
  assert.equal(redactSecrets(text, []), '[redacted]',
    'the whole value of a scheme-headed header was not consumed: ' + JSON.stringify(redactSecrets(text, [])));
  assert.equal(redactCredentialShapes(text), redactSecrets(text, []),
    'the two entry points disagree about a scheme-headed value');
});

test('F31 ordinary prose is byte-identical through both entry points', () => {
  for (const text of SWEEP_PROSE) {
    assert.equal(redactSecrets(text, []), text,
      'the notice path reaped ordinary prose: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), text,
      'the credential-free path reaped ordinary prose: ' + JSON.stringify(redactCredentialShapes(text)));
  }
  // Batch 67 moved this row out of SWEEP_PROSE: it was byte-identical under the head reading because
  // the reader stopped at 'for', and the whole-value rule consumes the line, so the row is now a
  // RECORDED COST rather than a prose pin. Before (kept byte for byte):
  //   'authorization: see https://a.example/v2 for the details'
  // After (the value is consumed, the URL run inside it is credential-shaped and is replaced):
  //   'authorization: see [redacted] for the details'
  const cost = 'authorization: see https://a.example/v2 for the details';
  assert.equal(redactSecrets(cost, []), 'authorization: see [redacted] for the details',
    'the recorded cost of a URL inside a consumed value moved: ' + JSON.stringify(redactSecrets(cost, [])));
});
// ---------------------------------------------------------------------------------------
// Closing sweep F31-4's neighbour rows (the Batch 61 record left the keyword-reading surface
// measured but not closed) and F31-6. Two of the spellings are the same header NAME written
// differently and are read now: the British 'authorisation', and the underscore-joined
// 'HTTP_AUTHORIZATION' a server dump writes. The rest are recorded BOUNDS, each pinned here byte
// for byte so a later change that closes one is a deliberate one and a change that widens the
// rule beyond it fails this file:
//   - 'Authorization2:' and 'xauthorization:' are names that merely end in the keyword, so no
//     header grammar reads them, and 'xauthorization:' was already asserted to survive above;
//   - '<authorization>' is XML/HTML rather than a header name (there is no ':'),
//   - 'authorization=' and 'authorization ->' use a separator that is not a header's colon, and
//     reading a credential across one would reap prose that uses the word in a sentence;
//   - the '/'-preceded keyword is the notice seam's own defence (F31-6): removing that lookbehind
//     makes the assembly's own '.../authorization: <cause>' seam lose its cause.
const NEIGHBOUR_BOUNDS = [
  'Authorization2: ' + SWEEP_VALUE,
  'xauthorization: ' + SWEEP_VALUE,
  '<authorization>' + SWEEP_VALUE + '</authorization>',
  'authorization= ' + SWEEP_VALUE,
  'authorization -> ' + SWEEP_VALUE,
  'see https://a.example/x/authorization: ' + SWEEP_VALUE + ' now',
];

test('F31-4 a header name joined by an underscore, or spelled the British way, is read', () => {
  for (const text of [
    'HTTP_AUTHORIZATION: ' + SWEEP_VALUE,
    'http_authorization: ' + SWEEP_VALUE,
    'HTTP_X_AUTHORIZATION: ' + SWEEP_VALUE,
    'X_AUTHORIZATION: ' + SWEEP_VALUE,
    'authorisation: ' + SWEEP_VALUE,
    'Authorisation: ' + SWEEP_VALUE,
    'PROXY_AUTHORIZATION: Bearer ' + SWEEP_VALUE,
    'HTTP_AUTHORISATION: Basic ' + SWEEP_B64,
  ]) {
    const notice = redactSecrets(text, []);
    const candidate = redactCredentialShapes(text);
    for (const [path, out] of [['the notice path', notice], ['the credential-free path', candidate]]) {
      assert.ok(!out.includes(SWEEP_VALUE) && !out.includes(SWEEP_B64),
        'the header name was read by nothing on ' + path + ': '
        + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
      assert.equal(redactSecrets(out, []), out,
        'the rewrite is not a fixed point on ' + path + ': ' + JSON.stringify(out));
    }
    assert.equal(notice, candidate,
      'the two entry points disagree about ' + JSON.stringify(text));
  }
});

test('F31-4 and F31-6 the recorded bounds still hold, byte for byte, on both entry points', () => {
  for (const text of NEIGHBOUR_BOUNDS) {
    assert.equal(redactSecrets(text, []), text,
      'a recorded bound was closed or rewritten by the notice path: ' + JSON.stringify(text));
    assert.equal(redactCredentialShapes(text), text,
      'a recorded bound was closed or rewritten by the credential-free path: ' + JSON.stringify(text));
  }
});
