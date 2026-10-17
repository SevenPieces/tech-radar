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
import { redactSecrets, requestSecrets, shapeTransportError } from '../scripts/lib/net.mjs';
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

// ---------------------------------------------------------------------------------------
// Batch 52 / the F27-5 residual: the notice's own structure is immune.
//
// The assembly's ': ' separator and the reason it writes for a detail with no readable message
// are the module's own bytes, and a value that happens to spell them must not remove them. The
// residual had two halves. A collected ': ' (the operator's own two-character userinfo password,
// or a two-character query value) reaped the separator wherever the source ended at a non-word
// character -- 'rss https://b.example/[redacted]request failed for ...', the documented
// 'source: detail' shape destroyed and the transport cause moved off the position the scaffold
// protects it in -- and an EMPTY detail was rebuilt from the head's own pass after the whole-line
// pass had run, so a value the whole-line pass had removed together with the seam ('x: ', ': ')
// was put back and removed again by the run's own re-redaction: 128 of 10,584 cases in the
// sweep's p3-compose matrix (12,651 of 300,000 randomized ones) grew by a marker per pass.
// A value that EXTENDS beyond the separator (': x', 'x: ', 'ab: cd') is a credential that merely
// straddles it and is still removed with it, which the test above pins.
// ---------------------------------------------------------------------------------------

// The pieces and the value pool of the sweep's p3-compose probe, verbatim.
const COMPOSE_PIECES = ['', ':', ': ', 'ab', 'cd', 'x', '<a href=x', 'y>', '](', '(', ')',
  '[redacte', 'd]', 'authorization', 'Bearer ', 'Basic dXNlcjpw', pad(70, 's'),
  'the response was not JSON (', pad(200, 'q'), ')', '\uFFFF'];
const COMPOSE_VALUES = ['ab: cd', ': ', 'x: ', ': x', 'abcdefgh', 'Bearer abcdefghij',
  '[redacted]', 'redacted]'];

test('F27-5 residual: every notice the p3-compose matrix builds is a fixed point inside its cap', () => {
  let checked = 0;
  for (const cap of [128, 129, 402, 1000]) {
    for (const source of COMPOSE_PIECES) {
      for (const detail of COMPOSE_PIECES) {
        for (const secrets of [[], [COMPOSE_VALUES[0]], [COMPOSE_VALUES[1]], [COMPOSE_VALUES[4]],
          [COMPOSE_VALUES[5]], COMPOSE_VALUES]) {
          checked += 1;
          const notice = assembleNotice(source, detail, secrets, cap);
          const where = cap + '/' + JSON.stringify(source) + '/' + JSON.stringify(detail)
            + '/' + JSON.stringify(secrets);
          assert.ok(notice.length <= cap,
            'the notice is ' + notice.length + ' characters at ' + where);
          const again = redactSecrets(notice, secrets);
          assert.equal(again, notice,
            'the notice is not a fixed point of the run redaction at ' + where + ': '
            + JSON.stringify(notice) + ' -> ' + JSON.stringify(again));
          const republishedThis = republished(notice, secrets, cap);
          assert.equal(republishedThis, notice,
            'the run republished a different notice at ' + where + ': '
            + JSON.stringify(notice) + ' -> ' + JSON.stringify(republishedThis));
          assert.ok(republishedThis.length <= cap,
            're-redacting the notice exceeded its cap at ' + where);
        }
      }
    }
  }
  assert.ok(checked >= 5000, 'the matrix ran ' + checked + ' cases');
});

test('F27-5 residual: a value that spells only the separator removes nothing', () => {
  // The separator itself, and the one character it is built from, are the notice's own structure:
  // a value that carries no byte beyond them can carry no credential the notice does not already
  // publish structurally, and removing it destroys the documented shape.
  for (const value of [': ', ':']) {
    assert.equal(redactSecrets('a: b', [value]), 'a: b',
      'the value ' + JSON.stringify(value) + ' reaped the separator in prose');
    assert.equal(redactSecrets('rss https://b.example/: request failed for https://b.example/: failed to connect (curl exit 7)', [value]),
      'rss https://b.example/: request failed for https://b.example/: failed to connect (curl exit 7)',
      'the value ' + JSON.stringify(value) + ' reaped a notice separator');
  }
  // The exemption is the separator ALONE. A value that extends beyond it is a credential that
  // straddles the seam, and it is still removed -- with the separator it spans.
  assert.equal(assembleNotice('ab', 'cd', ['ab: cd'], 128), '[redacted]',
    'a value spanning the seam was published');
  assert.equal(redactSecrets('x: y', ['x: ']), '[redacted]y',
    'a value extending left of the seam was published');
});

test('F27-5 residual: the run keeps the notice shape when a row carries the separator itself', async () => {
  // The operator's own two-character userinfo password is collected whatever its length, so it
  // enters the run union for EVERY notice. At the parent the separator of every notice whose
  // source ended at a non-word character was reaped; the source, the status and the request then
  // ran together with no separator at all.
  const target = 'https://b.example/';
  const long = 'https://b.example/' + pad(40, 'a') + '/';
  const settings = settingsAt(128, 63);
  const rows = [
    { kind: 'rss', target: 'https://u:%3A%20@feeds.example/feed.xml', domain: 'ai-llm', note: '' },
    { kind: 'rss', target: long, domain: 'ai-llm', note: '' },
    { kind: 'rss', target: 'https://feeds.example/c.xml?token=connect', domain: 'ai-llm', note: '' },
  ];
  const net = {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      if (url.includes('b.example')) {
        throw shapeTransportError({ status: 7 }, url, limit, headers ?? {}, Boolean(omitUrl));
      }
      return '<rss><channel><item><title>the releases page</title>'
        + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
        + '<description>the archived releases</description></item></channel></rss>';
    },
  };
  const secrets = requestSecrets('https://u:%3A%20@feeds.example/feed.xml', {});
  assert.ok(secrets.includes(': '), 'the fixture no longer collects the two-character password');
  const pool = await collectAll({ settings, watchlist: rows }, { ...WINDOW, net });
  assert.ok(pool.notices.length > 0, 'the run published no notice');
  let transported = 0;
  for (const notice of pool.notices) {
    assert.ok(notice.length <= 128, 'the notice is ' + notice.length + ' characters: ' + JSON.stringify(notice));
    assert.ok(notice.includes(': '),
      'the run published a notice with no separator: ' + JSON.stringify(notice));
    if (notice.includes('failed to connect')) {
      transported += 1;
      assert.ok(notice.includes('failed to connect (curl exit 7)'),
        'the transport cause lost a word: ' + JSON.stringify(notice));
      assert.ok(notice.startsWith('rss '), 'the notice lost its source: ' + JSON.stringify(notice));
    }
  }
  assert.ok(transported > 0, 'the transport notice is missing from ' + JSON.stringify(pool.notices));
  assert.equal(target, 'https://b.example/', 'the fixture target changed');
});

test('F27-5 residual: the assembly\u2019s own reason survives a value that spells its words', () => {
  const reason = 'a failure with no message';
  // The reason is the module's own text and stands where the shaper's cause stands: at the head of
  // the detail, after the notice's ': ' seam.
  assert.equal(assembleNotice('rss', { httpStatus: null, cause: 'x' }, ['failure', 'message'], 128),
    'rss: ' + reason, 'the assembly lost its own reason');
  assert.equal(assembleNotice('rss', '', ['a failure', 'with no'], 128), 'rss: ' + reason,
    'the assembly lost its own reason for an empty detail');
  assert.equal(redactSecrets('rss: ' + reason, ['failure']), 'rss: ' + reason,
    'the run redaction reaped the assembly reason');
  // The protection is POSITIONAL, exactly as the cause phrases' is: the same words in a source's
  // own prose are not the assembly's reason and a value that spells one of them still goes.
  assert.equal(redactSecrets('the tool said a failure with no message twice', ['failure']),
    'the tool said a [redacted] with no message twice',
    'the reason protection leaked into ordinary prose');
});

// Batch 91 closed this for one byte; Batch 93 (closing sweep F39-1) closed the class. The rule the
// notice control pass applies is not an exception for the NEL: a control byte standing between two
// words becomes the space that keeps them apart, because a dropped byte glues a keyword to the value
// behind it -- one word no removal rule can read. Measured end to end (tests/
// control-separator-property.test.mjs drives the shipped collector over 0x00-0xFF): 'authorization:'
// + CSI + '<token>' was published as a single word before Batch 93, exactly as the NEL spelling was
// before Batch 91.
test('a control byte is a separator in notice text: it is spaced, never dropped', () => {
  const NEL = '\u0085';
  assert.equal(neutraliseNoticeText('a' + NEL + 'b'), 'a b',
    'a NEL is a line end and becomes a space, not nothing');
  assert.equal(neutraliseNoticeText('a' + '\n' + 'b'), neutraliseNoticeText('a' + NEL + 'b'),
    'a NEL answers exactly as LF does');
  // Every control byte, not the NEL alone: the notice pass reads the same named class plainText
  // does (net.mjs CONTROL_CHARACTERS), so the assembled notice and the candidate field cannot
  // answer differently at any byte.
  for (let cp = 0x00; cp <= 0x9f; cp += 1) {
    if (cp >= 0x20 && cp <= 0x7e) continue; // printable: not this class
    const ch = String.fromCharCode(cp);
    assert.equal(neutraliseNoticeText('a' + ch + 'b'), neutraliseNoticeText('a\nb'),
      'a control byte at U+' + cp.toString(16).padStart(4, '0') + ' is not spaced as LF is');
  }
  for (const cap of [128, 402, 1000]) {
    for (const sep of [NEL, '\u009b', '\u0000', '\u007f', '\u0080', '\u009f']) {
      const notice = assembleNotice('rss', 'authorization:' + sep + 'tok_9f3a2c7d1e5b', [], cap);
      assert.ok(!notice.includes('tok_9f3a2c7d1e5b'),
        'the credential behind U+' + sep.codePointAt(0).toString(16) + ' was published at cap ' + cap
        + ': ' + JSON.stringify(notice));
      assert.ok(notice.startsWith('rss: '), 'the notice lost its source: ' + JSON.stringify(notice));
    }
  }
});