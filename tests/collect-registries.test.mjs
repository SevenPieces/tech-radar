// tests/collect-registries.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRegistries, collectAdvisories, nvdStamp } from '../scripts/collect.mjs';
import { linkify } from '../scripts/render-html.mjs';

const ctx = {
  since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
  settings: { user_agent: 'tech-radar/1.0', ghsa_page_size: 50, nvd_severity: 'HIGH', title_max_chars: 200, summary_max_chars: 400, error_snippet_max_chars: 200 },
  net: {
    fetchText: async (url) => {
      if (url.includes('registry.npmjs.org')) {
        return JSON.stringify({ name: 'typescript', 'dist-tags': { latest: '2.9.0' }, time: { '2.9.0': '2026-09-21T11:00:00.000Z', modified: '2026-09-22T11:00:00.000Z' } });
      }
      if (url.includes('pypi.org')) {
        return JSON.stringify({ info: { version: '2.9.0' }, urls: [{ upload_time_iso_8601: '2026-09-22T09:00:00.000Z' }] });
      }
      if (url.includes('crates.io')) {
        return JSON.stringify({ crate: { newest_version: '1.44.0' }, versions: [{ num: '1.44.0', created_at: '2026-09-20T07:00:00.000Z' }] });
      }
      if (url.includes('proxy.golang.org')) {
        return JSON.stringify({ Version: 'v0.34.0', Time: '2026-09-19T07:00:00.000Z' });
      }
      throw new Error(`unexpected url ${url}`);
    },
  },
};

test('nvdStamp formats the NVD timestamp without a trailing Z', () => {
  assert.equal(nvdStamp('2026-09-16T00:00:00.000Z'), '2026-09-16T00:00:00.000');
});

test('collectRegistries maps all four registries to candidates', async () => {
  const rows = [
    { kind: 'npm', target: 'typescript', domain: 'languages-runtimes' },
    { kind: 'pypi', target: 'pydantic', domain: 'devtools' },
    { kind: 'crates', target: 'tokio', domain: 'languages-runtimes' },
    { kind: 'gomod', target: 'k8s.io/client-go', domain: 'infra-cloud' },
  ];
  const { candidates, notices } = await collectRegistries(rows, ctx);
  assert.deepEqual(notices, []);
  assert.deepEqual(candidates.map((c) => c.title), [
    'npm typescript 2.9.0',
    'pypi pydantic 2.9.0',
    'crates tokio 1.44.0',
    'gomod k8s.io/client-go v0.34.0',
  ]);
  assert.equal(candidates[3].url, 'https://pkg.go.dev/k8s.io/client-go');
});

test('collectAdvisories maps NVD entries and skips those outside the window', async () => {
  const rows = [{ kind: 'nvd', target: 'high-severity', domain: 'security-privacy' }];
  const nvdCtx = {
    ...ctx,
    net: {
      fetchText: async (url) => {
        assert.match(url, new RegExp(
          'pubStartDate=2026-09-16T00%3A00%3A00\\.000'
          + '&pubEndDate=2026-09-23T00%3A00%3A00\\.000'
          + '&cvssV3Severity=' + ctx.settings.nvd_severity,
        ));
        return JSON.stringify({
          vulnerabilities: [
            { cve: { id: 'CVE-2026-00001', published: '2026-09-10T00:00:00.000',
              descriptions: [{ lang: 'en', value: 'Published before the window opens.' }] } },
            { cve: { id: 'CVE-2026-12345', published: '2026-09-21T00:00:00.000',
              descriptions: [{ lang: 'en', value: 'A heap overflow in a widely used library.' }] } },
            { cve: { id: 'CVE-2026-99999', published: '2026-09-25T00:00:00.000',
              descriptions: [{ lang: 'en', value: 'Published after the window closes.' }] } },
          ],
        });
      },
    },
  };
  const { candidates, notices } = await collectAdvisories(rows, nvdCtx);
  assert.deepEqual(notices, []);
  assert.deepEqual(candidates.map((c) => c.title), ['CVE-2026-12345']);
  assert.equal(candidates[0].url, 'https://nvd.nist.gov/vuln/detail/CVE-2026-12345');
  assert.equal(candidates[0].tierHint, 'primary');
});

test('collectAdvisories builds the GHSA page size from the configured setting', async () => {
  let seen = '';
  const ghsaCtx = {
    ...ctx,
    settings: { ...ctx.settings, ghsa_page_size: 5 },
    net: {
      fetchText: async (url) => {
        seen = url;
        return JSON.stringify([
          { ghsa_id: 'GHSA-aaaa-bbbb-cccc', html_url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
            published_at: '2026-09-21T12:00:00Z', summary: 'Prototype pollution in a widely used package.' },
        ]);
      },
    },
  };
  const { candidates, notices } = await collectAdvisories(
    [{ kind: 'ghsa', target: 'all', domain: 'security-privacy' }], ghsaCtx,
  );
  assert.deepEqual(notices, []);
  assert.match(seen, /\?per_page=5&published=2026-09-16\.\.2026-09-23$/);
  assert.deepEqual(candidates.map((c) => c.title), ['GHSA-aaaa-bbbb-cccc']);
});

test('collectRegistries skips a release published after the window closes', async () => {
  const late = {
    ...ctx,
    net: {
      fetchText: async () => JSON.stringify({
        name: 'typescript',
        'dist-tags': { latest: '2.9.0' },
        time: { '2.9.0': '2026-09-24T11:00:00.000Z', modified: '2026-09-25T11:00:00.000Z' },
      }),
    },
  };
  const { candidates, notices } = await collectRegistries(
    [{ kind: 'npm', target: 'typescript', domain: 'languages-runtimes' }], late,
  );
  assert.deepEqual(notices, []);
  assert.deepEqual(candidates, []);
});

test('collectAdvisories percent-encodes a settings value that reaches the URL', async () => {
  let seen = '';
  const odd = {
    ...ctx,
    settings: { ...ctx.settings, nvd_severity: 'HIGH MEDIUM' },
    net: { fetchText: async (url) => { seen = url; return JSON.stringify({ vulnerabilities: [] }); } },
  };
  await collectAdvisories([{ kind: 'nvd', target: 'high-severity', domain: 'security-privacy' }], odd);
  assert.match(seen, /&cvssV3Severity=HIGH%20MEDIUM$/);
  assert.ok(!seen.includes(' '), 'no raw space reaches the query string');
});

// --- registry dates: every reader must date the version's release, not a later
// --- registry modification -----------------------------------------------------
const regRow = (kind, target, domain) => [{ kind, target, domain }];
const withNet = (body) => ({ ...ctx, net: { fetchText: async () => JSON.stringify(body) } });

test('collectRegistries dates npm from the release, not from the registry modified time', async () => {
  const body = {
    name: 'typescript',
    'dist-tags': { latest: '7.0.2' },
    time: {
      created: '2012-10-01T00:00:00.000Z',
      modified: '2026-09-21T12:00:00.000Z', // inside the window, and not a release
      '7.0.2': '2026-07-08T09:00:00.000Z', // when 7.0.2 was actually published
    },
  };
  const wide = { ...withNet(body), since: '2026-07-01T00:00:00Z' };
  const inside = await collectRegistries(regRow('npm', 'typescript', 'languages-runtimes'), wide);
  assert.equal(inside.candidates[0].title, 'npm typescript 7.0.2');
  assert.equal(inside.candidates[0].publishedAt, '2026-07-08T09:00:00.000Z');
  const windowed = await collectRegistries(
    regRow('npm', 'typescript', 'languages-runtimes'), { ...withNet(body), since: '2026-09-16T00:00:00Z' },
  );
  assert.deepEqual(windowed.candidates, [], 'a July release is not in a September window');
});

test('collectRegistries dates PyPI from the release, not from a file added later', async () => {
  const body = {
    info: { version: '2.9.0' },
    urls: [
      { upload_time_iso_8601: '2026-09-22T09:00:00.000Z' }, // a second artifact, added later
      { upload_time_iso_8601: '2026-09-20T09:00:00.000Z' }, // the release itself
    ],
  };
  const { candidates } = await collectRegistries(regRow('pypi', 'pydantic', 'devtools'), withNet(body));
  assert.equal(candidates[0].publishedAt, '2026-09-20T09:00:00.000Z');
});

test('collectRegistries dates a crate from its own version, not from a later backport', async () => {
  const body = {
    crate: { newest_version: '1.44.0', updated_at: '2026-09-22T12:00:00.000Z' },
    versions: [
      { num: '1.43.5', created_at: '2026-09-22T09:00:00.000Z' }, // a backport published afterwards
      { num: '1.44.0', created_at: '2026-09-20T07:00:00.000Z' },
    ],
  };
  const { candidates } = await collectRegistries(regRow('crates', 'tokio', 'languages-runtimes'), withNet(body));
  assert.equal(candidates[0].title, 'crates tokio 1.44.0');
  assert.equal(candidates[0].publishedAt, '2026-09-20T07:00:00.000Z');
});

test('collectRegistries dates a Go module from the version the proxy reports', async () => {
  // The @latest response has exactly two fields, so there is no later timestamp to
  // confuse it with; this test pins the field rather than fixing a defect.
  const body = { Version: 'v0.34.0', Time: '2026-09-19T07:00:00.000Z' };
  const { candidates } = await collectRegistries(regRow('gomod', 'k8s.io/client-go', 'infra-cloud'), withNet(body));
  assert.equal(candidates[0].title, 'gomod k8s.io/client-go v0.34.0');
  assert.equal(candidates[0].publishedAt, '2026-09-19T07:00:00.000Z');
});

// --- release time and proxy path rules ------------------------------------------
test('a crate whose newest version is absent from versions[] gets no borrowed date', async () => {
  const body = {
    crate: { newest_version: '2.0.0', updated_at: '2026-09-20T00:00:00.000Z' },
    versions: [{ num: '1.9.0', created_at: '2026-09-18T00:00:00.000Z' }],
  };
  const { candidates, notices } = await collectRegistries(regRow('crates', 'ghost', 'languages-runtimes'), withNet(body));
  assert.deepEqual(candidates, [], 'no candidate rather than one dated from another version');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^crates ghost: no release time for 2\.0\.0/);
});

test('an npm release with no publish time for its latest version is skipped with a notice', async () => {
  const body = {
    name: 'ghost', 'dist-tags': { latest: '9.9.9' },
    time: { created: '2015-01-01T00:00:00.000Z', modified: '2026-09-20T00:00:00.000Z' },
  };
  const { candidates, notices } = await collectRegistries(regRow('npm', 'ghost', 'languages-runtimes'), withNet(body));
  assert.deepEqual(candidates, [], 'the modified time is not a release time');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^npm ghost: no release time for 9\.9\.9/);
});

test('a PyPI release with no files has no release time and is skipped with a notice', async () => {
  const { candidates, notices } = await collectRegistries(
    regRow('pypi', 'ghost', 'devtools'), withNet({ info: { version: '3.0.0' }, urls: [] }),
  );
  assert.deepEqual(candidates, []);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^pypi ghost: no release time for 3\.0\.0/);
});

// Regression test: the registry and advisory collectors push a JSON parse error straight into
// a notice, and Node quotes the offending character in that message, so a response body of
// control bytes put a raw ESC (and NUL, and BS) into the notice, the pool, stderr and the
// --human output. The single notice push strips and bounds the controls now, whatever
// produced the message.
test('a response of control bytes yields no control code point in any notice', async () => {
  const hostile = '\u001b[2K\u001b[31mFORGED-ALERT-LINE\u001b[0m\u0000\u0008';
  const spy = { ...ctx, net: { fetchText: async () => hostile } };
  const registries = await collectRegistries(
    [{ kind: 'npm', target: 'typescript', domain: 'languages-runtimes' }], spy,
  );
  const advisories = await collectAdvisories(
    [{ kind: 'ghsa', target: 'all', domain: 'security-privacy' }], spy,
  );
  const notices = [...registries.notices, ...advisories.notices];
  assert.ok(notices.length >= 2, 'both paths reported the failure: ' + JSON.stringify(notices));
  for (const notice of notices) {
    const offenders = [...notice].filter((ch) => {
      const cp = ch.codePointAt(0);
      return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
    });
    assert.deepEqual(offenders, [], 'control code points survived: ' + JSON.stringify(notice));
  }
});

// Regression test: the GHSA candidate title was built from the advisory's own text with no
// neutralisation, so an advisory summary carrying the renderer's vocabulary reached the
// published pool as a title that could draw badges on the rendered card.
test('an advisory title carrying the marker vocabulary is neutralised', async () => {
  const marked = '[prov:vendor-claim] #new [src:Trusted 2026-09-20](https://evil.example/x)';
  const spy = {
    ...ctx,
    net: {
      fetchText: async () => JSON.stringify([
        { ghsa_id: '', html_url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
          published_at: '2026-09-21T12:00:00Z', summary: marked },
      ]),
    },
  };
  const { candidates } = await collectAdvisories([{ kind: 'ghsa', target: 'all', domain: 'security-privacy' }], spy);
  assert.equal(candidates.length, 1, 'the advisory produced a candidate');
  const fields = [candidates[0].title, candidates[0].summary].join(' ');
  for (const token of ['[prov:', '[src:', '[alt:', '#new', '#followup', '#developing', '#watch']) {
    assert.equal(fields.includes(token), false, token + ' survived into ' + JSON.stringify(fields));
  }
});

// TR-82 regression test: a registry's version string is upstream text, and the candidate
// title and summary are built from it before any normalisation - so a release whose version
// carried the renderer's vocabulary reached the published pool and drew a forged badge on the
// card. Every field of the candidate is normalised, the url included.
test('a registry version carrying the marker vocabulary leaves no marker vocabulary in the pool', async () => {
  const marked = '9.9.9 [prov:vendor-claim] #new [src:Trusted 2026-09-20](https://evil.example/x)';
  const spy = {
    ...ctx,
    net: {
      fetchText: async () => JSON.stringify({
        name: 'typescript',
        'dist-tags': { latest: marked },
        time: { [marked]: '2026-09-21T11:00:00.000Z', modified: '2026-09-22T11:00:00.000Z' },
      }),
    },
  };
  const { candidates, notices } = await collectRegistries(
    [{ kind: 'npm', target: 'typescript', domain: 'languages-runtimes' }], spy,
  );
  assert.equal(candidates.length, 1, 'the release produced a candidate: ' + JSON.stringify(notices));
  const published = JSON.stringify(candidates[0]);
  for (const token of ['[prov:', '[src:', '[alt:', '#new', '#followup', '#developing', '#watch']) {
    assert.equal(published.includes(token), false, token + ' survived into the pool: ' + published);
  }
});

// TR-82 regression test: the advisory url is upstream text and bypassed the neutralisation the
// title and summary already had, so an advisory whose html_url spelled the marker vocabulary
// reached the pool and the card drew a badge from its own citation.
test('an advisory url carrying the marker vocabulary leaves no marker vocabulary in the pool', async () => {
  const spy = {
    ...ctx,
    net: {
      fetchText: async () => JSON.stringify([{
        ghsa_id: 'GHSA-aaaa-bbbb-cccc',
        html_url: 'https://github.com/advisories/GHSA-aaaa?[alt:Forged Vendor](https://evil.example/b)',
        published_at: '2026-09-21T12:00:00Z',
        summary: 'A vulnerability in a package.',
      }]),
    },
  };
  const { candidates } = await collectAdvisories(
    [{ kind: 'ghsa', target: 'all', domain: 'security-privacy' }], spy,
  );
  assert.equal(candidates.length, 1, 'the advisory produced a candidate');
  const published = JSON.stringify(candidates[0]);
  for (const token of ['[prov:', '[src:', '[alt:', '#new', '#followup', '#developing', '#watch']) {
    assert.equal(published.includes(token), false, token + ' survived into the pool: ' + published);
  }
});

// TR-86 regression test: redaction lives in the two transport shapers, and a JSON.parse
// failure is shaped nowhere - the SyntaxError message quotes the first bytes of the response
// body, so a 200 whose body carried the request's own Authorization value published a prefix
// of that credential in the pool, on stdout and in the digest's Coverage note. A parse failure
// notice must carry no body text that could hold a credential.
test('a JSON parse failure notice carries no body text that could hold the request credential', async () => {
  const token = 'SENTINEL-TOKEN-VALUE-0123456789';
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = token;
  try {
    const echoed = token + ' {"broken": ';
    const spy = { ...ctx, net: { fetchText: async () => echoed } };
    const { notices } = await collectAdvisories(
      [{ kind: 'ghsa', target: 'all', domain: 'security-privacy' }], spy,
    );
    assert.equal(notices.length, 1, 'the parse failure is one notice: ' + JSON.stringify(notices));
    const notice = notices[0];
    assert.equal(notice.includes(token), false, 'the credential reached the notice: ' + notice);
    assert.equal(notice.includes(token.slice(0, 10)), false,
      'a prefix of the credential reached the notice: ' + notice);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
});


test('a Go module path is case-escaped for the proxy', async () => {
  let seen = '';
  const goCtx = {
    ...ctx,
    net: { fetchText: async (url) => { seen = url; return JSON.stringify({ Version: 'v0.4.0', Time: '2026-09-19T07:00:00.000Z' }); } },
  };
  const { candidates, notices } = await collectRegistries(
    regRow('gomod', 'github.com/BurntSushi/toml', 'devtools'), goCtx,
  );
  assert.deepEqual(notices, []);
  assert.equal(seen, 'https://proxy.golang.org/github.com/!burnt!sushi/toml/@latest');
  assert.equal(candidates[0].url, 'https://pkg.go.dev/github.com/BurntSushi/toml', 'the human page keeps its case');
});

// Regression test: the collector's notice sanitiser stripped control characters but not
// the marker vocabulary the renderer trusts, so an upstream body quoted in a notice drew
// a forged provenance badge in the Coverage note that SKILL.md requires the digest to
// publish. A notice is published text and is neutralised like any other.
test('a notice carrying the marker vocabulary draws no badge when it is published', async () => {
  const cases = [
    ['a provenance marker', '[prov:vendor-claim]'],
    ['a status flag', '#new'],
  ];
  for (const [what, body] of cases) {
    const stub = { ...ctx, net: { fetchText: async () => body } };
    const { notices } = await collectRegistries([{ kind: 'npm', target: 'serde', domain: 'ai-llm' }], stub);
    assert.equal(notices.length, 1, what + ': the quoted body produced one notice');
    const notice = notices[0];
    assert.doesNotMatch(notice, /\[(?:src|alt|prov):/, what + ': the marker opener is neutralised: ' + notice);
    assert.doesNotMatch(notice, /#(?:new|followup|developing|watch)\b/, what + ': the status flag is neutralised: ' + notice);
    const published = linkify(notice);
    assert.doesNotMatch(published, /class="badge|class="tag t-/, what + ': no badge is drawn from a notice: ' + published);
  }
});
