// tests/final45-closures.test.mjs
// THE CLOSING PAIR'S FINDINGS, CLOSED (Batch 105). The terminal pair
// (docs/hardening-2026-10-15/scratch-final45-verify/FINAL45-VERIFY-REPORT.md and
// docs/hardening-2026-10-15/scratch-final45-sweep/CLOSING45-SWEEP-REPORT.md) measured the same
// revision and agreed the two earlier Highs were closed; what remained is pinned here and closed:
//   (a) F45-1 (High, the shipped keyless pool): the Basic join accepted the SHORTEST valid
//       'user:1char' prefix while the unsplit rule takes the LONGEST, so the rest of the payload
//       published. With a 46-character userinfo and password 's3cr3tp4ssw0rd' the tail
//       'M2NyM3RwNHNzdzByZA==' decoded to '3cr3tp4ssw0rd' on every surface and in the real pool
//       summary. The join now reads the acceptance to the end of the run and removes the longest
//       accepted prefix, exactly as decodedBasicToken removes the longest candidate.
//   (b) TR-344 / FINAL43 F43-3 (the recorded early-stop tail): the same defect in the curated-body
//       join, closed with it and pinned in tests/separator-mark-property.test.mjs.
//   (c) verify F45-2: the legacy no-semicolon names were matched case-insensitively ('&NBSP',
//       '&SHY' read where HTML5 leaves them literal). The named table is the exact WHATWG spelling
//       now, and the readers are case-sensitive.
//   (d) verify F45-3: the incremental reader removed a 'userinfo:' pair (empty password) with '=='
//       padding followed by an ordinary word, which 0063439 kept. The ordinary-gap crossing now has
//       to reach INTO the run after the gap, so that row is kept exactly as 0063439 kept it.
//   (e) F45-4 / the false 'published byte is unchanged' sentence: corrected in net.mjs's comment
//       (the notice path renders a non-ordinary whitespace spelling as a space where 3fcf85c
//       published the character); the renderer's C1/invisible class is closed in
//       tests/render-html.test.mjs (F45-3 at the renderer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  plainText, redactSecrets, redactCredentialShapes, renderSeparatorMarks,
  decodeSeparatorEntities, decodeEntities, SCHEME_GAP_PATTERN,
} from '../scripts/lib/net.mjs';
import { collectAll, assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const SETTINGS = { ...readSettings(join(HERE, 'config', 'settings.md')), github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-01T00:00:00Z', until: '2026-09-30T00:00:00Z' };
const ZWSP = String.fromCodePoint(0x200b);
const CAPS = [128, 402, 1000];
const PASSWORD = 's3cr3tp4' + 'ssw0rd';
const U46 = 'u'.repeat(46);
const PAYLOAD = Buffer.from(U46 + ':' + PASSWORD).toString('base64');
const TAIL = Buffer.from(PASSWORD.slice(1)).toString('base64');
const candidate = (raw, limit = 400) => redactCredentialShapes(plainText(raw, limit));
const notice = (raw) => redactSecrets(raw, []);
// The reader's view: every class separator deleted, so a tail that a reader can decode is visible.
const squash = (text) => {
  let out = '';
  for (const ch of String(text ?? '')) if (!SCHEME_GAP_PATTERN.test(ch)) out += ch;
  return out;
};
const surfaces = (raw) => [
  ['candidate', candidate(raw)],
  ['notice', notice(raw)],
  ['neutralised notice', renderSeparatorMarks(neutraliseNoticeText(notice(raw)))],
  ...CAPS.map((cap) => ['assembly@' + cap, assembleNotice('rss', raw, [], cap)]),
];
// The shipped keyless pool through the real collectAll, exactly as the sweep measured it.
const poolFields = async (body) => {
  const net = {
    fetchText: async (url) => {
      if (url === 'https://api.github.com/rate_limit') {
        return JSON.stringify({ resources: { core: { limit: 60, remaining: 55, reset: 1790177128, used: 5 } } });
      }
      if (url.includes('/tags')) return '[]';
      if (url.includes('/releases')) {
        return JSON.stringify([{ tag_name: 'v1.0.0', html_url: 'https://github.com/org/repo/releases/tag/v1.0.0',
          published_at: '2026-09-21T10:00:00Z', draft: false, body }]);
      }
      throw new Error('unexpected request: ' + url);
    },
  };
  const pool = await collectAll({ settings: SETTINGS, sources: [], domains: [],
    watchlist: [{ kind: 'github-repo', target: 'org/repo', domain: 'ai-llm', note: '' }] }, { ...WINDOW, net });
  const out = [];
  for (const c of pool.candidates) for (const k of ['title', 'summary']) if (typeof c[k] === 'string') out.push([k, c[k]]);
  return out;
};

test('F45-1: the Basic join removes the LONGEST accepted payload, so a decodable tail never publishes', async () => {
  const raw = 'release: Basic ' + [...PAYLOAD].join(ZWSP) + ' and prose';
  // The reproduction, before the fix: the candidate/notice/neutralised notice/assembly at every cap
  // carried 'M2NyM3RwNHNzdzByZA==' (base64 of '3cr3tp4ssw0rd'), and the real pool summary carried it.
  for (const [surface, text] of surfaces(raw)) {
    const view = squash(text);
    assert.ok(!text.includes(TAIL) && !view.includes(TAIL),
      'F45-1: the ' + surface + ' published the password continuation ' + JSON.stringify(TAIL));
    assert.ok(!view.includes(PASSWORD.slice(1)),
      'F45-1: the ' + surface + ' published a decodable reader view of the password continuation');
  }
  const fields = await poolFields(raw);
  assert.ok(fields.length > 0, 'the Basic split row produced no pool field at all');
  for (const [key, value] of fields) {
    assert.ok(!value.includes(TAIL) && !squash(value).includes(TAIL),
      'F45-1: the shipped keyless pool ' + key + ' published the password continuation');
  }
  // A long userinfo is not special: every row the sweep decoded ('abc', 'alice12', 'abcd', ...)
  // answers the same way.
  for (const [userinfo, password] of [['alice' + '12', 's3cr3tp4' + 'ssw0rd'], ['abcd', 'assword' + '123'],
    ['abcdefghij', 'unter2' + 'hunter2']]) {
    const payload = Buffer.from(userinfo + ':' + password).toString('base64');
    const row = 'release: Basic ' + [...payload].join(ZWSP) + ' and prose';
    for (const [surface, text] of surfaces(row)) {
      assert.ok(!squash(text).includes(Buffer.from(password.slice(1)).toString('base64')),
        'F45-1: the ' + surface + ' published a decoded tail for userinfo ' + userinfo);
    }
  }
  // THE UNSPLIT RESULT IS BYTE-IDENTICAL: the fix moves only the joined path.
  for (const [surface, text] of [['candidate', candidate('release: Basic ' + PAYLOAD + ' and prose')],
    ['notice', notice('release: Basic ' + PAYLOAD + ' and prose')]]) {
    assert.equal(text, 'release: Basic [redacted] and prose',
      'the unsplit answer moved on the ' + surface + ' pass');
  }
});

test('F45-1: the split-count matrix publishes no payload fragment anywhere', () => {
  const splitInto = (value, runs) => {
    if (runs === 1) return [value];
    const out = [];
    let prev = 0;
    for (let i = 1; i < runs; i += 1) {
      const at = Math.floor((i * value.length) / runs);
      out.push(value.slice(prev, at));
      prev = at;
    }
    out.push(value.slice(prev));
    return out;
  };
  const fragments = (text) => {
    const view = squash(text);
    for (let i = 0; i + 4 <= PAYLOAD.length; i += 1) {
      if (view.includes(PAYLOAD.slice(i, i + 4))) return PAYLOAD.slice(i, i + 4);
    }
    return null;
  };
  for (const runs of [1, 2, 3, 8, 64, 65, 100, 1000, 'per-character']) {
    const parts = runs === 'per-character' ? [...PAYLOAD] : splitInto(PAYLOAD, runs);
    const raw = 'release: Basic ' + parts.join(ZWSP) + ' and prose';
    // The two uncapped rule paths carry the whole input at every run count.
    for (const [surface, text] of [['notice', notice(raw)], ['candidate rule, uncapped', candidate(raw, 1_000_000)]]) {
      assert.equal(fragments(text), null,
        'F45-1 matrix: the ' + surface + ' published a payload fragment at ' + String(runs) + ' runs');
    }
    // The capped shipped surfaces carry the whole input only while the input fits their cap. A cap
    // cut is not a redaction (the sweep's own reading), so the row is measured where the text fits.
    for (const [surface, text] of surfaces(raw)) {
      const cap = /assembly@(\d+)/.exec(surface);
      if (surface === 'candidate' && raw.length > 400) continue;
      if (cap && raw.length > Number(cap[1])) continue;
      assert.equal(fragments(text), null,
        'F45-1 matrix: the ' + surface + ' published a payload fragment at ' + String(runs) + ' runs');
    }
  }
  // THE 1,000-RUN ROW ON THE CAPPED SURFACES: a pair whose colon sits inside the field's visible
  // window, so the capped candidate/pool field is measured at the highest run count as well.
  const short = Buffer.from('u:' + 'abcdefgh').toString('base64');
  const shortRaw = 'release: Basic ' + [...short].join(ZWSP) + ' and prose';
  for (const [surface, text] of surfaces(shortRaw)) {
    assert.ok(!squash(text).includes(short), 'F45-1 matrix: the ' + surface + ' published the shared-colon payload at 1,000 runs');
  }
});

test('TR-344 / F43-3: the curated-body join removes the whole body, not the first accepting prefix', () => {
  const classic = 'ghp_' + 'abcdefghijklmnop';
  const raw = 'a commit carried ghp_ab' + ZWSP + 'cd' + ZWSP + 'efgh' + ZWSP + 'ijklmnop end';
  for (const [surface, text] of [['candidate', candidate(raw)], ['notice', notice(raw)]]) {
    assert.ok(!squash(text).includes(classic), 'the ' + surface + ' published the split credential');
    assert.ok(!text.includes('ijklmnop'), 'the ' + surface + ' still left the early-stop tail');
  }
});

test('verify F45-2: the named table is the exact WHATWG spelling and the readers are case-sensitive', () => {
  // The legacy no-semicolon names are the lower-case spellings HTML5 carries; the upper-case forms
  // are not names and stay literal (Python's html.unescape leaves them literal too).
  for (const ref of ['&NBSP', '&SHY', '&NBSP;', '&SHY;', '&Nbsp;', '&SHYabc;']) {
    assert.equal(plainText('a' + ref + 'b', 100), 'a' + ref + 'b',
      ref + ' was read as a separator although HTML5 leaves it literal');
    assert.equal(decodeSeparatorEntities('a' + ref + 'b'), 'a' + ref + 'b',
      ref + ' was decoded by the notice-pass entity reader');
  }
  // The exact WHATWG spellings still resolve, on both readers.
  for (const ref of ['&nbsp;', '&shy;', '&ZeroWidthSpace;', '&ThinSpace;', '&ApplyFunction;', '&af;', '&NoBreak;']) {
    assert.equal(decodeSeparatorEntities('a' + ref + 'b'), 'a' + decodeSeparatorEntities('a&nbsp;b').slice(1, 2) + 'b',
      ref + ' is no longer read as the separator it names');
    assert.ok(SCHEME_GAP_PATTERN.test(decodeSeparatorEntities('a' + ref + 'b')[1]),
      ref + ' did not resolve to a class member');
  }
  assert.equal(decodeSeparatorEntities('a' + ZWSP + 'b'), 'a' + ZWSP + 'b');
  // The ordinary references decode exactly as HTML5 spells them; the upper-case legacy spellings
  // HTML5 carries resolve too, and a case the table does not carry stays literal.
  assert.equal(decodeEntities('a &amp; b &lt;c&gt;'), 'a & b <c>');
  assert.equal(decodeEntities('a &AMP; b &LT; c'), 'a & b < c');
  assert.equal(decodeEntities('a &AMP b'), 'a &AMP b');
  assert.equal(decodeEntities('a &AMP; b'), 'a & b');
  // The numeric reader keeps HTML's own case-insensitivity: '&#X' and either hex case.
  assert.equal(decodeEntities('a&#X200B;b'), 'a' + ZWSP + 'b');
  assert.equal(decodeEntities('a&#x200b;b'), 'a' + ZWSP + 'b');
});

test('verify F45-3: an empty-password pair is kept, as 0063439 kept it, and no credential publishes', () => {
  // 'uuu...:' is a printable 'userinfo:' with an EMPTY password; '==' padding follows it. The
  // incremental reader used to decode past the padding into the next ordinary word and remove the
  // blob; the ordinary-gap crossing now has to reach into the run after the gap, so the blob is
  // kept (over-removal only, and the direction that matches the rule's own reader).
  const empty = Buffer.from('u'.repeat(33) + ':').toString('base64');
  for (const [surface, text] of [['candidate', candidate('release: Basic ' + empty + ' end')],
    ['notice', notice('release: Basic ' + empty + ' end')]]) {
    assert.equal(text, 'release: Basic ' + empty + ' end',
      'the ' + surface + ' pass no longer matches 0063439 on the empty-password row');
  }
  // The credential direction is untouched: a real pair crossing ONE ordinary word gap still removes
  // (the batch's own reach is kept).
  const split = Buffer.from('alice:' + 's3cr3tp4' + 'ssw0rd').toString('base64');
  const first = split.slice(0, 8);
  const second = split.slice(8);
  for (const surface of ['candidate', 'notice']) {
    const out = surface === 'candidate' ? candidate('release: Basic ' + first + ' ' + second + ' and prose')
      : notice('release: Basic ' + first + ' ' + second + ' and prose');
    assert.ok(!squash(out).includes(split), 'the ' + surface + ' no longer joins a pair across one ordinary space');
  }
});
