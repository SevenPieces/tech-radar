// tests/reference-completeness.test.mjs
// Every file under reference/ ships with the skill, so the two layouts a reader is handed --
// the repository layout in README.md and the architecture tree in docs/design.md -- must name
// every one of them. A new reference file that neither names is invisible in the documents the
// reader trusts, which is how the accepted-limits register came to be missing from both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_ROOT } from './lib/shipped-files.mjs';

const REFERENCE = 'reference';

// A layout row is a line that starts with the path and carries a description after it. A passing
// mention in prose -- "see reference/evidence.md for the markers" -- does not match, because it
// has a single space behind the path and continues the sentence; every listing pads to a column.
function layoutRow(spelling) {
  const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped + '\\s{2,}\\S');
}

function rows(file) {
  return readFileSync(join(SKILL_ROOT, file), 'utf8').split('\n').map((line) => line.trim());
}

const names = readdirSync(join(SKILL_ROOT, REFERENCE))
  .filter((name) => name.endsWith('.md'))
  .sort();

test('the reference directory holds at least one Markdown file', () => {
  assert.ok(names.length > 0, REFERENCE + '/ holds no Markdown file');
});

const LAYOUTS = [
  ['README.md', (name) => REFERENCE + '/' + name],
  ['docs/design.md', (name) => name],
];

for (const [file, spelling] of LAYOUTS) {
  test(file + ' names every file under reference/', () => {
    const lines = rows(file);
    const missing = names.filter((name) => !lines.some((line) => layoutRow(spelling(name)).test(line)));
    assert.deepEqual(missing, [], file + ' does not list: ' + missing.join(', '));
  });
}
