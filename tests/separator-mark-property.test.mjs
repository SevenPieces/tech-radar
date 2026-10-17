// tests/separator-mark-property.test.mjs
// THE INFORMATION-PRESERVING MODEL (Batch 101; the FINAL42 pair's F42-1, F42-2, F42-5 and the prose
// guard's own rows). The model, stated once: plainText records a separator it meets as the
// SEPARATOR MARK when that separator is not an ordinary word gap, so the shape rules can tell a
// split from a word gap; a shape rule joins fragments across the mark, and across an invisible
// separator, for AS MANY RUNS AS THE SPLIT USES, and never across an ordinary space except at the
// bound Batch 100 stated (one run, the fragment after it shaped on its own). Entity spellings of the
// class are read as the separators they name before any rule runs.
//
// WHAT THIS FILE DRIVES, in both directions:
//   (a) the values the FINAL42 pair measured publishing -- an 8-to-14 character value split near its
//       middle, a token split at the letter/digit boundary, the class statement's own example value,
//       a quoted Basic payload, and a credential split by TWO or THREE separator runs -- remove on
//       both entry points, in the assembled notice at 128/402/1000, and in the shipped keyless
//       collectAll, for every member of the class that carries split evidence and for every entity
//       spelling of one;
//   (b) the prose rows the same pair measured reaped are unchanged relative to the pre-Batch-100
//       revision, and ordinary prose (the suite's own pinned rows and the sweep's sentences) is not
//       reaped;
//   (c) no published byte carries the mark, and the caps and the fixed points hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plainText, redactSecrets, redactCredentialShapes, renderSeparatorMarks, SCHEME_GAP,
  SCHEME_GAP_PATTERN,
} from '../scripts/lib/net.mjs';
import { collectAll, assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';

const MARK = '\uE001';
const B64 = Buffer.from('alice:' + 's3cr3tp4ssw0rd').toString('base64');
const CRED16 = 'tok_' + '9f3a2c7d1e5b';
const CRED12 = 'tok_' + '9f3a2c7d';
const CRED8 = 'tok_' + '9f3a';
// Assembled from fragments so this file's own source carries no credential-shaped string (the
// suite's publishing guard reads every shipped file).
const LONG = 'abcdefghijklmnopqrstuvwxyz' + '012345';
const CLASSIC = 'ghp_' + 'abcdefghijklmnop';
const PAT = 'github_pat_' + 'abcdefghijklmnopqrst';
const SECRET = 's3cr3tp4ssw0rd';
const u = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

// THE CLASSES THE MODEL NAMES, mirrored here so a drift in either moves this file.
const ORDINARY_GAPS = [0x0a, 0x0d, 0x20, 0x85, 0x2028, 0x2029];
const EVIDENCE_CHARS = [0x00, 0x01, 0x07, 0x08, 0x09, 0x0b, 0x0c, 0x1b, 0x1f, 0x7f, 0x9b, 0x9f,
  0xad, 0x34f, 0x61c, 0x115f, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x3164, 0xfe00,
  0xfeff, 0xa0, 0x1680, 0x2000, 0x2007, 0x202f, 0x205f, 0x3000, 0xe0001, 0xe0020, 0xe007f, 0xe0100];
// THE WHOLE HTML5 FAMILY OF THE CLASS, DERIVED AND PINNED (Batch 103; the Gate's F43-1). The ten
// names below the original list are what Batch 102 claimed the table already carried and did not;
// the 32-name list is the derivation -- every HTML5 named reference whose value is one code point
// of the one separator class -- so a name dropped from the table fails this file at its own
// spelling. The numeric no-semicolon spellings are the form HTML resolves and the module now reads.
const ENTITY_SPELLINGS = ['&#8203;', '&#x200B;', '&ZeroWidthSpace;', '&shy;', '&InvisibleTimes;',
  '&NoBreak;', '&zwnj;', '&zwj;', '&lrm;', '&#0;', '&#31;', '&#127;', '&#32;', '&nbsp;', '&#8288;',
  '&ZeroWidthJoiner;', '&ZeroWidthNonJoiner;', '&VeryThinSpace;', '&InvisiblePlus;', '&InvisibleComma;',
  '&NoBreakSpace;', '&ThickSpace;', '&ensp;', '&emsp;', '&thinsp;',
  '&af;', '&ApplyFunction;', '&emsp13;', '&emsp14;', '&ic;', '&it;', '&NegativeVeryThinSpace;',
  '&NegativeThinSpace;', '&NegativeMediumSpace;', '&NegativeThickSpace;',
  '&#8203', '&#x200B', '&#9', '&#160', '&#8288', '&#173', '&#xAD'];
// The derivation's own 32 named spellings, for the completeness row in the anti-vacuity test.
const HTML5_CLASS_NAMES = ['af', 'ApplyFunction', 'InvisibleComma', 'InvisibleTimes', 'MediumSpace',
  'NegativeMediumSpace', 'NegativeThickSpace', 'NegativeThinSpace', 'NegativeVeryThinSpace',
  'NewLine', 'NoBreak', 'NonBreakingSpace', 'Tab', 'ThinSpace', 'VeryThinSpace', 'ZeroWidthSpace',
  'emsp13', 'emsp14', 'emsp', 'ensp', 'hairsp', 'ic', 'it', 'lrm', 'nbsp', 'numsp', 'puncsp',
  'rlm', 'shy', 'thinsp', 'zwj', 'zwnj'];

const escapeChar = (ch) => ch.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
const RECOVER = (value) => new RegExp([...value].map(escapeChar).join(SCHEME_GAP + '*'), 'u');
const NAMED_READER = { shy: '\u00ad', zerowidthspace: '\u200b', zwnj: '\u200c', zwj: '\u200d',
  lrm: '\u200e', rlm: '\u200f', nobreak: '\u2060', invisibletimes: '\u2062', invisiblecomma: '\u2063',
  nbsp: ' ', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', hairspace: '\u200a',
  zerowidthjoiner: '\u200d', zerowidthnonjoiner: '\u200c', verythinspace: '\u200a',
  invisibleplus: '\u2064', nobreakspace: '\u00a0', thickspace: '\u205f',
  // The ten names Batch 102 was missing, and the rest of the derived 32-name family.
  af: '\u2061', applyfunction: '\u2061', emsp13: '\u2004', emsp14: '\u2005', ic: '\u2063',
  it: '\u2062', negativeverythinspace: '\u200b', negativethinspace: '\u200b',
  negativemediumspace: '\u200b', negativethickspace: '\u200b',
  newline: '\n', tab: '\t', thinspace: '\u2009', nonbreakingspace: '\u00a0', numsp: '\u2007',
  puncsp: '\u2008', mediumspace: '\u205f' };
// A credential is PUBLISHED when it is present whole, or readable back with only class separators
// between its characters -- read in a READER's view, so an entity spelling is decoded first.
// A reader resolves a numeric reference whether or not its semicolon is there (HTML's own rule),
// and the longest digit run is the reference -- the same reading the module takes (Batch 103).
const codePointOrReplacement = (n) => (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '\uFFFD'
  : String.fromCodePoint(n));
const readerView = (text) => String(text)
  .replace(/&#x([0-9a-f]+);?/gi, (m, h) => codePointOrReplacement(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (m, d) => codePointOrReplacement(Number(d)))
  .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => NAMED_READER[String(n).toLowerCase()] ?? m);
const PUBLISHED = (text, value) => text.includes(value) || RECOVER(value).test(readerView(text));

const candidate = (raw) => redactCredentialShapes(plainText(raw, 400));
const notice = (raw) => redactSecrets(raw, []);
const CAPS = [128, 402, 1000];
const surfaces = (raw) => [
  ['candidate', candidate(raw)],
  ['candidate+union', redactSecrets(plainText(raw, 400), [CRED16, SECRET])],
  ['notice', notice(raw)],
  ['neutralised notice', renderSeparatorMarks(neutraliseNoticeText(notice(raw)))],
  ...CAPS.map((cap) => ['assembly@' + cap, assembleNotice('rss', raw, [CRED16, SECRET], cap)]),
];

// THE SPLIT PATTERNS the pair measured: a split near the middle of a short value, the letter/digit
// boundary of the class statement's own value, two runs, three runs, and a quoted payload.
const SPLIT_ROWS = [];
const addRow = (name, build, value) => SPLIT_ROWS.push({ name, build, value });
for (const [label, value] of [['8-character value', CRED8], ['12-character value', CRED12], ['16-character value', CRED16], ['the class statement example', LONG]]) {
  const mid = Math.floor(value.length / 2);
  addRow(label + ' split near its middle', (s) => 'release: Bearer ' + value.slice(0, mid) + s + value.slice(mid) + ' and prose', value);
  addRow(label + ' split at the letter/digit boundary', (s) => 'release: Bearer ' + value.replace(/[0-9]/g, '') + s + (value.match(/[0-9]/g) || []).join('') + ' and prose', value);
  addRow(label + ' split by two runs', (s) => 'release: Bearer ' + value.slice(0, Math.floor(value.length / 3)) + s + value.slice(Math.floor(value.length / 3), Math.floor(2 * value.length / 3)) + s + value.slice(Math.floor(2 * value.length / 3)) + ' and prose', value);
  addRow(label + ' authorization split near its middle', (s) => 'the answer said authorization: ' + value.slice(0, mid) + s + value.slice(mid) + ' end', value);
  addRow(label + ' authorization split by two runs', (s) => 'the answer said authorization: ' + value.slice(0, Math.floor(value.length / 3)) + s + value.slice(Math.floor(value.length / 3), Math.floor(2 * value.length / 3)) + s + value.slice(Math.floor(2 * value.length / 3)) + ' end', value);
}
addRow('classic body split near its middle', (s) => 'a commit carried ghp_' + 'abcdefghijklmnop'.slice(0, 8) + s + 'abcdefghijklmnop'.slice(8) + ' end', CLASSIC);
addRow('classic body split by two runs', (s) => 'a commit carried ghp_ab' + s + 'cdef' + s + 'ghijklmnop end', CLASSIC);
addRow('classic prefix/body boundary', (s) => 'a commit carried ghp_' + s + 'abcdefghijklmnop end', CLASSIC);
addRow('PAT body split near its middle', (s) => 'a commit carried github_pat_' + 'abcdefghijklmnopqrst'.slice(0, 10) + s + 'abcdefghijklmnopqrst'.slice(10) + ' end', PAT);
addRow('PAT body split by two runs', (s) => 'a commit carried github_pat_abcdef' + s + 'ghij' + s + 'klmnopqrst end', PAT);
addRow('Basic payload split near its middle', (s) => 'release: Basic ' + B64.slice(0, 10) + s + B64.slice(10) + ' and prose', B64);
addRow('Basic payload split by two runs', (s) => 'release: Basic ' + B64.slice(0, 4) + s + B64.slice(4, 8) + s + B64.slice(8) + ' and prose', B64);
addRow('Basic quoted payload split inside its base64', (s) => 'release: Basic "' + B64.slice(0, 10) + s + B64.slice(10) + '" and prose', B64);

test('anti-vacuity: plainText records the separator, and the class membership is the module\'s own', () => {
  // The mark is exactly what plainText writes for split evidence, and exactly what it does NOT write
  // for an ordinary word gap. A row below cannot pass because the evidence was never recorded.
  for (const cp of EVIDENCE_CHARS) {
    const ch = String.fromCodePoint(cp);
    assert.ok(SCHEME_GAP_PATTERN.test(ch), u(cp) + ' is measured by this file and is not in the class');
    // The evidence is recorded as the MARK, or -- for an invisible separator, which the published
    // view keeps as the surface wrote it -- as the character itself. What matters is that it is NOT
    // the ordinary word gap a control byte used to become; that is the information the model keeps.
    const recorded = plainText('a' + ch + 'b', 100);
    assert.notEqual(recorded, 'a b',
      u(cp) + ' was recorded as an ordinary word gap: ' + JSON.stringify(recorded));
    assert.ok(recorded === 'a' + MARK + 'b' || recorded === 'a' + ch + 'b',
      u(cp) + ' recorded neither the mark nor itself: ' + JSON.stringify(recorded));
  }
  for (const cp of ORDINARY_GAPS) {
    const ch = String.fromCodePoint(cp);
    assert.equal(plainText('a' + ch + 'b', 100), 'a b',
      u(cp) + ' is an ordinary word gap and was recorded as evidence');
  }
  // THE ENTITY TABLE IS THE DERIVED FAMILY, not a sample (Batch 103; the Gate's F43-1): every one
  // of the 32 HTML5 names whose value is a class member is read as the separator it names. A name
  // dropped from the table leaves its reference as text, the reader below decodes it, and the
  // matrix test's row for that spelling then publishes -- the two rows pin the family together.
  for (const name of HTML5_CLASS_NAMES) {
    assert.equal(plainText('a&' + name + ';b', 100), 'a' + MARK + 'b',
      '&' + name + '; is not read as the separator it names: the table is not the derived family');
  }
  // The numeric reference without its semicolon is the form HTML resolves, and the module reads it
  // the same way (Batch 103): the class member it names is the reference's evidence.
  for (const ref of ['&#8203', '&#x200B', '&#9', '&#32', '&#160', '&#8288']) {
    // A following '!' rather than a letter: the hex spelling consumes every hex digit after it, the
    // way HTML does, so a 'b' would be part of the reference (see the digit-guard row below).
    assert.equal(plainText('a' + ref + '!b', 100), 'a' + MARK + '!b',
      ref + ' (no semicolon) is not read as the separator it names');
  }
  // THE DIGIT GUARD: the whole digit run is the reference, so a longer numeric reference is not
  // misread as a class member followed by text. These are real code points and are left alone.
  for (const [ref, cp] of [['&#82030', 0x1406e], ['&#x200B1', 0x200b1], ['&#320', 0x140], ['&#1600', 0x640]]) {
    assert.equal(plainText('a' + ref + '!b', 100), 'a' + ref + '!b',
      ref + ' was misread as a class member plus trailing text (it is ' + u(cp) + ')');
  }
  // The NOTICE control pass records the same evidence, through the same normaliser: a notice text
  // that names a control byte carries the mark until the assembly renders it. Without this the pass
  // would lose the evidence a re-pushed notice needs, and the two normalisers would disagree.
  assert.equal(neutraliseNoticeText('a' + String.fromCharCode(0) + 'b'), 'a' + MARK + 'b',
    'the notice control pass did not record the separator it met');
  assert.equal(renderSeparatorMarks(neutraliseNoticeText('a' + String.fromCharCode(0) + 'b')), 'a b',
    'the notice control pass recorded something that does not publish as the space it stood in for');
  // The mark is a member of the class the rules read, and it can never come from an input: plainText
  // normalises an incoming one to the space it publishes as.
  assert.ok(SCHEME_GAP_PATTERN.test(MARK), 'the mark is not a member of the separator class');
  assert.equal(plainText('a' + MARK + 'b', 100), 'a b',
    'an incoming mark was not normalised to a space at the input boundary');
  // The detector sees every value in a text with no keyword, so a row cannot pass because the
  // criterion is blind.
  for (const value of [CRED8, CRED12, CRED16, LONG, B64, CLASSIC, PAT]) {
    assert.ok(PUBLISHED('the answer said ' + value + ' today', value), 'the detector cannot see ' + value);
  }
});

test('the class: every split pattern by every evidence separator and every entity spelling removes on every surface', () => {
  const leaks = [];
  const separators = [...EVIDENCE_CHARS.map((cp) => [u(cp), String.fromCodePoint(cp)]),
    ...ENTITY_SPELLINGS.map((e) => [e, e])];
  for (const [label, ch] of separators) {
    for (const row of SPLIT_ROWS) {
      const raw = row.build(ch);
      for (const [surface, text] of surfaces(raw)) {
        if (PUBLISHED(text, row.value)) leaks.push(row.name + ' / ' + surface + ' / ' + label);
      }
    }
  }
  assert.deepEqual(leaks, [], 'the credential was published at: ' + leaks.slice(0, 10).join('; '));
});

test('the prose direction: the rows the pair named are the pre-Batch-100 answer, and ordinary prose is kept', () => {
  // The four rows the FINAL42 pair measured as reaped, read against the answer the pre-Batch-100
  // revision gave (recorded in the pair's reports): a Bearer value followed by a diagnostic stamp is
  // NOT a split (F42-3), and the pinned prose rows of the suite keep every word.
  const kept = [
    'Bearer version 2026-10-15 is now available',
    'Bearer release 2026-10-15 notes are in the changelog',
    'Bearer token1 2026-10-15 is the release date',
    'the Bearer release 2026-10-15 build passed',
    'Bearer style 2026-10-15 audit',
    'a Bearer token1 is required',
    'authorization: required for this feed',
    'the bearer credential held by the gateway is rotated weekly',
    'the docs say ghp_ strip the token prefix from the clone URL',
  ];
  for (const row of kept) {
    assert.equal(candidate(row), row, 'the candidate pass reaped prose: ' + JSON.stringify(row));
    assert.equal(notice(row), row, 'the notice pass reaped prose: ' + JSON.stringify(row));
  }
  // The other direction, on the same rows: a complete value run is still not extended, and the word
  // after a real token survives.
  for (const [raw, keep] of [
    ['a commit carried ' + CLASSIC + ' and prose', ' and prose'],
    ['release: Bearer ' + CRED16 + ' and this sentence', 'and this sentence'],
    ['release: Basic ' + B64 + ' and then prose', 'and then prose'],
  ]) {
    assert.ok(candidate(raw).includes(keep), 'the candidate pass reaped prose after a complete value: ' + JSON.stringify(candidate(raw)));
    assert.ok(notice(raw).includes(keep), 'the notice pass reaped prose after a complete value: ' + JSON.stringify(notice(raw)));
  }
  // F42-4, BOTH DIRECTIONS: the pre-colon gap reads the class, so the leak it closed is closed and
  // the prose price it costs is this row -- a line that merely NAMES the header with an invisible
  // separator before its colon is consumed whole, exactly as its plain-space spelling already was at
  // the pre-Batch-100 revision. The control-byte spelling answers the same way.
  for (const sep of ['\u200b', '\u00ad', '\u0000']) {
    const leak = 'the answer said authorization' + sep + ': ' + CRED16 + ' end';
    assert.ok(!PUBLISHED(candidate(leak), CRED16), 'F41-2 reopened: the pre-colon gap published the value');
    assert.ok(!PUBLISHED(notice(leak), CRED16), 'F41-2 reopened on the notice path');
    assert.equal(candidate('authorization' + sep + ': see 2026-10-15 notes'), '[redacted]',
      'the recorded pre-colon price moved (F42-4)');
  }
  // THE RECORDED PRICE, at the one position the model cannot tell apart: the fragment before the
  // separator at a bare vendor prefix is EMPTY, so a surface's own split and an ordinary word gap
  // are the same shape, and the word after the prefix goes with the body. It is the price Batch 98
  // recorded and the suite's own prefix/body row pins (the alternative is publishing the credential
  // at that boundary); this file keeps it measured rather than implied.
  assert.equal(candidate('the documented ghp_ prefix is six characters'),
    'the documented [redacted] is six characters', 'the recorded prefix/body price moved');
  // An input with no separator at all is byte-identical on both entry points.
  for (const row of ['release: v1.2.3 shipped today', 'a plain sentence with a date 2026-10-15',
    'the build passed on the mirror', 'authorization required for the feed']) {
    assert.equal(candidate(row), row, 'a separator-free input moved on the candidate pass');
    assert.equal(notice(row), row, 'a separator-free input moved on the notice pass');
  }
});

test('the published bytes never carry the mark, the caps hold, and both passes are fixed points', () => {
  const rows = [];
  for (const cp of EVIDENCE_CHARS) {
    const ch = String.fromCodePoint(cp);
    rows.push('release: Bearer ' + CRED12.slice(0, 6) + ch + CRED12.slice(6) + ' and prose');
    rows.push('a commit carried ghp_ab' + ch + 'cdef' + ch + 'ghijklmnop end');
    rows.push('authorization' + ch + ': ' + CRED16);
  }
  for (const raw of rows) {
    for (const [surface, text] of surfaces(raw)) {
      assert.ok(!text.includes(MARK), 'the ' + surface + ' published the internal mark: ' + JSON.stringify(text));
      assert.ok(!text.includes('\uE000') && !text.includes('\uFFFF'),
        'the ' + surface + ' published an internal character: ' + JSON.stringify(text));
    }
    assert.equal(redactSecrets(notice(raw), []), notice(raw), 'the notice pass is not a fixed point on ' + JSON.stringify(raw));
    assert.equal(redactCredentialShapes(candidate(raw)), candidate(raw), 'the candidate pass is not a fixed point on ' + JSON.stringify(raw));
    assert.equal(neutraliseNoticeText(neutraliseNoticeText(notice(raw))), neutraliseNoticeText(notice(raw)),
      'the notice normalisation is not a fixed point on ' + JSON.stringify(raw));
    for (const cap of CAPS) {
      const assembled = assembleNotice('rss', raw, [CRED16], cap);
      assert.ok(assembled.length <= cap, 'a notice exceeded its cap ' + cap + ': ' + assembled.length);
      assert.ok(assembled.startsWith('rss: '), 'a notice lost its source and separator: ' + JSON.stringify(assembled));
    }
  }
});

// THE RECORDED LOWS AT THIS REVISION (Batch 103). Three measured bounds, pinned so the record is
// accurate rather than implied: each is over-removal or a published fragment, none publishes a
// whole credential, and the shipped pipeline redacts once. If one of these is ever fixed, the row
// moves with the fix instead of passing silently.
test('the recorded Low bounds: the candidate re-redaction, the early-stop tail, the bare stamp', () => {
  const ZWSP = String.fromCodePoint(0x200b);
  const MSP = String.fromCodePoint(0x205f);
  // F43-2 (Low, over-removal on a re-redaction): the candidate pass is not a fixed point here --
  // the first pass renders the separator as the space it publishes as, and a SECOND pass no longer
  // sees the evidence and reads the header. No credential is published; the shipped pipeline runs
  // the pass once. Recorded, not closed: the evidence cannot survive the published view.
  const f432 = 'authorization: token' + MSP + 'buildtoken';
  assert.equal(candidate(f432), 'authorization: token buildtoken',
    'the first candidate pass moved: the recorded F43-2 reach is stale');
  assert.equal(candidate(candidate(f432)), '[redacted]',
    'the second candidate pass no longer over-removes: the recorded F43-2 reach is stale');
  // F43-3 (Low, a published fragment): the multi-run join stops at the first accepting prefix, so
  // the split's tail stays. It is a fragment, not the credential: the whole value is not present
  // and cannot be recovered from the published text.
  const f433 = 'a commit carried ghp_ab' + ZWSP + 'cd' + ZWSP + 'efgh' + ZWSP + 'ijklmnop end';
  for (const [surface, text] of [['candidate', candidate(f433)], ['notice', notice(f433)]]) {
    assert.ok(!PUBLISHED(text, CLASSIC), surface + ' published the whole credential behind the early stop');
    assert.ok(text.includes('ijklmnop'), surface + ' no longer leaves the recorded tail: the F43-3 reach is stale');
  }
  // F43-4 (Low, pre-existing, over-removal only): the diagnostic-stamp exemption is read where an
  // ordinary word gap is crossed by a value the rule could not match as it stands, so a BARE stamp
  // directly after the keyword is still reaped -- at both revisions before this one, and here.
  assert.equal(candidate('Bearer 2026-10-15 is now available'), '[redacted] is now available',
    'the bare-stamp price moved on the candidate pass');
  assert.equal(notice('Bearer 2026-10-15 is now available'), '[redacted] is now available',
    'the bare-stamp price moved on the notice pass');
  // The same sentence with a word between the keyword and the stamp is KEPT (Batch 101's exemption),
  // which is the direction that shows the price is this one position and not the stamp class.
  assert.equal(candidate('Bearer version 2026-10-15 is now available'),
    'Bearer version 2026-10-15 is now available', 'the stamp exemption regressed');
});
