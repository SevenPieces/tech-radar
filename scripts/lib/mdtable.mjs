// scripts/lib/mdtable.mjs
// Markdown-table configuration reader for the tech-radar skill.
// Zero dependencies. A table starts at a line whose trimmed form begins with
// '|'; the separator row is skipped; tables inside fenced code blocks are not
// tables. Cells are trimmed, and a short row yields empty strings for the
// missing trailing cells.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FENCE = /^\s*(?:```|~~~)/;
const SEPARATOR = /^:?-{2,}:?$/;
const KEY = /^[a-z0-9-]+$/;
const TIERS = new Set(['core', 'watch']);

function cells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

export function parseTable(md) {
  let header = null;
  let rows = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    // A fence before any table opens a code block to skip. A fence reached once
    // the header is known ends the first table, so the first table always wins.
    if (FENCE.test(line)) { if (header) break; fenced = !fenced; continue; }
    if (fenced) continue;
    const c = cells(line);
    if (!c) { if (header) break; continue; }
    if (c.every((x) => SEPARATOR.test(x))) continue;
    if (!header) { header = c; continue; }
    rows.push(c);
  }
  if (!header) throw new Error('no Markdown table found');
  return { header, rows };
}

export function rowsAsObjects(md) {
  const { header, rows } = parseTable(md);
  return rows.map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

export function readTableObjects(path) {
  return rowsAsObjects(readFileSync(path, 'utf8'));
}

function coerce(value) {
  if (value === '') return value;
  const n = Number(value);
  return Number.isFinite(n) && String(n) === value ? n : value;
}

export function readSettings(path) {
  const out = {};
  for (const r of readTableObjects(path)) {
    if (r.key) out[r.key] = coerce(r.value);
  }
  return out;
}

export function readDomains(path) {
  const rows = readTableObjects(path);
  const seen = new Set();
  for (const r of rows) {
    if (!KEY.test(r.key)) throw new Error(`bad domain key: ${r.key}`);
    if (seen.has(r.key)) throw new Error(`duplicate domain key: ${r.key}`);
    seen.add(r.key);
    if (!TIERS.has(r.tier)) throw new Error(`bad tier for ${r.key}: ${r.tier}`);
    if (!/[\u4e00-\u9fff]/.test(r.label_zh)) throw new Error(`missing Chinese label for ${r.key}`);
    if (!r.cluster) throw new Error(`missing cluster for ${r.key}`);
    // The short column drives the topic-navigation chips, so its own rules are configuration
    // rules: a chip is a shortcut, must be attribute-safe, and two chips reading the same
    // word are ambiguous. An absent column is allowed - the renderer falls back to a clause.
    if (r.short !== undefined && String(r.short).trim() !== '') {
      const label = String(r.short).trim();
      if (label.length > 18) throw new Error(`short label too long for ${r.key}: ${label}`);
      if (/[<>"']/.test(label)) throw new Error(`short label must be attribute-safe for ${r.key}: ${label}`);
    }
  }
  const shorts = new Map();
  for (const r of rows) {
    const label = String(r.short ?? '').trim().toLowerCase();
    if (label === '') continue;
    if (shorts.has(label)) {
      throw new Error(`duplicate short label ${JSON.stringify(label)} for ${r.key} and ${shorts.get(label)}`);
    }
    shorts.set(label, r.key);
  }
  return rows;
}

export function readConfig(dir) {
  return {
    domains: readDomains(join(dir, 'domains.md')),
    settings: readSettings(join(dir, 'settings.md')),
    sources: readTableObjects(join(dir, 'sources.md')),
    watchlist: readTableObjects(join(dir, 'watchlist.md')),
  };
}
