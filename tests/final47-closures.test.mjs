// tests/final47-closures.test.mjs
// THE QUOTED BASIC SPELLING, CLOSED AND UNCLOSED (Batch 107).
//
// The quoted Basic spelling was read whole or not at all: the separated view required the closing
// quote right after the candidate and the joined walk required it right after the payload, so a
// quoted spelling whose CLOSING QUOTE IS ABSENT was read by neither. The whole base64 credential --
// decoded to 'user:password' -- published on the candidate field, the notice, the neutralised
// notice, the assembly at every accepted cap and the real keyless pool's title and summary. The
// module's own sentence for the sibling authorization reader states that an unterminated quote left
// where it stands publishes the credential; the Basic reader takes that reading now: the payload
// after the opening quote is read at the lengths the closed spelling reads, the walk reads it across
// split evidence, and the span removed carries the opening quote with the payload.
//
// The same block pins the CLOSED spelling's removal span. The walk returned one character short of
// 'body' (= raw.slice(1)) and left the closing quote standing at every split position
// ('Basic [redacted]"'), while its comment claimed the span carried the quote; the span now carries
// the quote, and the unsplit closed spelling (served by the separated view) is byte-identical.
//
// The recorded rows at the bottom are the price of the unconditional entry, pinned so a later change
// either way moves a row instead of passing silently: an ordinary word after a COMPLETE curated body
// across split evidence is reaped (over-removal, no publication), while the same word after an
// ordinary gap is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hostOf, isDiscoveryOnly, plainText, redactSecrets, redactCredentialShapes, renderSeparatorMarks,
  SCHEME_GAP_PATTERN,
} from '../scripts/lib/net.mjs';
import { assembleNotice, collectAll, neutraliseNoticeText } from '../scripts/collect.mjs';
import { readDomains } from '../scripts/lib/mdtable.mjs';
import { render } from '../scripts/render-html.mjs';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const ZWSP = '\u200b';
const PAYLOAD = Buffer.from('u:' + 's3cr3tp4' + 'ssw0rd').toString('base64');
const CLEAN = 'release: Basic [redacted] and prose';
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const SETTINGS = {
  user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
  error_snippet_max_chars: 200, notice_max_chars: 402, request_timeout_ms: 20000,
  github_rate_limit_reserve: 2,
};
const NET = (fetchText) => ({ fetchText, hostOf, isDiscoveryOnly });
const feed = (text) => '<rss><channel><item><title>' + text + '</title>'
  + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
  + '<description>' + text + '</description></item></channel></rss>';
const squash = (text) => {
  let out = '';
  for (const ch of String(text ?? '')) if (!SCHEME_GAP_PATTERN.test(ch)) out += ch;
  return out;
};
const fragment = (text, encoded) => {
  const view = squash(text);
  for (let i = 0; i + 4 <= encoded.length; i += 1) if (view.includes(encoded.slice(i))) return encoded.slice(i);
  return null;
};
const surfaces = (raw) => [
  ['candidate@400', redactCredentialShapes(plainText(raw, 400))],
  ['candidate@200', redactCredentialShapes(plainText(raw, 200))],
  ['notice', redactSecrets(raw, [])],
  ['neutralised notice', renderSeparatorMarks(neutraliseNoticeText(redactSecrets(raw, [])))],
  ['assembly@128', assembleNotice('rss', raw, [], 128)],
  ['assembly@402', assembleNotice('rss', raw, [], 402)],
  ['assembly@1000', assembleNotice('rss', raw, [], 1000)],
  ['candidate pass, uncapped', redactCredentialShapes(raw)],
  ['shaper, uncapped', redactSecrets(raw, [])],
];
// The shipped keyless pool: an RSS item whose title and description BOTH carry the row, read through
// the real collectAll. The two fields are the pool's own published title and summary.
const poolFields = async (text) => {
  const pool = await collectAll(
    { settings: SETTINGS, watchlist: [{ kind: 'rss', target: 'https://feeds.example/feed.xml', domain: 'languages-runtimes', note: '' }] },
    { ...WINDOW, net: NET(async () => feed(text)) },
  );
  const out = [];
  for (const candidate of pool.candidates) {
    for (const key of ['title', 'summary']) if (typeof candidate[key] === 'string') out.push([key, candidate[key]]);
  }
  return out;
};
const quoted = (state, quote, payload, tail = ' and prose') => 'release: Basic ' + quote
  + payload + (state === 'closed' ? quote : '') + tail;

test('F47-1: the unclosed quoted Basic spelling is read on every surface and in both pool fields', async () => {
  const rows = [
    ['double quote, unsplit', quoted('unclosed', '"', PAYLOAD)],
    ['single quote, unsplit', quoted('unclosed', "'", PAYLOAD)],
    ['double quote, split', quoted('unclosed', '"', PAYLOAD.slice(0, 8) + ZWSP + PAYLOAD.slice(8))],
    ['single quote, split', quoted('unclosed', "'", PAYLOAD.slice(0, 8) + ZWSP + PAYLOAD.slice(8))],
    ['double quote, end of line', 'release: Basic "' + PAYLOAD],
    ['single quote, end of line', "release: Basic '" + PAYLOAD],
  ];
  for (const [name, raw] of rows) {
    const expected = raw.endsWith(' and prose') ? CLEAN : 'release: Basic [redacted]';
    for (const [surface, text] of surfaces(raw)) {
      assert.equal(fragment(text, PAYLOAD), null,
        'F47-1: the ' + surface + ' published the payload for the ' + name + ' row');
    }
    assert.equal(redactSecrets(raw, []), expected, 'F47-1: the notice pass moved for the ' + name + ' row');
    assert.equal(redactCredentialShapes(raw), expected, 'F47-1: the candidate pass moved for the ' + name + ' row');
    for (const [field, value] of await poolFields(raw)) {
      assert.equal(fragment(value, PAYLOAD), null,
        'F47-1: the shipped keyless pool ' + field + ' published the payload for the ' + name + ' row');
      assert.equal(value, expected, 'F47-1: the shipped keyless pool ' + field + ' moved for the ' + name + ' row');
    }
  }
});

test('F47-1 property: every userinfo, cut, quote and split position is removed whole', () => {
  for (let length = 1; length <= 6; length += 1) {
    const payload = Buffer.from('u'.repeat(length) + ':' + 's3cr3tp4' + 'ssw0rd').toString('base64');
    for (const quote of ['"', "'"]) {
      for (const state of ['closed', 'unclosed']) {
        for (const sep of [ZWSP, '\u00a0', '\u0000']) {
          for (let cut = 1; cut < payload.length; cut += 1) {
            const raw = 'release: Basic ' + quote + payload.slice(0, cut) + sep + payload.slice(cut)
              + (state === 'closed' ? quote : '') + ' and prose';
            for (const [surface, text] of [['notice', redactSecrets(raw, [])], ['candidate', redactCredentialShapes(raw)]]) {
              assert.equal(fragment(text, payload), null,
                'F47-1 property: the ' + surface + ' published a fragment at length ' + length + ', '
                + state + ' ' + JSON.stringify(quote) + ', cut ' + cut);
            }
          }
        }
      }
    }
  }
});

test('F47-4: the closed quoted split removes its closing quote at every position', () => {
  for (const quote of ['"', "'"]) {
    for (let cut = 1; cut < PAYLOAD.length; cut += 1) {
      const raw = 'release: Basic ' + quote + PAYLOAD.slice(0, cut) + ZWSP + PAYLOAD.slice(cut) + quote + ' and prose';
      for (const [surface, text, expected] of [['notice', redactSecrets(raw, []), CLEAN],
        ['candidate', redactCredentialShapes(raw), CLEAN],
        ['assembly@402', assembleNotice('rss', raw, [], 402), 'rss: ' + CLEAN]]) {
        assert.equal(text, expected,
          'F47-4: the ' + surface + ' left the closing quote or a payload byte at cut ' + cut + ', ' + JSON.stringify(quote));
      }
    }
    // The unsplit closed spelling is the separated view's answer and is byte-identical.
    assert.equal(redactSecrets('release: Basic ' + quote + PAYLOAD + quote + ' and prose', []), CLEAN,
      'F47-4: the unsplit closed spelling moved, ' + JSON.stringify(quote));
  }
});

test('F47-1: ordinary prose with an unmatched quote, and every pinned prose row, is byte-identical', () => {
  const prose = [
    'release: Basic "note about the build and prose',
    "release: Basic 'note about the build and prose",
    'the gateway uses Basic "auth" for the feed',
    'the "release note" is quoted and Basic authentication is used',
    'Basic authentication is used',
    'authorization: required for this feed',
    'Bearer token1 is required',
    'the gateway quoted the "docs" page',
  ];
  for (const text of prose) {
    assert.equal(redactSecrets(text, []), text, 'ordinary prose moved on the notice pass: ' + JSON.stringify(text));
    assert.equal(redactCredentialShapes(text), text, 'ordinary prose moved on the candidate pass: ' + JSON.stringify(text));
  }
  // The removed rows are fixed points: re-redacting a published line rewrites nothing.
  for (const raw of [quoted('unclosed', '"', PAYLOAD), quoted('closed', '"', PAYLOAD),
    quoted('unclosed', "'", PAYLOAD.slice(0, 8) + ZWSP + PAYLOAD.slice(8)),
    quoted('closed', "'", PAYLOAD.slice(0, 8) + ZWSP + PAYLOAD.slice(8))]) {
    const once = redactSecrets(raw, []);
    assert.equal(redactSecrets(once, []), once, 'the published row is not a fixed point: ' + JSON.stringify(raw));
    assert.equal(redactCredentialShapes(once), once, 'the published row is not a candidate fixed point');
  }
});

test('F47-3 recorded price: an ordinary word after a COMPLETE curated body across evidence is reaped', () => {
  // The unconditional entry closes a body split after the rule's own minimum. The same acceptance
  // that joins a split body joins the word after a COMPLETE one across split evidence, and the
  // separator cannot tell the two apart (a surface split and a word after a value are the same
  // character). Direction: over-removal only, no credential is published, and no line of the shipped
  // corpus carries the spelling. Across an ordinary word gap the previous revision's answer stands.
  const body = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const complete = 'a commit carried ghp_' + body + ZWSP + 'fix landed';
  assert.equal(redactSecrets(complete, []), 'a commit carried [redacted] landed',
    'F47-3: the recorded over-removal moved (the word after a complete body across evidence is reaped)');
  const spaced = 'a commit carried ghp_' + body + ' fix landed';
  assert.equal(redactSecrets(spaced, []), 'a commit carried [redacted] fix landed',
    'F47-3: the ordinary word gap no longer keeps the word after a complete body');
  const bearer = 'release: Bearer abcdefg1\u00a0fix and prose';
  assert.equal(redactSecrets(bearer, []), 'release: [redacted] and prose',
    'F47-3: the Bearer half of the recorded over-removal moved');
  // The row the unconditional entry exists for still answers whole: a body split after the minimum.
  const split = 'a commit carried ghp_' + 'abcdefgh' + ZWSP + 'ijklmnop end';
  assert.equal(redactSecrets(split, []), 'a commit carried [redacted] end',
    'F47-3: the split-after-minimum row (the unconditional entry) published a body tail');
});

test('F47-5: the renderer spaces the module\'s Default_Ignorable class, and the example is byte-identical', () => {
  const example = readFileSync(join(HERE, 'examples', 'sample-digest.md'), 'utf8');
  const domains = { domains: readDomains(join(HERE, 'config', 'domains.md')) };
  assert.equal(render(example, domains), readFileSync(join(HERE, 'examples', 'sample-digest.html'), 'utf8'),
    'the shipped example no longer renders byte-identically');
  // The members a hand list missed, one at a time, through the shipped renderer.
  const members = [0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x2065, 0xffa0,
    0x1bca0, 0x1bca1, 0x1bca2, 0x1bca3, 0x1d173, 0x1d17a];
  const lines = example.split('\n');
  const at = lines.findIndex((line) => /Coverage/i.test(line));
  assert.ok(at !== -1, 'the shipped example carries no Coverage note to inject into');
  for (const cp of members) {
    const ch = String.fromCodePoint(cp);
    const injected = lines.slice();
    injected[at] = lines[at] + ' ' + ch;
    const html = render(injected.join('\n'), domains);
    assert.ok(!html.includes(ch), 'F47-5: U+' + cp.toString(16).toUpperCase() + ' reached the .html');
  }
});
