// tests/rd24-cv1-f1f2-regression.test.mjs
// Regression tests for the two findings the closing adversarial sweep over bced468 filed (probes
// exp4/exp5/exp8 for F1 and exp18/exp21/exp22 for F2).
//
// F1 (Med) -- a detail redacted AFTER it was priced. shapeHttpError bounds the shaped error to
// error_snippet_max_chars against the REQUEST's own secrets; assembleNotice then redacts that
// detail again against the run-wide union, which a value another row's request carries can
// enlarge. At the least accepted pair (402/200) the grown tail leaves `cap - 2 - tail.length`
// negative and the slice takes the whole cap out of the head, so the published notice loses
// 'HTTP 403 for '. Reachable three ways: the shipped curl transport (a 4xx answer), a custom
// transport passed to the public collectAll seam, and a direct caller of the shaper. The cases
// below drive the public seam and the shipped CLI.
//
// F2 (Low) -- redactSecrets is not idempotent. A collected value that is a substring of the
// marker ('redacted', 'redacted]', 'edacted]', '[redacte') makes a later pass rewrite the marker
// the previous pass wrote, so the published notice grows '[[[[[[redacted]]]]]]'. The cases below
// pin the fixed point, the non-lengthening property, and the floor behaviour that keeps a
// legitimate word readable (the TR-110 lesson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectAll, operatorWarning } from '../scripts/collect.mjs';
import {
  redactSecrets, requestSecrets, shapeHttpError, shapeTransportError,
} from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const SKILL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const CLI = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
const SHIPPED = readSettings(join(CONFIG_DIR, 'settings.md'));
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const pad = (n, ch) => ch.repeat(n);

const SETTINGS = { ...SHIPPED, github_rate_limit_reserve: 2 };
const settingsAt = (cap, snippet) => ({ ...SETTINGS, notice_max_chars: cap, error_snippet_max_chars: snippet });
const rssRows = (targets, domain = 'ai-llm') => targets.map((target) => ({ kind: 'rss', target, domain, note: '' }));

// The sweeps own fixture: row A repeats a three-character value in its path and carries no
// credential of its own, row B names the same value as a credential-named query value, so the
// run-wide union holds it and row A's own request never does. A removal of a three-character value
// adds seven characters per occurrence.
const F1_A = 'https://a.example/' + 'abc/'.repeat(400);
const F1_B = 'https://b.example/' + pad(20, 'q') + '?code=abc';

// A transport that throws the shaper's own HTTP shape, priced (as the shipped transport prices it)
// against the request's own secrets only -- so the run-wide union is exactly what the sweep says
// it is for this notice.
function shapedHttpTransport(status = 403) {
  return {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      throw shapeHttpError(status, '<html><body>forbidden</body></html>', url, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
}

// ---------------------------------------------------------------------------------------
// F1 -- the status survives every accepted (cap, snippet) pair, whatever the union holds.
// ---------------------------------------------------------------------------------------

test('F1 the least accepted pair 402/200 publishes the HTTP status through the public seam', async () => {
  const cap = 402;
  const pool = await collectAll(
    { settings: settingsAt(cap, 200), watchlist: rssRows([F1_A, F1_B]) },
    { ...WINDOW, net: shapedHttpTransport(403) },
  );
  assert.equal(pool.notices.length, 2,
    'the two failing rows produced ' + pool.notices.length + ' notices: ' + JSON.stringify(pool.notices));
  const over = pool.notices.filter((n) => n.length > cap);
  assert.deepEqual(over, [], 'a notice is longer than its cap: ' + JSON.stringify(over.map((n) => n.length)));
  for (const [i, notice] of pool.notices.entries()) {
    assert.ok(notice.includes('HTTP 403 for '),
      'notice ' + i + ' lost its HTTP status at the least accepted pair (cap ' + cap + ', snippet 200): '
      + notice.length + ' characters, ' + JSON.stringify(notice.slice(-60)));
  }
});

test('F1 every accepted pair including the 128 floor keeps the status and the cap', async () => {
  const pairs = [[402, 200], [128, 63], [1000, 200], [128, 1], [SHIPPED.notice_max_chars, SHIPPED.error_snippet_max_chars]];
  for (const [cap, snippet] of pairs) {
    const pool = await collectAll(
      { settings: settingsAt(cap, snippet), watchlist: rssRows([F1_A, F1_B]) },
      { ...WINDOW, net: shapedHttpTransport(403) },
    );
    assert.ok(pool.notices.length >= 1, cap + '/' + snippet + ' produced no notice');
    for (const notice of pool.notices) {
      assert.ok(notice.length <= cap,
        'at ' + cap + '/' + snippet + ' a notice is ' + notice.length + ' characters: ' + JSON.stringify(notice.slice(-60)));
      assert.ok(notice.includes('HTTP 403'),
        'at ' + cap + '/' + snippet + ' a notice lost its status: ' + JSON.stringify(notice));
    }
  }
});

test('F1 a transport cause survives the same union growth at 402/200', async () => {
  const failure = {
    status: 6, signal: null, stdout: Buffer.from('\n000'),
    stderr: Buffer.from('curl: (6) Could not resolve the host\n'),
    message: 'Command failed: curl -sSL -- ' + F1_A,
  };
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      throw shapeTransportError(failure, url, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
  const cap = 402;
  const pool = await collectAll(
    { settings: settingsAt(cap, 200), watchlist: rssRows([F1_A, F1_B]) },
    { ...WINDOW, net },
  );
  for (const notice of pool.notices) {
    assert.ok(notice.length <= cap, 'a notice is ' + notice.length + ' characters at cap ' + cap);
  }
  assert.ok(pool.notices.some((n) => n.includes('could not resolve the host (curl exit 6)')),
    'no notice carries the transport cause: ' + JSON.stringify(pool.notices));
  assert.match(operatorWarning(pool.notices), /could not resolve the host/,
    'the operator line lost the transport reason: ' + JSON.stringify(operatorWarning(pool.notices)));
});

// The shaper priced with the union it will be published under must not hand a later pass anything
// to grow: the option the collectors and the transport thread is additive and optional, and the
// shaper called with its shipped signature still behaves as it always did.
test('F1 the shaper prices against the union it is given and keeps its shipped signature', () => {
  const url = F1_A;
  const withUnion = shapeHttpError(403, 'x', url, 200, {}, false, ['abc']);
  assert.ok(withUnion.message.length <= 200,
    'the shaped text is ' + withUnion.message.length + ' characters at bound 200');
  assert.ok(withUnion.message.includes('HTTP 403 for '), 'the priced text lost the status prefix');
  assert.equal(redactSecrets(withUnion.message, ['abc']), withUnion.message,
    'a text priced against the union is still rewritten by it');
  const shipped = shapeHttpError(403, 'x', url, 200, {});
  assert.ok(shipped.message.includes('HTTP 403 for '), 'the shipped signature lost the status prefix');
  assert.ok(shipped.message.length <= 200, 'the shipped signature exceeded the bound');
});

// ---------------------------------------------------------------------------------------
// F1 -- the shipped CLI, with a real child curl that answers 403.
// ---------------------------------------------------------------------------------------

test('F1 the shipped CLI keeps the status of a real 403 at 402/200', () => {
  const cap = 402;
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-rd24-f1-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const shim = join(bin, 'curl');
    writeFileSync(shim, '#!/bin/sh\nprintf "%s\\n%s" "forbidden" "403"\n');
    chmodSync(shim, 0o755);
    const cfg = join(dir, 'config');
    mkdirSync(cfg, { recursive: true });
    for (const name of ['domains.md', 'sources.md', 'settings.md']) cpSync(join(CONFIG_DIR, name), join(cfg, name));
    const settingsPath = join(cfg, 'settings.md');
    let text = readFileSync(settingsPath, 'utf8');
    const patchRow = (key, value) => {
      const lines = text.split('\n');
      const at = lines.findIndex((line) => line.startsWith('| ' + key + ' |'));
      assert.ok(at >= 0, 'the shipped settings carry no usable ' + key + ' row');
      const cells = lines[at].split('|');
      cells[2] = ' ' + value + ' ';
      lines[at] = cells.join('|');
      text = lines.join('\n');
    };
    patchRow('notice_max_chars', cap);
    patchRow('error_snippet_max_chars', 200);
    writeFileSync(settingsPath, text);
    writeFileSync(join(cfg, 'watchlist.md'), [
      '| kind | target | domain | note |',
      '|---|---|---|---|',
      '| rss | ' + F1_A + ' | ai-llm | row A |',
      '| rss | ' + F1_B + ' | ai-llm | row B |',
      '',
    ].join('\n'));
    const res = spawnSync(process.execPath, [
      CLI, '--config', cfg, '--out', join(dir, '.pool.json'), '--timeout', '10000', '--domain', 'ai-llm',
    ], { encoding: 'utf8', env: { ...process.env, PATH: bin, TECH_RADAR_DIR: '' } });
    const pool = JSON.parse(res.stdout);
    assert.equal(pool.notices.length, 2, 'the run published ' + pool.notices.length + ' notices');
    for (const notice of pool.notices) {
      assert.ok(notice.length <= cap, 'the CLI published ' + notice.length + ' characters at cap ' + cap);
      assert.ok(notice.includes('HTTP 403'),
        'the shipped CLI lost the HTTP status at 402/200: ' + JSON.stringify(notice.slice(-60)));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F1 a credential-free run publishes byte-identical notices under the two signatures', async () => {
  const target = 'https://acme.feeds.example.com/' + pad(230, 'x') + '?per_page=50';
  assert.deepEqual(requestSecrets(target, {}), [], 'the control target is no longer credential-free');
  const cap = 402;
  const before = await collectAll(
    { settings: settingsAt(cap, 200), watchlist: rssRows([target]) },
    { ...WINDOW, net: shapedHttpTransport(403) },
  );
  const notice = before.notices[0];
  assert.ok(notice.includes('HTTP 403 for '), 'the control lost the status: ' + JSON.stringify(notice));
  assert.equal(redactSecrets(notice, []), notice, 'a credential-free notice is not a fixed point');
});

// The composition fallback: a source that ends in an unterminated opener and a detail that closes
// it with '>' make the parts disagree with the whole line's own pass (the sweep's exp14 family), so
// the fallback is what publishes the line. The fallback must still be bounded and still carry the
// status: this pairing reaches it at the least accepted pair, and the notice it publishes here is
// the shaped detail itself (99 characters against a 402 cap), never a cut.
test('F1 a line whose parts do not compose is bounded with its status kept, at 402/200', async () => {
  const cap = 402;
  const rows = [
    { kind: 'rss', target: 'https://u:x@a.example/<a href=x', domain: 'ai-llm', note: '' },
    { kind: 'rss', target: 'https://a.example/' + pad(300, 'z'), domain: 'ai-llm', note: '' },
  ];
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      throw shapeHttpError(403, '<b>' + pad(3, '>') + '</b>', url, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
  const pool = await collectAll(
    { settings: settingsAt(cap, 200), watchlist: rows },
    { ...WINDOW, net },
  );
  assert.ok(pool.notices.length >= 1, 'the fallback fixture produced no notice');
  for (const notice of pool.notices) {
    assert.ok(notice.length <= cap,
      'the published notice is ' + notice.length + ' characters at cap ' + cap + ': ' + JSON.stringify(notice));
    assert.ok(notice.includes('HTTP 403'),
      'the fallback dropped the status: ' + JSON.stringify(notice));
  }
});

// ---------------------------------------------------------------------------------------
// F2 -- one pass produces the published text, and a marker substring is not a secret.
// ---------------------------------------------------------------------------------------

const MARKER = '[redacted]';
// Every substring of the marker a later pass could re-match, as the sweep enumerated them.
const MARKER_SUBSTRINGS = [
  '[redacte', '[redacted', 'redacted', 'redacted]', 'edacted]', 'redact', 'acted', 'ted', 'ed', 'ct',
];

test('F2 a marker-substring value does not rewrite the marker a pass wrote', () => {
  for (const value of MARKER_SUBSTRINGS) {
    const once = redactSecrets('value ' + value + ' here', [value]);
    const twice = redactSecrets(once, [value]);
    assert.equal(twice, once,
      'the value ' + JSON.stringify(value) + ' rewrote the marker on a second pass: '
      + JSON.stringify(once) + ' -> ' + JSON.stringify(twice));
    assert.ok(!once.includes(MARKER + ']') && !once.includes('[' + MARKER),
      'the value ' + JSON.stringify(value) + ' produced a doubled marker: ' + JSON.stringify(once));
    assert.equal(once, 'value ' + MARKER + ' here',
      'a value below the marker\'s own length must still publish the ordinary marker: ' + JSON.stringify(once));
  }
});

test('F2 a notice that carries a marker substring as a secret is a fixed point of the whole run', async () => {
  // The adversarial target spells the value in its path, so it survives redactUrl and reaches the
  // notice; the query spelling is what makes it a collected credential value.
  const target = 'https://a.example/%5Bredacte/' + pad(60, 'z') + '?code=%5Bredacte';
  const pool = await collectAll(
    { settings: settingsAt(1000, 200), watchlist: rssRows([target]) },
    { ...WINDOW, net: shapedHttpTransport(403) },
  );
  const union = requestSecrets(target, {});
  assert.ok(union.some((v) => v.includes('redact')), 'the fixture no longer supplies a marker substring: ' + JSON.stringify(union));
  for (const notice of pool.notices) {
    assert.ok(notice.length <= 1000, 'the notice is ' + notice.length + ' characters');
    assert.equal(redactSecrets(notice, union), notice,
      'the published notice is not a fixed point of the run\'s own union: ' + JSON.stringify(notice));
    assert.ok(!notice.includes('[[[[['),
      'the published notice carries an over-expanded marker: ' + JSON.stringify(notice.slice(0, 120)));
  }
});

test('F2 redaction is idempotent and never lengthens, over a fuzz of marker-shaped secrets', () => {
  let seed = 0x2f6e2b1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const alphabet = ['a', 'b', 'x', '0', '9', '[', ']', '-', '_', '/', ':', ' ', '.', '%', '2', '5'];
  const word = (n) => Array.from({ length: n }, () => pick(alphabet)).join('');
  let checked = 0;
  for (let i = 0; i < 400; i += 1) {
    const value = pick(MARKER_SUBSTRINGS) + (rnd() < 0.5 ? '' : word(1 + Math.floor(rnd() * 8)));
    const text = word(1 + Math.floor(rnd() * 12)) + ' ' + value + ' ' + word(1 + Math.floor(rnd() * 12))
      + (rnd() < 0.5 ? ' abc12345 ' + word(6) : '');
    const secrets = [value, 'abc12345', MARKER].filter((s) => s !== '');
    const once = redactSecrets(text, secrets);
    const twice = redactSecrets(once, secrets);
    assert.equal(twice, once,
      'not a fixed point for ' + JSON.stringify({ text, secrets }) + ': '
      + JSON.stringify(once) + ' -> ' + JSON.stringify(twice));
    // Growth is linear in the input, never a doubling: one removal of a value at or above the floor
    // costs at most the marker's length minus the value's (nine, for the shortest value the floor
    // admits), and the removals cannot exceed one per input character. The doubling this pins is
    // the one F2 found -- a pass that reads the marker it just wrote multiplies the text by the
    // marker on every pass.
    assert.ok(once.length <= text.length + 9 * text.length,
      'the pass grew the text by more than a linear number of markers: '
      + JSON.stringify({ text, value, once }));
    assert.ok(!once.includes(MARKER + MARKER) && !once.includes('[' + MARKER),
      'the pass produced a re-doubled marker: ' + JSON.stringify(once));
    checked += 1;
  }
  assert.equal(checked, 400);
});

test('F2 the floor still removes a short value only where it stands as its own token', () => {
  // TR-110: a three-character configured value must not reap the words it happens to sit inside.
  const text = 'rate limit exceeded for the entries page';
  assert.equal(redactSecrets(text, ['rat']), text, 'a short value rewrote a word it is part of');
  assert.equal(redactSecrets('x rat y', ['rat']), 'x ' + MARKER + ' y',
    'a short value standing as its own token is not removed');
  assert.equal(redactSecrets('the token is tok12345.', ['tok12345']), 'the token is ' + MARKER + '.',
    'a value at or above the floor is not removed');
});
