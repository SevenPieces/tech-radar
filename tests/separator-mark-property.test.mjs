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
  .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => NAMED_READER[String(n).toLowerCase()] ?? m)
  // HTML's TEXT context resolves a LEGACY name without its semicolon however the next character
  // reads (the '=' / alphanumeric guard is attribute-only), so the detector for the legacy rows
  // below decodes '&nbsp'/'&shy' as the reader does (Batch 104; F44-1a).
  .replace(/&(nbsp|shy)/gi, (m, n) => NAMED_READER[String(n).toLowerCase()] ?? m);
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


// THE LEGACY NO-SEMICOLON NAMES, DERIVED AND PINNED (Batch 104; the final pair's F44-1a). The
// pinned table is Python's html.entities.html5 legacy half (the 106 names the WHATWG table carries
// WITHOUT a semicolon); it is here so the expected set is COMPUTED from the table rather than
// asserted from the module. Python 3.12 / html.entities, 2,231 keys, 2,125 with a semicolon:
//   python3 -c "import html.entities as h; print({k: v for k, v in h.html5.items() if not k.endswith(';')})"
// and the class filter is the module's own SCHEME_GAP_PATTERN, so a drift in either moves the test.
const HTML5_LEGACY = { AElig: '\u00c6', AMP: '&', Aacute: '\u00c1', Acirc: '\u00c2', Agrave: '\u00c0', Aring: '\u00c5', Atilde: '\u00c3', Auml: '\u00c4', COPY: '\u00a9', Ccedil: '\u00c7', ETH: '\u00d0', Eacute: '\u00c9', Ecirc: '\u00ca', Egrave: '\u00c8', Euml: '\u00cb', GT: '>', Iacute: '\u00cd', Icirc: '\u00ce', Igrave: '\u00cc', Iuml: '\u00cf', LT: '<', Ntilde: '\u00d1', Oacute: '\u00d3', Ocirc: '\u00d4', Ograve: '\u00d2', Oslash: '\u00d8', Otilde: '\u00d5', Ouml: '\u00d6', QUOT: '"', REG: '\u00ae', THORN: '\u00de', Uacute: '\u00da', Ucirc: '\u00db', Ugrave: '\u00d9', Uuml: '\u00dc', Yacute: '\u00dd', aacute: '\u00e1', acirc: '\u00e2', acute: '\u00b4', aelig: '\u00e6', agrave: '\u00e0', amp: '&', aring: '\u00e5', atilde: '\u00e3', auml: '\u00e4', brvbar: '\u00a6', ccedil: '\u00e7', cedil: '\u00b8', cent: '\u00a2', copy: '\u00a9', curren: '\u00a4', deg: '\u00b0', divide: '\u00f7', eacute: '\u00e9', ecirc: '\u00ea', egrave: '\u00e8', eth: '\u00f0', euml: '\u00eb', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', gt: '>', iacute: '\u00ed', icirc: '\u00ee', iexcl: '\u00a1', igrave: '\u00ec', iquest: '\u00bf', iuml: '\u00ef', laquo: '\u00ab', lt: '<', macr: '\u00af', micro: '\u00b5', middot: '\u00b7', nbsp: '\u00a0', not: '\u00ac', ntilde: '\u00f1', oacute: '\u00f3', ocirc: '\u00f4', ograve: '\u00f2', ordf: '\u00aa', ordm: '\u00ba', oslash: '\u00f8', otilde: '\u00f5', ouml: '\u00f6', para: '\u00b6', plusmn: '\u00b1', pound: '\u00a3', quot: '"', raquo: '\u00bb', reg: '\u00ae', sect: '\u00a7', shy: '\u00ad', sup1: '\u00b9', sup2: '\u00b2', sup3: '\u00b3', szlig: '\u00df', thorn: '\u00fe', times: '\u00d7', uacute: '\u00fa', ucirc: '\u00fb', ugrave: '\u00f9', uml: '\u00a8', uuml: '\u00fc', yacute: '\u00fd', yen: '\u00a5', yuml: '\u00ff' };
const LEGACY_CLASS = Object.keys(HTML5_LEGACY)
  .filter((name) => [...HTML5_LEGACY[name]].length === 1 && SCHEME_GAP_PATTERN.test(HTML5_LEGACY[name]));

test('the derived legacy no-semicolon names are exactly two, and they are read as the separator they name', () => {
  assert.deepEqual(LEGACY_CLASS.sort(), ['nbsp', 'shy'],
    'the pinned HTML5 legacy table no longer derives exactly two class names: ' + LEGACY_CLASS.join(','));
  for (const name of LEGACY_CLASS) {
    // HTML resolves a legacy name without its semicolon in TEXT whatever follows (the '=' /
    // alphanumeric guard is attribute-only): a letter, '_', '=' and the end all resolve.
    // The trailing spelling is trimmmed exactly as a trailing space is, so the empty tail leaves 'a'.
    for (const [tail, out] of [['b', MARK + 'b'], ['_b', MARK + '_b'], ['=b', MARK + '=b'], ['', '']]) {
      assert.equal(plainText('a&' + name + tail, 100), 'a' + out,
        '&' + name + ' (no semicolon) was not read as the separator it names: ' + JSON.stringify(tail));
    }
    // The semicolon spelling wins over the legacy prefix, and a longer non-name is not swallowed:
    // '&shyabc;' is the reference followed by the text, exactly as html.unescape reads it.
    assert.equal(plainText('a&' + name + ';b', 100), 'a' + MARK + 'b',
      '&' + name + '; is no longer read as the semicolon family reads it');
    assert.equal(plainText('a&' + name + 'abc;b', 100), 'a' + MARK + 'abc;b',
      '&' + name + 'abc; was read as a longer name instead of the legacy reference plus text');
  }
  // The other 104 legacy names resolve to characters outside this class and stay as the text they
  // are: the direction that keeps ordinary entity prose byte-identical.
  for (const name of Object.keys(HTML5_LEGACY)) {
    if (LEGACY_CLASS.includes(name)) continue;
    assert.equal(plainText('a&' + name + '.b', 100), 'a&' + name + '.b',
      'the ordinary legacy name &' + name + ' moved: it is not a separator');
  }
  // The measured leak, on every surface: the PAT body split by the legacy reference was published
  // byte for byte in the shipped keyless pool at 0063439.
  for (const ref of ['&nbsp', '&shy']) {
    const raw = 'a commit carried github_pat_abcdef' + ref + 'ghijklmnopqrst end';
    for (const [surface, text] of surfaces(raw)) {
      assert.ok(!PUBLISHED(text, PAT), 'F44-1a: the ' + surface + ' published the PAT split by ' + ref + ': ' + JSON.stringify(text));
    }
  }
  // Ordinary entity prose does not move on either entry point.
  // The row is the pre-Batch-104 answer (one decode of the entity, as before): the fix adds the two
  // legacy names and must not move the ordinary reference at either boundary.
  for (const [row, out] of [['safe prose with &amp;amp; and &amp;mdash; only', 'safe prose with &amp; and &mdash; only'],
    ['a &copy; notice and &amp;amp; twice', 'a &copy; notice and &amp; twice']]) {
    assert.equal(candidate(row), out, 'ordinary entity prose moved on the candidate pass: ' + JSON.stringify(row));
    // The notice path has always decoded ONLY the class spelling (decodeEntities is the candidate's
    // own first decoder), so an ordinary reference is byte-identical there; the fix does not change it.
    assert.equal(notice(row), row, 'ordinary entity prose moved on the notice pass: ' + JSON.stringify(row));
  }
});

test('F44-1a: the shipped keyless pool no longer publishes a value split by a legacy no-semicolon name', async () => {
  const settings = {
    user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
    error_snippet_max_chars: 200, notice_max_chars: 1000, request_timeout_ms: 20000,
  };
  const feed = (text) => '<rss><channel><item><title>' + text + '</title>'
    + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
    + '<description>' + text + '</description></item></channel></rss>';
  const runPool = (text) => collectAll(
    { settings, watchlist: [{ kind: 'rss', target: 'https://feeds.example/f.xml', domain: 'languages-runtimes', note: '' }] },
    { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z',
      net: { hostOf: (url) => new URL(url).host, isDiscoveryOnly: () => false, fetchText: async () => feed(text) } });
  for (const ref of ['&nbsp', '&shy']) {
    const raw = 'a commit carried github_pat_abcdef' + ref + 'ghijklmnopqrst end';
    const pool = await runPool(raw);
    assert.ok(pool.candidates.length > 0, 'the legacy row produced no candidate at all: ' + ref);
    for (const c of pool.candidates) {
      for (const key of ['title', 'summary']) {
        const value = String(c[key] ?? '');
        assert.ok(!PUBLISHED(value, PAT),
          'F44-1a: the shipped keyless pool ' + key + ' published the PAT split by ' + ref + ': ' + JSON.stringify(value));
      }
    }
  }
});

test('F44-1b: the Basic join is bounded by the text, so every legitimate split removes, and a long userinfo cannot reach a round number first', async () => {
  const ZWSP = String.fromCodePoint(0x200b);
  const userinfo = (n) => 'u'.repeat(n) + ':' + 's3cr3tp4ssw0rd';
  const encOf = (n) => Buffer.from(userinfo(n)).toString('base64');
  // The boundary the sweep measured: a 47-character userinfo puts the ':' past the 64th base64
  // character, so a split one character per run used to stop before the pair completed and publish
  // the whole payload. It removes now on every surface.
  for (const n of [47, 48, 60]) {
    const enc = encOf(n);
    const raw = 'release: Basic ' + [...enc].join(ZWSP) + ' and prose';
    for (const [surface, text] of surfaces(raw)) {
      assert.ok(!PUBLISHED(text, enc),
        'F44-1b: the ' + surface + ' published the whole Basic payload for a ' + n + '-character userinfo');
    }
  }
  // THE BOUND IS THE TEXT'S OWN, NOT A RUN COUNT: a payload split one character per run uses one
  // run per character, so its split count is the payload length -- far past the old 64 -- and the
  // join covers it. Beyond the loop's bound there is no text left to split: body.length runs need
  // more characters than the body carries, so the bound is unreachable by a split (stated here as
  // the invariant the loop holds).
  for (const n of [60, 120, 200]) {
    const enc = encOf(n);
    const raw = 'release: Basic ' + [...enc].join(ZWSP) + ' and prose';
    assert.ok(enc.length > 64, 'the row no longer splits past 64 runs: ' + enc.length);
    const surfaceRows = [['candidate', redactCredentialShapes(raw)], ['notice', notice(raw)]];
    // The candidate field is bounded at 400 characters after plainText: only the rows the field
    // carries whole can be asserted through that surface.
    if (raw.length <= 400) surfaceRows.push(['candidate+plainText', candidate(raw)]);
    for (const [surface, text] of surfaceRows) {
      assert.ok(!PUBLISHED(text, enc),
        'F44-1b: the ' + surface + ' published the whole Basic payload at ' + enc.length + ' runs');
    }
    for (const cap of CAPS) {
      assert.ok(!PUBLISHED(assembleNotice('rss', raw, [SECRET], cap), enc),
        'F44-1b: the assembly at ' + cap + ' published the whole Basic payload at ' + enc.length + ' runs');
    }
  }
  // The shipped keyless pool: the summary carries it whole at 0063439.
  const longEnc = encOf(60);
  const raw = 'release: Basic ' + [...longEnc].join(ZWSP) + ' and prose';
  const settings = {
    user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
    error_snippet_max_chars: 200, notice_max_chars: 1000, request_timeout_ms: 20000,
  };
  const feed = (text) => '<rss><channel><item><title>' + text + '</title>'
    + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
    + '<description>' + text + '</description></item></channel></rss>';
  const pool = await collectAll(
    { settings, watchlist: [{ kind: 'rss', target: 'https://feeds.example/f.xml', domain: 'languages-runtimes', note: '' }] },
    { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z',
      net: { hostOf: (url) => new URL(url).host, isDiscoveryOnly: () => false, fetchText: async () => feed(raw) } });
  assert.ok(pool.candidates.length > 0, 'the Basic split row produced no candidate at all');
  for (const c of pool.candidates) {
    for (const key of ['title', 'summary']) {
      assert.ok(!PUBLISHED(String(c[key] ?? ''), longEnc),
        'F44-1b: the shipped keyless pool ' + key + ' published the whole Basic payload');
    }
  }
  // THE ADVERSARIAL COST: a 20,000-byte payload (26,668 base64 characters) that decodes to printable
  // text with no ':' is split one character per run. The tracker finds no pair and stops when the
  // text runs out, in ONE pass; a per-run decode test would test every prefix of every run. The
  // generous bound is a guard against that regression, not a benchmark.
  const huge = Buffer.from('a'.repeat(20000)).toString('base64');
  const adversarial = 'release: Basic ' + [...huge].join(ZWSP) + ' end';
  const started = Date.now();
  const out = redactCredentialShapes(adversarial);
  const elapsed = Date.now() - started;
  assert.equal(out, adversarial, 'the adversarial no-pair split moved text it does not name');
  assert.ok(elapsed < 4000, 'the Basic join is no longer linear: 20,000 bytes split per character took ' + elapsed + 'ms');
});

