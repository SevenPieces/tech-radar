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
export const CRLF = String.fromCharCode(13, 10);
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
// Batch 69 (closing sweep F34-1). The whole-value rule says the value is everything to the end of
// its line "the wrapped continuation beside it included", but the fold read the continuation only
// when its first atom carried '=', began with a quote, or the line itself opened with ','/';'. A
// credential the surface wrapped onto an indented line of its own was therefore published byte for
// byte on both entry points, and a ','/';' continuation after a PROSE head was never read at all
// (the atom run had already stopped at the prose, so AUTH_SEPARATED_ATOM was never reached). The
// fold's mark is the INDENTATION now -- RFC 7230's obs-fold -- and nothing about the continuation's
// own shape decides it. Every row below is a row the old acceptance test published.
export const FOLD_CONTINUATION_SHAPES = [
  { id: 'bare credential on an indented continuation',
    text: 'authorization: Digest username="u"' + NEWLINE + '  ' + TOKEN_GAP,
    out: '[redacted]', gone: [TOKEN_GAP],
    why: 'the continuation carries no attribute mark at all; the indentation is the fold' },
  { id: 'attribute list wrapped twice, credential on the third line',
    text: 'authorization: a="1"' + NEWLINE + ' b="2"' + NEWLINE + ' ' + TOKEN_GAP,
    out: 'authorization: a="1"' + NEWLINE + ' b="2"' + NEWLINE + ' [redacted]', gone: [TOKEN_GAP],
    why: 'the fold follows an indented line that carries no equality mark as readily as one that does' },
  { id: 'tab-indented continuation',
    text: 'authorization: Digest username="u"' + NEWLINE + '\t' + TOKEN,
    out: '[redacted]', gone: [TOKEN], why: 'a tab is indentation, the mark RFC 7230 names' },
  { id: 'CRLF then an indented continuation',
    text: 'authorization: Digest username="u"' + CRLF + '  ' + TOKEN,
    out: '[redacted]', gone: [TOKEN], why: 'the terminator decides nothing about whether the next line folds' },
  { id: 'non-breaking-space indentation',
    text: 'authorization: Digest username="u"' + NEWLINE + '\u00a0' + TOKEN,
    out: '[redacted]', gone: [TOKEN], why: 'the fold whitespace class carries U+00A0 beside the tab and the space' },
  { id: 'prose head, credential on an indented continuation',
    text: 'authorization: see the notes' + NEWLINE + '  ' + TOKEN,
    out: 'authorization: see the notes' + NEWLINE + '  [redacted]', gone: [TOKEN],
    why: 'a prose head is not an accepted value, but the continuation is still part of it' },
  { id: 'prose head, comma-led continuation',
    text: 'authorization: see the notes' + NEWLINE + '  ,response="' + HEX + '"',
    out: 'authorization: see the notes' + NEWLINE + '  ,response="[redacted]"', gone: [HEX],
    why: 'the list separator opens the continuation; the atom run had stopped at the prose' },
  { id: 'prose head, semicolon-led continuation',
    text: 'authorization: see the notes' + NEWLINE + '  ;' + TOKEN,
    out: 'authorization: see the notes' + NEWLINE + '  ;[redacted]', gone: [TOKEN],
    why: 'the SigV4 separator opens the continuation; nothing read it before Batch 69' },
  { id: 'prose head, attribute continuation',
    text: 'authorization: see Also' + NEWLINE + '  response="' + HEX + '"',
    out: 'authorization: see Also' + NEWLINE + '  response="[redacted]"', gone: [HEX],
    why: 'the row Batch 67 did close, kept here so the fold stays measured in both heads' },
];
// The two lines that are still never continuations. The first is the line rule's own limit -- a
// header value is one line, and the next UNINDENTED line is another field -- and the second is the
// guard the whole-value rule depends on: a line that opens with another credential-header keyword
// is a header of its own and is never swallowed as the previous value's tail. Each row pins the
// whole output, so a rule that folds either line is CAUGHT rather than merely suspected.
export const FOLD_LIMIT_ROWS = [
  { id: 'an indented next header line is not folded',
    text: 'authorization: Digest username="u"' + NEWLINE + '  Authorization: Basic ' + B64,
    out: '[redacted]' + NEWLINE + '  [redacted]',
    why: 'the continuation opens with a header keyword, so it is read as the field it is' },
  { id: 'an unindented next header line is not folded',
    text: 'authorization: Digest username="u"' + NEWLINE + 'authorization: ' + TOKEN,
    out: '[redacted]' + NEWLINE + '[redacted]',
    why: 'indentation is the fold mark; the next field is read by the pass on its own' },
  { id: 'an unindented line of prose is not folded',
    text: 'authorization: Digest username="u"' + NEWLINE + 'ordinary prose on the next line',
    out: '[redacted]' + NEWLINE + 'ordinary prose on the next line',
    why: 'the value is a line; a line of ordinary prose beside it is a different field' },
  { id: 'an indented blank line is not a continuation',
    text: 'authorization: Digest username="u"' + NEWLINE + '  ' + NEWLINE + 'ordinary prose',
    out: '[redacted]' + NEWLINE + '  ' + NEWLINE + 'ordinary prose',
    why: 'an indented line with no atom and no separator is skipped, not stepped over' },
  { id: 'the value ends at its own line terminator',
    text: 'authorization: Digest username="u"' + NEWLINE,
    out: '[redacted]' + NEWLINE,
    why: 'the fold adds lines only when there is an indented continuation to add' },
];
// The bound this rule leaves, measured and pinned rather than left implicit: a continuation with NO
// indentation is not a fold, so a credential standing alone on the next unindented line is
// published. The reach is the module surface -- every candidate field a shipped collector builds
// crosses plainText, which flattens whitespace before the rules see the text, and an unindented next
// line is a different field in every structured surface the rules are handed. Pinned so a later
// widening of the fold is a deliberate act, and so the recorded bound cannot be read as an accident.
export const FOLD_HELD = [
  { id: 'a credential on an unindented next line',
    text: 'authorization: Digest username="u"' + NEWLINE + TOKEN_GAP,
    out: '[redacted]' + NEWLINE + TOKEN_GAP,
    why: 'no indentation, so the next line is not the value; the module shape test still calls this a credential' },
  { id: 'a prose head with an unindented credential continuation',
    text: 'authorization: see the notes' + NEWLINE + TOKEN,
    out: 'authorization: see the notes' + NEWLINE + TOKEN,
    why: 'same bound from the declined side; no text is consumed because no line folded' },
  { id: 'a prose head with an unindented comma continuation',
    text: 'authorization: see the notes' + NEWLINE + ',' + TOKEN,
    out: 'authorization: see the notes' + NEWLINE + ',' + TOKEN,
    why: 'the separator does not fold a line the indentation rule leaves alone' },
];
// Batch 71 (closing sweep F34-2, test integrity). The sweep's own mutation run left the clauses
// below alive through the whole suite: the whitespace-gap continuation that decides whether the run
// reaches an atom two gaps in (its '=' and quote marks), and the punctuation the SCHEME lookup
// strips from the name it reads. Both decide an OUTPUT, not just a leak, so each row below pins the
// whole output - the row fails for the clause's removal, which is what makes it a mutation kill
// rather than a leak check. The comma and the semicolon cannot reach the glue class through a bare
// atom (the atom class excludes both), so the spellings that carry them are the QUOTED ones.
export const VALUE_GRAMMAR_ROWS = [
  { id: 'a whitespace gap continues past an attribute atom',
    text: 'authorization: see usr=1 ' + TOKEN_GAP, out: '[redacted]',
    why: 'the gap atom carries "=", so the run continues and the credential two atoms in is reached' },
  { id: 'a whitespace gap continues past a quoted atom',
    text: 'authorization: see "x" ' + TOKEN_GAP, out: '[redacted]',
    why: 'the gap atom opens with a quote, which is the reader\'s own mark for an attribute' },
  { id: 'a whitespace gap continues past an equality mark alone',
    text: 'authorization: see = ' + TOKEN_GAP, out: '[redacted]',
    why: 'the atom IS the equality mark; the continuation is decided by the mark, not by a value' },
  { id: 'a scheme word glued to a colon',
    text: 'authorization: Basic: rotation is scheduled', out: '[redacted]',
    why: 'the glue strip reads "Basic:" as the listed scheme word "Basic"' },
  { id: 'a scheme word glued to a hyphen',
    text: 'authorization: Basic- rotation is scheduled', out: '[redacted]',
    why: 'a real surface writes the scheme name with a separator glued to it' },
  { id: 'a scheme word glued to a full stop',
    text: 'authorization: Basic. rotation is scheduled', out: '[redacted]',
    why: 'same clause, the third punctuation the atom class can carry' },
  { id: 'a scheme word glued to an exclamation mark',
    text: 'authorization: Basic! rotation is scheduled', out: '[redacted]',
    why: 'same clause, the fourth punctuation the atom class can carry' },
  { id: 'a QUOTED scheme word glued to a comma',
    text: 'authorization: "Basic," rotation is scheduled', out: '[redacted]',
    why: 'a comma never reaches a BARE atom (the atom class excludes it), so the quoted name is the spelling that carries one' },
  { id: 'a single-quoted scheme word glued to a semicolon',
    text: "authorization: 'Basic;' rotation is scheduled", out: '[redacted]',
    why: 'the same for the semicolon, the other separator the glue class strips' },
  { id: 'a quoted scheme word glued to a colon',
    text: 'authorization: "Basic:" rotation is scheduled', out: '[redacted]',
    why: 'the quoted spelling of the glue case the bare colon row already carries' },
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
