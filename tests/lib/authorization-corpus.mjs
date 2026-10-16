// tests/lib/authorization-corpus.mjs
// The corpus the ONE credential-header reader is measured against, in the two directions the rule
// has to hold at once: a header value that carries a credential gives the credential up WHOLE, and
// a value whose head is ordinary prose is left byte for byte. The rows are the closing sweep's
// F32-1 (a credential after a scheme word the list does not carry, and two whitespace-separated
// credential atoms), F32-2 (an attribute list written without commas, and one wrapped across a
// line) and F32-3 (the prose the reader must not reap, and the prose it demonstrably does reap).
//
// Assembled from fragments wherever a name would otherwise be spelled out, so no shipped file --
// this one included -- ever carries a token shape the hygiene guard forbids.
export const TOKEN = 'tok_' + '9f3a2c7d1e5b';
export const SECRET = 'SECRET' + 'TOKEN123';
export const B64 = 'dXNlcjpw' + 'YXNzd29yZDE=';
export const OKTA = '00abc' + '123def456ghi';
export const JWT = 'eyJhbGciOiJIUzI1NiJ9' + '.eyJzdWIiOiIxMjM0';
export const VENDOR_KEY = '9f3a' + '2c7d1e5b';
export const GHP = 'gh' + 'p_' + 'AAAA1111bbbb2222';
export const HEX = 'deadbeef' + '1234';
export const SIG = '9f8e7d6c' + '5b4a3f2e1d0c';
export const AWS_KEY = 'AK' + 'IAEXAMPLE';
// A credential-shaped token and an all-alphabetic one, spelled from fragments for the same reason
// as the tokens above.
export const TOKEN_GAP = 'ABCDEFGH' + '12345678';
export const ALPHA_CRED = 'abcdefgh' + 'ijklmnop';
export const NEWLINE = String.fromCharCode(10);
export const KEYWORDS = [
  'authorization: ',
  'Authorization: ',
  'authorisation: ',
  'HTTP_AUTHORIZATION: ',
  'X_AUTHORIZATION: ',
  'proxy-authorization: ',
  'PROXY_AUTHORISATION: ',
  'authorization&#58; ',
  'authorization&colon; ',
  'authorization&#x3A; ',
  'authorization\uFF1A',
];
export const CREDENTIAL_SHAPES = [
  { id: 'bare shaped token', value: TOKEN, gone: [TOKEN] },
  { id: 'two whitespace-separated atoms', value: TOKEN + ' ' + SECRET, gone: [TOKEN, SECRET] },
  { id: 'unlisted scheme word', value: 'Custom ' + TOKEN, gone: [TOKEN] },
  { id: 'Okta SSWS', value: 'SSWS ' + OKTA, gone: [OKTA] },
  { id: 'DPoP JWT', value: 'DPoP ' + JWT, gone: [JWT] },
  { id: 'scheme with a colon glued to it', value: 'Basic: ' + B64, gone: [B64] },
  { id: 'scheme with a hyphen glued to it', value: 'Basic- ' + B64, gone: [B64] },
  { id: 'scheme with a dot glued to it', value: 'Basic. ' + B64, gone: [B64] },
  { id: 'listed scheme, bare token', value: 'Basic ' + B64, gone: [B64] },
  { id: 'vendor scheme word', value: 'x-api-key ' + VENDOR_KEY, gone: [VENDOR_KEY] },
  { id: 'listed scheme, two atoms', value: 'Bearer ' + TOKEN + ' ' + SECRET, gone: [TOKEN, SECRET] },
  { id: 'token shape, two atoms', value: GHP + ' ' + SECRET, gone: [GHP, SECRET] },
  { id: 'attribute list, whitespace separated',
    value: 'Digest username="u" response="' + HEX + '"', gone: [HEX] },
  { id: 'OAuth attribute list, comma separated',
    value: 'OAuth oauth_consumer_key="abc", oauth_token="' + SECRET + '"', gone: [SECRET] },
  { id: 'SigV4 attribute list, whitespace separated',
    value: 'AWS4-HMAC-SHA256 Credential=' + AWS_KEY + '/20261017 SignedHeaders=host;x-amz-date Signature=' + SIG,
    gone: [SIG, AWS_KEY] },
  { id: 'attribute list wrapped across a line',
    value: 'Digest username="u"\n, response="' + HEX + '"', gone: [HEX] },
  { id: 'quoted token', value: '"' + TOKEN + '"', gone: [TOKEN] },
  { id: 'unlisted scheme word, quoted token', value: 'Custom "' + TOKEN + '"', gone: [TOKEN] },
  { id: 'unlisted scheme word, prose after the token', value: 'Vendor ' + TOKEN + ' more prose', gone: [TOKEN] },
  { id: 'unlisted scheme word, comma continuation', value: 'Vendor ' + TOKEN + ', ' + SECRET, gone: [TOKEN, SECRET] },
];
export const PROSE_KEPT = [
  'authorization: required for this feed',
  'authorization: read-only',
  'authorization: "see the notes" for details',
  'authorization: token1 token2',
  'authorization: a failure with no message',
  'authorization: "see" the appendix of the release',
  'authorization: ref="see the appendix"',
  'The bearer credential held by the gateway is rotated weekly',
  'the basic setup is documented',
  'the release said "the architecture is documented" in the notes',
  'a "quoted" word and a plain one',
  'the authorization layer was refactored last week',
  'contains a missing authorization vulnerability that allows any registered user',
  'HTTP_AUTHORIZATION: read-only',
  'authorisation: read-only',
  'my_authorization: required for this feed',
  'xauthorization: required for this feed',
  'Authorization2: required for this feed',
  'authorization -> required for this feed',
  'authorization= required for this feed',
  'authorization: "HTTP 503"',
];
export const PROSE_COST = [
  { id: 'a scheme word then prose', text: 'authorization: token rotation is scheduled',
    out: '[redacted]',
    why: 'the first atom names the listed scheme word "token"; Batch 67 gives the whole value, tail included' },
  { id: 'a cache directive', text: 'authorization: max-age=3600, must-revalidate',
    out: '[redacted]',
    why: 'the first atom is credential-shaped and the comma continues the value' },
  { id: 'a version after a plain word', text: 'authorization: node v24.18.0', out: '[redacted]',
    why: 'the atom one whitespace gap in is credential-shaped' },
  { id: 'a host and port', text: 'authorization: api.example.com:8443 ...', out: '[redacted]',
    why: 'the first atom is credential-shaped; Batch 67 gives the whole value, the prose beyond it included' },
  { id: 'an HTTP version line', text: 'authorization: HTTP/1.1 401 Unauthorized',
    out: '[redacted]',
    why: 'a line that names a credential header gives the whole value, the version and the status words included' },
  // Batch 67 (closing sweep F33-1). These two rows were PROSE_KEPT before the whole-value rule: the
  // reader stopped at a bare word that carried no credential mark, so the version number at the end
  // was never part of the value. The whole value is the line now, so the version goes with it. The
  // row is recorded here rather than deleted: the design cost is that a sentence naming a header
  // loses its tail, and it is measured, not hidden.
  { id: 'a quoted phrase whose tail carries a version', text: 'authorization: "see the notes" for details see v24.18.0',
    out: 'authorization: "see the notes" for details see [redacted]',
    why: 'the whole value is consumed; only the credential-shaped run inside it is replaced, so the prose stays readable' },
  { id: 'a quoted word whose tail carries a version', text: 'authorization: "see" the appendix of v24.18.0',
    out: 'authorization: "see" the appendix of [redacted]',
    why: 'the whole value is consumed; only the credential-shaped run inside it is replaced, so the prose stays readable' },
  // Batch 67 (the batch's own corpus). The URL-without-userinfo row moved here from PROSE_KEPT: a
  // value the reader consumed is read by the whole-value branch, and the URL becomes a
  // credential-shaped run inside it. The refusal still holds the SEAM (a label ending in
  // 'authorization' followed by the shaper's own diagnosis), which is asserted beside this corpus.
  { id: 'a URL with no userinfo inside a header it consumed', text: 'authorization: see https://a.example/v2 for the details',
    out: 'authorization: see [redacted] for the details',
    why: 'the whole value is consumed and the URL run inside it is credential-shaped by the module rule' },
];
export const SCHEME_WORDS = [
  'basic', 'bearer', 'digest', 'token', 'apikey', 'key', 'signature', 'oauth', 'oauth2', 'jwt',
  'negotiate', 'hawk', 'aws4-hmac-sha256', 'saml',
];
// Batch 67 (closing sweep F33-4, test integrity). The corpus above is one atom position deep: every
// credential shape carries the credential in its FIRST atom or its second, so a rule that reads the
// head and one gap catches them all and the mutation that removes the head acceptance is invisible.
// The rows below put a credential at the tail of a longer value, which is the position the batch's
// own leak (F33-1) used, and they put a non-credential-shaped tail behind a credential so a rule
// that consumes the first token ONLY is caught as well. A corpus that cannot fail for either
// direction proves nothing.
export const TAIL_CREDENTIAL_SHAPES = [
  { id: 'credential after two prose atoms', text: 'authorization: see Also ' + TOKEN_GAP + ' status=200',
    gone: [TOKEN_GAP], why: 'the credential stands two atoms into a prose-headed value' },
  { id: 'credential after a quoted prose head', text: 'authorization: "see the notes" for details ' + TOKEN_GAP,
    gone: [TOKEN_GAP], why: 'the credential stands behind a quoted prose head' },
  { id: 'credential after a URL atom', text: 'authorization: see https://a.example/v2 ' + TOKEN_GAP,
    gone: [TOKEN_GAP], why: 'the credential stands behind a URL that is not itself a header value' },
  { id: 'credential after a refused-value keyword', text: 'authorization: request failed ' + TOKEN_GAP,
    gone: [TOKEN_GAP], why: 'the credential stands behind the transport seam the reader refuses' },
  { id: 'non-shaped tail behind a shaped head', text: 'authorization: ' + TOKEN_GAP + ' and then prose',
    gone: [TOKEN_GAP], why: 'the head is credential-shaped; the prose after it is the value too' },
  { id: 'credential two atom positions into a wrapped list',
    text: 'authorization: Digest username="u"' + NEWLINE + '  response="' + HEX + '"' + NEWLINE + '  extra="' + TOKEN_GAP + '"',
    gone: [TOKEN_GAP], why: 'the wrapped continuation carries a second folded line' },
];
// The other direction, measured beside the shapes above: a credential the module's own shape test
// does not call a credential (no digit anywhere) stays readable wherever it stands, because the
// shape test is the module's definition of a secret. Recorded so the bound is visible and a later
// change that closes it is deliberate.
export const TAIL_CREDENTIAL_HELD = [
  { id: 'all-alpha token after two prose atoms', text: 'authorization: see Also ' + ALPHA_CRED,
    why: 'no digit anywhere, so it is not credential-shaped by the module rule' },
];
export const PROSE_TAILS = [
  'rotation is scheduled for next week',
  'rotation is documented in the runbook',
  'the setup is documented',
  'headers are described in the appendix',
  'the release notes name it',
  'support was added last year',
  'is deprecated as of this version',
  'rotation happens every quarter',
  'the appendix describes it',
  'the runbook names it',
];
