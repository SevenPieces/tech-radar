// tests/authorization-value-extent.test.mjs
// The closing sweep's F32-1, F32-2 and F32-3, measured in both directions at once. The one
// credential-header reader must give up a whole value whose HEAD carries a credential - the scheme
// word is listed or not, the credential stands first or one whitespace gap in, the attribute list
// is comma-separated or whitespace-separated, and it may wrap across a line - and it must leave a
// value whose head is ordinary prose byte for byte. The rows the rule DOES reap are recorded here
// with their exact cost, so a later change moves the record rather than the line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';
import { assembleNotice } from '../scripts/collect.mjs';
import { SKILL_ROOT, shippedFiles } from './lib/shipped-files.mjs';
import {
  CREDENTIAL_SHAPES, KEYWORDS, PROSE_COST, PROSE_KEPT, PROSE_TAILS, SCHEME_WORDS,
} from './lib/authorization-corpus.mjs';

// The two entry points whose agreement is the property Batch 61 introduced: the credential-free
// pass the candidate pool is built with, and the shape pass the pool runs when a credential IS
// configured. They share one acceptance, so an empty value set makes them one function.
const PATHS = [
  ['the credential-free pass', (text) => redactSecrets(text, [])],
  ['the shape pass', (text) => redactCredentialShapes(text)],
];

test('the closing sweep F32-1 and F32-2: every credential shape goes, on both entry points', () => {
  let rows = 0;
  const leaked = [];
  for (const keyword of KEYWORDS) {
    for (const shape of CREDENTIAL_SHAPES) {
      const text = keyword + shape.value;
      rows += 1;
      for (const [name, redact] of PATHS) {
        const out = redact(text);
        for (const secret of shape.gone) {
          if (out.includes(secret)) leaked.push(name + ' | ' + shape.id + ' | ' + JSON.stringify(out));
        }
        assert.equal(redact(out), out,
          'the rewrite is not a fixed point on ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
      }
      assert.equal(redactSecrets(text, []), redactCredentialShapes(text),
        'the two entry points disagree about ' + JSON.stringify(text));
    }
  }
  assert.deepEqual(leaked, [], 'a credential shape was published');
  assert.equal(rows, KEYWORDS.length * CREDENTIAL_SHAPES.length,
    'the credential corpus changed size: ' + rows);
});

test('the closing sweep F32-3: the prose corpus is byte-identical, and the cost rows are recorded', () => {
  for (const text of PROSE_KEPT) {
    for (const [name, redact] of PATHS) {
      assert.equal(redact(text), text,
        name + ' reaped ordinary prose: ' + JSON.stringify(text) + ' -> ' + JSON.stringify(redact(text)));
    }
    assert.equal(redactSecrets(text, []), redactCredentialShapes(text),
      'the two entry points disagree about ' + JSON.stringify(text));
  }
  for (const row of PROSE_COST) {
    for (const [name, redact] of PATHS) {
      assert.equal(redact(row.text), row.out,
        name + ' moved the recorded cost of "' + row.id + '": got ' + JSON.stringify(redact(row.text))
        + ', recorded ' + JSON.stringify(row.out) + ' (' + row.why + ')');
    }
  }
});

test('the closing sweep F32-3: a scheme word gives up the token after it and no later word', () => {
  let rows = 0;
  for (const scheme of SCHEME_WORDS) {
    for (const tail of PROSE_TAILS) {
      const text = 'authorization: ' + scheme + ' ' + tail;
      const rest = tail.split(' ').slice(1).join(' ');
      rows += 1;
      for (const [name, redact] of PATHS) {
        const out = redact(text);
        assert.equal(out, '[redacted] ' + rest,
          name + ' changed what the scheme-word family costs: ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out));
        assert.equal(redact(out), out, 'not a fixed point: ' + JSON.stringify(out));
      }
    }
  }
  assert.equal(rows, SCHEME_WORDS.length * PROSE_TAILS.length,
    'the scheme-word family changed size: ' + rows);
});

// The notice seam. A source label that ends in the bare word 'authorization' is followed by the
// assembly's own ': ', and the detail is the shaper's diagnosis (an HTTP status or a mapped
// transport cause). The keyword IS read here - the label carries no '/' in front of it in the
// '?p=authorization' and 'github authorization' spellings - so the reader has to leave the seam
// byte for byte: the value behind it is prose ('HTTP 503 ...', 'request failed ...'), and a reader
// that consumed it would lose the run's only diagnosis. Measured at the cap floor the collector
// accepts (128), its shipped default (402) and a ceiling (1000).
test('the closing sweep F32-3: a notice whose label ends in authorization keeps its status and cause', () => {
  const sources = [
    'rss https://a.example/x?p=authorization',
    'rss https://a.example/authorization',
    'github authorization',
  ];
  const details = [
    'HTTP 503 for https://a.example/x',
    'request failed for https://a.example/x: could not resolve the host (curl exit 6)',
  ];
  let rows = 0;
  for (const cap of [128, 402, 1000]) {
    for (const source of sources) {
      for (const detail of details) {
        const line = source + ': ' + detail;
        const out = assembleNotice(source, detail, [], cap);
        rows += 1;
        assert.equal(out, line,
          'the notice seam was rewritten at cap ' + cap + ': ' + JSON.stringify(line) + ' -> ' + JSON.stringify(out));
        assert.equal(redactSecrets(out, []), out, 'the notice is not a fixed point of the removal pass');
        assert.ok(out.length <= cap, 'the notice passed its cap at ' + cap + ': ' + out.length);
      }
    }
  }
  assert.equal(rows, 18, 'the notice matrix changed size: ' + rows);
  // The same seam beside a credential: the label survives and the credential does not.
  const planted = assembleNotice('rss', 'authorization: Custom tok_' + '9f3a2c7d1e5b', [], 402);
  assert.ok(planted.includes('rss'), 'the source label was consumed: ' + JSON.stringify(planted));
  assert.ok(!planted.includes('tok_' + '9f3a2c7d1e5b'),
    'the credential standing in a notice was published: ' + JSON.stringify(planted));
});

// The property Batch 61 introduced and this round must not break: over every line of every file
// the reader receives, the credential-free pass and the shape pass publish the same text. The
// closing sweep measured it over 24,865 non-blank lines of the previous revision; this is the same
// comparison over the shipping set of this tree, and the line floor below fails if the walk ever
// returns a corpus too small to mean anything.
test('the two entry points agree over every shipped line', () => {
  const files = shippedFiles(SKILL_ROOT);
  let lines = 0;
  let changed = 0;
  const disagree = [];
  for (const rel of files) {
    const text = readFileSync(join(SKILL_ROOT, rel), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      lines += 1;
      const a = redactSecrets(line, []);
      const b = redactCredentialShapes(line);
      if (a !== b) disagree.push(rel + ': ' + line);
      if (a !== line) changed += 1;
    }
  }
  assert.deepEqual(disagree.slice(0, 5), [],
    'the two entry points disagree on ' + disagree.length + ' of ' + lines + ' lines');
  assert.ok(lines >= 20000, 'the shipped corpus is too small to judge: ' + lines + ' lines in ' + files.length + ' files');
  assert.ok(changed > 0, 'no shipped line changes, so the comparison proves nothing');
});
