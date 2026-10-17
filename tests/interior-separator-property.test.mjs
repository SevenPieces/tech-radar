// tests/interior-separator-property.test.mjs
// Closing sweep F40-1 (High, the shipped keyless pool), Batch 98. Batch 93 replaced DROPPING a control
// byte with SPACING it, because a dropped byte glued a keyword to its value. The drop's gluing was
// load-bearing for the MIRROR position: a control byte standing INSIDE a keyword or inside a curated
// secret shape. Spacing un-glued the halves and no rule read either half, so the shipped keyless pool
// published the credential behind them where the pre-93 revision removed it -- measured first-hand on
// the real collectAll with the suite's own stubbed transport: 'release: Bear' + NUL + 'er tok_...' and
// 'a commit carried gh' + NUL + 'p_abcdefghijklmnop' published at the tip (577a44c) and removed at
// a6e2530. The batch's own differential could not see it because it measured only the position BETWEEN
// the keyword and its value.
//
// THE RULE THIS FILE PINS, stated once: a removable control byte or an invisible separator that stands
// INSIDE a keyword, or inside a curated secret shape, does not break it -- the shape is read THROUGH
// those separators (a keyword is its letters with optional separators between them; a curated shape
// likewise), while the published text keeps the spaced form Batch 93 established. The class is the
// module's ONE separator class (net.mjs SCHEME_GAP: the bridge, the default-ignorable property and
// every control byte), read with '*' at an interior position and with '+' at a gap, so the two
// positions cannot be closed one without the other again.
//
// Four directions are held at once, and every one of them is asserted below:
//   (a) a keyword or shape split by a separator is still recognised and removed   -- the matrix;
//   (b) a keyword glued to its value by a dropped byte is still handled (Batch 93's rule: every
//       control byte is a separator in the published text)                        -- the gap rows;
//   (c) an invisible separator between a keyword and its value is still a gap (Batch 96)
//                                                                                  -- the gap rows;
//   (d) ordinary prose is not reaped                                               -- the prose row.
// The matrix runs BOTH exported entry points, the assembled notice at the three caps the standing
// notice class names (128/402/1000) and the shipped keyless collectAll, over the whole separator range
// at every position the finding names.
//
// THE VALUE RUN'S BOUND, CORRECTED (Batch 100; the final verification's F41-1/F41-2). This file used
// to record the bound as 'the keyless shape pass leaves the run's TAIL after the first separator'. The
// measurement says that statement is true only where the run BEFORE the separator already satisfies
// the rule's own minimum: where it does not, NOTHING matched and the WHOLE credential published,
// visually intact -- the prefix, the separator and the body -- on the shipped keyless pool title and
// summary, on both entry points and in the assembled notice. The record here is corrected to the
// measured form, and the below-minimum position is closed by the one normalisation model (net.mjs
// states it; tests/glued-value-run-property.test.mjs drives the whole shape x position x separator
// matrix): a value run that cannot satisfy the rule as it stands continues across ONE separator run
// into the next run of the rule's own value characters, and the span is removed whole. What is still
// a bound, and is pinned below, is the prose guard: a run that ALREADY satisfies the rule is
// complete and is NOT extended, so the word after a real token survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plainText, redactSecrets, redactCredentialShapes, CONTROL_CHARACTERS, CONTROL_PATTERN,
  INVISIBLE_SEPARATOR, SCHEME_GAP, SCHEME_GAP_PATTERN,
} from '../scripts/lib/net.mjs';
import { collectAll, assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';

const CRED = 'tok_' + '9f3a2c7d1e5b';
const B64 = Buffer.from('alice:' + 's3cr3tp4ssw0rd').toString('base64');
const SECRET = 's3cr3tp4ssw0rd';
// Built by concatenation so the shipping guard reads no credential in this file's own source (the
// shape is what the property is about, not a literal a scanner must quarantine).
const TOK = 'ghp_' + 'abcdefghijklmnop';
const PAT = 'github_pat_' + 'abcdefghijklmnopqrst';
const LF = String.fromCharCode(10);
const u = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

// THE SEPARATOR RANGE THE FINDING NAMES: the 65 control code points (0x00-0x1F, 0x7F, 0x80-0x9F), the
// default-ignorable class (the 0x0000-0x2FFF sweep plus the beyond-BMP witnesses the Batch 96 property
// names), the whitespace spellings and the five line terminators. The expectation is the MODULE'S OWN
// class membership wherever the range is the class, so widening or narrowing it moves the expectation
// with it -- the pinned assertions in the first row are what stop a narrowing from passing.
const CONTROL_BYTES = [];
for (let cp = 0x00; cp <= 0xff; cp += 1) {
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) CONTROL_BYTES.push(cp);
}
const INVISIBLE_WITNESSES = [0x00ad, 0x034f, 0x061c, 0x115f, 0x17b4, 0x180b, 0x180e, 0x200b, 0x200c,
  0x200d, 0x200e, 0x200f, 0x202a, 0x202e, 0x2060, 0x2061, 0x206f, 0x3164, 0xfe00, 0xfeff,
  0xe0001, 0xe0020, 0xe007f, 0xe0100];
const WHITESPACE_SPELLINGS = [0x09, 0x0b, 0x0c, 0x20, 0x00a0, 0x1680, 0x2000, 0x2007, 0x200a,
  0x202f, 0x205f, 0x3000];
const LINE_TERMINATORS = [0x0a, 0x0d, 0x2028, 0x2029, 0x0085];
const SEPARATORS = [];
const seen = new Set();
for (const cp of [...CONTROL_BYTES, ...INVISIBLE_WITNESSES, ...WHITESPACE_SPELLINGS, ...LINE_TERMINATORS]) {
  if (seen.has(cp)) continue;
  seen.add(cp);
  SEPARATORS.push([u(cp), String.fromCodePoint(cp)]);
}

// A credential is PUBLISHED when it is present whole, or when its characters can be read back in order
// with only separators between them -- the closing sweep's own criterion for the fuzz rows ("the value
// fully recoverable from the published text"). A bare fragment is not enough on its own: 'BasicY...' is
// the base64 payload welded to its keyword by construction and is a documented, separate rule.
const escapeChar = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const recoverable = (text, value) => new RegExp([...value].map(escapeChar).join(SCHEME_GAP + '*'), 'u').test(text);
const PUBLISHED = (text, value) => text.includes(value) || recoverable(text, value);
const ANY_CREDENTIAL = (text) => PUBLISHED(text, CRED) || PUBLISHED(text, B64) || text.includes(SECRET);
const SHAPE_PUBLISHED = (text, shape) => PUBLISHED(text, shape.slice(0, Math.floor(shape.length / 2)))
  || PUBLISHED(text, shape.slice(Math.floor(shape.length / 2)));

test('the separator class is pinned: the gap and the interior are ONE set, and it is the whole range', () => {
  // The class the interior read is built from is the class the gap reads -- not a second list. The
  // string is pinned so a later batch cannot narrow it back to a list of characters.
  assert.equal(SCHEME_GAP,
    '[' + CONTROL_CHARACTERS + '\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff'
      // U+E001 is the SEPARATOR MARK Batch 101 added (net.mjs SEPARATOR_MARK): the character
      // plainText writes where a separator that was not an ordinary word gap stood.
      + '\\r\\n\\u2028\\u2029\\u0085' + INVISIBLE_SEPARATOR + '\uE001]',
    'the separator class moved; this file pins the set every position below is measured over');
  assert.equal(CONTROL_CHARACTERS, '\u0000-\u001f\u007f-\u009f',
    'the named control class moved; this file pins the range it asserts over');
  // Every separator in the range really is a member (anti-vacuity: a matrix over a class that does not
  // contain its own rows would assert nothing).
  for (const cp of [...CONTROL_BYTES, ...INVISIBLE_WITNESSES, ...WHITESPACE_SPELLINGS, ...LINE_TERMINATORS]) {
    assert.ok(SCHEME_GAP_PATTERN.test(String.fromCodePoint(cp)),
      u(cp) + ' is one of the separators this file measures and is not in the separator class');
  }
  // The boundary in both directions: a visible mark is not a separator, and prose is not rewritten.
  assert.ok(!SCHEME_GAP_PATTERN.test('!'), 'a visible mark is not a separator');
  assert.ok(!SCHEME_GAP_PATTERN.test('\u25cc'), 'a visible mark is not a separator');
});

test('every position x separator row removes the credential on both entry points and the assembly', () => {
  const union = [SECRET, CRED];
  // The positions the finding names. The five keyword/shape-interior spellings are the exact ones the
  // closing sweep measured published; the gap rows are Batches 93/96; 'before' and 'after' are the
  // separators that stand outside the shape, which must change nothing at all.
  const POSITIONS = {
    'inside keyword Bearer': [(s) => 'release: Bear' + s + 'er ' + CRED + ' and prose', CRED],
    'inside keyword Basic': [(s) => 'release: Ba' + s + 'sic ' + B64 + ' and prose', B64],
    'inside keyword authorization': [(s) => 'release: authoriz' + s + 'ation: ' + CRED + ' end', CRED],
    'inside shape ghp_': [(s) => 'a commit carried gh' + s + 'p_abcdefghijklmnop end', TOK],
    'inside shape github_pat_': [(s) => 'a commit carried github' + s + '_pat_abcdefghijklmnopqrst end', PAT],
    'between keyword and value': [(s) => 'release: Bearer' + s + CRED + ' and prose', CRED],
    'between Basic and value': [(s) => 'release: Basic' + s + B64 + ' and prose', B64],
    'before the keyword': [(s) => 'release: ' + s + 'Bearer ' + CRED + ' and prose', CRED],
    'after the value': [(s) => 'release: Bearer ' + CRED + s + 'and prose', CRED],
    // The run's own value split INSIDE its own characters. Its surface is the BY-VALUE half: the keyless
    // shape pass has no value to remove and no keyword to read, which is the recorded bound below.
    'inside the value (by value)': [(s) => 'the answer said the token is ' + CRED.slice(0, 12) + s
      + CRED.slice(12) + ' and prose', CRED, 'byValueOnly'],
  };
  const candidate = (raw) => redactCredentialShapes(plainText(raw, 400));
  const noticed = (raw) => neutraliseNoticeText(redactSecrets(raw, union));
  // The anti-vacuity precondition: the LF spelling of every row must remove, or an assertion that the
  // other separators do would pass on a row that removes nothing at all.
  for (const [name, [build, value, surface]] of Object.entries(POSITIONS)) {
    if (surface !== 'byValueOnly') {
      assert.ok(!ANY_CREDENTIAL(candidate(build(LF))),
        name + ': the LF reference itself published the credential through the candidate pass');
    }
    assert.ok(!ANY_CREDENTIAL(noticed(build(LF))),
      name + ': the LF reference itself published the credential through the notice pass');
    for (const cap of [128, 402, 1000]) {
      assert.ok(!ANY_CREDENTIAL(assembleNotice('rss', build(LF), union, cap)),
        name + ': the LF reference itself published the credential in the assembled notice at cap ' + cap);
    }
    void value;
  }
  const leaks = [];
  for (const [label, ch] of SEPARATORS) {
    for (const [name, [build, , surface]] of Object.entries(POSITIONS)) {
      const raw = build(ch);
      if (surface !== 'byValueOnly' && ANY_CREDENTIAL(candidate(raw))) leaks.push(name + ' / candidate / ' + label);
      if (ANY_CREDENTIAL(redactSecrets(plainText(raw, 400), union))) leaks.push(name + ' / candidate union / ' + label);
      if (ANY_CREDENTIAL(noticed(raw))) leaks.push(name + ' / notice / ' + label);
      for (const cap of [128, 402, 1000]) {
        if (ANY_CREDENTIAL(assembleNotice('rss', raw, union, cap))) leaks.push(name + ' / assembly@' + cap + ' / ' + label);
      }
    }
  }
  assert.deepEqual(leaks, [], 'the credential was published at: ' + leaks.slice(0, 20).join('; '));
});

test('the shipped keyless candidate pass publishes no credential behind any separator at any position', async () => {
  // The decisive reach: F40-1 was filed for the SHIPPED keyless default, where redactCredentialShapes
  // runs over every string field because the run issued no credential. Before Batch 98 the five
  // interior spellings of the first feed published in the pool TITLE and SUMMARY.
  const settings = {
    user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
    error_snippet_max_chars: 200, notice_max_chars: 1000, request_timeout_ms: 20000,
  };
  const feed = (text) => '<rss><channel><item><title>' + text + '</title>'
    + '<link>https://feeds.example/1</link><pubDate>Sun, 20 Sep 2026 12:00:00 GMT</pubDate>'
    + '<description>' + text + '</description></item></channel></rss>';
  const previous = process.env.GITHUB_TOKEN;
  const previousGh = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  const runPool = (text) => collectAll(
    { settings, watchlist: [{ kind: 'rss', target: 'https://feeds.example/f.xml', domain: 'languages-runtimes', note: '' }] },
    { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z',
      net: { hostOf: (url) => new URL(url).host, isDiscoveryOnly: () => false, fetchText: async () => feed(text) } });
  const fields = (pool) => (pool.candidates[0]
    ? [pool.candidates[0].title, pool.candidates[0].summary || ''] : []);
  const leaks = [];
  try {
    // The anti-vacuity precondition: the LF row must remove every shape AND the pool must carry the
    // candidate, or 'no credential in the title' would pass on an empty pool.
    const lf = 'release: Bear' + LF + 'er ' + CRED + ' Ba' + LF + 'sic ' + B64 + ' authoriz' + LF + 'ation: '
      + CRED + ' gh' + LF + 'p_abcdefghijklmnop github' + LF + '_pat_abcdefghijklmnopqrst';
    const lfFields = fields(await runPool(lf));
    assert.equal(lfFields.length, 2, 'the LF reference row produced no candidate at all');
    for (const field of lfFields) {
      assert.ok(!ANY_CREDENTIAL(field), 'the LF reference row published the credential: ' + JSON.stringify(field));
      assert.ok(!SHAPE_PUBLISHED(field, TOK), 'the LF reference row published ghp_: ' + JSON.stringify(field));
      assert.ok(!SHAPE_PUBLISHED(field, PAT), 'the LF reference row published the PAT: ' + JSON.stringify(field));
    }
    for (const [label, ch] of SEPARATORS) {
      const echoed = 'release: Bear' + ch + 'er ' + CRED + ' Ba' + ch + 'sic ' + B64 + ' authoriz' + ch + 'ation: '
        + CRED + ' gh' + ch + 'p_abcdefghijklmnop github' + ch + '_pat_abcdefghijklmnopqrst';
      for (const field of fields(await runPool(echoed))) {
        if (ANY_CREDENTIAL(field) || SHAPE_PUBLISHED(field, TOK) || SHAPE_PUBLISHED(field, PAT)) {
          leaks.push(label + ' -> ' + JSON.stringify(field.slice(0, 80)));
        }
      }
    }
  } finally {
    if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
    if (previousGh !== undefined) process.env.GH_TOKEN = previousGh;
  }
  assert.deepEqual(leaks, [], 'the shipped keyless pass published: ' + leaks.slice(0, 5).join(' | '));
});

test('ordinary prose is not reaped, and a separator outside the shape changes nothing', () => {
  // Direction (d). Every sentence here carries a keyword or a shape's prefix in ordinary use: the
  // widened class may only add alternative spellings of the SAME keyword, and every rule still
  // requires its value before anything is removed.
  const PROSE = [
    'The bearer credential held by the gateway is rotated weekly',
    'authorization is required for this endpoint and the header names the scheme',
    'Basic authentication is enabled for the mirror and the docs say so',
    'a ghastly p_ value and a github pat discussion in the notes',
    'the token is rotated by the operator; the api returns 200',
    'Bear with us while the er, gateway, comes back up',
  ];
  for (const text of PROSE) {
    assert.equal(redactSecrets(text, []), text, 'the notice half reaped prose: ' + JSON.stringify(text));
    assert.equal(redactCredentialShapes(text), text, 'the candidate half reaped prose: ' + JSON.stringify(text));
    assert.equal(redactSecrets(text, [SECRET, CRED]), text, 'the by-value half reaped prose: ' + JSON.stringify(text));
  }
  // A separator that stands OUTSIDE the shape is not read into it: the shape has to start where the
  // module's own boundary puts it, and a leading separator does not move that boundary.
  for (const [label, ch] of SEPARATORS) {
    const before = redactCredentialShapes(plainText('release: ' + ch + 'Bearer ' + CRED, 400));
    assert.ok(!ANY_CREDENTIAL(before), label + ' before the keyword published the credential');
    const after = redactCredentialShapes(plainText('release: Bearer ' + CRED + ch + ' and prose', 400));
    assert.ok(!ANY_CREDENTIAL(after), label + ' after the value published the credential');
  }
});

test('THE RECORDED BOUND, CORRECTED: a complete run is not extended, and a run below the rule minimum is removed across the separator', () => {
  // The prose guard, measured: once a separator has been SPACED it is indistinguishable from a word
  // boundary, so a run that already satisfies the rule cannot be read through without reaping the
  // prose after a real token ('Bearer tok_1 and this sentence' would lose its tail). The by-value half
  // KNOWS the value and removes it through every separator at both entry points; the keyless shape
  // pass removes the keyword and the run up to the separator and leaves the tail. Both halves of this
  // statement are pinned, so a later change either way moves this row rather than passing silently.
  // THE BELOW-MINIMUM HALF IS NOT THIS BOUND ANY MORE (Batch 100; the verification's F41-1): the old
  // record generalised the tail to every split position, and at a first run below the rule's own
  // minimum NOTHING was removed and the whole credential published. Those positions are asserted
  // closed at the bottom of this row, on both entry points, for every separator.
  const union = [CRED, SECRET];
  const separated = (ch) => 'the answer said the token is ' + CRED.slice(0, 12) + ch + CRED.slice(12) + ' and prose';
  for (const [label, ch] of SEPARATORS) {
    // The by-value half removes it whole, on BOTH entry points and in the assembled notice.
    assert.ok(!ANY_CREDENTIAL(redactSecrets(plainText(separated(ch), 400), union)),
      label + ': the collected value was not removed by value through the candidate pass');
    assert.ok(!ANY_CREDENTIAL(neutraliseNoticeText(redactSecrets(separated(ch), union))),
      label + ': the collected value was not removed by value through the notice pass');
    assert.ok(!ANY_CREDENTIAL(assembleNotice('rss', separated(ch), union, 1000)),
      label + ': the assembled notice published the collected value');
    // The keyless shape pass reads the keyword and the contiguous run after it. The separator the token
    // capture cannot cross is the one plainText SPACED: a control byte becomes a space, and a whitespace
    // character was already one, so the capture stops there and the TAIL is published -- that is the
    // bound. A separator that survives into the published text (the invisible class) is a token
    // character, so the run is swallowed whole and nothing is left: the bound is the spaced half only.
    const shaped = redactCredentialShapes(plainText('release: Bearer ' + CRED.slice(0, 12) + ch
      + CRED.slice(12) + ' and prose', 400));
    const spaced = plainText('a' + ch + 'b', 100) === 'a b';
    assert.ok(!shaped.includes(CRED), label + ': the keyless pass published the whole value');
    assert.ok(!shaped.includes(CRED.slice(0, 12)), label + ': the keyless pass did not remove the run');
    if (spaced) {
      assert.ok(shaped.includes(CRED.slice(12)),
        label + ': the recorded tail bound moved (the spaced separator no longer leaves the tail): '
        + JSON.stringify(shaped));
    } else {
      assert.ok(!shaped.includes(CRED.slice(12)),
        label + ': the surviving separator should have been swallowed with the run: ' + JSON.stringify(shaped));
    }
    // The SAME bound at a curated shape's body, which is contiguous for the same reason: the surface
    // split after 'gh' + 'p_abcdefgh' + separator + 'ijklmnop' and the shape pass removes the prefix plus the
    // body up to the separator, leaving the tail. It is asserted here so the bound is one statement
    // about the whole class and not a note about one rule.
    const body = redactCredentialShapes(plainText('a commit carried gh' + 'p_abcdefgh' + ch
      + 'ijklmnop end', 400));
    assert.ok(!body.includes(TOK.slice(0, 10)), label + ': the keyless pass did not remove the shape');
    assert.ok(body.includes('ijklmnop'), label + ': the recorded shape-body tail bound moved: ' + JSON.stringify(body));
    // THE CLOSED HALF: a run below the rule's own minimum. The credential is the WHOLE thing here --
    // nothing of it may publish, on either entry point or in the assembled notice.
    const below = {
      'Basic payload (first run 4)': 'release: Basic ' + B64.slice(0, 4) + ch + B64.slice(4) + ' and prose',
      'ghp_ body (first run 3)': 'a commit carried ' + TOK.slice(0, 7) + ch + TOK.slice(7) + ' end',
      'PAT body (first run 6)': 'a commit carried ' + PAT.slice(0, 17) + ch + PAT.slice(17) + ' end',
    };
    for (const [what, text] of Object.entries(below)) {
      assert.ok(!ANY_CREDENTIAL(redactCredentialShapes(plainText(text, 400))),
        label + ': the below-minimum position published ' + what + ': '
          + JSON.stringify(redactCredentialShapes(plainText(text, 400))));
      assert.ok(!ANY_CREDENTIAL(neutraliseNoticeText(redactSecrets(text, union))),
        label + ': the below-minimum position published ' + what + ' through the notice pass');
      assert.ok(!ANY_CREDENTIAL(assembleNotice('rss', text, union, 1000)),
        label + ': the below-minimum position published ' + what + ' in the assembled notice');
    }
  }
});

// THE JOIN INSIDE 'gh' IS EXERCISED (Batch 100; the closing sweep's F41-4). The shape rows above put the
// separator only BETWEEN the two literal parts ('gh'|'p_'), so replacing throughSeparators' own join
// with the literal 'gh' left the suite green. These rows split INSIDE each literal, at every
// internal offset, so the join is load-bearing.
test('every internal offset of a literal keyword or prefix is read through the class', () => {
  const rows = [];
  const splitEverywhere = (name, literal, build, value) => {
    for (let k = 1; k < literal.length; k += 1) {
      rows.push([name + ' at ' + k, String.fromCodePoint(0x7f), () => build(literal.slice(0, k), literal.slice(k)), value]);
    }
  };
  splitEverywhere('classic token keyword', 'gh', (a, b) => 'a commit carried ' + a + '\u007f' + b + 'p_abcdefghijklmnop end', TOK);
  splitEverywhere('github_pat_ prefix', 'github_pat_', (a, b) => 'a commit carried ' + a + '\u007f' + b
    + 'abcdefghijklmnopqrst end', PAT);
  splitEverywhere('Bearer keyword', 'Bearer', (a, b) => 'release: ' + a + '\u007f' + b + ' ' + CRED + ' end', CRED);
  splitEverywhere('Basic keyword', 'Basic', (a, b) => 'release: ' + a + '\u007f' + b + ' ' + B64 + ' end', B64);
  splitEverywhere('authorization keyword', 'authorization', (a, b) => 'the answer said ' + a + '\u007f' + b
    + ': ' + CRED + ' end', CRED);
  const leaks = [];
  for (const [name, ch, build, value] of rows) {
    const raw = build();
    const shown = raw.replace(ch, String.fromCodePoint(0x200b));
    if (ANY_CREDENTIAL(redactCredentialShapes(plainText(raw, 400)))
      || ANY_CREDENTIAL(neutraliseNoticeText(redactSecrets(raw, [])))
      || ANY_CREDENTIAL(assembleNotice('rss', raw, [], 1000))) {
      leaks.push(name + ' -> ' + JSON.stringify(shown));
    }
    void value;
  }
  assert.deepEqual(leaks, [], 'a literal keyword/prefix was not read through its own join: '
    + leaks.slice(0, 8).join('; '));
});
