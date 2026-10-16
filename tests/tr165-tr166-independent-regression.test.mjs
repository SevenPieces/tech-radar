// tests/tr165-tr166-independent-regression.test.mjs
// Independent regression tests for TR-165 and TR-166: the two collector degradations the
// sweep over batch 22 recorded. Every case drives a public seam -- collectAll, the shipped
// transport shaper, the notice rewriting the push applies, or the shipped CLI through a real
// child process -- and every boundary a case depends on (the lowest accepted notice cap, and
// the largest snippet bound that cap accepts) is found by bisection through the shipped code
// rather than named, so a fix that moves a floor is still measured against the new one.
//
// TR-165 -- the shaped error text reaches the assembled notice without crossing the notice
// rewriting, so the rewriting lengthens every markdown link seam the text spells by one
// character. At the lowest pair of the two bound settings the assembled notice leaves the cap
// exactly full, so that growth pushes the tail of the notice -- the cause -- past the cap,
// where the slice removes it. The cases below drive the shipped collector and the shipped CLI
// with a real target shape at the pair the code accepts, and ask the rewriting itself to be a
// fixed point on hostile strings.
//
// TR-166 -- the drop the previous batch reported cannot happen: the request asks for exactly
// the configured number of entries and reads one page, so a conformant answer never returns
// more than the page and the retained slice is never smaller than the answer. The loss that
// can happen is a listing that fills the page the run asked for: it may hold more. The cases
// below read the page size the collector itself sends and answer that request exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// The failure shape execFileSync raises when curl exits nonzero: status is curl's own process
// exit code, so the shaper reads it and maps it to the fixed cause. Nothing here is curl's
// diagnostic line, which the shaper never quotes.
const TIMED_OUT = {
  status: 28,
  signal: null,
  stdout: Buffer.from('\n000'),
  stderr: Buffer.from('curl: (28) Operation timed out\n'),
  message: 'Command failed: curl -sSL -- ' + FEED,
};
const TIMED_OUT_CAUSE = 'timed out (curl exit 28)';

// The largest snippet bound a given notice cap accepts, and the lowest pair the shipped
// validation takes -- bisected through collectAll with an empty selection, so probing costs no
// request and no network.
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

let lowestPairCache;
async function lowestAcceptedPair() {
  if (lowestPairCache) return lowestPairCache;
  for (let cap = 128; cap <= 4096; cap += 1) {
    const snippet = await largestAcceptedSnippet(cap);
    if (snippet > 0) { lowestPairCache = { cap, snippet }; return lowestPairCache; }
  }
  throw new Error('no (notice_max_chars, error_snippet_max_chars) pair was accepted');
}

// ---------------------------------------------------------------------------------------
// TR-165 -- the shaped error text carries the request, a real target can spell a markdown
// link seam in it, and the notice rewriting ends each seam one character longer. At the
// lowest accepted pair the notice has no slack at all, so what the run publishes must still
// carry the status and the cause and must still be inside the cap.
// ---------------------------------------------------------------------------------------

// A real target shape -- scheme, host and a path of hostile text -- long enough for the
// source half of the notice to be filled, so the assembled notice sits at the cap.
const SEAM = '](x';
function seamedTarget(total) {
  return ('https://a.co/' + SEAM.repeat(40)).slice(0, total);
}

// The run's own notice of one failed request, driven through the shipped collector at the pair
// the configuration accepts. The transport shaper is the shipped one.
async function transportNoticesAt(target, settings, err = TIMED_OUT) {
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      if (url === PROBE) {
        return JSON.stringify({ resources: { core: { limit: 5000, remaining: 5000, reset: 1790177128, used: 0 } } });
      }
      throw shapeTransportError(err, url, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
  const pool = await collectAll(
    { settings, watchlist: [{ kind: 'rss', target, domain: 'ai-llm', note: '' }] },
    { ...WINDOW, net },
  );
  return pool.notices;
}

test('TR-165 at the lowest accepted pair a target the rewriting lengthens keeps the cause inside the cap', async () => {
  const { cap, snippet } = await lowestAcceptedPair();
  const settings = { ...RUN_SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet };

  const offenders = [];
  for (let total = 16; total <= 72; total += 1) {
    const target = seamedTarget(total);
    const notices = await transportNoticesAt(target, settings);
    if (notices.length !== 1) {
      offenders.push('a ' + total + ' character target produced ' + notices.length + ' notices');
      continue;
    }
    const notice = notices[0];
    if (notice.length > cap) {
      offenders.push('the notice is ' + notice.length + ' characters: ' + JSON.stringify(notice));
    }
    if (!notice.includes(TIMED_OUT_CAUSE)) {
      offenders.push('the cause is gone: ' + JSON.stringify(notice));
    }
  }
  assert.deepEqual(offenders, [],
    'at the lowest accepted pair (' + cap + '/' + snippet + ') a target whose text the notice rewriting '
    + 'lengthens is pushed past the cap and its cause is sliced off: ' + offenders.slice(0, 6).join(' | '));
});

test('TR-165 the shipped CLI keeps the cause of a real timed-out request at the lowest accepted pair', async () => {
  const { cap, snippet } = await lowestAcceptedPair();
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-tr165-'));
  try {
    // PATH holds the shim alone, so the transport is a real child process that reports curl's
    // own exit-28 shape and no network is reachable.
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const shim = join(bin, 'curl');
    writeFileSync(shim, '#!/bin/sh\nexit 28\n');
    chmodSync(shim, 0o755);

    const cfg = join(dir, 'config');
    mkdirSync(cfg, { recursive: true });
    for (const name of ['domains.md', 'sources.md', 'settings.md']) {
      copyFileSync(join(CONFIG_DIR, name), join(cfg, name));
    }
    const settingsPath = join(cfg, 'settings.md');
    let text = readFileSync(settingsPath, 'utf8');
    const patchRow = (key, value) => {
      const lines = text.split('\n');
      const at = lines.findIndex((line) => line.startsWith('| ' + key + ' |'));
      assert.ok(at >= 0, 'the shipped settings carry no usable ' + key + ' row to raise or lower');
      const cells = lines[at].split('|');
      cells[2] = ' ' + value + ' ';
      lines[at] = cells.join('|');
      text = lines.join('\n');
    };
    patchRow('notice_max_chars', cap);
    patchRow('error_snippet_max_chars', snippet);
    assert.match(text, new RegExp('\\| notice_max_chars \\| ' + cap + ' \\|'),
      'the notice cap row was not lowered to the pair under test');
    assert.match(text, new RegExp('\\| error_snippet_max_chars \\| ' + snippet + ' \\|'),
      'the snippet bound row was not lowered to the pair under test');
    writeFileSync(settingsPath, text);
    writeFileSync(join(cfg, 'watchlist.md'), [
      '| kind | target | domain | note |',
      '|---|---|---|---|',
      '| rss | ' + seamedTarget(56) + ' | ai-llm | answered by the tool PATH supplies |',
      '',
    ].join('\n'));

    const res = spawnSync(process.execPath, [
      CLI, '--config', cfg, '--out', join(dir, '.pool.json'), '--timeout', '10000', '--domain', 'ai-llm',
    ], { encoding: 'utf8', env: { ...process.env, PATH: bin, TECH_RADAR_DIR: '' } });
    assert.equal(res.error, undefined, 'the collector could not be spawned: ' + res.error);
    const pool = JSON.parse(res.stdout);
    assert.equal(pool.notices.length, 1,
      'the timed-out row produced ' + pool.notices.length + ' notices: ' + JSON.stringify(pool.notices));
    const notice = pool.notices[0];
    assert.ok(notice.length <= cap,
      'the published notice is ' + notice.length + ' characters at notice_max_chars ' + cap + ': '
      + JSON.stringify(notice));
    assert.ok(notice.includes(TIMED_OUT_CAUSE),
      'the published notice lost the cause of a real timed-out request at the lowest accepted pair ('
      + cap + '/' + snippet + '): ' + JSON.stringify(notice));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The rewriting every notice crosses at the push, rebuilt from the rules the shipped module
// draws it from. It is used below only to describe what is measurable when the shipped
// composite itself is not reachable, so the property still reports a measured instability.
async function rebuiltNoticeNormalisation() {
  const net = await import('../scripts/lib/net.mjs');
  const controls = /[\u0000-\u001f\u007f-\u009f]/g;
  return (text) => net.neutraliseLinkSeams(net.neutraliseMarkers(net.neutraliseTagSpans(net.neutraliseEntityTags(
    String(text).replace(controls, (ch) => (/\s/.test(ch) ? ' ' : '')),
  ))));
}

const HOSTILE = [
  '](x',
  'a](b](c](d',
  '<c**>',
  'p<c**>',
  't<p**" vpl>',
  '<script',
  'plain text',
  '&lt;a href=x&gt;',
  '&lt;script&gt;',
  '[src:outlet 2026-06-01](https://a.example/x)',
  'text ]( more **bold** #new <b>tag</b>',
  ']](([[src:',
  '\u0000\u0007\u001b\u007f\u009f',
  'HTTP 502 for https://a.co/](x',
  'request failed for https://a.co/](x: timed out (curl exit 28)',
  '](x'.repeat(80),
];

// A deterministic spread over the hostile alphabet: the fixed strings above, plus every string
// a seeded walk builds, so a rule that is stable on the list alone is still measured.
function hostileStrings() {
  const alphabet = [']', '(', '[', 's', 'r', 'c', ':', 'a', 'l', 't', 'p', 'v', '&', ';', '<', '>',
    '#', 'n', 'e', 'w', '*', ' ', '/', '\u0000', '\u007f', '=', '"', ')'];
  let seed = 0x51ed270b;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  const out = [...HOSTILE];
  for (let i = 0; i < 400; i += 1) {
    let s = '';
    const n = 1 + (next() % 12);
    for (let j = 0; j < n; j += 1) s += alphabet[next() % alphabet.length];
    out.push(s);
  }
  return out;
}

test('TR-165 the notice rewriting applied twice is a fixed point on hostile strings', async () => {
  const mod = await import('../scripts/collect.mjs');
  const normalise = mod.neutraliseNoticeText;
  if (typeof normalise !== 'function') {
    const rebuilt = await rebuiltNoticeNormalisation();
    const unstable = hostileStrings().filter((s) => { const once = rebuilt(s); return rebuilt(once) !== once; });
    assert.fail('the notice rewriting the push performs is not reachable from scripts/collect.mjs, so its '
      + 'fixed-point property cannot be measured against the shipped code: export it as neutraliseNoticeText '
      + '(or an equivalent seam). The same rules rebuilt from the shipped net.mjs exports are already '
      + 'unstable on ' + unstable.length + ' of ' + hostileStrings().length + ' hostile strings, e.g. '
      + JSON.stringify(unstable[0]));
  }

  const unstable = [];
  for (const s of hostileStrings()) {
    const once = normalise(s);
    const twice = normalise(once);
    if (once !== twice) {
      unstable.push(JSON.stringify(s) + ' -> ' + JSON.stringify(once) + ' -> ' + JSON.stringify(twice));
    }
  }
  assert.deepEqual(unstable, [],
    'the notice rewriting is not a fixed point on ' + unstable.length + ' string(s), so the room a notice '
    + 'reserves is not the room that survives a second pass: ' + unstable.slice(0, 5).join(' | '));
});

// ---------------------------------------------------------------------------------------
// TR-166 -- what one organisation listing is asked for and what it answers. The stub reads the
// page size out of the collector's own request, so the cases answer the request that was made
// rather than a size the case assumes.
// ---------------------------------------------------------------------------------------

const rateLimit = (remaining = 5000, limit = 5000) => JSON.stringify({
  resources: { core: { limit, remaining, reset: 1790177128, used: limit - remaining } },
});

function entries(count) {
  return Array.from({ length: count }, (_, i) => ({
    full_name: 'acme/repo-' + i,
    updated_at: new Date(Date.UTC(2026, 8, 20, 0, 0, count - i)).toISOString(),
  }));
}

// The answer for one organisation listing: the page size the run asked for, answered with
// 'answered' entries -- never more than the page, which is what a conformant answer does.
function listingTransport(answeredFor) {
  const calls = [];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit();
      if (url.includes('/orgs/') && url.includes('/repos')) {
        const asked = Number(new URL(url).searchParams.get('per_page'));
        return JSON.stringify(entries(answeredFor(asked)));
      }
      if (url.includes('/releases') || url.includes('/tags')) return '[]';
      throw new Error('unexpected request: ' + url);
    },
  };
  return { net, calls };
}

async function orgPool(answeredFor, bound) {
  const stub = listingTransport(answeredFor);
  const pool = await collectAll(
    {
      settings: { ...RUN_SETTINGS, github_org_repos: bound },
      watchlist: [{ kind: 'github-org', target: 'acme', domain: 'ai-llm', note: '' }],
    },
    { ...WINDOW, net: stub.net },
  );
  return { pool, calls: stub.calls };
}

// A notice that says the listing may be partial: the page asked for was filled, so the listing
// may hold more than the run read. The exact wording is the fix's to choose, so the shapes
// accepted here are the ones that state that fact.
const PARTIAL = /partial|first\s+page|past\s+the\s+[a-z-]*\s*page|only\s+the\s+[a-z-]*\s*page|page\s+[a-z]*(?:\s+(?:was|were|is|are))?\s+not\s+requested|may\s+(?:hold|be|have|contain)|more\s+(?:repositories|entries|pages)|incomplete|paginat/i;
// The page report names the page it filled, either with the count it was asked for or as the
// first page. A notice that only says something was lost does not tell the operator where the
// listing stopped.
function namesThePage(notice, bound) {
  return new RegExp('\\b' + bound + '\\b').test(notice)
    || /first\s+page|requested\s+page|page\s+requested|one\s+page/i.test(notice);
}
// A notice that reports repositories the run read and then threw away -- "capped at 10
// repositories; 6 more repositories were not requested". That is the drop a conformant answer
// cannot produce, because the answer never sends more than the page the run asked for. It is
// distinct from the page report, which says the entries past the requested page were never
// fetched at all: only the impossible drop names entries it read and discarded.
const DROP = /\bcapped\s+at\b|\bdropped\b|\bdropping\b|\bdrop\s+\d|\b\d+\s+more\b[^;|]{0,40}?\bnot\s+requested\b/i;

test('TR-166 a listing that fills the requested page reports that only that page was read', async () => {
  const bound = 10;
  const { pool, calls } = await orgPool((asked) => asked, bound);

  const asked = calls.filter((url) => url.includes('/orgs/acme/repos'));
  assert.equal(asked.length, 1, 'the organisation row reads one listing: ' + calls.join(' '));
  assert.match(asked[0], /[?&]per_page=10\b/,
    'the listing was not asked for the configured page size: ' + asked[0]);
  assert.equal(pool.notices.length, 1,
    'a listing that filled the page the run asked for produced ' + pool.notices.length + ' notice(s): '
    + JSON.stringify(pool.notices));
  assert.match(pool.notices[0], PARTIAL,
    'the notice of a listing that filled the requested page does not say the listing may be partial '
    + '(only the page requested was read): ' + JSON.stringify(pool.notices[0]));
  assert.ok(namesThePage(pool.notices[0], bound),
    'the notice does not name the page the listing filled, so the operator cannot tell where it '
    + 'stopped: ' + JSON.stringify(pool.notices[0]));
  assert.doesNotMatch(pool.notices[0], DROP,
    'the notice reports a drop a conformant answer cannot produce: ' + JSON.stringify(pool.notices[0]));
});

test('TR-166 a listing shorter than the requested page reports nothing', async () => {
  const bound = 10;
  for (const shorter of [0, 1, bound - 1]) {
    const { pool } = await orgPool(() => shorter, bound);
    assert.deepEqual(pool.notices, [],
      'a listing of ' + shorter + ' entries did not fill the requested page of ' + bound
      + ', yet the run reported: ' + JSON.stringify(pool.notices));
  }
});

test('TR-166 no answer inside the requested page reports a drop', async () => {
  const bound = 10;
  const offenders = [];
  for (let answered = 0; answered <= bound; answered += 1) {
    const { pool } = await orgPool(() => answered, bound);
    for (const notice of pool.notices) {
      if (DROP.test(notice)) offenders.push('an answer of ' + answered + ': ' + JSON.stringify(notice));
    }
  }
  assert.deepEqual(offenders, [],
    'a conformant answer -- never more than the requested page -- was reported as a drop the run cannot '
    + 'observe: ' + offenders.join(' | '));
});
