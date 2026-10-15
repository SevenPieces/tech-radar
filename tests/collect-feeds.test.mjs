// tests/collect-feeds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFeeds, main } from '../scripts/collect.mjs';
import { plainText, shapeHttpError } from '../scripts/lib/net.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SKILL_CONFIG = join(REPO, 'config');

const rows = [{ kind: 'rss', target: 'https://blog.example/feed.xml', domain: 'languages-runtimes', note: '' }];
const ctx = {
  since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
  settings: { user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400, error_snippet_max_chars: 200 },
  net: {
    fetchText: async () => [
      '<rss><channel>',
      '<item><title>Rust 1.99 released</title><link>https://blog.example/rust-199</link>',
      '<pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>',
      '<description><![CDATA[<p>Compiler and <b>stdlib</b> changes.</p>]]></description></item>',
      '</channel></rss>',
    ].join(''),
  },
};

test('collectFeeds maps an RSS item to a candidate with a plain summary', async () => {
  const { candidates, notices } = await collectFeeds(rows, ctx);
  assert.deepEqual(notices, []);
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  assert.equal(c.domain, 'languages-runtimes');
  assert.equal(c.kind, 'feed');
  assert.equal(c.title, 'Rust 1.99 released');
  assert.equal(c.url, 'https://blog.example/rust-199');
  assert.equal(c.publishedAt, '2026-09-20T12:00:00.000Z');
  assert.equal(c.tierHint, 'primary');
  assert.equal(c.summary, 'Compiler and stdlib changes.');
});

test('collectFeeds maps an Atom entry through atomLink', async () => {
  const ctxAtom = {
    ...ctx,
    net: {
      fetchText: async () => [
        '<feed><entry><title>Project update</title>',
        '<link rel="alternate" href="https://blog.example/atom-1"/>',
        '<updated>2026-09-21T08:30:00Z</updated>',
        '<summary>A change.</summary></entry></feed>',
      ].join(''),
    },
  };
  const { candidates } = await collectFeeds(rows, ctxAtom);
  assert.equal(candidates[0].url, 'https://blog.example/atom-1');
  assert.equal(candidates[0].publishedAt, '2026-09-21T08:30:00.000Z');
});

test('collectFeeds bounds a title with the configured cap, not a literal', async () => {
  const long = 'Rust ' + 'x'.repeat(300);
  const capped = {
    ...ctx,
    settings: { ...ctx.settings, title_max_chars: 10 },
    net: { fetchText: async () => '<rss><channel><item><title>' + long + '</title>'
      + '<link>https://blog.example/long</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>' },
  };
  const { candidates } = await collectFeeds(rows, capped);
  assert.equal(candidates[0].title.length, 10);
  assert.equal(candidates[0].title, 'Rust xxxxx');
});

test('collectFeeds records an unreachable feed as a notice', async () => {
  const bad = { ...ctx, net: { fetchText: async () => { throw new Error('curl: (7) refused'); } } };
  const { candidates, notices } = await collectFeeds(rows, bad);
  assert.deepEqual(candidates, []);
  assert.match(notices[0], /^rss https:\/\/blog\.example\/feed\.xml: curl: \(7\) refused$/);
});

// F2: with the transport raising on HTTP 4xx/5xx (net.mjs strips curl's -w status
// line and raises the shaped error itself), a
// denied feed must surface as a notice, not as an empty, silent result.
test('collectFeeds turns an HTTP 403 into a notice instead of a silent skip', async () => {
  const denied = {
    ...ctx,
    net: {
      fetchText: async (url) => {
        throw shapeHttpError(403, Buffer.from(JSON.stringify({ message: 'API rate limit exceeded for 203.0.113.9.' })), url, 200);
      },
    },
  };
  const { candidates, notices } = await collectFeeds(rows, denied);
  assert.deepEqual(candidates, []);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^rss https:\/\/blog\.example\/feed\.xml: HTTP 403 for /);
  assert.match(notices[0], /API rate limit exceeded/);
});

// Regression test: collectFeeds handed a configuration-supplied target straight to curl,
// and curl accepts file:// with exit 0 and status 200 — so a watchlist row could carry
// the content of a local file into the published candidate pool. The scheme is refused
// before a fetcher is reached, the run exits 3 (the documented "nothing collected and a
// notice was recorded"), and no candidate is produced.
test('a file:// watchlist row is refused before the fetcher, with exit 3', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-scheme-'));
  const cfg = join(dir, 'config');
  mkdirSync(cfg, { recursive: true });
  for (const name of ['domains.md', 'settings.md', 'sources.md']) {
    copyFileSync(join(SKILL_CONFIG, name), join(cfg, name));
  }
  writeFileSync(join(cfg, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | file:///etc/passwd | ai-llm | a scheme curl accepts |',
    '',
  ].join('\n'));
  const logged = console.log;
  const failed = console.error;
  const loggedLines = [];
  const failedLines = [];
  console.log = (...a) => loggedLines.push(a.join(' '));
  console.error = (...a) => failedLines.push(a.join(' '));
  let code;
  try {
    code = await main(['--config', cfg, '--out', join(dir, '.pool.json'), '--timeout', '2000']);
  } finally {
    console.log = logged;
    console.error = failed;
    process.exitCode = 0;
  }
  assert.equal(code, 3, 'a refused row with no candidates is the documented degraded exit: ' + failedLines.join('\n'));
  const pool = JSON.parse(loggedLines.join('\n'));
  assert.deepEqual(pool.candidates, [], 'nothing from the file is published');
  assert.equal(pool.notices.length, 1, 'the refusal is a notice, not a silent skip');
  assert.match(pool.notices[0], /unsupported scheme/, 'the notice names the unsupported scheme');
  assert.match(pool.notices[0], /file:/, 'the notice names the refused target');
  assert.equal(JSON.stringify(pool).includes('root:'), false, 'no byte of the local file is published');
  rmSync(dir, { recursive: true, force: true });
});

// The same guard in the library entry point, where the injected fetcher is the seam:
// a fetcher that would happily answer is never consulted.
test('collectFeeds refuses a non-http(s) target without consulting its fetcher', async () => {
  let calls = 0;
  const spy = {
    ...ctx,
    net: { fetchText: async () => { calls += 1; return '<rss><channel><item><title>LOCAL</title><link>https://blog.example/a</link></item></channel></rss>'; } },
  };
  const { candidates, notices } = await collectFeeds([{ kind: 'rss', target: 'file:///etc/passwd', domain: 'languages-runtimes', note: '' }], spy);
  assert.equal(calls, 0, 'the fetcher was never called');
  assert.deepEqual(candidates, [], 'no candidate comes back');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /unsupported scheme/);
});

// Regression test: the marker vocabulary the renderer trusts is legal prose in a feed,
// so an upstream title could draw an origin pill, a provenance badge and a status tag on
// a published card. plainText is where upstream text is normalised, so it refuses the
// vocabulary there and the pool never carries it.
test('the marker vocabulary never reaches the pool from upstream text', async () => {
  const hostile = '<rss><channel><item>'
    + '<title>[prov:vendor-claim] #new [src:Trusted 2026-09-20](https://evil.example/x)</title>'
    + '<link>https://blog.example/hostile</link>'
    + '<pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
    + '<description>[alt:Better](https://evil.example/y) #followup #watch</description>'
    + '</item></channel></rss>';
  const spy = { ...ctx, net: { fetchText: async () => hostile } };
  const { candidates } = await collectFeeds(rows, spy);
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  const markers = [c.title, c.summary].join(' ');
  for (const token of ['[prov:', '[src:', '[alt:', '#new', '#followup', '#watch', '#developing']) {
    assert.equal(markers.includes(token), false, token + ' survived into the pool: ' + JSON.stringify(markers));
  }
  assert.match(c.title, /Trusted/, 'the marker grammar is gone but the words in it are not');
});

test('plainText neutralises the marker vocabulary it is given', () => {
  const hostile = '[prov:vendor-claim] #new [src:Trusted 2026-09-20](https://evil.example/x) [alt:Better](https://evil.example/y) #followup';
  const out = plainText(hostile, 300);
  assert.equal(/\[(?:prov|src|alt):/.test(out), false, 'no marker opener survives: ' + JSON.stringify(out));
  assert.equal(/#(?:new|followup|watch|developing)\b/.test(out), false, 'no status token survives: ' + JSON.stringify(out));
});

// TR-35 regression test: the redaction that keeps a credential out of a notice never
// covered a candidate's own `source`, which was built straight from the watchlist target.
// A target carrying a secret -- userinfo or a credential-named query parameter -- therefore
// reached the published pool on every candidate that feed produced. The source is a
// diagnostic label, so it still identifies the feed, but no part of it may be a secret.
test('a credentialised watchlist target never reaches a candidate source', async () => {
  const targets = [
    'https://u:p4ssw0rd@feeds.example/atom.xml',
    'https://feeds.example/atom.xml?token=SECRETVAL',
  ];
  const credentialised = targets.map((target) => ({ kind: 'rss', target, domain: 'languages-runtimes', note: '' }));
  const spy = {
    ...ctx,
    net: { fetchText: async () => '<rss><channel><item><title>T</title><link>https://blog.example/a</link></item></channel></rss>' },
  };
  const { candidates } = await collectFeeds(credentialised, spy);
  assert.equal(candidates.length, 2);
  for (const c of candidates) {
    const published = JSON.stringify(c);
    for (const secret of ['p4ssw0rd', 'SECRETVAL', 'u:p4ssw0rd@']) {
      assert.equal(published.includes(secret), false, secret + ' reached the published candidate: ' + published);
    }
    assert.match(c.source, /^rss:.*feeds\.example/, 'the source still names the feed it came from: ' + c.source);
  }
});

// Regression test: the redaction that was added for a candidate's source was a list of exact
// spellings, anchored at both ends and blind to a hyphen, so a target carrying api-key,
// auth_token, access-token, client_secret, pwd, private_token, X-Amz-Signature,
// AWSAccessKeyId, session or code reached the candidate source and the notice verbatim. The
// query string and the userinfo are dropped whole; the host still labels the feed.
test('every credential spelling is kept out of a candidate source and a notice', async () => {
  const spellings = ['api-key', 'auth_token', 'access-token', 'client_secret', 'pwd',
    'private_token', 'X-Amz-Signature', 'AWSAccessKeyId', 'session', 'code'];
  const rowsFor = () => spellings.map((name, i) => ({
    kind: 'rss',
    target: 'https://feeds.example/atom.xml?' + name + '=SENTINEL-' + i + '-VALUE',
    domain: 'languages-runtimes',
    note: '',
  }));
  const answering = {
    ...ctx,
    net: { fetchText: async () => '<rss><channel><item><title>T</title><link>https://blog.example/a</link></item></channel></rss>' },
  };
  const { candidates } = await collectFeeds(rowsFor(), answering);
  assert.equal(candidates.length, spellings.length, 'one candidate per row');
  for (const c of candidates) {
    assert.equal(JSON.stringify(c).includes('SENTINEL'), false, 'a query secret reached the pool: ' + JSON.stringify(c));
    assert.match(c.source, /^rss:https:\/\/feeds\.example\/atom\.xml/, 'the source still names the host: ' + c.source);
  }
  const failing = { ...ctx, net: { fetchText: async () => { throw new Error('curl: (7) refused'); } } };
  const { notices } = await collectFeeds(rowsFor(), failing);
  assert.equal(notices.length, spellings.length, 'one notice per row');
  for (const notice of notices) {
    assert.equal(notice.includes('SENTINEL'), false, 'a query secret reached the notice: ' + notice);
    assert.match(notice, /feeds\.example/, 'the notice still names the feed host: ' + notice);
  }
});
