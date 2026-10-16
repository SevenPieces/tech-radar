// tests/collect-arxiv.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectArxiv } from '../scripts/collect.mjs';
import { shapeHttpError } from '../scripts/lib/net.mjs';

const rows = [{ kind: 'arxiv-category', target: 'cs.CV', domain: 'computer-vision', note: '' }];
const ctx = {
  since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
  settings: { user_agent: 'tech-radar/1.0', arxiv_max_results: 40, title_max_chars: 200, summary_max_chars: 400, error_snippet_max_chars: 200 },
  net: {
    fetchText: async (url) => {
      assert.match(url, new RegExp(
        'export\\.arxiv\\.org/api/query\\?search_query=cat%3Acs\\.CV'
        + '&sortBy=submittedDate&sortOrder=descending&max_results='
        + ctx.settings.arxiv_max_results,
      ));
      return [
        '<feed><entry><title>Depth Anything 3</title>',
        '<link rel="alternate" href="http://arxiv.org/abs/2609.01234v1"/>',
        '<published>2026-09-20T01:00:00Z</published>',
        '<summary>  We present a\n monocular depth model.  </summary></entry></feed>',
      ].join('');
    },
  },
};

test('collectArxiv maps entries to unreviewed preprint candidates', async () => {
  const { candidates, notices } = await collectArxiv(rows, ctx);
  assert.deepEqual(notices, []);
  assert.equal(candidates[0].tierHint, 'preprint');
  assert.equal(candidates[0].title, 'Depth Anything 3');
  assert.equal(candidates[0].url, 'http://arxiv.org/abs/2609.01234v1');
  assert.equal(candidates[0].summary, 'We present a monocular depth model.');
  assert.equal(candidates[0].domain, 'computer-vision');
});

// F2: with the transport raising on HTTP 4xx/5xx (net.mjs strips curl's -w status
// line and raises the shaped error itself), a
// missing listing must surface as a notice, not as an empty, silent result.
test('collectArxiv turns an HTTP 404 into a notice instead of a silent skip', async () => {
  const missing = {
    ...ctx,
    net: {
      fetchText: async (url) => {
        throw shapeHttpError(404, Buffer.from('<html><body><h1>Not Found</h1></body></html>'), url, 200);
      },
    },
  };
  const { candidates, notices } = await collectArxiv(rows, missing);
  assert.deepEqual(candidates, []);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^arxiv cs\.CV: HTTP 404 for https:\/\/export\.arxiv\.org\/api\/query$/,
    'the notice names the status and the redacted request: ' + notices[0]);
  assert.equal(notices[0].includes('Not Found'), false,
    'the upstream body reached the notice: ' + notices[0]);
});

// Regression test: a listing that hits arxiv_max_results is not a complete one, and
// the run has to say so or the window looks enforced when it is not.
test('a listing that hits the cap says so, and an uncapped one stays quiet', async () => {
  const entries = (n) => Array.from({ length: n }, (_, i) => '<entry><title>Paper ' + i + '</title>'
    + '<link rel="alternate" href="http://arxiv.org/abs/2609.' + (10000 + i) + 'v1"/>'
    + '<published>2026-09-20T01:00:00Z</published><summary>s</summary></entry>').join('');
  const net = { fetchText: async () => '<feed>' + entries(2) + '</feed>' };
  const capped = await collectArxiv(rows, { ...ctx, settings: { ...ctx.settings, arxiv_max_results: 2 }, net });
  assert.equal(capped.notices.length, 1);
  assert.match(capped.notices[0], /^arxiv cs\.CV: listing capped at 2 entries/);
  const roomy = await collectArxiv(rows, { ...ctx, settings: { ...ctx.settings, arxiv_max_results: 5 }, net });
  assert.deepEqual(roomy.notices, []);
  assert.equal(roomy.candidates.length, 2, 'the entries themselves are unchanged');
});
