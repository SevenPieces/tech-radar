// scripts/lib/mdtable.mjs
// Markdown-table configuration reader for the tech-radar skill.
// Zero dependencies. A table starts at a line whose trimmed form begins with
// '|'; the separator row is skipped; tables inside fenced code blocks are not
// tables. Cells are trimmed, and a short row yields empty strings for the
// missing trailing cells.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// The settings that ship beside this module: the last resort for the chip cap when a
// caller carries no settings and the catalogue has no settings file of its own.
const SHIPPED_SETTINGS = fileURLToPath(new URL('../../config/settings.md', import.meta.url));

function positiveIntOf(settings, key) {
  const n = Number(settings?.[key]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// A cap that is present but unusable is a configuration error, not an absent one: falling
// through to the shipped value would run with a cap the configuration never asked for.
// Only a key that is genuinely absent resolves to null, so the caller can fall back.
function capOf(settings) {
  if (!settings || !Object.prototype.hasOwnProperty.call(settings, 'short_max_chars')) return null;
  const value = settings.short_max_chars;
  if (value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`short_max_chars is invalid in config/settings.md: ${JSON.stringify(value)}`);
  }
  return n;
}

// The chip cap is a quantity like every other one, so it is configuration and never a
// literal here. A caller may pass the settings object; a caller that does not gets the
// settings file read from the directory beside the catalogue it is reading; a fixture
// that writes only a catalogue falls back to the shipped settings.
export function shortCap(settings) {
  const explicit = capOf(settings);
  if (explicit) return explicit;
  const shipped = positiveIntOf(readSettings(SHIPPED_SETTINGS), 'short_max_chars');
  if (shipped) return shipped;
  throw new Error('short_max_chars is missing or invalid in config/settings.md');
}

export function readDomains(path, settings) {
  let cap = capOf(settings);
  if (!cap) {
    // The settings beside the catalogue are read only when the caller carries none; an
    // unreadable file leaves the reader's own resolution, an unusable value is named.
    let beside = null;
    try { beside = readSettings(join(dirname(path), 'settings.md')); } catch { beside = null; }
    cap = capOf(beside) ?? shortCap(null);
  }
  const rows = readTableObjects(path);
  const seen = new Set();
  for (const r of rows) {
    // U+0000 is the renderer's substitution sentinel, so a cell carrying one could rewrite
    // the authored text or leave a raw NUL in the published document. Every cell is checked
    // before any other rule, so the refusal names the character wherever it sits.
    for (const [column, value] of Object.entries(r)) {
      if (String(value).includes('\u0000')) {
        throw new Error(`U+0000 in the ${column} cell for ${r.key || '(no key)'}`);
      }
    }
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
      if (label.length > cap) throw new Error(`short label too long for ${r.key}: ${label} (short_max_chars ${cap})`);
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
