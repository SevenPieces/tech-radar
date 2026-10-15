// tests/feasibility.test.mjs
// Regression guard between the source registry and the probe evidence behind it.
// Fixture-free by design: it reads the two real shipped files, so the guard cannot
// drift from them. The rule it enforces is the one the probe table promises -- a row the
// registry marks 'fetchable: yes' is a row somebody probed -- so adding a 'yes' row
// without a matching probe entry in reference/feasibility.md fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTableObjects } from '../scripts/lib/mdtable.mjs';

const SOURCES = fileURLToPath(new URL('../config/sources.md', import.meta.url));
const FEASIBILITY = fileURLToPath(new URL('../reference/feasibility.md', import.meta.url));

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// readTableObjects returns the first table of a file. In both files that first
// table is the one this guard is about: the registry, and the probe table.
const sources = readTableObjects(SOURCES);
const probes = readTableObjects(FEASIBILITY);
const probeText = readFileSync(FEASIBILITY, 'utf8');

const entryFor = new Map(probes.map((row) => [row.source, row]));

test('reference/feasibility.md states the probe date and the table carries it', () => {
  assert.ok(probes.length > 0, 'the probe table in reference/feasibility.md is empty');
  const stated = /probe\s+date\s*:?\s*\**\s*(\d{4}-\d{2}-\d{2})/i.exec(probeText);
  assert.ok(stated, 'reference/feasibility.md does not state a probe date');
  const dates = new Set(probes.map((row) => String(row['probe date'] ?? '').trim()));
  assert.ok(
    dates.has(stated[1]),
    `the stated probe date ${stated[1]} appears in no row of the probe table`,
  );
});

test('every fetchable: yes row has a probe entry carrying a probe date', () => {
  const yes = sources.filter((row) => row.fetchable === 'yes');
  assert.ok(yes.length > 0, 'config/sources.md has no fetchable: yes row to check');
  const missing = [];
  const undated = [];
  for (const row of yes) {
    const entry = entryFor.get(row.source);
    if (!entry) { missing.push(row.source); continue; }
    const date = String(entry['probe date'] ?? '').trim();
    if (!DATE.test(date)) undated.push(`${row.source} -> "${date}"`);
  }
  assert.deepEqual(
    missing,
    [],
    'config/sources.md rows marked fetchable: yes with no probe entry in reference/feasibility.md: '
      + missing.join(' | '),
  );
  assert.deepEqual(
    undated,
    [],
    'probe entries whose probe date is not YYYY-MM-DD: ' + undated.join(' | '),
  );
});

test('every probe entry names a source the registry carries', () => {
  const known = new Set(sources.map((row) => row.source));
  const orphans = probes.filter((row) => !known.has(row.source)).map((row) => row.source);
  assert.deepEqual(
    orphans,
    [],
    'probe entries naming a source that config/sources.md does not carry: ' + orphans.join(' | '),
  );
});
