// tests/state-plan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyState, planWindows, stamp, main, parseArgs } from '../scripts/update-state.mjs';

const config = {
  domains: [{ key: 'ai-llm', tier: 'core' }, { key: 'quantum', tier: 'watch' }],
  settings: { timezone: 'Asia/Shanghai', window_cap_weeks: 4, first_run_days: 7 },
};
const NOW = new Date('2026-09-23T09:00:00Z');

test('stamp renders a date in the configured zone', () => {
  assert.equal(stamp(new Date('2026-09-23T09:00:00Z'), 'Asia/Shanghai'), '2026-09-23 17:00');
});

test('a first run reaches back first_run_days and is not capped', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const p = planWindows(config, state, NOW);
  assert.equal(p.capped, false);
  assert.equal(p.since, new Date(NOW.getTime() - 7 * 864e5).toISOString());
  assert.equal(Object.keys(p.perDomain).length, 2);
  assert.match(p.label, /^Covering 2026-09-16 17:00 to 2026-09-23 17:00 \(Asia\/Shanghai\) · cap not hit$/);
});

test('a domain covered two days ago starts from that moment', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  state.domains['ai-llm'].lastCoveredAt = '2026-09-21T09:00:00.000Z';
  state.domains['quantum'].lastCoveredAt = '2026-09-22T09:00:00.000Z';
  const p = planWindows(config, state, NOW);
  assert.equal(p.perDomain['ai-llm'].since, '2026-09-21T09:00:00.000Z');
  assert.equal(p.since, '2026-09-21T09:00:00.000Z', 'the earliest domain start drives the header');
  assert.equal(p.capped, false);
});

test('a domain last covered beyond the cap is clamped and the cap is reported', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  state.domains['ai-llm'].lastCoveredAt = '2026-07-01T09:00:00.000Z';
  const p = planWindows(config, state, NOW);
  assert.equal(p.capped, true);
  assert.equal(p.since, new Date(NOW.getTime() - 28 * 864e5).toISOString());
  assert.match(p.label, /cap hit$/);
});

test('a focus run plans only the named domains and leaves the others untouched', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const p = planWindows(config, state, NOW, ['quantum']);
  assert.deepEqual(Object.keys(p.perDomain), ['quantum']);
});

// Regression test: check-quality.mjs reads plan.window.since and
// plan.window.until, but planWindows returned no window object, so the CLI's plan
// JSON silently disabled every publication-window check in the gate.
test('the plan carries the window object the gate consumes', () => {
  const p = planWindows(config, emptyState(['ai-llm', 'quantum']), NOW);
  assert.deepEqual(p.window, { since: p.since, until: p.until });
});

// Regression test: the catch-up entry point (design 3.5) takes an
// explicit floor; the CLI accepts --since but planWindows had no way to use it.
test('an explicit catch-up floor overrides the first-run default', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const p = planWindows(config, state, NOW, null, '2026-09-10T00:00:00.000Z');
  assert.equal(p.perDomain['ai-llm'].since, '2026-09-10T00:00:00.000Z');
  assert.equal(p.since, '2026-09-10T00:00:00.000Z');
  assert.equal(p.capped, false, 'a deliberate floor is not the cap biting');
});

test('a catch-up floor still cannot escape the window cap', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const p = planWindows(config, state, NOW, null, '2026-01-01T00:00:00.000Z');
  assert.equal(p.since, new Date(NOW.getTime() - 28 * 864e5).toISOString());
  assert.equal(p.capped, true);
});
// Regression test: 'plan --domains' with only unknown keys died
// with 'Cannot read properties of null' instead of naming the unknown domains.
test('an unknown --domains key names itself instead of crashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-plan-'));
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    code = main(['plan', '--state', join(dir, 'state.json'), '--domains', 'ai-llm,nope']);
  } finally {
    console.error = orig;
    process.exitCode = 0;
  }
  assert.equal(code, 2);
  assert.match(errs.join('\n'), /unknown domain key/);
  assert.match(errs.join('\n'), /nope/);
});
// Regression test: plan resolved 'config' against the working
// directory. It now resolves the config directory next to the script.
test('plan resolves its default config next to the script, not the cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-cwd-'));
  const cwd = process.cwd();
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    process.chdir(dir);
    code = main(['plan', '--state', join(dir, 'state.json')]);
  } finally {
    process.chdir(cwd);
    console.error = orig;
    process.exitCode = 0;
  }
  assert.equal(code, 0, errs.join('\n'));
  assert.doesNotMatch(errs.join('\n'), /cannot read config/);
});

// An earlier rule reported "cap hit" at the boundary; that was reversed deliberately,
// because a run printed "cap hit" for a window nothing was dropped
// from. capped now means the cap removed time from a window, so a start exactly on
// the cap is not the cap being hit, and the window itself is unchanged either way.
test('a floor exactly at the window cap is not reported as the cap', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const exactly = new Date(NOW.getTime() - 28 * 864e5).toISOString();
  state.domains['ai-llm'].lastCoveredAt = exactly;
  const p = planWindows(config, state, NOW);
  assert.equal(p.capped, false);
  assert.equal(p.skippedMs, 0);
  assert.equal(p.perDomain['ai-llm'].since, exactly, 'an at-the-cap start is not clipped');
  assert.equal(p.perDomain['ai-llm'].declared, exactly);
  assert.match(p.label, /cap not hit$/);
});

test('a floor a minute inside the cap is still not the cap', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  state.domains['ai-llm'].lastCoveredAt = new Date(NOW.getTime() - 28 * 864e5 + 60000).toISOString();
  const p = planWindows(config, state, NOW);
  assert.equal(p.capped, false);
  assert.match(p.label, /cap not hit$/);
});
// Regression tests: the plan JSON discarded the floor the caller
// declared, so a clamped run could not say what the cap had removed, which design
// 3.5 requires the coverage note to state.
test('a clamped floor is reported with what the cap removed', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const p = planWindows(config, state, NOW, null, '2026-07-01T09:00:00.000Z');
  const capFloorMs = NOW.getTime() - 28 * 864e5;
  assert.equal(p.declared, '2026-07-01T09:00:00.000Z');
  assert.equal(p.perDomain['ai-llm'].declared, '2026-07-01T09:00:00.000Z');
  assert.equal(p.perDomain['ai-llm'].skippedMs, capFloorMs - Date.parse('2026-07-01T09:00:00.000Z'));
  assert.equal(p.skippedMs, p.perDomain['ai-llm'].skippedMs);
  assert.equal(p.since, new Date(capFloorMs).toISOString());
  assert.equal(p.capped, true);
  assert.match(p.label, /cap hit$/);
});

test('an unclamped floor carries no skipped time', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const p = planWindows(config, state, NOW, null, '2026-09-10T00:00:00.000Z');
  assert.equal(p.declared, '2026-09-10T00:00:00.000Z');
  assert.equal(p.skippedMs, 0);
  assert.equal(p.capped, false);
  for (const [key, d] of Object.entries(p.perDomain)) {
    assert.equal(d.skippedMs, 0, key);
    assert.equal(d.declared, '2026-09-10T00:00:00.000Z', key);
  }
});

test('a first run declares the first_run_days reach and skips nothing', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const p = planWindows(config, state, NOW);
  const reach = new Date(NOW.getTime() - 7 * 864e5).toISOString();
  assert.equal(p.declared, reach);
  assert.equal(p.since, reach);
  assert.equal(p.skippedMs, 0);
  assert.equal(p.perDomain['quantum'].declared, reach);
});

test('a per-domain watermark older than the cap reports its own declared start', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  state.domains['ai-llm'].lastCoveredAt = '2026-07-01T09:00:00.000Z';
  state.domains['quantum'].lastCoveredAt = '2026-09-21T09:00:00.000Z';
  const p = planWindows(config, state, NOW);
  assert.equal(p.declared, '2026-07-01T09:00:00.000Z', 'the earliest declare drives the plan');
  assert.equal(p.perDomain['ai-llm'].skippedMs, NOW.getTime() - 28 * 864e5 - Date.parse('2026-07-01T09:00:00.000Z'));
  assert.equal(p.perDomain['quantum'].skippedMs, 0);
  assert.equal(p.capped, true);
});

// Regression tests: --since was consulted only when a domain had no
// watermark, so a declared catch-up floor was silently dropped — a 35-day floor
// against a 7-day watermark produced the ordinary weekly window. The schema says the
// floor can pull a start earlier than the watermark but never later.
test('a catch-up floor earlier than the watermark widens the window', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  state.domains['ai-llm'].lastCoveredAt = '2026-09-16T09:00:00.000Z'; // 7 days before NOW
  state.domains['quantum'].lastCoveredAt = '2026-09-16T09:00:00.000Z';
  const p = planWindows(config, state, NOW, null, '2026-09-09T09:00:00.000Z'); // 14 days: inside the cap
  assert.equal(p.perDomain['ai-llm'].since, '2026-09-09T09:00:00.000Z');
  assert.equal(p.perDomain['ai-llm'].declared, '2026-09-09T09:00:00.000Z');
  assert.equal(p.since, '2026-09-09T09:00:00.000Z', 'the widened start drives the header');
  assert.equal(p.skippedMs, 0, 'nothing was clipped away');
  assert.equal(p.capped, false);
  assert.match(p.label, /cap not hit$/);
});

test('a catch-up floor later than the watermark changes nothing', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  state.domains['ai-llm'].lastCoveredAt = '2026-09-16T09:00:00.000Z';
  const p = planWindows(config, state, NOW, null, '2026-09-20T09:00:00.000Z');
  assert.equal(p.perDomain['ai-llm'].since, '2026-09-16T09:00:00.000Z', 'a floor never narrows a window');
  assert.equal(p.perDomain['ai-llm'].declared, '2026-09-16T09:00:00.000Z');
});

test('a widening floor is still clipped by the window cap', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  state.domains['ai-llm'].lastCoveredAt = '2026-09-16T09:00:00.000Z';
  const capFloorMs = NOW.getTime() - 28 * 864e5;
  const p = planWindows(config, state, NOW, null, '2026-07-01T09:00:00.000Z');
  assert.equal(p.perDomain['ai-llm'].declared, '2026-07-01T09:00:00.000Z');
  assert.equal(p.perDomain['ai-llm'].since, new Date(capFloorMs).toISOString());
  assert.equal(p.perDomain['ai-llm'].skippedMs, capFloorMs - Date.parse('2026-07-01T09:00:00.000Z'));
  assert.equal(p.capped, true);
  assert.match(p.label, /cap hit$/);
});

test('a floor widens only the domains that carry a watermark', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  state.domains['quantum'].lastCoveredAt = '2026-09-16T09:00:00.000Z';
  const p = planWindows(config, state, NOW, null, '2026-09-09T09:00:00.000Z');
  assert.equal(p.perDomain['ai-llm'].since, '2026-09-09T09:00:00.000Z', 'no watermark: the floor is the start');
  assert.equal(p.perDomain['quantum'].since, '2026-09-09T09:00:00.000Z', 'watermark: widened by the floor');
  assert.equal(p.capped, false);
});

// Regression test: an unvalidated window_cap_weeks made every
// comparison false and plan died with a bare 'Invalid time value'.
test('a window_cap_weeks that is not a positive integer is a named configuration error', () => {
  for (const bad of ['four', 0, -1, 2.5, undefined]) {
    const settings = { ...config.settings, window_cap_weeks: bad };
    assert.throws(
      () => planWindows({ ...config, settings }, emptyState(['ai-llm']), NOW),
      /window_cap_weeks must be a positive integer/,
      'window_cap_weeks=' + JSON.stringify(bad),
    );
  }
});

test('a first_run_days that is not a positive integer is a named configuration error', () => {
  for (const bad of ['seven', 0, -1, 2.5]) {
    const settings = { ...config.settings, first_run_days: bad };
    assert.throws(
      () => planWindows({ ...config, settings }, emptyState(['ai-llm']), NOW),
      /first_run_days must be a positive integer/,
      'first_run_days=' + JSON.stringify(bad),
    );
  }
});

// Regression test: --domains "" produced a plan through 1970 with an
// empty perDomain, while the same value meant "unscoped" to update.
// An empty --state used to read as a missing state file - a first run - and planned a
// window through 1970 instead of refusing the value.
test('an empty --state is refused instead of planning a first run', () => {
  for (const v of ['', ' ', '\t']) {
    assert.throws(() => parseArgs(['plan', '--state', v]), /empty value for --state/, JSON.stringify(v));
  }
});

test('plan rejects an empty --domains list instead of printing an epoch window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-empty-domains-'));
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    code = main(['plan', '--state', join(dir, 'state.json'), '--domains', '']);
  } finally {
    console.error = orig;
    process.exitCode = 0;
  }
  assert.equal(code, 2);
  assert.match(errs.join('\n'), /invalid --domains: expected at least one domain key/);
  assert.doesNotMatch(errs.join('\n'), /1970/);
});

// Regression test: planWindows computed since = max(declared, capFloor) and never
// compared the start with now, so --since could name a floor AFTER the run's own until
// and print a window whose since is after its until, with a label the digest must repeat
// verbatim. collect refuses that very window, so the plan was unusable and the digest it
// labelled was unbuildable.
test('plan refuses a --since floor later than now instead of printing an inverted window', () => {
  const state = emptyState(['ai-llm', 'quantum']);
  const future = new Date(NOW.getTime() + 90 * 864e5).toISOString();
  assert.throws(
    () => planWindows(config, state, NOW, null, future),
    (err) => {
      assert.equal(err.exitCode, 2, 'the refusal is the documented configuration exit');
      assert.match(err.message, /after/i, 'the message says the floor is after now: ' + err.message);
      return true;
    },
  );
});

test('the plan CLI exits 2 for a --since floor later than now', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-future-floor-'));
  const future = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const errs = [];
  const logs = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (...a) => errs.push(a.join(' '));
  console.log = (...a) => logs.push(a.join(' '));
  let code;
  try {
    code = main(['plan', '--state', join(dir, 'state.json'), '--since', future]);
  } finally {
    console.error = origErr;
    console.log = origLog;
    process.exitCode = 0;
  }
  assert.equal(code, 2, 'the inverted window is refused, not printed: ' + logs.join('\n'));
  assert.match(errs.join('\n'), /after/i);
  assert.doesNotMatch(logs.join('\n'), /"since"/, 'no plan JSON is printed for an unusable window');
  assert.equal(logs.join('').includes(future), false, 'the unusable floor is not published as a plan');
});

