// tests/collect-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../scripts/lib/mdtable.mjs';
import {
  parseArgs, collectAll, sortCandidates, resolveOut, windowStart, resolveTimeout, noticeWarning, main,
} from '../scripts/collect.mjs';

const FIXTURE_CONFIG = fileURLToPath(new URL('./fixtures/config/', import.meta.url));
const SKILL_CONFIG = fileURLToPath(new URL('../config/', import.meta.url));

const config = {
  domains: [{ key: 'ai-llm', tier: 'core' }, { key: 'quantum', tier: 'watch' }],
  settings: {
    timezone: 'Asia/Shanghai', window_cap_weeks: 4, first_run_days: 7,
    discovery_hosts: 'news.ycombinator.com', user_agent: 'tech-radar/1.0',
    request_timeout_ms: 20000, title_max_chars: 200, summary_max_chars: 400,
    error_snippet_max_chars: 200,
  },
  sources: [],
  watchlist: [{ kind: 'rss', target: 'https://example.com/feed.xml', domain: 'ai-llm', note: '' }],
};

const net = {
  hostOf: () => 'example.com',
  fetchText: async () => [
    '<?xml version="1.0"?><rss><channel>',
    '<item><title>New model released</title><link>https://example.com/a</link>',
    '<pubDate>Mon, 21 Sep 2026 09:00:00 GMT</pubDate><description>A release.</description></item>',
    '<item><title>Too old</title><link>https://example.com/b</link>',
    '<pubDate>Mon, 01 Jan 2024 09:00:00 GMT</pubDate><description>Old.</description></item>',
    '</channel></rss>',
  ].join(''),
};

test('parseArgs reads flags and rejects an unknown flag', () => {
  const a = parseArgs(['--config', 'config', '--since', '2026-09-16T00:00:00Z', '--out', 'pool.json']);
  assert.equal(a.config, 'config');
  assert.equal(a.since, '2026-09-16T00:00:00.000Z', 'stored normalised, never raw');
  assert.equal(a.human, false);
  assert.throws(() => parseArgs(['--nope']), /unknown flag/);
});

test('parseArgs leaves the output path unset and accepts --human', () => {
  const a = parseArgs(['--human']);
  assert.equal(a.out, null, 'the pool path is resolved against the config, not in parseArgs');
  assert.equal(a.human, true);
  assert.equal(parseArgs(['--out', 'pool.json']).out, 'pool.json');
});

test('resolveOut lets TECH_RADAR_DIR override the configured output_dir', () => {
  const settings = { output_dir: './from-settings' };
  const previous = process.env.TECH_RADAR_DIR;
  try {
    delete process.env.TECH_RADAR_DIR;
    assert.equal(resolveOut({ out: null }, settings), join('./from-settings', '.pool.json'));
    process.env.TECH_RADAR_DIR = 'from-the-environment';
    assert.equal(resolveOut({ out: null }, settings), join('from-the-environment', '.pool.json'));
    assert.equal(resolveOut({ out: 'explicit.json' }, settings), 'explicit.json', '--out still wins');
  } finally {
    if (previous === undefined) delete process.env.TECH_RADAR_DIR;
    else process.env.TECH_RADAR_DIR = previous;
  }
});

test('windowStart reads window_cap_weeks instead of a literal fallback', () => {
  const now = new Date('2026-09-23T00:00:00.000Z');
  assert.equal(windowStart({ window_cap_weeks: 4 }, now), '2026-08-26T00:00:00.000Z');
  assert.equal(windowStart({ window_cap_weeks: 2 }, now), '2026-09-09T00:00:00.000Z');
  assert.throws(() => windowStart({}, now), /window_cap_weeks/);
  assert.throws(() => windowStart({ window_cap_weeks: 0 }, now), /window_cap_weeks/);
});

test('parseArgs rejects an unparseable --since or --until', () => {
  assert.throws(() => parseArgs(['--since', 'abc']), /invalid --since: abc/);
  assert.throws(() => parseArgs(['--until', 'soon']), /invalid --until: soon/);
  assert.equal(parseArgs(['--since', '2026-09-16T00:00:00Z']).since, '2026-09-16T00:00:00.000Z');
});

test('parseArgs rejects a non-finite timeout and an empty domain list', () => {
  assert.throws(() => parseArgs(['--timeout', 'abc']), /invalid --timeout: abc/);
  assert.throws(() => parseArgs(['--timeout', '']), /invalid --timeout/);
  assert.throws(() => parseArgs(['--domain', '']), /invalid --domain/);
  assert.throws(() => parseArgs(['--domain', ',']), /invalid --domain/);
  assert.deepEqual(parseArgs(['--domain', 'ai-llm, quantum']).domain, ['ai-llm', 'quantum']);
});

test('collectAll keeps only candidates inside the window', async () => {
  const pool = await collectAll(config, {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', net,
  });
  assert.equal(pool.candidates.length, 1);
  assert.equal(pool.candidates[0].title, 'New model released');
  assert.equal(pool.candidates[0].domain, 'ai-llm');
  assert.equal(pool.candidates[0].tierHint, 'primary');
  assert.deepEqual(pool.notices, []);
});

test('collectAll turns a failing source into a notice, not a throw', async () => {
  const bad = { ...net, fetchText: async () => { throw new Error('curl: (6) could not resolve host'); } };
  const pool = await collectAll(config, {
    since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', net: bad,
  });
  assert.equal(pool.candidates.length, 0);
  assert.equal(pool.notices.length, 1);
  assert.match(pool.notices[0], /rss https:\/\/example\.com\/feed\.xml/);
});

test('sortCandidates orders newest first and drops duplicates by url', () => {
  const out = sortCandidates([
    { url: 'a', publishedAt: '2026-09-20T00:00:00Z' },
    { url: 'b', publishedAt: '2026-09-22T00:00:00Z' },
    { url: 'a', publishedAt: '2026-09-20T00:00:00Z' },
  ]);
  assert.deepEqual(out.map((c) => c.url), ['b', 'a']);
});

// An undated tag lead has no window position; String(null) sorts after every ISO date,
// which used to put the least informative candidates at the head of the pool.
test('sortCandidates puts dated candidates first and undated leads last', () => {
  const out = sortCandidates([
    { url: 'undated-a', publishedAt: null, undated: true },
    { url: 'dated-old', publishedAt: '2026-09-20T00:00:00Z' },
    { url: 'dated-new', publishedAt: '2026-09-22T00:00:00Z' },
    { url: 'undated-b', publishedAt: null, undated: true },
  ]);
  assert.deepEqual(out.map((c) => c.url), ['dated-new', 'dated-old', 'undated-a', 'undated-b']);
});

test('main creates the pool directory recursively and writes the pool', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-pool-'));
  const out = join(dir, 'nested', 'deeper', '.pool.json');
  const logged = console.log;
  console.log = () => {};
  let code;
  try {
    // ai-llm matches no row of the fixture watchlist, so this stays offline; the
    // fixture settings carry only what the fixture needs, hence the explicit timeout.
    code = await main([
      '--config', FIXTURE_CONFIG, '--domain', 'ai-llm', '--timeout', '20000',
      '--since', '2026-09-16T00:00:00Z', '--out', out,
    ]);
  } finally {
    console.log = logged;
  }
  assert.equal(code, 0);
  const pool = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(pool.version, 1);
  assert.deepEqual(pool.candidates, []);
  assert.deepEqual(pool.notices, []);
  rmSync(dir, { recursive: true, force: true });
});

test('parseArgs defaults --config to the config directory beside the script', () => {
  assert.equal(parseArgs([]).config, SKILL_CONFIG);
  assert.equal(parseArgs(['--config', '/elsewhere']).config, '/elsewhere', 'the flag still overrides');
});

test('the CLI finds the skill config from a different working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-cwd-'));
  const out = join(dir, '.pool.json');
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  // photonics is a real catalogue key that no shipped watchlist row uses, so the
  // run resolves the skill's own config from a foreign cwd and still makes no call.
  const res = spawnSync(process.execPath, [
    cli, '--domain', 'photonics', '--since', '2026-09-16T00:00:00Z', '--out', out,
  ], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 0, 'stderr: ' + res.stderr);
  const pool = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(pool.candidates, []);
  assert.deepEqual(pool.notices, [], 'no source ran, so no notice is expected');
  rmSync(dir, { recursive: true, force: true });
});

test('the eess.SP listing is collected under a domain that describes signal processing', () => {
  const real = readConfig(SKILL_CONFIG);
  const row = real.watchlist.find((r) => r.kind === 'arxiv-category' && r.target === 'eess.SP');
  assert.ok(row, 'eess.SP is still watched');
  assert.equal(row.domain, 'networking', 'signal processing is not power electronics');
  assert.ok(real.domains.some((d) => d.key === row.domain), 'the domain exists in the catalogue');
});

test('resolveTimeout prefers an explicit --timeout and otherwise reads the setting', () => {
  assert.equal(resolveTimeout({ timeout: 1234 }, { request_timeout_ms: 20000 }), 1234);
  assert.equal(resolveTimeout({ timeout: null }, { request_timeout_ms: 7500 }), 7500);
  assert.throws(() => resolveTimeout({ timeout: null }, {}), /request_timeout_ms/);
});

test('main rejects an unknown --domain instead of reporting a quiet week', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-domain-'));
  const out = join(dir, '.pool.json');
  const errors = [];
  const logged = console.log;
  const failed = console.error;
  const savedExit = process.exitCode;
  console.log = () => {};
  console.error = (...a) => errors.push(a.join(' '));
  let code;
  try {
    code = await main([
      '--config', FIXTURE_CONFIG, '--domain', 'ai-llm,quantumm', '--timeout', '20000', '--out', out,
    ]);
  } finally {
    console.log = logged;
    console.error = failed;
    process.exitCode = savedExit; // main() signals failure through the process, not the caller
  }
  assert.equal(code, 2, 'a typo is a configuration error, not an empty week');
  assert.match(errors.join('\n'), /unknown domain key\(s\): quantumm/);
  rmSync(dir, { recursive: true, force: true });
});

test('no Chinese-language registry row names a Latin-only source', () => {
  // The gate splits a row's source string on commas, so every name in a lang: zh row
  // is treated as a Chinese source; a Latin name there fails a legitimate English
  // item cited to it.
  const real = readConfig(SKILL_CONFIG);
  const mixed = real.sources
    .filter((r) => r.lang === 'zh')
    .flatMap((r) => r.source.split(',').map((x) => x.trim()).filter(Boolean))
    .filter((name) => !/[\u4e00-\u9fff]/.test(name));
  assert.deepEqual(mixed, [], 'names in a zh row that name a Latin page: ' + mixed.join(', '));
});

test('noticeWarning names the count and the Coverage-note contract in one line', () => {
  assert.equal(noticeWarning(1),
    "collect: 1 source notice (GitHub rate limit and others) — the digest's Coverage note must report them; Collector notices: 1");
  assert.equal(noticeWarning(52),
    "collect: 52 source notices (GitHub rate limit and others) — the digest's Coverage note must report them; Collector notices: 52");
});

test('a degraded pool writes one stderr line and leaves stdout byte-identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-notices-'));
  const cfg = join(dir, 'config');
  const out = join(dir, '.pool.json');
  mkdirSync(cfg, { recursive: true });
  for (const f of ['domains.md', 'settings.md', 'sources.md']) {
    copyFileSync(join(SKILL_CONFIG, f), join(cfg, f));
  }
  // One row that cannot be reached on loopback, so the run is offline and degraded.
  writeFileSync(join(cfg, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | http://127.0.0.1:1/feed.xml | ai-llm | deliberately unreachable |',
  ].join('\n') + '\n');

  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [cli, '--config', cfg, '--out', out, '--timeout', '2000'], { encoding: 'utf8' });
  assert.equal(res.status, 3, 'every source failed: the documented exit for that case');
  const lines = res.stderr.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1, 'exactly one line on stderr');
  assert.equal(lines[0],
    "collect: 1 source notice (GitHub rate limit and others) — the digest's Coverage note must report them; Collector notices: 1");
  const pool = JSON.parse(res.stdout);
  assert.equal(pool.notices.length, 1, 'the count in the line is the pool count');
  assert.equal(res.stdout, readFileSync(out, 'utf8'), 'stdout is unchanged: exactly the pool file');
  rmSync(dir, { recursive: true, force: true });
});

test('a clean pool writes nothing to stderr', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-quiet-'));
  const out = join(dir, '.pool.json');
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [
    cli, '--config', FIXTURE_CONFIG, '--domain', 'ai-llm', '--timeout', '20000',
    '--since', '2026-09-16T00:00:00Z', '--out', out,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '', 'a clean pool says nothing');
  assert.deepEqual(JSON.parse(res.stdout).notices, []);
  rmSync(dir, { recursive: true, force: true });
});

test('parseArgs normalises an offset-bearing window to ISO', () => {
  assert.equal(parseArgs(['--until', '2026-09-09T18:00:00+08:00']).until, '2026-09-09T10:00:00.000Z');
  assert.equal(parseArgs(['--since', '2026-09-09T18:00:00+08:00']).since, '2026-09-09T10:00:00.000Z');
  assert.equal(parseArgs(['--since', '2020-01-01']).since, '2020-01-01T00:00:00.000Z');
});

test('an offset-bearing window collects exactly what its Z spelling collects', async () => {
  const feed = [
    '<rss><channel>',
    '<item><title>Before</title><link>https://example.com/before</link>',
    '<pubDate>Wed, 09 Sep 2026 09:00:00 GMT</pubDate></item>',
    '<item><title>After</title><link>https://example.com/after</link>',
    '<pubDate>Wed, 09 Sep 2026 11:00:00 GMT</pubDate></item>',
    '</channel></rss>',
  ].join('');
  const cfg = { ...config, watchlist: [{ kind: 'rss', target: 'https://example.com/feed.xml', domain: 'ai-llm', note: '' }] };
  const net = { fetchText: async () => feed };
  const utc = await collectAll(cfg, { since: '2020-01-01', until: '2026-09-09T10:00:00Z', net });
  const offset = await collectAll(cfg, { since: '2020-01-01', until: '2026-09-09T18:00:00+08:00', net });
  assert.deepEqual(utc.candidates.map((x) => x.url), ['https://example.com/before']);
  assert.deepEqual(offset.candidates.map((x) => x.url), utc.candidates.map((x) => x.url), 'same instant, same pool');
  const laterUtc = await collectAll(cfg, { since: '2026-09-09T10:00:00Z', until: '2026-12-01T00:00:00Z', net });
  const laterOffset = await collectAll(cfg, { since: '2026-09-09T18:00:00+08:00', until: '2026-12-01T00:00:00Z', net });
  assert.deepEqual(laterUtc.candidates.map((x) => x.url), ['https://example.com/after']);
  assert.deepEqual(laterOffset.candidates.map((x) => x.url), laterUtc.candidates.map((x) => x.url), 'both directions');
});

test('parseArgs rejects an empty --out instead of silently ignoring it', () => {
  assert.throws(() => parseArgs(['--out', '']), /invalid --out/);
  assert.throws(() => parseArgs(['--out', '   ']), /invalid --out/);
});

test('an inverted window is refused, not reported as a quiet week', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-inverted-'));
  const out = join(dir, '.pool.json');
  const errors = [];
  const logged = console.log;
  const failed = console.error;
  const savedExit = process.exitCode;
  console.log = () => {};
  console.error = (...a) => errors.push(a.join(' '));
  let code;
  try {
    code = await main(['--config', FIXTURE_CONFIG, '--domain', 'ai-llm', '--timeout', '20000',
      '--until', '2020-01-01T00:00:00Z', '--out', out]);
  } finally {
    console.log = logged;
    console.error = failed;
    process.exitCode = savedExit;
  }
  assert.equal(code, 2);
  assert.match(errors.join('\n'), /is after --until .*the window is empty/);
  rmSync(dir, { recursive: true, force: true });
});

// A settings file without output_dir reached join() as undefined, so main() died with an
// uncaught TypeError: a bare exit 1 and a stack trace, not the named exit 2 every other
// missing setting produces - and the usage's claim that no shipped path reaches 1 was false.
test('a settings file with no output_dir is a named configuration error, exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-nodir-'));
  for (const name of ['domains.md', 'sources.md', 'watchlist.md', 'settings.md']) copyFileSync(join(SKILL_CONFIG, name), join(dir, name));
  const settings = readFileSync(join(SKILL_CONFIG, 'settings.md'), 'utf8')
    .split('\n').filter((l) => !/^\|\s*output_dir\s*\|/.test(l)).join('\n');
  writeFileSync(join(dir, 'settings.md'), settings);
  assert.equal(/output_dir/.test(settings), false, 'the fixture really omits it');
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [cli, '--config', dir], { encoding: 'utf8' });
  assert.equal(res.status, 2, 'exit 2, not a TypeError: ' + res.stderr.slice(0, 200));
  assert.match(res.stderr, /collect: output_dir is missing or invalid in config\/settings\.md/);
  assert.doesNotMatch(res.stderr, /TypeError|at join|node:path/, 'no stack trace');
  rmSync(dir, { recursive: true, force: true });
});

test('the usage text states the rule the code implements', () => {
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [cli, '-h'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /3 the pool came back empty\s+and at least one notice was recorded/);
  assert.doesNotMatch(res.stdout, /every source failed/);
});
