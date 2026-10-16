// scripts/lib/net.mjs
// Fetch, charset decoding and feed parsing for the tech-radar skill.
// Zero dependencies. Uses curl through child_process so that HTTP behaviour is the
// same wherever this runs, and so no polyfill or bundled dependency is needed.
import { execFileSync } from 'node:child_process';

export const DEFAULT_UA = 'tech-radar/1.0';

// The set a shaped text was priced against, kept OUT of the error object: the field used to be an
// own enumerable property, so JSON.stringify, a stack dump or any future error logger would have
// published the request's credential values in plaintext (F26-3). The WeakMap carries the same fact
// to the same reader -- repriceShapedError -- without putting a credential where a serializer can
// reach it. An error the shapers did not build has no entry and prices against the caller's set
// alone, exactly as before.
const PRICED_SECRETS = new WeakMap();
function recordPricedSecrets(shaped, secrets) {
  PRICED_SECRETS.set(shaped, [...secrets]);
}
function pricedSecretsOf(err) {
  try {
    return PRICED_SECRETS.get(err) ?? [];
  } catch {
    return [];
  }
}

// curl -w appends this after the last byte of the response, so the final line of
// the captured bytes is always the HTTP status and never part of the body. This
// needs no option newer than -w, which every curl in the field has: the earlier
// --fail-with-body approach required curl 7.76 and made an older curl fail every
// transfer on an unknown-option error.
const WRITE_OUT = '\n%{http_code}';

// A URL reaches a notice, and a notice reaches stdout, the pool and the digest. Userinfo and a
// query parameter are where a secret lives, and a notice prints the request only to name it: the
// whole query is therefore dropped with the userinfo, whichever name carries it, while the
// scheme, the host and the path stay. Collection is narrower - a query value is collected only
// when its name is credential-shaped - but a URL printed into a notice drops every parameter
// rather than deciding which one is safe, so no spelling of api-key, client_secret,
// X-Amz-Signature or AWSAccessKeyId can reach it. Pure and offline-testable.
export function redactUrl(url) {
  const raw = String(url ?? '');
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    // Not a URL the parser accepts: drop the credential- and secret-bearing parts by hand.
    return raw.replace(/\/\/[^/?#\s]*@/, '//').replace(/[?#][\s\S]*$/, '');
  }
}

// curl's own diagnostic line is never quoted now -- the transport cause is shaped from its exit
// code -- but a child-process message from any other thrown error can still carry the whole argv,
// which is where an Authorization header lives, and every notice is redacted against these shapes
// before it is published. Anything shaped like
// that header or its Bearer value is removed before the text can reach a notice. The
// authorization shape consumes the scheme as well as the first word: matching only up to the
// first space deleted the word 'Basic' and left the credential behind in full. The scheme's
// own token has to be credential-shaped as well, so prose that merely says 'a Bearer token'
// stays readable while a real value goes; MIN_SECRET_CHARS is that shape's floor.
// The authorization shape removes the credential VALUE and nothing else. The earlier rule consumed
// the scheme plus one further token unconditionally, so a watchlist target whose own path ends in
// 'authorization' supplied the word, the ': ' separator supplied the colon, and the rule ate the
// first words of whatever followed -- a transport cause lost its leading word and a pushed HTTP
// status disappeared (S26-F5). It now looks at what stands after the colon: a recognised scheme (or
// a first token that is itself credential-shaped) means the credential-bearing token is the one
// after it, while an unrecognised first token is consumed alone and the token after it survives. A
// token is credential-shaped when it carries a non-alphabetic marker -- a digit or one of the
// +/=._- characters a base64, hex or JWT value is built from -- so the word '403' after 'HTTP' and
// the word 'resolve' after 'could' are prose and stay readable.
const AUTH_SCHEMES = new Set([
  'basic', 'bearer', 'digest', 'token', 'apikey', 'key', 'signature', 'oauth', 'oauth2', 'jwt',
  'negotiate', 'hawk', 'aws4-hmac-sha256', 'saml',
]);
const AUTH_TOKEN_CHARS = '[^\\s,;"\']+';
function credentialShapedToken(token) {
  return token.length >= MIN_SECRET_CHARS
    && /[0-9]/.test(token)
    && !/^[0-9]+$/.test(token);
}
// The plain shapes: each one is removed by replacing what it matched. The authorization rule is
// NOT here -- it has to read what follows its own match to know whether the next token is the
// credential, and a plain replacement would remove the keyword before that decision could be made.
// It runs as its own rule, 'redactAuthorizationShapes', beside this list.
const SECRET_SHAPES = [
  /\bBearer\s+[^\s,;"']{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{6,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
];
// Two refusals keep a SOURCE's path from being read as a header, and both are about the text after
// the colon, never about the keyword:
//   - a token that begins a URL is refused ('authorization: https://...' is the assembly's own seam
//     beside a request, not a header value), and
//   - a run of whitespace after the token is refused, because a header's value stands alone while
//     the notice's reason is prose ('authorization: a failure with no message' is the seam beside
//     the synthetic reason, not a header).
// Without them the rule removed the first word of a notice's own diagnosis for every watchlist
// target whose path ends in 'authorization', and the published notice was not even a fixed point of
// its own pass. Every other token the seam can hand the rule is consumed exactly as before.
// The URL refusal reads the URL's own userinfo now: a header value that IS a URL carries its
// credential in the userinfo, and refusing the whole shape because it begins a URL published
// 'authorization: https://user:s3cr3tp4ss@host/path' byte for byte (sweep F28-4). The refusal still
// fires for a URL with no userinfo, which is the assembly's own seam and carries no credential, and
// a run of not-whitespace after a refused URL is not consumed either. The 'request failed' refusal
// is the other half of the notice seam: the shaper's transport detail begins with those two words,
// and without it a source label ending in the bare word 'authorization' lost the word 'request' from
// its own diagnosis (verification F28-3, transport half).
// A header VALUE can also stand in QUOTES, and the token class above excludes both quote characters,
// so a bare quoted value never matched at all and was published byte for byte at every cap
// ('authorization: "tok_..."', "authorization: 'tok_...'", the real 'authorization: "Bearer <token>"'
// and an AWS SigV4 'authorization: "AWS4-HMAC-SHA256 Credential=..., Signature=..."'). The quoted
// alternatives are read as ONE token, and it is the QUOTED form that is refused or consumed -- the
// value inside the quotes is what the refusal tests, so a quoted URL keeps its userinfo removal and
// the notice's own 'request failed for ...' seam still publishes. Prose that merely carries a quote
// in a sentence is untouched, because this rule only starts after an authorization header keyword:
// measured, 'the release said "the architecture is documented" in the notes' is returned byte for
// byte.
//
// Batch 56 (sweep F30-2, Med; sweep F30-3b, Low). Three things the Batch 54 spelling did not read:
//   - the trailing lookahead '(?![\s,;"']\s)' stood OUTSIDE the alternation, so it applied to the
//     quoted alternatives too. A quoted alternative cannot backtrack INSIDE its quotes, so when the
//     closing quote was followed by a separator and whitespace or by two whitespace characters
//     ('", more', '"; more', two spaces, a tab indent, a CRLF, two no-break spaces) the lookahead
//     failed and the regex found NO match at all - the common shape in the text these rules read (a
//     wrapped log line, an indented list). The lookahead is now part of the BARE alternative alone,
//     where it can still backtrack to a shorter token, and the quoted alternatives are followed by
//     whatever they are followed by: a separator, whitespace, or the end of the text.
//   - an escaped quote inside the value ('authorization: "tok\"TOKEN"') ended the quoted run at the
//     escape, and the rest of the value was published. The quoted alternatives read a backslash
//     and the character after it as one character of the value, so the whole run is one token.
//   - a quoted run with no closing quote ('authorization: "TOKEN') is read DELIBERATELY now: it runs
//     to the end of the text and is consumed like any other header value. The alternative reading -
//     leave an unterminated quote where it stands - publishes the credential, and the two things a
//     notice's own diagnosis needs are protected before this rule ever sees them: a scaffold span
//     inside the match is kept byte for byte by the branch in redactAuthorizationShapes, and a value
//     that begins 'request failed' is refused below. The last-resort alternatives are therefore after
//     the closed ones, so a value that does close is read as the closed token it is.
const AUTH_QUOTED_VALUE = '(?:"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*|\'(?:[^\'\\\\]|\\\\.)*)';
const AUTH_BARE_VALUE = '[^\\s,;"\']+(?![\\s,;"\']\\s)';
const AUTHORIZATION_SHAPE = new RegExp(
  '((?<!\\/)\\b(?:proxy-)?authorization\\s*:\\s*)(' + AUTH_QUOTED_VALUE + '|' + AUTH_BARE_VALUE + ')',
  'gi',
);

// The two refusals above, read from the text after the HEADER'S OWN COLON before the match is made,
// so that the quoted and the unquoted spelling of the same header value are refused by one rule: a
// header value may be quoted or not ('"https://user:pw@host/path"' is the same value as the bare
// spelling), and the earlier lookahead read only the bare spelling - which is why a quoted
// credential was never read at all while a quoted URL had to be refused. The colon is the one the
// keyword carries, not the match's last one (sweep F30-3b): the match is the keyword AND the value,
// so reading from 'match[0].lastIndexOf(':')' moved the read whenever the value itself carried a
// colon - 'authorization: "note: request failed TOKEN"' was read from ' request failed TOKEN"' and
// refused whole (publishing the credential), while 'authorization: "https://a.example:8443/x"' was
// read from '8443/x"' and consumed (the assembly's own seam, which is refused when it is read
// whole). The text is read with its surrounding quotes
// peeled, which is how the shaper's own transport seam is recognised:
//   - a URL that carries no userinfo is the assembly's own seam beside a request ('authorization:
//     https://a.example/x') and has no credential to remove, so it is left where it stands; a URL
//     that DOES carry userinfo is a header value and goes (sweep F28-4);
//   - a value that begins 'request failed' is the shaper's transport detail beside the seam, not a
//     header value, so the notice's own wording survives (verification F28-3, transport half).
// Both are read from the WHOLE run after the colon and not from the matched token: the transport
// detail is two words, and a refusal that saw only the matched token consumed the word 'request' and
// left '[redacted] failed for ...' - which is the diagnosis the refusal exists to keep.
function authorizationValueRefused(rest) {
  const raw = String(rest).trim();
  const value = raw.length >= 2
    && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
    ? raw.slice(1, -1) : raw;
  // The authority is what stands between the '//' and the first '/' or whitespace, and it is read
  // whole: a userinfo password may contain a '/', so a character-class test that excluded the slash
  // read 'user:s3cr3tp4ss@host/path' as carrying no userinfo and refused a header value the Batch 49
  // rule removes.
  if (/^(?:\/\/|https?:\/\/)/i.test(value)) {
    const authority = value.replace(/^[a-z]+:/i, '').replace(/^\/\//, '').split(/[/\s]/, 1)[0];
    return !authority.includes('@');
  }
  return /^request failed/i.test(value);
}

// The one shape in the list above that has to read what FOLLOWS its match: the authorization rule
// consumes the token after the scheme it matched, and only when that token is the credential. The
// replacer receives the end of the match and the text, reads the next token with the lookahead
// above, and returns what the sentinel replaces. Both passes of the redaction call it, so the
// single-token match the list makes and the two-token removal the credential calls for stay in one
// place.
const NEXT_AUTH_TOKEN = new RegExp('^\\s+(' + AUTH_TOKEN_CHARS + ')');
// The rest of a header VALUE once the credential-bearing token has been read: a quoted string that
// stands against the token ('oauth_consumer_key="..."') and any comma-separated continuation of the
// same attribute list. A whitespace-separated run of bare prose is NOT part of it, which is what
// keeps 'Authorization: Basic abcdefgh and then prose' readable. The rule consumed one token and
// stopped, so an OAuth or Digest attribute list published its quoted credential
// ('OAuth oauth_consumer_key="abc", oauth_token="SECRETTOKEN123"' -> '[redacted]"abc",
// oauth_token="SECRETTOKEN123"'; sweep F28-4).
const AUTH_VALUE_TAIL = /^(?:\s*"[^"]*"|\s*'[^']*'|\s*,\s*(?:[^\s,;"']+|"[^"]*"|'[^']*'))*/;
// The scaffold branch below: a match that carries a scaffold span is not a header value to consume
// whole, and it is not raw text to publish whole either - the two halves of one value have to part
// company (sweep F30-3). The span is the module's own diagnosis and is kept byte for byte; every
// OTHER run of the same value is read as a token, and only a token that is credential-shaped - the
// module's own definition, a digit-bearing run of at least MIN_SECRET_CHARS characters - is
// consumed. That is what keeps '"HTTP 503"' whole (the only non-scaffold runs in it are the two
// quote characters, which carry no credential) while '"HTTP 503 tok_9f3a2c7d1e5b"' gives up the
// credential and keeps the status.
const AUTH_VALUE_TOKEN_RE = /[^\s,;"']+/g;
function consumeCredentialShapedTokens(text) {
  return String(text).replace(AUTH_VALUE_TOKEN_RE, (token) => {
    if (token.includes(SCAFFOLD_PLACEHOLDER)) return token;
    return credentialShapedToken(token) ? REDACTION_SENTINEL : token;
  });
}
function redactAuthorizationShapes(text) {
  const source = String(text);
  let out = '';
  let at = 0;
  for (const match of source.matchAll(AUTHORIZATION_SHAPE)) {
    // A match whose value carries the scaffold placeholder is the notice's OWN diagnosis, masked by
    // protectScaffold, and never a header value to consume: the placeholder is written by this module
    // and normalised out of every input and every value, so the only text that can carry one is a
    // span protectScaffold wrote. Consuming it whole deleted the HTTP status from every notice whose
    // source label ends in the bare word 'authorization' (verification F28-3), and skipping the WHOLE
    // match published a credential standing beside the span ('authorization: "HTTP 503 tok_..."';
    // sweep F30-3). The two readings are reconciled here: the span is kept byte for byte and every
    // other credential-shaped token of the match is consumed, so a match whose value is only the span
    // ('authorization: <HTTP 503>') comes back byte-identical, and a value that carries both keeps
    // the diagnosis and gives up the credential. The span is restored at the end of the pass as any
    // other is.
    const headerText = match[1];
    const matchedValue = match[2];
    if (matchedValue.includes(SCAFFOLD_PLACEHOLDER)) {
      out += source.slice(at, match.index) + consumeCredentialShapedTokens(match[0]);
      at = match.index + match[0].length;
      continue;
    }
    // The two refusals read the text after the header's own colon WHOLE, not the matched token: the
    // transport seam is the two-word phrase 'request failed', and a refusal that saw only its first
    // word consumed that word and left '[redacted] failed for ...' where the notice's own wording
    // belongs.
    if (authorizationValueRefused(source.slice(match.index + headerText.length))) continue;
    const first = matchedValue;
    const next = NEXT_AUTH_TOKEN.exec(source.slice(match.index + match[0].length));
    const consumeSecond = next !== null
      && !next[1].includes(SCAFFOLD_PLACEHOLDER)
      && (AUTH_SCHEMES.has(first.toLowerCase()) || credentialShapedToken(next[1]));
    out += source.slice(at, match.index) + REDACTION_SENTINEL;
    at = consumeSecond ? match.index + match[0].length + next[0].length : match.index + match[0].length;
    if (consumeSecond) {
      // The attribute list is consumed only while it is the shaper's own text or a value: a
      // placeholder inside it belongs to the scaffold and stops the consumption there.
      const tail = AUTH_VALUE_TAIL.exec(source.slice(at));
      if (tail !== null && tail[0] !== '' && !tail[0].includes(SCAFFOLD_PLACEHOLDER)) at += tail[0].length;
    }
  }
  return out + source.slice(at);
}

// The floor for removing a value by exact match. It applies to the free text the shape list
// above covers and to the words a header value splits into -- the runs of text that are ordinary
// as often as they are a credential. It is not applied to the request's userinfo, to a
// credential-named query value at or above its own floor, or to a header value collected whole,
// because those are credential positions whatever they spell; the floor there published a
// seven-character token and a two-character password in the notice, the pool and the coverage
// note. Keeping the floor for the rest is what keeps a notice readable: removing it from every
// URL-carried value reaped the collector's own diagnostics, so a production pool published
// 'resets 2026-[redacted]-15T18:18:21.000Z' and 'listing capped at [redacted] entries' where the
// previous run carried both intact. A query value whose name is not credential-shaped is not
// collected at all -- the collector's own '?sortOrder=descending' and '?max_results=40' are
// exactly what that keeps out -- and the shape list above covers the credential classes a curated
// set cannot know.
const MIN_SECRET_CHARS = 8;

// A credential-named query parameter is a credential position in a notice, but a value of one or
// two characters is an ordinary word as often as it is a credential: a feed whose target carried
// '?code=on' reaped the word 'on' from every published field and turned 'Python on Windows' into
// 'Python [redacted] Windows'. Three characters is the floor for the notice removal set. The
// candidate pass has its own, higher floor below (MIN_SECRET_CHARS): a notice is redacted at the
// push and an over-broad removal there costs the run's only diagnosis, while the candidate fields
// are the prose the digest is written from.
const MIN_CREDENTIAL_VALUE_CHARS = 3;

function looksLikeValue(value) {
  const v = String(value ?? '');
  return v.length >= MIN_SECRET_CHARS && !/^\d+$/.test(v);
}

// A query parameter whose name is credential-shaped holds a credential, and no other query
// parameter's value is collected at all. The name is lower-cased with every non-alphanumeric
// character removed, and a stem is matched either as one whole token of the name or as a suffix of
// that stripped form -- never as a substring anywhere in it. A fused spelling is the same
// parameter to the server and no curated list can know the operator's spelling, so the suffix
// carries every fused spelling (apikey, accesstoken, refreshtoken, clientsecret, privatekey,
// subscriptionkey, sshkey), while the token carries the delimited ones whose tail is not the stem
// itself (AWSAccessKeyId ends in 'id', not 'key'; X-Amz-Signature ends in 'nature', not 'sig').
//
// Matching a token or a suffix rather than a substring is what keeps an ordinary name out of the
// credential rule: 'author' carries 'auth' but does not end with it, 'design' and 'assign' carry
// 'sig' only in the middle, 'keyword' carries 'key' only at the front, and 'statuscode',
// 'countrycode', 'zipcode', 'recode' and 'decoder' carry no stem once 'code' is matched by its own
// name rather than as a suffix. An ordinary name that does end with a shorter stem ('monkey' ends
// in 'key', 'bypass' ends in 'pass') still takes the rule; that is the safe direction, and the
// value floors below keep an ordinary short value under such a name out of the candidate set, and
// a one- or two-character one out of the notice set as well.
const CREDENTIAL_STEMS = [
  'pass', 'pwd', 'pw', 'pswd', 'secret', 'token', 'auth', 'key', 'sig', 'signature',
  'session', 'credential', 'cookie', 'bearer', 'jwt', 'otp', 'pin', 'hmac', 'ticket', 'assertion',
  'saml', 'samlresponse', 'nonce', 'digest',
  // The family the early rows named and the stem rule still missed: a request sends its own
  // credential under the operator's spelling, so 'password', 'passwd', 'passphrase', 'passcode',
  // 'sessionid', 'secrets', 'credentials', 'cookies', 'authorization', 'hash' and 'clientid' are
  // credential positions like the spellings above. 'authorization' ends in the 'auth' stem already;
  // the rest are spelled out because their tail is not one of the stems ('password' ends in 'word',
  // 'sessionid' in 'id') or because a plural is not the singular the stem carries ('secrets',
  // 'credentials', 'cookies').
  'password', 'passwd', 'passphrase', 'passcode', 'sessionid', 'secrets', 'credentials',
  'cookies', 'clientid',
];

// The names that are too ordinary to take as a whole. 'state', 'status', 'st', 'sid', 'sso',
// 'mac', 'hash' and 'uuid' are real words or fragments of them (status, manifest, obsidian,
// glasshouse, tarmac, hashmap), so matching them as a SUFFIX of the separator-stripped name would
// put an ordinary parameter into the credential rule -- exactly the direction the token-or-suffix
// rule exists to avoid, and the direction TR-116 measured (author/statuscode and the rest). They
// are matched as a whole token of the name instead, which is where the credential actually stands:
// '?state=', 'oauth_state', 'session_state', '?sid=', '?sso=', '?mac=', '?hash=' and '?uuid=' all
// collect, while 'manifest', 'protest', 'realestate', 'obsidian', 'glasshouse', 'tarmac' and
// 'hashmap' do not.
//
// 'status' is in this list for a different reason and not as a synonym of 'state': a code-carrying
// parameter is a credential position here, and '?status=500' is the same shape as '?code=500'.
// It is a token-only stem for the same reason 'code' is not a suffix: 'statuscode' ends in 'code'
// and carries 'status' at its front, and both are ordinary names TR-116 keeps out of the rule.
const CREDENTIAL_TOKENS = [
  'st', 'state', 'status', 'sid', 'sso', 'mac', 'hash', 'uuid', 'authorization',
];

// The session, anti-CSRF and crypto-material spellings the server actually uses, which neither the
// stem list nor the token list above reaches: 'PHPSESSID' does not end in 'session' and neither does
// 'sessid', 'ssoid' ends in 'id', and '_csrf', 'xsrf', 'mfa', 'pwdhash' and 'webhook' carry no stem
// at all. They are credential positions the way the family above is (F28-6 / sweep F28-2): the value
// authenticates a session, guards a request, or is the keyed material itself.
//
// 'identity' and 'salt' are deliberately NOT here, and that is the whole of the judgement this list
// makes. 'identity' is an ordinary noun a descriptive parameter uses ('?identity=employee'); what
// stands under it is the subject a request is about as often as a token. A salt is a public per-key
// value by construction and is useless without the hash it sits beside, so it is not a credential
// either. Taking either would put an ordinary configured word into the removal set, which is the
// over-redaction direction TR-110 and TR-116 exist to keep out.
const CREDENTIAL_FUSED = [
  'phpsessid', 'sessid', 'ssoid', 'csrf', 'xsrf', 'mfa', 'pwdhash', 'webhook',
];

// A code-carrying parameter is matched by its whole name only: 'code' alone (?code=...) and a name
// that spells it as its own token (code_verifier, auth_code) are the explicit code-carrying names
// this rule keeps, while 'code' is not a suffix stem -- the ambiguous spelling that made
// statuscode, countrycode, zipcode, recode and decoder credential positions.
const CREDENTIAL_CODE_TOKEN = 'code';

// The tokens of a name: a separator or a lower-to-upper case transition starts one, so
// 'auth_token', 'AWSAccessKeyId' and 'X-Amz-Signature' are split where a reader would read them.
function nameTokens(name) {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
}

// The name in the form the suffix rule is defined on.
function normalizedParamName(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isCredentialName(name) {
  const normalized = normalizedParamName(name);
  if (normalized === '') return false;
  for (const token of nameTokens(name)) {
    if (token === CREDENTIAL_CODE_TOKEN) return true;
    if (CREDENTIAL_STEMS.includes(token) || CREDENTIAL_FUSED.includes(token)) return true;
    if (CREDENTIAL_TOKENS.includes(token)) return true;
  }
  return CREDENTIAL_STEMS.some((stem) => normalized.endsWith(stem))
    || CREDENTIAL_FUSED.some((stem) => normalized.endsWith(stem));
}

// The SECOND of the two questions isCredentialName answers, and the one the candidate pass asks:
// may a value under this name rewrite a published word in the pool? A name is credential-BEARING
// when a genuinely credential-bearing spelling (a stem, or one of the session/CSRF fused spellings)
// spells it. The token-only names of CREDENTIAL_TOKENS are NOT: 'state', 'status', 'st', 'sid',
// 'sso', 'mac', 'hash', 'uuid' and 'authorization' are real words or fragments of them, and a
// configured target whose ordinary parameter carries one of them - '?state=archived',
// '?status=releases', '?uuid=identifier' - put the ordinary value 'archived' into the candidate
// union, and the candidate pass then rewrote the published prose of an unrelated source
// ('the archived releases' became 'the [redacted] releases'). That is a regression of exactly the
// class TR-110 closed, and this is where the two questions come apart (sweep F28-1, Med).
//
// This is now the WHOLE of the candidate question: a token-only name is not a candidate position
// for any value, at any length. Batches 46 and 51 had made the value's own shape the second
// question and left this one half in force, which published an 8-11 character lower-case credential
// ('?state=abcdefghijk') while reaping the twelve-character ordinary words that are the same shape;
// Batch 53 deleted that second question and the threshold with it. The residual it leaves is
// recorded above: a credential that stands under a token-only name is not in the candidate set, so
// an answer echoing it publishes it - the notice echo is still redacted, because the value stays in
// the notice set.
function isCredentialBearingName(name) {
  const normalized = normalizedParamName(name);
  if (normalized === '') return false;
  for (const token of nameTokens(name)) {
    if (token === CREDENTIAL_CODE_TOKEN) return true;
    if (CREDENTIAL_STEMS.includes(token) || CREDENTIAL_FUSED.includes(token)) return true;
  }
  return CREDENTIAL_STEMS.some((stem) => normalized.endsWith(stem))
    || CREDENTIAL_FUSED.some((stem) => normalized.endsWith(stem));
}

// A TOKEN-ONLY name is not a candidate position AT ALL - not for any value, at any length, in any
// shape - and the candidate half of the rule is now exactly the name question above. Batches 46 and
// 51 decided it by the VALUE instead: a value under a token-only name became a candidate when it
// carried a digit, a capital or a non-alphanumeric mark, or when it was a pure lower-case word of at
// least twelve characters. That gate failed in BOTH directions and no threshold repairs it, which is
// why it is gone rather than re-tuned (verification F29-1 and closing sweep F29-1/F29-2, both
// measured on the shipped paths):
//
//   - too narrow: a pure lower-case credential of 8-11 characters carries no mark and is under the
//     threshold, so '?state=abcdefghijk' left the candidate set while the identical value under
//     '?token=' stayed in it, and an answer echoing it published it in the pool ('the server echoed
//     abcdefghijk back', where b2a7dc9 redacted it);
//   - too wide: every ordinary English word of twelve or more characters carries no mark either, so
//     '?state=configuration', '?state=documentation', '?state=architecture' and
//     '?status=infrastructure' put an ordinary configured value into the candidate union and the
//     candidate pass rewrote a feed's published prose with it ('[redacted] drift in the podspec is a
//     common failure'), including through the ordinary compounds '?mac-address=configuration',
//     '?x-state=documentation' and '?state-of-the-art=architecture'.
//
// The design decides the tie, and TR-110 states it where the candidate set is applied
// (collect.mjs): 'a value that is ordinary configuration is not a credential and never rewrites
// published prose'. Over-redaction of the published digest is the worse failure, so a token-only
// name contributes nothing to the candidate set and everything to the notice set.
//
// The name as the server reads it: a percent-encoded spelling of a credential name is the same
// parameter to the server, so it is the same parameter here. Both the stem list and the token rule
// are re-run on the decoded form.
function credentialParam(name) {
  const raw = String(name ?? '');
  if (isCredentialName(raw)) return true;
  try { return isCredentialName(decodeURIComponent(raw.replace(/\+/g, ' '))); } catch { return false; }
}

// The same question for the candidate pass: the name is credential-BEARING, so a value under it is
// a credential whatever it spells and is collected for the candidate set unconditionally. Read from
// the same decoded form, because a percent-encoded credential name is the same parameter to the
// server.
function candidateCredentialParam(name) {
  const raw = String(name ?? '');
  if (isCredentialBearingName(raw)) return true;
  try { return isCredentialBearingName(decodeURIComponent(raw.replace(/\+/g, ' '))); } catch { return false; }
}

// How long a value is once the server has decoded it, which is the value the floor is about: a
// two-character value spelled out as percent-encoded pairs is still a two-character value.
function decodedValue(value) {
  const raw = String(value ?? '');
  try { return decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { return raw; }
}
function decodedLength(value) {
  return decodedValue(value).length;
}

// A Basic credential is the base64 of 'user:password', so it is recognised as one: the token
// decodes to printable text carrying the colon. Matching by that property leaves a body that
// merely says 'Basic authentication' readable while a server that echoes the request's
// credential gives it up. The replacement is the sentinel every other removal writes, never a
// marker: a real marker written here would be read back by this same pass whenever a collected
// value is a substring of the marker ('Basic <b64>' -> 'Basic [[redacted]]'), and the marker
// would also change the word boundary the rule's own '\b' anchor reads, so a Basic credential
// this pass had missed would be removed by the pass that followed it -- a removal applied after
// the cap was charged, and a lengthening (the 10-character marker against an 8-character token)
// exactly where the fixed-point contract forbids one.
// The token is read by trying every tokenisation of the run of base64 characters that follows
// 'Basic ' and keeping the longest one that decodes to 'user:password'. The single greedy match
// failed that test whenever one unpadded blob stood immediately against another -- the run held both
// blobs and their joining text, the decode failed and NOTHING was removed -- so a foreign credential
// echoed into an RSS title reached the published candidate pool (F26-2). Shortening the candidate
// one character at a time finds the blob, and an ordinary word still decodes to nothing that carries
// a colon, so no prose is reaped.
function decodedBasicToken(text) {
  // The text starts at the whitespace the 'Basic' keyword requires, and the run of base64
  // characters ends at the first separator: the token is a prefix of it, which is why the loop
  // below shortens the run instead of matching it whole.
  const prefix = /^\s+([A-Za-z0-9+/]+={0,2})/.exec(' ' + String(text));
  if (prefix === null) return null;
  const run = prefix[1];
  for (let length = run.length; length >= 8; length -= 1) {
    const candidate = run.slice(0, length);
    // Base64 never carries exactly one leftover character, so a run of length 1 (mod 4) is not a
    // token: the decoder silently drops the extra character, and a candidate whose last character
    // was really the first letter of the NEXT credential then decoded to a printable pair and was
    // accepted -- which carried the rest of that credential through (F26-2).
    if (length % 4 === 1) continue;
    // The run ends in padding ('=' is in the character class), and a base64 token carries at most
    // two of them, at the end. A run that continues past '==' is a longer run whose tail happens to
    // be padding: decoding the candidate drops the extra characters and can still produce a
    // printable pair, so the tail is refused and the loop tries the shorter tokenisation.
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(candidate)) continue;
    let decoded = '';
    try { decoded = Buffer.from(candidate, 'base64').toString('utf8'); } catch { continue; }
    // The decoded text has to be a credential pair: printable, and a non-empty user and password
    // around the colon. 'Basic auth', 'Basic authentication' and every other ordinary word decode
    // to text that carries no colon and are left alone.
    if (!/^[\x20-\x7e]+$/.test(decoded) || !/^[^:=]+:[^:=]+$/.test(decoded)) continue;
    return candidate;
  }
  return null;
}
function redactBasicCredentials(text) {
  // Only the TOKEN is replaced, in place: the keyword and its whitespace stay, so a caller that
  // publishes the line reads exactly what it read before and the rule composes with every other
  // one. The token is found by trying every tokenisation of the base64 run that follows the
  // keyword and keeping the longest that decodes to 'user:password' -- the greedy single match this
  // replaced swallowed the keyword of the NEXT credential whenever two unpadded blobs stood
  // back-to-back, the decode failed and NOTHING was removed (F26-2). A run of length 1 (mod 4) is
  // not a token and a candidate that carries padding in its middle is not one either: the decoder
  // drops the leftovers and can still produce a printable pair, which is how a candidate that was
  // really the next credential's first letter was accepted.
  //
  // 'Basic' is matched as a word of its own: the lookbehind refuses the five letters at the tail of
  // an unpadded base64 run ('gBasic' is one token), so a keyword glued to a word this scan has not
  // removed is copied through untouched and ordinary prose is left alone.
  //
  // The scan is a single left-to-right sweep over the ORIGINAL text, and it accepts a keyword that
  // stands at the resume point of the token it just removed even though the original character
  // before it is a word character. In a back-to-back unpadded chain ('Basic <blob>Basic <blob>...')
  // every keyword after the first is glued to the last character of the blob before it, so a
  // lookbehind over the original text can see only the first occurrence: the pass removed one shape,
  // the sentinel exposed the next keyword for the FOLLOWING pass, and a chain of about 200 needed
  // more removal passes than the loop's bound -- the text was not a fixed point and a later pass
  // kept removing (and lengthening) a notice whose cap had already been charged. The resume point is
  // the one place a keyword may be accepted without the boundary, because the character before it is
  // the tail of a credential this sweep already took out.
  const source = String(text);
  let out = '';
  let at = 0;
  let resumeAt = -1;
  const pattern = /Basic/gi;
  for (const match of source.matchAll(pattern)) {
    const idx = match.index;
    if (idx < at) continue;
    const prev = idx === 0 ? '' : source[idx - 1];
    if (/[A-Za-z0-9_]/.test(prev) && idx !== resumeAt) continue;
    const after = source.slice(idx + 'Basic'.length);
    const space = /^\s+/.exec(after);
    if (space === null) continue;
    const tokenStart = idx + 'Basic'.length + space[0].length;
    if (tokenStart < at) continue;
    const token = decodedBasicToken(after.slice(space[0].length));
    if (token === null) continue;
    out += source.slice(at, tokenStart) + REDACTION_SENTINEL;
    at = tokenStart + token.length;
    resumeAt = at;
  }
  return out + source.slice(at);
}

// A 4xx/5xx body is quoted into a notice and can echo the request back -- "token=<value>
// auth=Basic <base64>" -- so the request's own values are removed by value, not by name: no
// shape list can know the operator's spelling. A value is removed literally -- split/join above
// the floor, an escaped pattern below it, so a regex metacharacter in a value is never read as a
// pattern -- and the floor is applied here rather than at the removal, because this is the only
// place that knows where the value came from. Exactly what is collected:
//   - the request's userinfo PASSWORD, whatever its length: it is never ordinary configuration,
//     while the username is an ordinary word as often as it is a login and is collected only from
//     MIN_SECRET_CHARS up;
//   - the value of a credential-named query parameter, from MIN_CREDENTIAL_VALUE_CHARS up in the
//     notice set and from MIN_SECRET_CHARS up in the candidate set;
//   - a credential header's value whole, and above the floor the words it splits into;
//   - no other value at all, so an ordinary configured query value ('?sortOrder=descending',
//     '?max_results=40') can never rewrite a published word.
// The empty value is never collected: removing '' would replace every position in the diagnostic.
// A credential position is also returned on its own, because the pool's candidate fields are
// redacted against the credential values only, while a notice is redacted against every value.
export function requestSecretSets(url, headers) {
  const all = new Set();
  const credentials = new Set();
  // Eligibility is decided once, before any spelling of a value is added: notice is the
  // notice-only removal set, candidate is the candidate-pass set (a credential position long
  // enough not to be ordinary prose), and a candidate value is always a notice value too.
  const add = (value, { notice = false, candidate = false } = {}) => {
    // The internal characters are normalised out of every value before it is recorded, and a value
    // that is empty or only whitespace once normalised is not collected at all: recording it would
    // put a one-character ' ' into the removal set, which reaps every standalone space in every
    // notice (F28-1).
    const v = normalizeInternalChars(String(value ?? ''));
    if (v.trim() === '') return;
    if (candidate) {
      all.add(v);
      credentials.add(v);
    } else if (notice) {
      all.add(v);
    }
  };
  // Every spelling of one value is collected: the decoded form a server would print after
  // decoding, the raw spelling curl actually put on the request line, and the percent-encoded
  // form of the decoded one. A server that echoes $request_uri republishes the raw spelling,
  // and removing only the decoded form left that spelling readable in the notice.
  const addSpellings = (value, eligible) => {
    // Normalised first, and dropped whole when the normalisation leaves nothing but whitespace: a
    // value that IS an internal character would otherwise enter the removal set as ' ' through one
    // of its spellings (the raw one is ' ' and '%20' is not empty once percent-encoded).
    const v = normalizeInternalChars(String(value ?? ''));
    if (v.trim() === '') return;
    let decoded = null;
    try { decoded = decodeURIComponent(v); } catch { /* not percent-encoded */ }
    for (const spelling of [v, decoded, v.replace(/\+/g, ' ')]) {
      if (spelling === null) continue;
      add(spelling, eligible);
      try { add(encodeURIComponent(spelling), eligible); } catch { /* a lone surrogate */ }
    }
  };
  // A credential-named query value crosses two floors: the notice set takes it from
  // MIN_CREDENTIAL_VALUE_CHARS up, the candidate set only from MIN_SECRET_CHARS up, so an ordinary
  // short word under a credential name ('new', 'beta', 'live') stays in the notice's removal set
  // while it cannot rewrite the prose a candidate carries.
  //
  // The candidate half asks the other question, and it asks it of the NAME alone: a value crosses
  // into the candidate set exactly when the name is credential-BEARING (candidateCredentialParam).
  // A token-only name ('state', 'status', 'uuid', 'hash', ...) is therefore not a candidate
  // position at all. Its value is still collected for the notice set from three characters up, so
  // a notice quoting the run's own request still redacts it, and it never reaches the candidate set
  // - which is what keeps an ordinary configured word under such a name from rewriting a feed's own
  // prose at ANY length. The candidate half used to ask a second question of the VALUE (a
  // digit/capital/separator mark, or, after Batch 51, a pure lower-case word of twelve or more
  // characters); that gate failed in both directions and was deleted in Batch 53 - see the note
  // above 'The name as the server reads it' for the measurement. The residual it leaves is
  // deliberate and is recorded there: a credential standing under a token-only name is not
  // candidate-protected.
  const queryEligibility = (name, value, length) => ({
    notice: length >= MIN_CREDENTIAL_VALUE_CHARS,
    candidate: length >= MIN_SECRET_CHARS && candidateCredentialParam(name),
  });
  const raw = String(url ?? '');
  try {
    const parsed = new URL(raw);
    // The password is never ordinary configuration and goes in whole; the username is an ordinary
    // word as often as it is a login, so it enters the sets only at the free-text floor (TR-117).
    addSpellings(parsed.password, { notice: true, candidate: true });
    if (parsed.username.length >= MIN_SECRET_CHARS) {
      addSpellings(parsed.username, { notice: true, candidate: true });
    }
    for (const [name, value] of parsed.searchParams) {
      if (!credentialParam(name)) continue;
      // URLSearchParams reports the value already decoded, so its length is the floor's input;
      // decoding it a second time would shorten a value that literally spells an escape.
      const eligible = queryEligibility(name, value, value.length);
      if (!eligible.notice && !eligible.candidate) continue;
      addSpellings(value, eligible);
    }
    // URLSearchParams reports the decoded value, so 'token=oper+plus' arrives as 'oper plus'
    // and the raw pair spelling is read from the query string itself. The floor is read from the
    // decoded value, because that is the value the server holds.
    for (const pair of parsed.search.replace(/^\?/, '').split('&')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      if (!credentialParam(pair.slice(0, eq))) continue;
      const rawValue = pair.slice(eq + 1);
      const eligible = queryEligibility(pair.slice(0, eq), decodedValue(rawValue), decodedLength(rawValue));
      if (!eligible.notice && !eligible.candidate) continue;
      addSpellings(rawValue, eligible);
    }
    // The Basic header curl would send is the base64 of the userinfo: a request with none
    // contributes nothing here rather than the base64 of a bare colon.
    if (parsed.username !== '' || parsed.password !== '') {
      const userinfo = `${parsed.username}:${parsed.password}`;
      const basic = { notice: true, candidate: true };
      try { add(Buffer.from(decodeURIComponent(userinfo)).toString('base64'), basic); } catch { add(Buffer.from(userinfo).toString('base64'), basic); }
    }
  } catch {
    // The same split by hand: the password (after the first colon) goes in whole, the username
    // only at the free-text floor.
    const userinfo = /\/\/([^/?#\s]*)@/.exec(raw);
    if (userinfo) {
      const colon = userinfo[1].indexOf(':');
      const user = colon === -1 ? userinfo[1] : userinfo[1].slice(0, colon);
      const password = colon === -1 ? '' : userinfo[1].slice(colon + 1);
      if (password !== '') addSpellings(password, { notice: true, candidate: true });
      if (user.length >= MIN_SECRET_CHARS) addSpellings(user, { notice: true, candidate: true });
    }
    for (const m of raw.matchAll(/[?&]([^=&#\s]+)=([^&#\s]*)/g)) {
      if (!credentialParam(m[1])) continue;
      const eligible = queryEligibility(m[1], decodedValue(m[2]), decodedLength(m[2]));
      if (!eligible.notice && !eligible.candidate) continue;
      addSpellings(m[2], eligible);
    }
  }
  // A credential the request carried in a header is the request's own secret too: the token the
  // GitHub path sends is never in the URL, so the header value is collected whole and each of
  // its words with it -- a server that echoes only the token part still gives it up. The value
  // is a credential position like the URL's, so it is collected whatever its length; the words
  // it splits into are what the floor is for, because they are ordinary text as often as they
  // are a credential, and the floor keeps the scheme word 'Bearer' (and 'Basic', 'Token') out of
  // the removal set so a notice that merely names the scheme keeps its wording.
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!/authorization|cookie|token|key|secret/i.test(String(name))) continue;
    addSpellings(value, { notice: true, candidate: true });
    for (const part of String(value).split(/\s+/)) {
      addSpellings(part, { notice: looksLikeValue(part), candidate: false });
    }
  }
  return { all: [...all], credentials: [...credentials] };
}

// Every value the request carried: what a notice is redacted against.
export function requestSecrets(url, headers) {
  return requestSecretSets(url, headers).all;
}

// A value shorter than the floor is removed only where it stands as its own token. A short value
// the request sent is a credential wherever it is read, but below the floor it can be a letter or
// two, and replacing every occurrence of it rewrites words the credential is not part of: a
// userinfo password of 'ab' would rewrite 'cabin' as 'c[redacted]in', and the notice is the run's
// only diagnosis of a degraded source. An occurrence inside a longer word is not the value the
// request sent, so it stays; a standalone one goes whatever its length. The boundary is read at
// the value's last WORD character, and any separators the value carries to the right of it are
// matched after it. The first design put the lookahead after the WHOLE value, so a value whose last
// character is a space or punctuation needed a non-word character after that character -- and in
// prose there is always a word character there, so such a value was effectively never removed
// ('?token=x%3A%20' collects 'x: ', which is three characters and enters the notice set, and
// 'x: y' published it byte-for-byte; F27-6). Reading the lookahead where the boundary rule has
// always read it keeps an occurrence inside a longer word refused ('ab' does not stand in 'cabin')
// while the value the request actually sent -- separators included -- goes.
function boundedValue(value) {
  const text = String(value);
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The lookahead belongs to the value's last WORD character, and any separators the value carries
  // to the right of it are matched after it. The first design put the lookahead after the whole
  // value, so a value whose last character is a space or punctuation needed a non-word character
  // after that character -- and in prose there is always a word character there, so such a value
  // was effectively never removed ('?token=x%3A%20' collects 'x: ', and 'x: y' published it
  // byte-for-byte; F27-6). Reading the lookahead where the boundary rule has always read it keeps
  // the value inside a longer word refused ('cabin' is not a place 'ab' stands) while the value the
  // request actually sent -- separators included -- goes.
  const atWordEnd = /[A-Za-z0-9_]$/.test(text);
  return new RegExp('(?<![A-Za-z0-9_])' + escaped + (atWordEnd ? '(?![A-Za-z0-9_])' : ''), 'g');
}

// The same value with optional whitespace between its characters: a server can echo the
// request's own value with a whitespace control inside it -- a wrapped log line, a body that
// reflows the token across two lines -- and the exact match above then misses it while the
// credential is still readable in the notice, the pool and the published Coverage note. The
// characters are escaped one at a time, so a value carrying a regex metacharacter is still a
// literal. Only a value at or above the floor is matched this way: below it the spans a loose
// pattern can match are short enough to reap unrelated text.
function looseValue(value) {
  const pattern = [...String(value)]
    .map((ch) => ch.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'))
    .join('\\s*');
  return new RegExp(pattern, 'g');
}

// A value can also be republished in the URL's own spelling of it: redactUrl is the URL
// serializer, which percent-encodes the characters a path may not carry literally, so a value
// that travelled in the request's URL is quoted as 'a%20b' where its literal form is 'a b' and
// the by-value removal missed it exactly where the shaped error quotes it. The respelling is
// read from the same serializer, and accepted only when it decodes back to the value: a URL
// that normalises a path ('../../etc' becoming '/etc') is not a respelling of the value and
// must not put a shorter word into the removal set.
function urlSpelling(value) {
  try {
    const spelled = new URL(`https://notice.invalid/${value}`).pathname.slice(1);
    if (spelled === value) return null;
    return decodeURIComponent(spelled) === value ? spelled : null;
  } catch { return null; }
}

// The removal itself, and the second half of the boundary: every notice in the collector is
// pushed through this, so a path that quotes a server answer cannot forget it. A value is
// removed against the request's own values -- longest first, so a value that contains another is
// removed whole -- and the set is removed as it is given: the floor belongs to the place that
// builds it, which is the only place that knows whether the value came from the request's URL or
// from a header or from prose. The shape list covers the credential classes no curated set can
// know.
// The character a pass writes while it works, and the one thing no input may carry: it stands in
// for every removed span until the marker is put in its place at the very end of the one pass.
// A pass that inserted '[redacted]' at once could have that marker read back by the same pass or by
// a later one whenever a removed value is a substring of the marker itself ('redacted', 'redacted]',
// 'edacted]', '[redacte'), and each re-read grows the text by another marker. The sentinel cannot be
// re-read: it carries no letter, bracket or space, so neither a by-value removal, the word-bounded
// removal of a short value, the loose pattern, the Basic shape nor any of SECRET_SHAPES can match
// inside it. Both the text and every value are normalised to contain none of it before the pass
// starts, so nothing here can collide with text a caller meant.
const REDACTION_SENTINEL = '\uFFFF';
const REDACTION_SENTINEL_RE = /\uFFFF/g;
const REDACTED_MARKER = '[redacted]';
// The two code points this module uses as internal marks: the removal sentinel above and the
// scaffold placeholder (maskStripped's SCAFFOLD_MASK, U+E000). Neither may be carried into the
// pass by any text or any value, and neither may reach published text, so BOTH are normalised to a
// space wherever a text or a value enters. Normalising one and leaving the other is what made a
// value equal to the other reach the removal set as the one-character value ' ' (F28-1): the value
// then matched every standalone space in every notice, and at a cap the growth the removal wrote
// was cut back at the cap and took the transport cause with it.
const INTERNAL_MARK_RE = /[\uE000\uFFFF]/g;
function withoutSentinel(value) {
  return String(value ?? '').replace(INTERNAL_MARK_RE, ' ');
}
// The normalisation on its own, for a caller that publishes a text the by-value removal may not
// otherwise need to touch: the collector's credential-free candidate path used to skip the
// redaction entirely, so a server answer carrying either character reached the pool byte for byte
// (verification F28-4). A private-use character is invisible in a pool field, and no field of a
// published pool may carry one.
export function normalizeInternalChars(text) {
  return withoutSentinel(text);
}

// The marker's own shape, read as a span: a marker an earlier pass wrote is the one region this
// pass does not scan, so the pass applied again to its own output changes nothing. Without that
// the marker is not a fixed point, because every substring of it ('redacted', 'redacted]',
// 'edacted]', '[redacte', '[redacted') is a value a request can carry, and a later pass would
// rewrite the marker the previous one wrote: it grows by one occurrence of itself per pass
// ('[[redacted]]', '[[[[redacted]]]]'), and a notice published that way is rewritten again by
// every pass that follows it. Only a published marker is protected; no other text is skipped.
const MARKER_SPAN_RE = /\[redacted\]/g;
// A marker the input already carries stands for the placeholder for the whole pass, so no rule
// reads inside it: the placeholder is one character, the span skip it replaces was a variable
// length, and the difference showed up wherever a rule read a word boundary beside the marker.
// That is what the Basic rule's own '\b' does: with the ten-character marker left in place, a
// pass that had just replaced the word before 'Basic' read a boundary the pass before it never
// had and removed a credential after the cap had already been charged. One character, no letter
// and no bracket, reads as the non-word the removal wrote.
const MARKER_PLACEHOLDER = REDACTION_SENTINEL;
const MARKER_PLACEHOLDER_RE = REDACTION_SENTINEL_RE;
function protectMarkers(text) {
  return String(text).replace(MARKER_SPAN_RE, MARKER_PLACEHOLDER);
}

// A value that CONTAINS the marker is removed whole, before the marker is read as a span and
// before any other rule runs. The span skip above protects a marker the input already carried,
// and a value carrying one is split by that skip -- neither side holds it -- so the value a
// request sent was published byte-for-byte (an RSS answer echoing '?token=ab[redacted]cd'). It is
// removed wherever it stands rather than at a word boundary, because the value carries a
// ten-character marker no word is built from by accident, and the removal can only shorten the
// text. The longest first, so a value that contains another goes whole.
function removeMarkerBearingValues(text, sorted) {
  let out = text;
  for (const value of sorted) {
    if (!value.includes(REDACTED_MARKER)) continue;
    out = out.split(value).join(REDACTION_SENTINEL);
  }
  return out;
}

// The separator the notice assembly writes between a source and its detail. It is stated HERE, and
// collect.mjs imports it, because the redaction has to know the notice's own structure to leave it
// alone: a value that spells no byte beyond this separator can carry no credential the notice does
// not already publish structurally -- every notice carries that exact two-character sequence
// between its source and its detail, and a bare ':' stands in every URL it names -- while removing
// it can only destroy the documented 'source: detail' shape. That was the F27-5 residual: a
// collected ': ' (the operator's own userinfo password, or a two-character query value) reaped the
// assembly's separator, so a re-redacted notice grew by eight characters -- the ten-character
// marker against the two characters removed -- and could exceed the cap it was priced at, and the
// removal moved the transport cause off the position the scaffold protects it in. A value that
// EXTENDS beyond the separator (': x', 'x: ', 'ab: cd') is a credential that merely straddles it
// and is still removed, together with the separator it spans, which is the whole-notice removal
// TR-168 closed (Batch 52).
export const NOTICE_SEPARATOR = ': ';
function isSeparatorOnlyValue(value) {
  const v = String(value ?? '');
  return v !== '' && NOTICE_SEPARATOR.includes(v);
}

// One pass over the input produces the published text. Every removal the pass makes is one
// sentinel, and the marker is put in its place only when the whole pass has ended, so no removal
// can read back a marker this pass wrote; and a marker an earlier pass wrote is a span this pass
// does not read at all, so the text the pass publishes is a fixed point of the pass. The output
// is never longer than the text that went in plus, for each removal, the difference between the
// marker and the value that stood there -- and the value that carries the marker is longer than
// the marker, so its removal is a shortening on the same terms as any other (TR-110 keeps the
// word-boundary floor for the values that do not carry it). The pass is complete in one go: the
// Basic rule writes the sentinel like every other removal, so no removal this pass makes can be
// read back by this pass or by the one that follows it.
export function redactSecrets(text, secrets) {
  const values = new Set();
  for (const raw of secrets ?? []) {
    // A value that spells the scaffold mask is normalised the same way the text is, so no value in
    // the set can match the mask the protection below writes. This is what makes the mask inert:
    // the alternative (leaving the value whole) let a one-character mask-equal credential match
    // every mask in the text and delete the status and the cause from every other row's notice.
    const value = maskStripped(withoutSentinel(raw));
    // A value that is empty, or that is only whitespace once the internal characters are
    // normalised out of it, is not collected at all. The one-character ' ' is the case that
    // matters: boundedValue reads its boundary at the value's last word character, and a value
    // whose last character is not a word character carries no lookahead, so ' ' matched every
    // standalone space in the text and rewrote it with a ten-character marker (F28-1).
    if (value.trim() === '') continue;
    // A value that spells only the notice's own separator is not removed either, for the reason
    // stated beside NOTICE_SEPARATOR: it can carry no credential, and removing it reaps the
    // assembly's structure (F27-5 residual, Batch 52).
    if (isSeparatorOnlyValue(value)) continue;
    values.add(value);
    const respelled = urlSpelling(value);
    if (respelled !== null) values.add(withoutSentinel(respelled));
  }
  const sorted = [...values].sort((a, b) => b.length - a.length);
  // Longest first, so a value that contains another is removed whole; and before the marker is
  // read as a span, so a value carrying the marker is removed rather than split by it.
  // The shape list runs first, while the text is still the bytes that arrived: it removes a whole
  // credential class by shape, and a by-value removal that split such a shape in half ('x' inside
  // 'dXNl...' before the 'Basic ' it follows) would leave the rest of the credential legible.
  // Every marker the input already carries becomes the placeholder BEFORE any removal runs: a
  // removal that rewrote part of a marker would leave the rest of it standing, and the next value
  // in the set ('edacted]', 'redacted', '[redacte') then matches the fragment the same pass
  // exposed -- a marker rewritten by the marker-substring values, which is the growth the
  // fixed-point contract exists to stop. A value that carries the marker is removed first, while
  // the markers it contains are still the bytes the input had.
  // The shaper's own status and cause phrase are masked first, so no removal can take a word out
  // of the module's own diagnosis (the mask is restored with the text below).
  // The scaffold is masked first, and the placeholder it writes is the pass's own sentinel. The
  // sentinel is the one string neither a rule nor a collected value can touch (see the block above
  // protectScaffold), so the spans survive the removals without exempting anything else: a value
  // that stands where a scaffold's wildcard stands is inside a span and is therefore restored too,
  // which is why the by-value removal below still runs on the SCANNED text and the span text is
  // never re-scanned.
  const scaffold = protectScaffold(maskStripped(withoutSentinel(text)));
  let out = protectMarkers(removeMarkerBearingValues(scaffold.text, sorted));
  // One removal can expose another: the credential shapes read the word boundary before them, and
  // a removal beside one changes that boundary ('XabcdefghBasic dXNlcjpw' has no boundary before
  // 'Basic' -- the 'g' is a word character -- so a pass that stopped here left 'Basic dXNlcjpw'
  // for the NEXT pass to remove, after the cap had been charged). The removals are therefore
  // re-applied until one changes nothing, so the text this function returns is the text the same
  // function returns when it is applied again. Each re-application only replaces characters with
  // the sentinel, so the text never grows and the loop ends: the sentinel matches no rule.
  const applyRemovals = (input) => {
    let out = input;
    // The shape list on both sides of the by-value loop: before it, a shape is still the bytes the
    // text carried (a by-value removal inside 'Basic <b64>' splits the credential and leaves the
    // rest legible); after it, a removal beside a shape a word character used to guard it (the
    // 'x' of 'x<word>Basic <b64>' is not a value, so the shape stands). Between the two, the
    // values are removed longest first, and the marker-bearing values before the markers they
    // carry become the placeholder.
    for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTION_SENTINEL);
    out = redactAuthorizationShapes(out);
    for (const value of sorted) {
      if (value.length >= MIN_SECRET_CHARS) {
        out = out.split(value).join(REDACTION_SENTINEL);
        out = out.replace(looseValue(value), REDACTION_SENTINEL);
      } else {
        out = out.replace(boundedValue(value), REDACTION_SENTINEL);
      }
    }
    // The Basic rule is applied twice per removal pass: a chain of back-to-back credential shapes
    // leaves one sentinel per shape, and a pass that removed a single shape per application would
    // need one pass per shape -- which is what a long chain of them did, running into the loop's
    // pass bound without reaching a fixed point. Each application is itself idempotent and only
    // removes, so applying it twice reaches the same text in half the passes.
    return redactBasicCredentials(redactBasicCredentials(out));
  };
  for (let pass = 0; pass < 64; pass += 1) {
    const next = applyRemovals(out);
    if (next === out) break;
    out = next;
  }
  // The spans are restored BEFORE the placeholder-to-marker replacement, and the marker rule is
  // then blind to them: the replace consumes each sentinel once, and a restored span is a string
  // with no sentinel in it, so the bytes a span carries are published byte-for-byte even when a
  // cause phrase carries a literal '[redacted]' (a value the request sent, echoed into a cause).
  // The other order is the one that fails: run the marker replacement first, then feed its output
  // to the restore, and the restored span -- which carries the module's own 'HTTP 503' -- is the
  // text the marker replacement no longer has a chance to see, while the placeholder the restore
  // was looking for is already a marker.
  const restored = scaffold.restore === null ? out : scaffold.restore(out);
  return restored.replace(REDACTION_SENTINEL_RE, REDACTED_MARKER);
}

// Pure and offline-testable: it splits the status line off the captured bytes and
// never touches the network. The body keeps its exact bytes, which matters for a
// body that legitimately ends in a newline and for non-UTF-8 charsets. A buffer
// with no readable status line is returned whole, with status 0.
export function splitCurlOutput(buf) {
  const nl = buf.lastIndexOf(0x0a);
  if (nl === -1) return { body: buf, status: 0 };
  const tail = buf.subarray(nl + 1).toString('utf8').trim();
  if (!/^\d{3}$/.test(tail)) return { body: buf, status: 0 };
  return { body: buf.subarray(0, nl), status: Number(tail) };
}

// Every bound in this module is policy and lives in config/settings.md; the transport
// refuses to guess one, so a caller that forgets to carry configuration fails loudly
// instead of returning an unbounded timeout or an unbounded server dump.
function requirePositive(value, what) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${what} must be a positive number, got ${JSON.stringify(value)}`);
  }
  return value;
}

// Two explicit entry points, because the two failure modes carry different facts
// and nothing may be inferred from a field that means something else.

// An HTTP status we obtained ourselves, from a transfer that completed (curl exit
// 0). Pure and offline-testable. The answer's text is never quoted into the message: a
// notice describes the degradation -- the status and the request's redacted URL -- so
// nothing a server answered can reach the Coverage note the notice is published in. The
// bounded, tag-stripped snippet is still built, and stays on the error as its internal
// body field, because the caller's refusal predicate is the one thing that has to read
// the answer; it is a classification input and never notice text.
// The secrets a shaped text is priced against: the request's own values, plus the run-wide union
// when the caller carries one (extraSecrets). A notice is published under the union, and a detail
// the shaper bounded against the request's own values alone can be grown by the wider set after it
// was priced, which is what took the HTTP status off a notice at the least accepted pair. The
// optional parameter is additive: called with its shipped signature the shaper prices against the
// request alone, exactly as before, and every existing caller keeps its behaviour.
function pricedSecrets(url, headers, extraSecrets) {
  const secrets = new Set(requestSecrets(url, headers));
  for (const raw of extraSecrets ?? []) {
    const value = String(raw ?? '');
    if (value !== '') secrets.add(value);
  }
  return secrets;
}

export function shapeHttpError(status, body, url, limit, headers, omitUrl = false, extraSecrets = null) {
  const bound = requirePositive(limit, 'the error snippet limit in characters');
  const secrets = pricedSecrets(url, headers, extraSecrets);
  const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  // By-value redaction runs before every bound this text meets: the decoded answer is redacted
  // before it is cut, so a value the request sent cannot be published in half by the cut, and
  // the bounded snippet is redacted again because plainText decodes an entity spelling the answer
  // could have used to evade the first pass. The snippet is internal -- the rate-limit predicate
  // reads it -- and never notice text.
  const snippet = redactSecrets(
    neutraliseLinkSeams(plainText(redactSecrets(decodeBuffer(source), secrets), bound)),
    secrets,
  );
  // The cap bounds the shaped text, and the status is what must never be lost with it: the
  // redacted URL takes the room the cap leaves, so a notice still reads 'HTTP <status> for'
  // even when a long URL has to be cut. The URL's scheme, host and path are what stays
  // diagnosable. A repository discovered from an organisation listing is shaped with no request
  // at all (omitUrl): its URL is the answer's own name respelled by the URL serializer -- a dot
  // segment is normalised away -- so no by-value removal covers it, and the caller names the
  // organisation row and the entry's ordinal instead.
  const prefix = `HTTP ${status} for `;
  // The request crosses the notice rewriting before its length is priced, as the transport half's
  // request does (TR-165): a redacted URL that spells a link seam is one character longer per seam
  // once the rewriting has ended it, and a request bounded before that rewriting was the notice
  // cap's room short by exactly that many characters -- the push sliced the assembled notice there
  // and the tail went with it. The status prefix is the floor and is never cut.
  const shown = omitUrl ? '' : noticePreservingRewrites(redactSecrets(redactUrl(url), secrets));
  const room = Math.max(0, bound - prefix.length);
  const shaped = omitUrl
    ? new Error(`HTTP ${status}`)
    : new Error(prefix + (shown.length > room ? shown.slice(0, room) : shown));
  // The raw request stays readable BY NAME -- the re-price and the omitUrl decision read it back --
  // but it is not an enumerable own property: JSON.stringify, Object.keys, a spread or an error
  // logger would otherwise publish the request's own credential values, the same exposure the
  // priced set was moved into a WeakMap to close (F26-3), and the message is the redacted form the
  // reader is meant to see.
  Object.defineProperty(shaped, 'url', { value: url, enumerable: false, writable: true, configurable: true });
  shaped.cause = `HTTP ${status}`;
  shaped.httpStatus = Number(status);
  shaped.body = snippet;
  // The two facts a later re-price has to have and cannot infer: the omitUrl decision the text
  // was shaped under (a text shaped with no request may not gain one -- the URL is the answer's
  // own name respelled), and the set the text was priced against. A re-price against a wider set
  // must keep removing everything this text already removed, or a value the shaper took out of
  // the request comes back into the notice when the caller's set is not a superset.
  shaped.omitUrl = Boolean(omitUrl);
  recordPricedSecrets(shaped, secrets);
  return shaped;
}

// The transport cause is a fixed vocabulary read from curl's process exit code, never the
// diagnostic line curl wrote. curl follows a Location header, so its line names the host the
// answer chose for the redirect, and it also names the proxy the environment supplied: both are
// text the request never carried, so no by-value removal can cover either, and the notice is
// published. The exit code carries none of that -- it is a small integer from curl's own enum --
// and it stays in the cause beside the phrase, so the notice is precise as well as diagnosable.
// A code outside the common set is named in full, and no cause quotes a byte of the answer or the
// environment either way.
const CURL_EXIT_CAUSES = new Map([
  [6, 'could not resolve the host'],
  [7, 'failed to connect'],
  [18, 'partial transfer'],
  [28, 'timed out'],
  [35, 'TLS handshake failed'],
  [52, 'empty reply'],
]);

// The largest output one child process may leave for the transport to capture, and the codes Node
// raises when that bound is crossed. The ceiling is infrastructure rather than policy -- it exists
// so a hostile or broken answer cannot exhaust memory, and a configuration value here would only
// let a typo take the run down -- so it lives here and is stated where the transport is described.
const CAPTURE_CEILING_BYTES = 64 * 1024 * 1024;
const CAPTURE_CEILING_MIB = CAPTURE_CEILING_BYTES / (1024 * 1024);
const CAPTURE_CEILING_CODES = new Set(['ENOBUFS', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);

// The shaper's own structured scaffold, and the reason it crosses the removals masked: the HTTP
// status token and the transport-cause phrase are authored by this module, never read from a
// request or an answer, and neither is ever a credential. The run's union can still spell one of
// their words -- a sibling row carrying '?code=500' put '500' in the union, the whole-notice
// redaction removed it from the status of another row's notice, and the reader was handed
// 'HTTP [redacted] for ...' with no status at all (TR-111). The scaffold is masked for the
// removals and restored at the end of the pass, so every later pass leaves it whole while a value
// is still removed from the source, the request and every other byte of the line.
//
// There are TWO internal characters and they are not the same one. The removal SENTINEL is U+FFFF
// (REDACTION_SENTINEL above); the scaffold PLACEHOLDER is the private-use mask U+E000
// (SCAFFOLD_MASK below, and SCAFFOLD_PLACEHOLDER is that mask). The first design of this mechanism
// used a third, its own private-use mark for the placeholder, and every failure measured against
// that design came from the same shape -- an internal character standing in the scanned text, which
// any rule can read and any collected value can spell:
//   - the authorization rule's '[^\s,;"']+' class matched the placeholder, so a source whose path
//     ends in 'authorization' supplied the keyword, the ': ' seam supplied the colon, and the
//     placeholder was consumed by the authorization rule -- the span was never restored and the
//     whole status or the whole transport cause was deleted ('rss https://a.example/[redacted]');
//   - a collected value that SPELLED the placeholder matched every placeholder (a one-character
//     value is removed by the word-bounded rule and the placeholder was a non-word character), so
//     one crafted watchlist row stripped the status and the cause from every other row's notice;
//   - an input that carried the placeholder switched the protection off for the whole text, so
//     the status and cause became ordinary removal targets AND the placeholder itself was
//     published into the pool and the rendered artifact.
//
// None of the three is possible now, and each is closed by name:
//   - a rule cannot consume the placeholder. The authorization rule's class could match it, so that
//     rule now refuses any match whose token is the placeholder: the placeholder is written by this
//     function and normalised out of every input and every value, so the only text that carries one
//     is a span this function wrote, and a match over it is the notice's own diagnosis (Batch 49,
//     verification F28-3);
//   - a collected value cannot spell it. withoutSentinel normalises BOTH internal characters out of
//     every value before it reaches the removal set, and a value that is empty, or that is only
//     whitespace once normalised, is not collected at all -- so the one-character ' ' that matched
//     every placeholder (and every standalone space) is gone (Batch 47, verification F28-1);
//   - an input that carries either character can neither disable the protection nor publish it.
//     withoutSentinel replaces both in the input TEXT before protectScaffold writes a single
//     placeholder, so every placeholder in the scanned text is one this function wrote, there is no
//     early return left for an input to reach, and the restore is the placeholder's only producer
//     and its only consumer, so no placeholder can reach published text.
//
// The placeholder is inserted at the position of the span, so the replacement is 1:1 in positions
// (not in length) and the pass still neither lengthens the text nor loses a boundary it depends
// on. The placeholders are restored BEFORE the sentinel-to-marker replacement, and the index is
// exact: every sentinel in the text at that point is either a span placeholder or a removal, the
// placeholders are exactly as many as the spans, and the removals are the ones left over.
//
// The status is protected wherever it stands -- its three digits are the whole token and no
// credential value can be spelled by them. The cause is protected only where the shaper puts it:
// after its own 'request failed for <url>: ' or 'request failed: ' prefix, or as the whole text of
// the redaction the shaper runs over the bare cause. The same phrase in a candidate field is
// ordinary prose a source published, and a value that spells one of its words must still be
// removed there, so the phrase is not protected context-free. A value that stands where a
// scaffold's own wildcard stands (the cause body, the request slot) is NOT exempt: the removals
// run over the text, and the assertion beneath the protectScaffold call refuses to publish a
// masked span a rule deleted.
export const NO_DETAIL_REASON = 'a failure with no message';
const SCAFFOLD_MASK = '\uE000';
const SCAFFOLD_MASK_RE = /\uE000/g;
// The private-use character the previous design masked with is normalised out of both the text and
// the value set before any rule reads them. The replacement is a space: the character stood where a
// scaffold stood, which always has whitespace or punctuation around it, so a space keeps the word
// boundaries a reader would have seen. This is a belt beside the sentinel braces -- the sentinel is
// already unmatchable -- and it is what makes the input's own copy of the character inert and
// unpublishable rather than a switch that turns the protection off. It is called on both the text
// and the values beside withoutSentinel, which now normalises the mask as well, so the two together
// leave neither internal character anywhere in the pass.
function maskStripped(value) {
  const text = String(value ?? '');
  return text.includes(SCAFFOLD_MASK) ? text.replace(SCAFFOLD_MASK_RE, ' ') : text;
}
// The placeholder the spans are replaced by while the removals run. It is the private-use character
// maskStripped normalises out of the input text AND out of every value of the removal set before any
// rule reads either, which is what makes it inert: the text scanned here carries the character only
// where protectScaffold wrote it, no value in the set can spell it (so no by-value removal can match
// one), and the restore is its only producer and its only consumer, so it can reach no published
// text. A placeholder the value set could spell is exactly what the previous design failed on: a
// one-character mask-equal credential matched every mask and deleted the status and cause from every
// other row's notice.
const SCAFFOLD_PLACEHOLDER = SCAFFOLD_MASK;
const SCAFFOLD_PLACEHOLDER_RE = SCAFFOLD_MASK_RE;
function escapeScaffoldPhrase(phrase) {
  return String(phrase).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}
const CAUSE_SCAFFOLD = [
  ...[...CURL_EXIT_CAUSES.values()].map(escapeScaffoldPhrase),
  'curl exited with status \\d+',
  'curl was terminated',
  'curl could not be started',
  'curl failed',
  // The assembly's own reason for a detail that carries no readable message. It is the module's
  // own words and it stands where the shaper's cause stands -- at the head of the detail, after
  // the notice's ': ' seam -- so it is protected the same way and for the same reason: a value a
  // request carried can spell one of its words, and the notice is the run's only diagnosis
  // (Batch 52; the string is the assembly's, stated here because this is the module that protects
  // it, and collect.mjs imports it rather than restating it).
  escapeScaffoldPhrase(NO_DETAIL_REASON),
].join('|');
// A mapped cause is published with its curl exit code beside it ('failed to connect (curl exit 7)'),
// so the suffix is part of the same scaffold.
// The 'curl exited with status N' phrase carries a digit run, so it is closed by a end-of-token
// boundary: without it the phrase matched a prefix of ordinary words ('timed out' inside 'a time').
const CAUSE_BODY = '(?:' + CAUSE_SCAFFOLD + ')(?: \\(curl exit \\d+\\))?(?![A-Za-z0-9_])';
// Only the FIXED vocabulary is protected, and nothing else: the status token ('HTTP' and its three
// digits), the cause phrases themselves, and the '(curl exit N)' suffix the shaper adds to a mapped
// one. Every WILDCARD the earlier design protected is gone, and that is the whole of this fix:
// 'request failed for <url>: ' carried the request and 'curl could not be started (...)' and
// 'curl was terminated ...' carried a spawned-tool code, so a server that echoed the request's own
// credential as one of those slots was masked whole -- the by-value removal never saw the value and
// the restore put it back byte-for-byte ('request failed: curl could not be started (SECRET42)'
// published the credential). A phrase is protected only when no credential can be spelled by it,
// and the two slots that could spell one are left where the removals can reach every byte of them.
// A cause phrase is protected only where the shaper puts it -- at the head of the text, or directly
// after the ': ' a notice's own seed carries -- and never inside ordinary prose. 'timed out' inside
// 'the request timed out twice' is a source's sentence, not the shaper's diagnosis, and a value
// that spells one of its words must still be removed there (TR-111's second half, which a
// context-free phrase protection reaps). The prefix is not part of the protection either: the
// status alone and the cause alone are the two facts the reader is owed, and every wildcard the
// earlier design protected (the request slot, the spawned-tool code) is gone.
const SCAFFOLD_RE = new RegExp(
  '\\bHTTP \\d{3}\\b'
  + '|(?:^|(?<=: ))' + CAUSE_BODY,
  'g',
);
function protectScaffold(text) {
  // The text arrives with every private-use mask already normalised out (redactSecrets calls
  // maskStripped first) and with no sentinel in it (withoutSentinel ran before that), so every
  // placeholder this function writes is one it wrote itself. There is deliberately no early return
  // for an input that carries the placeholder: the old early return is exactly what let the
  // protection be switched off by an input, and the normalisation upstream removes the condition.
  const source = String(text);
  let out = '';
  let at = 0;
  const spans = [];
  for (const match of source.matchAll(SCAFFOLD_RE)) {
    out += source.slice(at, match.index) + SCAFFOLD_PLACEHOLDER;
    spans.push(match[0]);
    at = match.index + match[0].length;
  }
  if (spans.length === 0) return { text: source, restore: null };
  out += source.slice(at);
  return {
    text: out,
    // Restores the spans in order. The placeholder cannot be reordered or re-spelled: it is the
    // character maskStripped removed from the input and from every value, so the only code that can
    // write one is this function. The fallback leaves the placeholder standing rather than restoring
    // the wrong span, and is unreachable.
    restore: (published) => {
      let i = 0;
      return String(published).replace(SCAFFOLD_PLACEHOLDER_RE, () => (i < spans.length ? spans[i++] : SCAFFOLD_PLACEHOLDER));
    },
  };
}

// The three cases a child-process failure can be, and the field each one is read from: the run's
// own exit status when curl ran and returned one, the name of the signal the system ended it with
// when it was killed, and the spawn's error code when the binary could not be started at all.
// Never the child-process message, which quotes the whole argv, and never curl's stderr, which
// quotes the redirect host and the proxy name.
//
// The capture ceiling is not a missing binary: when the answer crosses the buffer Node terminates
// the child and reports ENOBUFS, whose status is null for exactly that reason. Read as a spawn
// code, that published 'curl could not be started (ENOBUFS)' -- a false diagnosis of a curl that
// ran and answered, and one that named no ceiling anywhere. The ceiling gets its own cause, and it
// reports what actually became of the tool: the signal that ended it, and the bound it crossed
// (TR-160). A kill that is not the ceiling reads the same signal from the same field, so a child
// the system ended is never published as one that could not be started, nor as the bare failure
// literal that names neither (TR-163).
function transportCause(err) {
  if (Number.isInteger(err?.status)) {
    const phrase = CURL_EXIT_CAUSES.get(err.status);
    return phrase === undefined
      ? `curl exited with status ${err.status}`
      : `${phrase} (curl exit ${err.status})`;
  }
  if (CAPTURE_CEILING_CODES.has(err?.code)) {
    const ended = typeof err?.signal === 'string' && err.signal !== '' ? ` (${err.signal})` : '';
    return `curl was terminated${ended} at the ${CAPTURE_CEILING_MIB} MiB capture ceiling`;
  }
  // A killed child reports no exit status and no spawn code, so both branches below would read it
  // as a tool that never started; the signal is the cause, and it is named as the one that ended
  // the tool. A genuine spawn failure carries a code and no signal, and keeps its own wording.
  if (typeof err?.signal === 'string' && err.signal !== '') {
    return `curl was terminated (${err.signal})`;
  }
  if (typeof err?.code === 'string' && err.code !== '') {
    return `curl could not be started (${err.code})`;
  }
  return 'curl failed';
}

// A child-process failure: curl exited non-zero, so no HTTP exchange completed.
// err.status is curl's *process* exit code and err.stdout may hold a partial body
// plus the write-out status line, so neither is read as an HTTP status. The cause is
// the fixed vocabulary above, never curl's stderr line. Pure and offline-testable.
// A shaped error re-priced against the set it will be published under. The shaped errors carry the
// facts the text was built from -- the status or the transport cause, the request and the omitUrl
// decision -- so a caller that learns of a wider secret set after the shaping (the collector's
// run-wide union) can rebuild the text instead of re-cutting the line it was given. A text the
// shipped transport shaped is already bounded; a custom transport on the public collectAll seam can
// hand back a text its own shaper bounded against the request alone, and this is the seam that
// prices it against the union before a notice is assembled. Anything that is not a shaped error is
// returned untouched.
// Reading a fact off a detail is guarded here exactly as shapedDetailOf guards the same reads
// (S26-F4): a forged shape or a Proxy whose property reads throw must be REFUSED rather than thrown
// out of the assembly. The guard covered httpStatus and cause only, so a detail whose url, omitUrl
// or message read threw escaped the boundary the comment above claims closes: measured at the
// exported assembly, 'hostile=url' and 'hostile=omitUrl' both THREW out of assembleNotice. Every
// read of the object below goes through this helper, and the first one that throws returns the
// detail untouched -- the same answer the not-a-shaped-error branch gives, and the caller then
// publishes the whole-line redaction instead of aborting the source.
const REPRICE_READ_FAILED = Symbol('reprice read failed');
function readFact(object, key) {
  try { return object[key]; } catch { return REPRICE_READ_FAILED; }
}
export function repriceShapedError(err, extraSecrets, snippetLimit) {
  if (err === null || typeof err !== 'object') return err;
  const bound = Number.isFinite(Number(snippetLimit)) && Number(snippetLimit) > 0
    ? Number(snippetLimit) : null;
  const rawUrl = readFact(err, 'url');
  if (rawUrl === REPRICE_READ_FAILED) return err;
  const url = String(rawUrl ?? '');
  // omitUrl is the shaper's own decision, read from the flag the shapers set and never inferred
  // from an empty URL: every shaped error carries its request in the url field, so inference read
  // a text deliberately shaped with no request ('HTTP 503', 'request failed: <cause>') as one
  // that had a request, and the re-price put the answer-derived URL back into a notice that exists
  // to name no request at all. The URL is only ever shown when the shaper said to show it.
  const rawOmitUrl = readFact(err, 'omitUrl');
  if (rawOmitUrl === REPRICE_READ_FAILED) return err;
  const omitUrl = rawOmitUrl === true || url === '';
  // The set the re-price prices against is the set the text was already priced against, plus
  // everything the caller learned since. The request's own values cannot be read back here (the
  // error carries no headers), so the shaped error carries them: without them a value the shaper
  // had removed from the request reappears in the rebuilt text whenever the caller's extra set is
  // not a superset of the request's own.
  const priced = new Set(extraSecrets ?? []);
  for (const raw of pricedSecretsOf(err)) {
    const value = String(raw ?? '');
    if (value !== '') priced.add(value);
  }
  const secrets = [...priced];
  const readStatus = readFact(err, 'httpStatus');
  const readCause = readFact(err, 'cause');
  if (readStatus === REPRICE_READ_FAILED || readCause === REPRICE_READ_FAILED) return err;
  let candidate = null;
  if (Number.isInteger(readStatus)) {
    const prefix = 'HTTP ' + readStatus + ' for ';
    const room = bound === null ? Infinity : Math.max(0, bound - prefix.length);
    const shown = omitUrl ? '' : noticePreservingRewrites(redactSecrets(redactUrl(url), secrets));
    const text = omitUrl
      ? 'HTTP ' + readStatus
      : prefix + (shown.length > room ? shown.slice(0, room) : shown);
    candidate = new Error(text);
    candidate.cause = 'HTTP ' + readStatus;
    candidate.httpStatus = Number(readStatus);
    candidate.omitUrl = omitUrl;
  } else if (readStatus === null && typeof readCause === 'string') {
    const cause = noticePreservingRewrites(redactSecrets(readCause, secrets));
    const prefix = 'request failed for ';
    const shortPrefix = 'request failed';
    const separator = ': ';
    const shown = omitUrl ? '' : noticePreservingRewrites(redactSecrets(redactUrl(url), secrets));
    const room = bound === null ? Infinity : Math.max(0, bound - prefix.length - separator.length - cause.length);
    const full = omitUrl
      ? shortPrefix + separator + cause
      : prefix + (shown.length > room ? shown.slice(0, room) : shown) + separator + cause;
    const compact = shortPrefix + separator + cause;
    candidate = new Error(bound !== null && full.length > bound && compact.length <= bound ? compact : full);
    candidate.cause = cause;
    candidate.httpStatus = null;
    candidate.omitUrl = omitUrl;
  } else {
    return err;
  }
  if (bound !== null && candidate.message.length > bound) return err;
  const rawMessage = readFact(err, 'message');
  if (rawMessage === REPRICE_READ_FAILED) return err;
  const out = new Error(String(rawMessage));
  for (const key of Object.keys(err)) out[key] = err[key];
  // The request is copied back NON-enumerably, exactly as the shapers carry it: the re-price read it
  // by name and a later re-price of this result has to see it too, while a serializer still must not.
  Object.defineProperty(out, 'url', { value: url, enumerable: false, writable: true, configurable: true });
  out.message = candidate.message;
  out.cause = candidate.cause;
  return out;
}

export function shapeTransportError(err, url, limit, headers, omitUrl = false, extraSecrets = null) {
  const bound = requirePositive(limit, 'the error snippet limit in characters');
  // err.message is never a cause: Node builds it from the whole argv, and the argv carries the
  // Authorization header, which the fixed cause above cannot carry at all. The text is priced
  // against the request's own values plus the run-wide union when the caller carries one, for the
  // same reason shapeHttpError is (extraSecrets).
  const secrets = pricedSecrets(url, headers, extraSecrets);
  const cause = redactSecrets(transportCause(err), secrets);
  // The shaped text gives way in the order the diagnosis can afford, and the cause is never the
  // part that gives way. The request's room is what the bound leaves after the prefix, the
  // separator and the whole cause, so a long request is shortened first; a bound too small for
  // that pair drops the request entirely and keeps the compact 'request failed: <cause>'; and a
  // bound too small even for the compact form returns the cause alone, longer than the bound,
  // rather than cutting the diagnosis in half. The bound is configuration, so it may shorten the
  // text, but it may never delete the reason a source failed (TR-154). The earlier shape sliced
  // the compact form, so every bound below the fixed cause's own length published a text whose
  // cause was gone, and the shape before that added the separator outside the arithmetic and
  // returned 'limit + 21' whenever the cause reached the cap. A repository discovered from an
  // organisation listing is shaped with no request at all (omitUrl): its URL is the answer's
  // own name respelled by the URL serializer, which by-value removal cannot cover.
  //
  // The request crosses the notice rewriting above before its length is priced: a redacted URL
  // that spells a link seam is one character longer per seam once the rewriting has ended it,
  // and a request bounded and then rewritten was the notice cap's room short by exactly that
  // many characters -- the push cut the assembled notice there and the cause went with the tail
  // (TR-165). Normalising first and cutting what it produced makes the length this function
  // clears against the bound the length the notice carries, so the room the notice check
  // reserved upstream for this text is the room it survives with.
  const prefix = 'request failed for ';
  const shortPrefix = 'request failed';
  const separator = ': ';
  const causeText = noticePreservingRewrites(cause);
  const shownOf = (budget) => {
    if (omitUrl) return '';
    const shown = noticePreservingRewrites(redactSecrets(redactUrl(url), secrets));
    return shown.length > budget ? shown.slice(0, budget) : shown;
  };
  const room = Math.max(0, bound - prefix.length - separator.length - causeText.length);
  const full = omitUrl
    ? noticePreservingRewrites(`${shortPrefix}${separator}${causeText}`)
    : noticePreservingRewrites(`${prefix}${shownOf(room)}${separator}${causeText}`);
  const compact = noticePreservingRewrites(`${shortPrefix}${separator}${causeText}`);
  const text = full.length <= bound ? full : (compact.length <= bound ? compact : causeText);
  const shaped = new Error(text);
  // The cause field is the same text the message carries, so a caller that reports it (the
  // operator line reads it back out) reads the bytes the notice published and not the bytes
  // before the rewriting.
  shaped.cause = causeText;
  // No process exit status means curl never ran: the caller can tell a broken dependency from a
  // source that answered. Two exceptions do not mean that, and neither may be read as one: a
  // terminated-by-ceiling child ran and only its answer overflowed, and a killed child ran and was
  // ended by a signal.
  shaped.noDiagnostic = !Number.isInteger(err?.status)
    && !CAPTURE_CEILING_CODES.has(err?.code)
    && !(typeof err?.signal === 'string' && err.signal !== '');
  Object.defineProperty(shaped, 'url', { value: url, enumerable: false, writable: true, configurable: true });
  shaped.httpStatus = null; // a transport failure has no HTTP status
  shaped.exitStatus = Number.isInteger(err?.status) ? err.status : null;
  shaped.body = '';
  // The omitUrl decision and the priced set, as shapeHttpError records them: the re-price reads
  // them instead of inferring them, so a text shaped with no request keeps no request and a value
  // the shaper removed stays removed.
  shaped.omitUrl = Boolean(omitUrl);
  recordPricedSecrets(shaped, secrets);
  return shaped;
}

function curlBuffer(url, ms, headers = {}, ua = DEFAULT_UA, snippetLimit, omitUrl = false) {
  const args = ['-sSL', '--compressed', '--max-time', String(Math.ceil(requirePositive(ms, 'the request timeout in milliseconds') / 1000)), '-A', ua, '-w', WRITE_OUT];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  // '--' ends curl's option list, so a target can never be read as a flag.
  args.push('--', url);
  let raw;
  try {
    // stdio is spelled out so curl's own error line is captured instead of being
    // inherited: execFileSync otherwise prints the child's stderr on ours. The ceiling is
    // the transport's own bound, declared above with the cause it produces.
    raw = execFileSync('curl', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: CAPTURE_CEILING_BYTES });
  } catch (err) {
    throw shapeTransportError(err, url, snippetLimit, headers, omitUrl);
  }
  const { body, status } = splitCurlOutput(raw);
  // curl completed the exchange (exit 0) and the server answered 4xx/5xx: the only
  // case where a status is ours to report.
  if (status >= 400) throw shapeHttpError(status, body, url, snippetLimit, headers, omitUrl);
  return body;
}

// omitUrl is for a request whose target came out of an answer rather than out of configuration:
// the shaped text then names no request at all, because the URL is that answer's text respelled.
export async function fetchText(url, ms, headers = {}, ua = DEFAULT_UA, snippetLimit, omitUrl = false) {
  return decodeBuffer(curlBuffer(url, ms, headers, ua, snippetLimit, omitUrl));
}

export function decodeBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('\uFFFD')) return asUtf8;
  const head = asUtf8.slice(0, 300).toLowerCase();
  if (/encoding="(gbk|gb2312|gb18030)"/.test(head)) {
    return new TextDecoder('gbk').decode(buf);
  }
  return new TextDecoder('utf-8').decode(buf);
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// A numeric character reference may name a code point that does not exist
// (above 0x10FFFF) or that is not a Unicode scalar value (a surrogate). Feed
// input is arbitrary network data, so such a reference degrades to U+FFFD
// rather than throwing RangeError out of the collector.
function charOrReplacement(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return '\uFFFD';
  if (n >= 0xd800 && n <= 0xdfff) return '\uFFFD';
  return String.fromCodePoint(n);
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => charOrReplacement(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => charOrReplacement(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

function stripCdata(s) {
  return s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
}

export function field(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decodeEntities(stripCdata(m[1])).trim() : '';
}

export function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick = (pred) => {
    for (const attrs of links) {
      if (!pred(attrs)) continue;
      const href = /href\s*=\s*"([^"]*)"/i.exec(attrs);
      if (href) return decodeEntities(href[1]);
    }
    return '';
  };
  const isAlternate = (attrs) => /rel\s*=\s*"alternate"/i.test(attrs);
  return pick(isAlternate) || pick(() => true);
}

export function splitItems(xml) {
  const out = [];
  const patterns = [/<item\b[^>]*>([\s\S]*?)<\/item>/gi, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi];
  for (const re of patterns) {
    for (const m of xml.matchAll(re)) out.push(m[0]);
  }
  return out;
}

// Upstream text is normalised here and nowhere else, so this is where the classes of
// hostile text are refused. A control byte can redraw an operator's terminal line or sit
// in the published pool; a whitespace control becomes a space so words keep their
// separation, and every other C0, C1 and DEL byte is dropped. The marker vocabulary below
// is the grammar the renderer trusts, so text that merely spells it must not draw a badge
// on a published card: a marker's bracket and colon become spaces, and a status token's
// hash becomes a space rather than being deleted. Markdown link syntax is the same class
// of trusted text, so the seam below is spaced here too. The length bound is applied last.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
// A whole marker, opener and closer together, with a plausible body after the opener: a
// bracketed span that reads like a label rather than a sentence. Both brackets and the colon
// become spaces and the body keeps its words, so 'Rust 1.90 [prov:preprint] notes' reads
// 'Rust 1.90 prov preprint notes' instead of leaving a stray closer behind.
const MARKER = /\[(src|alt|prov):([a-z0-9][a-z0-9 ._/-]*)\]/gi;
// An opener whose body is not plausible is still the vocabulary the renderer trusts, so the whole
// bracketed span loses its opener and its closer while the body keeps its words: 'a [prov:_x] b'
// reads 'a _x b' rather than leaving 'a _x] b', because a surviving closer is a fragment of the
// grammar the renderer reads. The closer is only consumed when it is on the same line and belongs
// to this bracket pair (no '[' between it and the opener); a legitimate bracketed word that spells
// no opener keeps its brackets, and an opener with no closer of its own is dropped by the rule
// below.
const MARKER_OPENER = /\[(?:src|alt|prov):([^\[\]\n]*)\]/gi;
const MARKER_OPEN = /\[(?:src|alt|prov):/gi;
// The hash is replaced by a space rather than deleted: a title that merely spells '#new' is
// still prose, and 'C#new' must not fuse into one word. A status flag is a token, so its '#'
// must not be glued to a word character: 'C#new', 'F# watch mode' and '#newrelease' keep every
// character, while a '#new' that opens the text or follows whitespace or punctuation is still
// neutralised. The renderer's own scans use the same boundary, so the two agree on what a flag
// is; so does the shipped example's legend, which writes '#new' between backticks to show the
// tag the vocabulary draws.
const STATUS_FLAG = /(?<!\w)#(?=(?:new|followup|developing|watch)\b)/gi;
// The renderer draws emphasis from '**like this**', so the bold marker is the same class of
// trusted vocabulary as a citation and a status token: upstream text that spells it drew real
// emphasis into a published card. Both asterisks become a space, so the words keep their
// separation and no emphasis is drawn.
const BOLD = /\*\*/g;
// A bracketed label immediately followed by a parenthesised destination is a link in every
// markdown reader, and a notice is published text in the Coverage note: upstream text that
// merely spells the syntax drew a live anchor pointing wherever the upstream value chose
// ('the identifier is not a CVE id: "[x](https://evil.example/pwn)"'). One space between the
// two halves ends the link grammar while the rejected value stays legible - the reader still
// sees the brackets and the destination - and nothing else moves, because only the '](' seam
// is rewritten: an ordinary bracketed word, a parenthetical remark, and every other mark of
// punctuation in a legitimate server message survive byte-identical. The marker rules above
// run first, and they already consume a citation's closer with its opener, so the seam a
// legitimate '[src:OUTLET DATE](url)' carries is never reached here. A reference-style link
// is not a live link on its own - it needs a definition line - and both callers have already
// turned every control byte, newline included, into a space, so the text normalised here
// cannot carry one.
const LINK_SEAM = /\]\(/g;
// The same seam written in entity references. The marker and tag rules run before this one and the
// entity rule already refuses an encoded tag opener, but a ']' and a '(' spelled as entities are
// not tags: '&#91;click here&#93;&#40;https://evil.example/pwn&#41;' is byte-identical to a live
// link in every Markdown reader, and it was measured published unchanged in a notice (G2-4 / F27-7).
// One space between the closer and the parenthesis ends the link grammar while the text stays
// legible, exactly as the literal rule does. The spellings READ are the ones a parser actually
// decodes, which the Batch 45 rule did not: it required a literal '(' after an entity for ')' or
// '(', so it fired on '&#93;&#40;(' -- a spelling the defect never had -- while the leaking
// '&#91;a&#93;&#40;url&#41' (both halves as semicolon-less references), '&#x5B;a&#x5D;&#x28;(url)'
// and the named '&rbrack;&lpar;(url)' passed through byte for byte. Both halves are read now, in
// every form an entity can take, and ordinary prose that merely spells '&#40;' with no link in
// front of it still loses nothing but the grammar it never had.
// A numeric character reference for one code point, in decimal or in hex, WITH or WITHOUT its
// terminating semicolon. The semicolon-less form is not a lax spelling: the HTML Standard's
// 'missing-semicolon-after-character-reference' rule says the parser behaves as if the reference
// were terminated by ';' (https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state),
// so '&#x5D;' and '&#x5D' decode to the same ']' in every browser. The semicolon-less alternative is
// refused only when a digit (decimal) or a hex digit (hex) continues the run, because that run is a
// longer reference: '&#401;' is one code point and is not '&#40' followed by '1'.
function entityRef(decimal, hex) {
  return '(?:&#' + decimal + ';|&#' + decimal + '(?!\\d)'
    + '|&#x' + hex + ';|&#x' + hex + '(?![0-9a-fA-F]))';
}
// The character that can stand immediately before a link's '(' -- a link's ']', and the two legacy
// spellings this rule has always read. A NAMED reference is decoded only with its ';' (the standard
// has no semicolon-less legacy form for these), so the named alternatives carry one.
const ENCODED_SEAM_END = '(?:'
  + entityRef('0*93', '0*5d') + '|&rbrack;|&rsqb;'
  + '|' + entityRef('0*41', '0*29') + '|&rpar;'
  + '|' + entityRef('0*40', '0*28') + '|&lpar;'
  + ')';
// What can open a destination: the literal '(' or any spelling of it as a reference.
const ENCODED_SEAM_START = '(?:\\(|' + entityRef('0*40', '0*28') + '|&lpar;)';
// The seam is read as '<closing spelling> immediately before <opening spelling>', with the opening
// half in a LOOKAHEAD rather than consumed. That is what makes one application of this rule a fixed
// point on a chain: '&#x5B;a&#x5D;&#x28;(url)' is split at BOTH seams by the one pass (after the
// first match the scan resumes ON the opening reference, whose own lookahead then sees the literal
// '('). Consuming the opening half instead left '&#93; &#40;(' for the next pass, and the previous
// design -- an opening reference followed by a literal '(' -- never read the spellings that leak at
// all (a ']' and a '(' both written as references), which is what the false closure of Batch 45
// measured (verification F28-2, sweep F28-3).
const ENCODED_LINK_SEAM = new RegExp('(' + ENCODED_SEAM_END + ')(?=' + ENCODED_SEAM_START + ')', 'gi');

// The vocabulary the renderer trusts, as one step with one contract: upstream text must not
// draw a badge, a status tag or emphasis on a published card. A candidate field is normalised
// with this. The markdown link seam below is deliberately not part of it: candidate prose is the
// pool the digest is written from, and a GitHub release body is Markdown by construction, so its
// links are the normal case rather than a hostile spelling.
export function neutraliseMarkers(text) {
  return String(text)
    .replace(MARKER, ' $1 $2 ')
    .replace(MARKER_OPENER, ' $1 ')
    .replace(MARKER_OPEN, ' ')
    .replace(STATUS_FLAG, ' ')
    .replace(BOLD, ' ');
}

// The markdown link seam, applied where notices are sanitised and nowhere else. The comment above
// the marker vocabulary explains why the syntax has to go: a notice is published verbatim into
// the Coverage note, a bracketed label immediately followed by a parenthesised destination is a
// link in every markdown reader, and upstream text that merely spells the syntax would draw a
// live anchor pointing wherever the upstream value chose. One space between the two halves ends
// the link grammar while the rejected value stays legible - the reader still sees the brackets
// and the destination - and nothing else moves, because only the '](' seam is rewritten: an
// ordinary bracketed word, a parenthetical remark, and every other mark of punctuation in a
// legitimate server message survive byte-identical. The marker rules run first, and they already
// consume a citation's closer with its opener, so the seam a legitimate '[src:OUTLET DATE](url)'
// carries is never reached here. A reference-style link is not a live link on its own - it needs
// a definition line - and every caller has already turned the control bytes, newline included,
// into a space, so the text normalised here cannot carry one.
export function neutraliseLinkSeams(text) {
  return String(text ?? '').replace(LINK_SEAM, '] (').replace(ENCODED_LINK_SEAM, '$1 ');
}


// The rewriting a notice or a candidate crosses, run until its output stops moving. One pass of
// the rules above is a function, not a fixed point: a rule can hand the next one a shape it did
// not have -- a marker's closer followed by the '(' a later word spells is a link seam only
// after the marker rule has run -- so the text a second pass reads is not always the text the
// first pass read, and the length a caller measured can be one character per created seam short
// of the length that would survive. A text that has crossed this function is returned
// byte-identical by it, because the pass that produces it is the pass this function ends on, so a
// caller that bounds the text and a later caller that rewrites it again agree on its length: the
// room the first reserved is the room the second leaves.
//
// A pass never lengthens the text as a whole. The entity rule and every marker rule replace a
// run with a shorter one or with a space, and the tag-span rule replaces the '<' it reads with a
// space; the only rule that can lengthen anything, the seam rule's '](' to '] (', lengthens only
// a pair of characters it consumes, and the marker rules above it cannot spell that pair in their
// own output -- each of them ends with a space or with the plain text an ordinary span carried.
// A pass that changes nothing ends the loop, and a pass that changes something strictly shortens
// the text, so the loop terminates; each pass also rewrites strictly fewer marker or entity
// spellings, so it settles in a small number of passes for any text the rules can read.
function noticePreservingPass(text) {
  return neutraliseLinkSeams(neutraliseMarkers(neutraliseTagSpans(neutraliseEntityTags(text))));
}

export function noticePreservingRewrites(text) {
  let out = String(text ?? '');
  for (;;) {
    const next = noticePreservingPass(out);
    if (next === out) return out;
    out = next;
  }
}

// How many passes the loop above needs before its output stops moving. Exported for the
// regression suite, which fails if the bound is ever exceeded: a rule added later that takes
// more than two passes would otherwise make the shipped normaliser a partial fixed point, and
// every length measured against it would be short again (TR-165).
export function noticeRewritingPasses(text) {
  let out = String(text ?? '');
  let passes = 0;
  for (;;) {
    const next = noticePreservingPass(out);
    passes += 1;
    if (next === out || passes > 8) return passes;
    out = next;
  }
}

// The same vocabulary, in the one candidate field that is a URL rather than prose. The
// renderer reads a marker, a status token or an emphasis marker out of whatever its citation
// destinations do not cover, and a URL is published as a destination: a line break, or the
// first unbalanced parenthesis, ends the destination there (the renderer's destination
// grammar admits one level of balanced parentheses and no line break), so a vocabulary the
// URL spells after that point is read as prose and drew a badge, an alternative-source pill
// or a status tag on the card. The collector is the only place that can cover a destination
// that ends early, so the field is neutralised here, before it reaches the pool.
//
// The marker's brackets are encoded whenever the URL spells an opener. '[' and ']' are not
// legal unencoded in a URL outside the host's IPv6 form, so no well-formed URL loses
// anything: a URL that merely carries a query string, a fragment or a Wikipedia-style
// balanced parenthesis is returned byte-identical.
const URL_MARKER = /\[(?:src|alt|prov):/i;
// A flag is the same token here as in the neutraliser: its '#' must not be glued to a word
// character, so a URL fragment such as 'https://x/y#new' stays a '#' and is read by the
// renderer as the fragment it is, while a token that opens the URL or follows whitespace or
// punctuation is still encoded before the URL can leak it into the renderer's scans.
const URL_STATUS = /(?<!\w)#(?=(?:new|followup|developing|watch)\b)/gi;
const URL_BOLD = /\*\*/g;

// Whether the URL would end its own citation destination early. '#' and '*' are legal and
// meaningful in an ordinary URL ('https://example.com/page#new' is a fragment, not a status
// token), so they are only encoded for a URL that cannot stay inside its destination - the
// shape that can leak them into the renderer's marker scans at all.
function breaksDestination(url) {
  let depth = 0;
  for (const ch of String(url)) {
    if (ch === '\n' || ch === '\r') return true;
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) return true;
      depth -= 1;
    }
  }
  return depth !== 0;
}

export function neutraliseUrl(url) {
  let out = String(url ?? '');
  if (URL_MARKER.test(out)) out = out.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  if (breaksDestination(out)) {
    out = out.replace(URL_STATUS, '%23').replace(URL_BOLD, '%2A%2A');
  }
  return out;
}

// The tag shape itself, as one rule with one contract: a '<' that opens a markup tag has a tag
// name or a closer slash or a declaration marker immediately after it, so '<a href=x>', '</a>',
// '<img src=x>' and '<!DOCTYPE html>' are tag-shaped while an ordinary comparison is not. Every
// alternative also ends with the '>' that closes the span, so the rule reaches exactly the tags
// that carry one. Measured: '<script', '<img' and '<a href=x' -- an opener cut off by a length
// bound or by a hostile body -- come back byte-identical, as does a bare '<foo>' whose name is
// not in the markup vocabulary below. The gap is inert rather than papered over: a Markdown
// reader draws no markup from an unterminated opener, and the renderer escapes '&', '<' and '>'
// on the way out (scripts/render-html.mjs), so the byte reaches a reader as the text it is. The
// rule is not widened to cover that spelling, because the same alternation is what keeps the
// ordinary comparisons byte-identical: 'a < b' and 'see <id>' have to stay as they are, and an
// opener with no '>' of its own cannot be told from them. One rule is shared because the same
// text crosses two boundaries -- a candidate field and the notice push -- and a second spelling
// of the shape would let one boundary drift from the other (TR-122). Every span is read, not the
// first: a message carrying a live anchor and a live closer after it is a message carrying two
// tags, and the second one is markup whether or not the first was.
const TAG_SHAPE = '<\\/[A-Za-z][\\w:.-]*\\s*>|<![^<>]*>|<[A-Za-z][\\w:.-]*[^<>]*>';
export const TAG_SPAN = new RegExp(TAG_SHAPE);
const TAG_SPANS = new RegExp(TAG_SHAPE, 'g');

// The bare names that are markup rather than an ordinary angle-bracketed word. A span carrying an
// attribute list, a closer or a declaration is markup whatever its name is; a span that is only a
// word in brackets is markup only when the word is one of these, and 'see <id>' or '<apiVersion>'
// in a server's own wording is a comparison the reader must still be able to read (TR-122). The
// list is the vocabulary a reader -- and a Markdown renderer that passes raw HTML through -- draws
// an element from.
const TAG_NAMES = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'base', 'b', 'basefont',
  'bdi', 'bdo', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'cite',
  'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog',
  'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'font', 'footer',
  'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup',
  'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link',
  'main', 'map', 'mark', 'marquee', 'menu', 'meta', 'meter', 'nav', 'noframes', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture', 'plaintext', 'pre',
  'progress', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp', 'script', 'search', 'section',
  'select', 'slot', 'small', 'source', 'span', 'strike', 'strong', 'style', 'sub', 'summary',
  'sup', 'svg', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time',
  'title', 'tr', 'track', 'tt', 'u', 'ul', 'var', 'video', 'wbr',
]);

// Whether a '<...>' span is tag-shaped. An attribute list is what tells '<a href=x>' from the
// ordinary '<a>' a comparison can spell, so a bare name needs the markup vocabulary above; every
// other shape -- a closer, a declaration, an opener with attributes or a self-closing slash -- is
// markup on its own.
function isTagSpan(span) {
  const body = span.slice(1, -1);
  if (body.startsWith('/') || body.startsWith('!')) return true;
  if (/^[A-Za-z][\w:.-]*$/.test(body)) return TAG_NAMES.has(body.toLowerCase());
  const name = /^[A-Za-z][\w:.-]*/.exec(body);
  return name !== null && (body[name[0].length] === '/' || /\s/.test(body[name[0].length] ?? ''));
}

// The tag shape with no markup left behind: the '<' becomes a space and the rest of the span
// stays, so the text is still legible -- 'a href=x>click /a>' reads as the rejected answer it
// was -- while no reader, a Markdown renderer included, can draw an element from it. Only a span
// the shape rule reads as markup is touched, so an ordinary comparison a server's own message
// carries ('a < b', 'see <id>') is returned byte-identical. The candidate normaliser keeps its
// own, wider tag strip -- it drops the whole span, because a candidate is prose rather than a
// notice quoted from a server -- and this rule is the one the notice push draws, so a value that
// crosses both boundaries is read the same way by both (TR-122).
export function neutraliseTagSpans(raw) {
  return String(raw).replace(TAG_SPANS, (m) => (isTagSpan(m) ? ' ' + m.slice(1) : m));
}

// The tag shape has a second spelling: an entity reference to '<'. The literal rule above cannot
// read it, and the two boundaries decode at different points -- the candidate normaliser decodes
// after its own literal strip, so a decoded opener arrives too late to be stripped, while the
// notice push never decodes at all, so an encoded anchor is published for the reader to decode --
// so the encoded opener is refused by one rule that both boundaries draw (TR-123). The reference
// is read the way a reader reads it: case is free, and the semicolon is optional for every
// spelling alike. A reference with no semicolon ends only at its own terminator, so a longer
// reference is a different character and is not mistaken for a '<' ('&#x3cb;' is the code point
// U+03CB). The terminator rule belongs to the text context, which is the one a reader applies
// here: '&lt' without its semicolon is the '<' whenever no longer name extends it, and only the
// attribute context would hold it literal before an alphanumeric -- so '&ltscript&gt;' and
// '&lta href=x&gt;' spell '<script>' and '<a href=x>' and are refused exactly as '&#60script' is,
// while '&lt a href=x&gt;', where the reference ends at the space, is not an opener at all. What
// follows the reference must be the shape that makes it a tag: a name, a closer slash or a
// declaration marker. Everything else is returned byte-identical, so a comparison ('a &lt; b',
// 'x &lt;3') and ordinary entity text ('&amp;') keep the bytes they had.
const ENTITY_LT = /&(?:lt;|lt|#0*60;|#0*60(?![0-9])|#x0*3c;|#x0*3c(?![0-9A-Fa-f]))(?=\/?[A-Za-z]|!)/gi;

export function neutraliseEntityTags(raw) {
  return String(raw).replace(ENTITY_LT, ' ');
}

export function plainText(raw, limit) {
  const bound = requirePositive(limit, 'the character limit');
  // The markdown link seam is deliberately not part of this path: a candidate field is the prose
  // the digest is written from, and a GitHub release body is Markdown by construction, so its
  // links are the normal case rather than a hostile spelling. The notice rewriting that ends the
  // seam belongs to notice text alone (TR-112, TR-165).
  const text = neutraliseMarkers(
    decodeEntities(neutraliseEntityTags(String(raw)).replace(/<[^>]*>/g, ' '))
      .replace(CONTROLS, (ch) => (/\s/.test(ch) ? ' ' : '')),
  )
    .replace(/\s+/g, ' ').trim();
  return text.length > bound ? text.slice(0, bound) : text;
}

export function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

export function isDiscoveryOnly(url, hosts) {
  const host = hostOf(url);
  if (!host) return false;
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}
