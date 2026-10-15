// tests/config.test.mjs
// Regression guard over the four real configuration tables in config/.
// Every table is read through scripts/lib/mdtable.mjs -- the same reader the
// scripts use -- so a table the reader cannot parse fails here too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, readDomains, readSettings } from '../scripts/lib/mdtable.mjs';
import { SKILL_ROOT, WORKING_NAMES, shippedFiles } from './lib/shipped-files.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const FILES = ['domains.md', 'settings.md', 'sources.md', 'watchlist.md'];
const FENCE_MARK = String.fromCharCode(96).repeat(3); // three backticks

const KINDS = ['github-repo', 'github-org', 'arxiv-category', 'npm', 'pypi', 'crates', 'gomod', 'ghsa', 'nvd', 'rss'];
const LANGS = ['en', 'zh'];
const TIERS = ['primary', 'secondary', 'discovery'];
const SETTINGS_KEYS = [
  'timezone', 'window_cap_weeks', 'first_run_days', 'watchlist_retention_weeks',
  'core_max_items', 'watch_max_items', 'watch_notable_max', 'total_min_items',
  'total_max_items', 'fanout_min_passes', 'fanout_max_passes', 'deep_dive',
  'output_dir', 'github_releases_per_repo', 'github_anonymous_hourly_limit',
  'github_rate_limit_reserve',
  'github_org_repos', 'github_tags_per_repo', 'arxiv_max_results', 'ghsa_page_size',
  'nvd_severity', 'request_timeout_ms', 'title_max_chars', 'summary_max_chars',
  'error_snippet_max_chars', 'discovery_hosts', 'user_agent', 'runs_history_max',
];

const config = readConfig(CONFIG_DIR);

// The chip label is the only place a domain name is shortened, so it is validated
// here: present, a couple of words, attribute-safe, and distinct enough to tell two
// chips apart at a glance.
// The column drives the navigation chips, so its rules are configuration rules and the
// reader enforces them: a chip is a shortcut, must be attribute-safe, and two chips reading
// the same word are ambiguous. An absent column stays legal - the renderer falls back.
test('the catalogue reader rejects a short label that breaks a chip rule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-catalogue-'));
  const write = (shortCell) => {
    const p = join(dir, 'domains.md');
    writeFileSync(p, [
      '# Domain catalogue',
      '',
      '| key | domain | short | label_zh | cluster | tier | why |',
      '|---|---|---|---|---|---|---|',
      `| ai-llm | AI / LLM | ${shortCell} | 人工智能 / 大模型 | AI and compute | core | models |`,
      '| quantum | Quantum technologies | Quantum | 量子技术 | AI and compute | watch | quantum |',
      '',
    ].join('\n'));
    return p;
  };
  assert.equal(readDomains(write('AI / LLM')).length, 2, 'a good column reads');
  assert.equal(readDomains(write('')).length, 2, 'an empty cell falls back, it is not an error');
  assert.throws(() => readDomains(write('a very long chip label here')), /short label too long for ai-llm/);
  assert.throws(() => readDomains(write('a" onmouseover="x')), /short label must be attribute-safe for ai-llm/);
  assert.throws(() => readDomains(write('Quantum')), /duplicate short label "quantum" for quantum and ai-llm/);
});

// The design document quoted a watchlist size the file had long outgrown (30-50 GitHub rows against
// 55, 8-10 arXiv categories against 17, 15-20 packages against 12) and a catalogue column list without
// 'short'. It is the spec; a number it states must be the number the file carries.
// Two classes of defect this delta pass found by hand, now guarded. First, a spec that
// describes an older gate than the one that ships: every rule the gate can fail or warn on
// must appear somewhere in the design's gate section, so a rule cannot be added in code and
// forgotten in the document. The list is deliberately explicit - adding a gate rule means
// extending it, which is the reminder.
test('every gate rule and warning appears in the design document', () => {
  const design = readFileSync(join(CONFIG_DIR, '..', 'docs', 'design.md'), 'utf8');
  const rules = [
    [/lacks a URL or a published date/, 'the citation and date rule'],
    [/lacks exactly one provenance marker/, 'the provenance rule'],
    [/exactly one of .#new. or .#followup/, 'the status flag rule'],
    [/discovery-only host/, 'the discovery-host rule'],
    [/`core_max_items`/, 'the ceilings'],
    [/completeness floor/, 'the floor'],
    [/core domain is absent as a section heading/, 'the core heading rule'],
    [/two items share a story key/, 'the duplicate rule'],
    [/missing its bilingual/, 'the bilingual rule'],
    [/names a catalogue \*\*key\*\*/, 'the catalogue-key rule'],
    [/window label verbatim/, 'the coverage-note label rule'],
    [/quiet line omits a watch domain/, 'the quiet-line rule'],
    [/external asset/, 'the self-containment rule'],
    [/stand-in line/, 'the deep-dive stand-in rule'],
    [/Collector notices/, 'the pool notice contract'],
    [/It warns, without failing/, 'the warning sentence'],
    [/looks like an item/, 'the malformed-bullet warning'],
    [/deep_dive` is `never`/, 'the unused-featured warning'],
  ];
  const missing = rules.filter(([re]) => !re.test(design)).map(([, name]) => name);
  assert.deepEqual(missing, [], 'gate rules the design does not state: ' + missing.join(', '));
});

// Second: with docs/design.md the only file under docs/ that ships, no shipped file may
// point at one of the working documents. This is what caught README's directory listing and
// a SKILL.md line naming the baseline file.
test('no shipped file refers to a working document under docs/', () => {
  // The names and the shipping set come from tests/lib/shipped-files.mjs, built from
  // fragments there, so this guard never spells out a name it forbids and scans exactly
  // what the reader receives -- tests/ and scripts/lib/ included, repository metadata not.
  const offenders = [];
  for (const rel of shippedFiles()) {
    const text = readFileSync(join(SKILL_ROOT, rel), 'utf8');
    for (const name of WORKING_NAMES) if (text.includes(name)) offenders.push(rel + ' -> ' + name);
  }
  assert.deepEqual(offenders, [], 'shipped files pointing at working documents: ' + offenders.join(', '));
});

test('the design document quotes the counts and columns the configuration carries', () => {
  const design = readFileSync(join(CONFIG_DIR, '..', 'docs', 'design.md'), 'utf8');
  const rows = readConfig(CONFIG_DIR).watchlist;
  const kind = (k) => rows.filter((r) => r.kind === k).length;
  const github = kind('github-repo') + kind('github-org');
  const arxiv = kind('arxiv-category');
  const packages = kind('npm') + kind('pypi') + kind('crates') + kind('gomod');
  assert.match(design, new RegExp(`\\b${github} GitHub repositories and organisations`), 'the GitHub count');
  assert.match(design, new RegExp(`\\b${arxiv} arXiv categories`), 'the arXiv count');
  assert.match(design, new RegExp(`\\b${packages} packages across npm, PyPI, crates and the Go module proxy`), 'the package count');
  assert.match(design, /Columns: `key`, `domain`, `short`, `label_zh`, `cluster`, `tier`, `why`/, 'the catalogue columns');
  assert.match(design, /one flat row of shortcut chips/, 'the rendered navigation it describes');
});

test('every catalogue domain carries a short navigation label', () => {
  const rows = readDomains(CONFIG_DIR + 'domains.md');
  for (const r of rows) {
    assert.equal(typeof r.short, 'string', 'missing short label for ' + r.key);
    assert.ok(r.short.trim() !== '', 'empty short label for ' + r.key);
    assert.ok(r.short.length <= 18, 'short label too long for ' + r.key + ': ' + r.short);
    assert.doesNotMatch(r.short, /[<>"]/, 'short label must be attribute-safe for ' + r.key);
    assert.ok(r.short.trim().length <= r.domain.length, 'short label must not be longer than the name for ' + r.key);
  }
  const folded = rows.map((r) => r.short.trim().toLowerCase());
  assert.equal(new Set(folded).size, folded.length, 'short labels must be distinct: ' + folded.join(', '));
});

test('config/domains.md holds the 43-domain catalogue: 14 core and 29 watch', () => {
  const rows = readDomains(CONFIG_DIR + 'domains.md');
  assert.equal(rows.length, 43, 'domain rows');
  assert.equal(config.domains.length, 43, 'domain rows seen through readConfig');
  assert.equal(rows.filter((r) => r.tier === 'core').length, 14, 'core domains');
  assert.equal(rows.filter((r) => r.tier === 'watch').length, 29, 'watch domains');
  assert.equal(new Set(rows.map((r) => r.key)).size, 43, 'unique domain keys');
  for (const r of rows) {
    assert.ok(r.key.length > 0, 'key present');
    assert.ok(r.cluster.trim() !== '', 'cluster present for ' + r.key);
    assert.match(r.label_zh, /[\u4e00-\u9fff]/, 'CJK label_zh for ' + r.key);
  }
});

test('every domain key has at least one primary source', () => {
  const primaries = new Set(config.sources.filter((r) => r.tier === 'primary').map((r) => r.domain));
  const missing = config.domains.map((r) => r.key).filter((k) => !primaries.has(k));
  assert.deepEqual(missing, [], 'domains with no primary source: ' + missing.join(', '));
});

test('config/sources.md uses only the declared tier and lang enums', () => {
  assert.ok(config.sources.length > 0, 'sources present');
  const badTiers = config.sources.filter((r) => !TIERS.includes(r.tier)).map((r) => r.domain + ' / ' + r.source + ': ' + r.tier);
  const badLangs = config.sources.filter((r) => !LANGS.includes(r.lang)).map((r) => r.domain + ' / ' + r.source + ': ' + r.lang);
  assert.deepEqual(badTiers, [], 'tier outside primary|secondary|discovery');
  assert.deepEqual(badLangs, [], 'lang outside en|zh');
});

test('config/watchlist.md uses only declared kinds and no repeated target', () => {
  assert.ok(config.watchlist.length > 0, 'watchlist rows present');
  const badKinds = config.watchlist.filter((r) => !KINDS.includes(r.kind)).map((r) => r.kind + ' ' + r.target);
  assert.deepEqual(badKinds, [], 'kind outside the declared set');
  const seen = new Set();
  const dupes = [];
  for (const r of config.watchlist) {
    const id = r.kind + ' ' + r.target;
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  assert.deepEqual(dupes, [], 'repeated (kind, target) pairs');
});

// The GitHub block's worst case must fit inside the anonymous allowance minus the
// reserve, so that every watched repository gets its releases request and the
// advisory block still has budget when it runs. The floor counted here is:
//   - one /rate_limit probe: free, because the endpoint is documented not to
//     consume the core budget, so it is not counted;
//   - one releases request per github-repo row;
//   - per github-org row, one listing request plus up to github_org_repos release
//     requests, because the listing is what discovers those repositories;
//   - one request per ghsa row, the advisory block the reserve exists to protect.
// Tag requests are opportunistic and bounded by whatever is left after the floor,
// so they are deliberately not part of it. nvd rows are not GitHub requests.
test('the GitHub watchlist floor fits inside the anonymous hourly allowance', () => {
  const s = config.settings;
  const repos = config.watchlist.filter((r) => r.kind === 'github-repo').length;
  const orgs = config.watchlist.filter((r) => r.kind === 'github-org').length;
  const advisories = config.watchlist.filter((r) => r.kind === 'ghsa').length;
  const orgRepos = Number(s.github_org_repos);
  for (const k of ['github_anonymous_hourly_limit', 'github_rate_limit_reserve', 'github_org_repos']) {
    assert.ok(Number.isFinite(Number(s[k])), 'settings.' + k + ' must be a number');
  }

  const releases = repos;
  const listings = orgs;
  const orgReleases = orgs * orgRepos;
  const advisoryRequests = advisories;
  const floor = releases + listings + orgReleases + advisoryRequests;
  const allowance = Number(s.github_anonymous_hourly_limit);
  const reserve = Number(s.github_rate_limit_reserve);
  const available = allowance - reserve;
  const left = available - floor;

  const detail = 'github-repo releases ' + releases
    + ' + github-org listings ' + listings
    + ' + github-org releases ' + orgReleases + ' (' + orgs + ' org row(s) x github_org_repos ' + orgRepos + ')'
    + ' + ghsa advisories ' + advisoryRequests
    + ' = floor ' + floor
    + '; github_anonymous_hourly_limit ' + allowance
    + ' - github_rate_limit_reserve ' + reserve
    + ' = ' + available + ' available, left ' + left;
  assert.ok(floor <= available, 'the GitHub watchlist floor exceeds the anonymous hourly allowance: ' + detail);
});

test('config/settings.md declares all twenty-eight keys the code reads', () => {
  const settings = readSettings(CONFIG_DIR + 'settings.md');
  assert.equal(SETTINGS_KEYS.length, 28, 'the documented settings key count');
  assert.ok('watchlist_retention_weeks' in settings, 'watchlist_retention_weeks present');
  const missing = SETTINGS_KEYS.filter((k) => !(k in settings));
  assert.deepEqual(missing, [], 'missing settings keys: ' + missing.join(', '));
  const blank = SETTINGS_KEYS.filter((k) => settings[k] === '');
  assert.deepEqual(blank, [], 'settings keys with an empty value: ' + blank.join(', '));
});

// A stray line is a non-blank line that is neither a heading, prose inside the
// file's documented header, nor a valid table row. The documented header prose
// of all four files is pipe-free, so a line before the table that contains a
// pipe is a malformed table row. Regression: config/watchlist.md once carried
// the stray line that spelled out the watchlist columns in backticks, each
// separated by a pipe, immediately above the real header row.
function strayLines(path) {
  const out = [];
  let inTable = false;
  let fenced = false;
  readFileSync(path, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith(FENCE_MARK) || line.startsWith('~~~')) { fenced = !fenced; return; }
    if (fenced) return;
    if (line === '' || line.startsWith('#')) return;
    if (line.startsWith('|')) { inTable = true; return; }
    if (!inTable && !line.includes('|')) return; // documented header prose
    out.push({ line: i + 1, why: inTable ? 'text after the table' : 'malformed table row', text: line });
  });
  return out;
}

for (const name of FILES) {
  test('config/' + name + ' has no stray non-table lines', () => {
    const strays = strayLines(CONFIG_DIR + name);
    const report = strays.map((s) => 'line ' + s.line + ' (' + s.why + '): ' + s.text).join('\n');
    assert.equal(report, '', 'stray non-table lines in config/' + name + ':\n' + report);
  });
}