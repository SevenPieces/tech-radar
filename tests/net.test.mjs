// tests/net.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeBuffer, decodeEntities, field, atomLink, splitItems, neutraliseMarkers, plainText, isDiscoveryOnly, hostOf, shapeHttpError, shapeTransportError, splitCurlOutput, redactUrl, fetchText, neutraliseUrl } from '../scripts/lib/net.mjs';

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
test('plainText drops C0, DEL and C1 controls instead of passing them through', () => {
  const hostile = 'a\u001b[2Kb\u0000c\u0008d\u007f e\u009ff';
  const out = plainText(hostile, 200);
  const offenders = [...out].filter((ch) => {
    const cp = ch.codePointAt(0);
    return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
  });
  assert.deepEqual(offenders, [], 'control code points survived: ' + JSON.stringify(out));
  assert.match(out, /a\[2Kbcd/, 'the printable text around each control is still there');
});

// Regression test: the length bound must survive the character-class rule, so a
// bounded result is bounded either way.
test('plainText still bounds a body that is all control bytes', () => {
  assert.equal(plainText('\u001b'.repeat(500), 10), '');
  assert.ok(plainText('x\u0000'.repeat(300), 10).length <= 10);
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

test('shapeHttpError names the HTTP status and quotes the rate-limit body', () => {
  const url = 'https://api.github.com/repos/nodejs/node/releases?per_page=10';
  const shaped = shapeHttpError(
    403,
    Buffer.from(JSON.stringify({ message: 'API rate limit exceeded for 203.0.113.9.' })),
    url,
    200,
  );
  // The query may or may not survive: the credential-spelling rule requires dropping the
  // whole query string, which moves this pin. Host and path are what must stay.
  assert.match(shaped.message, /^HTTP 403 for https:\/\/api\.github\.com\/repos\/nodejs\/node\/releases(\?per_page=10)?: /);
  assert.match(shaped.message, /API rate limit exceeded/);
  assert.equal(shaped.httpStatus, 403);
  assert.equal(shaped.url, url);
  assert.ok(shaped.body.length <= 200, 'body snippet is bounded');
});

test('shapeHttpError bounds a huge body and keeps the status', () => {
  const shaped = shapeHttpError(429, Buffer.from('x'.repeat(5000)), 'https://example.com/big', 40);
  assert.match(shaped.message, /^HTTP 429 for https:\/\/example\.com\/big: x{40}$/);
  assert.equal(shaped.body.length, 40);
});

test('shapeTransportError reads the real execFileSync failure shape as a transport failure', () => {
  // Exactly the fields execFileSync sets when curl exits non-zero. status is the
  // *process* exit code, and with -w curl still writes a "000" status line to
  // stdout: neither may be reported as an HTTP status, and the cause is the stderr
  // line that the previous shaper discarded.
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
  assert.match(shaped.message, /^request failed for http:\/\/127\.0\.0\.1:1\/feed\.xml: curl: \(7\) Failed to connect/);
  assert.match(shaped.message, /Couldn't connect to server/);
  assert.equal(shaped.exitStatus, 7, "curl's process exit code is labelled as such");
  assert.equal(shaped.body, '', 'the partial body and status line are not surfaced as content');
});

test('the real transport pins a failed loopback fetch to a transport failure, never an HTTP status', async (t) => {
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
      "the message names the URL and carries curl's cause");
    assert.match(err.message, /curl: \(\d+\)/, "curl's own failure code is reported");
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

test('shapeTransportError still quotes curl when it did write a cause line', () => {
  const failure = {
    status: 7,
    stdout: Buffer.from('\n000'),
    stderr: Buffer.from('curl: (7) Failed to connect to 127.0.0.1 port 1\n'),
    message: 'Command failed: curl -sSL -H "Authorization: Bearer ' + 'ghp_' + 'x'.repeat(24) + '" http://x/',
  };
  const shaped = shapeTransportError(failure, 'http://x/', 200);
  assert.match(shaped.message, /^request failed for http:\/\/x\/: curl: \(7\) Failed to connect/);
  assert.doesNotMatch(shaped.message, /Authorization|Bearer|ghp_/, 'the argv fallback stays out');
});

// Regression test: both shapers interpolated the raw URL, so a credentialised feed
// target -- userinfo or a secret query parameter -- was published verbatim in the
// notice and therefore in the digest.
test('shapeHttpError redacts userinfo and the query string it quotes', () => {
  const shaped = shapeHttpError(500, Buffer.from('boom'), 'https://u:p4ssw0rd@h.example/x?token=SECRETVAL', 200);
  assert.equal(shaped.message.includes('p4ssw0rd'), false, 'the password must not reach the notice');
  assert.equal(shaped.message.includes('SECRETVAL'), false, 'the query value must not reach the notice');
  assert.doesNotMatch(shaped.message, /u:p4ssw0rd@/, 'userinfo must not reach the notice');
  assert.match(shaped.message, /^HTTP 500 for https:\/\/h\.example\/x\/?: boom$/, 'the host and path survive');
});

test('shapeTransportError redacts userinfo and the query string it quotes', () => {
  const failure = { status: 7, stdout: Buffer.from('\n000'), stderr: Buffer.from('curl: (7) refused\n') };
  const shaped = shapeTransportError(failure, 'https://u:p4ssw0rd@h.example/x?token=SECRETVAL', 200);
  assert.equal(shaped.message.includes('p4ssw0rd'), false, 'the password must not reach the notice');
  assert.equal(shaped.message.includes('SECRETVAL'), false, 'the query value must not reach the notice');
  assert.match(shaped.message, /^request failed for https:\/\/h\.example\/x\/?: curl: \(7\) refused$/);
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
// trivially decodable form. Every spelling the request could have sent is removed.
test('a request credential is removed in its raw, encoded and decoded spellings', () => {
  const secret = 'oper' + '+OPERATORSECRET42';
  const url = 'https://feed.example/x?token=' + secret;
  const bodies = [
    'token=' + secret,
    'token=' + encodeURIComponent(secret),
    'token=oper%2BOPERATORSECRET42',
  ];
  for (const body of bodies) {
    const shaped = shapeHttpError(500, Buffer.from(body), url, 400);
    assert.equal(shaped.message.includes(secret), false, 'the raw spelling survived: ' + shaped.message);
    assert.equal(shaped.message.includes('oper%2BOPERATORSECRET42'), false,
      'the encoded spelling survived: ' + shaped.message);
  }
  // URLSearchParams decodes '+' as a space, so the spelling a server logs after decoding it and
  // the encoded form of that decoded value are both spellings of the request's own value.
  const spaced = 'https://feed.example/x?token=oper+plus';
  for (const body of ['token=oper+plus', 'token=oper%20plus', 'token=oper plus']) {
    const shaped = shapeHttpError(500, Buffer.from(body), spaced, 400);
    assert.equal(/oper[+% ]?plus/.test(shaped.message), false,
      'a spelling of the request value survived: ' + shaped.message);
  }
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

// Regression test: redactUrl cleaned the request the notice prints, but the notice also
// quotes a bounded snippet of the server's own body, and the redactor that shaped it knew
// only Bearer, authorization:-prefixed, gh*_ and github_pat_ shapes. An upstream that
// echoes the request in its error page - "auth=Basic <base64 of user:password>" and the
// query token again in the body - put the operator's feed credential in the pool, on
// stdout and in the published digest. The request's own values must be removed from the
// snippet it echoes, and the Basic shape must be recognised. The literals below are
// assembled from fragments so this file never carries a credential-shaped string.
test('shapeHttpError removes the request credential a server body echoes back', () => {
  const user = 'feed' + 'user';
  const password = 's3cret' + '-PASSVALUE';
  const token = 'echo' + '-TOKENVALUE1234';
  const url = 'http://' + user + ':' + password + '@feed.example/echo?token=' + token;
  const basic = Buffer.from(user + ':' + password).toString('base64');
  assert.equal(Buffer.from(basic, 'base64').toString(), user + ':' + password,
    'the fixture really encodes the request credential');
  const body = 'denied: echo token=' + token + ' auth=Basic ' + basic;
  const shaped = shapeHttpError(500, Buffer.from(body), url, 200);
  assert.match(shaped.message, /^HTTP 500 for http:\/\/feed\.example\/echo: /,
    'the notice still names the request it reports');
  assert.equal(shaped.message.includes(token), false, 'the echoed token must not survive: ' + shaped.message);
  assert.equal(shaped.message.includes(basic), false, 'the Basic value must not survive: ' + shaped.message);
  assert.equal(shaped.message.includes(password), false, 'the password must not survive: ' + shaped.message);
});

// TR-85 regression test: the value redaction removed every query value of three characters or
// more and every whitespace-separated part of a credential-named header, with no word boundary
// and no credential-shaped test. A notice whose own wording happened to carry either therefore
// read "the [redacted] feed could not be parsed", and the notice is the run's only diagnosis of
// a degraded source. The benign words stay; the request's own credential still goes.
test('a notice keeps its own wording while the request credential is still removed', () => {
  const secret = 'echo' + '-TOKENVALUE1234';
  const benign = shapeHttpError(500,
    Buffer.from('the atom feed expects the token as Bearer; no query value is accepted'),
    'https://feeds.example/rss?format=atom', 200, { Authorization: 'Bearer ' + secret });
  assert.match(benign.message, /the atom feed expects/, 'a benign query value stays: ' + benign.message);
  assert.match(benign.message, /as Bearer;/, 'the scheme word stays: ' + benign.message);
  assert.doesNotMatch(benign.message, /\[redacted\]/, 'a benign wording is not redacted: ' + benign.message);
  const echoed = shapeHttpError(500,
    Buffer.from('denied: token=' + secret + ' for the atom feed'),
    'https://feeds.example/rss?format=atom', 200, { Authorization: 'Bearer ' + secret });
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

