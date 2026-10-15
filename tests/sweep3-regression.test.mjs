// tests/sweep3-regression.test.mjs
// Independent regression tests for TR-115..TR-119, the five redaction and notice regressions
// the third adversarial sweep recorded against fdfb7ea. Each case pins both directions of its
// rule: what must still be protected, and what must not be damaged. The cases drive the seams
// the sweep named - requestSecretSets/requestSecrets/redactSecrets, the collector's candidate
// pass, and the two notice sites that interpolate an upstream value - not a private helper, so
// a fix that only moves the symptom does not satisfy them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAdvisories, collectAll, collectRegistries } from '../scripts/collect.mjs';
import { redactSecrets, requestSecrets, requestSecretSets, shapeHttpError } from '../scripts/lib/net.mjs';

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
    noLiveTag(advisories.notices[0]);
    const registries = await collectRegistries(NPM_ROW, registryContext(tag));
    assert.equal(registries.notices.length, 1,
      'the skipped version is reported: ' + registries.notices.join(' | '));
    assert.equal(registries.notices[0].includes(tag), false,
      'a registry version reached the notice verbatim: ' + registries.notices[0]);
    noLiveTag(registries.notices[0]);
  }
});

test('TR-119 a legitimate upstream message still reads in the notice', async () => {
  const advisories = await collectAdvisories(NVD_ROW, advisoryContext('not-a-cve-id'));
  assert.equal(advisories.notices.length, 1);
  assert.match(advisories.notices[0], /skipped an advisory whose identifier is not a CVE id/,
    'the notice keeps its own wording: ' + advisories.notices[0]);
  assert.match(advisories.notices[0], /not-a-cve-id/,
    'the rejected identifier stays legible: ' + advisories.notices[0]);
  const registries = await collectRegistries(NPM_ROW, registryContext('1.2.3'));
  assert.equal(registries.notices.length, 1);
  assert.match(registries.notices[0], /no release time for 1\.2\.3; candidate skipped/,
    'a legitimate version still reads in the notice: ' + registries.notices[0]);
});
