// tests/mdtable.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTable, rowsAsObjects, readSettings, readDomains, readConfig } from '../scripts/lib/mdtable.mjs';

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
  const s = readSettings('tests/fixtures/config/settings.md');
  assert.equal(s.window_cap_weeks, 4);
  assert.equal(s.timezone, 'Asia/Shanghai');
  assert.match(s.discovery_hosts, /news\.ycombinator\.com/);
});

test('readDomains rejects a bad tier and a missing Chinese label', () => {
  assert.throws(() => readDomains('tests/fixtures/config/domains-bad-tier.md'), /bad tier/);
  assert.throws(() => readDomains('tests/fixtures/config/domains-no-zh.md'), /Chinese label/);
});

test('readDomains rejects duplicate keys', () => {
  assert.throws(() => readDomains('tests/fixtures/config/domains-dupe.md'), /duplicate domain key/);
});

test('readConfig returns all four tables', () => {
  const c = readConfig('tests/fixtures/config');
  assert.equal(c.domains.length, 2);
  assert.equal(c.settings.total_max_items, 45);
  assert.equal(c.sources.length, 1);
  assert.equal(c.watchlist.length, 1);
});
