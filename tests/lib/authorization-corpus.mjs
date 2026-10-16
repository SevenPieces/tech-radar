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
  'authorization: see https://a.example/v2 for the details',
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
  'authorization: "see the notes" for details see v24.18.0',
  'authorization: "see" the appendix of v24.18.0',
];
export const PROSE_COST = [
  { id: 'a scheme word then prose', text: 'authorization: token rotation is scheduled',
    out: '[redacted] is scheduled',
    why: 'the first atom names the listed scheme word "token" consumed whatever the value spells' },
  { id: 'a cache directive', text: 'authorization: max-age=3600, must-revalidate',
    out: '[redacted]',
    why: 'the first atom is credential-shaped and the comma continues the value' },
  { id: 'a version after a plain word', text: 'authorization: node v24.18.0', out: '[redacted]',
    why: 'the atom one whitespace gap in is credential-shaped' },
  { id: 'a host and port', text: 'authorization: api.example.com:8443 ...', out: '[redacted] ...',
    why: 'the first atom is credential-shaped; the prose beyond it stays' },
  { id: 'an HTTP version line', text: 'authorization: HTTP/1.1 401 Unauthorized',
    out: '[redacted] 401 Unauthorized',
    why: 'the first atom is credential-shaped; the status words after it stay readable' },
];
export const SCHEME_WORDS = [
  'basic', 'bearer', 'digest', 'token', 'apikey', 'key', 'signature', 'oauth', 'oauth2', 'jwt',
  'negotiate', 'hawk', 'aws4-hmac-sha256', 'saml',
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
