// tests/final48-quoted-spellings.test.mjs
// THE QUOTED BASIC SPELLING'S TWO REMAINING HOLES (Batch 108; the closing sweep's F48-1 and F48-2).
//
// F48-1 (High; Batch 107's regression). The reader takes a gap after the opening quote as part of
// the token ('Basic " <base64>"'), but the token it returned omitted that gap. The caller's span was
// short by the gap, the joined walk's first run was EMPTY, its position table stayed empty, and its
// end was 'absoluteStart + positions[best - 1] + 2' = NaN. 'tokenEnd = Math.max(separatedEnd, NaN)'
// is NaN, the '-1' guard does not fire, and 'source.slice(NaN)' republishes the WHOLE source -- so
// one pass took a 52-character row to 127 characters, the passes compounded (427 / 1,627 / 6,427,
// about 3.95x each) and the 64-pass loop could not return. Measured before this batch: no answer in
// 5 s on the notice, the candidate pass, the assembly at every cap and the real keyless pool, on a
// row with no hostile byte (space, LF, CR, NEL, LS or PS after the opening quote). This block pins
// the closure: the token carries its internal gap, the walk returns a defined end (never NaN, and
// the caller refuses a non-finite one), and the termination bound below fails fast if a pass ever
// grows the text or runs away again.
//
// F48-2 (Medium; pre-existing at 99d0888 and 691d3de). The reader's quote was only the raw
// payload's literal first byte, so the JSON-escaped ('Basic \"<base64>\"'), doubled
// ('Basic ""<base64>""') and leading-backslash ('Basic \"<base64>') spellings were read by neither
// view and published the whole decoded credential on every surface and in both real-pool fields.
// The spelling is read as an opening/closing PAIR now, so all three are removed; ordinary prose that
// shows a backslash before a quote is unchanged.
//
// The byte-identity rows are the ones that must NOT move: the plain quoted spelling, closed and
// unclosed, unsplit and split at every cut, and the evidence-gap spellings. Their expected strings
// are the ones tests/final47-closures.test.mjs pins, so the published bytes are the same on both
// revisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOf, isDiscoveryOnly, plainText, redactSecrets, redactCredentialShapes, renderSeparatorMarks,
  SCHEME_GAP_PATTERN,
} from '../scripts/lib/net.mjs';
import { assembleNotice, collectAll, neutraliseNoticeText } from '../scripts/collect.mjs';

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
// The shipped keyless pool: an RSS item whose title and description BOTH carry the row, read
// through the real collectAll, so the two published fields are the pool's own.
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

// F48-1's hostile rows: the payload is preceded by an ORDINARY separator inside the quotes -- the
// separator that made the walk's end NaN and the pass loop non-terminating -- in both states, both
// quote characters, and at several widths. The last two split the payload after that gap, so the
// internal gap and the split evidence are read together.
const ORDINARY_GAP_ROWS = [
  ['space after the quote, closed', 'release: Basic " ' + PAYLOAD + '" and prose'],
  ['two spaces after the quote, closed', 'release: Basic "  ' + PAYLOAD + '" and prose'],
  ['eight spaces after the quote, closed', 'release: Basic "' + ' '.repeat(8) + PAYLOAD + '" and prose'],
  ['LF after the quote, closed', 'release: Basic "\n' + PAYLOAD + '" and prose'],
  ['CR after the quote, closed', 'release: Basic "\r' + PAYLOAD + '" and prose'],
  ['NEL after the quote, closed', 'release: Basic "\u0085' + PAYLOAD + '" and prose'],
  ['LS after the quote, closed', 'release: Basic "\u2028' + PAYLOAD + '" and prose'],
  ['PS after the quote, closed', 'release: Basic "\u2029' + PAYLOAD + '" and prose'],
  ['space after the quote, unclosed', 'release: Basic " ' + PAYLOAD + ' and prose'],
  ['LF after the quote, unclosed', 'release: Basic "\n' + PAYLOAD + ' and prose'],
  ['single quote + space, closed', "release: Basic ' " + PAYLOAD + "' and prose"],
  ['single quote + space, unclosed', "release: Basic ' " + PAYLOAD + ' and prose'],
  ['space after the quote, payload split by ZWSP, closed', 'release: Basic " ' + PAYLOAD.slice(0, 8) + ZWSP + PAYLOAD.slice(8) + '" and prose'],
  ['tab after the quote, payload split by ZWSP, closed', 'release: Basic "\t' + PAYLOAD.slice(0, 8) + ZWSP + PAYLOAD.slice(8) + '" and prose'],
];
// F48-2's rows: the quote is escaped by a backslash or doubled, at both ends (closed) or only at
// the front (the leading-backslash form), for both quote characters.
const ESCAPED_DOUBLED_ROWS = [
  ['JSON-escaped, closed, double quote', 'release: Basic \\"' + PAYLOAD + '\\" and prose'],
  ['JSON-escaped, unclosed, double quote', 'release: Basic \\"' + PAYLOAD + ' and prose'],
  ['doubled, closed, double quote', 'release: Basic ""' + PAYLOAD + '"" and prose'],
  ['doubled, unclosed, double quote', 'release: Basic ""' + PAYLOAD + ' and prose'],
  ['doubled, closed, single quote', "release: Basic ''" + PAYLOAD + "'' and prose"],
  ['doubled, unclosed, single quote', "release: Basic ''" + PAYLOAD + ' and prose'],
  ['backslash, closed, single quote', "release: Basic \\'" + PAYLOAD + "\\' and prose"],
  ['backslash, unclosed, single quote', "release: Basic \\'" + PAYLOAD + ' and prose'],
  ['JSON-escaped with an internal space, closed', 'release: Basic \\" ' + PAYLOAD + '\\" and prose'],
  ['JSON-escaped, payload split by ZWSP, closed', 'release: Basic \\"' + PAYLOAD.slice(0, 8) + ZWSP + PAYLOAD.slice(8) + '\\" and prose'],
];

test('F48-1: a quoted spelling with an ordinary separator inside the quotes is read on every surface and in both pool fields', async () => {
  for (const [name, raw] of ORDINARY_GAP_ROWS) {
    for (const [surface, text] of surfaces(raw)) {
      assert.equal(fragment(text, PAYLOAD), null,
        'F48-1: the ' + surface + ' published the payload for the ' + name + ' row');
    }
    assert.equal(redactSecrets(raw, []), CLEAN, 'F48-1: the notice pass did not remove the ' + name + ' row whole');
    assert.equal(redactCredentialShapes(raw), CLEAN, 'F48-1: the candidate pass did not remove the ' + name + ' row whole');
    for (const [field, value] of await poolFields(raw)) {
      assert.equal(fragment(value, PAYLOAD), null,
        'F48-1: the shipped keyless pool ' + field + ' published the payload for the ' + name + ' row');
      assert.equal(value, CLEAN, 'F48-1: the shipped keyless pool ' + field + ' did not remove the ' + name + ' row whole');
    }
  }
});

test('F48-2: the escaped, doubled and leading-backslash quoted spellings are read on every surface and in both pool fields', async () => {
  for (const [name, raw] of ESCAPED_DOUBLED_ROWS) {
    for (const [surface, text] of surfaces(raw)) {
      assert.equal(fragment(text, PAYLOAD), null,
        'F48-2: the ' + surface + ' published the payload for the ' + name + ' row');
    }
    assert.equal(redactSecrets(raw, []), CLEAN, 'F48-2: the notice pass did not remove the ' + name + ' row whole');
    assert.equal(redactCredentialShapes(raw), CLEAN, 'F48-2: the candidate pass did not remove the ' + name + ' row whole');
    for (const [field, value] of await poolFields(raw)) {
      assert.equal(fragment(value, PAYLOAD), null,
        'F48-2: the shipped keyless pool ' + field + ' published the payload for the ' + name + ' row');
      assert.equal(value, CLEAN, 'F48-2: the shipped keyless pool ' + field + ' did not remove the ' + name + ' row whole');
    }
  }
});

// THE TERMINATION BOUND (F48-1's third requirement), wall-clock-free. Every redaction pass scans
// the text it is handed with 'matchAll', and the module's own contract is that a re-application only
// replaces characters with the sentinel, so the text NEVER GROWS: a converged redaction scans it at
// most 32 times (measured: a row that removes in one pass takes 6 scans, a row that needs two takes
// 11, and the maximum scanned length is the input's own length). The pre-fix revision grew the text
// about 3.95x per pass and needed the whole 64-pass loop, so it tripped both counters on its second
// pass -- and because the counters throw from inside the scan, it fails HERE instead of hanging the
// test run. A non-terminating pass cannot come back silently.
const SCAN_BOUND = 32;
const GROWTH_SLACK = 32;
function boundedRedaction(input, run) {
  const original = RegExp.prototype[Symbol.matchAll];
  const length = String(input).length;
  let scans = 0;
  RegExp.prototype[Symbol.matchAll] = function (string) {
    const text = String(string);
    scans += 1;
    if (scans > SCAN_BOUND) {
      throw new Error('the redaction did not converge: more than ' + SCAN_BOUND + ' scans (a pass is running away)');
    }
    if (text.length > length + GROWTH_SLACK) {
      throw new Error('a redaction pass GREW the text from ' + length + ' to ' + text.length
        + ' characters: the pass is not terminating');
    }
    return original.call(this, string);
  };
  try { return run(); } finally { RegExp.prototype[Symbol.matchAll] = original; }
}
test('F48-1: every hostile quoted shape terminates inside a small scan bound and never grows the text', () => {
  const rows = [...ORDINARY_GAP_ROWS, ...ESCAPED_DOUBLED_ROWS.map(([name, raw]) => ['F48-2 ' + name, raw])];
  for (const [name, raw] of rows) {
    const notice = boundedRedaction(raw, () => redactSecrets(raw, []));
    const candidate = boundedRedaction(raw, () => redactCredentialShapes(raw));
    assert.equal(notice, CLEAN, 'the bounded notice pass did not remove the ' + name + ' row whole');
    assert.equal(candidate, CLEAN, 'the bounded candidate pass did not remove the ' + name + ' row whole');
  }
  // The controls must keep their small bounds too: an ordinary sentence takes one pass.
  for (const prose of ['the gateway uses Basic "auth" for the feed', 'the word Basic \\" is a quoted backslash and prose']) {
    assert.equal(boundedRedaction(prose, () => redactSecrets(prose, [])), prose,
      'a prose control moved inside the bounded pass');
  }
});

test('F48: the plain quoted spelling, closed and unclosed, unsplit and split, is byte-identical', () => {
  // Unsplit: the two revisions publish the same bytes (the F47 block pins the same CLEAN rows).
  for (const quote of ['"', "'"]) {
    assert.equal(redactSecrets('release: Basic ' + quote + PAYLOAD + quote + ' and prose', []), CLEAN,
      'the closed unsplit spelling moved, ' + JSON.stringify(quote));
    assert.equal(redactCredentialShapes('release: Basic ' + quote + PAYLOAD + quote + ' and prose'), CLEAN,
      'the closed unsplit spelling moved on the candidate pass, ' + JSON.stringify(quote));
    assert.equal(redactSecrets('release: Basic ' + quote + PAYLOAD + ' and prose', []), CLEAN,
      'the unclosed unsplit spelling moved, ' + JSON.stringify(quote));
    assert.equal(redactCredentialShapes('release: Basic ' + quote + PAYLOAD + ' and prose'), CLEAN,
      'the unclosed unsplit spelling moved on the candidate pass, ' + JSON.stringify(quote));
  }
  // Split at every cut, across three evidence separators, closed and unclosed (F47's property, kept
  // here as the byte-identity row: the answer is the CLEAN line for every one of them).
  for (const quote of ['"', "'"]) {
    for (const sep of [ZWSP, '\u00a0', '\u0000']) {
      for (let cut = 1; cut < PAYLOAD.length; cut += 1) {
        for (const state of ['closed', 'unclosed']) {
          const raw = 'release: Basic ' + quote + PAYLOAD.slice(0, cut) + sep + PAYLOAD.slice(cut)
            + (state === 'closed' ? quote : '') + ' and prose';
          assert.equal(redactSecrets(raw, []), CLEAN,
            'the ' + state + ' split spelling moved at cut ' + cut + ' ' + JSON.stringify(quote) + ' ' + JSON.stringify(sep));
        }
      }
    }
  }
  // The evidence-gap spellings after the opening quote (TAB and FEFF are split evidence) are
  // unchanged by this batch's internal-gap reading.
  for (const gap of ['\t', '\ufeff', ZWSP, '\u00a0']) {
    assert.equal(redactSecrets('release: Basic "' + gap + PAYLOAD + '" and prose', []), CLEAN,
      'the closed evidence-gap spelling moved for ' + JSON.stringify(gap));
    assert.equal(redactSecrets('release: Basic "' + gap + PAYLOAD + ' and prose', []), CLEAN,
      'the unclosed evidence-gap spelling moved for ' + JSON.stringify(gap));
  }
  // A space BEFORE the closing quote is not the internal-gap spelling: the payload is read and the
  // orphan quote stays, exactly as before.
  assert.equal(redactSecrets('release: Basic "' + PAYLOAD + ' " and prose', []), 'release: Basic [redacted] " and prose',
    'the space-before-the-closing-quote row moved');
  assert.equal(redactSecrets("release: Basic '" + PAYLOAD + " ' and prose", []), "release: Basic [redacted] ' and prose",
    'the space-before-the-closing-quote row moved for the single quote');
});

test('F48: ordinary prose with quotes or a backslash before a quote is byte-identical on both entry points', () => {
  const prose = [
    'release: Basic "note about the build and prose',
    "release: Basic 'note about the build and prose",
    'the gateway uses Basic "auth" for the feed',
    'the "release note" is quoted and Basic authentication is used',
    'Basic authentication is used',
    'authorization: required for this feed',
    'Bearer token1 is required',
    'the gateway quoted the "docs" page',
    'the word Basic \\" is a quoted backslash and prose',
    'he wrote \\"quoted\\" and then used Basic auth',
    'Basic ""quoted"" is a doubled quote in prose',
    "Basic ''quoted'' is a doubled single quote in prose",
    'a release note with a \\" in it',
  ];
  for (const text of prose) {
    assert.equal(redactSecrets(text, []), text, 'ordinary prose moved on the notice pass: ' + JSON.stringify(text));
    assert.equal(redactCredentialShapes(text), text, 'ordinary prose moved on the candidate pass: ' + JSON.stringify(text));
  }
  // The removed rows are fixed points: re-redacting a published line rewrites nothing.
  for (const raw of [...ORDINARY_GAP_ROWS, ...ESCAPED_DOUBLED_ROWS].map(([, row]) => row)) {
    const once = redactSecrets(raw, []);
    assert.equal(redactSecrets(once, []), once, 'the published row is not a fixed point: ' + JSON.stringify(raw));
    assert.equal(redactCredentialShapes(once), once, 'the published row is not a candidate fixed point: ' + JSON.stringify(raw));
  }
});
