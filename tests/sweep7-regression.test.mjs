// tests/sweep7-regression.test.mjs
// Independent regression tests for TR-141 to TR-146: the six degradations the final sweep
// recorded against 6a956d1. The principle the first one settles is that an upstream answer
// must never decide what the run's own output says -- a value an answer supplied may not
// enter a redaction set and may not be interpolated into anything the run publishes. Every
// case drives a public seam (collectAll, shapeHttpError, shapeTransportError, the shipped CLI
// and the shipped configuration) rather than a private helper, so a fix that only moves the
// symptom cannot satisfy it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, main, operatorWarning } from '../scripts/collect.mjs';
import { shapeHttpError, shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { render } from '../scripts/render-html.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const SHIPPED_SETTINGS = readSettings(join(CONFIG_DIR, 'settings.md'));
const RUN_SETTINGS = { ...SHIPPED_SETTINGS, github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const PROBE = 'https://api.github.com/rate_limit';
const RESET = 1790177128;

const rateLimit = (remaining, limit = 60, reset = RESET) => JSON.stringify({
  resources: { core: { limit, remaining, reset, used: limit - remaining } },
});

// The failure shape execFileSync raises when curl exits nonzero, handed to the shipped shaper:
// only the child process is stubbed.
function transportFailure(exit, line) {
  return {
    status: exit, signal: null, stdout: Buffer.from('\n000'),
    stderr: Buffer.from(line + '\n'), message: 'Command failed: curl\n' + line,
  };
}

// A temporary configuration whose watchlist is exactly `rows` and whose settings are the
// shipped ones with `mutateSettings` applied. Nothing is written into the working tree.
function tempConfig(rows, mutateSettings = (text) => text) {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-sweep7-'));
  const cfg = join(dir, 'config');
  mkdirSync(cfg, { recursive: true });
  for (const name of ['domains.md', 'settings.md', 'sources.md']) {
    copyFileSync(join(CONFIG_DIR, name), join(cfg, name));
  }
  writeFileSync(join(cfg, 'settings.md'), mutateSettings(readFileSync(join(CONFIG_DIR, 'settings.md'), 'utf8')));
  writeFileSync(join(cfg, 'watchlist.md'), [
    '| kind | target | domain | note |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n'));
  return { dir, cfg, out: join(dir, '.pool.json') };
}

// The shipped settings file with one row's value replaced, so a case reads as the operator's
// one-line edit and not as an object no script ever parses.
function replaceRow(key, value) {
  const prefix = '| ' + key + ' |';
  return (text) => text.split('\n').map((line) => (line.startsWith(prefix)
    ? '| ' + key + ' | ' + value + ' | replaced under test |'
    : line)).join('\n');
}

// The shipped CLI, driven with a temporary configuration. stdout and stderr are captured so a
// case can read what a real operator would see.
async function runCli(rows, { mutateSettings, args = [] } = {}) {
  const { dir, cfg, out } = tempConfig(rows, mutateSettings);
  const logged = console.log;
  const failed = console.error;
  const savedExit = process.exitCode;
  const stdout = [];
  const stderr = [];
  console.log = (...a) => stdout.push(a.join(' '));
  console.error = (...a) => stderr.push(a.join(' '));
  let code;
  try {
    code = await main(['--config', cfg, '--out', out, '--timeout', '2000', ...args]);
  } finally {
    console.log = logged;
    console.error = failed;
    process.exitCode = savedExit;
    rmSync(dir, { recursive: true, force: true });
  }
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

// The Coverage note is Markdown and the reader renders it, so the cases render it too.
function coverageNote(pool) {
  return ['# Tech Radar - 2026-09-23', '', '## Coverage note',
    '- Collector notices: ' + pool.notices.length,
    ...pool.notices.map((n) => '- ' + n)].join('\n');
}

// A position is named by a listing word near the number, in either order, so a case pins the
// requirement and not one phrasing of it.
const POSITION_BEFORE = /(?:repositor(?:y|ies)|repo|entry|ordinal|listing|item)\b[^0-9\n]{0,24}\b\d\b/i;
const POSITION_AFTER = /\b\d\b[^0-9\n]{0,24}(?:repositor(?:y|ies)|repo|entry|listing|item)\b/i;

const CAP_ROW = 'notice_max_chars';
const SNIPPET_ROW = 'error_snippet_max_chars';

// ---------------------------------------------------------------------------------------
// TR-141 -- the repository name an organisation listing supplies is answer text. It was
// interpolated into the request URL unencoded and registered in the run-wide redaction sets,
// so the answer nominated a string the run then deleted from every notice and from published
// candidate prose. The name is now accepted only when it has the shape of a repository name;
// a non-conforming entry is skipped with a notice naming the organisation row and the entry's
// position and nothing the answer supplied, and neither the name nor its URL reaches a set.
// ---------------------------------------------------------------------------------------

const ORG_ROW = 'kubernetes';
const ORDINAL = 2;
// The hostile name nominates the ordinary phrase 'failed to connect': its credential-shaped
// query parameter carries it, so a run that trusted the name would delete that phrase from
// every notice and from every candidate field.
const HOSTILE_NAME = 'a?token=failed+to+connect&x=';
const PHRASE = 'failed to connect';
const FEED_OK = 'https://feeds.invalid/healthy.xml';
const FEED_FAIL = 'http://127.0.0.1:1/broken.xml';
const FEED_ITEM = 'the run failed to connect twice';

const ORG_LISTING = JSON.stringify([
  { full_name: 'kubernetes/kubernetes' },
  { full_name: HOSTILE_NAME },
]);
const K8S_RELEASES = JSON.stringify([{
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/kubernetes/kubernetes/releases/tag/v1.0.0',
  published_at: '2026-09-21T10:00:00Z',
  draft: false,
  body: 'notes',
}]);
const RSS_OK = '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>'
  + '<item><title>a story</title><link>https://example.invalid/story</link>'
  + '<pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>'
  + '<description>' + FEED_ITEM + '</description></item></channel></rss>';

test('TR-141 a hostile repository name the listing supplied cannot rewrite a notice or a candidate field', async () => {
  const calls = [];
  const net = {
    fetchText: async (url, timeout, headers, ua, snippetLimit) => {
      calls.push(url);
      if (url === PROBE) return rateLimit(55);
      if (url.includes('/orgs/' + ORG_ROW + '/repos')) return ORG_LISTING;
      if (url.includes('/tags')) return '[]';
      if (url.includes('kubernetes/kubernetes/releases')) return K8S_RELEASES;
      if (url === FEED_OK) return RSS_OK;
      if (url === FEED_FAIL) {
        throw shapeTransportError(transportFailure(7, 'curl: (7) Failed to connect'), url, snippetLimit, headers ?? {});
      }
      throw new Error('unexpected request: ' + url);
    },
  };
  const pool = await collectAll({
    settings: RUN_SETTINGS,
    watchlist: [
      { kind: 'github-org', target: ORG_ROW, domain: 'infra-cloud', note: '' },
      { kind: 'rss', target: FEED_OK, domain: 'ai-llm', note: '' },
      { kind: 'rss', target: FEED_FAIL, domain: 'ai-llm', note: '' },
    ],
  }, { ...WINDOW, net });

  // Direction one: the phrase the answer nominated survives in the run's own output. The
  // listing still contributes a candidate, so the reading is of a pool that carried something.
  assert.ok(pool.candidates.length >= 2,
    'the pool carries no candidate at all: ' + JSON.stringify(pool.notices));
  const feed = pool.candidates.find((c) => String(c.summary).includes(PHRASE));
  assert.ok(feed, 'the candidate prose carrying the phrase is missing: '
    + JSON.stringify(pool.candidates.map((c) => c.summary)));
  assert.equal(feed.summary, FEED_ITEM,
    'the answer rewrote published candidate prose: ' + feed.summary);
  const transport = pool.notices.find((n) => /request failed/.test(n));
  assert.ok(transport, 'the refused feed is not reported: ' + JSON.stringify(pool.notices));
  assert.ok(transport.includes(PHRASE), 'the answer deleted a word from a notice: ' + transport);
  for (const n of pool.notices) {
    assert.equal(n.includes('[redacted]'), false, 'a notice lost a word: ' + n);
  }
  for (const c of pool.candidates) {
    assert.equal(JSON.stringify(c).includes('[redacted]'), false,
      'a candidate field lost a word: ' + JSON.stringify(c));
  }

  // Direction two: the non-conforming entry is still reported, naming the organisation row and
  // the entry's position in the listing, and nothing the answer supplied.
  const skip = pool.notices.filter((n) => /skip/i.test(n));
  assert.equal(skip.length, 1,
    'the non-conforming entry is not reported exactly once: ' + JSON.stringify(pool.notices));
  const notice = skip[0];
  assert.ok(new RegExp('\\b' + ORG_ROW + '\\b').test(notice),
    'the notice does not name the organisation row: ' + notice);
  assert.ok(POSITION_BEFORE.test(notice) || POSITION_AFTER.test(notice),
    "the notice does not name the entry's position: " + notice);
  assert.ok(new RegExp('\\b' + ORDINAL + '\\b').test(notice),
    'the notice does not name position ' + ORDINAL + ': ' + notice);
  assert.equal(notice.includes(HOSTILE_NAME), false,
    'the notice quotes the answer-supplied name: ' + notice);
  assert.equal(/token|failed/.test(notice), false,
    'the notice carries a word the answer supplied: ' + notice);
  assert.equal(JSON.stringify(pool).includes('a?token'), false,
    'the hostile name reached the pool: ' + JSON.stringify(pool));

  // Nothing was ever requested from the answer-supplied name: the entry is refused before it
  // becomes a target, so its URL cannot reach any run-wide redaction union either.
  assert.equal(calls.some((u) => u.includes('a?token') || u.includes('failed+to+connect')), false,
    'a request was made from the answer-supplied name: ' + calls.join('\n'));
  assert.equal(calls.some((u) => u.includes('/repos/kubernetes/kubernetes/releases')), true,
    'the conforming entry was not requested either: ' + calls.join('\n'));

  // The rendered Coverage note keeps the phrase too.
  const coverage = coverageNote(pool);
  assert.ok(render(coverage, { domains: [], short_max_chars: 18 }).includes(PHRASE),
    'the rendered coverage note lost the phrase: ' + coverage);
});

test('TR-141 a listing entry whose name is not a repository name is skipped, never coerced', async () => {
  const calls = [];
  const entries = [5, ['a/b'], {}, null, 'a/b/c', 'a?x=y'];
  const net = {
    fetchText: async (url) => {
      calls.push(url);
      if (url === PROBE) return rateLimit(55);
      if (url.includes('/orgs/' + ORG_ROW + '/repos')) {
        return JSON.stringify(entries.map((full_name) => ({ full_name })));
      }
      throw new Error('unexpected request: ' + url);
    },
  };
  const pool = await collectAll({
    settings: RUN_SETTINGS,
    watchlist: [{ kind: 'github-org', target: ORG_ROW, domain: 'infra-cloud', note: '' }],
  }, { ...WINDOW, net });
  assert.equal(pool.candidates.length, 0,
    'a name that is not a repository name still produced a candidate: ' + JSON.stringify(pool.candidates));
  const skip = pool.notices.filter((n) => /skip/i.test(n));
  assert.equal(skip.length, entries.length,
    'every non-conforming entry is reported once: ' + JSON.stringify(pool.notices));
  for (let i = 1; i <= entries.length; i += 1) {
    assert.ok(skip.some((n) => new RegExp('\\b' + i + '\\b').test(n)),
      'position ' + i + ' is not named in a notice: ' + JSON.stringify(skip));
  }
  assert.equal(calls.filter((u) => u.includes('/repos/')).length, 0,
    'a request was made from a name that is not a repository name: ' + calls.join('\n'));
});

// ---------------------------------------------------------------------------------------
// TR-142 -- the accepted notice cap did not guarantee a usable notice: with the shipped
// snippet bound the cause is lost at a cap that used to be legal and survives only from a much
// larger one. The cap and the snippet bound are cross-checked now, and the settings note states
// the relationship between the two.
// ---------------------------------------------------------------------------------------

test('TR-142 a notice cap too small for the shipped snippet bound is a named configuration error', async () => {
  for (const cap of [200, 300, 402]) {
    const r = await runCli(['| rss | file:///etc/passwd | ai-llm | a refused row |'], {
      mutateSettings: replaceRow(CAP_ROW, cap),
      args: ['--since', '2026-09-16T00:00:00Z'],
    });
    assert.equal(r.code, 2,
      'a cap of ' + cap + ' must be refused (exit 2), not obeyed (exit ' + r.code + '): ' + r.stderr);
    assert.match(r.stderr, /notice_max_chars/, 'the refusal does not name the cap: ' + r.stderr);
    assert.match(r.stderr, /error_snippet_max_chars/,
      'the refusal does not name the snippet bound: ' + r.stderr);
  }
});

test('TR-142 the cap that carries the shipped snippet bound is accepted at the exact boundary', async () => {
  const refused = await runCli(['| rss | file:///etc/passwd | ai-llm | a refused row |'], {
    mutateSettings: replaceRow(CAP_ROW, 402),
    args: ['--since', '2026-09-16T00:00:00Z'],
  });
  assert.equal(refused.code, 2, '402 is refused: ' + refused.stderr);
  const accepted = await runCli(['| rss | file:///etc/passwd | ai-llm | a refused row |'], {
    mutateSettings: replaceRow(CAP_ROW, 403),
    args: ['--since', '2026-09-16T00:00:00Z'],
  });
  assert.notEqual(accepted.code, 2,
    'the cap that does carry the status and the cause is refused: ' + accepted.stderr);
});

test('TR-142 the minimum accepted cap keeps the status and the cause the snippet bound shaped', async () => {
  const cap = 403;
  const longTarget = 'http://127.0.0.1:1/' + 'y'.repeat(400);
  const npmTarget = 'z'.repeat(400);
  const net = {
    fetchText: async (url, timeout, headers, ua, snippetLimit) => {
      if (url.startsWith('http://127.0.0.1:1/')) {
        throw shapeTransportError(transportFailure(6, 'curl: (6) Could not resolve host'), url, snippetLimit, headers ?? {});
      }
      throw shapeHttpError(503, Buffer.from('{"message":"upstream"}'), url, snippetLimit);
    },
  };
  const pool = await collectAll({
    settings: { ...RUN_SETTINGS, notice_max_chars: cap },
    watchlist: [
      { kind: 'rss', target: longTarget, domain: 'ai-llm', note: '' },
      { kind: 'npm', target: npmTarget, domain: 'languages-runtimes', note: '' },
    ],
  }, { ...WINDOW, net });
  assert.equal(pool.notices.length, 2, 'both refused requests are reported: ' + JSON.stringify(pool.notices));
  for (const notice of pool.notices) {
    assert.ok(notice.length <= cap, 'the configured cap does not bound the notice: ' + notice);
  }
  const transport = pool.notices.find((n) => /request failed/.test(n));
  assert.ok(transport, 'the transport notice is missing: ' + JSON.stringify(pool.notices));
  assert.match(transport, /could not resolve the host \(curl exit 6\)/,
    'the cause is lost at the minimum accepted cap: ' + transport);
  const http = pool.notices.find((n) => /HTTP 503/.test(n));
  assert.ok(http, 'the HTTP notice is missing: ' + JSON.stringify(pool.notices));
  assert.match(http, /registry\.npmjs\.org/,
    'the status and the request are lost at the minimum accepted cap: ' + http);
});

test('TR-142 the settings note states the relationship between the cap and the snippet bound', () => {
  const row = readFileSync(join(CONFIG_DIR, 'settings.md'), 'utf8')
    .split('\n').find((line) => line.startsWith('| ' + CAP_ROW + ' |'));
  assert.ok(row, 'the notice-cap row is present');
  const note = row.split('|').slice(3).join('|');
  assert.match(note, new RegExp(SNIPPET_ROW),
    'the note does not name the snippet bound it has to carry: ' + note);
});

// ---------------------------------------------------------------------------------------
// TR-143 -- an absurd window cap is a configuration error that must name the setting instead
// of surfacing the runtime's own message ('Invalid time value') from the date conversion.
// ---------------------------------------------------------------------------------------

const WEEKS_ROW = 'window_cap_weeks';

test('TR-143 an absurd window cap is refused with the setting named', async () => {
  for (const weeks of ['999999999', '1e15', '1e308', '999999999999999999999']) {
    const r = await runCli(['| rss | file:///etc/passwd | ai-llm | a refused row |'], {
      mutateSettings: replaceRow(WEEKS_ROW, weeks),
    });
    assert.equal(r.code, 2,
      'a window cap of ' + weeks + ' must be refused (exit 2), not reach the clock: ' + r.stderr);
    assert.match(r.stderr, /window_cap_weeks/,
      'the refusal does not name the setting: ' + r.stderr);
    assert.doesNotMatch(r.stderr, /Invalid time value/,
      'the refusal is the runtime message rather than a named configuration error: ' + r.stderr);
  }
});

// ---------------------------------------------------------------------------------------
// TR-144 -- a watchlist kind outside the documented vocabulary was silently ignored: no
// candidate, no notice, no warning. The module's own rule is that a failing source becomes a
// notice, never a silent skip, so an unknown kind is reported and named.
// ---------------------------------------------------------------------------------------

test('TR-144 an unknown watchlist kind becomes a notice, never a silent skip', async () => {
  const pool = await collectAll({
    settings: RUN_SETTINGS,
    watchlist: [
      { kind: 'rs', target: 'https://example.invalid/feed.xml', domain: 'ai-llm', note: '' },
      { kind: 'RSS', target: 'https://example.invalid/other.xml', domain: 'ai-llm', note: '' },
    ],
  }, {
    ...WINDOW,
    net: { fetchText: async () => { throw new Error('no request may be made for an unknown kind'); } },
  });
  assert.deepEqual(pool.candidates, []);
  for (const kind of ['rs', 'RSS']) {
    assert.ok(pool.notices.some((n) => n.includes(kind)),
      'the unknown kind ' + JSON.stringify(kind) + ' is named in no notice: ' + JSON.stringify(pool.notices));
  }
});

test('TR-144 a known kind is never reported as unknown', async () => {
  const pool = await collectAll({
    settings: RUN_SETTINGS,
    watchlist: [{ kind: 'rss', target: 'file:///etc/passwd', domain: 'ai-llm', note: '' }],
  }, { ...WINDOW, net: { fetchText: async () => { throw new Error('the refused target is never fetched'); } } });
  assert.equal(pool.notices.length, 1, 'the row produces exactly its own notice: ' + JSON.stringify(pool.notices));
  assert.match(pool.notices[0], /unsupported scheme/);
  assert.doesNotMatch(pool.notices[0], /unknown/i, 'a known kind is reported as unknown: ' + pool.notices[0]);
});

test('TR-144 the CLI reports an unknown kind as a degraded run, not a quiet week', async () => {
  const r = await runCli(['| rs | https://example.invalid/feed.xml | ai-llm | an unknown kind |']);
  assert.equal(r.code, 3,
    'an unknown kind with no candidates is the documented degraded exit, not a quiet week: ' + r.stderr);
  assert.match(r.stderr, /notice/, 'the degradation reaches no operator surface: ' + r.stderr);
});

// ---------------------------------------------------------------------------------------
// TR-145 -- the snippet-bound note described a result the shaper does not produce: it promised
// the status alone, while a value below the prefix leaves the whole prefix with its dangling
// separator and no request.
// ---------------------------------------------------------------------------------------

test('TR-145 the snippet-bound note describes what a very small value leaves in an HTTP notice', () => {
  const row = readFileSync(join(CONFIG_DIR, 'settings.md'), 'utf8')
    .split('\n').find((line) => line.startsWith('| ' + SNIPPET_ROW + ' |'));
  assert.ok(row, 'the setting row is present');
  const note = row.split('|').slice(3).join('|');
  assert.doesNotMatch(note, /status alone/i,
    'the note still describes the shaped text as the status alone: ' + note);
  const shaped = shapeHttpError(503, Buffer.from('body'), 'https://example.invalid/x', 1);
  assert.equal(shaped.message, 'HTTP 503 for ',
    'the shaper no longer leaves the prefix at this bound: ' + JSON.stringify(shaped.message));
  assert.match(note, /HTTP <status> for /,
    'the note does not name the prefix the shaped text keeps: ' + note);
  assert.match(note, /prefix/i, 'the note does not describe the prefix: ' + note);
  assert.match(note, /no request/i,
    'the note does not say the shaped text names no request there: ' + note);
  assert.match(note, /never[^|]*quote/i,
    'the note still states the upstream body is never quoted: ' + note);
});

// ---------------------------------------------------------------------------------------
// LV-2 (the addition the verification pass sent) -- the operator line is supposed to repeat the
// transport reason, but the six causes read from curl's exit code are published as
// '<phrase> (curl exit N)'. The tail pattern matched only the bare phrase, so the reason was
// dropped for every mapped cause while the three fallbacks kept theirs.
// ---------------------------------------------------------------------------------------

test('LV-2 the operator line repeats the reason for a mapped transport cause and for a fallback', () => {
  const ownTarget = 'http://127.0.0.1:4471/feed.xml';
  const mapped = [[6, 'could not resolve the host'], [7, 'failed to connect'], [18, 'partial transfer'],
    [28, 'timed out'], [35, 'TLS handshake failed'], [52, 'empty reply']];
  for (const [exit, phrase] of mapped) {
    const shaped = shapeTransportError(
      transportFailure(exit, 'curl: (' + exit + ') ' + phrase), ownTarget, 200, {},
    );
    const line = operatorWarning(['rss ' + ownTarget + ': ' + shaped.message]);
    assert.ok(line.includes(phrase + ' (curl exit ' + exit + ')'),
      'the operator line drops the reason for a mapped cause (exit ' + exit + '): ' + line);
  }
  for (const [failure, expected] of [
    [transportFailure(60, 'curl: (60) SSL certificate problem'), 'curl exited with status 60'],
    [{ code: 'ENOENT', message: 'spawn curl ENOENT' }, 'curl could not be started (ENOENT)'],
  ]) {
    const shaped = shapeTransportError(failure, ownTarget, 200, {});
    const line = operatorWarning(['rss ' + ownTarget + ': ' + shaped.message]);
    assert.ok(line.includes(expected), 'the operator line drops the fallback reason: ' + line);
  }
  // A notice that carries no transport cause keeps the plain count, which is what the comment
  // beside the pattern says: the line repeats a reason when there is one.
  const plain = operatorWarning(['github: rate limit reached (remaining 0 of 60)']);
  assert.ok(plain.endsWith('Collector notices: 1'),
    'a notice with no transport cause is given a reason it does not carry: ' + plain);
});

// ---------------------------------------------------------------------------------------
// TR-146 -- on a pool write failure the notices reached no surface at all, so the degradation
// the run recorded was lost. The notices are printed before the failure is reported.
// ---------------------------------------------------------------------------------------

test('TR-146 a pool write failure still prints the notices the run recorded', async () => {
  const { dir, cfg } = tempConfig(['| rss | file:///etc/passwd | ai-llm | a refused row |']);
  // A destination that cannot exist: its parent is a regular file, so even the directory
  // creation the atomic write needs fails.
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'not a directory\n');
  const badOut = join(blocker, '.pool.json');
  const logged = console.log;
  const failed = console.error;
  const savedExit = process.exitCode;
  const stdout = [];
  const stderr = [];
  console.log = (...a) => stdout.push(a.join(' '));
  console.error = (...a) => stderr.push(a.join(' '));
  let code;
  try {
    code = await main(['--config', cfg, '--out', badOut, '--timeout', '2000',
      '--since', '2026-09-16T00:00:00Z']);
  } finally {
    console.log = logged;
    console.error = failed;
    process.exitCode = savedExit;
    rmSync(dir, { recursive: true, force: true });
  }
  const err = stderr.join('\n');
  assert.equal(code, 4, 'a pool write failure is the documented exit 4: ' + err);
  assert.match(err, /cannot write/, 'the write failure is not reported: ' + err);
  assert.match(err, /unsupported scheme/,
    'the notice the run recorded reached no surface: ' + err);
  assert.ok(err.indexOf('unsupported scheme') < err.indexOf('cannot write'),
    'the notices are not printed before the failure is reported: ' + err);
});
