// tests/quality.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseItems, parseArgs, check, main, scopedMinItems, registeredOutlet, FEATURED_STANDIN } from '../scripts/check-quality.mjs';
import { readConfig } from '../scripts/lib/mdtable.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'tech-radar-gate-'));
const REPO = fileURLToPath(new URL('../', import.meta.url));

const settings = {
  timezone: 'Asia/Shanghai', core_max_items: 4, watch_max_items: 2, watch_notable_max: 8,
  total_min_items: 1, total_max_items: 4, deep_dive: 'when-warranted',
  discovery_hosts: 'news.ycombinator.com, reddit.com',
};
const config = {
  settings,
  domains: [
    { key: 'ai-llm', domain: 'AI / LLM', label_zh: '人工智能 / 大模型', tier: 'core' },
    { key: 'quantum', domain: 'Quantum technologies', label_zh: '量子技术', tier: 'watch' },
  ],
  sources: [{ domain: 'ai-llm', source: 'Hugging Face blog', tier: 'primary', kind: 'blog', lang: 'en', fetchable: 'yes', note: '' }],
};
const plan = { window: { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' }, label: 'Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit' };

const good = [
  '# Tech Radar — 2026-09-23',
  `_Covering ${plan.label} · 2 domains scanned · 2 items_`,
  '',
  FEATURED_STANDIN,
  '',
  '## Core domains',
  '### AI / LLM · 人工智能 / 大模型',
  '- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
  '',
  '## Watch domains — quiet',
  'Quantum technologies (scanned, nothing notable)',
  '',
  '## Coverage note',
  plan.label,
].join('\n');

const multilineGood = good.replace(
  '- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
  '- **A model shipped** — Why it matters.\n  [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
);
const noCoreHeading = good.replace('### AI / LLM · 人工智能 / 大模型\n', '');
const twoWatch = {
  ...config,
  domains: [...config.domains, { key: 'photonics', domain: 'Photonics', label_zh: '光子学', tier: 'watch' }],
};
const scopedToCovered = {
  ...plan,
  perDomain: {
    'ai-llm': { since: plan.window.since, until: plan.window.until },
    quantum: { since: plan.window.since, until: plan.window.until },
  },
};

test('parseItems reads the headline, source, provenance and flags', () => {
  const items = parseItems(good);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'A model shipped');
  assert.equal(items[0].domain, 'AI / LLM');
  assert.equal(items[0].src.url, 'https://huggingface.co/blog/x');
  assert.deepEqual(items[0].prov, ['primary']);
  assert.deepEqual(items[0].flags, ['new']);
});

test('a well-formed digest passes', () => {
  const { failures } = check(good, config, plan);
  assert.deepEqual(failures, []);
});

test('a missing provenance marker fails', () => {
  const bad = good.replace(' [prov:primary]', '');
  assert.match(check(bad, config, plan).failures.join('\n'), /provenance/);
});

test('two items with the same story key fail as a dedupe error', () => {
  const dup = good.replace('## Watch domains — quiet', `- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #followup

## Watch domains — quiet`);
  assert.match(check(dup, config, plan).failures.join('\n'), /duplicate story key/);
});

test('a discovery-only citation fails', () => {
  const bad = good.replace('https://huggingface.co/blog/x', 'https://news.ycombinator.com/item?id=1');
  assert.match(check(bad, config, plan).failures.join('\n'), /discovery-only/);
});

test('a missing quiet line for a watch domain fails', () => {
  const bad = good.replace('Quantum technologies (scanned, nothing notable)', '');
  assert.match(check(bad, config, plan).failures.join('\n'), /quiet line/);
});

test('a coverage note that does not repeat the label verbatim fails', () => {
  const bad = good.replace(`## Coverage note\n${plan.label}`, '## Coverage note\nSomething else');
  assert.match(check(bad, config, plan).failures.join('\n'), /coverage note/);
});

test('a Chinese-registry source producing a Latin-only item fails', () => {
  const zh = { ...config, sources: [{ ...config.sources[0], source: '机器之心', lang: 'zh' }] };
  const bad = good.replace('Hugging Face blog', '机器之心');
  assert.match(check(bad, zh, plan).failures.join('\n'), /language rule/);
});

// Regression test: the coverage-note rule used md.includes(label),
// which the header line also satisfies, so a drifted coverage note passed. Only
// the coverage-note section may satisfy the rule, even though the header still
// carries the label verbatim.
test('a label present only in the header does not satisfy the coverage note', () => {
  const bad = good.replace(`## Coverage note\n${plan.label}`, '## Coverage note\nSee the header.');
  const { failures } = check(bad, config, plan);
  assert.match(failures.join('\n'), /coverage note/);
  assert.equal(failures.filter((f) => /coverage note/.test(f)).length, 1);
});

// Regression test: the language rule tested the whole item body for
// CJK, and a Chinese outlet name inside [src:...] is CJK, so the rule never fired.
// It judges the item prose, with the citation machinery removed.
test('the language rule judges the prose, not the Chinese outlet name', () => {
  const zh = { ...config, sources: [{ ...config.sources[0], source: '机器之心', lang: 'zh' }] };
  const bad = good.replace('Hugging Face blog', '机器之心');
  const { failures } = check(bad, zh, plan);
  assert.equal(failures.filter((f) => /language rule/.test(f)).length, 1, failures.join('\n'));
});

// Regression test: the fixture digest carried one item while its
// settings declared total_min_items 2 and its header claimed two items, so the
// "well-formed digest passes" case could never pass. The floor is real, so the
// floor is pinned here rather than removed.
test('an item count below total_min_items fails the gate', () => {
  const strict = { ...config, settings: { ...settings, total_min_items: 2 } };
  assert.match(check(good, strict, plan).failures.join('\n'), /below total_min_items 2/);
});
// Regression test: sectionText used a lazy [\s\S]*? bounded by $
// under the m flag, so a section whose body starts with a blank line captured the
// empty string - the coverage note false-failed and every quiet watch domain
// false-failed. Section bodies are read line by line now.
test('a blank line under a section heading does not empty the section', () => {
  const spaced = good
    .replace('## Watch domains — quiet\n', '## Watch domains — quiet\n\n')
    .replace('## Coverage note\n', '## Coverage note\n\n');
  assert.deepEqual(check(spaced, config, plan).failures, []);
});

// Regression test: design 4.4 fails a digest in which a core
// domain is absent as a section heading.
test('a core domain with no section heading fails', () => {
  const bad = good.replace('### AI / LLM · 人工智能 / 大模型\n', '');
  assert.match(check(bad, config, plan).failures.join('\n'), /core domain AI \/ LLM has no section heading/);
});

// Regression test: design 4.4 fails a section heading that is
// missing its bilingual label.
test('a section heading missing its bilingual label fails', () => {
  const bad = good.replace('### AI / LLM · 人工智能 / 大模型', '### AI / LLM');
  assert.match(check(bad, config, plan).failures.join('\n'), /bilingual label/);
});

// Regression test: the gate's --html branch. A real asset context
// fails the digest; prose that merely mentions a url(https://...) string does not.
test('the gate fails an HTML file that loads an external asset', () => {
  const dir = scratch();
  const html = join(dir, 'digest.html');
  writeFileSync(html, '<html><head><script src="https://cdn.example.com/a.js"></script></head><body>x</body></html>');
  assert.match(check(good, config, plan, { htmlPath: html }).failures.join('\n'), /external asset/);
});

test('the gate passes HTML whose prose only mentions a url(https://...) string', () => {
  const dir = scratch();
  const html = join(dir, 'digest.html');
  writeFileSync(html, '<html><body><p>See url(https://example.com/x) for the method.</p>'
    + '<a href="https://huggingface.co/blog/x">Hugging Face blog 2026-09-20</a></body></html>');
  assert.deepEqual(check(good, config, plan, { htmlPath: html }).failures, []);
});

// Regression test: a --html path that does not exist used to be
// skipped silently, which turns a typo into a disabled self-containment rule.
test('the CLI refuses a --html path that does not exist', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  const planPath = join(dir, 'plan.json');
  writeFileSync(mdPath, good);
  writeFileSync(planPath, JSON.stringify(plan));
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    code = main([mdPath, '--plan', planPath, '--html', join(dir, 'missing.html')]);
  } finally {
    console.error = orig;
    process.exitCode = 0;
  }
  assert.equal(code, 2);
  assert.match(errs.join('\n'), /--html file not found/);
});
// Regression test: the gate imported the predicate from the
// deliverable renderer, so a missing or malformed renderer killed the gate with an
// ESM loader error instead of checking a digest. The predicate lives in
// scripts/lib/assets.mjs, and the gate runs with the renderer deleted.
test('the gate runs when the renderer is not present', () => {
  const dir = scratch();
  cpSync(join(REPO, 'scripts'), join(dir, 'scripts'), { recursive: true });
  rmSync(join(dir, 'scripts', 'render-html.mjs'));
  const out = execFileSync(process.execPath, [join(dir, 'scripts', 'check-quality.mjs'), '-h'], { encoding: 'utf8' });
  assert.match(out, /usage: check-quality\.mjs/);
});

// Regression test: an empty perDomain object was treated as "no
// scoping", so the core-heading check silently checked nothing and a digest with
// missing core headings passed. A plan naming no domain is treated as unscoped.
test('an empty perDomain object does not disable the core-heading check', () => {
  const scopedEmpty = { ...plan, perDomain: {} };
  assert.match(check(noCoreHeading, config, scopedEmpty).failures.join('\n'), /core domain AI \/ LLM has no section heading/);
});

// Coverage for the scoping predicate itself, which had none.
test('a plan that covers a core domain requires that domain heading', () => {
  const scoped = { ...plan, perDomain: { 'ai-llm': { since: plan.window.since, until: plan.window.until } } };
  assert.match(check(noCoreHeading, config, scoped).failures.join('\n'), /core domain AI \/ LLM has no section heading/);
});

test('a plan that does not cover a core domain does not require its heading', () => {
  const watchOnly = { ...plan, perDomain: { quantum: { since: plan.window.since, until: plan.window.until } } };
  assert.equal(check(noCoreHeading, config, watchOnly).failures.filter((f) => /core domain/.test(f)).length, 0);
});

// Regression test: design 4.3 draws an item as a headline line with
// the citation on an indented continuation line. The gate is line-based, so the
// documented form failed with "item has no [src:OUTLET DATE](url)".
test('parseItems joins an indented citation continuation into the item', () => {
  const items = parseItems(multilineGood);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'A model shipped');
  assert.equal(items[0].src.url, 'https://huggingface.co/blog/x');
  assert.deepEqual(items[0].prov, ['primary']);
  assert.deepEqual(items[0].flags, ['new']);
});

test('the gate accepts the documented multi-line item form', () => {
  assert.deepEqual(check(multilineGood, config, plan).failures, []);
});

test('the gate still accepts the one-line item form', () => {
  assert.deepEqual(check(good, config, plan).failures, []);
});
// Regression test: the quiet-line loop ignored the run's scope, so a
// two-domain focus run had to name every quiet watch domain in the catalogue to
// pass. It is scoped exactly like the core-heading check.
test('a scoped plan requires only the quiet watch domains it covered', () => {
  assert.deepEqual(check(good, twoWatch, scopedToCovered).failures, []);
});

test('an unscoped plan still requires every quiet watch domain', () => {
  assert.match(
    check(good, twoWatch, plan).failures.join('\n'),
    /quiet line: watch domain Photonics is absent from both the digest and the quiet line/,
  );
});
// Regression test: --config defaulted to a cwd-relative 'config',
// so the documented commands only worked from the skill root. It now defaults to
// the config directory next to the script.
test('the gate resolves its default config next to the script, not the cwd', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  const planPath = join(dir, 'plan.json');
  writeFileSync(mdPath, good);
  writeFileSync(planPath, JSON.stringify(plan));
  const cwd = process.cwd();
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    process.chdir(dir);
    code = main([mdPath, '--plan', planPath]);
  } finally {
    process.chdir(cwd);
    console.error = orig;
    process.exitCode = 0;
  }
  assert.notEqual(code, 2, 'the configuration is not resolved against the working directory');
  assert.doesNotMatch(errs.join('\n'), /cannot read config/);
});
// --- the scoped floor (design 3.5 makes a focus run first class; 4.4's budget was
// written for a full run, so the floor is scoped while the ceiling stays global) ---

const REAL = readConfig(fileURLToPath(new URL('../config/', import.meta.url)));
const REAL_LABEL = 'Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit';
const realPlan = (coveredKeys) => ({
  window: { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' },
  label: REAL_LABEL,
  ...(coveredKeys
    ? { perDomain: Object.fromEntries(coveredKeys.map((k) => [k, { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' }])) }
    : {}),
});

// A complete digest over the real catalogue: a bilingual heading per covered domain,
// itemCount items spread evenly over them, the quiet line naming every uncovered
// watch domain, and the window label in the header and in the coverage note.
function realDigest(coveredKeys, itemCount) {
  const byKey = new Map(REAL.domains.map((d) => [d.key, d]));
  const covered = coveredKeys.map((k) => byKey.get(k));
  const quiet = REAL.domains
    .filter((d) => d.tier === 'watch' && !coveredKeys.includes(d.key))
    .map((d) => d.domain);
  const counts = covered.map(() => 0);
  for (let i = 0; i < itemCount; i += 1) counts[i % covered.length] += 1;
  const lines = [
    '# Tech Radar — 2026-09-23',
    `_Covering ${REAL_LABEL} · ${covered.length} domains scanned · ${itemCount} items_`,
    '',
    FEATURED_STANDIN,
    '',
    '## Core domains',
  ];
  let n = 0;
  covered.forEach((d, di) => {
    lines.push(`### ${d.domain} · ${d.label_zh}`);
    for (let k = 0; k < counts[di]; k += 1) {
      lines.push(`- **Story ${n} in ${d.key}** — Something changed. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/story-${n}) [prov:primary] #new`);
      n += 1;
    }
    lines.push('');
  });
  lines.push('## Watch domains — quiet');
  lines.push(`${quiet.join(' · ')} (scanned, nothing notable)`);
  lines.push('');
  lines.push('## Coverage note');
  lines.push(REAL_LABEL);
  return lines.join('\n');
}

const CORE_KEYS = REAL.domains.filter((d) => d.tier === 'core').map((d) => d.key);

test('the scoped floor scales with the covered share and never bars a narrow run', () => {
  const s = { total_min_items: 30 };
  const allKeys = Object.fromEntries(REAL.domains.map((d) => [d.key, {}]));
  assert.equal(scopedMinItems(s, 43, null), 30, 'no scope keeps the configured floor');
  assert.equal(scopedMinItems(s, 43, {}), 30, 'an empty scope is not a scope');
  assert.equal(scopedMinItems(s, 43, allKeys), 30, 'a full scope keeps the configured floor');
  assert.equal(scopedMinItems(s, 43, { 'ai-llm': {} }), 1, 'one domain is a probe');
  assert.equal(scopedMinItems(s, 43, { 'ai-llm': {}, 'computer-vision': {} }), 3, 'two domains');
  assert.equal(scopedMinItems(s, 43, { a: {}, b: {}, c: {} }), 4, 'three domains');
  assert.ok(scopedMinItems(s, 43, allKeys) <= 30, 'never above the configured floor');
  assert.ok(scopedMinItems(s, 43, Object.fromEntries(CORE_KEYS.slice(0, 20).map((k) => [k, {}]))) <= 30);
});

test('a two-domain focus run with eight items passes', () => {
  const keys = ['ai-llm', 'computer-vision'];
  assert.deepEqual(check(realDigest(keys, 8), REAL, realPlan(keys)).failures, []);
});

test('a full run with twenty-nine items still fails on total_min_items', () => {
  const failures = check(realDigest(CORE_KEYS, 29), REAL, realPlan(null)).failures;
  assert.deepEqual(failures, ['29 items is below total_min_items 30']);
});

test('a one-domain focus run with a single item passes', () => {
  assert.deepEqual(check(realDigest(['ai-llm'], 1), REAL, realPlan(['ai-llm'])).failures, []);
});

test('a two-domain focus run with two items still fails, so the scope cannot lower the bar', () => {
  const keys = ['ai-llm', 'computer-vision'];
  const failures = check(realDigest(keys, 2), REAL, realPlan(keys)).failures;
  assert.match(failures.join('\n'), /2 items is below the scoped floor of 3 for a run covering 2 of 43 domains/);
});
// --- the outlet registry match ---

test('an outlet the registry names does not warn, however the digest spells it', () => {
  const rows = [
    { source: 'arXiv cs.CL and cs.AI listings' },
    { source: 'arXiv cs.AR listing' },
    { source: 'NVIDIA newsroom and developer blog' },
    { source: 'LWN kernel coverage' },
    { source: 'Hugging Face blog' },
    { source: '机器之心' },
    { source: 'Go releases' },
  ];
  for (const outlet of ['arXiv', 'arXiv cs.AR listing', 'NVIDIA developer blog', 'LWN', 'Hugging Face blog', '机器之心', 'Go']) {
    assert.equal(registeredOutlet(outlet, rows), true, outlet);
  }
});

test('an outlet the registry does not name still warns', () => {
  const rows = [{ source: 'Go releases' }, { source: 'Hugging Face blog' }];
  assert.equal(registeredOutlet('Extremely Unlisted Outlet', rows), false);
  assert.equal(registeredOutlet('Django blog', rows), false, 'a leading token inside another word is not a name');
  assert.equal(registeredOutlet('Some blog', rows), false);
});

test('the gate warns for an unregistered citation and stays quiet for a registered one', () => {
  const withCollectorRows = {
    ...config,
    sources: [
      { ...config.sources[0], source: 'arXiv cs.AR listing' },
      { ...config.sources[0], source: 'NVIDIA newsroom and developer blog' },
      { ...config.sources[0], source: 'LWN kernel coverage' },
      { ...config.sources[0], source: 'Hugging Face blog' },
    ],
  };
  for (const outlet of ['arXiv', 'NVIDIA developer blog', 'LWN', 'Hugging Face blog']) {
    const md = good.replace('Hugging Face blog', outlet);
    const outletWarnings = check(md, withCollectorRows, plan).warnings.filter((w) => /outlet/.test(w));
    assert.deepEqual(outletWarnings, [], outlet);
  }
  const unlisted = good.replace('Hugging Face blog', 'Totally Unlisted Press');
  assert.match(check(unlisted, withCollectorRows, plan).warnings.join('\n'), /outlet Totally Unlisted Press is not in config\/sources\.md/);
});

test('a registry row names every comma-separated alternative it carries', () => {
  assert.equal(registeredOutlet('NVD', [{ source: 'GitHub Security Advisories, NVD' }]), true);
  assert.equal(registeredOutlet('NVD', [{ source: 'GitHub Security Advisories and NVD' }]), false,
    'the advisory row names NVD in prose, not as an alternative: the registry needs the comma');
});

// Regression test: the gate compared every item with plan.window, the
// earliest domain start, and never with the item's own per-domain window, so an item
// dated before its domain's watermark passed and the per-domain model was decorative.
const windowPlan = (since = '2026-09-16T00:00:00Z') => ({
  window: { since, until: '2026-09-23T00:00:00Z' },
  label: plan.label,
  perDomain: {
    'ai-llm': { since: '2026-09-21T00:00:00Z', until: '2026-09-23T00:00:00Z' },
    quantum: { since, until: '2026-09-23T00:00:00Z' },
  },
});

test('an item before its own domain window fails even when the global window accepts it', () => {
  const dated = good.replace('2026-09-20', '2026-09-18');
  assert.match(
    check(dated, config, windowPlan()).failures.join('\n'),
    /line 8: published 2026-09-18 is before the window/,
  );
});

test('an item inside its own domain window still passes', () => {
  const inside = good.replace('2026-09-20', '2026-09-22');
  assert.deepEqual(check(inside, config, windowPlan()).failures, []);
});

test('an item whose domain the plan does not cover is judged by the global window', () => {
  const watchOnly = {
    window: { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' },
    label: plan.label,
    perDomain: { quantum: { since: '2026-09-21T00:00:00Z', until: '2026-09-23T00:00:00Z' } },
  };
  const dated = good.replace('2026-09-20', '2026-09-18');
  assert.deepEqual(check(dated, config, watchOnly).failures, []);
});

// The deep_dive setting, all six combinations, including the stand-in rule:
// a quiet week under when-warranted must record the line, so a reader can tell
// "nothing warranted a deep dive" from "the writer forgot".
const withSetting = (value) => ({ ...config, settings: { ...settings, deep_dive: value } });
const deepIssues = (result) => [...result.failures, ...result.warnings]
  .filter((m) => /deep_dive|Featured this week|stand-in|deep dive/i.test(m));
const featuredGood = good.replace(
  FEATURED_STANDIN,
  '## Featured this week\n### The one thing worth ten minutes\nTen minutes of prose. [src:Example Wire 2026-09-20](https://example.com/deep) [prov:primary]',
);
const noStandin = good.replace(`${FEATURED_STANDIN}\n\n`, '');

test('deep_dive always with no featured section fails', () => {
  assert.match(check(good, withSetting('always'), plan).failures.join('\n'), /deep_dive is always/);
});

test('deep_dive always with a featured section is silent', () => {
  assert.deepEqual(deepIssues(check(featuredGood, withSetting('always'), plan)), []);
});

test('deep_dive when-warranted with no featured section and no stand-in line fails, naming both', () => {
  const failures = check(noStandin, withSetting('when-warranted'), plan).failures.join('\n');
  assert.match(failures, /deep_dive is when-warranted/);
  assert.match(failures, /must carry the line "Nothing this week warranted a deep dive\."/);
});

test('deep_dive when-warranted with no featured section but the stand-in line is silent', () => {
  assert.deepEqual(deepIssues(check(good, withSetting('when-warranted'), plan)), []);
});

test('deep_dive when-warranted with a featured section is silent', () => {
  assert.deepEqual(deepIssues(check(featuredGood, withSetting('when-warranted'), plan)), []);
});

// The contract expects a deep dive to name its primary source, and the rendered card can
// only link a headline and show an origin pill when the prose cites one. It is a warning:
// what warrants a deep dive is the writer's judgement, not a regex.
test('a featured deep dive that names no source is warned about, never failed', () => {
  assert.deepEqual(check(featuredGood, withSetting('when-warranted'), plan).warnings.filter((w) => /no usable source/.test(w)), [],
    'a cited deep dive draws no such warning');
  const uncited = good.replace(FEATURED_STANDIN,
    '## Featured this week\n### The one thing worth ten minutes\nTen minutes of prose with no citation anywhere in it.');
  const warned = check(uncited, withSetting('when-warranted'), plan);
  assert.equal(warned.failures.length, 0, 'a warning must not fail the gate');
  assert.match(warned.warnings.join('\n'), /no usable source/);
  const standin = check(good, withSetting('when-warranted'), plan);
  assert.deepEqual(standin.warnings.filter((w) => /no usable source/.test(w)), [], 'the stand-in line is not a deep dive');

  // A citation the renderer cannot use is the same failure as no citation: it ships a card
  // with no headline link and no origin pill. The warning reads the citation shape the gate
  // and the renderer share, not merely the presence of a [src: ...] token.
  for (const unusable of [
    '[src:Placeholder](https://example.com/deep)',
    '[src:Placeholder 2026-09-20](ftp://example.com/deep)',
    '[src:Placeholder 2026-09-20](example.com/deep)',
  ]) {
    const withBad = good.replace(FEATURED_STANDIN,
      '## Featured this week\n### The one thing worth ten minutes\nTen minutes of prose. ' + unusable + ' [prov:primary]');
    const result = check(withBad, withSetting('when-warranted'), plan);
    assert.match(result.warnings.join('\n'), /no usable source/, 'warned about: ' + unusable);
  }
});

test('deep_dive never with no featured section is silent', () => {
  assert.deepEqual(check(good, withSetting('never'), plan).failures, []);
  assert.deepEqual(deepIssues(check(good, withSetting('never'), plan)), []);
});

test('deep_dive never with a featured section warns', () => {
  assert.match(
    check(featuredGood, withSetting('never'), plan).warnings.join('\n'),
    /deep_dive is never, but the digest carries a "## Featured this week" section/,
  );
});

// Regression test: a bold bullet outside any domain section was parsed
// as an item, inherited the last domain heading and was failed for missing a citation.
test('a bullet in a section with no domain heading is not an item', () => {
  const withComingUp = good.replace(
    '## Coverage note',
    '## Coming up\n- **Something lands next week** — A horizon note with no citation yet.\n\n## Coverage note',
  );
  assert.equal(parseItems(withComingUp, config).length, 1, 'only the domain item is parsed');
  assert.deepEqual(check(withComingUp, config, plan).failures, []);
});

test('a bullet under the featured heading is not an item', () => {
  const withFeatured = good.replace(
    '## Core domains',
    '## Featured this week\n### The one thing worth ten minutes\n- **A deep dive** — Written out over ten minutes.\n\n## Core domains',
  );
  assert.equal(parseItems(withFeatured, config).length, 1);
  assert.deepEqual(check(withFeatured, config, plan).failures, []);
  const unknown = withFeatured.replace('### The one thing worth ten minutes', '### Not a catalogue domain');
  assert.equal(parseItems(unknown, config).length, 1, 'an unknown heading is not a domain either');
});

// Regression test: the Chinese-source rule substring-matched a row's
// alternatives, so a short form escaped it and an unrelated longer name tripped it.
test('a short-form citation of a Chinese source still applies the language rule', () => {
  const zh = { ...config, sources: [{ ...config.sources[0], source: 'DeepSeek, Qwen release blogs', lang: 'zh' }] };
  const bad = good.replace('Hugging Face blog', 'Qwen');
  assert.match(check(bad, zh, plan).failures.join('\n'), /language rule/);
});

test('an outlet whose name merely contains a Chinese source name does not trip the rule', () => {
  const zh = { ...config, sources: [{ ...config.sources[0], source: 'DeepSeek, Qwen release blogs', lang: 'zh' }] };
  const unrelated = good.replace('Hugging Face blog', 'DeepSeekX Weekly');
  assert.deepEqual(check(unrelated, zh, plan).failures, []);
});
// --- the collector notice count in the coverage note ---

const withNotices = (n) => good.replace('## Coverage note\n', `## Coverage note\nCollector notices: ${n}\n`);
const poolOf = (count) => ({ notices: Array.from({ length: count }, (_, i) => `source ${i} failed`) });

function gateCli(args) {
  const logs = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    code = main(args);
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.exitCode = 0;
  }
  return { code, out: [...logs, ...errs].join('\n') };
}

test('a degraded pool with no notice line in the coverage note fails, naming the count', () => {
  const failures = check(good, config, plan, { pool: poolOf(2) }).failures.join('\n');
  assert.match(failures, /degraded run/);
  assert.match(failures, /Collector notices: 2/);
});

test('a notice line whose number differs from the pool fails, naming both numbers', () => {
  const failures = check(withNotices(1), config, plan, { pool: poolOf(2) }).failures.join('\n');
  assert.match(failures, /"Collector notices: 1" does not match the pool's 2 notice\(s\)/);
});

test('an empty pool with no notice line passes', () => {
  assert.deepEqual(check(good, config, plan, { pool: poolOf(0) }).failures, []);
});

test('an empty pool with an explicit zero line passes', () => {
  assert.deepEqual(check(withNotices(0), config, plan, { pool: poolOf(0) }).failures, []);
});

test('the notice line tolerates case, spacing and punctuation but not a wrong number', () => {
  for (const line of ['Collector notices: 3', '**Collector notices: 3**', '- COLLECTOR   NOTICES : 3.', '`Collector notices:3`']) {
    const md = good.replace('## Coverage note\n', `## Coverage note\n${line}\n`);
    assert.deepEqual(check(md, config, plan, { pool: poolOf(3) }).failures, [], line);
  }
  const wrong = good.replace('## Coverage note\n', '## Coverage note\nCollector notices: 4\n');
  assert.match(check(wrong, config, plan, { pool: poolOf(3) }).failures.join('\n'), /"Collector notices: 4" does not match the pool's 3/);
});

test('without a pool the notice check does not run', () => {
  assert.deepEqual(check(withNotices(7), config, plan).failures, []);
  assert.deepEqual(check(good, config, plan).failures, []);
});

test('the --pool file is read defensively', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  const planPath = join(dir, 'plan.json');
  writeFileSync(mdPath, good);
  writeFileSync(planPath, JSON.stringify(plan));
  const base = [mdPath, '--plan', planPath, '--config', join(REPO, 'tests', 'fixtures', 'digest', 'config')];

  const missing = gateCli([...base, '--pool', join(dir, 'missing.json')]);
  assert.equal(missing.code, 2, 'missing pool');
  assert.match(missing.out, /cannot read pool/);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{not json');
  const unparseable = gateCli([...base, '--pool', bad]);
  assert.equal(unparseable.code, 2, 'unparseable pool');
  assert.match(unparseable.out, /cannot parse pool/);
  const arr = join(dir, 'arr.json');
  writeFileSync(arr, '[]');
  const notObject = gateCli([...base, '--pool', arr]);
  assert.equal(notObject.code, 2, 'pool that is not an object');
  assert.match(notObject.out, /is not an object/);
  const wrongShape = join(dir, 'wrong.json');
  writeFileSync(wrongShape, JSON.stringify({ notices: 'two' }));
  const badShape = gateCli([...base, '--pool', wrongShape]);
  assert.equal(badShape.code, 2, 'notices that is not an array');
  assert.match(badShape.out, /notices field that is not an array/);
});

test('the gate CLI passes a digest that records the pool count and fails one that does not', () => {
  const dir = scratch();
  const planPath = join(dir, 'plan.json');
  const poolPath = join(dir, 'pool.json');
  writeFileSync(planPath, JSON.stringify(plan));
  writeFileSync(poolPath, JSON.stringify({ notices: ['github vllm-project/vllm: HTTP 403 ...'] }));
  const cfg = join(REPO, 'tests', 'fixtures', 'digest', 'config');
  const recorded = join(dir, 'recorded.md');
  writeFileSync(recorded, withNotices(1));
  const passing = gateCli([recorded, '--plan', planPath, '--config', cfg, '--pool', poolPath]);
  assert.equal(passing.code, 0, passing.out);

  const silent = join(dir, 'silent.md');
  writeFileSync(silent, good);
  const failing = gateCli([silent, '--plan', planPath, '--config', cfg, '--pool', poolPath]);
  assert.equal(failing.code, 5);
  assert.match(failing.out, /degraded run: the collector recorded 1 notice\(s\)/);
  assert.match(failing.out, /Collector notices: 1/);
});
// --- CRLF, section-scoped headings, unknown domains, plan shape, keys ---

test('a CRLF digest parses and passes', () => {
  const crlf = good.replace(/\n/g, '\r\n');
  assert.equal(parseItems(crlf).length, 1, 'the item is found');
  assert.deepEqual(check(crlf, config, plan).failures, []);
});

test('a core-domain heading outside the core section does not satisfy the rule', () => {
  const strayOnly = good
    .replace('### AI / LLM · 人工智能 / 大模型\n', '')
    .replace('## Coverage note', '## Coming up\n### AI / LLM · 人工智能 / 大模型\n\n## Coverage note');
  assert.match(check(strayOnly, config, plan).failures.join('\n'), /core domain AI \/ LLM has no section heading/);
});

test('a featured headline that names a domain is not failed for a missing Chinese label', () => {
  const withFeatured = good.replace(
    '## Core domains',
    '## Featured this week\n### Why AI / LLM changed everything\nTen minutes of prose.\n\n## Core domains',
  );
  assert.deepEqual(check(withFeatured, config, plan).failures, []);
});

test('items under an unrecognised heading are counted and warned about', () => {
  const bullets = Array.from({ length: 20 }, (_, i) =>
    `- **Story ${i}** — text [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/m${i}) [prov:primary] #new`);
  const md = good.replace('## Watch domains — quiet', `### Miscellaneous\n${bullets.join('\n')}\n\n## Watch domains — quiet`);
  const { failures, warnings } = check(md, config, plan);
  assert.equal(parseItems(md).filter((it) => it.domain === 'Miscellaneous').length, 20, 'the items are parsed');
  assert.match(warnings.join('\n'), /domain Miscellaneous is not in the catalogue/);
  assert.match(failures.join('\n'), /is above total_max_items 4/, 'the total ceiling still binds');
});

test('a heading written with the catalogue key names the key and the domain to use', () => {
  const keyed = good.replace('### AI / LLM · 人工智能 / 大模型', '### ai-llm · 人工智能 / 大模型');
  const failures = check(keyed, config, plan).failures.join('\n');
  assert.match(failures, /heading "ai-llm · 人工智能 \/ 大模型" names the catalogue key "ai-llm"/);
  assert.match(failures, /write the domain name "AI \/ LLM" instead/);
});

test('a malformed plan exits 2 with a named reason', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  writeFileSync(mdPath, good);
  const cfg = join(REPO, 'tests', 'fixtures', 'digest', 'config');
  const cases = [
    ['{}', /the plan has no window object/],
    ['{"window":{},"label":"x"}', /the plan window\.since is not a date/],
    ['{"window":{"since":"2026-09-16T00:00:00Z"},"label":"x"}', /the plan window\.until is not a date/],
    ['{"window":{"since":"2026-09-16T00:00:00Z","until":"2026-09-23T00:00:00Z"},"label":7}', /the plan label is not a string/],
    ['[]', /the plan is not an object/],
  ];
  for (const [body, re] of cases) {
    const planPath = join(dir, 'plan.json');
    writeFileSync(planPath, body);
    const result = gateCli([mdPath, '--plan', planPath, '--config', cfg]);
    assert.equal(result.code, 2, body);
    assert.match(result.out, re, body);
  }
});
// --- ten low-severity findings ---

test('a coverage-note heading with internal whitespace is recognised', () => {
  assert.deepEqual(check(good.replace('## Coverage note', '## Coverage  note'), config, plan).failures, []);
  assert.deepEqual(check(good.replace('## Coverage note', '## Coverage\tnote'), config, plan).failures, []);
});

test('a missing coverage-note section names the heading it looked for and what it found', () => {
  const failures = check(good.replace('## Coverage note\n', '## Notes\n'), config, plan).failures.join('\n');
  assert.match(failures, /no section heading matches "## Coverage note"/);
  assert.match(failures, /headings found: .*Notes/);
});

test('a status flag inside the citation URL is not a status flag', () => {
  const noFlag = good
    .replace(' [prov:primary] #new', ' [prov:primary]')
    .replace('https://huggingface.co/blog/x', 'https://huggingface.co/blog/x#new');
  assert.match(check(noFlag, config, plan).failures.join('\n'), /expected exactly one of #new or #followup/);
});

test('a prose mention of #followup does not fail a correctly flagged item', () => {
  const prose = good.replace('Why it matters.', 'This is a #followup to last week.');
  const { failures, warnings } = check(prose, config, plan);
  assert.deepEqual(failures, []);
  assert.match(warnings.join('\n'), /2 status tokens; the trailing #new is read as the flag/);
});

test('a bullet that looks like an item but does not parse is warned about', () => {
  const five = good.replace(
    '## Watch domains — quiet',
    '- **Item five** – an en dash instead of an em dash. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/f) [prov:primary] #new\n\n## Watch domains — quiet',
  );
  const { failures, warnings } = check(five, config, plan);
  assert.match(warnings.join('\n'), /bullet looks like an item but does not match the item grammar/);
  assert.deepEqual(failures, []);
});

test('the language rule judges the headline as well as the summary', () => {
  const zh = { ...config, sources: [{ ...config.sources[0], source: '机器之心', lang: 'zh' }] };
  const chineseHeadline = good
    .replace('**A model shipped**', '**模型发布了**')
    .replace('Hugging Face blog', '机器之心');
  assert.deepEqual(check(chineseHeadline, zh, plan).failures, []);
});

test('a zh- language tag still applies the language rule', () => {
  const zh = { ...config, sources: [{ ...config.sources[0], source: '机器之心', lang: 'zh-CN' }] };
  assert.match(check(good.replace('Hugging Face blog', '机器之心'), zh, plan).failures.join('\n'), /language rule/);
});

test('a decoy heading containing "quiet" does not hijack the quiet line', () => {
  const decoy = good.replace('## Core domains', '## Not a quiet week after all\nNothing here.\n\n## Core domains');
  assert.deepEqual(check(decoy, config, plan).failures, []);
});

test('two different stories on one host with similar titles are not duplicates', () => {
  const two = good.replace(
    '## Watch domains — quiet',
    '- **Story one** — first. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/one) [prov:primary] #new\n'
    + '- **Story  one!** — second. [src:Hugging Face blog 2026-09-21](https://huggingface.co/blog/two) [prov:primary] #new\n\n## Watch domains — quiet',
  );
  assert.doesNotMatch(check(two, config, plan).failures.join('\n'), /duplicate story key/);
});

// A shell variable that expanded to a space is empty too, and must not reach the file
// check with a nonsense path and a different message.
test('a whitespace-only flag value is refused as an empty value', () => {
  assert.throws(() => parseArgs(['d.md', '--plan', 'p.json', '--html', ' ']), /empty value for --html/);
  assert.throws(() => parseArgs(['d.md', '--plan', '\t', '--html', 'x.html']), /empty value for --plan/);
});

test('an empty --html value is rejected instead of disabling the check', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  const planPath = join(dir, 'plan.json');
  writeFileSync(mdPath, good);
  writeFileSync(planPath, JSON.stringify(plan));
  const result = gateCli([mdPath, '--plan', planPath, '--config', join(REPO, 'tests', 'fixtures', 'digest', 'config'), '--html', '']);
  assert.equal(result.code, 2);
  assert.match(result.out, /empty value for --html/);
});

test('a decoy section whose name contains core or watch does not collect items', () => {
  const decoy = good.replace(
    '## Coverage note',
    '## Scoreboard\n### AI / LLM · 人工智能 / 大模型\n- **A bullet** — text. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/s) [prov:primary] #new\n\n## Coverage note',
  );
  assert.equal(parseItems(decoy).filter((it) => it.section === 'Scoreboard').length, 0);
});

test('a deep_dive value outside the enum is a configuration error at the CLI', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  const planPath = join(dir, 'plan.json');
  writeFileSync(mdPath, good);
  writeFileSync(planPath, JSON.stringify(plan));
  const cfg = join(dir, 'config');
  cpSync(join(REPO, 'tests', 'fixtures', 'digest', 'config'), cfg, { recursive: true });
  const settingsPath = join(cfg, 'settings.md');
  writeFileSync(settingsPath, readFileSync(settingsPath, 'utf8').replace(/^\| deep_dive \|.*$/m, '| deep_dive | sometimes | fixture |'));
  const result = gateCli([mdPath, '--plan', planPath, '--config', cfg]);
  assert.equal(result.code, 2);
  assert.match(result.out, /deep_dive is "sometimes", which is not one of when-warranted, always, never/);
});

test('a deep_dive value outside the enum is a gate failure for library callers', () => {
  const bad = { ...config, settings: { ...settings, deep_dive: 'WHEN-WARRANTED' } };
  assert.match(
    check(good, bad, plan).failures.join('\n'),
    /deep_dive is "WHEN-WARRANTED", which is not one of when-warranted, always, never/,
  );
});