// scripts/lib/net.mjs
// Fetch, charset decoding and feed parsing for the tech-radar skill.
// Zero dependencies. Uses curl through child_process so that HTTP behaviour is the
// same wherever this runs, and so no polyfill or bundled dependency is needed.
import { execFileSync } from 'node:child_process';

export const DEFAULT_UA = 'tech-radar/1.0';

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
const SECRET_SHAPES = [
  /\bBearer\s+[^\s,;"']{8,}/gi,
  /\b(?:proxy-)?authorization\s*:\s*(?:\S+\s+)?\S+/gi,
  /\bgh[pousr]_[A-Za-z0-9]{6,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
];

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
  'pass', 'pwd', 'pw', 'pswd', 'secret', 'token', 'auth', 'key', 'sig', 'signature', 'session',
  'credential', 'cookie', 'bearer', 'jwt', 'otp', 'pin', 'hmac', 'ticket', 'assertion', 'saml',
  'samlresponse', 'nonce',
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
    if (token === CREDENTIAL_CODE_TOKEN || CREDENTIAL_STEMS.includes(token)) return true;
  }
  return CREDENTIAL_STEMS.some((stem) => normalized.endsWith(stem));
}

// The name as the server reads it: a percent-encoded spelling of a credential name is the same
// parameter to the server, so it is the same parameter here. Both the stem list and the token rule
// are re-run on the decoded form.
function credentialParam(name) {
  const raw = String(name ?? '');
  if (isCredentialName(raw)) return true;
  try { return isCredentialName(decodeURIComponent(raw.replace(/\+/g, ' '))); } catch { return false; }
}

// How long a value is once the server has decoded it, which is the value the floor is about: a
// two-character value spelled out as percent-encoded pairs is still a two-character value.
function decodedLength(value) {
  const raw = String(value ?? '');
  try { return decodeURIComponent(raw.replace(/\+/g, ' ')).length; } catch { return raw.length; }
}

// A Basic credential is the base64 of 'user:password', so it is recognised as one: the token
// decodes to printable text carrying the colon. Matching by that property leaves a body that
// merely says 'Basic authentication' readable while a server that echoes the request's
// credential gives it up.
function redactBasicCredentials(text) {
  return String(text).replace(/\bBasic\s+([A-Za-z0-9+/]{8,}={0,2})/gi, (whole, token) => {
    let decoded = '';
    try { decoded = Buffer.from(token, 'base64').toString('utf8'); } catch { return whole; }
    if (!decoded.includes(':') || !/^[\x20-\x7e]+$/.test(decoded)) return whole;
    return whole.slice(0, whole.length - token.length) + '[redacted]';
  });
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
    const v = String(value ?? '');
    if (v === '') return;
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
    const v = String(value ?? '');
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
  const queryEligibility = (length) => ({
    notice: length >= MIN_CREDENTIAL_VALUE_CHARS,
    candidate: length >= MIN_SECRET_CHARS,
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
      const eligible = queryEligibility(value.length);
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
      const eligible = queryEligibility(decodedLength(rawValue));
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
      const eligible = queryEligibility(decodedLength(m[2]));
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
// request sent, so it stays; a standalone one goes whatever its length. The boundary is the one
// the status token uses - a word character on either side makes it part of a word.
function boundedValue(value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![A-Za-z0-9_])' + escaped + '(?![A-Za-z0-9_])', 'g');
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
function withoutSentinel(value) {
  return String(value ?? '').replace(REDACTION_SENTINEL_RE, ' ');
}

// The marker's own shape, read as a span: a marker an earlier pass wrote is the one region this
// pass does not scan, so the pass applied again to its own output changes nothing. Without that
// the marker is not a fixed point, because every substring of it ('redacted', 'redacted]',
// 'edacted]', '[redacte', '[redacted') is a value a request can carry, and a later pass would
// rewrite the marker the previous one wrote: it grows by one occurrence of itself per pass
// ('[[redacted]]', '[[[[redacted]]]]'), and a notice published that way is rewritten again by
// every pass that follows it. Only a published marker is protected; no other text is skipped.
const MARKER_SPAN_RE = /\[redacted\]/g;
function forEachUnmarkedSpan(text, fn) {
  if (!text.includes(REDACTED_MARKER)) return fn(text);
  MARKER_SPAN_RE.lastIndex = 0;
  let out = '';
  let last = 0;
  let m;
  while ((m = MARKER_SPAN_RE.exec(text)) !== null) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

// One pass over the input produces the published text. Every removal the pass makes is one
// sentinel, and the marker is put in its place only when the whole pass has ended, so no removal
// can read back a marker this pass wrote; and a marker an earlier pass wrote is a span this pass
// does not read at all, so the text the pass publishes is a fixed point of the pass. The output
// is never longer than the text that went in plus, for each removal, the difference between the
// marker and the value that stood there -- and a value below the floor is removed only where it
// stands as its own token, so a value that is merely part of a longer word stays (TR-110).
export function redactSecrets(text, secrets) {
  const values = new Set();
  for (const raw of secrets ?? []) {
    const value = withoutSentinel(raw);
    if (value === '') continue;
    values.add(value);
    const respelled = urlSpelling(value);
    if (respelled !== null) values.add(withoutSentinel(respelled));
  }
  const sorted = [...values].sort((a, b) => b.length - a.length);
  const mark = (span) => {
    let out = redactBasicCredentials(span);
    for (const value of sorted) {
      if (value.length >= MIN_SECRET_CHARS) {
        out = out.split(value).join(REDACTION_SENTINEL);
        out = out.replace(looseValue(value), REDACTION_SENTINEL);
      } else {
        out = out.replace(boundedValue(value), REDACTION_SENTINEL);
      }
    }
    for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTION_SENTINEL);
    return out;
  };
  return forEachUnmarkedSpan(withoutSentinel(text), mark)
    .replace(REDACTION_SENTINEL_RE, REDACTED_MARKER);
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
  shaped.url = url;
  shaped.cause = `HTTP ${status}`;
  shaped.httpStatus = Number(status);
  shaped.body = snippet;
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
export function repriceShapedError(err, extraSecrets, snippetLimit) {
  if (err === null || typeof err !== 'object') return err;
  const bound = Number.isFinite(Number(snippetLimit)) && Number(snippetLimit) > 0
    ? Number(snippetLimit) : null;
  const url = String(err.url ?? '');
  const omitUrl = url === '';
  let candidate = null;
  if (Number.isInteger(err.httpStatus)) {
    const prefix = 'HTTP ' + err.httpStatus + ' for ';
    const room = bound === null ? Infinity : Math.max(0, bound - prefix.length);
    const shown = omitUrl ? '' : noticePreservingRewrites(redactSecrets(redactUrl(url), extraSecrets));
    const text = omitUrl
      ? 'HTTP ' + err.httpStatus
      : prefix + (shown.length > room ? shown.slice(0, room) : shown);
    candidate = new Error(text);
    candidate.cause = 'HTTP ' + err.httpStatus;
    candidate.httpStatus = Number(err.httpStatus);
  } else if (err.httpStatus === null && typeof err.cause === 'string') {
    const cause = noticePreservingRewrites(redactSecrets(err.cause, extraSecrets));
    const prefix = 'request failed for ';
    const shortPrefix = 'request failed';
    const separator = ': ';
    const shown = omitUrl ? '' : noticePreservingRewrites(redactSecrets(redactUrl(url), extraSecrets));
    const room = bound === null ? Infinity : Math.max(0, bound - prefix.length - separator.length - cause.length);
    const full = omitUrl
      ? shortPrefix + separator + cause
      : prefix + (shown.length > room ? shown.slice(0, room) : shown) + separator + cause;
    const compact = shortPrefix + separator + cause;
    candidate = new Error(bound !== null && full.length > bound && compact.length <= bound ? compact : full);
    candidate.cause = cause;
    candidate.httpStatus = null;
  } else {
    return err;
  }
  if (bound !== null && candidate.message.length > bound) return err;
  const out = new Error(String(err.message));
  for (const key of Object.keys(err)) out[key] = err[key];
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
  shaped.url = url;
  shaped.httpStatus = null; // a transport failure has no HTTP status
  shaped.exitStatus = Number.isInteger(err?.status) ? err.status : null;
  shaped.body = '';
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
  return String(text ?? '').replace(LINK_SEAM, '] (');
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
