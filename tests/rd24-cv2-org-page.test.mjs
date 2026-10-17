// tests/rd24-cv2-org-page.test.mjs
// CV-2 (TR-170): github_org_repos above GitHub's per_page ceiling. GitHub clamps per_page at 100
// without an error, so a legal setting of 101 or 500 is answered with a 100-entry page; the
// page-filled report has to compare against the page GitHub enforces, or the silent loss the
// report exists for is back. Every case here runs offline against a stub that clamps the way
// GitHub does, and the control pins that a short answer still stays silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGithub } from '../scripts/collect.mjs';

const PROBE = 'https://api.github.com/rate_limit';
const CEILING = 100;
const rateLimit = () => JSON.stringify({
  resources: { core: { limit: 5000, remaining: 5000, reset: 1790177128, used: 0 } },
});
const page = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({
  id: i, name: 'repo' + i, full_name: 'org/repo' + i, updated_at: '2026-09-20T00:00:00Z',
})));
const settings = {
  user_agent: 'tech-radar/1.0', github_releases_per_repo: 10, github_rate_limit_reserve: 2,
  github_org_repos: 10, github_tags_per_repo: 5,
  title_max_chars: 200, summary_max_chars: 400, error_snippet_max_chars: 200,
};

// The stub answers the way GitHub does: the listing page is what the request asked for, clamped
// at the ceiling, and every other request is an empty answer. answer(perPage) may instead hand
// back a shorter page than was asked for, which is the control's case.
function stub(answer) {
  const calls = [];
  return {
    calls,
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit();
      const m = /[?&]per_page=(\d+)/.exec(url);
      const asked = m === null ? 0 : Number(m[1]);
      if (url.includes('/orgs/')) return answer(asked);
      return '[]';
    },
  };
}

async function orgRun(perOrg, answer) {
  const net = stub(answer);
  const res = await collectGithub([{ kind: 'github-org', target: 'acme', domain: 'ai-llm' }], {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
    settings: { ...settings, github_org_repos: perOrg }, net,
  });
  return { net, notices: res.notices };
}

const filled = (notices) => notices.filter((n) => n.includes('listing page filled'));

for (const perOrg of [10, CEILING, 101, 500]) {
  test('CV-2 a listing that fills the enforced page reports it at github_org_repos ' + perOrg, async () => {
    const { net, notices } = await orgRun(perOrg, (asked) => page(Math.min(asked, CEILING)));
    const said = filled(notices);
    assert.equal(said.length, 1,
      'the answer filled the page GitHub served and the run said nothing: ' + JSON.stringify(notices));
    assert.match(said[0], new RegExp('listing page filled at ' + Math.min(perOrg, CEILING) + ' repositories;'),
      'the page-filled notice does not name the page GitHub actually served: ' + JSON.stringify(said[0]));
    // The fix must not change what is asked for: the request still carries the configured value,
    // and GitHub's own clamp is what turns it into a 100-entry page.
    assert.ok(net.calls.some((url) => url.includes('per_page=' + perOrg)),
      'the listing request no longer carries the configured per_page: ' + JSON.stringify(net.calls[0]));
  });
}

test('CV-2 a short answer below the enforced page stays silent', async () => {
  const { notices } = await orgRun(10, () => page(4));
  assert.deepEqual(filled(notices), [],
    'a listing that answered short was reported as a filled page: ' + JSON.stringify(notices));
});
