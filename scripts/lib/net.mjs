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

// curl's own diagnostic line is quoted in a notice, and a child-process message can carry
// the whole argv -- which is where an Authorization header lives. Anything shaped like
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

// The removal itself, and the second half of the boundary: every notice in the collector is
// pushed through this, so a path that quotes a server answer cannot forget it. A value is
// removed against the request's own values -- longest first, so a value that contains another is
// removed whole -- and the set is removed as it is given: the floor belongs to the place that
// builds it, which is the only place that knows whether the value came from the request's URL or
// from a header or from prose. The shape list covers the credential classes no curated set can
// know.
export function redactSecrets(text, secrets) {
  let out = redactBasicCredentials(String(text ?? ''));
  const values = [...new Set((secrets ?? []).map((v) => String(v ?? '')))]
    .filter((v) => v !== '')
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    if (value.length >= MIN_SECRET_CHARS) {
      out = out.split(value).join('[redacted]');
      out = out.replace(looseValue(value), '[redacted]');
    } else {
      out = out.replace(boundedValue(value), '[redacted]');
    }
  }
  for (const shape of SECRET_SHAPES) out = out.replace(shape, '[redacted]');
  return out;
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
// 0). Pure and offline-testable. The body snippet is bounded and tag-stripped so a
// notice cannot become an unbounded server dump.
export function shapeHttpError(status, body, url, limit, headers) {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  // The snippet is notice text, and a notice is published verbatim into the Coverage note, so
  // the markdown link seam belongs here with the rest of the notice normalisation.
  const snippet = redactSecrets(
    neutraliseLinkSeams(plainText(decodeBuffer(source), requirePositive(limit, 'the error snippet limit in characters'))),
    requestSecrets(url, headers),
  );
  const shaped = new Error(`HTTP ${status} for ${redactUrl(url)}: ${snippet || 'no response body'}`);
  shaped.url = url;
  shaped.httpStatus = Number(status);
  shaped.body = snippet;
  return shaped;
}

// A transport failure that produced no diagnostic line of its own: curl's process exit
// status when it ran, or the spawn's error code when the binary could not be started at all.
// Never the child-process message, which quotes the whole argv.
function transportCause(err) {
  if (Number.isInteger(err?.status)) return `curl exited with status ${err.status}`;
  if (typeof err?.code === 'string' && err.code !== '') {
    return `curl could not be started (${err.code})`;
  }
  return 'curl failed';
}

// A child-process failure: curl exited non-zero, so no HTTP exchange completed.
// err.status is curl's *process* exit code and err.stdout may hold a partial body
// plus the write-out status line, so neither is read as an HTTP status; the cause
// is curl's own first stderr line, bounded like every other snippet. Pure and
// offline-testable.
export function shapeTransportError(err, url, limit, headers) {
  const bound = requirePositive(limit, 'the error snippet limit in characters');
  const stderr = String(err?.stderr ?? '').trim();
  const first = stderr.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? '';
  const capped = first.length > bound ? first.slice(0, bound) : first;
  // err.message is never a cause: Node builds it from the whole argv, and the argv carries
  // the Authorization header. An empty stderr is reported from what the failure itself
  // carries instead, which tells a missing dependency from an unreachable feed: curl's own
  // process exit status when it ran, and the spawn's error code when it never started.
  const cause = capped || transportCause(err);
  const shaped = new Error(`request failed for ${redactUrl(url)}: ${redactSecrets(cause, requestSecrets(url, headers))}`);
  // No cause line of its own means curl never produced a diagnostic: the caller can tell a
  // broken dependency from a source that answered.
  shaped.noDiagnostic = capped === '';
  shaped.url = url;
  shaped.httpStatus = null; // a transport failure has no HTTP status
  shaped.exitStatus = Number.isInteger(err?.status) ? err.status : null;
  shaped.body = '';
  return shaped;
}

function curlBuffer(url, ms, headers = {}, ua = DEFAULT_UA, snippetLimit) {
  const args = ['-sSL', '--compressed', '--max-time', String(Math.ceil(requirePositive(ms, 'the request timeout in milliseconds') / 1000)), '-A', ua, '-w', WRITE_OUT];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  // '--' ends curl's option list, so a target can never be read as a flag.
  args.push('--', url);
  let raw;
  try {
    // stdio is spelled out so curl's own error line is captured instead of being
    // inherited: execFileSync otherwise prints the child's stderr on ours. The 64 MiB
    // ceiling is infrastructure rather than policy -- it bounds one child process's
    // captured output so a hostile or broken response cannot exhaust memory, and a
    // configuration value here would only let a typo take the run down.
    raw = execFileSync('curl', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw shapeTransportError(err, url, snippetLimit, headers);
  }
  const { body, status } = splitCurlOutput(raw);
  // curl completed the exchange (exit 0) and the server answered 4xx/5xx: the only
  // case where a status is ours to report.
  if (status >= 400) throw shapeHttpError(status, body, url, snippetLimit, headers);
  return body;
}

export async function fetchText(url, ms, headers = {}, ua = DEFAULT_UA, snippetLimit) {
  return decodeBuffer(curlBuffer(url, ms, headers, ua, snippetLimit));
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

export function plainText(raw, limit) {
  const bound = requirePositive(limit, 'the character limit');
  const text = neutraliseMarkers(
    decodeEntities(String(raw).replace(/<[^>]*>/g, ' '))
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
