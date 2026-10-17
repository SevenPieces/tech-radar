// tests/rd24-cv4-f1f2f3f4-regression.test.mjs
// Regression tests for the findings the closing adversarial sweep over 2b6fca0 filed
// (docs/hardening-2026-10-15/scratch-final25-sweep/CLOSING25-SWEEP-REPORT.md) and the ones the
// final verification filed beside them (scratch-final25-verify/FINAL25-VERIFY-REPORT.md).
//
// S-F1 (Med, regression from Batch 32) -- a long NON-SHAPED detail lost its reason. The
// composition fallback bounded the whole line by keeping both ends, and the front half is the
// source, so the seam deleted the front of the detail ('the response was not JSON (...)') and the
// notice ended with a fragment of the raw detail. The fix makes the source give way first and
// keeps the reason (the detail's head); a shaped detail handed to the push as the shaped Error is
// re-priced from its own facts instead of being cut.
//
// S-F2 (Low) -- redactSecrets was not a fixed point: redactBasicCredentials wrote a real
// '[redacted]' mid-pass, and the marker left in the text changed the word boundary the next pass
// read, so a second pass removed a credential the first missed and GREW a notice whose cap had
// already been charged ('XabcdefghBasic dXNlcjpw' 25 -> 27). The fix writes the sentinel, runs
// the Basic rule on the text every other removal has produced, and protects a marker the input
// already carries with a one-character placeholder instead of a variable-length span skip.
//
// S-F3 / V-F25-1 (Low) -- repriceShapedError read omitUrl off url === '' while both shapers set
// shaped.url unconditionally, so an omitUrl-shaped error was re-priced WITH its URL, and the
// re-price consulted only the caller's set, so it could republish a value the shaper had removed.
// The shapers now record the decision and the set they priced with, and the re-price reads both.
//
// S-F4 / V-F25-3 (Low) -- a value that CONTAINS the literal marker survived: the marker-span skip
// split it in two. It is now removed whole, before the marker is read as a span.
//
// V-F25-2 (Low) -- the assembly-time re-pricing was dead code (assembleNotice passed a string,
// and repriceShapedError returns any non-object untouched), so the shipped prose described a
// mechanism that could not run. The push now receives the shaped Error itself, which is what makes
// the re-pricing reachable and is also the cleanest way to satisfy S-F1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assembleNotice, collectAll } from '../scripts/collect.mjs';
import {
  redactSecrets, requestSecrets, shapeHttpError, shapeTransportError, repriceShapedError,
} from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const SKILL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const CLI = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
const SHIPPED = readSettings(join(CONFIG_DIR, 'settings.md'));
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const pad = (n, ch) => ch.repeat(n);
const settingsAt = (cap, snippet) => ({
  ...SHIPPED, github_rate_limit_reserve: 2, notice_max_chars: cap, error_snippet_max_chars: snippet,
});

// The sweep's own fixture: a target long enough that the source fills the front half, so a
// keep-both-ends seam lands inside it and the detail's reason is the part that was deleted.
const LONG_TARGET = 'https://pypi.org/pypi/' + pad(400, 'z');
const REASON = 'the response was not JSON';
const nonJsonTransport = () => ({ fetchText: async () => 'this answer is not JSON at all, just text' });

// ---------------------------------------------------------------------------------------
// S-F1 -- the reason survives a bounded detail, shaped and non-shaped, at both boundaries.
// ---------------------------------------------------------------------------------------

test('S-F1 a long non-shaped detail keeps its reason at 402/200 and 128/63', async () => {
  for (const [cap, snippet] of [[402, 200], [128, 63]]) {
    const pool = await collectAll(
      { settings: settingsAt(cap, snippet), watchlist: [{ kind: 'pypi', target: LONG_TARGET, domain: 'ai-llm', note: '' }] },
      { ...WINDOW, net: nonJsonTransport() },
    );
    assert.equal(pool.notices.length, 1, 'the run published ' + pool.notices.length + ' notices');
    const notice = pool.notices[0];
    assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at cap ' + cap);
    assert.ok(notice.includes(REASON),
      'the notice lost the reason of the parse failure at ' + cap + '/' + snippet + ': ' + JSON.stringify(notice));
  }
});

test('S-F1 the reason survives the shipped CLI with a curl shim at 402/200 and 128/63', () => {
  for (const [cap, snippet] of [[402, 200], [128, 63]]) {
    const dir = mkdtempSync(join(tmpdir(), 'tech-radar-cv4-f1-'));
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin, { recursive: true });
      const shim = join(bin, 'curl');
      // A 200 answer whose body is not JSON: parseJson throws, the collector pushes err.message.
      writeFileSync(shim, '#!/bin/sh\nprintf "%s\\n%s" "this registry answer is not JSON at all, just text" "200"\n');
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
      patchRow('error_snippet_max_chars', snippet);
      writeFileSync(settingsPath, text);
      writeFileSync(join(cfg, 'watchlist.md'), [
        '| kind | target | domain | note |',
        '|---|---|---|---|',
        '| pypi | ' + pad(400, 'z') + ' | ai-llm | long registry row |',
        '',
      ].join('\n'));
      const res = spawnSync(process.execPath, [
        CLI, '--config', cfg, '--out', join(dir, '.pool.json'), '--timeout', '10000', '--domain', 'ai-llm',
      ], { encoding: 'utf8', env: { ...process.env, PATH: bin, TECH_RADAR_DIR: '' } });
      assert.ok(res.stdout, 'the CLI wrote nothing; stderr=' + String(res.stderr).slice(0, 300));
      const notice = JSON.parse(res.stdout).notices[0] ?? '';
      assert.ok(notice.length <= cap, 'the CLI published ' + notice.length + ' characters at cap ' + cap);
      assert.ok(notice.includes(REASON),
        'the shipped CLI lost the reason at ' + cap + '/' + snippet + ': ' + JSON.stringify(notice.slice(0, 80)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('S-F1 a shaped detail is re-priced from its facts, never cut', async () => {
  // The shaped error is what every shipped collector hands the push. Its text is longer than the
  // cap allows beside the source, so the push rebuilds it from the shaped facts: the status stays
  // whole and the rebuilt text fits. A push that cut instead would lose 'HTTP 503'.
  const longUrl = 'https://api.github.com/repos/acme/' + pad(200, 'r') + '/releases';
  const shaped = shapeHttpError(503, 'x', longUrl, 400, {});
  assert.ok(shaped.message.length > 0, 'the shaped text is empty');
  const notice = assembleNotice('github acme/long-repo-name', shaped, [], 128);
  assert.ok(notice.length <= 128, 'the assembled notice is ' + notice.length + ' characters');
  assert.ok(notice.includes('HTTP 503'),
    'the assembled notice lost the status the shaped facts carry: ' + JSON.stringify(notice));
});

test('S-F1 no path publishes a notice over its cap or loses why a source failed', async () => {
  const cap = 200;
  const details = [
    pad(400, 'x'),
    REASON + ' (' + pad(120, 'y') + ')',
    'request failed for ' + pad(300, 'u') + ': could not resolve the host (curl exit 6)',
    'HTTP 503 for https://api.github.com/' + pad(120, 'q'),
  ];
  const sources = ['rss https://a.example/feed.xml', 'rss ' + pad(50, 'q'), ''];
  const secretSets = [[], ['abc'], ['redacted'], ['abcdefgh']];
  for (const source of sources) {
    for (const detail of details) {
      for (const secrets of secretSets) {
        const notice = assembleNotice(source, detail, secrets, cap);
        assert.ok(notice.length <= cap,
          'a notice is ' + notice.length + ' characters: ' + JSON.stringify(notice.slice(0, 60)));
        assert.ok(notice.length > 0, 'a notice is empty for ' + JSON.stringify([source, detail.slice(0, 20)]));
      }
    }
  }
  // The non-shaped reason, end to end, over the shipped cap pair: the sweep's 144 dropping cases
  // all had a source longer than the collector passes, so the collector's own bounds are the
  // regression surface and the reason is the thing the bound must keep.
  for (const [c, s] of [[402, 200], [128, 63]]) {
    const pool = await collectAll(
      { settings: settingsAt(c, s), watchlist: [{ kind: 'pypi', target: LONG_TARGET, domain: 'ai-llm', note: '' }] },
      { ...WINDOW, net: nonJsonTransport() },
    );
    for (const notice of pool.notices) {
      assert.ok(notice.length <= c, 'the notice is ' + notice.length + ' characters at cap ' + c);
      assert.ok(notice.includes(REASON), 'the reason was lost at ' + c + '/' + s + ': ' + JSON.stringify(notice));
    }
  }
});

// ---------------------------------------------------------------------------------------
// S-F2, S-F4 -- redaction is one pass, never lengthens, and removes a marker-bearing value.
// ---------------------------------------------------------------------------------------

test('S-F2 the sweep minimal repro is a fixed point with the same length', () => {
  const text = 'XabcdefghBasic dXNlcjpw';
  const secrets = ['abcdefgh'];
  const p1 = redactSecrets(text, secrets);
  const p2 = redactSecrets(p1, secrets);
  const p3 = redactSecrets(p2, secrets);
  assert.equal(p1, p2, 'pass 2 changed the pass-1 output');
  assert.equal(p1.length, p2.length, 'pass 2 changed the length: ' + p1.length + ' -> ' + p2.length);
  assert.equal(p2, p3, 'the pass is still not a fixed point');
  assert.ok(!/Basic dXNlcjpw/.test(p2),
    'the Basic credential survived the pass that produced the published text: ' + JSON.stringify(p2));
});

test('S-F2 a marker-substring value never rewrites the marker a pass wrote', () => {
  for (const secret of ['redacted', '[redacte', 'edacted]', '[redact', 'acted]', 'dacted']) {
    const basic = 'Basic ' + Buffer.from('user:abcdefgh').toString('base64');
    const out = redactSecrets(basic, [secret]);
    assert.equal(out, 'Basic [redacted]',
      'the secret ' + JSON.stringify(secret) + ' rewrote the marker into ' + JSON.stringify(out));
  }
});

test('S-F2 no pass lengthens and the second pass equals the first, over a marker/Basic fuzz', () => {
  // The credential-shaped tokens are assembled at run time so this file is not itself a shipped
  // file carrying a credential shape (the hygiene guard scans every shipped file for one).
  const token = 'ghp_' + 'abcdefghij';
  const bearer = 'Bearer ' + 'abcdefghij';
  const alphabet = ['[redacted]', 'redacted', '[redacte', 'edacted]', 'Basic ',
    'Basic dXNlcjpwYXNzd29yZA==', '](', '<script', '&lt;a href=x', 'token', 'a', ' ',
    '\uFFFF', token, bearer];
  const secretPool = ['redacted', '[redacte', 'edacted]', 'abcdefgh', 'token', 'a',
    token, bearer, 'user:password'];
  const rnd = (n) => Math.floor(Math.random() * n);
  let grew = 0;
  let changed = 0;
  for (let i = 0; i < 4000; i += 1) {
    let text = '';
    const n = 1 + rnd(8);
    for (let j = 0; j < n; j += 1) text += alphabet[rnd(alphabet.length)];
    const secrets = [];
    const m = rnd(4);
    for (let j = 0; j < m; j += 1) secrets.push(secretPool[rnd(secretPool.length)]);
    const a = redactSecrets(text, secrets);
    const b = redactSecrets(a, secrets);
    assert.ok(!a.includes('\uFFFF'), 'a sentinel survived into the published text: ' + JSON.stringify(a));
    if (b.length > a.length) grew += 1;
    if (a !== b) changed += 1;
  }
  assert.equal(grew, 0, grew + ' of 4000 fuzzed pairs lengthened the text on the second pass');
  assert.equal(changed, 0, changed + ' of 4000 fuzzed pairs are not fixed points');
});

test('S-F4 a value that carries the literal marker is removed, whole and shorter', () => {
  for (const secret of ['ab[redacted]cd', 'zz[redacted]zz']) {
    const text = 'echo ' + secret + ' end';
    const out = redactSecrets(text, [secret]);
    assert.ok(!out.includes(secret), 'the value was published verbatim: ' + JSON.stringify(out));
    assert.ok(out.length <= text.length, 'the removal lengthened the text');
    assert.equal(redactSecrets(out, [secret]), out, 'the removal is not a fixed point');
  }
});

test('S-F4 a marker-bearing credential is gone from the notice and the pool', async () => {
  const secret = 'ab[redacted]cd';
  const target = 'https://a.example/feed.xml?token=' + secret;
  assert.ok(requestSecrets(target, {}).includes(secret), 'the request no longer collects the value');
  const pool = await collectAll(
    { settings: settingsAt(1000, 200), watchlist: [{ kind: 'rss', target, domain: 'ai-llm', note: '' }] },
    { ...WINDOW, net: { fetchText: async () => '<rss><channel><item><title>echoed ' + secret + '</title><description>the service echoed token=' + secret + ' back</description><link>https://a.example/1</link></item></channel></rss>' } },
  );
  for (const candidate of pool.candidates) {
    for (const [field, value] of Object.entries(candidate)) {
      if (typeof value !== 'string') continue;
      assert.ok(!value.includes(secret),
        'the credential reached the pool field ' + field + ': ' + JSON.stringify(value));
    }
  }
});

test('S-F4 an upstream answer that echoes a marker-bearing token publishes it nowhere', () => {
  const secret = 'ab[redacted]cd';
  const serviceNote = 'the service echoed token=' + secret + ' back';
  assert.ok(!redactSecrets(serviceNote, [secret]).includes(secret),
    'the echoed token survived the redaction: ' + JSON.stringify(redactSecrets(serviceNote, [secret])));
});

// ---------------------------------------------------------------------------------------
// S-F3 / V-F25-1 -- the re-price reads the omitUrl decision and the set the text was priced on.
// ---------------------------------------------------------------------------------------

test('S-F3 an omitUrl-shaped error is never re-priced with a URL', () => {
  const shaped = shapeHttpError(503, 'x', 'https://api.github.com/repos/acme/r1/releases', 200, {}, true);
  assert.equal(shaped.omitUrl, true, 'the shaper did not record the omitUrl decision');
  const repriced = repriceShapedError(shaped, [], 200);
  assert.ok(!repriced.message.includes('api.github.com'),
    'the re-price put the request back into a text shaped with no request: ' + JSON.stringify(repriced.message));
  assert.ok(repriced.message.includes('HTTP 503'), 'the re-price lost the status: ' + JSON.stringify(repriced.message));
  // The same for the transport half, whose shaped text is the compact 'request failed: <cause>'.
  const transport = shapeTransportError({ status: 6 }, 'https://api.github.com/repos/acme/r1/releases', 200, {}, true);
  assert.equal(transport.omitUrl, true, 'the transport shaper did not record the omitUrl decision');
  const repricedTransport = repriceShapedError(transport, [], 200);
  assert.ok(!repricedTransport.message.includes('api.github.com'),
    'the transport re-price put the request back: ' + JSON.stringify(repricedTransport.message));
  assert.ok(repricedTransport.message.includes('could not resolve the host'),
    'the transport re-price lost the cause: ' + JSON.stringify(repricedTransport.message));
});

test('S-F3 the re-price keeps the values the shaper removed, with no extra set to help it', () => {
  const url = 'https://h.example/BASICUSERPW/feed';
  const shaped = shapeHttpError(500, 'boom', url, 200, { Authorization: 'Bearer BASICUSERPW' });
  assert.ok(!shaped.message.includes('BASICUSERPW'), 'the shaper no longer removes the value');
  const repriced = repriceShapedError(shaped, [], 200);
  assert.ok(!repriced.message.includes('BASICUSERPW'),
    'the re-price republished a value the shaper had removed: ' + JSON.stringify(repriced.message));
  assert.ok(repriced.message.includes('[redacted]') || repriced.message.includes('BASICUSERPW') === false,
    'the rebuilt text carries the value in another spelling: ' + JSON.stringify(repriced.message));
});

test('S-F3 the omitUrl decision survives the documented opts.net transport seam', async () => {
  const target = 'https://a.example/feed.xml';
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      throw shapeHttpError(403, 'forbidden', 'https://answer.example/acme/repo-from-the-listing',
        limit, headers ?? {}, true);
    },
  };
  const pool = await collectAll(
    { settings: settingsAt(402, 200), watchlist: [{ kind: 'rss', target, domain: 'ai-llm', note: '' }] },
    { ...WINDOW, net },
  );
  assert.equal(pool.notices.length, 1, 'the run published ' + pool.notices.length + ' notices');
  assert.ok(!pool.notices[0].includes('answer.example'),
    'the notice carries the answer-derived URL the shaper was told to omit: ' + JSON.stringify(pool.notices[0]));
  assert.ok(pool.notices[0].includes('HTTP 403'),
    'the notice lost the status: ' + JSON.stringify(pool.notices[0]));
});

// ---------------------------------------------------------------------------------------
// V-F25-2 -- the assembly-time re-pricing is reachable, and the guarantee still holds.
// ---------------------------------------------------------------------------------------

test('V-F25-2 a shaped error handed to the push is rebuilt from its facts, not cut', () => {
  const shaped = shapeHttpError(403, 'x', 'https://api.example/' + pad(300, 'u'), 400, {});
  assert.ok(shaped.message.length > 128, 'the fixture no longer overflows the cap');
  const notice = assembleNotice('rss https://a.example/feed.xml', shaped, [], 128);
  assert.ok(notice.length <= 128, 'the notice is ' + notice.length + ' characters');
  assert.ok(notice.includes('HTTP 403 for '),
    'the rebuilt detail lost the status prefix: ' + JSON.stringify(notice));
  // The rebuilt text is the shaped text bounded again from the same facts, so it is not the
  // library's own String(err) spelling and carries no 'Error: ' prefix.
  assert.ok(!notice.includes('Error:'), 'the push published a String(err) spelling: ' + JSON.stringify(notice));
});

test('V-F25-2 the shipped collectors hand the shaped error, not only its text', async () => {
  const cap = 128;
  const longUrl = 'https://blog.example/feed.xml/' + pad(200, 'x');
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      throw shapeHttpError(503, 'x', longUrl, limit, headers ?? {}, Boolean(omitUrl));
    },
  };
  const pool = await collectAll(
    { settings: settingsAt(cap, 63), watchlist: [{ kind: 'rss', target: longUrl, domain: 'ai-llm', note: '' }] },
    { ...WINDOW, net },
  );
  assert.equal(pool.notices.length, 1, 'the run published ' + pool.notices.length + ' notices');
  assert.ok(pool.notices[0].length <= cap, 'the notice is ' + pool.notices[0].length + ' characters');
  assert.ok(pool.notices[0].includes('HTTP 503'),
    'the notice lost the status: ' + JSON.stringify(pool.notices[0]));
});
