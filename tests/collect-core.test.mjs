// tests/collect-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../scripts/lib/mdtable.mjs';
import {
  parseArgs, collectAll, sortCandidates, resolveOut, windowStart, resolveTimeout, noticeWarning, humanSummary, main,
} from '../scripts/collect.mjs';
import { shapeHttpError } from '../scripts/lib/net.mjs';
import { curlAvailable } from './lib/commands.mjs';

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

test('a degraded pool writes one stderr line and leaves stdout byte-identical', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-notices-'));
  try {
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
    const pool = JSON.parse(res.stdout);
    assert.equal(pool.notices.length, 1, 'the count in the line is the pool count');
    assert.equal(res.stdout, readFileSync(out, 'utf8'), 'stdout is unchanged: exactly the pool file');
    // The exact line repeats the transport reason the notice carries. A refused connection on
    // loopback is curl exit 7, and the shaper publishes that mapped cause as
    // 'failed to connect (curl exit 7)', which the line appends; the pattern matches the mapped
    // cause with its exit suffix, so the reason is repeated for every cause the shaper can build
    // and not only for the three fallbacks (LV-2). Where curl cannot be started the notice names
    // the missing binary and the line carries that cause instead, which is another case's
    // subject. The structure above -- one line, one notice, byte-identical stdout -- is asserted
    // either way.
    if (!curlAvailable()) {
      t.skip('curl is not on PATH, so the failed transport carries the missing-binary cause');
      return;
    }
    assert.equal(lines[0],
      "collect: 1 source notice (GitHub rate limit and others) — the digest's Coverage note must report them; Collector notices: 1 (failed to connect (curl exit 7))");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test('the usage text states the rule the code implements', () => {
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [cli, '-h'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /3 the pool came back empty\s+and at least one notice was recorded/);
  assert.doesNotMatch(res.stdout, /every source failed/);
});

// Regression test: collect validated its settings only where each was first used and
// swallowed the throw into a notice, so an invalid configuration reported a degraded week
// (exit 3) with a script-internal message instead of naming the setting. update-state
// validates its own settings up front with exit 2; the collector now does the same.
test('a settings file without title_max_chars is a named exit 2, not a degraded week', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-setting-'));
  for (const name of ['domains.md', 'sources.md', 'watchlist.md', 'settings.md']) {
    copyFileSync(join(SKILL_CONFIG, name), join(dir, name));
  }
  const settings = readFileSync(join(SKILL_CONFIG, 'settings.md'), 'utf8')
    .split('\n').filter((l) => !/^\|\s*title_max_chars\s*\|/.test(l)).join('\n');
  writeFileSync(join(dir, 'settings.md'), settings);
  assert.equal(/title_max_chars/.test(settings), false, 'the fixture really omits it');
  // One offline row only: without it the collector would reach the live watchlist while
  // the defect is still present, which is the 138-second failure this case used to have.
  writeFileSync(join(dir, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | http://127.0.0.1:1/feed.xml | ai-llm | deliberately unreachable |',
    '',
  ].join('\n'));
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [cli, '--config', dir, '--out', join(dir, '.pool.json'), '--timeout', '2000'], { encoding: 'utf8' });
  assert.equal(res.status, 2, 'a configuration error is exit 2, not 3: ' + res.stderr.slice(0, 300));
  assert.match(res.stderr, /title_max_chars/, 'the refused setting is named');
  assert.doesNotMatch(res.stderr, /must be a positive number, got undefined/, 'no script-internal message');
  rmSync(dir, { recursive: true, force: true });
});

// Regression test: --config had no empty-value guard while its sibling flags did, so an
// empty value resolved the configuration against the current directory: join('', ...)
// degrades to a cwd-relative path, and from a cwd holding a config directory the run went
// ahead and wrote a pool from that config, though design 4.2 makes an empty flag value an
// exit-2 configuration error.
test('parseArgs refuses an empty --config instead of resolving it against the cwd', () => {
  assert.throws(() => parseArgs(['--config', '']), /empty value for --config/);
  assert.throws(() => parseArgs(['--config', ' ']), /empty value for --config/);
  assert.throws(() => parseArgs(['--config', '\t']), /empty value for --config/);
  assert.equal(parseArgs(['--config', '/elsewhere']).config, '/elsewhere', 'a real value still reads');
});

test('the collect CLI exits 2 for an empty --config even when the cwd holds a config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-empty-config-'));
  const cfg = join(dir, 'config');
  mkdirSync(cfg, { recursive: true });
  for (const name of ['domains.md', 'settings.md', 'sources.md', 'watchlist.md']) {
    copyFileSync(join(SKILL_CONFIG, name), join(cfg, name));
  }
  writeFileSync(join(cfg, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | http://127.0.0.1:1/feed.xml | ai-llm | deliberately unreachable |',
    '',
  ].join('\n'));
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [cli, '--config', '', '--timeout', '2000', '--out', join(dir, '.pool.json')],
    { encoding: 'utf8', cwd: dir });
  assert.equal(existsSync(join(dir, '.pool.json')), false, 'no pool is written from the cwd-relative config');
  assert.equal(res.status, 2, 'the empty value is refused: ' + res.stderr.slice(0, 200));
  assert.match(res.stderr, /empty value for --config/);
  rmSync(dir, { recursive: true, force: true });
});

// Regression test: the case that asserted the missing-output_dir error was not hermetic -
// it never cleared the variable its sibling saves and restores. With TECH_RADAR_DIR exported,
// a full live watchlist collection ran instead: 211 seconds and an 853 KB pool written into
// the override. The repair is to make the case hermetic, not to change which value decides.
// SKILL.md and design 3.4/6 give the environment variable precedence over the configured
// directory, so the two branches are pinned separately.
//
// (a) No output_dir and no usable override: the named configuration error, and no request.
// This case and (b) replace the superseded single case whose spawn inherited the environment:
// with the variable exported it asserted exit 2, got 0 and ran a full live collection.
test('a settings file with no output_dir and no usable override is a named exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-envunset-'));
  for (const name of ['domains.md', 'sources.md', 'watchlist.md', 'settings.md']) {
    copyFileSync(join(SKILL_CONFIG, name), join(dir, name));
  }
  const settings = readFileSync(join(SKILL_CONFIG, 'settings.md'), 'utf8')
    .split('\n').filter((l) => !/^\|\s*output_dir\s*\|/.test(l)).join('\n');
  writeFileSync(join(dir, 'settings.md'), settings);
  assert.equal(/output_dir/.test(settings), false, 'the fixture really omits it');
  const mark = join(dir, 'curl-was-called');
  writeFileSync(join(dir, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | https://example.invalid/feed.xml | ai-llm | the stub answers this |',
    '',
  ].join('\n'));
  const { bin } = curlStub(dir, mark);
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const started = Date.now();
  const res = spawnSync(process.execPath, [cli, '--config', dir], {
    encoding: 'utf8',
    // An exported empty variable is this test's own environment, not configuration.
    env: { ...process.env, TECH_RADAR_DIR: '', PATH: bin + ':' + process.env.PATH },
  });
  assert.equal(res.status, 2, 'the missing setting is a named error: ' + res.stderr.slice(0, 200));
  assert.match(res.stderr, /collect: output_dir is missing or invalid in config\/settings\.md/);
  assert.doesNotMatch(res.stderr, /TypeError|at join|node:path/, 'a named error, not a stack trace');
  assert.equal(existsSync(join(dir, '.pool.json')), false, 'no pool is written');
  assert.equal(existsSync(mark), false, 'no source request was made');
  assert.ok(Date.now() - started < 15000, 'the case is offline and bounded');
  rmSync(dir, { recursive: true, force: true });
});

// (b) The override is set, so it decides: the run proceeds and the pool lands under it, which
// is what SKILL.md and design 3.4/6 document. A stub curl answers one empty feed, so the run
// is offline and its one request is recorded.
test('a settings file with no output_dir still runs under a set TECH_RADAR_DIR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-envset-'));
  for (const name of ['domains.md', 'sources.md', 'watchlist.md', 'settings.md']) {
    copyFileSync(join(SKILL_CONFIG, name), join(dir, name));
  }
  const settings = readFileSync(join(SKILL_CONFIG, 'settings.md'), 'utf8')
    .split('\n').filter((l) => !/^\|\s*output_dir\s*\|/.test(l)).join('\n');
  writeFileSync(join(dir, 'settings.md'), settings);
  const mark = join(dir, 'curl-was-called');
  writeFileSync(join(dir, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | https://blog.example/feed.xml | ai-llm | the stub answers this |',
    '',
  ].join('\n'));
  const { bin } = curlStub(dir, mark);
  const override = join(dir, 'radar-dir');
  mkdirSync(override, { recursive: true });
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [cli, '--config', dir], {
    encoding: 'utf8',
    env: { ...process.env, TECH_RADAR_DIR: override, PATH: bin + ':' + process.env.PATH },
  });
  assert.equal(res.status, 0, 'the override decides the directory: ' + res.stderr.slice(0, 300));
  const pool = JSON.parse(readFileSync(join(override, '.pool.json'), 'utf8'));
  assert.deepEqual(pool.candidates, [], 'the stub answered an empty feed');
  assert.deepEqual(pool.notices, []);
  assert.equal(existsSync(mark), true, 'the run really collected, under the override');
  assert.equal(existsSync(join(dir, '.pool.json')), false, 'nothing lands beside the configuration');
  rmSync(dir, { recursive: true, force: true });
});

// A curl stub on PATH: it records that it was called and answers an empty RSS channel, so
// a case that must stay offline cannot reach a live source if the code under test changes.
function curlStub(dir, mark) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'curl'), [
    '#!/bin/sh',
    ': > ' + JSON.stringify(mark),
    "printf '%s\\n%s' '<rss><channel></channel></rss>' '200'",
    '',
  ].join('\n'));
  chmodSync(join(bin, 'curl'), 0o755);
  return { bin, mark };
}

// The --human summary is documented in the usage and was exercised by no test.
test('humanSummary prints the window, the per-domain counts and every notice', () => {
  const summary = humanSummary({
    generatedAt: '2026-09-23T01:00:00.000Z',
    window: { since: '2026-09-16T01:00:00.000Z', until: '2026-09-23T01:00:00.000Z' },
    candidates: [
      { domain: 'ai-llm', url: 'https://example.com/a', title: 'A' },
      { domain: 'ai-llm', url: 'https://example.com/b', title: 'B' },
      { domain: 'quantum', url: 'https://example.com/c', title: 'C' },
    ],
    notices: ['rss https://example.com/feed.xml: curl: (7) refused'],
  });
  assert.match(summary, /tech-radar collect {2}2026-09-23T01:00:00\.000Z/);
  assert.match(summary, /window: 2026-09-16T01:00:00\.000Z \.\. 2026-09-23T01:00:00\.000Z/);
  assert.match(summary, /candidates: 3/);
  assert.match(summary, /ai-llm: 2/);
  assert.match(summary, /quantum: 1/);
  assert.match(summary, /notices: 1/);
  assert.match(summary, /- rss https:\/\/example\.com\/feed\.xml: curl: \(7\) refused/);
});

test('--human prints the summary instead of the JSON pool', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-human-'));
  const out = join(dir, '.pool.json');
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [
    cli, '--config', FIXTURE_CONFIG, '--domain', 'ai-llm', '--timeout', '20000',
    '--since', '2026-09-16T00:00:00Z', '--out', out, '--human',
  ], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^tech-radar collect {2}/);
  assert.match(res.stdout, /candidates: 0/);
  assert.doesNotMatch(res.stdout, /^\{/, 'the JSON pool is not printed with --human');
  const pool = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(pool.candidates, [], 'the pool file is still written');
  rmSync(dir, { recursive: true, force: true });
});

// Regression test: the collector wrote its pool in place, so a failed or interrupted write
// destroyed the previous pool - the atomic temp-then-rename the state writer uses had never
// reached this writer. A replacement is published by a rename, and a refused write leaves the
// previous pool intact with no temp behind.
test('the collector replaces its pool atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-atomic-pool-'));
  const out = join(dir, '.pool.json');
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  const args = [cli, '--config', FIXTURE_CONFIG, '--domain', 'ai-llm', '--timeout', '20000',
    '--since', '2026-09-16T00:00:00Z', '--out', out];
  writeFileSync(out, 'the previous pool\n');
  const before = statSync(out).ino;
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.notEqual(statSync(out).ino, before,
    'the pool is published by a rename, not truncated in place');
  const published = readFileSync(out, 'utf8');
  chmodSync(out, 0o444);
  try {
    const refused = spawnSync(process.execPath, args, { encoding: 'utf8' });
    if (refused.status !== 0) {
      assert.equal(refused.status, 4, 'a refused write is the documented output exit: ' + refused.stderr);
      assert.equal(readFileSync(out, 'utf8'), published, 'the previous pool survives intact');
    }
  } finally {
    chmodSync(out, 0o644);
  }
  const leftovers = readdirSync(dir).filter((name) => name !== '.pool.json');
  assert.deepEqual(leftovers, [], 'no temp file is left behind: ' + leftovers.join(', '));
  rmSync(dir, { recursive: true, force: true });
});

// TR-80 regression test: the atomic pool writer publishes by renaming, and a rename needs
// only the destination directory - so a pool the operator had protected with a cleared write
// bit was replaced anyway. The state writer refuses exactly that ("the rename itself needs
// only the directory and would otherwise replace a file the operator protected"), and the
// batch that made the three writers agree on the mode rule claimed the agreement without it.
// A protected destination is refused at the documented output exit and keeps its bytes.
test('the collector refuses a write-protected pool and leaves it byte-identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-protected-pool-'));
  try {
    const out = join(dir, '.pool.json');
    const published = 'the previous pool\n';
    writeFileSync(out, published);
    chmodSync(out, 0o444);
    const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
    let res;
    try {
      res = spawnSync(process.execPath, [cli, '--config', FIXTURE_CONFIG, '--domain', 'ai-llm',
        '--timeout', '20000', '--since', '2026-09-16T00:00:00Z', '--out', out], { encoding: 'utf8' });
    } finally {
      chmodSync(out, 0o644);
    }
    assert.equal(res.status, 4, 'a protected pool is the documented output exit: ' + res.stderr);
    assert.equal(readFileSync(out, 'utf8'), published, 'the previous pool survives byte-identically');
    const leftovers = readdirSync(dir).filter((name) => name !== '.pool.json');
    assert.deepEqual(leftovers, [], 'no temp file is left behind: ' + leftovers.join(', '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression test: an absent pool is not a protected one. The atomic writer resolved a
// missing destination to 0600, so the first render of a digest produced an owner-only file
// under the usual umask - narrower than the plain write it replaced, and awkward to forward
// and open. A fresh destination must be born with the mode a plain write would give it.
// The control file is written plainly by this same process, so the assertion holds under
// whatever umask the run inherits rather than pinning one value.
test('the collector gives a fresh pool the mode a plain write would', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-mode-pool-fresh-'));
  try {
    const out = join(dir, '.pool.json');
    const control = join(dir, 'control.txt');
    writeFileSync(control, 'a plain write by this process\n');
    const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
    const res = spawnSync(process.execPath, [cli, '--config', FIXTURE_CONFIG, '--domain', 'ai-llm',
      '--timeout', '20000', '--since', '2026-09-16T00:00:00Z', '--out', out], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(statSync(out).mode & 0o777, statSync(control).mode & 0o777,
      'a fresh pool is created with the process default, not an owner-only 0600: '
      + (statSync(out).mode & 0o777).toString(8));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression test: the atomic pool writer created its temp with the process default and
// renamed it over the destination, so a pool the operator had tightened came back at the
// umask's 0664 - the very class of mode loss the state writer had already been fixed for.
// A replacement must carry the mode of the file it replaces.
test('the collector keeps the mode of the pool it replaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-mode-pool-'));
  const out = join(dir, '.pool.json');
  const cli = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
  writeFileSync(out, 'the previous pool\n');
  chmodSync(out, 0o600);
  const res = spawnSync(process.execPath, [cli, '--config', FIXTURE_CONFIG, '--domain', 'ai-llm',
    '--timeout', '20000', '--since', '2026-09-16T00:00:00Z', '--out', out], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(statSync(out).mode & 0o777, 0o600,
    'the pool keeps the mode it was protected with, not the umask: '
    + (statSync(out).mode & 0o777).toString(8));
  rmSync(dir, { recursive: true, force: true });
});

// TR-101 regression test: the run-wide redaction union reaped the collector's own configured
// values. Every value a request carried in its URL was collected without the length floor, so
// the numbers the shipped configuration sends - max_results 40, per_page 10 - entered the union
// and were then replaced wherever they stood alone, inside notices the collector itself wrote:
// the arXiv cap notice read "capped at [redacted] entries", and the GitHub budget notice's reset
// instant read "2026-[redacted]-15T18:18:21.000Z". The notice is the run's only account of the
// degradation, so neither may be damaged, while a credential the request actually sent must
// still go. This drives the composed published path - collectAll, whose final pass redacts every
// notice against the union of every request the run issued - rather than the notice builder, so
// the redaction pass is on the way.
test('the run-wide redaction keeps configured values and still removes credentials', async () => {
  const resetIso = '2026-10-15T18:18:21.000Z';
  const settings = {
    timezone: 'Asia/Shanghai', window_cap_weeks: 4, first_run_days: 7,
    discovery_hosts: 'news.ycombinator.com', user_agent: 'tech-radar/1.0',
    request_timeout_ms: 20000, title_max_chars: 200, summary_max_chars: 400,
    error_snippet_max_chars: 200,
    github_org_repos: 10, github_releases_per_repo: 10, github_tags_per_repo: 5,
    github_rate_limit_reserve: 0, arxiv_max_results: 40, ghsa_page_size: 50, nvd_severity: 'HIGH',
  };
  const watchlist = [
    ...Array.from({ length: 5 }, (_, i) => (
      { kind: 'github-repo', target: 'org/repo' + i, domain: 'ai-llm', note: '' }
    )),
    { kind: 'arxiv-category', target: 'cs.AI', domain: 'ai-llm', note: '' },
    // A short credential in a credential-named parameter and a short userinfo password: the
    // floor has to keep covering these, so the fix cannot simply raise it for every value.
    { kind: 'rss', target: 'https://feeduser:pw1@feeds.example/echo.xml?auth_token=TK1234', domain: 'ai-llm', note: '' },
  ];
  const entries = Array.from({ length: 40 }, (_, i) => '<entry><title>Paper ' + i + '</title>'
    + '<link rel="alternate" href="http://arxiv.org/abs/2609.' + (10000 + i) + 'v1"/>'
    + '<published>2026-09-20T01:00:00Z</published><summary>s</summary></entry>').join('');
  const net = {
    hostOf: (url) => new URL(url).host,
    isDiscoveryOnly: () => false,
    fetchText: async (url) => {
      if (url === 'https://api.github.com/rate_limit') {
        return JSON.stringify({ resources: { core: { limit: 60, remaining: 3, reset: Math.floor(Date.parse(resetIso) / 1000) } } });
      }
      if (url.includes('/releases') || url.includes('/tags')) return '[]';
      if (url.startsWith('https://export.arxiv.org/api/query')) return '<feed>' + entries + '</feed>';
      if (url.includes('feeds.example')) {
        throw shapeHttpError(500,
          Buffer.from('upstream rejected auth_token=TK1234 for the user with password pw1'), url, 200);
      }
      throw new Error('unexpected request: ' + url);
    },
  };
  const previous = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  let pool;
  try {
    pool = await collectAll({ settings, watchlist },
      { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', net });
  } finally {
    if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
  }
  const budget = pool.notices.find((n) => n.startsWith('github: rate limit reached'));
  assert.ok(budget, 'the budget notice is published: ' + JSON.stringify(pool.notices));
  assert.match(budget, /resets \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
    'the reset instant must survive whole: ' + budget);
  assert.doesNotMatch(budget, /\[redacted\]/, 'a configured value was reaped from the budget notice: ' + budget);
  const capped = pool.notices.find((n) => /listing capped at/.test(n));
  assert.ok(capped, 'the cap notice is published: ' + JSON.stringify(pool.notices));
  assert.match(capped, new RegExp('listing capped at ' + settings.arxiv_max_results + ' entries'),
    'the capped count must survive: ' + capped);
  assert.doesNotMatch(capped, /\[redacted\]/, 'a configured value was reaped from the cap notice: ' + capped);
  const published = JSON.stringify(pool);
  assert.equal(published.includes('TK1234'), false,
    'the query credential reached the pool: ' + published.slice(0, 400));
  assert.equal(published.includes('pw1'), false,
    'the userinfo password reached the pool: ' + published.slice(0, 400));
});

// TR-110 regression test: the union applied to the candidate fields held every ordinary query
// value above the floor, so the collector's own arXiv request (sortOrder=descending,
// search_query=cat:cs.AI) reaped a published word from a candidate summary in the shipped
// configuration. Candidate fields are redacted against the credential-only union, never
// against a value that is merely ordinary configuration.
test('an ordinary request value does not reap a candidate summary', async () => {
  const settings = {
    timezone: 'Asia/Shanghai', window_cap_weeks: 4, first_run_days: 7,
    discovery_hosts: 'news.ycombinator.com', user_agent: 'tech-radar/1.0',
    request_timeout_ms: 20000, title_max_chars: 200, summary_max_chars: 400,
    error_snippet_max_chars: 200,
    github_org_repos: 10, github_releases_per_repo: 10, github_tags_per_repo: 5,
    github_rate_limit_reserve: 0, arxiv_max_results: 40, ghsa_page_size: 50, nvd_severity: 'HIGH',
  };
  const watchlist = [
    { kind: 'arxiv-category', target: 'cs.AI', domain: 'ai-llm', note: '' },
    { kind: 'rss', target: 'https://blog.example/feed.xml', domain: 'ai-llm', note: '' },
  ];
  const summary = 'We sort the results in descending order and report the outcome.';
  const net = {
    hostOf: (url) => new URL(url).host,
    isDiscoveryOnly: () => false,
    fetchText: async (url) => {
      if (url.includes('/rate_limit')) {
        return JSON.stringify({ resources: { core: { limit: 60, remaining: 60, reset: 0 } } });
      }
      if (url.startsWith('https://export.arxiv.org/api/query')) {
        return '<feed><entry><title>Paper</title>'
          + '<link rel="alternate" href="http://arxiv.org/abs/2609.01234v1"/>'
          + '<published>2026-09-20T01:00:00Z</published><summary>' + summary + '</summary></entry></feed>';
      }
      if (url.includes('blog.example')) {
        return '<rss><channel><item><title>Post</title><link>https://blog.example/p</link>'
          + '<pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
          + '<description>' + summary + '</description></item></channel></rss>';
      }
      throw new Error('unexpected request: ' + url);
    },
  };
  const previous = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  let pool;
  try {
    pool = await collectAll({ settings, watchlist },
      { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z', net });
  } finally {
    if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
  }
  const sources = pool.candidates.map((c) => c.source);
  const rss = pool.candidates.find((c) => c.source.startsWith('rss:'));
  const arxiv = pool.candidates.find((c) => c.source.startsWith('arxiv:'));
  assert.ok(rss, 'the feed candidate is published: ' + JSON.stringify(sources));
  assert.ok(arxiv, 'the arxiv candidate is published: ' + JSON.stringify(sources));
  assert.equal(rss.summary, summary, 'the ordinary word survives in the feed summary: ' + rss.summary);
  assert.equal(arxiv.summary, summary, 'the ordinary word survives in the arxiv summary: ' + arxiv.summary);
});
