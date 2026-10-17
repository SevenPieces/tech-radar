// tests/f39-3-byvalue-gap.test.mjs
// Closing sweep F39-3 (Low, module/exported seam), Batch 95. looseValue builds the by-value pattern
// that removes a collected value a server echoed with a whitespace control INSIDE it, and it joined
// the value's characters with '\\s*'. JavaScript's \\s is every whitespace character the module reads
// EXCEPT U+0085 NEXT LINE -- White_Space=Yes and one of the five AUTH_LINE_TERMINATORS -- so the one
// site in the by-value half answered a NEL differently from LF: a value echoed with a NEL inside it
// survived one redactSecrets pass where LF, CR, CRLF, LS, PS, SP and TAB all removed it, the
// assembled notice then published the value readably, and that notice was not a fixed point of the
// pass. Measured identically at the control revision 87bddfd, so pre-existing; the predecessor's
// closing sweep flagged the site and did not probe it, and Batch 88 fixed the four shape positions
// and left this one.
//
// The gap now reads '\\s\\u0085' -- the module's own separators -- so every one of them answers as LF
// does. This file pins the class at the by-value half and at the assembled notice, and pins the
// measurement that the fix moves no published byte for real inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { redactSecrets, SCHEME_GAP } from '../scripts/lib/net.mjs';
import { assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';

// The tracked-file walk the two corpus rows share, so the guard and the differential read one corpus.
async function corpusWalk() {
  const root = new URL('..', import.meta.url).pathname;
  const SKIP = new Set(['.git', 'node_modules', 'docs']);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && /\.(mjs|md|json|html|yml|txt)$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(root);
  assert.ok(files.length > 80, 'the corpus walk shrank: ' + files.length);
  return { files, root, relative };
}

const CRED = 'tok_' + '9f3a2c7d1e5b';
// The value split at a point inside a run the reader can see, so the pattern has to cross the
// separator to match it.
const split = (sep) => CRED.slice(0, 13) + sep + CRED.slice(13);
const SEPARATORS = [
  ['LF', String.fromCharCode(10)], ['CR', String.fromCharCode(13)],
  ['CRLF', String.fromCharCode(13) + String.fromCharCode(10)],
  ['LS', String.fromCharCode(0x2028)], ['PS', String.fromCharCode(0x2029)],
  ['NEL', String.fromCharCode(0x85)], ['SP', ' '], ['TAB', String.fromCharCode(9)],
  ['VT', String.fromCharCode(11)], ['FF', String.fromCharCode(12)],
  ['NBSP', String.fromCharCode(0xa0)], ['IDEO', String.fromCharCode(0x3000)],
];

test('the by-value gap removes a value split by every separator, NEL included', () => {
  // The LF answer is the reference: every other separator must produce it byte for byte.
  const reference = redactSecrets('the answer said the token is ' + split(String.fromCharCode(10)) + ' and then prose', [CRED]);
  assert.ok(!reference.includes(CRED.slice(0, 13)),
    'the LF reference did not remove the split value: ' + JSON.stringify(reference));
  for (const [name, sep] of SEPARATORS) {
    const out = redactSecrets('the answer said the token is ' + split(sep) + ' and then prose', [CRED]);
    assert.equal(out, reference, name + ' does not answer as LF does: ' + JSON.stringify(out));
  }
});

test('the assembled notice carries no value split by any separator and is a fixed point', () => {
  for (const [name, sep] of SEPARATORS) {
    const detail = 'the server echoed the token is ' + split(sep) + ' in the body';
    const notice = assembleNotice('rss', detail, [CRED], 1000);
    assert.ok(!notice.includes(CRED.slice(0, 13)) && !notice.includes(CRED.slice(13)),
      name + ' published the split value: ' + JSON.stringify(notice));
    assert.ok(notice.startsWith('rss: '), name + ' lost the notice source: ' + JSON.stringify(notice));
    assert.equal(redactSecrets(notice, [CRED]), notice,
      name + ' left a notice the run redaction rewrites: ' + JSON.stringify(notice));
  }
});

test('a corpus-wide GUARD: every shipped file answers the probe value cleanly through both boundaries', async () => {
  // RENAMED, HONESTLY (closing sweep F40-4). This row was named as the differential the fix rests on
  // and performs none: it computes ONE answer per file, never compares two, and CRED is a probe token
  // no corpus file contains, so it passes identically at the revision before the fix and cannot detect
  // a moved byte. It is renamed to what it is -- a corpus-wide guard that no shipped file publishes the
  // probe value through either boundary -- and the differential it claimed to be is the row below,
  // which compares the module's gap with the pre-fix gap on the same text.
  //
  // The corpus is walked with no child process, so the row holds with node alone on PATH; the ignored
  // working-material directories under docs/ are excluded, which is what a tracked-file walk produces
  // for the shipped set.
  const { files, root, relative } = await corpusWalk();
  for (const full of files) {
    const text = readFileSync(full, 'utf8');
    if (text.includes('\u0000')) continue;
    assert.equal(redactSecrets(text, [CRED]).includes(CRED), false,
      'a corpus file published the probe value: ' + relative(root, full));
    assert.equal(typeof neutraliseNoticeText(text), 'string',
      'the notice pass did not answer: ' + relative(root, full));
  }
});

test('the by-value gap IS the separator class, and the Batch-95 gap publishes a control- or invisible-split value', async () => {
  // THE DIFFERENTIAL (closing sweep F40-4): two answers over the same text, compared. The PREVIOUS
  // class is the one Batch 95 named -- '\s\u0085', the module's whitespace plus the NEL -- and Batch
  // 98 made the gap the module's ONE separator class, which adds every control byte and the
  // default-ignorable property. A narrow back to the previous class moves this row; the earlier
  // version of this file could not see that because it compared no two answers.
  const CURRENT_GAP = SCHEME_GAP.slice(1, -1);
  const PREVIOUS_GAP = '\\s\\u0085';
  const escape = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const removeWith = (text, value, gap) => text.replace(
    new RegExp([...value].map(escape).join('[' + gap + ']*'), 'gu'), '[redacted]');
  const splitBy = (sep) => CRED.slice(0, 13) + sep + CRED.slice(13);
  assert.notEqual(CURRENT_GAP, PREVIOUS_GAP,
    'the by-value gap is no wider than the class Batch 95 named, so this differential is inert');
  // The positive controls: a NEL is in BOTH classes (the direction Batch 95 closed), and a control
  // byte and an invisible character are in the module class ONLY (the direction Batch 98 closed).
  // The second half is what makes an empty corpus differential below a fact rather than an inert test.
  const CASES = [
    ['NEL, in both classes', String.fromCharCode(0x85), true],
    ['NUL, a control byte', String.fromCharCode(0x00), false],
    ['CSI, a C1 control byte', String.fromCharCode(0x9b), false],
    ['SHY, default-ignorable', String.fromCharCode(0xad), false],
    ['ZWSP, default-ignorable', String.fromCharCode(0x200b), false],
  ];
  for (const [name, sep, inBoth] of CASES) {
    const text = 'the answer said the token is ' + splitBy(sep) + ' and then prose';
    assert.ok(!removeWith(text, CRED, CURRENT_GAP).includes(CRED.slice(0, 13)),
      name + ': the module separator class did not remove the split value');
    assert.ok(!removeWith(text, CRED, CURRENT_GAP).includes(CRED.slice(13)),
      name + ': the module separator class left the value tail');
    if (inBoth) {
      assert.ok(!removeWith(text, CRED, PREVIOUS_GAP).includes(CRED.slice(0, 13)),
        name + ': the previous class should still remove this one');
    } else {
      assert.ok(removeWith(text, CRED, PREVIOUS_GAP).includes(CRED.slice(0, 13)),
        name + ': the previous class removed a separator Batch 98 added, so the differential is inert');
    }
    // The module's own answer is exactly the one built from its own separator class: the gap the fix
    // rests on IS that class, in the module and in this row.
    assert.equal(removeWith(text, CRED, CURRENT_GAP), redactSecrets(text, [CRED]),
      name + ': the module by-value gap is no longer the class SCHEME_GAP names');
  }
  // The corpus differential: the two classes find the same spans in every shipped file. This is a
  // real two-answer comparison; what it cannot show on its own is a fired detector, which is why the
  // positive control above is asserted first.
  const { files, root, relative } = await corpusWalk();
  const moved = [];
  for (const full of files) {
    const fileText = readFileSync(full, 'utf8');
    if (fileText.includes('\u0000')) continue;
    if (removeWith(fileText, CRED, CURRENT_GAP) !== removeWith(fileText, CRED, PREVIOUS_GAP)) {
      moved.push(relative(root, full));
    }
  }
  assert.deepEqual(moved, [], 'the wider gap moves a published byte in: ' + moved.join(', '));
});
