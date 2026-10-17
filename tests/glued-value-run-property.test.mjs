// tests/glued-value-run-property.test.mjs
// FINAL41's F41-1 and F41-2 (F41-1: a value run split below the rule's own minimum removed
// NOTHING, so the whole credential published in the shipped keyless pool title and summary; F41-2:
// the authorization keyword's own gap BEFORE ITS COLON read a different set, so an invisible
// separator there published the header's value).
//
// THE MODEL THIS FILE DRIVES, stated once (net.mjs states it at the separator class; this is the
// matrix that measures it): recognition happens in the GLUED view -- the text with a run of the one
// separator class deleted -- and publication keeps the SPACED view, with the recognised span
// removed from the spaced text across every separator it spans. A value run that already satisfies
// the rule is complete and is never extended (the prose guard); a value run that cannot satisfy the
// rule as it stands continues across ONE separator run into the next run of the rule's own value
// characters, and the span is removed whole.
//
// THE MATRIX: every shape -- Basic, Bearer, the authorization family (both spellings and the
// underscored dump spelling) and both curated vendor shapes -- split at EVERY position (inside the
// keyword, inside the prefix, at the prefix/body boundary, at the gap and inside the body at every
// offset), by EVERY separator of the class (the 65 control code points, the default-ignorable
// property's witnesses inside and above the BMP, the whitespace spellings and the five line ends),
// on both exported entry points, in the assembled notice at 128/402/1000 and in the shipped
// keyless collectAll (the shipped default: GITHUB_TOKEN and GH_TOKEN unset). Every cell must
// publish nothing of the credential: neither the value whole nor a recovery of it with only
// separators between its characters.
//
// ANTI-VACUITY. Three preconditions run before the matrix: the class pins its own membership (so a
// narrowed class moves this file rather than passing it), the detector is shown to SEE each value
// in a text that carries no keyword (so a row cannot pass because the criterion is blind), and the
// LF spelling of every position is asserted to remove on every surface (so a matrix over a position
// that removes nothing cannot pass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plainText, redactSecrets, redactCredentialShapes, CONTROL_CHARACTERS, INVISIBLE_SEPARATOR,
  SCHEME_GAP, SCHEME_GAP_PATTERN,
} from '../scripts/lib/net.mjs';
import { collectAll, assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';

// Every credential below is assembled from fragments, so this file's own source carries no
// credential-shaped string (the suite's publishing guard reads it).
const B64 = Buffer.from('alice:' + 's3cr3tp4ssw0rd').toString('base64');
const CRED = 'tok_' + '9f3a2c7d1e5b';
const CLASSIC = 'ghp_' + 'abcdefghijklmnop';
const PAT = 'github_pat_' + 'abcdefghijklmnopqrst';
const CLASSIC_BODY = 'abcdefghijklmnop';
const PAT_BODY = 'abcdefghijklmnopqrst';
const SECRET = 's3cr3tp4ssw0rd';
const LF = String.fromCharCode(10);
const u = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

// THE SEPARATOR RANGE: the module's ONE class, enumerated. The expectation is the module's own
// membership wherever the range is the class, so widening or narrowing it moves this file with it.
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

// A credential is PUBLISHED when it is present whole, or when its characters can be read back in
// order with only class separators between them -- the reader's own criterion, and stricter than
// 'the substring is present'.
const escapeChar = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const recoverable = (text, value) => new RegExp([...value].map(escapeChar).join(SCHEME_GAP + '*'), 'u').test(text);
const PUBLISHED = (text, value) => text.includes(value) || recoverable(text, value);
const b64Tail = B64.slice(8);
const ANY_CREDENTIAL = (text) => PUBLISHED(text, CRED) || PUBLISHED(text, B64) || PUBLISHED(text, b64Tail)
  || PUBLISHED(text, CLASSIC_BODY) || PUBLISHED(text, PAT_BODY) || text.includes(SECRET);

// THE POSITIONS. Each builder takes one separator and returns the text; the value is what must not
// be published. Body rows are generated at every offset, so a later change that closes one offset
// and opens another moves this file.
const POSITIONS = [];
const add = (name, build, value) => POSITIONS.push({ name, build, value });
add('Basic keyword interior', (s) => 'release: Ba' + s + 'sic ' + B64 + ' and prose', B64);
add('Basic gap', (s) => 'release: Basic' + s + B64 + ' and prose', B64);
for (let k = 1; k < B64.length; k += 1) {
  add('Basic payload at ' + k, (s) => 'release: Basic ' + B64.slice(0, k) + s + B64.slice(k) + ' and prose', B64);
}
add('classic token keyword interior', (s) => 'a commit carried g' + s + 'hp_' + CLASSIC_BODY + ' end', CLASSIC);
add('classic token prefix interior', (s) => 'a commit carried gh' + s + 'p_' + CLASSIC_BODY + ' end', CLASSIC);
add('classic token prefix/body boundary', (s) => 'a commit carried ghp_' + s + CLASSIC_BODY + ' end', CLASSIC);
for (let k = 0; k < CLASSIC_BODY.length; k += 1) {
  add('classic token body at ' + k, (s) => 'a commit carried ghp_' + CLASSIC_BODY.slice(0, k) + s
    + CLASSIC_BODY.slice(k) + ' end', CLASSIC);
}
add('PAT keyword interior', (s) => 'a commit carried github' + s + '_pat_' + PAT_BODY + ' end', PAT);
add('PAT prefix interior', (s) => 'a commit carried github_pat' + s + '_' + PAT_BODY + ' end', PAT);
add('PAT prefix/body boundary', (s) => 'a commit carried github_pat_' + s + PAT_BODY + ' end', PAT);
for (let k = 0; k < PAT_BODY.length; k += 1) {
  add('PAT body at ' + k, (s) => 'a commit carried github_pat_' + PAT_BODY.slice(0, k) + s
    + PAT_BODY.slice(k) + ' end', PAT);
}
add('Bearer keyword interior', (s) => 'release: Bear' + s + 'er ' + CRED + ' and prose', CRED);
add('Bearer gap', (s) => 'release: Bearer' + s + CRED + ' and prose', CRED);
for (let k = 1; k < CRED.length; k += 1) {
  add('Bearer value at ' + k, (s) => 'release: Bearer ' + CRED.slice(0, k) + s + CRED.slice(k) + ' and prose', CRED);
}
add('authorization name interior', (s) => 'the answer said authoriz' + s + 'ation: ' + CRED + ' end', CRED);
add('authorization pre-colon gap', (s) => 'the answer said authorization' + s + ': ' + CRED + ' end', CRED);
add('authorization post-colon gap', (s) => 'the answer said authorization:' + s + CRED + ' end', CRED);
add('authorisation pre-colon gap', (s) => 'the answer said authorisation' + s + ': ' + CRED + ' end', CRED);
add('HTTP_AUTHORIZATION pre-colon gap', (s) => 'dump: HTTP_AUTHORIZATION' + s + ': ' + CRED + ' end', CRED);
for (let k = 1; k < CRED.length; k += 1) {
  add('authorization value at ' + k, (s) => 'the answer said authorization: ' + CRED.slice(0, k) + s
    + CRED.slice(k) + ' end', CRED);
}

const candidate = (raw) => redactCredentialShapes(plainText(raw, 400));
const notice = (raw) => redactSecrets(raw, []);
const CAPS = [128, 402, 1000];

test('anti-vacuity: the class, the detector and the LF reference are not empty', () => {
  // The class this file measures is the module's own class, pinned as a string.
  assert.equal(SCHEME_GAP,
    '[' + CONTROL_CHARACTERS + '\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff'
      + '\\r\\n\\u2028\\u2029\\u0085' + INVISIBLE_SEPARATOR + ']',
    'the separator class moved; this file pins the set every row below is measured over');
  assert.equal(SEPARATORS.length, 100, 'the separator range changed size: ' + SEPARATORS.length);
  for (const [label, ch] of SEPARATORS) {
    assert.ok(SCHEME_GAP_PATTERN.test(ch), label + ' is measured by this file and is not in the class');
  }
  // The detector SEES each value in a text that carries no keyword: a row cannot pass because the
  // criterion is blind.
  for (const value of [CRED, B64, CLASSIC_BODY, PAT_BODY]) {
    assert.ok(ANY_CREDENTIAL('the answer said ' + value + ' today'),
      'the detector cannot see ' + value + ' in plain text');
  }
  // The LF spelling of every position removes on every surface: a position that removes nothing at
  // its own reference cannot be evidence about a separator.
  for (const position of POSITIONS) {
    const raw = position.build(LF);
    assert.ok(!ANY_CREDENTIAL(candidate(raw)), position.name + ': the LF reference published it through the candidate pass');
    assert.ok(!ANY_CREDENTIAL(notice(raw)), position.name + ': the LF reference published it through the notice pass');
    for (const cap of CAPS) {
      assert.ok(!ANY_CREDENTIAL(assembleNotice('rss', raw, [], cap)),
        position.name + ': the LF reference published it in the assembled notice at ' + cap);
    }
  }
});

test('the matrix: every shape x position x separator removes on both entry points and the assembly', () => {
  const union = [CRED, SECRET];
  const leaks = [];
  for (const [label, ch] of SEPARATORS) {
    for (const position of POSITIONS) {
      const raw = position.build(ch);
      if (ANY_CREDENTIAL(candidate(raw))) leaks.push(position.name + ' / candidate / ' + label);
      if (ANY_CREDENTIAL(redactSecrets(plainText(raw, 400), union))) {
        leaks.push(position.name + ' / candidate+union / ' + label);
      }
      if (ANY_CREDENTIAL(notice(raw))) leaks.push(position.name + ' / notice / ' + label);
      if (ANY_CREDENTIAL(neutraliseNoticeText(notice(raw)))) {
        leaks.push(position.name + ' / neutralised notice / ' + label);
      }
      for (const cap of CAPS) {
        if (ANY_CREDENTIAL(assembleNotice('rss', raw, union, cap))) {
          leaks.push(position.name + ' / assembly@' + cap + ' / ' + label);
        }
      }
    }
  }
  assert.deepEqual(leaks, [], 'the credential was published at: ' + leaks.slice(0, 12).join('; '));
});

test('the shipped keyless collectAll publishes nothing behind any separator at any position', async () => {
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
  const fields = (pool) => (pool.candidates[0]
    ? [pool.candidates[0].title, pool.candidates[0].summary || ''] : []);
  const runPool = (text) => collectAll(
    { settings, watchlist: [{ kind: 'rss', target: 'https://feeds.example/f.xml', domain: 'languages-runtimes', note: '' }] },
    { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z',
      net: { hostOf: (url) => new URL(url).host, isDiscoveryOnly: () => false, fetchText: async () => feed(text) } });
  const leaks = [];
  try {
    for (const [label, ch] of SEPARATORS) {
      for (const position of POSITIONS) {
        for (const field of fields(await runPool(position.build(ch)))) {
          if (ANY_CREDENTIAL(field)) {
            leaks.push(position.name + ' / shipped / ' + label + ' -> ' + JSON.stringify(field.slice(0, 90)));
          }
        }
      }
    }
    // The anti-vacuity precondition for the pool itself: the LF reference row produces its two
    // fields and removes, so 'no credential in the title' cannot pass on an empty pool.
    const lfFields = fields(await runPool('release: Bear' + LF + 'er ' + CRED + ' Ba' + LF + 'sic ' + B64
      + ' authoriz' + LF + 'ation: ' + CRED + ' gh' + LF + 'p_' + CLASSIC_BODY + ' github' + LF + '_pat_' + PAT_BODY));
    assert.equal(lfFields.length, 2, 'the LF reference row produced no candidate at all');
    for (const field of lfFields) {
      assert.ok(!ANY_CREDENTIAL(field), 'the LF reference row published the credential: ' + JSON.stringify(field));
    }
  } finally {
    if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
    if (previousGh !== undefined) process.env.GH_TOKEN = previousGh;
  }
  assert.deepEqual(leaks, [], 'the shipped keyless pass published: ' + leaks.slice(0, 6).join(' | '));
});

test('the published bytes are the spaced text with the recognised span removed', () => {
  // The MAP BACK, in bytes: for a control byte the candidate pass sees the SPACED form, for an
  // invisible separator it sees the byte itself, and the span removed is the same one either way --
  // the keyword/prefix, the separator and the value run, replaced by the one marker. This is what
  // 'the published view keeps the spaced form' means, and it is asserted on both entry points.
  const ZWSP = String.fromCodePoint(0x200b);
  // candidate: the SPACED view with the span removed (plainText spaces the control byte). notice:
  // the text as it arrived with the span removed -- the shipped notice assembly spaces the control
  // bytes after this pass, which is why the two forms differ in the separator byte alone. The Basic
  // keyword is not a credential and keeps its letters (and its separator); the curated shapes and
  // the authorization header go whole.
  const rows = [
    ['release: Ba' + LF + 'sic ' + B64 + ' end', 'release: Ba sic [redacted] end', 'release: Ba' + LF + 'sic [redacted] end'],
    ['release: Ba' + ZWSP + 'sic ' + B64 + ' end', 'release: Ba' + ZWSP + 'sic [redacted] end', 'release: Ba' + ZWSP + 'sic [redacted] end'],
    ['a commit carried ghp_abc' + LF + 'defghijklmnop end', 'a commit carried [redacted] end', 'a commit carried [redacted] end'],
    ['a commit carried ghp_abc' + ZWSP + 'defghijklmnop end', 'a commit carried [redacted] end', 'a commit carried [redacted] end'],
    ['a commit carried github_pat_abcdef' + LF + 'ghijklmnopqrst end', 'a commit carried [redacted] end', 'a commit carried [redacted] end'],
    ['the answer said authorization' + ZWSP + ': ' + CRED + ' end', 'the answer said [redacted]', 'the answer said [redacted]'],
  ];
  for (const [raw, candidateExpected, noticeExpected] of rows) {
    assert.equal(candidate(raw), candidateExpected, 'the candidate pass published '
      + JSON.stringify(candidate(raw)) + ' for ' + JSON.stringify(raw));
    assert.equal(notice(raw), noticeExpected, 'the notice pass published '
      + JSON.stringify(notice(raw)) + ' for ' + JSON.stringify(raw));
  }
});

test('the prose guard: a complete value run is not extended, and an ordinary word is not a fragment', () => {
  // The one-run bound, in the direction that protects prose. A value run the spaced text already
  // satisfies is complete: the word after a real token survives. An ordinary word after a keyword
  // is not a value fragment, so it cannot be swallowed.
  const rows = [
    ['a commit carried ' + CLASSIC + ' and prose', ' and prose'],
    ['a commit carried ' + PAT + ' and prose', ' and prose'],
    ['release: Bearer ' + CRED + ' and this sentence', 'and this sentence'],
    ['release: Basic ' + B64 + ' and then prose', 'and then prose'],
  ];
  for (const [raw, keep] of rows) {
    const out = candidate(raw);
    assert.ok(out.includes(keep), 'the candidate pass reaped prose after a complete value: '
      + JSON.stringify(raw) + ' -> ' + JSON.stringify(out));
    assert.ok(!ANY_CREDENTIAL(out), 'the candidate pass published the value: ' + JSON.stringify(out));
    assert.ok(notice(raw).includes(keep), 'the notice pass reaped prose after a complete value: '
      + JSON.stringify(notice(raw)));
  }
  const prose = [
    'The bearer credential held by the gateway is rotated weekly',
    'authorization: required for this feed',
    'the basic setup is documented',
    'a Bearer token1 is required',
    'Bearer tokens are rotated every 7 days by the gateway',
    'Basic authentication is enabled for the mirror and the docs say so',
    'a ghastly p_ value and a github pat discussion in the notes',
    'the documentation pipeline and the architecture of the release notes',
    'Bearer token1 and this sentence is ordinary prose',
  ];
  for (const text of prose) {
    assert.equal(candidate(text), text, 'the candidate pass reaped prose: ' + JSON.stringify(text));
    assert.equal(notice(text), text, 'the notice pass reaped prose: ' + JSON.stringify(text));
  }
});
