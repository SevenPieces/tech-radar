// tests/sweep2-regression.test.mjs
// Independent regression tests for TR-109..TR-112, the four redaction and neutraliser
// regressions the second adversarial sweep recorded against 2024e40. Each case pins both
// directions of its rule: what must still be protected, and what must not be damaged. The
// cases drive the seams the sweep named - requestSecrets/redactSecrets, the collector's
// candidate pass and the candidate prose transform - not a private helper, so a fix that
// only moves the symptom does not satisfy them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAll, collectAdvisories, collectFeeds } from '../scripts/collect.mjs';
import { plainText, redactSecrets, requestSecrets, shapeHttpError } from '../scripts/lib/net.mjs';

// The one Markdown rendering rule these cases read a notice through: a live anchor is exactly
// what '[label](destination)' draws. A notice is published text in the digest's Coverage note.
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g;
const renderMarkdown = (text) => String(text)
  .replace(MARKDOWN_LINK, (match, label, href) => '<a href="' + href + '">' + label + '</a>');

const ADVISORY_SETTINGS = {
  user_agent: 'tech-radar/1.0', ghsa_page_size: 50, nvd_severity: 'HIGH',
  title_max_chars: 200, summary_max_chars: 400, error_snippet_max_chars: 200,
};

// TR-109 (second-sweep F-1): the per-parameter rule recognised a credential stem only where a
// non-letter preceded it, so a fused spelling - apikey, apiKey, accesstoken, refreshtoken,
// clientsecret, privatekey, subscriptionkey, bearer, jwt - was read as an ordinary parameter
// and its short value was published verbatim in the notice and the pool. The name is normalised
// before the stem match, so each fused spelling is a credential position again. The other
// direction is pinned too: an ordinary name keeps the floor, so its short value is never
// collected and prose that happens to carry that word stays readable.
test('TR-109 a fused credential parameter name is protected and a short ordinary value is not collected', () => {
  const fused = [
    ['apikey', '1234'],
    ['apiKey', '9911'],
    ['accesstoken', 'ABC12'],
    ['refreshtoken', 'rt-7X'],
    ['clientsecret', 'cs22'],
    ['privatekey', 'pk-42'],
    ['subscriptionkey', '4321'],
    ['bearer', 'b7Q'],
    ['jwt', 'j8k'],
  ];
  for (const [name, value] of fused) {
    const url = 'https://feeds.example/rss?' + name + '=' + encodeURIComponent(value);
    const secrets = requestSecrets(url, {});
    assert.equal(secrets.includes(value), true,
      name + ' must be a credential position: ' + JSON.stringify(secrets));
    const written = redactSecrets('upstream rejected /rss?' + name + '=' + value + ' for this row', secrets);
    assert.equal(written.includes(value), false,
      'the value under ' + name + ' survived redaction: ' + written);
  }
  // The other direction: 'format' is not credential-shaped, so a four-character value keeps the
  // floor. It is never collected and the word it spells is not reaped from a notice.
  const benign = requestSecrets('https://feeds.example/rss?format=atom', {});
  assert.equal(benign.includes('atom'), false,
    'a short ordinary query value was collected: ' + JSON.stringify(benign));
  assert.equal(redactSecrets('the atom feed is otherwise fine', benign), 'the atom feed is otherwise fine',
    'a short ordinary value reaped a notice word');
  // The composed path on which the sweep observed the leak: a body that echoes the request.
  const shaped = shapeHttpError(500,
    Buffer.from('upstream rejected /r0?apikey=1234'),
    'http://127.0.0.1:45711/r0?apikey=1234', 200);
  assert.equal(shaped.message.includes('1234'), false,
    'a fused credential reached the notice: ' + shaped.message);
});

// TR-110 (second-sweep F-2): the run-wide union applied to candidate fields held every value
// any request carried, the collector's own configuration included, so the shipped arXiv URL's
// sortOrder=descending reaped the ordinary English word from a published candidate summary -
// the class TR-101 closed for notices and left live for candidates. The candidate pass must be
// redacted against the credential positions only. The other direction is the guarantee that
// must survive the narrowing: a credential a 200 answer echoes into a candidate field is still
// removed, and the userinfo password with it. This drives collectAll, which owns both unions.
test('TR-110 the collectors own query values do not reap candidate prose while a credential still does', async () => {
  const token = 'TK1234';
  const password = 'pw1';
  const settings = {
    timezone: 'Asia/Shanghai', window_cap_weeks: 4, first_run_days: 7,
    discovery_hosts: 'news.ycombinator.com', user_agent: 'tech-radar/1.0',
    request_timeout_ms: 20000, title_max_chars: 200, summary_max_chars: 400,
    error_snippet_max_chars: 200,
    github_org_repos: 10, github_releases_per_repo: 10, github_tags_per_repo: 5,
    github_rate_limit_reserve: 0, arxiv_max_results: 40, ghsa_page_size: 50, nvd_severity: 'HIGH',
  };
  const watchlist = [
    { kind: 'arxiv-category', target: 'cs.AI', domain: 'ai-llm', note: '' },
    { kind: 'rss', target: 'https://feeduser:' + password + '@feeds.example/echo.xml?token=' + token, domain: 'ai-llm', note: '' },
  ];
  const net = {
    fetchText: async (url) => {
      if (url.startsWith('https://export.arxiv.org/api/query')) {
        return '<feed><entry><title>Sorting the index</title>'
          + '<link rel="alternate" href="http://arxiv.org/abs/2609.00001v1"/>'
          + '<published>2026-09-20T01:00:00Z</published>'
          + '<summary>We sort the results in descending order and report the outcome.</summary>'
          + '</entry></feed>';
      }
      if (url.includes('feeds.example')) {
        return '<rss><channel><item><title>hello ' + token + '</title>'
          + '<link>https://feeds.example/1</link>'
          + '<pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
          + '<description>the token is ' + token + ' for the user with password ' + password + '</description>'
          + '</item></channel></rss>';
      }
      throw new Error('unexpected request: ' + url);
    },
  };
  const pool = await collectAll({ settings, watchlist },
    { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', net });
  const arxiv = pool.candidates.find((c) => String(c.source).startsWith('arxiv'));
  assert.ok(arxiv, 'the arxiv row still contributes: ' + JSON.stringify(pool.candidates));
  assert.match(arxiv.summary, /descending order/,
    "the collector's own sort value reaped published prose: " + arxiv.summary);
  assert.doesNotMatch(arxiv.summary, /\[redacted\]/,
    'a bogus redaction stands in the candidate summary: ' + arxiv.summary);
  const feed = pool.candidates.find((c) => String(c.source).startsWith('rss'));
  assert.ok(feed, 'the feed row still contributes: ' + JSON.stringify(pool.candidates));
  assert.equal(JSON.stringify(feed).includes(token), false,
    'the echoed credential reached a candidate field: ' + JSON.stringify(feed));
  assert.equal(JSON.stringify(feed).includes(password), false,
    'the userinfo password reached a candidate field: ' + JSON.stringify(feed));
});

// TR-111 (second-sweep F-3): a credential-shaped parameter name held a credential whatever its
// value spelled, so '?code=on' put the two-letter value in the union and every candidate title
// and summary reading "Python on Windows" was published as "Python [redacted] Windows". A
// credential-named value is collected from three characters up; the userinfo is a credential
// position whatever its length, so the two-character password it carries is still removed.
test('TR-111 a one or two character credential-named value reaps nothing while userinfo still goes', () => {
  const two = requestSecrets('https://feeds.example/rss.xml?code=on', {});
  assert.equal(two.includes('on'), false,
    'a two-character credential-named value was collected: ' + JSON.stringify(two));
  assert.equal(redactSecrets('Python on Windows', two), 'Python on Windows',
    'an ordinary word was reaped by a two-character credential-named value: ' + redactSecrets('Python on Windows', two));
  const one = requestSecrets('https://feeds.example/rss.xml?code=a', {});
  assert.equal(one.includes('a'), false,
    'a one-character credential-named value was collected: ' + JSON.stringify(one));
  assert.equal(redactSecrets('a Python on Windows', one), 'a Python on Windows',
    'an ordinary word was reaped by a one-character credential-named value: ' + redactSecrets('a Python on Windows', one));
  // The direction the rule must not lose: the userinfo password is collected and removed
  // whatever its length.
  const userinfo = requestSecrets('https://feeduser:pw@feeds.example/echo.xml', {});
  assert.equal(userinfo.includes('pw'), true,
    'a userinfo password is collected whatever its length: ' + JSON.stringify(userinfo));
  assert.equal(redactSecrets('the password pw was rejected', userinfo), 'the password [redacted] was rejected',
    'a short userinfo password survived: ' + redactSecrets('the password pw was rejected', userinfo));
  // The composed notice path from the sweep: the request's own two-letter value must not reap
  // the notice's prose.
  const shaped = shapeHttpError(500, Buffer.from('Python on Windows appeared twice'),
    'https://feeds.example/rss.xml?code=on', 200);
  assert.match(shaped.message, /Python on Windows/,
    'a credential-named value reaped the notice prose: ' + shaped.message);
});

// TR-112 (second-sweep F-5): the markdown-link seam lived inside neutraliseMarkers, which is
// also the candidate prose transform, so a legitimate upstream link in a release body or a feed
// title was defaced in the pool ("[label] (url)"). The seam belongs to the notice sanitiser: a
// candidate title must carry the link upstream wrote, while every notice still carries no link
// syntax a Markdown reader could draw a live anchor from. Both notice spellings are covered -
// an identifier interpolated straight into the notice and the snippet of a body the transport
// shaped - so a fix that only spares the candidate path fails the second half.
test('TR-112 a legitimate upstream markdown link survives a candidate title while a notice carries none', async () => {
  const link = '[the migration guide](https://example.com/migrate)';
  assert.equal(plainText(link, 200), link,
    'the candidate prose transform defaced a legitimate link: ' + plainText(link, 200));
  const body = '<rss><channel><item><title>A [migration guide](https://example.com/migrate) for v2</title>'
    + '<link>https://feeds.example/1</link>'
    + '<pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
    + '<description>Fixes a crash.</description></item></channel></rss>';
  const feedCtx = {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
    settings: ADVISORY_SETTINGS,
    net: { fetchText: async () => body },
  };
  const { candidates } = await collectFeeds(
    [{ kind: 'rss', target: 'https://feeds.example/releases.xml', domain: 'ai-llm', note: '' }], feedCtx);
  assert.equal(candidates.length, 1, 'the feed still contributes its item');
  assert.match(candidates[0].title, /\]\(https:\/\/example\.com\/migrate\)/,
    'a legitimate upstream link was defaced in a candidate title: ' + candidates[0].title);

  // The notice direction, path one: an identifier the upstream chose, interpolated into the
  // notice the Coverage note publishes.
  const advisoryCtx = {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
    settings: ADVISORY_SETTINGS,
    net: {
      fetchText: async () => JSON.stringify({
        vulnerabilities: [
          { cve: { id: '[x](https://evil.example/pwn)', published: '2026-09-21T00:00:00.000',
            descriptions: [{ lang: 'en', value: 'a markdown link' }] } },
        ],
      }),
    },
  };
  const { notices } = await collectAdvisories(
    [{ kind: 'nvd', target: 'high-severity', domain: 'security-privacy', note: '' }], advisoryCtx);
  assert.equal(notices.length, 1, 'the rejected identifier is reported: ' + notices.join(' | '));
  assert.doesNotMatch(notices[0], /\]\(/,
    'a notice still carries markdown link syntax: ' + notices[0]);
  assert.doesNotMatch(renderMarkdown(notices[0]), /<a\b/,
    'the notice renders a live anchor: ' + renderMarkdown(notices[0]));

  // The notice direction, path two: the snippet of a 5xx body the transport shaped, which now
  // reaches the notice with its punctuation intact and must still be neutralised at the push.
  const errorCtx = {
    ...feedCtx,
    net: {
      fetchText: async (url) => {
        throw shapeHttpError(500, Buffer.from('see [the log](https://evil.example/pwn)'), url, 200);
      },
    },
  };
  const { candidates: failed, notices: errorNotices } = await collectFeeds(
    [{ kind: 'rss', target: 'https://feeds.example/releases.xml', domain: 'ai-llm', note: '' }], errorCtx);
  assert.deepEqual(failed, [], 'the failing feed contributes no candidate');
  assert.equal(errorNotices.length, 1, 'the failing feed is reported: ' + errorNotices.join(' | '));
  assert.doesNotMatch(errorNotices[0], /\]\(/,
    'a notice built from a server body still carries link syntax: ' + errorNotices[0]);
  assert.doesNotMatch(renderMarkdown(errorNotices[0]), /<a\b/,
    'a notice built from a server body renders a live anchor: ' + renderMarkdown(errorNotices[0]));
});
