// tests/invisible-separator-property.test.mjs
// Closing sweep F40-1 (Medium, shipped-pipeline reach), Batch 96. The run had closed the separator
// family ONE CHARACTER AT A TIME -- the NEL in the keyword bridge (Batch 88), then in plainText and in
// the notice pass (Batch 91), then the whole control-byte class (Batch 93) -- because each fix was
// written as a fact about the character it named rather than as a rule about separators. The rule,
// stated whole and first-hand from the module's own reasoning: a character a surface may write BETWEEN
// A KEYWORD AND ITS VALUE and that carries NO VISIBLE CONTENT is a separator at that gap, exactly as a
// space is. A reader sees 'release Bearer<ZWSP>tok_...' as a Bearer credential; the two GENERIC scheme
// rules (BEARER_VALUE and the Basic keyword's two gaps) took their gap from AUTH_BRIDGE_SPACE, which is
// JavaScript's \s plus the five line terminators plus U+FEFF and nothing else, so the value behind an
// invisible character was published byte for byte.
//
// Measured first-hand before the fix, through the SHIPPED keyless candidate pass (collectAll with
// GITHUB_TOKEN/GH_TOKEN unset) and on both exported entry points and the assembled notice, with the
// shipped configuration: ZWSP U+200B, SHY U+00AD, WJ U+2060, MVS U+180E, U+3164, ZWNJ U+200C, ZWJ
// U+200D, ALM/function-application U+2061, HANGUL CHOSEON FILLER U+115F and KHMER VOWEL INHERENT AQ
// U+17B4 -- every one of them in BOTH the Bearer and the Basic spelling, 20 of 20 rows into
// '.pool.json' and into the notice -- while U+00A0, U+FEFF, LF and NEL removed on the same instrument.
//
// The fix is the whole family, not the ten characters: net.mjs names the invisible class by the
// Unicode property (INVISIBLE_SEPARATOR = \p{Default_Ignorable_Code_Point}) and the gap the two
// generic scheme rules read is the bridge PLUS that class (SCHEME_GAP). This file is the property over
// the whole code-point range, so the family cannot be closed one character at a time again. It drives
// the shipped pipeline (collectAll), both exported entry points and the notice assembly, and it pins
// the class's own definition, so a later change that narrows the class fails here rather than in a
// hostile upstream's favour.
//
// Two boundaries this file does NOT claim, because they are the design and not a gap:
//   - a VISIBLE character is not a separator. 'Bearer!<token>' is one word no surface spells as a
//     credential, and no rule reads it (the control-byte property test records the same scope).
//   - the fix widens the GAP only; it does not rewrite published text. An invisible character inside
//     prose stays where the surface put it (a soft hyphen inside a word is not spaced), which is why
//     the tracked corpus is byte-identical before and after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plainText, redactSecrets, redactCredentialShapes, CONTROL_CHARACTERS, CONTROL_PATTERN,
  INVISIBLE_SEPARATOR, INVISIBLE_SEPARATOR_PATTERN, SCHEME_GAP, SCHEME_GAP_PATTERN,
} from '../scripts/lib/net.mjs';
import { collectAll, assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';

const LF = String.fromCharCode(10);
const CRED = 'tok_' + '9f3a2c7d1e5b';
const B64 = Buffer.from('alice:' + 's3cr3tp4ssw0rd').toString('base64');
const SECRET = 's3cr3tp4ssw0rd';
const u = (cp) => 'U+' + cp.toString(16).padStart(4, '0').toUpperCase();
const CREDENTIAL = (text) => text.includes(CRED) || text.includes(B64) || text.includes(SECRET);

// The class under test is the one the module names, not a list written a second time here.
const isSchemeGap = (cp) => SCHEME_GAP_PATTERN.test(String.fromCodePoint(cp));
const SWEEP_END = 0x2fff;
const GAP = [];
for (let cp = 0x0000; cp <= SWEEP_END; cp += 1) if (isSchemeGap(cp)) GAP.push(cp);
// The ten characters the sweep measured leaking before this batch, as witnesses and not as the class.
const WITNESSES = [0x200b, 0x00ad, 0x2060, 0x180e, 0x3164, 0x200c, 0x200d, 0x2061, 0x115f, 0x17b4];
// The class is not BMP-only: the variation selectors and the tag characters are default-ignorable too.
const BEYOND_BMP = [0xfe00, 0xe0001, 0xe007f, 0xe0100];

test('the named scheme gap is the bridge PLUS the invisible class PLUS the control class, and it is pinned', () => {
  assert.equal(INVISIBLE_SEPARATOR, '\\p{Default_Ignorable_Code_Point}',
    'the named invisible class moved; this file pins the definition it asserts over');
  assert.equal(SCHEME_GAP,
    '[' + CONTROL_CHARACTERS + '\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff' + '\\r\\n\\u2028\\u2029\\u0085'
      + INVISIBLE_SEPARATOR + ']',
    'the scheme gap is no longer the bridge plus the invisible class plus the control bytes');
  for (const cp of WITNESSES) {
    assert.ok(isSchemeGap(cp), u(cp) + ' left the scheme gap, and this is one of the ten F40-1 measured');
    assert.ok(INVISIBLE_SEPARATOR_PATTERN.test(String.fromCodePoint(cp)),
      u(cp) + ' is no longer in the named invisible class');
  }
  // The bridge's own members are still separators (the class WIDENED the gap; it did not replace it).
  for (const cp of [0x09, 0x0a, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]) {
    assert.ok(isSchemeGap(cp), u(cp) + ' is a bridge character and left the scheme gap');
  }
  // The class's own size in the swept range, pinned: 24 bridge characters + 38 default-ignorable ones,
  // plus the 65 control bytes Batch 98 added (59 of them new -- \t, \v, \f, \r, \n and U+0085 were
  // already bridge members).
  assert.equal(GAP.length, 121, 'the scheme gap in 0x0000-0x2FFF is no longer 24 bridge + 38 invisible + 65 control');
  assert.equal(GAP.filter((cp) => INVISIBLE_SEPARATOR_PATTERN.test(String.fromCodePoint(cp))).length, 38,
    'the default-ignorable half of the gap moved inside 0x0000-0x2FFF');
  // The control half (Batch 98; closing sweep F40-1): every control byte is a separator at this gap
  // exactly as it is inside a keyword, because the gap and the interior read ONE class.
  const controlHalf = GAP.filter((cp) => CONTROL_PATTERN.test(String.fromCharCode(cp)));
  assert.equal(controlHalf.length, 65, 'the control half of the gap moved inside 0x0000-0x2FFF');
  for (const cp of [0x00, 0x01, 0x08, 0x7f, 0x80, 0x9b, 0x9f]) {
    assert.ok(isSchemeGap(cp), u(cp) + ' is a control byte and left the scheme gap');
  }
  assert.ok(GAP.includes(0x0a), 'LF is not in the class and every assertion below would be vacuous');
  // The boundary is real in BOTH directions: a visible mark beside a token is not a separator ...
  assert.ok(!isSchemeGap(0x25cc), 'a visible mark is not a separator');
  assert.ok(!isSchemeGap(0x21), 'an ASCII exclamation mark is not a separator');
  // ... and the fix does not rewrite published text: an invisible character inside a word stays.
  assert.equal(plainText('co\u00adoperate and a\u200bb', 100), 'co\u00adoperate and a\u200bb',
    'the scheme-gap widening must not space invisible characters in published text');
});

test('the credential behind any scheme-gap code point is removed by BOTH exported entry points', () => {
  // The publish order for a candidate field is plainText first; for a notice detail it is redactSecrets
  // then neutraliseNoticeText. Both are driven here, at every code point of the swept range, and the
  // expectation is the module's own class membership -- so widening or narrowing the class moves the
  // expectation with it, and the pinned assertions above are what stop a narrowing from passing.
  const shapes = [
    ['candidate bearer gap', (s) => 'release notes: Bearer' + s + CRED + ' (rotated)'],
    ['candidate basic keyword gap', (s) => 'release notes: auth=Basic' + s + B64 + ' shipped'],
    ['candidate basic token gap', (s) => 'release notes: auth=Basic ' + s + B64 + ' shipped'],
    ['notice authorization gap', (s) => 'authorization:' + s + CRED],
  ];
  // The anti-vacuity precondition the control-byte property test uses: LF is the class's own member and
  // its answer must remove the credential, or an equality/removal assertion over the class proves nothing.
  for (const [name, build] of shapes) {
    const lfAnswer = name.startsWith('notice')
      ? neutraliseNoticeText(redactSecrets(build(LF), [SECRET]))
      : redactSecrets(plainText(build(LF), 400), [SECRET]);
    assert.ok(!CREDENTIAL(lfAnswer),
      'the LF reference itself did not remove the credential for ' + name + ': ' + JSON.stringify(lfAnswer));
  }
  for (let cp = 0x0000; cp <= SWEEP_END; cp += 1) {
    if (!isSchemeGap(cp)) continue;
    const ch = String.fromCodePoint(cp);
    for (const [name, build] of shapes) {
      const out = name.startsWith('notice')
        ? neutraliseNoticeText(redactSecrets(build(ch), [SECRET]))
        : redactSecrets(plainText(build(ch), 400), [SECRET]);
      assert.ok(!CREDENTIAL(out),
        name + ' published the credential behind ' + u(cp) + ': ' + JSON.stringify(out));
      // ... and the second entry point answers the same, so the two cannot disagree about a separator.
      const other = name.startsWith('notice')
        ? 'notice'
        : redactCredentialShapes(plainText(build(ch), 400));
      if (name !== 'notice authorization gap') {
        assert.ok(!CREDENTIAL(other), name + ' leaked through redactCredentialShapes behind ' + u(cp));
      }
    }
  }
});

test('the shipped keyless candidate pass publishes no credential behind any scheme-gap code point', async () => {
  // The decisive reach: F40-1 was filed for the SHIPPED keyless default, where redactCredentialShapes
  // runs over every string field of every candidate because the run issued no credential. The run here
  // issues none (GITHUB_TOKEN is deleted, the target carries no query parameter and no userinfo) and
  // the feed title is the hostile spelling. Before Batch 96 every one of the ten witnesses published
  // 'auth=Basic' + <char> + <base64> and 'Bearer' + <char> + <token> byte for byte; the assertion is
  // that no code point of the module's own scheme-gap class does now.
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
  const titleOf = (pool) => (pool.candidates[0] ? pool.candidates[0].title : '');
  const previous = process.env.GITHUB_TOKEN;
  const previousGh = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  const leaks = [];
  try {
    // The anti-vacuity precondition: LF's own row must remove, and the pool must actually carry the
    // candidate, or 'no credential in the title' would pass on an empty pool.
    const lfEcho = 'release notes: auth=Basic' + LF + B64 + ' shipped and Bearer' + LF + CRED;
    const lfTitle = titleOf(await runPool(lfEcho));
    assert.ok(lfTitle.length > 0, 'the LF reference row produced no candidate at all');
    assert.ok(!CREDENTIAL(lfTitle), 'the LF reference row published the credential: ' + JSON.stringify(lfTitle));
    for (let cp = 0x0000; cp <= SWEEP_END; cp += 1) {
      if (!isSchemeGap(cp)) continue;
      const ch = String.fromCodePoint(cp);
      const echoed = 'release notes: auth=Basic' + ch + B64 + ' shipped and Bearer' + ch + CRED;
      const title = titleOf(await runPool(echoed));
      if (CREDENTIAL(title)) leaks.push(u(cp));
    }
  } finally {
    if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
    if (previousGh !== undefined) process.env.GH_TOKEN = previousGh;
  }
  assert.deepEqual(leaks, [],
    'the shipped keyless pass published the credential behind: ' + leaks.join(', '));
});

test('the assembled notice publishes no credential behind any scheme-gap code point', () => {
  // The exported seam a caller reaches without collectAll, at the caps the standing notice class names.
  for (const cap of [128, 402, 1000]) {
    const lfNotice = assembleNotice('rss', 'release Basic' + LF + B64, [SECRET], cap);
    assert.ok(!CREDENTIAL(lfNotice), 'the LF reference notice leaked: ' + JSON.stringify(lfNotice));
    for (let cp = 0x0000; cp <= SWEEP_END; cp += 1) {
      if (!isSchemeGap(cp)) continue;
      const notice = assembleNotice('rss', 'release Basic' + String.fromCodePoint(cp) + B64, [SECRET], cap);
      assert.ok(!CREDENTIAL(notice),
        'the assembled notice published the credential behind ' + u(cp) + ' at cap ' + cap + ': '
        + JSON.stringify(notice));
    }
  }
});

test('the class reaches past the BMP, so no later fix can call the family a BMP-only list', () => {
  // The property is what names the class, so the class carries the variation selectors and the tag
  // characters with it: a fix that enumerated the BMP byte range would have left these publishing.
  for (const cp of BEYOND_BMP) {
    assert.ok(isSchemeGap(cp), u(cp) + ' is default-ignorable and left the scheme gap');
    const ch = String.fromCodePoint(cp);
    assert.ok(!CREDENTIAL(redactCredentialShapes(plainText('release Bearer' + ch + CRED + ' end', 400))),
      u(cp) + ' published a Bearer credential through the candidate pass');
    assert.ok(!CREDENTIAL(redactCredentialShapes(plainText('release Basic' + ch + B64 + ' end', 400))),
      u(cp) + ' published a Basic credential through the candidate pass');
    assert.ok(!CREDENTIAL(assembleNotice('rss', 'release Basic' + ch + B64, [SECRET], 402)),
      u(cp) + ' published a Basic credential in the assembled notice');
  }
});
