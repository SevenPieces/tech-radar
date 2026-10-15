// tests/collect-feeds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFeeds } from '../scripts/collect.mjs';
import { shapeHttpError } from '../scripts/lib/net.mjs';

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
