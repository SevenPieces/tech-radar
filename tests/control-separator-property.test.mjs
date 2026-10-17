// tests/control-separator-property.test.mjs
// Closing sweep F39-1 (Medium, shipped-pipeline reach), Batch 93. The run had closed the F38-1
// class ONE BYTE AT A TIME -- U+0085 in the keyword bridge (Batch 88), then in plainText (Batch 88),
// then in the notice control pass (Batch 91) -- because the rule the three fixes shared was written
// as a fact about the NEL rather than as a rule about control bytes. The rule, stated whole: a byte
// that stands between two words in the text an upstream surface wrote is a word separator, and the
// pipeline has to keep the words as separate as the surface spelled them. Dropping such a byte glues
// the words it stood between; the words a candidate can carry are a credential keyword and its
// value, and every keyword gap requires at least one character, so a dropped byte publishes the
// credential whole. Measured first-hand on the frozen a6e2530 with a real collectAll and the
// suite's own stubbed transport (the sweep's p15 and its end-to-end section): 'auth=Basic' + U+009B
// + <base64> and 'Bearer' + U+009B + <token> were published BYTE FOR BYTE in the pool title, as were
// the U+0080 and U+009F spellings, where LF, CR, CRLF, LS, PS, NEL, SP and TAB all removed them --
// identically at the control revision 87bddfd, so the class was pre-existing.
//
// The fix is the whole rule, not the byte: net.mjs declares the control class once (CONTROL_
// CHARACTERS / CONTROL_PATTERN), plainText and neutraliseNoticeText both read it, and every control
// byte becomes the space that keeps the words apart. This file is the property over the whole byte
// range, so the class cannot be closed one byte at a time again. It drives the shipped pipeline
// (collectAll) as well as both exported entry points, and it asserts LF-equality where the rule is
// LF-parity, so a later change that spaces one byte and drops another fails here rather than in a
// hostile upstream's favour.
//
// One boundary this file does NOT claim: redactSecrets/redactCredentialShapes read their SOURCE
// text, and no keyword gap there reads a raw control byte -- the bridge is AUTH_INLINE_SPACE plus the
// five line terminators (net.mjs), by design, because those are the readings a surface's own
// spelling has. A control byte becomes readable at a gap only after the pass that publishes text has
// spaced it, which is why the assertions below drive plainText, neutraliseNoticeText and collectAll
// (the shipped path) rather than redactSecrets over a raw control byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plainText, redactSecrets, renderSeparatorMarks, CONTROL_CHARACTERS, CONTROL_PATTERN,
} from '../scripts/lib/net.mjs';
import { collectAll, neutraliseNoticeText, assembleNotice } from '../scripts/collect.mjs';

const LF = String.fromCharCode(10);
// The internal mark plainText records a non-ordinary separator with (Batch 101), and the ordinary
// word gaps it must NOT mark. Both are written here as the module states them; a drift in either
// moves this file.
const SEPARATOR_MARK = '\uE001';
// Batch 101: the ORDINARY word gap is the space and the line ends. A tab and the other C0
// whitespace controls are split evidence (a surface that writes one inside a credential is not
// writing the space between two words), so they are recorded as the mark like any other.
const ORDINARY_WORD_GAPS = new Set(['\n', '\r', ' ', '\u0085', '\u2028', '\u2029']);
const CRED = 'tok_' + '9f3a2c7d1e5b';
const B64 = Buffer.from('alice:' + 's3cr3tp4ssw0rd').toString('base64');
const SECRET = 's3cr3tp4ssw0rd';
// The class under test is the one the module names, not a range written a second time here.
const isControl = (cp) => CONTROL_PATTERN.test(String.fromCodePoint(cp));
const CONTROL_BYTES = [];
for (let cp = 0x00; cp <= 0xff; cp += 1) if (isControl(cp)) CONTROL_BYTES.push(cp);
const u = (cp) => 'U+' + cp.toString(16).padStart(4, '0');
const CREDENTIAL = (text) => text.includes(B64) || text.includes(CRED) || text.includes(SECRET);

test('plainText spaces every control byte exactly as it spaces LF, and no control survives', () => {
  assert.equal(CONTROL_CHARACTERS, '\u0000-\u001f\u007f-\u009f',
    'the named control class moved; this file pins the range it asserts over');
  // Batch 101: plainText RECORDS the separator it meets instead of losing it. A control byte that is
  // not an ordinary word gap becomes net.mjs's separator mark, which the publication view renders as
  // the space LF gets; the claim this row makes is about the PUBLISHED byte, so it is read through
  // that view, and the recording itself is asserted beside it (a row that lost the evidence would
  // pass here and fail the property file, so both halves are stated).
  const published = (raw) => renderSeparatorMarks(plainText(raw, 100));
  const lf = published('a' + LF + 'b');
  assert.equal(lf, 'a b', 'LF is the reference answer and it is one space');
  for (const cp of CONTROL_BYTES) {
    const ch = String.fromCharCode(cp);
    const out = published('a' + ch + 'b');
    assert.equal(out, lf, u(cp) + ' is not spaced as LF is: ' + JSON.stringify(out));
    assert.doesNotMatch(out, CONTROL_PATTERN,
      u(cp) + ' survived into published text: ' + JSON.stringify(out));
    // The evidence: an ordinary word gap stays the space it is, and every other class member is
    // recorded as the mark (never as the byte itself, which is what the publication forbids).
    const records = plainText('a' + ch + 'b', 100) === 'a' + SEPARATOR_MARK + 'b';
    const ordinary = ORDINARY_WORD_GAPS.has(ch);
    assert.equal(records, !ordinary,
      u(cp) + (ordinary ? ' is an ordinary word gap and was marked' : ' is split evidence and was not marked'));
  }
  assert.equal(CONTROL_BYTES.length, 0x20 + 0x21, 'the class is 0x00-0x1F plus 0x7F-0x9F');
});

test('the candidate field and the assembled notice read one control rule', () => {
  // The two sites read the same named class (net.mjs CONTROL_CHARACTERS), so no byte can be spaced
  // by one and dropped by the other -- which is exactly how F38-1 survived Batch 88 at the notice
  // pass until Batch 91.
  for (const cp of CONTROL_BYTES) {
    const ch = String.fromCharCode(cp);
    assert.equal(neutraliseNoticeText('a' + ch + 'b'), plainText('a' + ch + 'b', 100),
      u(cp) + ' is answered differently by the notice pass and the candidate pass');
  }
});

test('the published spelling of a credential behind a control byte is LF\'s own answer', () => {
  // The publish order for a candidate field is plainText first; for a notice detail it is
  // redactSecrets then neutraliseNoticeText. Both are driven here, at every control byte, against
  // the LF spelling of the same shape -- so the row is 'a control byte answers as LF does', not a
  // hand-written output that drifts.
  const shapes = [
    ['candidate: basic keyword gap', (s) => 'release notes: auth=Basic' + s + B64 + ' shipped'],
    ['candidate: bearer gap', (s) => 'commit msg: Bearer' + s + CRED + ' (rotated)'],
    ['candidate: authorization gap', (s) => 'header dump: authorization:' + s + CRED + ' then prose'],
    ['notice: authorization gap', (s) => 'authorization:' + s + CRED],
  ];
  const union = [SECRET, 'alice', CRED];
  const publishCandidate = (raw) => redactSecrets(plainText(raw, 400), union);
  const publishNotice = (raw) => neutraliseNoticeText(redactSecrets(raw, union));
  for (const [name, build] of shapes) {
    const lfAnswer = name.startsWith('notice')
      ? publishNotice(build(LF)) : publishCandidate(build(LF));
    assert.ok(!CREDENTIAL(lfAnswer),
      'the LF reference itself did not remove the credential: ' + JSON.stringify(lfAnswer));
    for (const cp of CONTROL_BYTES) {
      const ch = String.fromCharCode(cp);
      const out = name.startsWith('notice') ? publishNotice(build(ch)) : publishCandidate(build(ch));
      assert.ok(!CREDENTIAL(out),
        name + ' published the credential behind ' + u(cp) + ': ' + JSON.stringify(out));
      assert.equal(out, lfAnswer,
        name + ' does not answer ' + u(cp) + ' as LF does: ' + JSON.stringify(out));
    }
  }
  // The assembled notice, the seam a caller reaches without collectAll: the same claim through the
  // exported assembly, with the run's union, at the caps the standing notice class names.
  for (const cap of [128, 402, 1000]) {
    const lfNotice = assembleNotice('rss', 'authorization:' + LF + CRED, union, cap);
    assert.ok(!CREDENTIAL(lfNotice), 'the LF reference notice leaked: ' + JSON.stringify(lfNotice));
    for (const cp of CONTROL_BYTES) {
      const notice = assembleNotice('rss', 'authorization:' + String.fromCharCode(cp) + CRED, union, cap);
      assert.ok(!CREDENTIAL(notice),
        'the assembled notice published the credential behind ' + u(cp) + ' at cap ' + cap + ': '
        + JSON.stringify(notice));
    }
  }
});

test('the shipped keyless candidate pass publishes no credential behind any control byte', async () => {
  // The decisive reach: F39-1 was filed for the SHIPPED keyless default, where redactCredentialShapes
  // runs over every string field of every candidate because the run issued no credential. The run
  // here issues none (GITHUB_TOKEN is deleted, the target carries no query parameter and no userinfo)
  // and the feed title is the hostile spelling. Before Batch 93 this row published 'auth=Basic' +
  // U+009B + <base64> byte for byte; the assertion is that no control byte of the range does now.
  //
  // The scope is the control class and not all of 0x00-0xFF: a printable byte is not a separator the
  // design makes readable, so 'auth=Basic!<base64>' is glued by construction and no rule reads it.
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
  const leaks = [];
  try {
    for (const cp of CONTROL_BYTES) {
      const ch = String.fromCharCode(cp);
      const echoed = 'release notes: auth=Basic' + ch + B64 + ' shipped and Bearer' + ch + CRED;
      const pool = await collectAll(
        { settings, watchlist: [{ kind: 'rss', target: 'https://feeds.example/f.xml', domain: 'languages-runtimes', note: '' }] },
        { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z',
          net: { hostOf: (url) => new URL(url).host, isDiscoveryOnly: () => false, fetchText: async () => feed(echoed) } });
      const title = pool.candidates[0] ? pool.candidates[0].title : '';
      if (CREDENTIAL(title)) leaks.push(u(cp));
    }
  } finally {
    if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
    if (previousGh !== undefined) process.env.GH_TOKEN = previousGh;
  }
  assert.deepEqual(leaks, [],
    'the shipped keyless pass published the credential behind: ' + leaks.join(', '));
});
