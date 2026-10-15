// tests/state-merge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { emptyState, mergeRun, storyKey, normalizeTitle, normalizeRunDate, findRecordedRun, main } from '../scripts/update-state.mjs';
import { SKILL_ROOT } from './lib/shipped-files.mjs';

const config = {
  domains: [
    { key: 'ai-llm', domain: 'AI / LLM' },
    { key: 'quantum', domain: 'Quantum technologies' },
  ],
  settings: { timezone: 'Asia/Shanghai', window_cap_weeks: 4, watchlist_retention_weeks: 4, runs_history_max: 52 },
};
const NOW = new Date('2026-09-23T09:00:00Z');
const item = {
  title: 'vLLM v0.11.0 released', domain: 'ai-llm', outlet: 'GitHub',
  primaryUrl: 'https://github.com/vllm-project/vllm/releases/tag/v0.11.0', flags: ['new'], watch: false,
};

test('normalizeTitle folds punctuation, case and spacing', () => {
  assert.equal(normalizeTitle('vLLM v0.11.0 — Released!'), 'vllm v0 11 0 released');
});

test('storyKey is stable across a punctuation-only headline change', () => {
  const a = storyKey('vLLM v0.11.0 Released', 'https://github.com/vllm-project/vllm/releases/tag/v0.11.0');
  const b = storyKey('vLLM v0.11.0 — released.', 'https://github.com/vllm-project/vllm/releases/tag/v0.11.0');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test('a first sighting is new, a second is a followup, and counters advance', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const first = mergeRun(config, s0, { items: [item], date: '2026-09-23', entry: 'weekly', now: NOW });
  assert.equal(first.results[0].status, 'new');
  const second = mergeRun(config, first.state, { items: [item], date: '2026-09-30', entry: 'weekly', now: new Date('2026-09-30T09:00:00Z') });
  assert.equal(second.results[0].status, 'followup');
  const entry = second.state.items[first.results[0].key];
  assert.equal(entry.timesSeen, 2);
  assert.equal(entry.lastSeen, '2026-09-30T09:00:00.000Z');
});

test('a full run advances every watermark and a focus run only its own', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const full = mergeRun(config, s0, { items: [], date: '2026-09-23', entry: 'weekly', now: NOW });
  assert.equal(full.state.domains['quantum'].lastCoveredAt, NOW.toISOString());
  const focus = mergeRun(config, full.state, { items: [], date: '2026-09-24', entry: 'focus', now: new Date('2026-09-24T09:00:00Z'), only: ['ai-llm'] });
  assert.equal(focus.state.domains['quantum'].lastCoveredAt, NOW.toISOString(), 'untouched by a focus run');
  assert.equal(focus.state.domains['ai-llm'].lastCoveredAt, '2026-09-24T09:00:00.000Z');
});

test('a watched item enters the watchlist and an inactive entry past retention is dropped', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const withWatch = mergeRun(config, s0, { items: [{ ...item, watch: true }], date: '2026-08-01', entry: 'weekly', now: new Date('2026-08-01T09:00:00Z') });
  assert.equal(withWatch.state.watchlist.length, 1);
  const later = mergeRun(config, withWatch.state, { items: [], date: '2026-09-23', entry: 'weekly', now: NOW });
  assert.equal(later.state.watchlist.length, 0, 'no activity and past retention');
});
// Coverage test for a branch nothing exercised: a watched item seen a second time
// updates its existing watchlist entry instead of appending a duplicate.
test('a watched item seen again updates its entry instead of adding one', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const first = mergeRun(config, s0, { items: [{ ...item, watch: true }], date: '2026-09-16', entry: 'weekly', now: new Date('2026-09-16T09:00:00Z') });
  assert.equal(first.state.watchlist.length, 1);
  const later = mergeRun(config, first.state, { items: [{ ...item, watch: true }], date: '2026-09-23', entry: 'weekly', now: NOW });
  assert.equal(later.state.watchlist.length, 1, 'one entry, not two');
  assert.equal(later.state.watchlist[0].timesSeen, 2);
  assert.equal(later.state.watchlist[0].lastSeen, NOW.toISOString());
});

// Coverage test for a branch nothing exercised: item history is pruned once an
// item has not been seen within the window cap.
test('an item not seen within the window cap is pruned from the history', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const first = mergeRun(config, s0, { items: [item], date: '2026-09-23', entry: 'weekly', now: NOW });
  assert.equal(Object.keys(first.state.items).length, 1);
  const later = mergeRun(config, first.state, { items: [], date: '2026-10-22', entry: 'weekly', now: new Date('2026-10-22T09:00:00Z') });
  assert.deepEqual(Object.keys(later.state.items), [], 'nolonger inside window_cap_weeks');
});

// Regression test: update --since recorded the raw floor in the run
// log while plan clamps the same floor by window_cap_weeks, so the state claimed
// coverage the run never had.
test('the run log records the clamped catch-up window, not the raw floor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-merge-'));
  const statePath = join(dir, 'state.json');
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, '[]');
  const orig = console.log;
  console.log = () => {};
  try {
    main(['update', '--state', statePath, '--items', itemsPath, '--out', statePath,
      '--date', '2026-09-23', '--since', '2026-01-01T00:00:00.000Z']);
  } finally {
    console.log = orig;
    process.exitCode = 0;
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const window = state.runs[0].window;
  assert.ok(window.since > '2026-01-01T00:00:00.000Z', 'the raw floor must not be recorded');
  const capFloor = new Date(Date.now() - 28 * 864e5).toISOString();
  assert.equal(window.since.slice(0, 10), capFloor.slice(0, 10), 'clamped by window_cap_weeks like plan');
});
// Regression test: the cap was inert unless the value happened to
// be a number, and nothing asserted that it trims anything.
test('the run log keeps only the newest runs_history_max entries', () => {
  const capped = { ...config, settings: { ...config.settings, runs_history_max: 2 } };
  let state = emptyState(['ai-llm', 'quantum']);
  for (const date of ['2026-09-09', '2026-09-16', '2026-09-23']) {
    state = mergeRun(capped, state, { items: [], date, entry: 'weekly', now: new Date(date + 'T09:00:00Z') }).state;
  }
  assert.equal(state.runs.length, 2, 'two runs kept');
  assert.deepEqual(state.runs.map((r) => r.date), ['2026-09-16', '2026-09-23'], 'the newest two');
});

test('a runs_history_max that is not a positive integer is an error, not a disabled cap', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  for (const bad of ['lots', 0, -1, 2.5, undefined]) {
    const settings = { ...config.settings, runs_history_max: bad };
    assert.throws(
      () => mergeRun({ ...config, settings }, s0, { items: [], date: '2026-09-23', entry: 'weekly', now: NOW }),
      /runs_history_max/,
      'runs_history_max=' + JSON.stringify(bad) + ' must throw',
    );
  }
});

test('update exits 2 with a clear message when runs_history_max is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-cap-'));
  const configDir = writeConfig(dir, { runs_history_max: 'lots' });
  writeFileSync(join(dir, 'items.json'), '[]');
  const cwd = process.cwd();
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    process.chdir(dir);
    code = main(['update', '--state', join(dir, 'state.json'), '--items', join(dir, 'items.json'),
      '--out', join(dir, 'state.json'), '--date', '2026-09-23', '--config', configDir]);
  } finally {
    process.chdir(cwd);
    console.error = orig;
    process.exitCode = 0;
  }
  assert.equal(code, 2);
  assert.match(errs.join('\n'), /runs_history_max must be a positive integer/);
});

// A minimal but complete configuration directory for the CLI tests.
function writeConfig(dir, overrides = {}) {
  const values = {
    timezone: 'Asia/Shanghai', window_cap_weeks: 4, first_run_days: 7,
    watchlist_retention_weeks: 4, runs_history_max: 52, ...overrides,
  };
  const table = (rows) => rows.join('\n') + '\n';
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'config', 'settings.md'), table([
    '| key | value | note |', '|---|---|---|',
    ...Object.entries(values).map(([k, v]) => `| ${k} | ${v} | t |`),
  ]));
  writeFileSync(join(dir, 'config', 'domains.md'), table([
    '| key | domain | label_zh | cluster | tier | why |', '|---|---|---|---|---|---|',
    '| ai-llm | AI / LLM | 人工智能 / 大模型 | AI and compute | core | t |',
    '| quantum | Quantum technologies | 量子技术 | AI and compute | watch | t |',
  ]));
  writeFileSync(join(dir, 'config', 'sources.md'), table([
    '| domain | source | tier | kind | lang | fetchable | note |', '|---|---|---|---|---|---|---|',
  ]));
  writeFileSync(join(dir, 'config', 'watchlist.md'), table([
    '| domain | kind | target |', '|---|---|---|',
  ]));
  return join(dir, 'config');
}

// Regression test: a second update in the same session used to log a
// second run whose window was the few milliseconds since the first call, and count
// every item again (timesSeen 2, #new flipping to #followup). A run for the same
// date and domains is now refused instead of merged twice.
function runCli(args) {
  const errs = [];
  const logs = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (...a) => errs.push(a.join(' '));
  console.log = (...a) => logs.push(a.join(' '));
  let code;
  try {
    code = main(args);
  } finally {
    console.error = origErr;
    console.log = origLog;
    process.exitCode = 0;
  }
  return { code, errs: errs.join('\n'), logs: logs.join('\n') };
}

test('a repeated update for the same date and domains is refused, not merged twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-repeat-'));
  const statePath = join(dir, 'state.json');
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, JSON.stringify([{ ...item, watch: true }]));
  const args = ['update', '--state', statePath, '--items', itemsPath, '--out', statePath,
    '--date', '2026-09-23', '--since', '2026-01-01T00:00:00.000Z'];

  const first = runCli(args);
  assert.equal(first.code, 0, first.errs);

  const second = runCli(args);
  assert.equal(second.code, 2, 'the duplicate is refused');
  assert.match(second.errs, /already recorded/);
  assert.match(second.errs, /2026-09-23/);

  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(state.runs.length, 1, 'one run, not two');
  assert.ok(state.runs[0].window.since < state.runs[0].window.until, 'the recorded window is not empty');
  const entry = Object.values(state.items)[0];
  assert.equal(entry.timesSeen, 1, 'the item is not counted twice');
  assert.equal(state.watchlist[0].timesSeen, 1, 'the watchlist is not counted twice');
});

// Regression test: the duplicate-run guard built the run's identity by
// filtering the catalogue, which silently dropped an unknown --domains key. A repeat
// delivery that also named a typo was therefore refused as 'already recorded' — the
// known subset matched the logged run — instead of naming the key that does not exist.
// The guard validates the run's domains first now, so it only reports a repeated run.
test('an unknown --domains key is named even when the known subset is already recorded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-unknown-key-'));
  const configDir = writeConfig(dir);
  const statePath = join(dir, 'state.json');
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, JSON.stringify([item]));
  const base = ['update', '--state', statePath, '--items', itemsPath, '--out', statePath,
    '--date', '2026-09-23', '--config', configDir];

  const first = runCli([...base, '--domains', 'ai-llm']);
  assert.equal(first.code, 0, first.errs);

  const typo = runCli([...base, '--domains', 'ai-llm,bogus-key']);
  assert.equal(typo.code, 2, 'the unknown key is a configuration error');
  assert.match(typo.errs, /unknown domain key\(s\): bogus-key/);
  assert.doesNotMatch(typo.errs, /already recorded/, 'the duplicate guard must not shadow the typo');

  const repeat = runCli([...base, '--domains', 'ai-llm']);
  assert.equal(repeat.code, 2, 'the known subset alone is a genuine duplicate');
  assert.match(repeat.errs, /covering these 1 domain is already recorded/);
});

test('a focus run on the same date is still allowed after a weekly run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-focus-'));
  const statePath = join(dir, 'state.json');
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, '[]');
  const weekly = runCli(['update', '--state', statePath, '--items', itemsPath, '--out', statePath, '--date', '2026-09-23']);
  assert.equal(weekly.code, 0, weekly.errs);
  const focus = runCli(['update', '--state', statePath, '--items', itemsPath, '--out', statePath, '--date', '2026-09-23', '--domains', 'ai-llm']);
  assert.equal(focus.code, 0, focus.errs);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(state.runs.length, 2, 'a focus run is a different run');
});

// Regression test: the item domain accepted either the catalogue key
// or the English name and stored whatever it was given. The state stores keys now.
test('an item domain written as the catalogue key is kept as the key', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const merged = mergeRun(config, s0, { items: [{ ...item, domain: 'ai-llm' }], date: '2026-09-23', entry: 'weekly', now: NOW });
  assert.equal(Object.values(merged.state.items)[0].domain, 'ai-llm');
});

test('an item domain written as the English catalogue name resolves to the key', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const merged = mergeRun(config, s0, { items: [{ ...item, domain: 'AI / LLM' }], date: '2026-09-23', entry: 'weekly', now: NOW });
  assert.equal(Object.values(merged.state.items)[0].domain, 'ai-llm');
});

test('an unrecognised item domain is rejected with a clear message', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  assert.throws(
    () => mergeRun(config, s0, { items: [{ ...item, domain: 'not-a-domain' }], date: '2026-09-23', entry: 'weekly', now: NOW }),
    /unknown item domain "not-a-domain"/,
  );
});

test('the update CLI exits 3 for an item with an unrecognised domain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-domain-'));
  const configDir = writeConfig(dir);
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, JSON.stringify([{ ...item, domain: 'not-a-domain' }]));
  const result = runCli(['update', '--state', join(dir, 'state.json'), '--items', itemsPath,
    '--out', join(dir, 'state.json'), '--date', '2026-09-23', '--config', configDir]);
  assert.equal(result.code, 3, result.errs);
  assert.match(result.errs, /unknown item domain/);
});

// Regression test: --date was unvalidated and the duplicate guard
// compared raw strings, so 2026-09-23, 2026-9-23 and 2026-09-23T00:00:00Z merged as
// three runs for one day and counted every item three times.
test('update refuses a --date that is not YYYY-MM-DD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-date-'));
  const configDir = writeConfig(dir);
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, JSON.stringify([item]));
  for (const bad of ['2026-9-23', '2026-09-23T00:00:00Z', '23/09/2026', 'today']) {
    const res = runCli(['update', '--state', join(dir, 'state.json'), '--items', itemsPath,
      '--out', join(dir, 'state.json'), '--date', bad, '--config', configDir]);
    assert.equal(res.code, 2, JSON.stringify(bad) + ': ' + res.errs);
    assert.match(res.errs, /--date must be YYYY-MM-DD/);
  }
});

test('a run recorded under another spelling of the same day is still refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-normal-'));
  const configDir = writeConfig(dir);
  const statePath = join(dir, 'state.json');
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, JSON.stringify([item]));
  const state = emptyState(['ai-llm', 'quantum']);
  state.runs.push({
    date: '2026-09-23T00:00:00Z', entry: 'weekly', window: null,
    domains: ['ai-llm', 'quantum'], items: 1,
  });
  writeFileSync(statePath, JSON.stringify(state));
  const res = runCli(['update', '--state', statePath, '--items', itemsPath, '--out', statePath,
    '--date', '2026-09-23', '--config', configDir]);
  assert.equal(res.code, 2, 'the same day under another spelling is the same run');
  assert.match(res.errs, /already recorded/);
});

test('normalizeRunDate folds the spellings of one day', () => {
  assert.equal(normalizeRunDate('2026-09-23'), '2026-09-23');
  assert.equal(normalizeRunDate('2026-9-23'), '2026-09-23');
  assert.equal(normalizeRunDate('2026-09-23T00:00:00Z'), '2026-09-23');
  assert.equal(normalizeRunDate(' 2026-09-23 '), '2026-09-23');
});

// Regression test: with a non-numeric retention or cap every comparison
// was false, so items survived indefinitely, a watchlist was emptied on every merge,
// and update still exited 0.
test('a retention or cap setting that is not a positive integer is a named error', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  for (const key of ['watchlist_retention_weeks', 'window_cap_weeks']) {
    for (const bad of ['four', 0, -1, 2.5, undefined]) {
      const settings = { ...config.settings, [key]: bad };
      assert.throws(
        () => mergeRun({ ...config, settings }, s0, { items: [], date: '2026-09-23', entry: 'weekly', now: NOW }),
        new RegExp(key + ' must be a positive integer'),
        key + '=' + JSON.stringify(bad),
      );
    }
  }
});

test('update exits 2 instead of silently emptying a watchlist it cannot age', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-retention-'));
  const configDir = writeConfig(dir, { watchlist_retention_weeks: 'four' });
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, JSON.stringify([{ ...item, watch: true }]));
  const res = runCli(['update', '--state', join(dir, 'state.json'), '--items', itemsPath,
    '--out', join(dir, 'state.json'), '--date', '2026-09-23', '--config', configDir]);
  assert.equal(res.code, 2, res.errs);
  assert.match(res.errs, /watchlist_retention_weeks must be a positive integer/);
});

// Regression test (the update half): "" meant "unscoped" here while it
// meant "no domain" to plan.
test('update rejects an empty --domains list too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-empty-domains-'));
  const configDir = writeConfig(dir);
  const itemsPath = join(dir, 'items.json');
  writeFileSync(itemsPath, '[]');
  const res = runCli(['update', '--state', join(dir, 'state.json'), '--items', itemsPath,
    '--out', join(dir, 'state.json'), '--date', '2026-09-23', '--domains', '', '--config', configDir]);
  assert.equal(res.code, 2, res.errs);
  assert.match(res.errs, /invalid --domains: expected at least one domain key/);
});

// Found in review: the item loop ignored --domains, so a one-domain run wrote story
// history into a domain it never covered and logged an item count that was not its own.
test('a focus run refuses an item outside its scope', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const quantum = { ...item, title: 'Quantum thing', domain: 'quantum', primaryUrl: 'https://example.com/q' };
  assert.throws(
    () => mergeRun(config, s0, {
      items: [item, quantum], date: '2026-09-23', entry: 'focus', now: NOW, only: ['ai-llm'],
    }),
    /item domain quantum is outside this focus run's scope \(ai-llm\)/,
  );
  assert.deepEqual(Object.keys(s0.items), [], 'the state is untouched by the refusal');
});

test('a focus run still merges the items it did cover', () => {
  const s0 = emptyState(['ai-llm', 'quantum']);
  const merged = mergeRun(config, s0, {
    items: [item], date: '2026-09-23', entry: 'focus', now: NOW, only: ['ai-llm'],
  });
  assert.equal(merged.results.length, 1);
  assert.equal(Object.values(merged.state.items)[0].domain, 'ai-llm');
  assert.equal(merged.state.runs[0].items, 1, 'the log counts what was actually written');
});

// Pinned rather than changed, with the reasoning recorded here: the refusal covers the
// runs the log still retains. A run old enough to
// fall off the front is accepted again. The state keeps watermarks, not the dates of
// past runs, so any rule that refused it would also refuse the focused catch-up on the
// same day that the schema allows (see 'a focus run on the same date is still allowed
// after a weekly run' above). At a weekly cadence the log holds about a year.
test('a run that has fallen off the run log is accepted again: the documented limitation', () => {
  const capped = { ...config, settings: { ...config.settings, runs_history_max: 2 } };
  let state = emptyState(['ai-llm', 'quantum']);
  for (const date of ['2026-09-01', '2026-09-08', '2026-09-15']) {
    state = mergeRun(capped, state, { items: [], date, entry: 'weekly', now: new Date(date + 'T09:00:00Z') }).state;
  }
  assert.deepEqual(state.runs.map((r) => r.date), ['2026-09-08', '2026-09-15'], 'the log keeps the newest two');
  assert.equal(findRecordedRun(state, '2026-09-01', ['ai-llm', 'quantum']), null, 'the identity has fallen off');
  const again = mergeRun(capped, state, { items: [], date: '2026-09-01', entry: 'weekly', now: NOW }).state;
  assert.deepEqual(again.runs.map((r) => r.date), ['2026-09-15', '2026-09-01'], 'and is accepted again');
});

// --- TR-04 / TR-13: the state file and the items file are inputs like any other -------

// Writes a starting state and hands back the paths a CLI call needs. The state content
// is captured so the tests can prove a refusal left it byte-identical.
function updateFixture(dir, stateBody) {
  const configDir = writeConfig(dir);
  const statePath = join(dir, 'state.json');
  const itemsPath = join(dir, 'items.json');
  const body = stateBody ?? JSON.stringify(emptyState(['ai-llm', 'quantum']), null, 2) + '\n';
  writeFileSync(statePath, body);
  return { configDir, statePath, itemsPath, body };
}

// Regression test: loadState rejected only a non-object top level, so an array where a
// map belongs was accepted and rewritten as [] - the silent loss of every watermark and
// all item history, at exit 0 - and a runs container that was not an array crashed
// findRecordedRun with a raw TypeError (exit 1) carrying no exit code.
test('a state container of the wrong shape exits 2 and writes nothing', () => {
  const cases = [
    ['domains as an array', '{"domains":[]}'],
    ['items as an array', '{"items":[]}'],
    ['watchlist as an object', '{"watchlist":{}}'],
    ['runs as an object', '{"runs":{}}'],
    ['runs holding a null entry', '{"runs":[null]}'],
  ];
  for (const [name, body] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'tech-radar-shape-'));
    const f = updateFixture(dir, body);
    writeFileSync(f.itemsPath, '[]');
    const res = runCli(['update', '--state', f.statePath, '--items', f.itemsPath,
      '--out', f.statePath, '--date', '2026-09-23', '--config', f.configDir]);
    assert.equal(res.code, 2, name + ': the shape is a state error, not a degraded run: ' + res.errs);
    assert.equal(readFileSync(f.statePath, 'utf8'), f.body, name + ': the state file is untouched');
    assert.doesNotMatch(res.errs, /TypeError/, name + ': no TypeError reaches the caller');
    assert.doesNotMatch(res.errs, /\n\s+at /, name + ': no stack trace is printed');
  }
});

test('a malformed runs field is refused with a named message by plan too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-runs-'));
  const f = updateFixture(dir, '{"runs":{}}');
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    code = runCli(['plan', '--state', f.statePath, '--config', f.configDir]);
    code = code.code;
  } finally {
    console.error = orig;
    process.exitCode = 0;
  }
  assert.equal(code, 2, errs.join('\n'));
  assert.doesNotMatch(errs.join('\n'), /TypeError|\n\s+at /, 'the refusal is named, with no stack trace');
});

// Regression test: mergeRun dereferenced item.title for the story key before the only
// shape check (resolveDomainKey on item.domain), so a non-object entry died with a raw
// TypeError, a string or number entry died naming "unknown item domain undefined" and
// exited 3 through the wrong path, and two items with no title or URL collapsed onto one
// bogus key (String(undefined) plus hostOf(undefined) === ''), storing a single state
// entry titled "undefined" with no primaryUrl.
test('an item entry without a title or primary URL is refused with exit 3', () => {
  const cases = [
    ['null', [null]],
    ['a string', ['x']],
    ['a number', [0]],
    ['an object with no title or URL', [{}]],
    ['an item with a title but no URL', [{ title: 'A story', domain: 'ai-llm' }]],
    ['an item with a URL but no title', [{ primaryUrl: 'https://h.example/a', domain: 'ai-llm' }]],
  ];
  for (const [name, items] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'tech-radar-items-'));
    const f = updateFixture(dir);
    writeFileSync(f.itemsPath, JSON.stringify(items));
    const res = runCli(['update', '--state', f.statePath, '--items', f.itemsPath,
      '--out', f.statePath, '--date', '2026-09-23', '--config', f.configDir]);
    assert.equal(res.code, 3, name + ': the items file is the documented exit-3 input: ' + res.errs);
    assert.match(res.errs, /item/i, name + ': the message names the item: ' + res.errs);
    assert.doesNotMatch(res.errs, /TypeError/, name + ': no TypeError reaches the caller');
    assert.equal(readFileSync(f.statePath, 'utf8'), f.body, name + ': the state is untouched');
    assert.equal(readFileSync(f.itemsPath, 'utf8'), JSON.stringify(items), name + ': the items file is untouched');
  }
});

// Regression test: update-state wrote the state with writeFileSync in place, at the
// documented --out == --state invocation. The write truncates the file the merge just
// read, so a failed or interrupted write leaves the state destroyed - no atomic rename,
// no rollback, and the next plan dies on a JSON parse error.
test('a failed state write exits 4 and leaves the previous state byte-identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-atomic-'));
  const f = updateFixture(dir);
  const before = readFileSync(f.statePath, 'utf8');
  writeFileSync(f.itemsPath, JSON.stringify([item]));
  chmodSync(f.statePath, 0o444);
  let res;
  try {
    res = runCli(['update', '--state', f.statePath, '--items', f.itemsPath,
      '--out', f.statePath, '--date', '2026-09-23', '--config', f.configDir]);
  } finally {
    chmodSync(f.statePath, 0o644);
  }
  assert.equal(res.code, 4, 'the write failure is the documented output exit: ' + res.errs);
  assert.equal(readFileSync(f.statePath, 'utf8'), before, 'the previous state still parses byte-identically');
  JSON.parse(readFileSync(f.statePath, 'utf8'));
  const leftovers = readdirSync(dir).filter((name) => name !== 'state.json' && name !== 'items.json'
    && name !== 'config' && !/^state\.json\./.test(name));
  assert.deepEqual(leftovers, [], 'no stray file is left behind: ' + leftovers.join(', '));
});

// Regression test: the read-modify-write across the state file is unsynchronised -
// no lock anywhere in scripts/, though .gitignore already ignores the lock names it
// anticipates - so two concurrent updates silently lose a whole merged run: both exit 0
// and the last writer wins.
test('two concurrent updates keep both runs, or one of them fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-lock-'));
  const f = updateFixture(dir);
  // A state-sized merge widens the window between one process's read and its write.
  const many = Array.from({ length: 400 }, (_, i) => ({
    title: 'Concurrent story ' + i,
    domain: 'ai-llm',
    outlet: 'Example',
    primaryUrl: 'https://h.example/concurrent-' + i,
    flags: ['new'],
  }));
  writeFileSync(f.itemsPath, JSON.stringify(many));
  const spawnUpdate = (date) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/update-state.mjs', 'update', '--state', f.statePath,
      '--items', f.itemsPath, '--out', f.statePath, '--date', date, '--config', f.configDir], { cwd: SKILL_ROOT });
    let err = '';
    child.stderr.on('data', (c) => { err += c; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the update did not finish')); }, 60000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
  const [first, second] = await Promise.all([spawnUpdate('2026-09-23'), spawnUpdate('2026-09-30')]);
  const state = JSON.parse(readFileSync(f.statePath, 'utf8'));
  const dates = state.runs.map((r) => r.date).sort();
  const oneFailed = (first.code !== 0) !== (second.code !== 0);
  assert.ok(
    dates.length === 2 || oneFailed,
    'both updates exited 0 and one run was lost: runs ' + JSON.stringify(dates)
      + '; stderr ' + JSON.stringify((first.err + second.err).slice(0, 200)),
  );
  if (oneFailed) {
    const failed = first.code === 0 ? second : first;
    assert.notEqual(failed.err.trim(), '', 'the refused update says why');
  }
});

// --- the update lock must not outlive the process that holds it -------------------------

// TR-36 regression test: the lock is an exclusive create, so a run killed between taking it
// and its finally leaves <state>.lock behind, and every later update is refused at exit 2
// with no remedy at all. The lock records the process that owns it, so a lock whose process
// is gone is an orphan: it has to be reclaimed and the update it was blocking has to run.
const DEAD_PID = 4194305; // just past the kernel's pid ceiling, so no process can hold it

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// The lock names its owning process, and its age is a second, independent signal: the
// orphan fixtures carry both, so a lock is reclaimed whether staleness is decided by the
// recorded process id or by how long the file has sat there.
function plantLock(statePath, { pid, ageMs = 0 }) {
  const lock = statePath + '.lock';
  const when = new Date(Date.now() - ageMs);
  writeFileSync(lock, JSON.stringify({ pid, host: 'h.example', startedAt: when.toISOString() }) + '\n');
  if (ageMs) utimesSync(lock, when, when);
  return lock;
}

test('an update reclaims a lock whose owning process is gone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-stale-lock-'));
  try {
    const f = updateFixture(dir);
    writeFileSync(f.itemsPath, JSON.stringify([item]));
    assert.equal(alive(DEAD_PID), false, 'the fixture names a process that cannot exist');
    const lock = plantLock(f.statePath, { pid: DEAD_PID, ageMs: 30 * 864e5 });
    const res = runCli(['update', '--state', f.statePath, '--items', f.itemsPath,
      '--out', f.statePath, '--date', '2026-09-23', '--config', f.configDir]);
    assert.equal(res.code, 0, 'an orphaned lock must not block the update: ' + res.errs);
    const state = JSON.parse(readFileSync(f.statePath, 'utf8'));
    assert.deepEqual(state.runs.map((r) => r.date), ['2026-09-23'], 'the blocked run was merged');
    assert.equal(existsSync(lock), false, 'the reclaimed lock is removed, not left behind');
    assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith('.lock')), [], 'no lock file survives the update');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an update refuses a lock held by a live process and merges nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-held-lock-'));
  try {
    const f = updateFixture(dir);
    writeFileSync(f.itemsPath, JSON.stringify([item]));
    const lock = plantLock(f.statePath, { pid: process.pid });
    assert.equal(alive(process.pid), true, 'the lock names this live test process');
    const res = runCli(['update', '--state', f.statePath, '--items', f.itemsPath,
      '--out', f.statePath, '--date', '2026-09-23', '--config', f.configDir]);
    assert.equal(res.code, 2, 'a lock a live process holds is still a refusal: ' + res.errs);
    assert.match(res.errs, new RegExp(lock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the refusal names the lock path: ' + res.errs);
    assert.match(res.errs, /nothing was merged/, 'the refusal says nothing was merged: ' + res.errs);
    assert.equal(readFileSync(f.statePath, 'utf8'), f.body, 'the state file is untouched');
    assert.equal(existsSync(lock), true, 'the refusal does not remove a live lock');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The same orphan from the failure the lock was added for: a run killed while it holds the
// lock leaves a lock that is seconds old, so waiting for it to age out is not a remedy.
test('an update killed while it holds the lock does not block the next one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-killed-lock-'));
  try {
    const f = updateFixture(dir);
    const many = Array.from({ length: 60000 }, (_, i) => ({
      title: 'Interrupted story ' + i,
      domain: 'ai-llm',
      outlet: 'Example',
      primaryUrl: 'https://h.example/interrupted-' + i,
      flags: ['new'],
    }));
    writeFileSync(f.itemsPath, JSON.stringify(many));
    const lock = f.statePath + '.lock';
    const child = spawn(process.execPath, ['scripts/update-state.mjs', 'update', '--state', f.statePath,
      '--items', f.itemsPath, '--out', f.statePath, '--date', '2026-09-16', '--config', f.configDir], { cwd: SKILL_ROOT });
    let outcome = null;
    const closed = new Promise((resolve) => child.on('close', (code, signal) => {
      outcome = { code, signal };
      resolve(outcome);
    }));
    const deadline = Date.now() + 30000;
    while (!existsSync(lock) && outcome === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(existsSync(lock), true, 'the update took the lock before it exited: ' + JSON.stringify(outcome));
    if (outcome === null) child.kill('SIGKILL');
    const killed = await closed;
    assert.equal(killed.signal, 'SIGKILL', 'the update was killed while it held the lock: ' + JSON.stringify(killed));
    assert.equal(readFileSync(f.statePath, 'utf8'), f.body, 'the killed run merged nothing');
    writeFileSync(f.itemsPath, JSON.stringify([item]));
    const res = runCli(['update', '--state', f.statePath, '--items', f.itemsPath,
      '--out', f.statePath, '--date', '2026-09-23', '--config', f.configDir]);
    assert.equal(res.code, 0, 'the lock a killed update left must not block the next one: ' + res.errs);
    const state = JSON.parse(readFileSync(f.statePath, 'utf8'));
    assert.deepEqual(state.runs.map((r) => r.date), ['2026-09-23'], 'only the surviving run is merged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

