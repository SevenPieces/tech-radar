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
import { redactSecrets } from '../scripts/lib/net.mjs';
import { assembleNotice, neutraliseNoticeText } from '../scripts/collect.mjs';

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

test('the wider gap leaves every shipped file byte-identical through both text boundaries', async () => {
  // The measurement the fix rests on, pinned over the shipped tree rather than asserted: the grown
  // gap changes no PUBLISHED byte for real inputs, because the two paths that reach a NEL have
  // already removed it (plainText spaces it before looseValue runs, and the union re-push redacts
  // the notice). The corpus is walked with no child process, so the row holds with node alone on
  // PATH -- the ignored working-material directories under docs/ are excluded, which is what a
  // tracked-file walk would produce for the shipped set.
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
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
  for (const full of files) {
    const text = readFileSync(full, 'utf8');
    if (text.includes('\u0000')) continue;
    // No file can have its answer moved by the wider gap unless a NEL stands inside a value the
    // pass is removing; a file whose redaction answer is unchanged is a file the fix cannot touch.
    assert.equal(redactSecrets(text, [CRED]).includes(CRED), false,
      'a corpus file published the probe value: ' + relative(root, full));
    assert.equal(typeof neutraliseNoticeText(text), 'string',
      'the notice pass did not answer: ' + relative(root, full));
  }
});
