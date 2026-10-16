// tests/notice-whole-line-regression.test.mjs
// The notice assembly publishes only bytes the whole-line redaction produced.
//
// A swept closing review found that the composition fallback rebuilt a notice from its two
// separately-redacted parts and threw the whole-line redaction away, so a credential whose prefix
// ended the source and whose suffix began the detail was removed from the whole line, from neither
// part, and republished in the pool. The assembly now bounds the whole line and uses the parts only
// to decide where the cut falls, so the push is a fixed point of the run's own passes and never
// publishes a byte the whole-line pass removed. The same batch keeps the documented
// 'source: detail' shape at the cap boundary (the label and the separator are the last thing
// dropped), stops identifying a shaped error by an httpStatus the shipped shapers never set alone,
// and takes the four probe-only helpers back out of the module surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assembleNotice, collectAll, neutraliseNoticeText } from '../scripts/collect.mjs';
import { redactSecrets, requestSecrets } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const COLLECT = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
const SHIPPED = readSettings(new URL('../config/settings.md', import.meta.url).pathname);
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const pad = (n, ch) => ch.repeat(n);
const settingsAt = (cap, snippet) => ({
  ...SHIPPED, github_rate_limit_reserve: 2, notice_max_chars: cap, error_snippet_max_chars: snippet,
});

// The run's own pass, applied to an assembled notice the way a collector's return and collectAll's
// union pass apply it.
const republished = (notice, secrets, cap) => neutraliseNoticeText(redactSecrets(notice, secrets)).slice(0, cap);

// ---------------------------------------------------------------------------------------
// the seam finding -- a value that spans the ': ' seam reaches neither the push nor the pool.
// ---------------------------------------------------------------------------------------

test('a value spanning the separator is never published by the push', () => {
  // The sweep's minimal primitive: 'ab: cd' is removed from 'ab: cd' and from neither part.
  assert.equal(assembleNotice('ab', 'cd', ['ab: cd'], 128), '[redacted]');
  // The same at every accepted cap, including the 128 floor.
  for (const cap of [128, 129, 200, 402, 1000]) {
    const out = assembleNotice('ab', 'cd', ['ab: cd'], cap);
    assert.ok(out.length <= cap, 'the notice is ' + out.length + ' characters at cap ' + cap);
    assert.ok(!out.includes('ab: cd'),
      'the push published the seam-spanning value at cap ' + cap + ': ' + JSON.stringify(out));
  }
});

test('the swept repro publishes no seam-spanning credential', async () => {
  // An rss row whose target carries the value 'a: the' (refused with no request, so the value never
  // enters the run's issued set) and a pypi row whose answer is not JSON, so parseJson's own phrase
  // is the detail. The source ends 'pkg-a' and the detail begins 'the ', so V spans the seam.
  const V = 'a: the';
  const rows = [
    { kind: 'rss', target: 'a.example/x?token=a%3A%20the', domain: 'ai-llm', note: '' },
    { kind: 'pypi', target: 'pkg-a', domain: 'ai-llm', note: '' },
  ];
  const net = { fetchText: async (url) => (url.includes('pypi.org') ? 'not json at all' : '[]') };
  const pool = await collectAll({ settings: SHIPPED, watchlist: rows }, { ...WINDOW, net });
  assert.ok(!JSON.stringify(pool).includes(V),
    'the published pool carries the credential: ' + JSON.stringify(pool.notices));
  for (const notice of pool.notices) {
    assert.ok(!notice.includes(V), 'the notice carries the credential: ' + JSON.stringify(notice));
  }
  // The same at the least accepted cap, where the sweep's own probe reported the leak.
  const tight = await collectAll(
    { settings: settingsAt(128, 63), watchlist: rows },
    { ...WINDOW, net },
  );
  for (const notice of tight.notices) {
    assert.ok(notice.length <= 128, 'the notice is ' + notice.length + ' characters at cap 128');
  }
});

// ---------------------------------------------------------------------------------------
// the fixed-point finding -- every notice the push publishes is a fixed point of the run's two passes.
// ---------------------------------------------------------------------------------------

test('the push publishes a fixed point, never a longer text the run then cuts', () => {
  const target = 'https://u:pw%3A%20the@a.example/pw';
  const secrets = requestSecrets(target, {});
  assert.ok(secrets.includes('pw: the'), 'the fixture no longer collects the value');
  for (let k = 60; k <= 140; k += 1) {
    const detail = 'the ' + pad(k, 'x');
    const pushed = assembleNotice('rss https://a.example/pw', new Error(detail), secrets, 128);
    assert.ok(pushed.length <= 128, 'the push is ' + pushed.length + ' characters (k=' + k + ')');
    assert.ok(!pushed.includes('pw: the'), 'the push carries the value (k=' + k + '): ' + JSON.stringify(pushed.slice(0, 40)));
    assert.equal(redactSecrets(pushed, secrets), pushed,
      'the push is not a fixed point of the run redaction (k=' + k + ')');
    assert.equal(neutraliseNoticeText(pushed), pushed,
      'the push is not a fixed point of the notice rewriting (k=' + k + ')');
    // What the run republishes is the push itself, never a rewrite of it.
    assert.equal(republished(pushed, secrets, 128), pushed,
      'the run republished a different notice (k=' + k + ')');
  }
});

// ---------------------------------------------------------------------------------------
// the source-and-separator finding -- the published form always carries a source and the separator.
// ---------------------------------------------------------------------------------------

test('the source and the separator survive at the cap boundary', () => {
  // The shipped rss detail shape at the boundary the verification measured: a target long enough
  // that the detail alone is longer than the cap.
  for (const [cap, nameLength] of [[402, 370], [402, 372], [402, 373], [402, 374], [402, 400], [128, 60]]) {
    const source = 'rss https://a.example/' + pad(nameLength, 'a');
    const detail = 'the response was not JSON (' + pad(nameLength, 'b') + ')';
    const notice = assembleNotice(source, detail, [], cap);
    assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at cap ' + cap);
    assert.ok(notice.startsWith('rss'), 'the notice names no source: ' + JSON.stringify(notice.slice(0, 30)));
    assert.ok(notice.includes(': '), 'the notice carries no separator: ' + JSON.stringify(notice.slice(0, 30)));
    assert.ok(!notice.startsWith(': '),
      'the notice opens with a dangling separator: ' + JSON.stringify(notice.slice(0, 30)));
    assert.ok(notice.includes('the response was not JSON'),
      'the notice lost the reason: ' + JSON.stringify(notice.slice(0, 60)));
  }
});

test('a caller phrase with no separator is still bounded to the cap', () => {
  for (const cap of [128, 200, 402]) {
    const notice = assembleNotice('', pad(500, 'x'), [], cap);
    assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at cap ' + cap);
    assert.ok(notice.length > 0, 'the notice is empty');
  }
});

// ---------------------------------------------------------------------------------------
// the cap-validation finding / the forged-detail finding / the module-surface finding -- the module surface.
// ---------------------------------------------------------------------------------------

test('the probe-only helpers are no longer exported', () => {
  const source = readFileSync(COLLECT, 'utf8');
  for (const name of ['boundedWhole', 'noticeSource', 'noticeSourceRoom', 'shapedDetailOf']) {
    assert.ok(!source.includes('export function ' + name + '('),
      name + ' is still part of the module surface');
  }
  assert.ok(source.includes('export function assembleNotice('),
    'assembleNotice is the one helper the shipped test needs');
  const module = readFileSync(COLLECT, 'utf8');
  assert.ok(!module.includes('export function boundedFallback(')
    && !module.includes('export function composeLine('), 'a private helper was exported');
});

test('the assembly never publishes an empty reason and never throws on a forged detail', () => {
  // A forged object the shipped shapers never build: an httpStatus with no message and no cause.
  assert.doesNotThrow(() => assembleNotice('rss', { httpStatus: null, cause: 'x' }, [], 128));
  const forged = assembleNotice('rss', { httpStatus: null, cause: 'x' }, [], 128);
  assert.ok(!/^rss: ?$/.test(forged), 'the assembly published no reason: ' + JSON.stringify(forged));
  // A Proxy whose every property read throws must not reach the caller.
  const trap = new Proxy({}, { get() { throw new Error('proxy trap'); } });
  assert.doesNotThrow(() => assembleNotice('rss', trap, [], 128), 'the assembly threw out of a Proxy detail');
  const proxied = assembleNotice('rss', trap, [], 128);
  assert.ok(proxied.length <= 128 && proxied.length > 0, 'the proxied notice is ' + JSON.stringify(proxied));
});

test('the whole-line redaction is what bounds a notice, at every accepted cap', () => {
  const source = 'rss https://a.example/feed.xml';
  const details = [pad(400, 'x'), 'the response was not JSON (' + pad(120, 'y') + ')', '', 'ab: cd'];
  for (const cap of [128, 200, 402, 1000]) {
    for (const detail of details) {
      for (const secrets of [[], ['abc'], ['ab: cd'], ['redacted']]) {
        const notice = assembleNotice(source, detail, secrets, cap);
        assert.ok(notice.length <= cap,
          'a notice is ' + notice.length + ' characters at cap ' + cap + ': ' + JSON.stringify(notice.slice(0, 40)));
        assert.equal(redactSecrets(notice, secrets), notice,
          'the notice is not a fixed point of the redaction: ' + JSON.stringify(notice.slice(0, 40)));
        assert.equal(neutraliseNoticeText(notice), notice,
          'the notice is not a fixed point of the rewriting: ' + JSON.stringify(notice.slice(0, 40)));
      }
    }
  }
});