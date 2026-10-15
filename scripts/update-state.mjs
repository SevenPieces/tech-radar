#!/usr/bin/env node
// scripts/update-state.mjs
// Run state for the tech-radar skill: the coverage window, item history,
// the watchlist and per-domain watermarks. Zero dependencies.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from './lib/mdtable.mjs';
import { hostOf } from './lib/net.mjs';

const DAY = 864e5;
const WEEK = 7 * DAY;

// The configuration ships with the skill, so the default is the config directory
// beside this script: the documented commands work from any working directory.
const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));

const USAGE = `usage: update-state.mjs <plan|update> [options]

  plan   --state <path> [--domains a,b] [--since ISO] [--config <dir>]
  update --state <path> --items <path> --out <path> --date YYYY-MM-DD
         [--domains a,b] [--since ISO] [--config <dir>]
  --config <dir>    configuration directory (default: the config/ directory
                    next to this script)
  -h, --help        print this usage and exit

plan prints the window plan JSON and mutates nothing; a missing state file is a
first run, not an error. update merges the run's items into the state and
advances the watermarks of the domains the run covered. A run that is already
recorded for the same date and domains is refused rather than merged twice.

Exit codes: 0 OK, 1 fatal, 2 state, items or config not found or unreadable, an
invalid --date, an invalid settings value, or the run is already recorded; 3 the items file is not an array or an item failed
validation; 4 output could not be written.`;

// An error that carries the exit code the CLI should return for it.
function fail(message, exitCode) {
  const err = new Error(message);
  err.exitCode = exitCode;
  return err;
}

export function emptyState(keys) {
  const domains = {};
  for (const k of keys) domains[k] = { lastCoveredAt: null, lastRunAt: null };
  return { version: 1, updatedAt: null, domains, items: {}, watchlist: [], runs: [] };
}

export function stamp(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Every settings value that decides a comparison must be a positive integer. A
// missing or non-numeric value does not error by itself: it makes the comparison
// false, which is how an item once survived a year, a watchlist was emptied on every
// merge, and the run log kept everything instead of its cap. Validated instead of
// trusted, so a wrong value is a configuration error rather than a disabled rule.
function positiveInt(config, key) {
  const raw = config.settings[key];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw fail(`${key} must be a positive integer, got ${JSON.stringify(raw)}`, 2);
  }
  return n;
}

// The run log's own cap.
function runsCap(config) {
  return positiveInt(config, 'runs_history_max');
}

// --domains is a filter over the catalogue, never a silent no-op: an unknown key
// is a typo that would otherwise produce an empty plan or an uncovered run.
function assertKnownDomains(config, only) {
  if (!only || only.length === 0) return;
  const known = config.domains.map((d) => d.key);
  const unknown = only.filter((k) => !known.includes(k));
  if (unknown.length) throw fail(`unknown domain key(s): ${unknown.join(', ')}`, 2);
}

// An item's domain arrives from the digest pipeline, where SKILL.md says 'domain',
// the output contract writes the English catalogue name and the state schema shows
// the catalogue key. Both are accepted here and resolved to the key, because the
// key is the stable representation the state is built on; anything else is a
// validation failure the caller has to fix.
export function resolveDomainKey(config, value) {
  const byKey = config.domains.find((d) => d.key === value);
  if (byKey) return byKey.key;
  const byName = config.domains.find((d) => d.domain === value);
  if (byName) return byName.key;
  throw fail(`unknown item domain ${JSON.stringify(value)}: not a catalogue key or name`, 3);
}

// The window rule of design 3.5. A domain starts from its own watermark, or from
// first_run_days ago when it has never been covered. An explicit catch-up floor
// (--since) replaces that first-run default. The window cap always binds, and the
// plan reports both what each domain declared and how much the cap removed, because
// design 3.5 requires the coverage note to state what was skipped, and the plan JSON
// is the only artifact a run has.
export function planWindows(config, state, now = new Date(), only = null, floor = null) {
  assertKnownDomains(config, only);
  const s = config.settings;
  const capMs = positiveInt(config, 'window_cap_weeks') * WEEK;
  const capFloorMs = now.getTime() - capMs;
  const explicit = floor ? new Date(floor) : null;
  if (explicit && Number.isNaN(explicit.getTime())) throw fail(`invalid --since: ${floor}`, 2);
  const perDomain = {};
  let earliestDeclaredMs = null;
  let earliestMs = null;
  let skippedMs = 0;
  for (const d of config.domains) {
    if (only && !only.includes(d.key)) continue;
    const last = state.domains?.[d.key]?.lastCoveredAt ?? null;
    // What the domain asks for. The floor is a widening bound
    // (reference/state-schema.md): it can pull a start earlier than the watermark but
    // never later, so a catch-up takes the earlier of the two. With no watermark it
    // still replaces the first-run reach. The cap then clips that request, and the
    // plan says by how much: a start exactly on the cap is not clipped.
    const watermarkMs = last ? new Date(last).getTime() : null;
    let declaredMs;
    if (watermarkMs !== null) {
      declaredMs = explicit ? Math.min(watermarkMs, explicit.getTime()) : watermarkMs;
    } else if (explicit) {
      declaredMs = explicit.getTime();
    } else {
      declaredMs = now.getTime() - positiveInt(config, 'first_run_days') * DAY;
    }
    const clippedMs = Math.max(0, capFloorMs - declaredMs);
    const sinceMs = Math.max(declaredMs, capFloorMs);
    perDomain[d.key] = {
      since: new Date(sinceMs).toISOString(),
      until: now.toISOString(),
      declared: new Date(declaredMs).toISOString(),
      skippedMs: clippedMs,
    };
    skippedMs = Math.max(skippedMs, clippedMs);
    if (earliestDeclaredMs === null || declaredMs < earliestDeclaredMs) earliestDeclaredMs = declaredMs;
    if (earliestMs === null || sinceMs < earliestMs) earliestMs = sinceMs;
  }
  const capped = skippedMs > 0;
  const sinceIso = new Date(earliestMs).toISOString();
  const untilIso = now.toISOString();
  const label = `Covering ${stamp(new Date(earliestMs), s.timezone)} to ${stamp(now, s.timezone)} (${s.timezone}) · cap ${capped ? 'hit' : 'not hit'}`;
  return {
    since: sinceIso,
    until: untilIso,
    window: { since: sinceIso, until: untilIso },
    declared: new Date(earliestDeclaredMs).toISOString(),
    skippedMs,
    capped,
    perDomain,
    label,
  };
}

export function normalizeTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim();
}

export function storyKey(title, url) {
  return createHash('sha256').update(`${normalizeTitle(title)}|${hostOf(url)}`).digest('hex').slice(0, 12);
}

export function mergeRun(config, state, { items, date, entry = 'weekly', now = new Date(), only = null, window = null }) {
  assertKnownDomains(config, only);
  const next = JSON.parse(JSON.stringify(state));
  next.version = 1;
  next.updatedAt = now.toISOString();
  const retentionMs = positiveInt(config, 'watchlist_retention_weeks') * WEEK;
  const capMs = positiveInt(config, 'window_cap_weeks') * WEEK;
  const results = [];
  // A focus run declares the domains it covered; an item from anywhere else would put
  // story history and timesSeen into a domain the run never covered and make the run
  // log's item count a lie. Unknown domains already fail the run, so this is symmetric.
  const scope = only && only.length ? new Set(only) : null;
  for (const item of items) {
    const key = storyKey(item.title, item.primaryUrl);
    const prior = next.items[key];
    const status = prior ? 'followup' : 'new';
    const domain = resolveDomainKey(config, item.domain);
    if (scope && !scope.has(domain)) {
      throw fail(`item domain ${domain} is outside this focus run's scope (${[...scope].join(', ')})`, 3);
    }
    next.items[key] = {
      key,
      title: String(item.title),
      domain,
      outlet: item.outlet,
      primaryUrl: item.primaryUrl,
      firstSeen: prior?.firstSeen ?? now.toISOString(),
      lastSeen: now.toISOString(),
      timesSeen: (prior?.timesSeen ?? 0) + 1,
      flags: item.flags ?? [],
    };
    results.push({ key, status });
    if (item.watch) {
      const found = next.watchlist.find((w) => w.key === key);
      if (found) { found.lastSeen = now.toISOString(); found.timesSeen += 1; }
      else {
        next.watchlist.push({
          key, title: String(item.title), firstSeen: now.toISOString(),
          lastSeen: now.toISOString(), timesSeen: 1,
        });
      }
    }
  }
  next.watchlist = next.watchlist.filter((w) => {
    const inactive = now.getTime() - new Date(w.lastSeen).getTime();
    const age = now.getTime() - new Date(w.firstSeen).getTime();
    return inactive <= capMs && age <= retentionMs;
  });
  for (const [key, rec] of Object.entries(next.items)) {
    if (now.getTime() - new Date(rec.lastSeen).getTime() > capMs) delete next.items[key];
  }
  const covered = only && only.length ? config.domains.filter((d) => only.includes(d.key)) : config.domains;
  for (const d of covered) {
    next.domains[d.key] = { lastCoveredAt: now.toISOString(), lastRunAt: now.toISOString() };
  }
  const runsMax = runsCap(config);
  next.runs = [...(next.runs ?? []), { date, entry, window, domains: covered.map((d) => d.key), items: items.length }].slice(-runsMax);
  return { state: next, results };
}

export function parseArgs(argv) {
  const out = {
    command: argv[0], state: 'tech-radar-state.json', items: null, out: null,
    date: null, domains: null, since: null, config: CONFIG_DIR,
  };
  for (let i = 1; i < argv.length; i += 2) {
    const a = argv[i];
    const v = argv[i + 1];
    if (!['--state', '--items', '--out', '--date', '--domains', '--since', '--config'].includes(a)) throw new Error(`unknown flag: ${a}`);
    if (v === undefined) throw new Error(`missing value for ${a}`);
    // An empty value is a shell variable that expanded to nothing. An empty --state used to
    // read as a missing state file - a first run - instead of the error it is. --domains keeps
    // its own, more specific message for the same value.
    if (a !== '--domains' && String(v).trim() === '') throw new Error(`empty value for ${a}`);
    if (a === '--state') out.state = v;
    else if (a === '--items') out.items = v;
    else if (a === '--out') out.out = v;
    else if (a === '--date') out.date = v;
    else if (a === '--domains') {
      // "" would otherwise mean "every domain" to update and "no domain" to plan.
      const list = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) throw new Error('invalid --domains: expected at least one domain key');
      out.domains = list;
    }
    else if (a === '--since') out.since = v;
    else if (a === '--config') out.config = v;
  }
  return out;
}

function loadState(path, config) {
  if (!existsSync(path)) return emptyState(config.domains.map((d) => d.key));
  const raw = readFileSync(path, 'utf8');
  const state = JSON.parse(raw);
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('state is not an object');
  return state;
}

// One day has several spellings. The run identity is the normalised day plus the
// domains covered, because merging the same day twice under two spellings would
// append a second run-log entry and count every item again — the double count this
// guard exists to prevent.
export function normalizeRunDate(value) {
  const text = String(value ?? '').trim();
  const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (parts) return `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

// A run is identified by its date and the domains it covered. Merging the same
// run twice would append a second run log entry and count every item again, so a
// repeated delivery in the same session is refused instead of silently corrupting
// the state.
//
// The refusal covers the runs the log still retains (runs_history_max entries, which
// is a year at a weekly cadence). A run old enough to have fallen off the front is
// accepted again: the state records watermarks, not the dates of past runs, so any
// rule that refused it would also refuse a legitimate focused catch-up on the same
// day — which the schema allows. The consequence is pinned by the test below rather
// than papered over.
export function findRecordedRun(state, date, domainKeys) {
  const wanted = [...domainKeys].sort().join(',');
  const day = normalizeRunDate(date);
  return (state.runs ?? []).find(
    (r) => normalizeRunDate(r.date) === day && [...(r.domains ?? [])].sort().join(',') === wanted,
  ) ?? null;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`update-state: ${err.message}`);
    console.error(USAGE);
    process.exitCode = 2;
    return 2;
  }
  if (opts.command !== 'plan' && opts.command !== 'update') {
    console.error(`update-state: unknown command ${opts.command ?? '(none)'}`);
    console.error(USAGE);
    process.exitCode = 2;
    return 2;
  }
  let config;
  try {
    config = readConfig(opts.config);
  } catch (err) {
    console.error(`update-state: cannot read config ${opts.config}: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  let state;
  try {
    state = loadState(opts.state, config);
  } catch (err) {
    console.error(`update-state: cannot read state ${opts.state}: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  const now = new Date();
  if (opts.command === 'plan') {
    let plan;
    try {
      plan = planWindows(config, state, now, opts.domains, opts.since);
    } catch (err) {
      console.error(`update-state: ${err.message}`);
      process.exitCode = err.exitCode ?? 2;
      return process.exitCode;
    }
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  if (!opts.items || !opts.out || !opts.date) {
    console.error('update-state: update needs --items, --out and --date');
    console.error(USAGE);
    process.exitCode = 2;
    return 2;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    console.error(`update-state: --date must be YYYY-MM-DD, got ${JSON.stringify(opts.date)}`);
    process.exitCode = 2;
    return 2;
  }
  let items;
  try {
    items = JSON.parse(readFileSync(opts.items, 'utf8'));
  } catch (err) {
    console.error(`update-state: cannot read items ${opts.items}: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  if (!Array.isArray(items)) {
    console.error(`update-state: ${opts.items} is not an array of items`);
    process.exitCode = 3;
    return 3;
  }
  // --domains is validated before the duplicate-run guard because that guard builds the
  // run identity by filtering the catalogue: an unknown key is silently dropped there,
  // so a run that merely overlaps a recorded one would be refused as "already recorded"
  // and the typo would never be named. mergeRun and planWindows still validate, for
  // library callers that do not pass through main().
  try {
    assertKnownDomains(config, opts.domains);
  } catch (err) {
    console.error(`update-state: ${err.message}`);
    process.exitCode = err.exitCode ?? 2;
    return process.exitCode;
  }
  // The run this call describes must not already be in the state. Comparing the
  // date and the covered domains catches the repeated delivery of one run, while
  // a focus run or another day's run is still allowed through.
  const coveredKeys = (opts.domains && opts.domains.length
    ? config.domains.filter((d) => opts.domains.includes(d.key))
    : config.domains).map((d) => d.key);
  const recorded = findRecordedRun(state, opts.date, coveredKeys);
  if (recorded) {
    // "these 1 domains" reads as a bug in the message, not as a count.
    const noun = coveredKeys.length === 1 ? 'domain' : 'domains';
    console.error(`update-state: the ${opts.date} run covering these ${coveredKeys.length} ${noun} is already recorded in ${opts.state}; nothing was merged. Use a different --date, or --domains for a focus run.`);
    process.exitCode = 2;
    return 2;
  }
  // The run log records the window the run actually had. An explicit --since is
  // the catch-up floor, and it is clamped by window_cap_weeks exactly as 'plan'
  // clamps it, so the state can never claim coverage the run did not have.
  let window = null;
  if (opts.since) {
    const planned = planWindows(config, state, now, opts.domains, opts.since);
    window = { since: planned.since, until: planned.until };
  }
  let merged;
  try {
    merged = mergeRun(config, state, {
      items,
      date: opts.date,
      entry: opts.domains && opts.domains.length ? 'focus' : 'weekly',
      now,
      only: opts.domains,
      window,
    });
  } catch (err) {
    console.error(`update-state: ${err.message}`);
    process.exitCode = err.exitCode ?? 2;
    return process.exitCode;
  }
  try {
    writeFileSync(opts.out, `${JSON.stringify(merged.state, null, 2)}\n`);
  } catch (err) {
    console.error(`update-state: cannot write ${opts.out}: ${err.message}`);
    process.exitCode = 4;
    return 4;
  }
  console.log(JSON.stringify({ updated: opts.out, results: merged.results }, null, 2));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
