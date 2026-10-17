// tests/mdtable.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable, rowsAsObjects, readSettings, readDomains, readConfig, shortCap } from '../scripts/lib/mdtable.mjs';

// Every fixture is resolved against this file, never against the working directory, so the
// suite passes from any cwd.
const FIXTURES = fileURLToPath(new URL('./fixtures/config/', import.meta.url));
const scratch = () => mkdtempSync(join(tmpdir(), 'tech-radar-mdtable-'));

test('parseTable finds the first pipe table and its separator row', () => {
  const md = [
    '# Title',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '| 3 | 4 |',
  ].join('\n');
  const t = parseTable(md);
  assert.deepEqual(t.header, ['a', 'b']);
  assert.deepEqual(t.rows, [['1', '2'], ['3', '4']]);
});

test('parseTable ignores tables inside fenced code blocks', () => {
  const md = [
    '```',
    '| not | a | table |',
    '|---|---|---|',
    '```',
    '| real | table |',
    '|---|---|',
    '| x | y |',
  ].join('\n');
  assert.deepEqual(parseTable(md).header, ['real', 'table']);
});

test('parseTable keeps the first table when a fence follows it with no blank line', () => {
  const md = [
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '```',
    '| not | a | table |',
    '|---|---|---|',
    '```',
    '| x | y |',
    '|---|---|',
    '| 3 | 4 |',
  ].join('\n');
  const t = parseTable(md);
  assert.deepEqual(t.header, ['a', 'b']);
  assert.deepEqual(t.rows, [['1', '2']]);
});

test('rowsAsObjects maps header names onto cells and tolerates short rows', () => {
  const md = '| a | b | c |\n|---|---|---|\n| 1 | 2 |\n';
  assert.deepEqual(rowsAsObjects(md), [{ a: '1', b: '2', c: '' }]);
});

test('readSettings coerces numeric values and keeps strings', () => {
  const s = readSettings(join(FIXTURES, 'settings.md'));
  assert.equal(s.window_cap_weeks, 4);
  assert.equal(s.timezone, 'Asia/Shanghai');
  assert.match(s.discovery_hosts, /news\.ycombinator\.com/);
});

test('readDomains rejects a bad tier and a missing Chinese label', () => {
  assert.throws(() => readDomains(join(FIXTURES, 'domains-bad-tier.md')), /bad tier/);
  assert.throws(() => readDomains(join(FIXTURES, 'domains-no-zh.md')), /Chinese label/);
});

test('readDomains rejects duplicate keys', () => {
  assert.throws(() => readDomains(join(FIXTURES, 'domains-dupe.md')), /duplicate domain key/);
});

test('readConfig returns all four tables', () => {
  const c = readConfig(FIXTURES);
  assert.equal(c.domains.length, 2);
  assert.equal(c.settings.total_max_items, 45);
  assert.equal(c.sources.length, 1);
  assert.equal(c.watchlist.length, 1);
});

// Regression test: the reader validated truthiness, not the character class, so a catalogue
// cell carrying U+0000 was accepted. The renderer substitutes its counts through a U+0000
// sentinel and refuses a digest that carries one, so a NUL in a cell could rewrite the
// authored text or leave a raw NUL in the published document.
test('readDomains refuses a catalogue cell that carries U+0000', () => {
  const dir = scratch();
  const write = (cluster) => {
    const path = join(dir, 'domains.md');
    writeFileSync(path, [
      '| key | domain | short | label_zh | cluster | tier | why |',
      '|---|---|---|---|---|---|---|',
      '| ai-llm | AI / LLM | AI | 人工智能 / 大模型 | ' + cluster + ' | core | models |',
      '| quantum | Quantum technologies | Quantum | 量子技术 | AI and compute | watch | quantum |',
      '',
    ].join('\n'));
    return path;
  };
  assert.equal(readDomains(write('AI and compute')).length, 2, 'a clean catalogue still reads');
  assert.throws(() => readDomains(write('\u0000d-ai-llm\u0000')), /U\+0000|NUL/i,
    'a cell carrying U+0000 is refused');
  assert.throws(() => readDomains(write('A\u0000B')), /U\+0000|NUL/i,
    'a cell carrying U+0000 between printable characters is refused too');
  rmSync(dir, { recursive: true, force: true });
});

// Regression test: a short_max_chars that did not parse fell through to the shipped cap, so
// a mistyped setting was silently ignored instead of named. An absent value still resolves
// to the shipped cap, which is the fallback the renderer relies on.
test('a short_max_chars that is present but unusable is refused, not silently replaced', () => {
  assert.equal(shortCap({ short_max_chars: 20 }), 20, 'a usable value is used as given');
  assert.ok(shortCap(undefined) > 0, 'no value at all still resolves to the shipped cap');
  assert.ok(shortCap({}) > 0, 'a caller without the key still resolves to the shipped cap');
  for (const bad of ['eighteen', 0, -3, 2.5, '']) {
    assert.throws(() => shortCap({ short_max_chars: bad }), /short_max_chars/,
      'short_max_chars=' + JSON.stringify(bad) + ' must be named, not ignored');
  }
});
