// tests/net.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBuffer, decodeEntities, field, atomLink, splitItems, plainText, isDiscoveryOnly, hostOf, shapeHttpError, shapeTransportError, splitCurlOutput, fetchText } from '../scripts/lib/net.mjs';

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
  assert.match(shaped.message, /^HTTP 403 for https:\/\/api\.github\.com\/repos\/nodejs\/node\/releases\?per_page=10: /);
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
