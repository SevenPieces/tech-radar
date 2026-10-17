// tests/final46-closures.test.mjs
// THE FINAL46 PAIR'S STRUCTURAL GAP, CLOSED (Batch 106). The terminal pair
// (docs/hardening-2026-10-15/scratch-final46-verify/FINAL46-VERIFY-REPORT.md and
// scratch-final46-sweep/CLOSING46-SWEEP-REPORT.md) measured one gap left in the join model:
//   (a) F46-1 (High, the shipped keyless pool): the Basic join's longest-accepted walk was ENTERED
//       ONLY WHEN THE FIRST RUN FAILED, so a payload split AFTER a complete 'user:password' pair left
//       the separated view accepting the first base64 group and the rest of the stream published. The
//       real keyless pool's title and summary carried the base64 of the password's continuation
//       (198 decodable rows of the pair's 60-length matrix across 40 userinfo lengths). The walk is
//       entered UNCONDITIONALLY now, the separated view's accepted prefix is its INITIAL best, and the
//       removal ends at the LONGEST accepted payload across the split evidence.
//   (b) F46-1b (the curated-body and Bearer joins' same entry condition): 'ghp_<body>' split after the
//       rule's own minimum left the rest of the body published (22/16/4 body characters at 18/24/36);
//       the same unconditional entry and longest-span answer closes it.
//   (c) F46-2 (records): the entity comment's over-read list named 'VeryThinSpace' (a WHATWG name) and
//       omitted 'InvisibleSeparator'; the list and the derivation's counts are corrected in net.mjs.
//
// WHAT THE WALK MAY STILL CROSS. The ONE separator class has two halves: SPLIT EVIDENCE (a control
// byte, a default-ignorable, any non-ordinary whitespace spelling -- prose never writes one inside a
// word) and the ORDINARY WORD GAP (space, tab's siblings are evidence, but the space, the line ends
// and NEL are PROSE). The walk joins across the first half unconditionally, so no split position
// carries a fragment. Across the ordinary gap it must not extend a value the rule already accepted:
// the word after a complete credential is prose, and the same acceptance test would reap it (a
// complete payload followed by ' jw'-shaped letters decodes to a longer valid pair). That half is the
// run's recorded prose price (A-37 / D-24), pinned at the bottom of this file so a later change either
// way moves a row rather than passing silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  plainText, redactSecrets, redactCredentialShapes, renderSeparatorMarks,
  decodeSeparatorEntities, SCHEME_GAP_PATTERN,
} from '../scripts/lib/net.mjs';
import { collectAll, assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const SETTINGS = { ...readSettings(join(HERE, 'config', 'settings.md')), github_rate_limit_reserve: 2 };
const WINDOW = { since: '2026-09-01T00:00:00Z', until: '2026-09-30T00:00:00Z' };
const ZWSP = String.fromCodePoint(0x200b);
const CAPS = [128, 402, 1000];
const PASSWORD = 's3cr3tp4' + 'ssw0rd';
const SPLIT_EVIDENCE = [
  ['NUL', '\u0000'], ['TAB', '\t'], ['NBSP', '\u00a0'], ['ZWSP', ZWSP], ['SHY', '\u00ad'],
  ['WJ', '\u2060'], ['FEFF', '\ufeff'], ['U3164', '\u3164'],
];
const ORDINARY_GAP = [['SP', ' '], ['LF', '\n'], ['NEL', '\u0085']];
const candidate = (raw, limit = 400) => redactCredentialShapes(plainText(raw, limit));
const notice = (raw) => redactSecrets(raw, []);
const squash = (text) => {
  let out = '';
  for (const ch of String(text ?? '')) if (!SCHEME_GAP_PATTERN.test(ch)) out += ch;
  return out;
};
// The published surface's separator-stripped view holds a >=4-character contiguous slice of the
// secret's own base64 stream. That is the loosest reader a surface can hand the payload to, and it is
// the pair's own test (a fragment is a fragment whatever it decodes to).
const fragment = (text, encoded) => {
  const view = squash(text);
  for (let i = 0; i + 4 <= encoded.length; i += 1) {
    const part = encoded.slice(i);
    if (view.includes(part)) return part;
  }
  return null;
};
const surfaces = (raw) => [
  ['candidate400', candidate(raw, 400)],
  ['candidate200', candidate(raw, 200)],
  ['notice', notice(raw)],
  ['neutralised notice', renderSeparatorMarks(neutraliseNoticeText(notice(raw)))],
  ...CAPS.map((cap) => ['assembly@' + cap, assembleNotice('rss', raw, [], cap)]),
];
// The shipped keyless pool through the REAL collectAll, the pair's own harness.
let poolBody = '';
const poolFields = async (body) => {
  poolBody = body;
  const pool = await collectAll({ settings: SETTINGS, sources: [], domains: [],
    watchlist: [{ kind: 'github-repo', target: 'org/repo', domain: 'ai-llm', note: '' }] }, { ...WINDOW, net: {
    fetchText: async (url) => {
      if (url === 'https://api.github.com/rate_limit') {
        return JSON.stringify({ resources: { core: { limit: 60, remaining: 55, reset: 1790177128, used: 5 } } });
      }
      if (url.includes('/tags')) return '[]';
      if (url.includes('/releases')) {
        return JSON.stringify([{ tag_name: 'v1.0.0', html_url: 'https://github.com/org/repo/releases/tag/v1.0.0',
          published_at: '2026-09-21T10:00:00Z', draft: false, body: poolBody }]);
      }
      throw new Error('unexpected request: ' + url);
    },
  } });
  const out = [];
  for (const c of pool.candidates) for (const k of ['title', 'summary']) if (typeof c[k] === 'string') out.push([k, c[k]]);
  return out;
};
const basicRow = (userinfo, cut, sep) => {
  const payload = Buffer.from(userinfo + ':' + PASSWORD).toString('base64');
  return { payload, raw: 'release: Basic ' + payload.slice(0, cut) + sep + payload.slice(cut) + ' and prose' };
};

test('F46-1: the Basic walk is entered when the first run already decodes to a complete pair', async () => {
  // The pair's canonical rows: the separated view accepted the first base64 group as 'user:pass' and
  // the rest of the stream published (the tail decodes to the password's continuation). The cuts land
  // on whole base64 groups past the colon, which is exactly the family the first-run gate let through.
  const rows = [[1, 8], [1, 12], [1, 16], [2, 8], [4, 8], [7, 12], [46, 64]];
  for (const [u, cut] of rows) {
    const { payload, raw } = basicRow('u'.repeat(u), cut, ZWSP);
    const tail = payload.slice(cut);
    for (const [surface, text] of surfaces(raw)) {
      assert.equal(fragment(text, payload), null,
        'F46-1: the ' + surface + ' published a payload fragment for userinfo ' + u + ' cut ' + cut);
      assert.ok(!squash(text).includes(tail), 'F46-1: the ' + surface + ' published the tail directly');
    }
    // The uncapped rule paths carry the whole input and answer exactly as the unsplit rule does.
    assert.equal(notice(raw), 'release: Basic [redacted] and prose', 'F46-1: the notice pass kept a tail');
    assert.equal(candidate(raw, 1_000_000), 'release: Basic [redacted] and prose',
      'F46-1: the candidate pass kept a tail');
    // THE REAL KEYLESS POOL, both fields.
    const fields = await poolFields(raw);
    assert.ok(fields.length > 0, 'F46-1: the row produced no pool field');
    for (const [key, value] of fields) {
      assert.equal(fragment(value, payload), null,
        'F46-1: the shipped keyless pool ' + key + ' published a payload fragment');
      // The summary carries the release body; the title is the 'owner/repo vX' field the pool builds.
      if (key === 'summary') {
        assert.equal(value, 'release: Basic [redacted] and prose',
          'F46-1: the shipped keyless pool summary did not answer as the unsplit rule does');
      }
    }
  }
});

test('F46-1 property: NO split position escapes the walk, for every length and every evidence separator', () => {
  // The completeness argument, pinned: the walk is entered unconditionally, its initial best is the
  // separated view's accepted prefix, it reads EVERY run after it, and its acceptance is read at
  // every joined length to the end of the joined run -- so every split position is either before the
  // payload (the first run is not accepted and the walk reads on), inside it (the joined text is
  // tested), or after a complete pair (the first run's acceptance is the initial best and the walk
  // still reads the runs after it). The published text of EVERY cut is therefore byte-identical to
  // the unsplit rule's answer; there is no position left to escape.
  for (let length = 1; length <= 16; length += 1) {
    const userinfo = 'u'.repeat(length);
    const payload = Buffer.from(userinfo + ':' + PASSWORD).toString('base64');
    for (const [sepName, sep] of SPLIT_EVIDENCE) {
      for (let cut = 1; cut < payload.length; cut += 1) {
        const raw = 'release: Basic ' + payload.slice(0, cut) + sep + payload.slice(cut) + ' and prose';
        for (const [surface, text] of [['notice', notice(raw)], ['candidate rule, uncapped', candidate(raw, 1_000_000)]]) {
          assert.equal(text, 'release: Basic [redacted] and prose',
            'F46-1 property: the ' + surface + ' moved at length ' + length + ', ' + sepName + ' cut ' + cut);
        }
        for (const [surface, text] of surfaces(raw)) {
          const cap = /assembly@(\d+)/.exec(surface);
          if (raw.length > 400 && surface.startsWith('candidate')) continue;
          if (cap && raw.length > Number(cap[1])) continue;
          assert.equal(fragment(text, payload), null,
            'F46-1 property: the ' + surface + ' published a fragment at length ' + length + ', ' + sepName + ' cut ' + cut);
        }
      }
    }
  }
});

test('F46-1 property: the real keyless collectAll answers every length and split as the unsplit rule', async () => {
  for (const length of [1, 2, 4, 7, 16, 46]) {
    const payload = Buffer.from('u'.repeat(length) + ':' + PASSWORD).toString('base64');
    for (const [sepName, sep] of SPLIT_EVIDENCE.slice(0, 4)) {
      for (let cut = 1; cut < payload.length; cut += 1) {
        const raw = 'release: Basic ' + payload.slice(0, cut) + sep + payload.slice(cut) + ' and prose';
        for (const [key, value] of await poolFields(raw)) {
          assert.equal(fragment(value, payload), null,
            'F46-1 pool property: ' + key + ' published a fragment at length ' + length + ', ' + sepName + ' cut ' + cut);
          if (key === 'summary') {
            assert.equal(value, 'release: Basic [redacted] and prose',
              'F46-1 pool property: the summary moved at length ' + length + ', ' + sepName + ' cut ' + cut);
          }
        }
      }
    }
  }
});

test('F46-1b: the curated body and the Bearer value are joined when the first run passes the rule', async () => {
  const body = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const shapes = [['ghp_', body], ['github_pat_', body]];
  for (const [prefix, bodytext] of shapes) {
    for (const cut of [6, 8, 18, 20, 24, 30, 35]) {
      const raw = 'a commit carried ' + prefix + bodytext.slice(0, cut) + ZWSP + bodytext.slice(cut) + ' end';
      for (const [surface, text] of surfaces(raw)) {
        assert.equal(fragment(text, bodytext), null,
          'F46-1b: the ' + surface + ' published a body fragment for ' + prefix + ' cut ' + cut);
      }
      assert.equal(notice(raw), 'a commit carried [redacted] end',
        'F46-1b: the notice pass kept a body tail for ' + prefix + ' cut ' + cut);
      assert.equal(candidate(raw, 1_000_000), 'a commit carried [redacted] end',
        'F46-1b: the candidate pass kept a body tail for ' + prefix + ' cut ' + cut);
    }
  }
  // Every cut of both bodies, every evidence separator, through the shipped keyless pool.
  for (const [prefix, bodytext] of shapes) {
    for (const [sepName, sep] of SPLIT_EVIDENCE.slice(0, 4)) {
      for (let cut = 1; cut < bodytext.length; cut += 1) {
        const raw = 'a commit carried ' + prefix + bodytext.slice(0, cut) + sep + bodytext.slice(cut) + ' end';
        for (const [key, value] of await poolFields(raw)) {
          assert.equal(fragment(value, bodytext), null,
            'F46-1b pool: ' + key + ' kept a body fragment for ' + prefix + ' at ' + sepName + ' cut ' + cut);
          if (key === 'summary') {
            assert.equal(value, 'a commit carried [redacted] end',
              'F46-1b pool: the summary kept a body fragment for ' + prefix + ' at ' + sepName + ' cut ' + cut);
          }
        }
      }
    }
  }
  // The Bearer rule's own shape-test boundary: a value split after its first shaped run.
  for (const cut of [8, 12, 16]) {
    const value = 'abcdefg1hijklmnopqrstuvwx';
    const raw = 'release: Bearer ' + value.slice(0, cut) + ZWSP + value.slice(cut) + ' and prose';
    assert.equal(notice(raw), 'release: [redacted] and prose', 'F46-1b: the Bearer rule kept a value tail at cut ' + cut);
  }
});

test('F46-1: the unsplit rows and ordinary prose are byte-identical', () => {
  // The fix moves only the JOINED path: an unsplit payload, and prose that carries no credential,
  // must be byte-identical to the rule's own answer.
  for (const length of [1, 2, 4, 7, 46]) {
    const payload = Buffer.from('u'.repeat(length) + ':' + PASSWORD).toString('base64');
    const raw = 'release: Basic ' + payload + ' and prose';
    assert.equal(notice(raw), 'release: Basic [redacted] and prose', 'the unsplit notice row moved at length ' + length);
    assert.equal(candidate(raw, 1_000_000), 'release: Basic [redacted] and prose',
      'the unsplit candidate row moved at length ' + length);
  }
  for (const text of ['Basic authentication is used', 'the gateway uses Basic auth for the feed',
    'authorization: required for this feed', 'Bearer token1 is required',
    'the bearer credential held by the gateway is rotated weekly']) {
    assert.equal(notice(text), text, 'ordinary prose moved on the notice pass: ' + JSON.stringify(text));
    assert.equal(candidate(text, 1_000_000), text, 'ordinary prose moved on the candidate pass: ' + JSON.stringify(text));
  }
});

test('F46-1 recorded price: the ORDINARY word gap is the prose guard, not a split', () => {
  // Pinned so a later change either way moves this row rather than passing silently. A complete
  // payload followed by an ordinary gap is a credential followed by prose; the walk may not cross it,
  // because the same acceptance test that joins a split stream would reap the ordinary word after a
  // real payload (measured: the payload's own continuation is printable base64 letters as often as
  // not). The two halves of the one class therefore answer differently, and this is the recorded
  // A-37 / D-24 price, not a hole in the walk.
  const payload = Buffer.from('u:' + PASSWORD).toString('base64');
  const cut = 8;
  for (const [sepName, sep] of ORDINARY_GAP) {
    const raw = 'release: Basic ' + payload.slice(0, cut) + sep + payload.slice(cut) + ' and prose';
    assert.equal(notice(raw), 'release: Basic [redacted]' + sep + payload.slice(cut) + ' and prose',
      sepName + ': the recorded ordinary-gap bound moved (the notice no longer leaves the tail)');
    // The unsplit row on the same gap is unchanged: the ordinary word after a complete payload is not
    // part of the credential.
    assert.equal(notice('release: Basic ' + payload + ' and prose'), 'release: Basic [redacted] and prose',
      sepName + ': the unsplit row moved');
  }
});

test('F46-2: the entity table records its over-reads exactly (VeryThinSpace is WHATWG; InvisibleSeparator is not)', () => {
  // The corrected list: the five non-WHATWG spellings the table reads in exact case are
  // 'ZeroWidthJoiner', 'ZeroWidthNonJoiner', 'NoBreakSpace', 'InvisiblePlus' and 'InvisibleSeparator'.
  for (const name of ['ZeroWidthJoiner', 'ZeroWidthNonJoiner', 'NoBreakSpace', 'InvisiblePlus', 'InvisibleSeparator']) {
    const decoded = decodeSeparatorEntities('a&' + name + ';b');
    assert.ok(SCHEME_GAP_PATTERN.test(decoded[1]), '&' + name + '; did not resolve to a class member');
  }
  // 'VeryThinSpace;' is a WHATWG spelling (U+200A) and 'InvisibleSeparator;' is a name WHATWG does not
  // carry; both resolve here, the first as a member of the class, the second as its over-read value.
  for (const name of ['VeryThinSpace', 'InvisibleSeparator']) {
    const decoded = decodeSeparatorEntities('a&' + name + ';b');
    assert.equal(decoded, 'a\uE001b', '&' + name + '; did not resolve to the mark');
    assert.equal(renderSeparatorMarks(decoded), 'a b', '&' + name + '; did not render as a space');
  }
});
