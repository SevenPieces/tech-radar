// tests/sweep10-independent-regression.test.mjs
// Independent regression tests for TR-162, TR-163 and TR-164: the three collector degradations
// the sweep over b005e06 recorded. Written as an independent design: every case drives a public
// seam -- the collectAll entry point, the shipped transport shaper, or the shipped CLI through a
// real child process on PATH -- and every boundary the cases depend on (the lowest accepted
// notice cap, and the largest snippet bound that cap accepts) is found by bisection through the
// shipped code rather than named, so a fix that moves a floor is still measured against the new
// one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectAll } from '../scripts/collect.mjs';
import { shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const CLI = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
const SHIPPED_SETTINGS = readSettings(join(CONFIG_DIR, 'settings.md'));
const RUN_SETTINGS = { ...SHIPPED_SETTINGS, github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const PROBE = 'https://api.github.com/rate_limit';
const FEED = 'https://a.example/feed.xml';

// The failure shape execFileSync raises when curl exits nonzero: status is curl's own process exit
// code, so the shaper reads it and maps it to the fixed cause. Nothing here is curl's diagnostic
// line, which the shaper never quotes.
const TRANSPORT_FAILURE = {
  status: 6,
  signal: null,
  stdout: Buffer.from('\n000'),
  stderr: Buffer.from('curl: (6) Could not resolve the host\n'),
  message: 'Command failed: curl -sSL -- ' + FEED,
};
const TRANSPORT_CAUSE = 'could not resolve the host (curl exit 6)';

function tempConfig(dir, watchlistLines) {
  const cfg = join(dir, 'config');
  mkdirSync(cfg, { recursive: true });
  for (const name of ['domains.md', 'settings.md', 'sources.md']) {
    copyFileSync(join(CONFIG_DIR, name), join(cfg, name));
  }
  writeFileSync(join(cfg, 'watchlist.md'), watchlistLines.join('\n'));
  return { cfg, out: join(dir, '.pool.json') };
}

function runCollector(dir, pathValue, target) {
  const config = tempConfig(dir, [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | ' + target + ' | ai-llm | answered by the tool PATH supplies |',
    '',
  ]);
  const res = spawnSync(process.execPath, [
    CLI, '--config', config.cfg, '--out', config.out, '--timeout', '10000', '--domain', 'ai-llm',
  ], { encoding: 'utf8', env: { ...process.env, PATH: pathValue, TECH_RADAR_DIR: '' } });
  assert.equal(res.error, undefined, 'the collector could not be spawned: ' + res.error);
  return JSON.parse(res.stdout);
}

// ---------------------------------------------------------------------------------------
// TR-162 -- the pre-request cross-check between the notice cap and the snippet bound is
// label-blind, so at the lowest accepted pair the assembled notice leaves the shaped error text
// too little room for its own request half: a real failing request is published as a request one
// character long, and the sentence both shipped documents state -- that an accepted pair always
// leaves the shaped error text whole -- is false. The cases below measure the run's own published
// notice across every label the collector stamps on a transport failure, at the lowest pair the
// shipped code accepts (bisected, never named). The second case reaches the same guarantee through
// the source's own text: the cap arithmetic bounds the source before it is normalised, and the
// normaliser can lengthen it past the room it was granted, which cuts the shaped text's tail.
// ---------------------------------------------------------------------------------------

// The largest snippet bound a given notice cap accepts, found by bisection through the shipped
// collectAll seam: an empty selection exercises configuration validation alone, so probing costs no
// request and no network. Zero means the cap accepts no bound at all.
async function largestAcceptedSnippet(cap) {
  if (!(await pairAccepted(cap, 1))) return 0;
  let lo = 1;
  let hi = Math.max(1, cap);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (await pairAccepted(cap, mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

async function pairAccepted(cap, snippet) {
  try {
    await collectAll(
      { settings: { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet }, watchlist: [] },
      { ...WINDOW, net: { fetchText: async () => { throw new Error('an acceptance probe issues no request'); } } },
    );
    return true;
  } catch {
    return false;
  }
}

let lowestPairCache;
async function lowestAcceptedPair() {
  if (lowestPairCache) return lowestPairCache;
  // The cap range is walked from the documented floor upward, and the pair the run accepts is the
  // lowest one it will take, whatever the check's arithmetic becomes.
  for (let cap = 128; cap <= 4096; cap += 1) {
    const snippet = await largestAcceptedSnippet(cap);
    if (snippet > 0) { lowestPairCache = { cap, snippet }; return lowestPairCache; }
  }
  throw new Error('no (notice_max_chars, error_snippet_max_chars) pair was accepted');
}

// Every label the collector stamps on a transport notice, each with a row whose own request fails
// with the fixed exit-6 cause. One row per case keeps the notice list unambiguous.
const LABEL_ROWS = [
  ['rss', { kind: 'rss', target: FEED }],
  ['arxiv', { kind: 'arxiv-category', target: 'cs.AI' }],
  ['github', { kind: 'github-repo', target: 'acme/repo-one' }],
  ['github', { kind: 'github-org', target: 'acme' }],
  ['ghsa', { kind: 'ghsa', target: 'GHSA-xxxx-yyyy-zzzz' }],
  ['nvd', { kind: 'nvd', target: 'CVE-2026-12345' }],
  ['npm', { kind: 'npm', target: 'some-package' }],
  ['pypi', { kind: 'pypi', target: 'some-package' }],
  ['crates', { kind: 'crates', target: 'some-crate' }],
  ['gomod', { kind: 'gomod', target: 'github.com/acme/module' }],
];

const rateLimit = (remaining = 5000, limit = 5000) => JSON.stringify({
  resources: { core: { limit, remaining, reset: 1790177128, used: limit - remaining } },
});

// A transport whose every request fails with the shape curl raises for exit 6, shaped by the
// shipped shaper at the bound the collector passes it -- so the failure text is the run's own.
function failingTransport() {
  return {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      if (url === PROBE) return rateLimit();
      throw shapeTransportError(TRANSPORT_FAILURE, url, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
}

// The run's own notice of the failed request, found by what any wording of it carries: the
// shaped transport text is the only notice one failing row produces.
async function transportNotice(row, settings) {
  const pool = await collectAll({ settings, watchlist: [row] }, { ...WINDOW, net: failingTransport() });
  const notice = pool.notices.find((n) => /request failed/.test(n));
  assert.ok(notice, 'the failed request produced no transport notice: '
    + JSON.stringify(pool.notices));
  return notice;
}

test('TR-162 at the lowest accepted pair every notice label leaves the request more than one character', async () => {
  const { cap, snippet } = await lowestAcceptedPair();
  const settings = { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet };

  const lost = [];
  for (const [label, row] of LABEL_ROWS) {
    const notice = await transportNotice(row, settings);
    assert.ok(notice.length <= cap,
      'the ' + label + ' notice is ' + notice.length + ' characters at notice_max_chars ' + cap
      + ': ' + JSON.stringify(notice));
    assert.ok(notice.includes(TRANSPORT_CAUSE),
      'the ' + label + ' notice lost the transport cause at the lowest accepted pair (' + cap + '/'
      + snippet + '): ' + JSON.stringify(notice));

    // The request half of the shaped text: the shaper shortens the redacted request to the room the
    // snippet bound leaves, and a single character is not a request an operator can recognize.
    const named = notice.match(/request failed for ([^:]+): /);
    if (!named) {
      lost.push(label + ' names no request at all: ' + JSON.stringify(notice));
    } else if (named[1].length <= 1) {
      lost.push(label + ' reduced the request to ' + JSON.stringify(named[1]) + ': '
        + JSON.stringify(notice));
    }
  }
  assert.deepEqual(lost, [],
    'at the lowest accepted pair (' + cap + '/' + snippet + ') these labels lost the request half of '
    + 'the diagnosis: ' + lost.join(' | '));
});

// The same guarantee reached through the source's own text: the source is bounded before it is
// normalised, and the normaliser lengthens a link seam by one character. A target carrying seams
// therefore pushes the shaped text past the cap, where the tail -- the cause -- is cut away.
const SEAMED_URL = 'https://a.example/' + '](x'.repeat(40);
const SEAMED_LABEL_ROWS = [
  ['rss', { kind: 'rss', target: SEAMED_URL }],
  ['github', { kind: 'github-org', target: 'acme' + '](x'.repeat(40) }],
  ['npm', { kind: 'npm', target: 'pkg' + '](x'.repeat(40) }],
];

test('TR-162 at the lowest accepted pair a source the normaliser lengthens does not cut the shaped text', async () => {
  const { cap, snippet } = await lowestAcceptedPair();
  const settings = { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet };

  const cut = [];
  for (const [label, row] of SEAMED_LABEL_ROWS) {
    const notice = await transportNotice(row, settings);
    if (!notice.includes(TRANSPORT_CAUSE)) {
      cut.push(label + ' (' + notice.length + ' characters): ' + JSON.stringify(notice));
    }
  }
  assert.deepEqual(cut, [],
    'at the lowest accepted pair (' + cap + '/' + snippet + ') the assembled notice no longer carries '
    + 'the intact shaped error text for these labels, so its tail -- the cause -- is cut away: '
    + cut.join(' | '));
});

// ---------------------------------------------------------------------------------------
// TR-163 -- a child the operating system ended with a signal carries status null and a signal,
// and the shaper's fall-through reads neither, so a kill is published as the bare failure literal
// and is indistinguishable from a tool that could not be started. The cases below drive both a
// direct shaper call and the shipped CLI with a real child that kills itself, and pin the
// neighbouring cause: a tool that genuinely never started must keep its own diagnosis.
// ---------------------------------------------------------------------------------------

// Node's own name for the signal, and the number a tool-agnostic wording could name instead, so a
// fix that reports the kill either way still answers.
const SIGNAL_WORDS = [['SIGKILL', /SIGKILL|signal[\s-]*9\b/i], ['SIGTERM', /SIGTERM|signal[\s-]*15\b/i]];

test('TR-163 a child killed by a signal is reported with that signal, not as a tool that failed to start', () => {
  for (const [signal, words] of SIGNAL_WORDS) {
    const shaped = shapeTransportError(
      { status: null, signal, stdout: Buffer.from('\n000'), stderr: Buffer.alloc(0), message: 'Command failed: curl' },
      FEED, 200,
    );
    assert.doesNotMatch(shaped.message, /could not be started/i,
      'a child the system killed with ' + signal + ' is reported as a tool that could not be started: '
      + JSON.stringify(shaped.message));
    assert.notEqual(shaped.cause, 'curl failed',
      'a child the system killed with ' + signal + ' is reported as the bare failure literal, which '
      + 'names neither the kill nor the tool: ' + JSON.stringify(shaped.message));
    assert.match(shaped.message, words,
      'the shaped text of a child killed with ' + signal + ' does not name the signal that ended it: '
      + JSON.stringify(shaped.message));
  }
});

test('TR-163 the shipped CLI reports a signal-killed child with its signal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-sweep10-signal-'));
  try {
    // PATH holds the shim alone, so no real tool and no network is reachable, and the child the
    // collector starts is killed by the signal the case names.
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const shim = join(bin, 'curl');
    writeFileSync(shim, '#!/bin/sh\nkill -KILL $$\n');
    chmodSync(shim, 0o755);

    const pool = runCollector(dir, bin, FEED);
    assert.equal(pool.notices.length, 1, 'the signal-killed row produced ' + pool.notices.length
      + ' notices: ' + JSON.stringify(pool.notices));
    const notice = pool.notices[0];
    assert.doesNotMatch(notice, /could not be started/i,
      'the child ran and was killed, and the notice reports a start failure: ' + notice);
    assert.match(notice, /SIGKILL|signal[\s-]*9\b|killed|terminated/i,
      'the notice of a signal-killed child names neither the signal nor the kill: ' + notice);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TR-163 a tool that genuinely could not be started keeps its own cause', () => {
  const shaped = shapeTransportError({ code: 'ENOENT', message: 'spawn curl ENOENT' }, FEED, 200);
  assert.match(shaped.cause, /could not be started/i,
    'the missing-tool diagnosis is gone: ' + JSON.stringify(shaped.cause));
  assert.match(shaped.cause, /ENOENT/,
    'the cause no longer names why the tool could not start: ' + JSON.stringify(shaped.cause));

  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-sweep10-missing-'));
  try {
    // A PATH with no tool at all: the collector's own spawn fails, which is the case the cause
    // above exists for.
    const empty = join(dir, 'empty');
    mkdirSync(empty, { recursive: true });
    const pool = runCollector(dir, empty, FEED);
    assert.equal(pool.notices.length, 1, 'the missing tool produced ' + pool.notices.length
      + ' notices: ' + JSON.stringify(pool.notices));
    assert.match(pool.notices[0], /could not be started/i,
      'a genuinely missing tool is no longer reported as one that could not be started: '
      + JSON.stringify(pool.notices[0]));
    assert.match(pool.notices[0], /ENOENT/,
      'the notice of a genuinely missing tool does not name the spawn code: '
      + JSON.stringify(pool.notices[0]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// TR-164 -- the per-listing bound silently drops entries beyond the configured count, so a run
// publishes identical output whether an organisation listing held exactly the configured number of
// repositories or far more. The same file reports the analogous arXiv cap with a notice, and the
// source half of the same setting is bounded without any report of its own. A listing longer than
// the count must say so; a listing at or within the count must not.
// ---------------------------------------------------------------------------------------

const TRUNCATION = /truncat|cap|drop|ignor|beyond|exceed|fewer|partial|incomplete|only\s+\d|more\s+than/i;

function listingTransport(entries) {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit();
      if (url.includes('/orgs/acme/repos')) {
        return JSON.stringify(Array.from({ length: entries }, (_, i) => ({
          full_name: 'acme/repo-' + i,
          updated_at: new Date(Date.UTC(2026, 8, 20, 0, 0, entries - i)).toISOString(),
        })));
      }
      if (url.includes('/releases') || url.includes('/tags')) return '[]';
      throw new Error('unexpected request: ' + url);
    },
  };
  return { net, calls };
}

async function orgPool(entries, bound) {
  const stub = listingTransport(entries);
  const pool = await collectAll(
    { settings: { ...RUN_SETTINGS, github_org_repos: bound }, watchlist: [{ kind: 'github-org', target: 'acme', domain: 'ai-llm', note: '' }] },
    { ...WINDOW, net: stub.net },
  );
  return { pool, calls: stub.calls };
}

const releaseRequests = (calls) => calls.filter((url) => url.includes('/releases'));

test('TR-164 a listing longer than the configured count reports the truncation', async () => {
  const bound = 10;
  const over = await orgPool(bound + 6, bound);
  const exact = await orgPool(bound, bound);

  // The bound still decides the request volume in both cases: this case is about the silence that
  // surrounds the drop, not about the drop itself.
  assert.equal(releaseRequests(over.calls).length, bound,
    'the oversized listing was not bounded to the configured count: '
    + releaseRequests(over.calls).length + ' repository requests');
  assert.equal(releaseRequests(exact.calls).length, bound,
    'the exact listing did not yield the configured count of repository requests: '
    + releaseRequests(exact.calls).length);

  const reported = over.pool.notices.filter((n) => TRUNCATION.test(n));
  assert.equal(reported.length, 1,
    'a listing of ' + (bound + 6) + ' entries at github_org_repos ' + bound + ' produced '
    + reported.length + ' notices reporting the truncation, so the drop is invisible: '
    + JSON.stringify(over.pool.notices));
  assert.match(reported[0], /\b(?:10|12|16|6)\b/,
    'the truncation notice names no count, so the operator cannot tell how much was dropped: '
    + JSON.stringify(reported[0]));
});

test('TR-164 a listing at or within the configured count reports no truncation', async () => {
  const bound = 10;
  for (const entries of [bound - 1, bound]) {
    const { pool } = await orgPool(entries, bound);
    assert.deepEqual(pool.notices, [],
      'a listing of ' + entries + ' entries at github_org_repos ' + bound + ' reported a truncation '
      + 'or another notice: ' + JSON.stringify(pool.notices));
  }
});
