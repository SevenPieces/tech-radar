// tests/net.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeBuffer, decodeEntities, field, atomLink, splitItems, neutraliseMarkers, neutraliseLinkSeams, plainText, isDiscoveryOnly, hostOf, shapeHttpError, shapeTransportError, splitCurlOutput, redactUrl, fetchText, neutraliseUrl, requestSecrets, redactSecrets, neutraliseEntityTags } from '../scripts/lib/net.mjs';
import { curlAvailable } from './lib/commands.mjs';

test('decodeBuffer passes UTF-8 through', () => {
  assert.equal(decodeBuffer(Buffer.from('中文 test', 'utf8')), '中文 test');
});

test('decodeBuffer decodes GBK when the bytes are not valid UTF-8', () => {
  // "中文" in GBK
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  const withDecl = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="gb2312"?>'), gbk]);
  assert.equal(decodeBuffer(withDecl), '<?xml version="1.0" encoding="gb2312"?>中文');
});

test('decodeBuffer strips a UTF-8 BOM', () => {
  assert.equal(decodeBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x')])), 'x');
});

test('decodeEntities handles named, decimal and hex entities', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#39; &#x4e2d;'), "a & b <c> 'd' 中");
});

test('decodeEntities degrades out-of-range numeric references instead of throwing', () => {
  assert.equal(decodeEntities('&#x110000;'), '\uFFFD');
  assert.equal(decodeEntities('&#99999999999999999999;'), '\uFFFD');
  assert.equal(decodeEntities('&#' + '9'.repeat(400) + ';'), '\uFFFD');
  assert.equal(decodeEntities('&#xDFFF;'), '\uFFFD');
  assert.equal(decodeEntities('a&#x110000;b'), 'a\uFFFDb');
  assert.equal(decodeEntities('&#x10FFFF;'), '\u{10FFFF}');
  assert.equal(decodeEntities('&#x4e2d;'), '中');
});

test('field reads a tag, unwraps CDATA and returns empty when absent', () => {
  assert.equal(field('<title><![CDATA[Hello & bye]]></title>', 'title'), 'Hello & bye');
  assert.equal(field('<a>1</a>', 'title'), '');
});

test('atomLink prefers the alternate link href', () => {
  const block = '<link rel="edit" href="https://x/edit"/><link rel="alternate" href="https://x/post"/>';
  assert.equal(atomLink(block), 'https://x/post');
});

test('splitItems handles RSS 2.0, RDF and Atom', () => {
  assert.equal(splitItems('<rss><channel><item>a</item><item>b</item></channel></rss>').length, 2);
  assert.equal(splitItems('<rdf:RDF><item rdf:about="x">a</item></rdf:RDF>').length, 1);
  assert.equal(splitItems('<feed><entry>a</entry><entry>b</entry></feed>').length, 2);
});

test('plainText strips tags and bounds the result', () => {
  assert.equal(plainText('<p>Hello <b>world</b></p>', 100), 'Hello world');
  assert.equal(plainText('x'.repeat(500), 10), 'xxxxxxxxxx');
});

// Regression test: the length bound was the only rule plainText enforced, so the
// control bytes a hostile upstream body can carry lived on into the collector notice,
// the pool and stderr. \s+ collapses none of ESC, NUL, BS or DEL: an ESC sequence that
// survived into a terminal notice redrew the operator's line, which is the defect this
// pins.
// Batch 93 (closing sweep F39-1) widened this row's second claim. No control byte SURVIVES -- the
// terminal-safety property this row was written for, and it is unchanged -- but a control byte is
// now the word separator it is in the text the surface wrote, not a deletion: a deletion glues the
// words it stood between, and the words a candidate can carry are a credential keyword and its
// value. The printable text around each control is still there and the words stay separate.
test('plainText drops no control code point into the published text, and spaces where it stood', () => {
  const hostile = 'a\u001b[2Kb\u0000c\u0008d\u007f e\u009ff';
  const out = plainText(hostile, 200);
  const offenders = [...out].filter((ch) => {
    const cp = ch.codePointAt(0);
    return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
  });
  assert.deepEqual(offenders, [], 'control code points survived: ' + JSON.stringify(out));
  assert.equal(out, 'a [2Kb c d e f',
    'a control byte no longer keeps the words it stood between apart: ' + JSON.stringify(out));
  assert.match(out, /a \[2Kb c d e f/, 'the printable text around each control is still there');
});

// Closing sweep F38-1 (Medium, Batch 88), the upstream half of the same class. U+0085 is a
// whitespace control by Unicode (White_Space=Yes) and one of the five line ends the module reads,
// but JavaScript's \s excludes it, so this pass DROPPED it where every other line end became a
// space. Dropping it glues the words it separated, and the words a candidate carries can be a
// credential keyword and its value: 'auth=Basic' + NEL + <base64> reached the pool as the single
// word 'auth=Basic<base64>', which no rule can read because every keyword gap requires at least one
// character. Measured on the shipped collector with an RSS title carrying both spellings: LF, CR,
// CRLF, LS, PS, SP and TAB were removed and the NEL spelling was published, at 87bddfd AND with the
// wider keyword rules alone -- the upstream drop was the reason. The row is an equality with LF's
// own answer, which is the one space this pass already gives every whitespace run.
test('plainText spaces a NEL exactly as it spaces LF, so a keyword keeps its distance from its value', () => {
  const B64 = Buffer.from('alice:' + 's3cr3tp4ssw0rd').toString('base64');
  const NEL = String.fromCharCode(0x85);
  const shape = (sep) => 'auth=Basic' + sep + B64;
  assert.equal(plainText(shape(NEL), 200), plainText(shape(String.fromCharCode(10)), 200),
    'the upstream pass answers a NEL differently from LF: ' + JSON.stringify(plainText(shape(NEL), 200)));
  assert.equal(plainText(shape(NEL), 200), 'auth=Basic ' + B64,
    'the NEL is not the space LF is');
});
// Batch 93 (closing sweep F39-1): the C1 controls beside a NEL are the same class the NEL was in,
// so they answer the way it does -- one space each, LF's own answer. The row used to pin the drop
// as intended behaviour; the drop was the defect (see the row above and the property test in
// tests/control-separator-property.test.mjs).
test('plainText spaces every other C1 control beside the NEL it also spaces', () => {
  const out = plainText('a\u009b' + 'b' + String.fromCharCode(0x85) + 'c\u009fd', 200);
  assert.equal(out, 'a b c d', 'a C1 control still glued the words it stood between: ' + JSON.stringify(out));
  assert.equal(out, plainText('a\n' + 'b' + String.fromCharCode(10) + 'c\nd', 200),
    'a C1 control does not answer as LF does');
});

// Regression test: the length bound must survive the character-class rule, so a
// bounded result is bounded either way.
test('plainText still bounds a body that is all control bytes', () => {
  assert.equal(plainText('\u001b'.repeat(500), 10), '');
  assert.ok(plainText('x\u0000'.repeat(300), 10).length <= 10);
});

// Regression test: the literal tag strip ran before the entities were decoded, so text that
// carried an encoded tag decoded into live markup only after the strip had gone past it - the
// one candidate path where upstream bytes reach the normaliser undecoded. The encoded opener is
// refused by the same rule the notice push draws, so the two boundaries cannot disagree, while
// ordinary entity text and a comparison keep the bytes they had.
test('plainText refuses an entity-encoded tag and leaves ordinary entity text alone', () => {
  const encoded = [
    '&lt;a href=https://evil.example/pwn&gt;click&lt;/a&gt;',
    '&lt;img src=https://evil.example/a.png&gt;',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  ];
  for (const text of encoded) {
    const out = plainText(text, 400);
    assert.doesNotMatch(out, /<[A-Za-z/!]/, 'an encoded tag decoded into the pool: ' + out);
    assert.doesNotMatch(out, /&(?:lt|#0*60|#x0*3c)/i, 'the encoded opener survived: ' + out);
  }
  assert.equal(plainText('fish &amp; chips &lt; 3', 400), 'fish & chips < 3',
    'ordinary entity text is decoded exactly as before');
  assert.equal(plainText('a < b', 400), 'a < b', 'a literal comparison stays byte-identical');
});

// The spellings the one rule reads: named, decimal and hexadecimal, any case, with or without
// the semicolon. A reference with no semicolon ends only at its own terminator, so a longer
// reference is not mistaken for a '<' ('&#x3cb;' is the code point U+03CB), and a reference that
// no tag name, closer or declaration follows is returned byte-identical. The named spelling is
// read by the same text-context rule as the numeric ones (TR-124): '&lt' with no semicolon is
// refused as soon as a tag name follows it, so '&ltscript&gt;' and '&lta href=x&gt;' are read as
// the tags they spell rather than passed through as text.
test('neutraliseEntityTags reads every spelling of an encoded opener', () => {
  for (const opener of ['&lt;', '&LT;', '&Lt;', '&#60;', '&#060;', '&#x3c;', '&#X3C;', '&#x03c;']) {
    const out = neutraliseEntityTags(opener + 'script&gt;');
    assert.doesNotMatch(out, /&(?:lt|#0*60|#x0*3c)/i, opener + ' survived: ' + out);
    assert.match(out, /script&gt;/, opener + ': the name and the rest stay legible: ' + out);
  }
  for (const opener of ['&lt/', '&lt', '&LT', '&Lt', '&#60/', '&#60', '&#x3c/', '&#x3c']) {
    const out = neutraliseEntityTags(opener + 'script&gt;');
    assert.doesNotMatch(out, /&(?:lt|#0*60|#x0*3c)/i,
      opener + ' without a semicolon survived: ' + out);
  }
  // A tag name after the opener is the shape that makes it a tag, semicolon or not: a reader
  // draws '<a href=x>' out of '&lta href=x&gt;' and '<a x>' out of '&lta x&gt;', in either case.
  for (const [opens, legible] of [
    ['&lta href=x&gt;', /href=x&gt;/],
    ['&LTa href=x&gt;', /href=x&gt;/],
    ['&lta x&gt;', /a x&gt;/],
    ['&LTa x&gt;', /a x&gt;/],
  ]) {
    const out = neutraliseEntityTags(opens);
    assert.doesNotMatch(out, /&lt/i, opens + ' survived: ' + out);
    assert.match(out, legible, opens + ': the rest stays legible: ' + out);
  }
  for (const kept of ['fish &amp; chips', 'a &lt; b', '&lt; b', 'x &lt;3', '&#x3cb; code point',
    'the answer is &lt; 10']) {
    assert.equal(neutraliseEntityTags(kept), kept,
      'text that opens no tag stays byte-identical: ' + kept);
  }
});

test('isDiscoveryOnly matches hosts and their subdomains', () => {
  const hosts = ['news.ycombinator.com', 'reddit.com', 'x.com'];
  assert.equal(isDiscoveryOnly('https://news.ycombinator.com/item?id=1', hosts), true);
  assert.equal(isDiscoveryOnly('https://old.reddit.com/r/x', hosts), true);
  assert.equal(isDiscoveryOnly('https://github.com/x/y/releases', hosts), false);
  assert.equal(hostOf('https://github.com/x/y'), 'github.com');
});


// --- transport failure shaping -------------------------------------------------
// curl runs with -w '\n%{http_code}', so the captured bytes end with the HTTP
// status on its own final line; curlBuffer splits it off and raises the shaped
// error itself for a status of 400 or above. Both helpers are pure: these cases
// feed them synthetic bytes and never touch the network.
test('splitCurlOutput strips the status line and leaves the body byte-identical', () => {
  const body = Buffer.from('<rss><channel>ok</channel></rss>\n'); // ends in a newline
  const split = splitCurlOutput(Buffer.concat([body, Buffer.from('\n200')]));
  assert.equal(split.status, 200);
  assert.ok(split.body.equals(body), 'body bytes unchanged, trailing newline included');
  assert.equal(split.body.toString('utf8'), '<rss><channel>ok</channel></rss>\n');

  const notFound = splitCurlOutput(Buffer.concat([Buffer.from('<html>nope</html>'), Buffer.from('\n404')]));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.toString('utf8'), '<html>nope</html>');

  const noStatus = splitCurlOutput(Buffer.from('a body with no status line'));
  assert.equal(noStatus.status, 0);
  assert.equal(noStatus.body.toString('utf8'), 'a body with no status line');
});

// The notice names the failure and never quotes the answer: a 4xx/5xx body is upstream text of
// arbitrary content, and a notice is published verbatim in the Coverage note, so the shaped HTTP
// error carries the status and the redacted request only. The upstream body appears nowhere in
// the message -- not truncated, not summarised, not as a "no response body" placeholder.
test('shapeHttpError names the HTTP status and the URL and never quotes the upstream body', () => {
  const url = 'https://api.github.com/repos/nodejs/node/releases?per_page=10';
  const body = JSON.stringify({ message: 'API rate limit exceeded for 203.0.113.9.' });
  const shaped = shapeHttpError(403, Buffer.from(body), url, 200);
  assert.equal(shaped.message, 'HTTP 403 for https://api.github.com/repos/nodejs/node/releases',
    'the status and the redacted URL are the whole notice');
  assert.equal(shaped.message.includes('API rate limit exceeded'), false,
    'the upstream body reached the notice: ' + shaped.message);
  assert.equal(shaped.message.includes('203.0.113.9'), false,
    'an upstream value reached the notice: ' + shaped.message);
  assert.doesNotMatch(shaped.message, /no response body/, 'the notice carries no body placeholder');
  assert.equal(shaped.httpStatus, 403, 'the status names the failure');
  assert.equal(shaped.url, url, 'the raw request stays on the error for the caller');
});

// error_snippet_max_chars is kept and re-purposed: it bounds the shaped error text, which is the
// redacted request URL. A URL longer than the bound is truncated there, the status stays legible,
// and the upstream body, however large, never appears.
test('shapeHttpError bounds the shaped error text and keeps the status', () => {
  const long = 'https://example.com/' + 'very-long-path-segment/'.repeat(40);
  const shaped = shapeHttpError(429, Buffer.from('x'.repeat(5000)), long, 40);
  assert.equal(shaped.httpStatus, 429);
  const prefix = 'HTTP 429 for ';
  assert.equal(shaped.message.startsWith(prefix), true, 'the status still names the failure: ' + shaped.message);
  const shown = shaped.message.slice(prefix.length);
  assert.ok(shown.length <= 40, 'the shaped error text exceeds the configured bound: ' + shown.length);
  assert.equal(shown, redactUrl(long).slice(0, shown.length), 'the bound truncates the redacted URL');
  assert.equal(shaped.message.includes(long), false, 'the unbounded URL survived the notice: ' + shaped.message);
  assert.equal(shaped.message.includes('x'.repeat(40)), false, 'the upstream body reached the notice');
});

// The rule removes the upstream text, not the diagnosis: the shaped HTTP error still names the
// status and the redacted request, and the transport error still names the request and a cause
// shaped from curl's exit code. The cause is the fixed vocabulary, never the line curl wrote --
// curl follows redirects and names the environment's proxy, so that line carries text the request
// never sent. A notice that said only "failed" would pass the no-echo half and lose the run's only
// account of a degraded source.
test('a notice still names the failure: status, redacted URL and transport cause', () => {
  const secret = 'SENTINEL' + 'KEYVALUE';
  const http = shapeHttpError(503, Buffer.from('Service Unavailable'),
    'https://svc.example/api?key=' + secret, 200);
  assert.equal(http.message, 'HTTP 503 for https://svc.example/api',
    'the status and the redacted URL are the notice: ' + http.message);
  assert.equal(http.message.includes(secret), false, 'the query credential reached the notice: ' + http.message);

  const failure = {
    status: 7,
    stdout: Buffer.from('\n000'),
    stderr: Buffer.from("curl: (7) Failed to connect to svc.example port 443 after 0 ms: Couldn't connect to server\n"),
  };
  const transport = shapeTransportError(failure, 'https://u:pw@svc.example/api?token=' + secret, 200);
  assert.equal(transport.message,
    'request failed for https://svc.example/api: failed to connect (curl exit 7)',
    'the transport notice names the request and the shaped cause: ' + transport.message);
  assert.doesNotMatch(transport.message, /port 443|Couldn't connect/,
    "curl's own line reached the notice: " + transport.message);
  assert.equal(transport.message.includes(secret), false, 'the query credential reached the notice: ' + transport.message);
  assert.equal(transport.exitStatus, 7, "curl's process exit status is labelled as such");
});

test('shapeTransportError reads the real execFileSync failure shape as a transport failure', () => {
  // Exactly the fields execFileSync sets when curl exits non-zero. status is the
  // *process* exit code, and with -w curl still writes a "000" status line to
  // stdout: neither may be reported as an HTTP status, and the cause is shaped from
  // that exit code rather than quoted from the stderr line beside it.
  const failure = {
    status: 7,
    signal: null,
    stdout: Buffer.from('\n000'),
    stderr: Buffer.from("curl: (7) Failed to connect to 127.0.0.1 port 1 after 0 ms: Couldn't connect to server\n"),
    message: "Command failed: curl -sSL ... http://127.0.0.1:1/feed.xml\ncurl: (7) Failed to connect ...",
  };
  const shaped = shapeTransportError(failure, 'http://127.0.0.1:1/feed.xml', 200);
  assert.equal(shaped.httpStatus, null, 'a transport failure must not claim an HTTP status');
  assert.doesNotMatch(shaped.message, /HTTP \d/);
  assert.equal(shaped.message,
    'request failed for http://127.0.0.1:1/feed.xml: failed to connect (curl exit 7)');
  assert.doesNotMatch(shaped.message, /Couldn't connect to server|curl: \(7\)/,
    "curl's own line reached the notice: " + shaped.message);
  assert.equal(shaped.exitStatus, 7, "curl's process exit code is labelled as such");
  assert.equal(shaped.body, '', 'the partial body and status line are not surfaced as content');
});

test('the real transport pins a failed loopback fetch to a transport failure, never an HTTP status', async (t) => {
  // The fetch this case pins is curl's, so the case can only run where curl starts. A machine
  // without it has no transport to test, and the skip names that rather than reporting a
  // failure the case never reached; where curl is present the whole case runs, unskipped.
  if (!curlAvailable()) {
    t.skip('curl is not on PATH, so the real transport cannot be attempted');
    return;
  }
  // Loopback to a closed port: offline-safe, never leaves the host. The cause is
  // deliberately not pinned to one curl code, because the same fetch is refused
  // (7) with a direct connection and times out (28) behind a proxy that accepts
  // but never answers; what must hold either way is the shape of the failure.
  let text = null;
  try {
    text = await fetchText('http://127.0.0.1:1/feed.xml', 2000, {}, 'tech-radar/1.0', 200);
  } catch (err) {
    assert.equal(err.httpStatus, null, 'a failed transport is not an HTTP status');
    assert.doesNotMatch(err.message, /HTTP \d/, 'no HTTP status may be claimed');
    assert.match(err.message, /^request failed for http:\/\/127\.0\.0\.1:1\/feed\.xml: \S/,
      "the message names the URL and carries a cause");
    assert.doesNotMatch(err.message, /curl: \(\d+\)/, "curl's own line is never quoted");
    assert.match(err.message, /(?:curl exit \d+|curl exited with status \d+|could not resolve the host|failed to connect|timed out|TLS handshake failed|empty reply|partial transfer)/,
      "the cause is the shaper's vocabulary and names the exit code: " + err.message);
    assert.ok(Number.isInteger(err.exitStatus), "curl's process exit code is recorded");
    return;
  }
  t.skip('something answered on 127.0.0.1:1, so the failed-transport path was not exercised: ' + String(text).slice(0, 40));
});

// Regression test: shapeTransportError's cause chain fell back to err.message when
// stderr was empty, and Node's child_process message carries the whole argv -- which is
// where curlBuffer puts the Authorization header. A silent-curl shim plus a dead proxy
// put "curl -sSL ... -H Authorization: Bearer <token>" into the notice, stdout and
// .pool.json, contradicting README's claim that the token never reaches a notice or an
// artifact. The literal is assembled from fragments so this file never carries one.
test('shapeTransportError never falls back to a message that embeds the request arguments', () => {
  const sentinel = 'ghp_' + 'fakefakefakefake';
  const failure = {
    status: 7,
    signal: null,
    stdout: Buffer.from('\n000'),
    stderr: Buffer.from(''),
    message: 'Command failed: curl -sSL -H "Authorization: Bearer ' + sentinel + '" https://api.github.com/repos/x/y/releases',
  };
  const shaped = shapeTransportError(failure, 'https://api.github.com/repos/x/y/releases', 200);
  assert.doesNotMatch(shaped.message, /Authorization/i, 'the header name must not reach the notice');
  assert.doesNotMatch(shaped.message, /Bearer/i, 'the scheme must not reach the notice');
  assert.doesNotMatch(shaped.message, /ghp_/, 'the token shape must not reach the notice');
  assert.equal(shaped.message.includes(sentinel), false, 'the token value must not reach the notice');
  assert.match(shaped.message, /^request failed for https:\/\/api\.github\.com\/repos\/x\/y\/releases: /);
  assert.equal(shaped.exitStatus, 7, "curl's process exit code is still reported");
});

test('shapeTransportError never quotes the cause line curl wrote', () => {
  const failure = {
    status: 7,
    stdout: Buffer.from('\n000'),
    stderr: Buffer.from('curl: (7) Failed to connect to 127.0.0.1 port 1\n'),
    message: 'Command failed: curl -sSL -H "Authorization: Bearer ' + 'ghp_' + 'x'.repeat(24) + '" http://x/',
  };
  const shaped = shapeTransportError(failure, 'http://x/', 200);
  assert.equal(shaped.message, 'request failed for http://x/: failed to connect (curl exit 7)');
  assert.doesNotMatch(shaped.message, /curl: \(7\)|Failed to connect to 127\.0\.0\.1/,
    "curl's own line reached the notice: " + shaped.message);
  assert.doesNotMatch(shaped.message, /Authorization|Bearer|ghp_/, 'the argv fallback stays out');
});

// Regression test: both shapers interpolated the raw URL, so a credentialised feed target --
// userinfo or a secret query parameter -- was published verbatim in the notice and therefore in
// the digest. The whole query is dropped, the userinfo with it, and the scheme, host and path
// stay: the notice still names the request it reports.
test('shapeHttpError redacts the userinfo and the whole query, keeping host and path', () => {
  const shaped = shapeHttpError(500, Buffer.from('boom'), 'https://u:p4ssw0rd@h.example/x?token=SECRETVAL', 200);
  assert.equal(shaped.message.includes('p4ssw0rd'), false, 'the password must not reach the notice');
  assert.equal(shaped.message.includes('SECRETVAL'), false, 'the query value must not reach the notice');
  assert.equal(shaped.message.includes('boom'), false, 'the upstream body must not reach the notice');
  assert.doesNotMatch(shaped.message, /u:p4ssw0rd@/, 'userinfo must not reach the notice');
  assert.doesNotMatch(shaped.message, /\?/, 'the whole query string is dropped');
  assert.match(shaped.message, /^HTTP 500 for https:\/\/h\.example\/x\/?$/, 'the host and path survive');
});

test('shapeTransportError redacts userinfo and the query string it quotes', () => {
  const failure = { status: 7, stdout: Buffer.from('\n000'), stderr: Buffer.from('curl: (7) refused\n') };
  const shaped = shapeTransportError(failure, 'https://u:p4ssw0rd@h.example/x?token=SECRETVAL', 200);
  assert.equal(shaped.message.includes('p4ssw0rd'), false, 'the password must not reach the notice');
  assert.equal(shaped.message.includes('SECRETVAL'), false, 'the query value must not reach the notice');
  assert.equal(shaped.message, 'request failed for https://h.example/x: failed to connect (curl exit 7)');
});

// Regression test: the suite required the host curl binary while README promises a
// standard-library-only skill, and a curl failure whose stderr was empty degraded into
// the generic "request failed ... unknown curl failure": an operator could not tell a
// missing dependency from an unreachable feed. A failing curl on PATH exercises the
// transport the collector really uses (a PATH holding only node still resolves curl
// through the host's exec path search, so the absence has to be simulated).
test('a curl failure with no stderr names the binary instead of "unknown curl failure"', () => {
  const d = mkdtempSync(join(tmpdir(), 'tech-radar-nocurl-'));
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const bin = join(d, 'bin');
  const cfg = join(d, 'config');
  mkdirSync(bin, { recursive: true });
  mkdirSync(cfg, { recursive: true });
  for (const name of ['domains.md', 'settings.md', 'sources.md']) {
    copyFileSync(join(repo, 'config', name), join(cfg, name));
  }
  writeFileSync(join(cfg, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | https://blog.example/feed.xml | ai-llm | a row that must reach the transport |',
    '',
  ].join('\n'));
  // The shim is the failure mode: nonzero exit, nothing on stderr.
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 127\n');
  chmodSync(join(bin, 'curl'), 0o755);
  const res = spawnSync(process.execPath, [
    join(repo, 'scripts', 'collect.mjs'), '--config', cfg, '--out', join(d, '.pool.json'), '--timeout', '2000',
  ], { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
  const pool = JSON.parse(res.stdout);
  assert.equal(pool.candidates.length, 0, 'no candidate came back');
  assert.equal(pool.notices.length, 1, 'the row produced one notice, not a silent skip');
  assert.match(pool.notices[0], /curl exited with status 127/, 'the notice names the binary and its exit status');
  assert.doesNotMatch(pool.notices[0], /unknown curl failure/, 'the uninformative fallback is gone');
  assert.match(res.stderr, /curl exited with status 127/, 'the operator line carries it too');
  rmSync(d, { recursive: true, force: true });
});

// Regression test: the redaction was a list of exact spellings, anchored at both ends and
// blind to a hyphen, so a watchlist target carrying api-key, auth_token, access-token,
// client_secret, pwd, private_token, X-Amz-Signature, AWSAccessKeyId, session or code
// published the value verbatim in every notice and in every candidate's source. The query
// string and the userinfo are dropped whole; scheme, host and path survive so a notice
// still names the request it reports.
test('redactUrl drops the whole query string and the userinfo for every credential spelling', () => {
  const spellings = ['api-key', 'auth_token', 'access-token', 'client_secret', 'pwd',
    'private_token', 'X-Amz-Signature', 'AWSAccessKeyId', 'session', 'code'];
  for (const name of spellings) {
    const secret = 'SENTINEL-' + name + '-VALUE';
    const red = redactUrl('https://user:p4ssw0rd@feeds.example/atom.xml?' + name + '=' + secret + '&per_page=10');
    assert.equal(red.includes(secret), false, name + ' leaked: ' + red);
    assert.equal(red.includes('p4ssw0rd'), false, 'the userinfo password leaked: ' + red);
    assert.equal(red.includes('SENTINEL'), false, 'no query value may survive: ' + red);
    assert.match(red, /^https:\/\/feeds\.example\/atom\.xml$/, 'scheme, host and path survive: ' + red);
  }
  // A target the parser refuses is still cut by hand.
  assert.equal(redactUrl('//u:p4ssw0rd@h.example/x?token=v').includes('p4ssw0rd'), false);
});

// TR-85 regression test: the secret set was built from the decoded query value only, so a
// server that echoed the request's own percent-encoded spelling - the form curl actually put on
// the request line, and the common server-log spelling - republished the credential in a
// trivially decodable form. Every spelling the request could have sent is removed. The notice no
// longer quotes an answer at all, so the scrubber is driven at its own seam as well as through
// the shaped notice, which must carry the redacted request and nothing else.
test('a request credential is scrubbed in its raw, encoded and decoded spellings', () => {
  const secret = 'oper' + '+OPERATORSECRET42';
  const url = 'https://feed.example/x?token=' + secret;
  const secrets = requestSecrets(url, {});
  const bodies = [
    'token=' + secret,
    'token=' + encodeURIComponent(secret),
    'token=oper%2BOPERATORSECRET42',
  ];
  for (const body of bodies) {
    const scrubbed = redactSecrets(body, secrets);
    assert.equal(scrubbed.includes(secret), false, 'the raw spelling survived: ' + scrubbed);
    assert.equal(scrubbed.includes('oper%2BOPERATORSECRET42'), false,
      'the encoded spelling survived: ' + scrubbed);
    const shaped = shapeHttpError(500, Buffer.from(body), url, 400);
    assert.equal(shaped.message.includes(body), false, 'the answer reached the notice: ' + shaped.message);
  }
  // URLSearchParams decodes '+' as a space, so the spelling a server logs after decoding it and
  // the encoded form of that decoded value are both spellings of the request's own value.
  const spaced = 'https://feed.example/x?token=oper+plus';
  const spacedSecrets = requestSecrets(spaced, {});
  for (const body of ['token=oper+plus', 'token=oper%20plus', 'token=oper plus']) {
    const scrubbed = redactSecrets(body, spacedSecrets);
    assert.equal(/oper[+% ]?plus/.test(scrubbed), false,
      'a spelling of the request value survived: ' + scrubbed);
  }
  // TR-102: a server that echoes the value with a whitespace control inside it - a reflowed log
  // line, a body that wraps the token - defeats an exact match, because the collector normalises
  // the control to a space before the notice is published. A value at or above the floor is also
  // matched with optional whitespace between its characters, so neither half is readable.
  const splitSecrets = requestSecrets('https://feed.example/x?token=' + secret, {});
  for (const body of ['token=oper+ OPERATORSECRET42', 'token=oper +OPERATORSECRET42',
    'token=o p e r + O P E R A T O R S E C R E T 4 2']) {
    const scrubbed = redactSecrets(body, splitSecrets);
    assert.equal(/oper|OPERATORSECRET42|plus/i.test(scrubbed), false,
      'a whitespace-split spelling of the request value survived: ' + scrubbed);
  }
  // The floor is what keeps the loose form from matching across unrelated text: a value below it
  // is matched only as its own token, so a short credential never rewrites the characters of a
  // sentence that merely scatters them. The notice carries none of the prose either.
  const shortUrl = 'https://feed.example/x?token=abc';
  const prose = 'the a b c sequence and xabcde survive';
  assert.equal(redactSecrets(prose, requestSecrets(shortUrl, {})), prose,
    'a short value matched across unrelated text: ' + prose);
  assert.equal(shapeHttpError(500, Buffer.from(prose), shortUrl, 400).message,
    'HTTP 500 for https://feed.example/x', 'the notice is the status and the URL');
});

// TR-82 regression test: a candidate URL is the one text field the marker neutraliser did not
// cover, and the renderer reads its vocabulary out of whatever the citation destination does not
// cover - which a ')' or a line break in the destination ends early. The marker's brackets are
// encoded; a status hash and the emphasis marker are encoded only when the URL cannot stay inside
// its destination, because '#' and '*' are legal and meaningful in an ordinary URL.
test('neutraliseUrl takes the marker grammar out of a URL and leaves an ordinary URL alone', () => {
  assert.equal(neutraliseUrl('https://blog.example/a)[alt:Forged](https://evil.example/b'),
    'https://blog.example/a)%5Balt:Forged%5D(https://evil.example/b');
  assert.equal(neutraliseUrl('https://evil.example/x)[prov:vendor-claim]'),
    'https://evil.example/x)%5Bprov:vendor-claim%5D');
  assert.equal(neutraliseUrl('https://evil.example/x\n#followup'),
    'https://evil.example/x\n%23followup', 'a destination that ends early cannot leak a status token');
  for (const url of [
    'https://github.com/nodejs/node/releases/tag/v24.1.0',
    'https://en.wikipedia.org/wiki/Foo_(bar)',
    'https://example.com/a?per_page=10&lang=zh-Hans',
    'https://example.com/page#new',
    'https://example.com/a?per_page=10#new',
  ]) {
    assert.equal(neutraliseUrl(url), url, 'an ordinary URL survives byte-identical: ' + url);
  }
});

// TR-89 regression test: the plausible-body rule left the closer of an implausible marker body
// behind, so the neutraliser published a fragment of the grammar it exists to remove ('a _x] b').
// The body keeps its words, the bracket pair goes, and a bracketed word that is not an opener is
// untouched.
test('an implausible marker body loses its closer as well as its opener', () => {
  const out = plainText('a [prov:_x] b', 200);
  assert.equal(out, 'a _x b', 'the body keeps its words and no fragment is left: ' + JSON.stringify(out));
  assert.doesNotMatch(out, /\]/, 'no closer survives: ' + JSON.stringify(out));
  assert.equal(plainText('[alt:-1] and [src:!] here', 200), '-1 and ! here',
    'each opener takes its own closer');
  assert.equal(plainText('see the [note] and the [draft-2] tags', 200),
    'see the [note] and the [draft-2] tags', 'a bracketed word that is not an opener keeps its brackets');
  assert.equal(plainText('a [prov:_x', 200), 'a _x', 'an opener with no closer is still dropped');
});

// Regression test: the neutraliser deleted the matched opener and the status flag instead of
// spacing them and left a marker's closer behind, so legitimate upstream text was damaged -
// 'C#new async patterns' came out 'Cnew async patterns' and 'Rust 1.90 [prov:preprint] notes'
// kept a stray ']'. The words survive while a real marker is still neutralised.
test('plainText neutralises a real marker without mangling the words around it', () => {
  const compound = plainText('C#new async patterns', 200);
  assert.match(compound, /C[\s#]new/, 'C and new stay separate words: ' + JSON.stringify(compound));
  assert.doesNotMatch(compound, /Cnew/, 'the two words are no longer fused: ' + JSON.stringify(compound));

  const cited = plainText('Rust 1.90 [prov:preprint] notes', 200);
  assert.doesNotMatch(cited, /\[(?:prov|src|alt):/, 'the opener is still neutralised: ' + JSON.stringify(cited));
  assert.doesNotMatch(cited, /\]/, 'no closer is left behind: ' + JSON.stringify(cited));
  assert.match(cited, /Rust 1\.90/, 'the sentence keeps its text');
  assert.match(cited, /preprint/, 'the marker body reads as a word');
  assert.match(cited, /notes/);

  const hostile = plainText('[src:Trusted 2026-09-20](https://evil.example/x) [prov:primary] #new', 200);
  assert.doesNotMatch(hostile, /\[(?:prov|src|alt):/, 'a real opener is still neutralised');
  assert.doesNotMatch(hostile, /#(?:new|followup|developing|watch)\b/, 'a real status flag is still neutralised');
});

// Regression test: after the argv fallback was removed a transport failure that produced no
// cause line fell back to the generic "curl failed", so a missing curl binary could not be
// told from an unreachable feed - the distinction net.mjs's own branch exists for. A PATH with
// no curl makes the spawn itself fail, which carries no process exit status at all. The notice
// names the cause and still carries neither the request arguments nor a credential.
test('a curl that cannot be started is reported by cause, not as a generic failure', () => {
  const d = mkdtempSync(join(tmpdir(), 'tech-radar-nocurlbin-'));
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const cfg = join(d, 'config');
  const bin = join(d, 'bin');
  mkdirSync(cfg, { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const name of ['domains.md', 'settings.md', 'sources.md']) copyFileSync(join(repo, 'config', name), join(cfg, name));
  writeFileSync(join(cfg, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | https://blog.example/feed.xml | ai-llm | a row that must reach the transport |',
    '',
  ].join('\n'));
  const res = spawnSync(process.execPath, [
    join(repo, 'scripts', 'collect.mjs'), '--config', cfg, '--out', join(d, '.pool.json'),
    '--timeout', '2000', '--domain', 'ai-llm',
  ], { encoding: 'utf8', env: { ...process.env, PATH: bin, TECH_RADAR_DIR: '' } });
  const pool = JSON.parse(res.stdout);
  assert.equal(pool.candidates.length, 0, 'no candidate came back');
  assert.equal(pool.notices.length, 1, 'the row produced one notice, not a silent skip');
  const notice = pool.notices[0];
  assert.match(notice, /ENOENT|could not be started|cannot be started/i, 'the cause is named: ' + notice);
  assert.doesNotMatch(notice, /: curl failed$/, 'the uninformative fallback is gone: ' + notice);
  assert.doesNotMatch(notice, /-sSL|Command failed|execFileSync|spawnSync/, 'no request arguments reach the notice: ' + notice);
  assert.doesNotMatch(notice, /Authorization|Bearer|ghp_/, 'no credential reaches the notice: ' + notice);
  assert.match(res.stderr, /ENOENT|could not be started|cannot be started/i, 'the operator line carries the cause too');
  rmSync(d, { recursive: true, force: true });
});

// Regression test: an upstream that echoes the request in its error page - "auth=Basic
// <base64 of user:password>" and the query token again in the body - once put the operator's
// feed credential in the pool, on stdout and in the published digest, and the fix scrubbed the
// copied snippet. The notice now quotes no answer text, so no spelling of the credential can
// reach it, and the scrubber still removes the echo at its own seam as defence in depth. The
// literals below are assembled from fragments so this file never carries a credential-shaped
// string.
test('shapeHttpError carries none of the body a server echoes the credential back in', () => {
  const user = 'feed' + 'user';
  const password = 's3cret' + '-PASSVALUE';
  const token = 'echo' + '-TOKENVALUE1234';
  const url = 'http://' + user + ':' + password + '@feed.example/echo?token=' + token;
  const basic = Buffer.from(user + ':' + password).toString('base64');
  assert.equal(Buffer.from(basic, 'base64').toString(), user + ':' + password,
    'the fixture really encodes the request credential');
  const body = 'denied: echo token=' + token + ' auth=Basic ' + basic;
  const shaped = shapeHttpError(500, Buffer.from(body), url, 200);
  assert.equal(shaped.message, 'HTTP 500 for http://feed.example/echo',
    'the notice names the status and the redacted request only: ' + shaped.message);
  assert.equal(shaped.message.includes(token), false, 'the echoed token must not survive: ' + shaped.message);
  assert.equal(shaped.message.includes(basic), false, 'the Basic value must not survive: ' + shaped.message);
  assert.equal(shaped.message.includes(password), false, 'the password must not survive: ' + shaped.message);
  assert.equal(shaped.message.includes('denied:'), false, 'no fragment of the answer reaches the notice: ' + shaped.message);
  // The scrubber still removes the echo, so the guarantee does not rest on the notice rewrite.
  const scrubbed = redactSecrets(body, requestSecrets(url, {}));
  for (const value of [token, basic, password]) {
    assert.equal(scrubbed.includes(value), false,
      'the echo survived the scrubber: ' + value + ' in ' + scrubbed);
  }
});

// Regression test: the value redaction removed every query value of three characters or more and
// every whitespace-separated part of a credential-named header, with no word boundary and no
// credential-shaped test, so a notice whose own wording happened to carry one read "the
// [redacted] feed could not be parsed". The floor is what keeps a notice's own wording and the
// scheme word that merely names the credential, while a credential-named value and the userinfo
// are still removed whatever their length. The shaped notice quotes no answer text now, so the
// floor is pinned at the scrubber -- which also cleans the transport cause and the candidate
// pass -- and the composed notice is pinned to the redacted request.
test('the scrubber keeps a notice wording while the request credential is still removed', () => {
  const secret = 'echo' + '-TOKENVALUE1234';
  const headers = { Authorization: 'Bearer ' + secret };
  const wording = 'the atom feed expects the token as Bearer; no query value is accepted';
  const benign = redactSecrets(wording, requestSecrets('https://feeds.example/rss?format=full', headers));
  assert.match(benign, /the atom feed expects/, "a notice's own wording stays: " + benign);
  assert.match(benign, /as Bearer;/, 'the scheme word stays: ' + benign);
  assert.doesNotMatch(benign, /\[redacted\]/, 'a benign wording is not redacted: ' + benign);
  // 'format' is not a credential-shaped name, so its value keeps the floor: 'atom' is four
  // characters and is not collected, and the notice's own word survives even though the request
  // carried that same spelling in its URL.
  const shortName = redactSecrets(wording, requestSecrets('https://feeds.example/rss?format=atom', headers));
  assert.match(shortName, /the atom feed expects/,
    'a short non-credential query value does not reap the notice wording: ' + shortName);
  assert.doesNotMatch(shortName, /\[redacted\]/,
    'and nothing else in that notice is reaped either: ' + shortName);
  // The other half of the decision: a credential-named query token is a credential position
  // whatever it spells, so a seven-character one goes, and the two-character userinfo password
  // with it, while a harmless word of free text stays readable.
  const token = 'ABC1234';
  const upstream = 'upstream said: token=' + token + ' and the password pw was rejected; '
    + 'the atom feed is otherwise fine';
  const credentialName = redactSecrets(upstream,
    requestSecrets('https://feeduser:pw@feeds.example/rss?token=' + token, {}));
  assert.equal(credentialName.includes(token), false,
    'a short credential-named token is still removed: ' + credentialName);
  assert.doesNotMatch(credentialName, /(^|[^A-Za-z])pw([^A-Za-z]|$)/,
    'a short userinfo password is still removed: ' + credentialName);
  assert.match(credentialName, /the atom feed is otherwise fine/,
    'a harmless word that is not the request value stays: ' + credentialName);
  // The composed notice with that same answer carries the status and the redacted URL only.
  const shaped = shapeHttpError(500, Buffer.from(upstream),
    'https://feeduser:pw@feeds.example/rss?token=' + token, 200);
  assert.equal(shaped.message, 'HTTP 500 for https://feeds.example/rss',
    'the notice is the status and the redacted URL: ' + shaped.message);
  assert.equal(shaped.message.includes('otherwise fine'), false, 'the answer text reached the notice');
  const echoed = shapeHttpError(500,
    Buffer.from('denied: token=' + secret + ' for the atom feed'),
    'https://feeds.example/rss?format=atom', 200, headers);
  assert.equal(echoed.message.includes(secret), false,
    'the request credential is still removed: ' + echoed.message);
});

// TR-91 regression test: the neutraliser replaced the hash of any text that spelled a status
// word, so a legitimate upstream spelling lost its characters -- 'C#new async patterns' was
// published as 'C new async patterns'. A status flag is a token: it stands at the start of the
// text or follows whitespace. Every other spelling keeps its characters.
test('the neutraliser keeps a status-shaped hash that is not a standalone token', () => {
  const spellings = [
    'C#new async patterns',
    'F# watch mode',
    '#newrelease',
    'C#followup notes',
    'C#developing',
    'C#watch',
  ];
  for (const text of spellings) {
    assert.equal(neutraliseMarkers(text), text,
      'the neutraliser must keep the characters of a non-token spelling: ' + JSON.stringify(text));
    assert.equal(plainText(text, 200), text,
      'and the published text must carry it unchanged: ' + JSON.stringify(text));
  }
});

// The other half of TR-91: the boundary must not let a real flag through. A standalone flag is
// still neutralised wherever it is a token, the start of the text included, so upstream text
// cannot draw a status tag on a published card.
test('the neutraliser still rewrites a standalone status flag at a token boundary', () => {
  for (const flag of ['new', 'followup', 'developing', 'watch']) {
    assert.equal(plainText('shipped #' + flag + ' today', 200), 'shipped ' + flag + ' today',
      'a mid-sentence #' + flag + ' is still neutralised');
    assert.equal(plainText('#' + flag + ' leads the text', 200), flag + ' leads the text',
      'a #' + flag + ' at the start of the text is still neutralised');
    assert.equal(plainText('the last token is #' + flag, 200), 'the last token is ' + flag,
      'a trailing #' + flag + ' is still neutralised');
    assert.doesNotMatch(neutraliseMarkers('a #' + flag + ' b'), new RegExp('#' + flag + '\\b'),
      'the neutraliser leaves no status flag behind: #' + flag);
  }
  const hostile = plainText('[src:Trusted 2026-09-20](https://evil.example/x) [prov:primary] #new', 200);
  assert.doesNotMatch(hostile, /#(?:new|followup|developing|watch)\b/,
    'a real flag in an upstream body is still neutralised: ' + JSON.stringify(hostile));
});

// TR-94 regression test: every value collected from the request passed one length floor, so a
// short credential the request itself sent - a seven-character query token, a two-character
// userinfo password - was never collected and reached the notice, the pool and the Coverage note
// verbatim. A value the request sends in its userinfo or its query is not an ordinary word that
// happens to look like a credential: it is removed whatever its length. The floor still keeps a
// short word in free text that is not the request's own value, and the notice now quotes no answer
// text for any of it to hide in.
test('a short credential the request sent is still scrubbed while the notice quotes no answer', () => {
  const password = 'pw';
  const token = 'ABC1234';
  const url = 'https://feeduser:' + password + '@feeds.example/echo?token=' + token;
  const body = 'upstream said: token=' + token + ' and the password ' + password
    + ' was rejected; the atom feed is otherwise fine';
  const scrubbed = redactSecrets(body, requestSecrets(url, {}));
  assert.equal(scrubbed.includes(token), false,
    'the short query token must not survive: ' + scrubbed);
  assert.doesNotMatch(scrubbed, /(^|[^A-Za-z])pw([^A-Za-z]|$)/,
    'the userinfo password must not survive: ' + scrubbed);
  assert.match(scrubbed, /the atom feed is otherwise fine/,
    "a harmless short word that is not the request's own value stays: " + scrubbed);
  const shaped = shapeHttpError(500, Buffer.from(body), url, 400);
  assert.equal(shaped.message, 'HTTP 500 for https://feeds.example/echo',
    'the notice still names the request it reports: ' + shaped.message);
  assert.equal(shaped.message.includes('upstream said'), false, 'the answer text reached the notice');
});

// TR-109 regression test: the batch-8 parameter test required the credential stem to begin
// where a word begins, so every fused spelling (apikey, apiKey, accesstoken, refreshtoken,
// clientsecret, privatekey, subscriptionkey, bearer, jwt) matched nothing, and the value under
// it was collected by neither rule because it also failed the length floor. The name is
// lower-cased and stripped of every non-alphanumeric before the stem test, and the stem is
// tested on that form, so a fused spelling is the same parameter as its hyphenated one. The
// collection and the scrub are pinned at their seam, and the composed notice is the redacted
// request.
test('a fused credential parameter name protects its value at the scrubber and in the notice', () => {
  const fused = [
    ['apikey', '1234'],
    ['apiKey', '9911'],
    ['accesstoken', 'ABC12'],
    ['bearer', 'abc'],
    ['clientsecret', 'pw22'],
    ['subscriptionkey', '4321'],
    ['privatekey', 'pk9'],
    ['refreshtoken', 'rt1'],
  ];
  for (const [name, value] of fused) {
    const url = 'https://feeds.example/rss.xml?' + name + '=' + value;
    const secrets = requestSecrets(url, {});
    assert.equal(secrets.includes(value), true,
      'the fused spelling ' + name + ' is not a credential position: ' + JSON.stringify(secrets));
    const scrubbed = redactSecrets('upstream rejected /rss.xml?' + name + '=' + value, secrets);
    assert.equal(scrubbed.includes(value), false,
      'the fused spelling ' + name + ' leaked its value: ' + scrubbed);
    const shaped = shapeHttpError(500,
      Buffer.from('upstream rejected /rss.xml?' + name + '=' + value), url, 200);
    assert.equal(shaped.message.includes(value), false,
      'the fused spelling ' + name + ' leaked its value into the notice: ' + shaped.message);
    assert.equal(shaped.message.includes('upstream rejected'), false,
      'the answer text reached the notice: ' + shaped.message);
  }
  // The hyphenated, underscored, mixed-case and prefixed spellings keep matching too.
  for (const name of ['api_key', 'private-key', 'X-Amz-Signature', 'AWSAccessKeyId']) {
    const value = 'SENTINELVALUE42';
    const url = 'https://feeds.example/rss.xml?' + name + '=' + value;
    const secrets = requestSecrets(url, {});
    assert.equal(secrets.includes(value), true, name + ' is not a credential position');
    const scrubbed = redactSecrets('echo ' + value, secrets);
    assert.equal(scrubbed.includes(value), false, name + ' leaked its value: ' + scrubbed);
    const shaped = shapeHttpError(500, Buffer.from('echo ' + value), url, 200);
    assert.equal(shaped.message.includes(value), false,
      name + ' leaked its value into the notice: ' + shaped.message);
  }
});

// TR-110 regression test: a query value was collected whenever it cleared the length floor, so
// the collector's own arXiv request (search_query=cat:cs.AI, sortBy=submittedDate,
// sortOrder=descending, max_results=40) put ordinary words into the run-wide union, which was
// then applied to the candidate fields and reaped a published word. A query value is collected
// only from a credential-named parameter; no other query value is collected at all.
test('an ordinary query parameter value is not collected, however long it is', () => {
  const url = 'https://export.arxiv.org/api/query?search_query=cat%3Acs.AI'
    + '&sortBy=submittedDate&sortOrder=descending&max_results=40';
  const secrets = requestSecrets(url, {});
  assert.deepEqual(secrets, [], 'an ordinary request contributes no value: ' + JSON.stringify(secrets));
  const text = 'We sort the results in descending order and report the outcome.';
  assert.equal(redactSecrets(text, secrets), text,
    'a published word is not reaped: ' + redactSecrets(text, secrets));
});

// TR-111 regression test: a credential-named parameter whose value is an ordinary short word
// reaped that word from every published field, so a notice reading 'Python on Windows' became
// 'Python [redacted] Windows'. A credential-named value is collected from three characters up;
// the userinfo stays a credential position whatever its length. The notice quotes no answer text
// now, so the floor is pinned at the scrubber and the composed notice is the redacted request.
test('a credential-named value below three characters is not collected', () => {
  assert.deepEqual(requestSecrets('https://feeds.example/rss.xml?code=on', {}), [],
    'a two-character credential-named value is not collected');
  const wording = 'Python on Windows is supported';
  assert.equal(redactSecrets(wording, requestSecrets('https://feeds.example/rss.xml?code=on', {})), wording,
    'the scrubbed wording keeps every word');
  const shaped = shapeHttpError(500, Buffer.from(wording),
    'https://feeds.example/rss.xml?code=on', 200);
  assert.equal(shaped.message, 'HTTP 500 for https://feeds.example/rss.xml',
    'the notice is the status and the redacted request: ' + shaped.message);
  assert.equal(shaped.message.includes(wording), false, 'the answer text reached the notice');
  // Three characters is the floor the other side of the same boundary.
  assert.equal(requestSecrets('https://feeds.example/rss.xml?code=new', {}).includes('new'), true,
    'a three-character credential-named value is collected');
  // The userinfo is a credential position whatever its length.
  assert.equal(requestSecrets('https://u:pw@feeds.example/rss.xml', {}).includes('pw'), true,
    'a two-character userinfo password is still collected');
});

// TR-112 regression test: the markdown link seam was applied by the same neutraliser candidate
// prose uses, so a legitimate upstream Markdown link in a release body was defaced in the pool
// ('[the migration guide] (https://example.com/migrate)'). The seam belongs to the notice push,
// which is the published Coverage note: candidate prose keeps the link it was written with, and
// a notice that reaches the push carrying link syntax -- a thrown transport message, say -- has
// its grammar ended there. The shaped HTTP notice quotes no upstream text, so it cannot carry the
// link at all.
test('a legitimate markdown link survives candidate prose while a notice carries none', () => {
  const link = 'Fixes a crash. See [the migration guide](https://example.com/migrate) and [docs](https://example.com/d).';
  assert.equal(plainText(link, 400), link, 'candidate prose keeps its markdown link byte-identical');
  assert.equal(neutraliseMarkers(link), link, 'the candidate neutraliser leaves the seam alone');
  assert.equal(neutraliseLinkSeams('[the migration guide](https://example.com/migrate)'),
    '[the migration guide] (https://example.com/migrate)',
    'the notice push ends the link grammar while the label and destination stay legible');
  const shaped = shapeHttpError(500, Buffer.from(link), 'https://feeds.example/rss.xml', 400);
  assert.equal(shaped.message, 'HTTP 500 for https://feeds.example/rss.xml',
    'the notice carries no upstream text at all: ' + shaped.message);
  assert.doesNotMatch(shaped.message, /\]\(/, 'the notice carries no live link seam: ' + shaped.message);
});

// TR-134: the cause is a fixed vocabulary read from curl's exit code, so the line curl wrote --
// which follows a redirect and names the environment's proxy -- is never quoted, while the code
// stays named and an unknown one keeps its own spelling.
test('the transport cause is shaped from the exit code, never quoted from the line curl wrote', () => {
  const cases = [
    [6, 'could not resolve the host'],
    [7, 'failed to connect'],
    [18, 'partial transfer'],
    [28, 'timed out'],
    [35, 'TLS handshake failed'],
    [52, 'empty reply'],
  ];
  for (const [code, phrase] of cases) {
    const shaped = shapeTransportError(
      { status: code, stderr: Buffer.from('curl: (' + code + ') NAMED-HOST-' + code + '.invalid: failed') },
      'http://h.example/feed.xml', 200, {});
    assert.equal(shaped.message,
      'request failed for http://h.example/feed.xml: ' + phrase + ' (curl exit ' + code + ')',
      'code ' + code + ' is not read through the vocabulary: ' + shaped.message);
    assert.equal(shaped.message.includes('NAMED-HOST'), false,
      'the line curl wrote reached the notice: ' + shaped.message);
  }
  const novel = shapeTransportError({ status: 99, stderr: Buffer.from('curl: (99) whatever it said') },
    'http://h.example/feed.xml', 200, {});
  assert.match(novel.message, /: curl exited with status 99$/,
    'an uncommon code is still named in full: ' + novel.message);
  assert.equal(novel.message.includes('whatever it said'), false,
    'the line curl wrote reached the notice: ' + novel.message);
});

// TR-135: the URL is the last carrier of a name an answer supplied, and the URL serializer
// respells a dot segment, so a discovered target's shaped error carries no request at all.
test('a discovered target is shaped with no request in it', () => {
  const url = 'https://api.github.com/repos/upstream-name/../../etc/upstream-name/releases';
  const http = shapeHttpError(500, Buffer.from('boom'), url, 200, {}, true);
  assert.equal(http.message, 'HTTP 500', 'the status is the whole notice: ' + http.message);
  assert.equal(http.message.includes('upstream-name'), false, 'the request reached the notice');
  const transport = shapeTransportError({ status: 7, stderr: Buffer.from('curl: (7) refused') },
    url, 200, {}, true);
  assert.equal(transport.message, 'request failed: failed to connect (curl exit 7)',
    'the cause survives without the request: ' + transport.message);
  assert.equal(transport.message.includes('upstream-name'), false, 'the request reached the notice');
});

// TR-136: the shaped transport text is bounded exactly by the value it claims, and the cause
// gives way last -- a bound too small for the request prefix keeps the compact cause instead.
test('the shaped transport text obeys its bound exactly', () => {
  const long = 'x'.repeat(400);
  // 56 is the compact form with the longest fixed cause whole; below it the bound is smaller
  // than the diagnosis itself can be, so only the exactness assertion is asked of 40.
  for (const limit of [40, 56, 61, 62, 200]) {
    const shaped = shapeTransportError(
      { status: 6, stderr: Buffer.from('curl: (6) Could not resolve host: ' + long) },
      'https://h.example/' + long, limit, {});
    assert.ok(shaped.message.length <= limit,
      'the shaped text exceeds its ' + limit + '-character bound (' + shaped.message.length + '): ' + shaped.message);
    if (limit >= 56) {
      assert.match(shaped.message, /curl exit 6/, 'the exit code is lost to the bound: ' + shaped.message);
    }
  }
});

