// tests/collect-registries.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRegistries, collectAdvisories, nvdStamp } from '../scripts/collect.mjs';

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
