// tests/collect-github.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGithub, coreBudget, budgetNotice } from '../scripts/collect.mjs';
import { shapeHttpError } from '../scripts/lib/net.mjs';

const PROBE = 'https://api.github.com/rate_limit';
const RESET = 1790177128;
const RESET_ISO = new Date(RESET * 1000).toISOString();
const rows = [{ kind: 'github-repo', target: 'nodejs/node', domain: 'languages-runtimes', note: '' }];
const settings = {
  user_agent: 'tech-radar/1.0', github_releases_per_repo: 10, github_rate_limit_reserve: 2,
  github_org_repos: 10, github_tags_per_repo: 5,
  title_max_chars: 200, summary_max_chars: 400, error_snippet_max_chars: 200,
};

const rateLimit = (remaining, limit = 60, reset = RESET) => JSON.stringify({
  resources: { core: { limit, remaining, reset, used: limit - remaining } },
  rate: { limit, remaining, reset, used: limit - remaining },
});

const ctxWith = (net, overrides = {}) => ({
  since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
  settings: { ...settings, ...overrides }, net,
});

const repoRows = (n) => Array.from({ length: n }, (_, i) => (
  { kind: 'github-repo', target: 'org/repo' + i, domain: 'languages-runtimes' }
));

// Response shapes recorded from the live endpoints on 2026-09-23.
const RELEASES = JSON.stringify([
  { tag_name: 'v24.1.0', html_url: 'https://github.com/nodejs/node/releases/tag/v24.1.0',
    published_at: '2026-09-21T10:00:00Z', draft: false, body: '## Notable changes\n\n- thing one' },
  { tag_name: 'v24.2.0-rc.1', html_url: 'https://github.com/nodejs/node/releases/tag/v24.2.0-rc.1',
    published_at: '2026-09-22T10:00:00Z', draft: true, body: 'draft' },
]);
const ORG_REPOS = JSON.stringify([
  { id: 1, name: 'kubernetes', full_name: 'kubernetes/kubernetes', private: false, fork: false },
  { id: 2, name: 'k8s.io', full_name: 'kubernetes/k8s.io', private: false, fork: false },
]);
const TAGS = JSON.stringify([
  { name: 'v1.38.0-alpha.0', zipball_url: 'https://api.github.com/repos/kubernetes/kubernetes/zipball/refs/tags/v1.38.0-alpha.0',
    tarball_url: 'https://api.github.com/repos/kubernetes/kubernetes/tarball/refs/tags/v1.38.0-alpha.0',
    commit: { sha: '556aa74b7a1d15a5a1745fba1227f7c7d92ba299', url: 'https://api.github.com/repos/kubernetes/kubernetes/commits/556aa74b7a1d15a5a1745fba1227f7c7d92ba299' },
    node_id: 'MDM6UmVmMjA1ODA0OTg6cmVmcy90YWdzL3YxLjM4LjAtYWxwaGEuMA==' },
]);

// The budget belongs to whoever runs the collector, so the anonymous and token cases
// are pinned here rather than inherited from the environment.
async function withCredentials(env, fn) {
  const savedToken = process.env.GITHUB_TOKEN;
  const savedGh = process.env.GH_TOKEN;
  // process.env coerces undefined to the string "undefined", so clear by deletion.
  if (env.GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (env.GH_TOKEN === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = env.GH_TOKEN;
  try {
    return await fn();
  } finally {
    if (savedToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = savedToken;
    if (savedGh === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = savedGh;
  }
}
const anonymous = (fn) => withCredentials({ GITHUB_TOKEN: undefined, GH_TOKEN: undefined }, fn);

test('coreBudget reads the core bucket and turns the reset into an ISO time', () => {
  assert.deepEqual(coreBudget({ resources: { core: { limit: 60, remaining: 7, reset: RESET } } }),
    { remaining: 7, limit: 60, resetAt: RESET_ISO });
  assert.deepEqual(coreBudget({ rate: { limit: 5000, remaining: 4999, reset: RESET } }),
    { remaining: 4999, limit: 5000, resetAt: RESET_ISO });
  assert.equal(coreBudget({}).remaining, null);
});

test('collectGithub maps releases, skips drafts and flattens the body into a bounded summary', () => anonymous(async () => {
  const calls = [];
  const net = {
    fetchText: async (url, _ms, headers) => {
      calls.push(url);
      if (url === PROBE) return rateLimit(55);
      assert.match(url, new RegExp('^https://api\\.github\\.com/repos/nodejs/node/releases\\?per_page='
        + settings.github_releases_per_repo + '$'));
      assert.equal(headers.Accept, 'application/vnd.github+json');
      return RELEASES;
    },
  };
  const { candidates, notices } = await collectGithub(rows, ctxWith(net));
  assert.deepEqual(notices, []);
  assert.equal(calls[0], PROBE, 'the budget is probed once, before any repository call');
  assert.equal(calls.length, 2, 'a repository with a candidate needs no tags request');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, 'nodejs/node v24.1.0');
  assert.equal(candidates[0].publishedAt, '2026-09-21T10:00:00.000Z');
  assert.equal(candidates[0].summary, '## Notable changes - thing one');
  assert.equal(candidates[0].domain, 'languages-runtimes');
}));

test('a repository that tags without publishing releases still contributes', () => anonymous(async () => {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit(55);
      if (url.includes('/releases')) return '[]';
      if (url.includes('/tags')) return TAGS;
      throw new Error('unexpected ' + url);
    },
  };
  const { candidates, notices } = await collectGithub(rows, ctxWith(net));
  assert.deepEqual(notices, [
    'github-tags: 1 undated tag lead carried (the tags API has no date, so they cannot be window-filtered)',
  ], 'the undated lead is counted out loud');
  assert.deepEqual(calls, [
    PROBE,
    'https://api.github.com/repos/nodejs/node/releases?per_page=10',
    'https://api.github.com/repos/nodejs/node/tags?per_page=5',
  ], 'the releases pass runs first, then one tags request for the empty repository');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'github-tag');
  assert.equal(candidates[0].undated, true, 'marked as a lead, not a window match');
  assert.equal(candidates[0].title, 'nodejs/node v1.38.0-alpha.0');
  assert.equal(candidates[0].url, 'https://github.com/nodejs/node/releases/tag/v1.38.0-alpha.0');
  assert.equal(candidates[0].publishedAt, null, 'the tags payload carries no date');
  assert.match(candidates[0].summary, /556aa74b7a1d15a5a1745fba1227f7c7d92ba299/);
}));

test('an organisation is collected through its repositories, never through /orgs/{org}/releases', () => anonymous(async () => {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit(30);
      if (url.includes('/orgs/kubernetes/repos')) return ORG_REPOS;
      if (url.includes('kubernetes/kubernetes/releases')) return RELEASES;
      if (url.includes('kubernetes/k8s.io/releases')) return '[]';
      if (url.includes('kubernetes/k8s.io/tags')) return TAGS;
      throw new Error('unexpected ' + url);
    },
  };
  const { candidates, notices } = await collectGithub(
    [{ kind: 'github-org', target: 'kubernetes', domain: 'infra-cloud' }], ctxWith(net),
  );
  assert.deepEqual(notices, [
    'github-tags: 1 undated tag lead carried (the tags API has no date, so they cannot be window-filtered)',
  ]);
  assert.deepEqual(calls, [
    PROBE,
    'https://api.github.com/orgs/kubernetes/repos?per_page=10&sort=updated',
    'https://api.github.com/repos/kubernetes/kubernetes/releases?per_page=10',
    'https://api.github.com/repos/kubernetes/k8s.io/releases?per_page=10',
    'https://api.github.com/repos/kubernetes/k8s.io/tags?per_page=5',
  ]);
  assert.ok(!calls.some((u) => u.includes('/orgs/kubernetes/releases')), 'that endpoint does not exist');
  assert.deepEqual(candidates.map((c) => c.title), ['kubernetes/kubernetes v24.1.0', 'kubernetes/k8s.io v1.38.0-alpha.0']);
  assert.deepEqual(candidates.map((c) => c.domain), ['infra-cloud', 'infra-cloud']);
}));

test('the budget governs how far the organisation fan-out goes, in the documented order', () => anonymous(async () => {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit(3);
      if (url.includes('/orgs/kubernetes/repos')) return ORG_REPOS;
      if (url.includes('/releases')) return '[]';
      throw new Error('unexpected ' + url);
    },
  };
  const { candidates, notices } = await collectGithub(
    [{ kind: 'github-org', target: 'kubernetes', domain: 'infra-cloud' }], ctxWith(net, { github_rate_limit_reserve: 0 }),
  );
  assert.deepEqual(calls, [
    PROBE,
    'https://api.github.com/orgs/kubernetes/repos?per_page=10&sort=updated',
    'https://api.github.com/repos/kubernetes/kubernetes/releases?per_page=10',
    'https://api.github.com/repos/kubernetes/k8s.io/releases?per_page=10',
  ], 'three requests: the listing and two releases, and no tags request');
  assert.deepEqual(candidates, []);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /remaining 3 of 60/);
  assert.match(notices[0], /2 tag listings not checked/);
}));

test('collectGithub still names the repository when one repository 404s', () => anonymous(async () => {
  const net = {
    fetchText: async (url) => {
      if (url === PROBE) return rateLimit(55);
      throw shapeHttpError(404, Buffer.from('{"message":"Not Found"}'), url, 200);
    },
  };
  const { candidates, notices } = await collectGithub(rows, ctxWith(net));
  assert.deepEqual(candidates, []);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^github nodejs\/node: HTTP 404 for /);
}));

// A 403 whose answer names the rate limit is the server settling the allowance (TR-90), so it
// makes its own notice naming the repository *and* the budget notice that names the effective
// allowance; a 403 that names something else stays a single repository notice (the 404 case
// below covers the same shape).
test('collectGithub turns a per-repository 403 into a notice naming the repository', () => anonymous(async () => {
  const net = {
    fetchText: async (url) => {
      if (url === PROBE) return rateLimit(55);
      throw shapeHttpError(403, Buffer.from('{"message":"API rate limit exceeded."}'), url, 200);
    },
  };
  const { candidates, notices } = await collectGithub(rows, ctxWith(net));
  assert.deepEqual(candidates, []);
  assert.equal(notices.length, 2, 'the repository notice and the budget notice: ' + JSON.stringify(notices));
  assert.match(notices[0], /^github nodejs\/node: HTTP 403 for .*rate limit exceeded/);
  assert.match(notices[1], /^github: rate limit reached /, 'the refusal settles the budget');
}));

// TR-90 regression test: the free /rate_limit probe reports the bucket of the address the run
// leaves from, and on a shared egress it can report a full budget while the charged requests are
// already refused. A run then spent a believed allowance on refusals and, when the rows outlasted
// it, reported the pre-spend figure as the remaining allowance. The refusal is the authoritative
// reading: the block stops spending, and the single budget notice names the effective allowance it
// observed (zero) with what the run could not check.
test('a refusal the probe did not predict stops the block and is named in the budget notice', () => anonymous(async () => {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit(60); // a fresh 60/60 probe, the case production hit
      throw shapeHttpError(403,
        Buffer.from('{"message":"API rate limit exceeded for 203.0.113.9."}'), url, 200);
    },
  };
  const { candidates, notices } = await collectGithub(repoRows(5), ctxWith(net));
  assert.deepEqual(candidates, []);
  assert.deepEqual(calls, [PROBE, 'https://api.github.com/repos/org/repo0/releases?per_page=10'],
    'the first refusal ends the block: no further request is spent');
  const budgets = notices.filter((n) => n.startsWith('github: rate limit reached '));
  assert.equal(budgets.length, 1, 'exactly one budget notice: ' + JSON.stringify(notices));
  const budget = budgets[0];
  assert.match(budget, /remaining 0 of 60/, 'the effective allowance is the observed one: ' + budget);
  assert.doesNotMatch(budget, /remaining 6[0-9]|remaining 5[0-9]/, 'the pre-spend figure is not quoted');
  assert.match(budget, /1 refused as rate limited/, 'the refusal the probe did not predict is named: ' + budget);
  assert.match(budget, /4 repository release listings not checked/, 'what went unchecked is named: ' + budget);
  assert.match(budget, /set GITHUB_TOKEN to raise the limit/);
}));

// The whole-row shortfall case: the refusal is the only loss, so the notice names the refusal
// without an empty unchecked clause (and the run still reports the refusal it observed).
test('a refusal that leaves no unchecked row still names the effective allowance', () => anonymous(async () => {
  const net = {
    fetchText: async (url) => {
      if (url === PROBE) return rateLimit(60);
      throw shapeHttpError(429, Buffer.from('{"message":"API rate limit exceeded."}'), url, 200);
    },
  };
  const { notices } = await collectGithub(rows, ctxWith(net));
  const budget = notices.find((n) => n.startsWith('github: rate limit reached '));
  assert.ok(budget, 'the budget notice is emitted: ' + JSON.stringify(notices));
  assert.match(budget, /remaining 0 of 60/);
  assert.match(budget, /1 refused as rate limited/);
  assert.doesNotMatch(budget, /;\s*;/, 'no empty clause: ' + budget);
  assert.match(budget, /\); set GITHUB_TOKEN to raise the limit$/,
    'the remedy follows the allowance directly: ' + budget);
}));

test('an exhausted budget makes exactly one notice and no repository request', () => anonymous(async () => {
  const calls = [];
  const net = { fetchText: async (url) => { calls.push(url); return rateLimit(0); } };
  const { candidates, notices } = await collectGithub(repoRows(55), ctxWith(net));
  assert.deepEqual(candidates, []);
  assert.deepEqual(calls, [PROBE], 'the block is skipped, so nothing else is requested');
  assert.equal(notices.length, 1);
  assert.equal(notices[0],
    'github: rate limit reached (remaining 0 of 60, resets ' + RESET_ISO + '); '
    + '55 repository release listings not checked; set GITHUB_TOKEN to raise the limit');
}));

test('a budget that covers the rows keeps the normal per-repository path', () => anonymous(async () => {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      return url === PROBE ? rateLimit(10) : '[]';
    },
  };
  const { candidates, notices } = await collectGithub(repoRows(3), ctxWith(net));
  assert.equal(calls.length, 7, 'the probe, one releases request per row, then one tags request per empty row');
  assert.equal(calls[0], PROBE);
  assert.equal(calls.filter((u) => u.includes('/releases')).length, 3);
  assert.equal(calls.filter((u) => u.includes('/tags')).length, 3);
  assert.deepEqual(notices, []);
  assert.deepEqual(candidates, []);
}));

test('a partial budget requests what it covers and notes the rest once', () => anonymous(async () => {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      return url === PROBE ? rateLimit(3) : '[]';
    },
  };
  const { notices } = await collectGithub(repoRows(5), ctxWith(net, { github_rate_limit_reserve: 1 }));
  assert.equal(calls.length, 3, 'the probe plus the two rows the budget covers');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^github: rate limit reached \(remaining 3 of 60, resets /);
  assert.match(notices[0], /3 repository release listings not checked; 2 tag listings not checked/);
  assert.match(notices[0], /set GITHUB_TOKEN to raise the limit/);
}));

test('a probe that fails makes one notice and no repository request', () => anonymous(async () => {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      throw shapeHttpError(403, Buffer.from('{"message":"API rate limit exceeded."}'), url, 200);
    },
  };
  const { candidates, notices } = await collectGithub(repoRows(4), ctxWith(net));
  assert.deepEqual(candidates, []);
  assert.deepEqual(calls, [PROBE], 'there is no fallback to the per-row loop');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^github: rate limit could not be checked \(HTTP 403 for https:\/\/api\.github\.com\/rate_limit: /);
  assert.match(notices[0], /4 repositories not checked$/);
}));

// An organisation row stands for up to github_org_repos repositories, so counting it as one
// "repository not checked" understated what a failed probe left unread.
test('a failed probe counts organisations as organisations, not as repositories', () => withCredentials({ GITHUB_TOKEN: undefined, GH_TOKEN: undefined }, async () => {
  const net = { fetchText: async () => { throw new Error('HTTP 403 for https://api.github.com/rate_limit: rate limit exceeded'); } };
  const mixed = [
    { kind: 'github-repo', target: 'org/one', domain: 'languages-runtimes' },
    { kind: 'github-repo', target: 'org/two', domain: 'languages-runtimes' },
    { kind: 'github-org', target: 'big-org', domain: 'languages-runtimes' },
  ];
  const { notices } = await collectGithub(mixed, ctxWith(net));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /2 repositories not checked/);
  assert.match(notices[0], /1 organisation not listed/);
  assert.doesNotMatch(notices[0], /3 repositories not checked/);
}));

test('an exhausted budget with a token names the token case instead of telling you to set one', () => withCredentials({ GITHUB_TOKEN: 'test-token-not-a-credential', GH_TOKEN: undefined }, async () => {
  const calls = [];
  const net = { fetchText: async (url) => { calls.push(url); return rateLimit(0, 5000); } };
  const { notices } = await collectGithub(rows, ctxWith(net));
  assert.deepEqual(calls, [PROBE]);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /remaining 0 of 5000/);
  assert.match(notices[0], /GITHUB_TOKEN budget is spent as well, so wait for the reset/);
  assert.doesNotMatch(notices[0], /set GITHUB_TOKEN to raise the limit/);
}));


// Regression test: budgetNotice quoted budget.remaining, the value the free probe
// returned BEFORE the block spent anything, so a fully spent run claimed a full allowance:
// a fresh 60/60 budget read "rate limit reached (remaining 60 of 60 ...)" after 59
// requests had been charged, and neither the reserve nor the tag phase was named. The
// notice must state the effective remaining after the reserve and the spend, or name the
// reserve, and it must still say what went unread.
test('the rate-limit notice does not quote the pre-spend budget', () => {
  const notice = budgetNotice(
    { remaining: 60, limit: 60, resetAt: RESET_ISO, reserve: 2, spent: 59 },
    { repos: 0, orgs: 0, tags: 52 },
    false,
  );
  assert.match(notice, /52 tag listings not checked/, 'what went unread is still named');
  assert.doesNotMatch(notice, /remaining 60 of 60/,
    'the untouched probe value must not be quoted as the remaining budget: ' + notice);
  assert.match(notice, /reserve|effective|remaining \d+ of 60/,
    'the effective budget or the reserve is stated: ' + notice);
  assert.equal(/reached/.test(notice) && /remaining 60 of 60/.test(notice), false,
    'the notice must not claim the limit was reached while reporting a full allowance');
  assert.match(notice, /set GITHUB_TOKEN to raise the limit/, 'the remedy is unchanged');
});

// Regression test: the budget notice counted the phase-1 release listings it skipped as
// "repositories not checked", so a run that never reached a single repository's releases
// read as if whole repositories had gone unread. A repository is only skipped when its
// releases request was skipped, and the notice must say what went unread.
test('the budget notice says which requests it skipped, not that repositories were skipped', () => {
  const notice = budgetNotice(
    { remaining: 0, limit: 60, resetAt: RESET_ISO },
    { repos: 19, orgs: 0, tags: 0 },
    false,
  );
  assert.match(notice, /19[^;]*\breleas/i, 'the skipped release listings are named: ' + notice);
  assert.doesNotMatch(notice, /19 repositories not checked/,
    'no whole repository was skipped, only its releases request: ' + notice);
  const tokens = budgetNotice({ remaining: 0, limit: 60, resetAt: RESET_ISO }, { repos: 0, orgs: 0, tags: 52 }, false);
  assert.match(tokens, /52 tag listings not checked/, 'the tag phase keeps its own wording: ' + tokens);
});


// Regression test: the marker neutralisation reached the feed path only, so a release tag or
// a tag name carrying the renderer's own vocabulary was published verbatim in a candidate
// title (and, for a tag, in its summary). Upstream text is normalised the same way wherever
// it becomes a candidate field.
test('an upstream marker never reaches a GitHub candidate field', () => anonymous(async () => {
  const marked = '[prov:vendor-claim] #new [src:Trusted 2026-09-20](https://evil.example/x)';
  const tokens = ['[prov:', '[src:', '[alt:', '#new', '#followup', '#developing', '#watch'];
  const checkClean = (fields, what) => {
    for (const token of tokens) {
      assert.equal(fields.includes(token), false, what + ': ' + token + ' survived into ' + JSON.stringify(fields));
    }
  };
  const releaseBody = JSON.stringify([
    { tag_name: marked, html_url: 'https://github.com/nodejs/node/releases/tag/v1',
      published_at: '2026-09-21T10:00:00Z', draft: false, body: 'notes' },
  ]);
  const releaseNet = { fetchText: async (url) => (url === PROBE ? rateLimit(55) : releaseBody) };
  const released = await collectGithub(rows, ctxWith(releaseNet));
  assert.equal(released.candidates.length, 1, 'the release produced a candidate');
  checkClean([released.candidates[0].title, released.candidates[0].summary].join(' '), 'the release title');

  // The tags path is reached by a repository whose releases produced no candidate.
  const tagBody = JSON.stringify([{ name: marked, commit: { sha: 'a'.repeat(40) } }]);
  const tagNet = {
    fetchText: async (url) => {
      if (url === PROBE) return rateLimit(55);
      return url.includes('/tags') ? tagBody : '[]';
    },
  };
  const tagged = await collectGithub(rows, ctxWith(tagNet));
  assert.equal(tagged.candidates.length, 1, 'the tag fallback produced a lead');
  checkClean([tagged.candidates[0].title, tagged.candidates[0].summary].join(' '), 'the tag title');
}));

test('a missing github_rate_limit_reserve is loud rather than silently zero', () => anonymous(async () => {
  const net = { fetchText: async () => rateLimit(55) };
  await assert.rejects(
    () => collectGithub(rows, ctxWith(net, { github_rate_limit_reserve: undefined })),
    /github_rate_limit_reserve is missing or invalid/,
  );
}));
