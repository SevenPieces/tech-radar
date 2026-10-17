// tests/sweep3-regression.test.mjs
// Independent regression tests for TR-115..TR-119 and TR-122: the redaction and notice
// regressions the third adversarial sweep recorded against fdfb7ea, and the notice-push residual
// its tag-shaped-value fix left behind. Each case pins both directions of its rule: what must
// still be protected, and what must not be damaged. The cases drive the seams the sweep named -
// requestSecretSets/requestSecrets/redactSecrets, the collector's candidate pass, the notice
// sites that interpolate an upstream value -- which the notice rule now strips of that value
// entirely -- and the single push every notice crosses, not a private helper, so a fix that only
// moves the symptom does not satisfy them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAdvisories, collectAll, collectGithub, collectRegistries } from '../scripts/collect.mjs';
import { decodeEntities, plainText, redactSecrets, requestSecrets, requestSecretSets, shapeHttpError } from '../scripts/lib/net.mjs';

// The percent-encoded spelling of a name, one escape per character: this is the spelling the
// server reads as the same parameter, so the name rule has to test the decoded form as well.
const percentEncoded = (name) => [...name]
  .map((ch) => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');

// The settings a registry or advisory block reads, shaped like config/settings.md.
const SOURCE_SETTINGS = {
  user_agent: 'tech-radar/1.0', ghsa_page_size: 50, nvd_severity: 'HIGH',
  title_max_chars: 200, summary_max_chars: 400, error_snippet_max_chars: 200,
};

// The settings collectAll reads; every value is the shipped one that matters to the pool.
const RUN_SETTINGS = {
  timezone: 'Asia/Shanghai', window_cap_weeks: 4, first_run_days: 7,
  discovery_hosts: 'news.ycombinator.com', user_agent: 'tech-radar/1.0',
  request_timeout_ms: 20000, title_max_chars: 200, summary_max_chars: 400,
  error_snippet_max_chars: 200, github_org_repos: 10, github_releases_per_repo: 10,
  github_tags_per_repo: 5, github_rate_limit_reserve: 0, arxiv_max_results: 40,
  ghsa_page_size: 50, nvd_severity: 'HIGH',
};

// One rss row through the whole run, so the candidate-field redaction TR-110 installed is
// exercised rather than the request rule alone. The feed answers one item whose text carries
// the word under test.
async function poolForOneFeed(target, title, summary) {
  const net = {
    fetchText: async (url) => {
      if (!url.includes('feeds.example')) throw new Error('unexpected request: ' + url);
      return '<rss><channel><item><title>' + title + '</title>'
        + '<link>https://feeds.example/1</link>'
        + '<pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
        + '<description>' + summary + '</description></item></channel></rss>';
    },
  };
  return collectAll(
    { settings: RUN_SETTINGS, watchlist: [{ kind: 'rss', target, domain: 'ai-llm', note: '' }] },
    { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', net });
}

// TR-115 (third-sweep A-1): the stem list missed the common credential spellings that carry
// no listed stem - pw, pswd, otp, pin, hmac, ticket, assertion, saml, samlresponse, nonce - so
// a value under one of them was collected by neither rule and was published in the notice and
// in the candidate field the digest is read from. The name rule tests the percent-decoded
// spelling too, so the encoded name is the same parameter here.
test('TR-115 the extended credential spellings are protected raw and percent-encoded', () => {
  const value = 'SECRET42';
  const spellings = ['pw', 'pswd', 'otp', 'pin', 'hmac', 'ticket', 'assertion', 'saml', 'samlresponse', 'nonce'];
  for (const name of spellings) {
    for (const spelled of [name, percentEncoded(name)]) {
      const url = 'https://feeds.example/rss?' + spelled + '=' + value;
      const secrets = requestSecrets(url, {});
      assert.equal(secrets.includes(value), true,
        spelled + ' must be a credential position: ' + JSON.stringify(secrets));
      assert.equal(redactSecrets('upstream rejected /rss?' + spelled + '=' + value, secrets).includes(value), false,
        'the value under ' + spelled + ' survived redaction');
      const shaped = shapeHttpError(500,
        Buffer.from('upstream rejected /rss?' + spelled + '=' + value), url, 200);
      assert.equal(shaped.message.includes(value), false,
        'a value under ' + spelled + ' reached the notice: ' + shaped.message);
    }
  }
  // The other direction: a name carrying none of the stems is not a credential position, so
  // its short value is never collected and the word it spells is not reaped.
  const benign = requestSecrets('https://feeds.example/rss?format=atom', {});
  assert.equal(benign.includes('atom'), false,
    'a short ordinary query value was collected: ' + JSON.stringify(benign));
});

// TR-116 (third-sweep A-2): the stem was matched anywhere in the separator-stripped name, so
// an ordinary parameter became a credential position - author through auth, design through
// sig, statuscode and countrycode through code, keyword through key - and its value reaped
// published candidate prose. The stem is a token now: the stripped name must end with it or be
// it, which keeps apikey, accesstoken and the other fused spellings while author, design,
// statuscode and keyword stop matching.
test('TR-116 a stem inside an ordinary parameter name is not a credential position', () => {
  const ordinary = ['author', 'design', 'statuscode', 'keyword', 'countrycode', 'zipcode'];
  for (const name of ordinary) {
    for (const spelled of [name, percentEncoded(name)]) {
      const url = 'https://feeds.example/rss?' + spelled + '=Jane';
      const { all, credentials } = requestSecretSets(url, {});
      assert.equal(all.includes('Jane'), false,
        spelled + ' was read as a credential position in the notice union: ' + JSON.stringify(all));
      assert.equal(credentials.includes('Jane'), false,
        spelled + ' was read as a credential position in the candidate union: ' + JSON.stringify(credentials));
      assert.equal(redactSecrets("Jane Austen's guide to the modern feed", all),
        "Jane Austen's guide to the modern feed",
        'the value under ' + spelled + ' reaped a published word');
    }
  }
  // The fused spellings the earlier rule had to keep stay credential positions.
  const fused = ['apikey', 'apiKey', 'accesstoken', 'refreshtoken', 'clientsecret',
    'privatekey', 'subscriptionkey', 'bearer', 'jwt'];
  for (const name of fused) {
    const url = 'https://feeds.example/rss?' + name + '=SENTINEL42';
    assert.equal(requestSecrets(url, {}).includes('SENTINEL42'), true,
      name + ' must stay a credential position');
  }
});

test('TR-116 an ordinary parameter value does not reap candidate prose end to end', async () => {
  const pool = await poolForOneFeed('https://feeds.example/rss.xml?author=Jane',
    'Weekly digest', "Jane Austen's guide to the modern feed.");
  const feed = pool.candidates.find((c) => String(c.source).startsWith('rss'));
  assert.ok(feed, 'the feed row still contributes: ' + JSON.stringify(pool.candidates));
  assert.match(feed.summary, /Jane Austen/,
    'an ordinary parameter value reaped published prose: ' + feed.summary);
  assert.doesNotMatch(feed.summary, /\[redacted\]/,
    'a bogus redaction stands in the candidate summary: ' + feed.summary);
});

// TR-117 (third-sweep A-3): the userinfo was collected unconditionally, username included, so
// an ordinary word the operator's own feed URL carried rewrote published prose and a
// one-character username reaped the standalone article 'a'. The password is collected
// whatever its length; the username only from the free-text floor (eight characters) up.
test('TR-117 the userinfo password goes whatever its length while a short username does not', () => {
  const url = 'https://news:pw@feeds.example/rss.xml';
  const { all, credentials } = requestSecretSets(url, {});
  assert.equal(all.includes('pw'), true, 'the password must be collected: ' + JSON.stringify(all));
  assert.equal(credentials.includes('pw'), true,
    'the password must reach the candidate union: ' + JSON.stringify(credentials));
  assert.equal(all.includes('news'), false,
    'a short username must not be collected: ' + JSON.stringify(all));
  assert.equal(credentials.includes('news'), false,
    'a short username must not reach the candidate union: ' + JSON.stringify(credentials));
  assert.equal(redactSecrets('the password pw was rejected', requestSecrets(url, {})),
    'the password [redacted] was rejected',
    'a short userinfo password survived a notice');
  // A one-character username and a two-character password: the password is still collected
  // and the username still is not.
  const tiny = requestSecretSets('https://u:ab@feeds.example/rss.xml', {});
  assert.equal(tiny.all.includes('ab'), true, 'a two-character password is still collected');
  assert.equal(tiny.all.includes('u'), false, 'a one-character username is not collected');
  // The floor's other side: a username at or above eight characters is still a credential.
  const longUsername = 'feedreader';
  assert.equal(requestSecrets('https://' + longUsername + ':pw@feeds.example/rss.xml', {})
    .includes(longUsername), true, 'a long username is still a credential position');
});

test('TR-117 a short userinfo username does not reap candidate prose end to end', async () => {
  const pool = await poolForOneFeed('https://news:pw@feeds.example/rss.xml',
    'the news desk', 'the news desk reads this every day.');
  const feed = pool.candidates.find((c) => String(c.source).startsWith('rss'));
  assert.ok(feed, 'the feed row still contributes: ' + JSON.stringify(pool.candidates));
  assert.match(feed.title, /the news desk/,
    'the short username reaped the candidate title: ' + feed.title);
  assert.match(feed.summary, /the news desk reads this/,
    'the short username reaped the candidate summary: ' + feed.summary);
});

// TR-118 (third-sweep A-4): the three-character floor moved the boundary rather than closing
// the class - a genuine credential name carrying an ordinary short word ('?code=new',
// '?token=beta') still put that word into the set the candidate fields are redacted against.
// The notice union collects a credential-named value from three characters up; the candidate
// union collects it only from eight, where it cannot be ordinary prose.
test('TR-118 a short credential-named value is collected for notices and not for candidates', () => {
  const shortValue = 'beta';
  for (const name of ['token', 'key', 'session', 'code']) {
    const url = 'https://feeds.example/rss?' + name + '=' + shortValue;
    const { all, credentials } = requestSecretSets(url, {});
    assert.equal(all.includes(shortValue), true,
      name + ' must still be a credential position in the notice union: ' + JSON.stringify(all));
    assert.equal(credentials.includes(shortValue), false,
      name + ' below the eight-character candidate floor reached the candidate union: ' + JSON.stringify(credentials));
  }
  // The notice direction is not lost: the request's own short credential is still removed.
  const url = 'https://feeds.example/rss?token=' + shortValue;
  assert.equal(redactSecrets('upstream rejected /rss?token=' + shortValue, requestSecrets(url, {})).includes(shortValue),
    false, 'a short credential-named value survived the notice');
  // The floor's other side: eight characters is a credential position in both unions.
  const eight = requestSecretSets('https://feeds.example/rss?token=SECRET42', {});
  assert.equal(eight.all.includes('SECRET42'), true,
    'an eight-character credential-named value is collected for notices');
  assert.equal(eight.credentials.includes('SECRET42'), true,
    'an eight-character credential-named value is collected for candidates');
});

test('TR-118 a short credential-named value does not reap candidate prose end to end', async () => {
  const pool = await poolForOneFeed('https://feeds.example/rss.xml?token=beta',
    'release notes', 'the beta channel ships weekly.');
  const feed = pool.candidates.find((c) => String(c.source).startsWith('rss'));
  assert.ok(feed, 'the feed row still contributes: ' + JSON.stringify(pool.candidates));
  assert.match(feed.summary, /the beta channel ships weekly/,
    'a short credential-named value reaped published prose: ' + feed.summary);
  assert.doesNotMatch(feed.summary, /\[redacted\]/,
    'a bogus redaction stands in the candidate summary: ' + feed.summary);
});

// TR-119 (third-sweep A-5): two notice sites interpolated an upstream value without the
// neutralisation the rest of the notice text gets - the NVD identifier and the registry
// version - so tag-shaped upstream markup reached the published Coverage note verbatim, where
// a Markdown reader draws a live anchor or fetches a remote image. Both sites must run the
// value through the same neutralisation, and an ordinary rejected value must stay legible.
const hostileTags = [
  '<img src=https://evil.example/a.png>',
  '<script>alert(1)</script>',
  "<a href='https://evil.example/x'>click here</a>",
];
const noLiveTag = (text) => assert.doesNotMatch(text, /<[a-zA-Z/!]/,
  'a notice still carries tag-shaped upstream markup: ' + text);

function advisoryContext(id) {
  return {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
    settings: SOURCE_SETTINGS,
    net: {
      fetchText: async () => JSON.stringify({
        vulnerabilities: [{
          cve: {
            id, published: '2026-09-21T00:00:00.000',
            descriptions: [{ lang: 'en', value: 'a description' }],
          },
        }],
      }),
    },
  };
}

function registryContext(version) {
  return {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
    settings: SOURCE_SETTINGS,
    net: { fetchText: async () => JSON.stringify({ 'dist-tags': { latest: version }, time: {} }) },
  };
}

const NVD_ROW = [{ kind: 'nvd', target: 'high-severity', domain: 'security-privacy', note: '' }];
const NPM_ROW = [{ kind: 'npm', target: 'left-pad', domain: 'languages-runtimes', note: '' }];

test('TR-119 tag-shaped upstream values reach no notice verbatim', async () => {
  for (const tag of hostileTags) {
    const advisories = await collectAdvisories(NVD_ROW, advisoryContext(tag));
    assert.equal(advisories.notices.length, 1,
      'the rejected identifier is reported: ' + advisories.notices.join(' | '));
    assert.equal(advisories.notices[0].includes(tag), false,
      'an advisory identifier reached the notice verbatim: ' + advisories.notices[0]);
    assert.equal(advisories.notices[0], 'nvd: skipped an advisory whose identifier is not a CVE id',
      'the notice is the collector wording alone: ' + advisories.notices[0]);
    noLiveTag(advisories.notices[0]);
    const registries = await collectRegistries(NPM_ROW, registryContext(tag));
    assert.equal(registries.notices.length, 1,
      'the skipped version is reported: ' + registries.notices.join(' | '));
    assert.equal(registries.notices[0].includes(tag), false,
      'a registry version reached the notice verbatim: ' + registries.notices[0]);
    assert.equal(registries.notices[0],
      'npm left-pad: no release time for the latest version; candidate skipped',
      'the notice is the collector wording alone: ' + registries.notices[0]);
    noLiveTag(registries.notices[0]);
  }
});

test('TR-119 the notice names the source and the cause without quoting the upstream value', async () => {
  const advisories = await collectAdvisories(NVD_ROW, advisoryContext('not-a-cve-id'));
  assert.equal(advisories.notices.length, 1);
  assert.equal(advisories.notices[0], 'nvd: skipped an advisory whose identifier is not a CVE id',
    'the notice keeps its own wording: ' + advisories.notices[0]);
  assert.equal(advisories.notices[0].includes('not-a-cve-id'), false,
    'the rejected identifier reached the notice: ' + advisories.notices[0]);
  const registries = await collectRegistries(NPM_ROW, registryContext('1.2.3'));
  assert.equal(registries.notices.length, 1);
  assert.equal(registries.notices[0],
    'npm left-pad: no release time for the latest version; candidate skipped',
    'the notice names the source and the cause: ' + registries.notices[0]);
  assert.equal(registries.notices[0].includes('1.2.3'), false,
    'the upstream version reached the notice: ' + registries.notices[0]);
});

// TR-122 regression test: the tag shape is the one upstream spelling a notice cannot carry. A
// notice is published verbatim in the digest's Coverage note, which ships as Markdown, and a
// Markdown reader passes inline HTML through: an upstream-chosen <a href> draws a live anchor
// with an upstream-chosen label and address, an <img src> fetches a remote URL when the file is
// viewed, and a <script> tag is script. The two sites that interpolate an upstream value were
// normalised one at a time, but a notice also quotes the message a fetch implementation throws -
// no call site normalises that text - so the class is only closed at the one push every notice
// crosses. The push replaces the '<' that opens a tag-shaped span, which ends the markup while
// the span stays legible.
const NOTICE_MARKUP = [
  ['an anchor', '<a href=https://evil.example/pwn>click</a>', /click/],
  ['an image', '<img src=https://evil.example/a.png>', /a\.png/],
  ['a script tag', '<script>alert(1)</script>', /alert\(1\)/],
];

// The one rendering rule these cases read a notice through: a Markdown reader passes raw inline
// HTML through to the rendered document, so the tag a notice carries is the tag the published
// Coverage note draws. The case pins the reading on the upstream spelling itself, so a reading
// that drew no tag could not make the markup case pass.
const MARKDOWN_TAG = /<\s*\/?\s*[A-Za-z][\w:.-]*(?:\s[^<>]*)?>/;
const renderMarkdown = (text) => String(text);

// A fetch implementation may throw whatever it likes, and every failure is reported through the
// one push that builds a notice, so the same thrown message is driven through a whole run, a
// registry row and an advisory row. Nothing between the throw and the push normalises it, which
// is what makes these cases a test of the boundary rather than of a caller's own tidy-up.
async function noticesFromThrownFetch(message) {
  const throwing = (ctx) => ({ ...ctx, net: { fetchText: async () => { throw new Error(message); } } });
  const run = await collectAll(
    { settings: RUN_SETTINGS, watchlist: [{ kind: 'rss', target: 'https://feeds.example/rss.xml', domain: 'ai-llm', note: '' }] },
    {
      since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z',
      net: { fetchText: async () => { throw new Error(message); } },
    },
  );
  const registries = await collectRegistries(NPM_ROW, throwing(registryContext('1.2.3')));
  const advisories = await collectAdvisories(NVD_ROW, throwing(advisoryContext('CVE-2026-0001')));
  return [
    ['the run', run.notices],
    ['a registry row', registries.notices],
    ['an advisory row', advisories.notices],
  ];
}

test('TR-122 tag-shaped upstream markup reaches no notice and draws no tag in the Markdown', async () => {
  for (const [what, span, legible] of NOTICE_MARKUP) {
    assert.match(renderMarkdown('the upstream answer was ' + span), MARKDOWN_TAG,
      what + ': the reading draws the upstream spelling as a tag, so the case can mean something');
    for (const [path, notices] of await noticesFromThrownFetch('the upstream answer was ' + span)) {
      assert.equal(notices.length, 1,
        what + ' from ' + path + ': the failure is reported, not swallowed: ' + notices.join(' | '));
      const notice = notices[0];
      assert.equal(notice.includes(span), false,
        what + ' from ' + path + ' reached the notice verbatim: ' + notice);
      noLiveTag(notice);
      assert.doesNotMatch(renderMarkdown(notice), MARKDOWN_TAG,
        what + ' from ' + path + ' draws a tag in the published Markdown: ' + notice);
      assert.match(notice, legible,
        what + ' from ' + path + ': the span stays legible: ' + notice);
      assert.match(notice, /the upstream answer was/,
        what + ' from ' + path + ': the notice keeps its own wording: ' + notice);
    }
  }
});

test('TR-122 a legitimate server message with an angle bracket still reads in the notice', async () => {
  const message = 'the server said a < b and see <id> (retry later); see [1] of the log';
  for (const [path, notices] of await noticesFromThrownFetch(message)) {
    assert.equal(notices.length, 1, path + ': the failed fetch is reported: ' + notices.join(' | '));
    const notice = notices[0];
    assert.match(notice, /a < b/,
      path + ': an angle-bracket comparison is not a tag and stays byte-identical: ' + notice);
    assert.match(notice, /\bid\b/,
      path + ': the bracketed word stays legible: ' + notice);
    assert.match(notice, /\(retry later\); see \[1\] of the log/,
      path + ': the punctuation of the message is untouched: ' + notice);
  }
});

// TR-123 (fourth-sweep): the tag shape has a second spelling -- the entity -- and it slipped past
// both boundaries. The candidate normaliser stripped literal tags before it decoded entities, so
// text that reached it undecoded (a GitHub release body is JSON, not XML: nothing decodes it
// first) decoded into a live '<a href>' after the strip had gone past it. The notice push never
// decodes at all, so a thrown message quoting the encoded anchor published it verbatim for the
// reader to decode. One rule refuses the encoded opener now and both boundaries draw it, so a
// second spelling cannot let them drift apart.
const ENCODED_MARKUP = [
  ['an anchor', '&lt;a href=https://evil.example/pwn&gt;click&lt;/a&gt;', /click/],
  ['an image', '&lt;img src=https://evil.example/a.png&gt;', /a\.png/],
  ['a script tag', '&lt;script&gt;alert(1)&lt;/script&gt;', /alert\(1\)/],
];
const ENCODED_LT = /&(?:lt|#0*60|#x0*3c)/i;

// The candidate half of the boundary, driven through the collector path that really carries an
// entity to the normaliser: a release body arrives as JSON text, so its entities are still
// encoded when plainText reads them.
async function releaseSummary(body) {
  const net = {
    fetchText: async (url) => {
      if (url.endsWith('/rate_limit')) {
        return JSON.stringify({ resources: { core: { limit: 60, remaining: 55, reset: 1790177128 } } });
      }
      if (url.includes('/releases')) {
        return JSON.stringify([{
          tag_name: 'v1.0.0', html_url: 'https://github.com/org/repo/releases/tag/v1.0.0',
          published_at: '2026-09-21T10:00:00Z', draft: false, body,
        }]);
      }
      throw new Error('unexpected request: ' + url);
    },
  };
  const { candidates } = await collectGithub(
    [{ kind: 'github-repo', target: 'org/repo', domain: 'ai-llm', note: '' }],
    {
      since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000, net,
      settings: {
        ...SOURCE_SETTINGS, user_agent: 'tech-radar/1.0', github_org_repos: 10,
        github_releases_per_repo: 10, github_tags_per_repo: 5, github_rate_limit_reserve: 0,
      },
    },
  );
  return candidates[0]?.summary ?? '';
}

test('TR-123 entity-encoded markup reaches no notice and no candidate field', async () => {
  for (const [what, encoded, legible] of ENCODED_MARKUP) {
    // The premise: the collector's own decoder draws the tag out of this spelling, so the case
    // can mean something and is not pinning an inert string.
    assert.match(decodeEntities(encoded), MARKDOWN_TAG,
      what + ': the encoded spelling decodes into a tag');
    for (const [path, notices] of await noticesFromThrownFetch('the upstream answer was ' + encoded)) {
      assert.equal(notices.length, 1,
        what + ' from ' + path + ': the failure is reported, not swallowed: ' + notices.join(' | '));
      const notice = notices[0];
      assert.equal(notice.includes(encoded), false,
        what + ' from ' + path + ' reached the notice verbatim: ' + notice);
      assert.doesNotMatch(notice, ENCODED_LT,
        what + ' from ' + path + ' still carries an encoded opener: ' + notice);
      noLiveTag(notice);
      assert.doesNotMatch(renderMarkdown(notice), MARKDOWN_TAG,
        what + ' from ' + path + ' draws a tag in the published Markdown: ' + notice);
      assert.match(notice, legible, what + ' from ' + path + ': the value stays legible: ' + notice);
    }
    const title = await releaseSummary('a title ' + encoded);
    const summary = await releaseSummary(encoded);
    for (const [where, value] of [['the title', title], ['the summary', summary]]) {
      assert.equal(value.includes(encoded), false,
        what + ' reached ' + where + ' of a candidate verbatim: ' + value);
      assert.doesNotMatch(value, ENCODED_LT,
        what + ' reached ' + where + ' of a candidate as an opener: ' + value);
      noLiveTag(value);
    }
  }
});

test('TR-123 an ordinary entity and a comparison keep their bytes at both boundaries', async () => {
  const benign = 'the server said a < b and the feed is fish &amp; chips (retry later)';
  for (const [path, notices] of await noticesFromThrownFetch(benign)) {
    assert.equal(notices.length, 1, path + ': the failure is reported: ' + notices.join(' | '));
    const notice = notices[0];
    assert.equal(notice.includes('a < b'), true,
      path + ': the comparison stays byte-identical: ' + notice);
    assert.equal(notice.includes('fish &amp; chips'), true,
      path + ': the entity text stays byte-identical: ' + notice);
  }
  const pool = await poolForOneFeed('https://feeds.example/rss.xml', 'a < b title', 'fish &amp; chips');
  const feed = pool.candidates.find((c) => String(c.source).startsWith('rss'));
  assert.ok(feed, 'the feed row still contributes: ' + JSON.stringify(pool.candidates));
  assert.equal(feed.title, 'a < b title',
    'the comparison stays byte-identical in the pool: ' + feed.title);
  assert.equal(feed.summary, 'fish & chips',
    'the ordinary entity decodes exactly as before: ' + feed.summary);
});

// TR-123 residual (independent test design): the encoded opener is refused for the semicolon
// spellings, but the named reference without its semicolon and directly followed by a tag name
// is passed over. A named reference ends at the longest name that matches, and for '&ltscript'
// that name is 'lt': the 'script' that follows is the tag name, so a reader that decodes the
// reference draws '<script>', exactly as it does for '&lt;script&gt;'. The same spelling crosses
// the candidate normaliser, where the decoded opener arrives after the literal strip. Both
// boundaries have to refuse '&lt' with or without its semicolon, in any case.

// The reading these cases pin: a reader that decodes a character reference the way the HTML
// layer under the published deliverable does, and then draws the element the decoded text
// spells. A named reference in text is decoded without its semicolon too, so every spelling
// below is read to the same '<'.
const READER_ENTITY = /&#[xX]([0-9a-fA-F]+);?|&#([0-9]+);?|&(lt|gt|amp|quot|apos|nbsp);?/gi;
const READER_NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
function readDeliverable(text) {
  return String(text).replace(READER_ENTITY, (match, hex, dec, named) => {
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    if (dec !== undefined) return String.fromCodePoint(Number(dec));
    return READER_NAMED[named.toLowerCase()];
  });
}

// The shape a reader draws from a tag, and the shape an encoded opener still has when a tag
// name, a closer slash or a declaration marker follows it.
const DRAWN_TAG = /<[a-zA-Z/!]/;
const ENCODED_TAG_OPENER = /&(?:lt;?|#0*60;?|#x0*3c;?)(?=\/?[A-Za-z]|!)/i;

// Every spelling of the opener the requirement names: named, decimal and hexadecimal, any case,
// with and without the semicolon. The hex spelling is decoded without a semicolon only while the
// next character is not another hex digit, so the tag is 'script' and no case here leans on that
// ambiguity.
const ENCODED_TAG_SPELLINGS = [
  '&lt', '&LT', '&lt;', '&LT;',
  '&#60', '&#60;',
  '&#x3c', '&#X3c', '&#x3C', '&#X3C',
  '&#x3c;', '&#X3c;', '&#x3C;', '&#X3C;',
];
const encodedScript = (spelling) => spelling + 'script&gt;alert(1)&lt;/script&gt;';
const ENCODED_PAYLOADS = ENCODED_TAG_SPELLINGS.map((spelling) => [spelling, encodedScript(spelling)])
  .concat([
  ['the anchor', '&lt;a href=https://evil.example/pwn&gt;click&lt;/a&gt;'],
  ['the anchor without its semicolon', '&lta href=https://evil.example/pwn&gt;click&lt;/a&gt;'],
  ['the anchor without its semicolon, upper case', '&LTa href=https://evil.example/pwn&gt;click&lt;/a&gt;'],
]);

test('TR-123 every encoded tag opener is refused at the notice push', async () => {
  const leaked = [];
  for (const [spelling, payload] of ENCODED_PAYLOADS) {
    assert.match(readDeliverable(payload), DRAWN_TAG,
      spelling + ': the spelling decodes into a tag, so the case can mean something');
    for (const [path, notices] of await noticesFromThrownFetch('the upstream answer was ' + payload)) {
      assert.equal(notices.length, 1,
        spelling + ' from ' + path + ': the failure is reported, not swallowed: ' + notices.join(' | '));
      const notice = notices[0];
      if (notice.includes(payload) || ENCODED_TAG_OPENER.test(notice)
        || DRAWN_TAG.test(readDeliverable(notice))) {
        leaked.push(spelling + ' from ' + path + ': ' + notice);
      }
      assert.match(notice, /the upstream answer was/,
        spelling + ' from ' + path + ': the notice keeps its own wording: ' + notice);
    }
  }
  assert.deepEqual(leaked, [], 'an encoded tag opener still reaches a notice: ' + leaked.join(' | '));
});

test('TR-123 every encoded tag opener yields no tag in the pool', async () => {
  const leaked = [];
  for (const [spelling, payload] of ENCODED_PAYLOADS) {
    const text = plainText(payload, 400);
    if (DRAWN_TAG.test(text) || DRAWN_TAG.test(readDeliverable(text))) {
      leaked.push(spelling + ' in the candidate normaliser: ' + text);
    }
    const summary = await releaseSummary(payload);
    if (DRAWN_TAG.test(summary) || DRAWN_TAG.test(readDeliverable(summary))) {
      leaked.push(spelling + ' in a release summary: ' + summary);
    }
    const pool = await poolForOneFeed('https://feeds.example/rss.xml', 'Weekly digest', payload);
    const feed = pool.candidates.find((c) => String(c.source).startsWith('rss'));
    assert.ok(feed, 'the feed row still contributes: ' + JSON.stringify(pool.candidates));
    if (DRAWN_TAG.test(feed.summary) || DRAWN_TAG.test(readDeliverable(feed.summary))) {
      leaked.push(spelling + ' in a feed field: ' + feed.summary);
    }
  }
  assert.deepEqual(leaked, [], 'an encoded tag opener still yields a tag in the pool: ' + leaked.join(' | '));
});

test('TR-123 ordinary entity text and a literal comparison keep their bytes', async () => {
  const message = 'the server said a &amp; b and a < b (retry later); see &lt; 3';
  for (const [path, notices] of await noticesFromThrownFetch(message)) {
    assert.equal(notices.length, 1, path + ': the failed fetch is reported: ' + notices.join(' | '));
    const notice = notices[0];
    assert.equal(notice.includes('a &amp; b'), true,
      path + ': an ordinary entity was rewritten: ' + notice);
    assert.equal(notice.includes('a < b'), true,
      path + ': a literal comparison was rewritten: ' + notice);
    assert.equal(notice.includes('&lt; 3'), true,
      path + ': a reference that opens no tag was rewritten: ' + notice);
  }
  assert.equal(plainText('a &amp; b and a < b', 400), 'a & b and a < b',
    'the candidate path rewrote ordinary entity text or a comparison');
});
