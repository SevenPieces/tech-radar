// tests/rd24-kv5-count-phrases.test.mjs
// KV-5 (TR-172): a notice that names a count names it in the number the count takes. The
// page-filled report and the arXiv cap report both hard-coded a plural, so a page of one entry
// and a cap of one entry were published as '1 repositories' and '1 entries'. The sibling phrases
// in the same module already singularise (the tag leads, the skipped listing names, the
// organisations, the tag listings), and these cases keep the two that did not from drifting back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectArxiv, collectGithub } from '../scripts/collect.mjs';

const PROBE = 'https://api.github.com/rate_limit';
const rateLimit = () => JSON.stringify({
  resources: { core: { limit: 5000, remaining: 5000, reset: 1790177128, used: 0 } },
});
const oneRepo = JSON.stringify([{
  id: 1, name: 'a', full_name: 'acme/a', updated_at: '2026-09-20T00:00:00Z',
}]);
const githubSettings = {
  user_agent: 'tech-radar/1.0', github_releases_per_repo: 10, github_rate_limit_reserve: 2,
  github_org_repos: 1, github_tags_per_repo: 5,
  title_max_chars: 200, summary_max_chars: 400, error_snippet_max_chars: 200,
};

const FEED_ONE = [
  '<feed><entry><title>Only one</title>',
  '<link rel="alternate" href="http://arxiv.org/abs/2609.00001v1"/>',
  '<published>2026-09-20T01:00:00Z</published>',
  '<summary>one entry</summary></entry></feed>',
].join('');

test('KV-5 a filled page of one repository is reported in the singular', async () => {
  const net = {
    fetchText: async (url) => {
      if (url === PROBE) return rateLimit();
      return url.includes('/orgs/') ? oneRepo : '[]';
    },
  };
  const { notices } = await collectGithub([{ kind: 'github-org', target: 'acme', domain: 'ai-llm' }], {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
    settings: githubSettings, net,
  });
  const said = notices.filter((n) => n.includes('listing page filled'));
  assert.equal(said.length, 1, 'the one-entry page said nothing: ' + JSON.stringify(notices));
  assert.match(said[0], /listing page filled at 1 repository;/, JSON.stringify(said[0]));
  assert.ok(!said[0].includes('1 repositories'), 'the one-entry page was reported in the plural');
});

test('KV-5 an arXiv listing capped at one entry is reported in the singular', async () => {
  const { notices } = await collectArxiv([{ kind: 'arxiv-category', target: 'cs.CV', domain: 'd' }], {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
    settings: { user_agent: 'tech-radar/1.0', arxiv_max_results: 1, title_max_chars: 200,
      summary_max_chars: 400, error_snippet_max_chars: 200 },
    net: { fetchText: async () => FEED_ONE },
  });
  assert.equal(notices.length, 1, 'the capped listing said nothing: ' + JSON.stringify(notices));
  assert.match(notices[0], /listing capped at 1 entry;/, JSON.stringify(notices[0]));
  assert.ok(!notices[0].includes('1 entries'), 'a one-entry cap was reported in the plural');
});

test('KV-5 the plural is kept where the count is a plural', async () => {
  const net = {
    fetchText: async (url) => {
      if (url === PROBE) return rateLimit();
      return url.includes('/orgs/') ? JSON.stringify([
        { id: 1, name: 'a', full_name: 'acme/a', updated_at: '2026-09-20T00:00:00Z' },
        { id: 2, name: 'b', full_name: 'acme/b', updated_at: '2026-09-19T00:00:00Z' },
      ]) : '[]';
    },
  };
  const { notices } = await collectGithub([{ kind: 'github-org', target: 'acme', domain: 'ai-llm' }], {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', timeout: 5000,
    settings: { ...githubSettings, github_org_repos: 2 }, net,
  });
  const said = notices.filter((n) => n.includes('listing page filled'));
  assert.equal(said.length, 1, 'the two-entry page said nothing: ' + JSON.stringify(notices));
  assert.match(said[0], /listing page filled at 2 repositories;/, JSON.stringify(said[0]));
});
