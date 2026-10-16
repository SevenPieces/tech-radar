// tests/sweep9-independent-regression.test.mjs
// Independent regression tests for TR-158, TR-159 and TR-160: the three collector degradations
// the final sweep recorded against 4952e1b. Written as a second, independent design: every case
// drives a public seam -- the collectAll entry point, the shipped CLI through a real child
// process with a shim tool on PATH, or the shipped transport shaper -- and reads the run's own
// published notices rather than a private helper, so a fix is measured by what an operator
// receives and not by where it was made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectAll } from '../scripts/collect.mjs';
import { shapeHttpError, shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const CLI = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
const SHIPPED_SETTINGS = readSettings(join(CONFIG_DIR, 'settings.md'));
const RUN_SETTINGS = { ...SHIPPED_SETTINGS, github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const PROBE = 'https://api.github.com/rate_limit';
const ORG = 'acme';
const ORG_ROW = [{ kind: 'github-org', target: ORG, domain: 'infra-cloud', note: '' }];
const FEED = 'https://blog.example/feed.xml';

// A budget large enough that the allowance is never what bounds a case, so every bound the
// cases below measure is the run's own and not the environment's.
const rateLimit = (remaining = 5000, limit = 5000) => JSON.stringify({
  resources: { core: { limit, remaining, reset: 1790177128, used: limit - remaining } },
});

// A repository name the run accepts, in the order a listing most recently updated first would
// carry: the answer decides the order, and the run decides how much of it to take.
const REPO_NAMES = (n) => Array.from({ length: n }, (_, i) => ORG + '/repo-' + i);
// An entry name the run refuses: answer text that is not a repository name, so it is never a
// request target and never a value a notice is redacted against.
const REFUSED_TEXT = (i) => 'answer entry ' + i + ' ?token=x&y=';

// A stub that answers the rate-limit probe and one organisation listing with exactly the entries
// it is handed. The answer's length is the case's subject, so the stub is the only place it is
// decided: no live source and no other request shape is reachable from here.
function listingNet(entries, { failReleases = false } = {}) {
  const calls = [];
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      calls.push(url);
      if (url === PROBE) return rateLimit();
      if (url.includes('/orgs/' + ORG + '/repos')) {
        return JSON.stringify(entries.map((full_name) => ({ full_name })));
      }
      if (url.includes('/releases')) {
        // A repository whose releases request fails is one notice each: that is the failure
        // notice whose count must not grow with the answer's length.
        if (failReleases) {
          throw shapeHttpError(500, Buffer.from('{"message":"boom"}'), url, limit, headers ?? {}, Boolean(omitUrl));
        }
        return '[]';
      }
      if (url.includes('/tags')) return '[]';
      throw new Error('unexpected request: ' + url);
    },
  };
  return { net, calls };
}

async function orgPool(entries, settings, options) {
  const stub = listingNet(entries, options);
  const pool = await collectAll({ settings, watchlist: ORG_ROW }, { ...WINDOW, net: stub.net });
  return { pool, calls: stub.calls };
}

// The requests the run made for one repository each, and the notices that report the listing's
// own refused entry names. Both are read from the run's own vocabulary, so a fix that rewrites
// a sentence still answers.
const releaseRequests = (calls) => calls.filter((url) => url.includes('/releases'));
const listingNotices = (pool) => pool.notices.filter((n) => /listing entry/i.test(n));

// ---------------------------------------------------------------------------------------
// TR-158 -- github_org_repos bounded only the listing request's per_page, and nothing re-checked
// the answer, so a listing that ignored the bound decided how many repositories the run asked
// about, how many requests it charged and how many failure notices it published. At most the
// configured number of entries may be taken from one listing, so the answer can no longer decide
// those counts.
// ---------------------------------------------------------------------------------------

test('TR-158 a listing with far more conforming entries than the setting yields at most that many targets', async () => {
  const bound = 3;
  const settings = { ...RUN_SETTINGS, github_org_repos: bound };
  const small = await orgPool(REPO_NAMES(bound + 1), settings, { failReleases: true });
  const large = await orgPool(REPO_NAMES(200), settings, { failReleases: true });

  const asked = releaseRequests(large.calls);
  assert.ok(asked.length > 0,
    'the listing contributed no target at all, so the bound below would hold vacuously: '
    + JSON.stringify(large.pool.notices));
  assert.ok(asked.length <= bound,
    'a 200-entry listing produced ' + asked.length + ' repository requests at github_org_repos ' + bound
    + '; at most the configured number of targets may be taken from one listing: '
    + JSON.stringify(asked.slice(0, 5)));

  assert.equal(large.pool.notices.length, small.pool.notices.length,
    'a longer answer grew the published notice count (' + small.pool.notices.length + ' -> '
    + large.pool.notices.length + '); one listing answer must not decide the volume of the run\'s output. '
    + 'large: ' + JSON.stringify(large.pool.notices.slice(0, 5)));
  // A listing that dropped accepted entries also publishes exactly one truncation notice, on top
  // of the failure notices its retained targets produce. That extra notice is a deliberate,
  // reported coverage loss, so the bound is the configured number of targets plus it -- and the
  // report is asserted first, so the extra notice is never traded for silence.
  const truncation = large.pool.notices.filter((n) => /listing capped at/.test(n));
  assert.equal(truncation.length, 1,
    'the oversized listing did not report its truncation exactly once: '
    + JSON.stringify(large.pool.notices));
  assert.ok(large.pool.notices.length <= bound + truncation.length,
    'the answer decided how many notices the run emits (' + large.pool.notices.length
    + ' at github_org_repos ' + bound + ', one of which must be its own truncation report): '
    + JSON.stringify(large.pool.notices.slice(0, 5)));
});

test('TR-158 the number of targets taken from one listing is the configured repositories-per-organisation value', async () => {
  const listing = REPO_NAMES(200);
  const two = await orgPool(listing, { ...RUN_SETTINGS, github_org_repos: 2 }, { failReleases: true });
  const six = await orgPool(listing, { ...RUN_SETTINGS, github_org_repos: 6 }, { failReleases: true });

  const small = releaseRequests(two.calls).length;
  const big = releaseRequests(six.calls).length;
  assert.ok(small <= 2,
    'github_org_repos 2 did not bound the answer: the run made ' + small + ' repository requests');
  assert.ok(big <= 6,
    'github_org_repos 6 did not bound the answer: the run made ' + big + ' repository requests');
  assert.ok(big > small,
    'raising the setting did not raise the bound the answer is read against (' + small + ' -> ' + big
    + '); the bound must be the configured value, not a constant that ignores it');
});

// ---------------------------------------------------------------------------------------
// TR-159 -- the aggregate notice dropped the entry's position for two or more refused entries,
// although the first position is computed and is carried when there is exactly one. An operator
// told several entries are bad must still be told where the first one sat.
// ---------------------------------------------------------------------------------------

test('TR-159 two or more refused entries still carry the first refused position', async () => {
  // Refused entries sit at positions 2, 4 and 5; the first refused position is 2.
  const entries = [REPO_NAMES(1)[0], REFUSED_TEXT(1), ORG + '/repo-9', REFUSED_TEXT(2), REFUSED_TEXT(3)];
  const { pool } = await orgPool(entries, RUN_SETTINGS);
  const about = listingNotices(pool);

  assert.equal(about.length, 1,
    'the listing produced ' + about.length + ' notices for its refused entries; precisely one aggregate '
    + 'notice is required: ' + JSON.stringify(about));
  assert.ok(about[0].includes('3'),
    'the aggregate notice does not carry the count of refused entries: ' + JSON.stringify(about[0]));

  const shown = about[0].match(/repository\s+(\d+)/);
  assert.ok(shown,
    'the aggregate notice of 3 refused entries says nothing about where they sat, while the notice of one '
    + 'names its position: ' + JSON.stringify(about[0]));
  assert.equal(Number(shown[1]), 2,
    'the aggregate notice names position ' + shown[1] + ' instead of the first refused position 2: '
    + JSON.stringify(about[0]));
});

// The boundary the case above must not move: one refused entry already names its position.
test('TR-159 a single refused entry still names its position', async () => {
  const entries = [ORG + '/repo-1', REFUSED_TEXT(1), ORG + '/repo-2'];
  const { pool } = await orgPool(entries, RUN_SETTINGS);
  const about = listingNotices(pool);

  assert.equal(about.length, 1, 'the listing produced ' + about.length + ' aggregate notices');
  const shown = about[0].match(/repository\s+(\d+)/);
  assert.ok(shown, 'the notice of one refused entry lost its position: ' + JSON.stringify(about[0]));
  assert.equal(Number(shown[1]), 2, 'the notice names the wrong position: ' + JSON.stringify(about[0]));
});

// ---------------------------------------------------------------------------------------
// TR-160 -- the transport bounds one child tool's captured output, and a tool that answered with
// more than the bound was stopped by it. The notice reported that tool as one that could not be
// started, which is a false diagnosis: a broken dependency is what that cause is for, and the
// operator is told to look for the wrong fault. The case is driven end to end with a real child
// process and a shim tool on PATH, so the failure is the one a live run takes.
// ---------------------------------------------------------------------------------------

function shimTool(dir, bytes) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, 'curl');
  const emit = 'process.stdout.write("a".repeat(' + bytes + '))';
  writeFileSync(shim, '#!/bin/sh\nexec ' + JSON.stringify(process.execPath) + ' -e ' + JSON.stringify(emit) + '\n');
  chmodSync(shim, 0o755);
  return bin;
}

function tempConfig(dir) {
  const cfg = join(dir, 'config');
  mkdirSync(cfg, { recursive: true });
  for (const name of ['domains.md', 'settings.md', 'sources.md']) {
    copyFileSync(join(CONFIG_DIR, name), join(cfg, name));
  }
  writeFileSync(join(cfg, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    '| rss | ' + FEED + ' | ai-llm | answered by the shim tool on PATH |',
    '',
  ].join('\n'));
  return { cfg, out: join(dir, '.pool.json') };
}

function runCollector(dir, pathValue) {
  const config = tempConfig(dir);
  const res = spawnSync(process.execPath, [
    CLI, '--config', config.cfg, '--out', config.out, '--timeout', '10000', '--domain', 'ai-llm',
  ], { encoding: 'utf8', env: { ...process.env, PATH: pathValue, TECH_RADAR_DIR: '' } });
  assert.equal(res.error, undefined, 'the collector could not be spawned: ' + res.error);
  return JSON.parse(res.stdout);
}

test('TR-160 an answer past the capture bound is diagnosed as the tool that ran, not as one that could not be started', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-sweep9-ceiling-'));
  try {
    // Past the transport's own 64 MiB captured-output bound, from a tool that starts, runs and
    // answers. PATH holds the shim alone, so no real tool and no network is reachable.
    const bin = shimTool(dir, 70 * 1024 * 1024);
    const pool = runCollector(dir, bin);

    assert.equal(pool.candidates.length, 0, 'the oversized answer produced a candidate');
    assert.equal(pool.notices.length, 1, 'the row produced ' + pool.notices.length + ' notices: '
      + JSON.stringify(pool.notices));
    const notice = pool.notices[0];

    assert.doesNotMatch(notice, /could not be started/i,
      'the tool ran and answered, and the notice reports a start failure: ' + notice);
    assert.match(notice, /ceiling|capture|maxBuffer|64\s*MiB|exceed|too large/i,
      'the notice does not attribute the failure to the captured-output bound the transport sets: ' + notice);
    assert.match(notice, /ran|answered|killed|terminated|signal|SIGTERM|exited|exit status/i,
      'the notice does not diagnose what the tool itself did -- its own exit status or signal -- as required '
      + 'for a tool that was stopped by the bound: ' + notice);
    assert.doesNotMatch(notice, /-sSL|--compressed|Authorization|Bearer|spawnSync|execFileSync/,
      'the notice carries request arguments or the child message: ' + notice);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The boundary the case above must not move: a tool that really never started is still reported
// as one that could not be started, with the code that says why. Removing that cause to silence
// the false diagnosis above would lose the true one.
test('TR-160 a tool that could not be started is still reported as such', () => {
  const shaped = shapeTransportError({ code: 'ENOENT', message: 'spawn curl ENOENT' }, FEED, 200);
  assert.match(shaped.cause, /could not be started/i,
    'the missing-tool diagnosis is gone: ' + JSON.stringify(shaped.cause));
  assert.match(shaped.cause, /ENOENT/, 'the cause no longer names why the tool could not start: '
    + JSON.stringify(shaped.cause));
});
