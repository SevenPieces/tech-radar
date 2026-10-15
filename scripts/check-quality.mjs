#!/usr/bin/env node
// scripts/check-quality.mjs
// The quality gate. Zero dependencies. Prints every violation with its line
// number and exits 5 if there is at least one failure; warnings never fail a run.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from './lib/mdtable.mjs';
import { hostOf, isDiscoveryOnly } from './lib/net.mjs';
import { storyKey } from './update-state.mjs';
import { externalAssets } from './lib/assets.mjs';

// The configuration ships with the skill, so the default is the config directory
// beside this script: the documented commands work from any working directory.
const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));

const USAGE = `usage: check-quality.mjs <input.md> --plan <plan.json> [--config <dir>] [--html <path>]

  <input.md>        the digest Markdown to check
  --plan <path>     required: the JSON that 'update-state.mjs plan' prints
  --config <dir>    configuration directory (default: the config/ directory next
                    to this script)
  --html <path>     the rendered HTML, checked for external assets
  --pool <path>     the collector pool JSON; when given, the coverage note must
                    carry the line "Collector notices: <n>" with the pool's count
  -h, --help        print this usage and exit

Exit codes: 0 quality gate passed, 2 input, plan, config, --html or --pool file not
found, unreadable or not what it claims to be, 5 the gate failed.`;

// Design 4.3 gives a quiet week a recorded stand-in line, so a reader can tell
// "nothing warranted a deep dive" from "the writer forgot to write one".
export const FEATURED_STANDIN = 'Nothing this week warranted a deep dive.';

const ITEM = /^-\s+\*\*(.+?)\*\*\s+—\s+([\s\S]*)$/;
// A link destination may contain balanced parentheses (Wikipedia-style URLs are the common
// case); [^)]+ truncated them at the first ')' and made the gate read a different URL than
// the renderer drew. One level of nesting is supported, as in render-html.mjs.
const SRC = /\[src:([^\]]+?)\s+(\d{4}-\d{2}-\d{2}[^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/;
// A status flag is a token: its '#' must not be glued to a word character, so it opens the
// text or follows whitespace or punctuation. Without this boundary the gate read 'C#new' in
// prose as a flag while the renderer drew no status tag, so an item could pass the gate
// carrying no tag at all. Both flag scans below use the same boundary as the renderer's
// FLAG_BOUNDARY and the neutraliser's STATUS_FLAG, so the three agree on what a flag is.
const FLAG_BOUNDARY = '(?<!\\w)#';
const MARKER = new RegExp('\\[src:[^\\]]*\\]\\((?:[^()\\s]|\\([^()\\s]*\\))*\\)|\\[alt:[^\\]]*\\]\\((?:[^()\\s]|\\([^()\\s]*\\))*\\)|\\[prov:[a-z-]+\\]|' + FLAG_BOUNDARY + '(?:new|followup|developing|watch)\\b', 'g');
const CITATION_LINK = /\[(?:src|alt):[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*\)/g;
const PROV = /\[prov:[a-z-]+\]/g;
const STATUS = new RegExp(FLAG_BOUNDARY + '(new|followup|developing|watch)\\b', 'g');

// A digest written on another platform carries CRLF line endings; every parser
// normalises them, because \r left in place makes the heading and item anchors match
// nothing at all.
function normalizeNewlines(md) {
  return String(md ?? '').replace(/\r\n?/g, '\n');
}

// The item grammar lives in exactly two sections (output contract, Items): '## Core
// domains' and '## Watch domains - notable this week'. The featured deep dive, the
// quiet line, '## Coming up', the coverage note and '## Sources' are prose, so a
// catalogue heading that reappears there does not turn its bullets into items.
function isCoreSection(heading) {
  return /^core\s+domains\b/i.test(String(heading ?? '').trim());
}

function isWatchNotableSection(heading) {
  const h = String(heading ?? '').trim();
  return /^watch\s+domains\b/i.test(h) && !/\bquiet\b/i.test(h);
}

function isDomainSection(heading) {
  return isCoreSection(heading) || isWatchNotableSection(heading);
}

// The status flag is the trailing status token outside the citation machinery.
// Reading the raw body let a #new inside a cited URL satisfy the rule, and let a
// prose mention of #followup fail an item that carries its flag correctly.
function statusTokens(body) {
  const clean = body.replace(CITATION_LINK, ' ').replace(PROV, ' ');
  return [...clean.matchAll(STATUS)].map((m) => m[1]);
}

// The prose of an item is what the language rule judges: the headline and the
// summary, with the citation, provenance and status machinery removed. The
// outlet name inside [src:...] is not part of the item's language.
function itemProse(body) {
  return body.replace(MARKER, ' ');
}

// The body of the section whose heading matches name, bounded by the next level-2
// heading. It is read line by line because a section body may legitimately start
// with a blank line, which a lazy regex over '$' swallows.
// Every level-2 heading, in order.
function sectionHeadings(md) {
  return normalizeNewlines(md).split('\n')
    .map((line) => /^##\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => m[1].trim());
}

// The first section whose heading matches a predicate, as { heading, text }.
function findSection(md, predicate) {
  const lines = normalizeNewlines(md).split('\n');
  let heading = null;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^##\s/.test(lines[i])) continue;
    if (start >= 0) return { heading, text: lines.slice(start, i).join('\n') };
    const title = lines[i].replace(/^##\s+/, '').trim();
    if (predicate(title)) { heading = title; start = i + 1; }
  }
  return start >= 0 ? { heading, text: lines.slice(start).join('\n') } : null;
}

// The body of the section whose heading names the given words, in order and
// separated by any whitespace: '## Coverage  note' and '## Coverage\tnote' are the
// same heading as '## Coverage note'. A section body may legitimately start with a
// blank line, so sections are read line by line rather than with a lazy regex.
function sectionText(md, name) {
  const words = String(name).trim().split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const found = findSection(md, (title) => new RegExp(`\\b${words}\\b`, 'i').test(title));
  return found ? found.text : '';
}

// Every level-3 heading with the section it sits in, its line number, and the name
// before the bilingual separator. The section matters: a heading under '## Coming up'
// is not a domain heading, and a deep-dive headline that happens to contain a
// catalogue name is not one either.
function parseHeadingRecords(md) {
  const records = [];
  let section = '';
  normalizeNewlines(md).split('\n').forEach((line, i) => {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) { section = h2[1].trim(); return; }
    const h3 = /^###\s+(.*)$/.exec(line);
    if (!h3) return;
    const label = h3[1].trim();
    records.push({
      line: i + 1,
      section,
      label,
      name: label.split('·')[0].trim(),
      inDomainSection: isDomainSection(section),
    });
  });
  return records;
}

// The level-3 heading labels, in order.
function parseHeadings(md) {
  return parseHeadingRecords(md).map((r) => r.label);
}

// Items are the bullets under a level-3 heading inside a domain section. A bullet in
// the featured deep dive or under '## Coming up' is prose. A heading that is not in
// the catalogue still collects its items - the reference documents a warning for it
// and its items count against the ceiling - and the heading may be a catalogue name
// or, by mistake, a catalogue key; both are reported by check().
export function parseItems(md) {
  const items = [];
  let section = '';
  let domain = '';
  let collect = false;
  const lines = normalizeNewlines(md).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) { section = h2[1].trim(); domain = ''; collect = false; continue; }
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      domain = h3[1].split('·')[0].trim();
      collect = isDomainSection(section);
      continue;
    }
    const m = ITEM.exec(line);
    if (!m || !collect) continue;
    const itemLine = i + 1;
    // Design 4.3 draws an item as the headline line plus an indented citation
    // continuation line, and the frozen grammar also permits the one-line form.
    // The item is the bullet plus every indented line that follows it.
    const parts = [m[2]];
    while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) {
      i += 1;
      parts.push(lines[i].trim());
    }
    const body = parts.join(' ').trim();
    const src = SRC.exec(body);
    const tokens = statusTokens(body);
    // The flag is the last token that is #new or #followup. #developing and #watch are
    // additive and never decide it, so '#new #developing' is still new and the earlier
    // tokens stay prose; a token list with neither status yields no flag at all.
    const flags = tokens.filter((t) => t === 'new' || t === 'followup');
    items.push({
      line: itemLine, section, domain, title: m[1], body,
      src: src ? { outlet: src[1].trim(), date: src[2].trim(), url: src[3] } : null,
      prov: [...body.matchAll(/\[prov:([a-z-]+)\]/g)].map((x) => x[1]),
      flags: flags.length ? [flags[flags.length - 1]] : [],
      statusTokens: tokens,
      // The language rule judges the headline and the summary together.
      cjk: /[\u4e00-\u9fff]/.test(`${m[1]} ${itemProse(body)}`),
    });
  }
  return items;
}

// Bullets that look like items - a bullet marker followed by a bold headline - but do
// not match the grammar are otherwise invisible: silently not an item, uncounted, and
// with no signal that the digest lost a line.
function malformedItemLines(md) {
  const out = [];
  let collect = false;
  normalizeNewlines(md).split('\n').forEach((line, i) => {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) { collect = isDomainSection(h2[1].trim()); return; }
    if (/^###\s/.test(line)) return;
    if (!collect) return;
    if (!/^\s*(?:[-*+]|\d+\.)\s+\*\*/.test(line)) return;
    if (ITEM.test(line)) return;
    out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

// The floor for a run. The ceiling is global because it is about readability, while
// the floor is about completeness, so it scales with the share of the catalogue a
// scoped run covers: total_min_items scaled by that share, rounded up, never below
// one, and never above total_min_items. A multi-domain run would otherwise be able to
// ship fewer items than it has sections, so its floor also asks for one item per
// covered domain plus one - as far as the configured maximum allows, which is why a
// scope whose clamp binds sits at total_min_items. A single-domain run is a probe and
// is not forced to pad; a run covering the whole catalogue, or none, keeps the
// configured floor unchanged.
export function scopedMinItems(settings, catalogueSize, perDomain) {
  const total = Number(settings.total_min_items);
  const covered = perDomain && typeof perDomain === 'object' ? Object.keys(perDomain).length : 0;
  if (covered === 0 || covered >= catalogueSize) return total;
  if (covered === 1) return 1;
  const scaled = Math.ceil((total * covered) / catalogueSize);
  return Math.min(total, Math.max(1, scaled, covered + 1));
}

// Does the registry name the outlet a digest cited? A row names its source and may
// list alternatives separated by commas; a digest cites the short name it saw, so
// the match is case-insensitive and uses the leading token of each alternative,
// matched as a whole word: the row 'arXiv cs.AR listing' covers an item cited as
// 'arXiv', and 'NVIDIA newsroom and developer blog' covers 'NVIDIA developer blog'.
// Requiring the row's whole string would warn on every normal collector citation,
// and a bare substring test would let the row 'Go releases' cover 'Django blog'.
function tokenIn(text, token) {
  const wordish = (c) => c !== '' && /[a-z0-9]/.test(c);
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) {
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + token.length] ?? '';
    if (!wordish(before) && !wordish(after)) return true;
  }
  return false;
}

// The coverage note records how many collector notices the run carried. The phrase
// is matched case-insensitively with any surrounding whitespace or punctuation, but
// the number itself must be exact.
const NOTICE_LINE = /collector\s+notices\s*:?\s*[*_`"'(\[]*\s*(\d+)/i;

function reportedNoticeCount(text) {
  const m = NOTICE_LINE.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

// The duplicate check is the documented story key - the normalised title plus the host
// (reference/state-schema.md) - which is exactly what mergeRun collapses on. Adding the
// URL path let two items that share a story key ship through the gate; the merge then
// stored one entry and labelled the brand-new one a followup. Design 4.4 makes a shared
// story key a gate failure, so the gate must key on the same thing the merge does.
function dedupeKey(title, url) {
  return storyKey(title, url);
}

// The documented enum. A value outside it - a typo, a capital variance, an empty
// string - used to disable the featured-section rule with no signal at all.
const DEEP_DIVE_VALUES = ['when-warranted', 'always', 'never'];

function deepDiveProblem(settings) {
  const value = String(settings?.deep_dive ?? '');
  if (DEEP_DIVE_VALUES.includes(value)) return null;
  return `deep_dive is ${JSON.stringify(settings?.deep_dive)}, which is not one of ${DEEP_DIVE_VALUES.join(', ')}`;
}

// The plan JSON is an input like any other: a missing or malformed window or a label
// that is not a string would silently disable the window and label rules, so the CLI
// names the reason and exits 2 instead.
function planProblem(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return 'the plan is not an object';
  if (!plan.window || typeof plan.window !== 'object' || Array.isArray(plan.window)) return 'the plan has no window object';
  for (const key of ['since', 'until']) {
    const value = plan.window[key];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return `the plan window.${key} is not a date`;
  }
  if (typeof plan.label !== 'string' || plan.label.trim() === '') return 'the plan label is not a string';
  // perDomain decides which core headings and quiet lines a run answers for, so an entry
  // that is null or otherwise not an object must be named here rather than read as "not
  // covered" by one rule and "covered" by another, which disabled both at once.
  if (plan.perDomain !== undefined) {
    if (!plan.perDomain || typeof plan.perDomain !== 'object' || Array.isArray(plan.perDomain)) {
      return 'the plan perDomain is not an object';
    }
    for (const [key, value] of Object.entries(plan.perDomain)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return `the plan perDomain.${key} is not an object`;
      }
    }
  }
  return null;
}

// The gate's budget rules are arithmetic, and Number(undefined) is NaN: every comparison
// against NaN is false, so one deleted settings row turns a rule into a no-op while the
// gate still prints QUALITY: PASS. Five budget rules and the discovery-host rule were
// disabled that way. Like update-state's positiveInt, the gate refuses the configuration
// and names the key instead of reporting a clean run.
const GATE_QUANTITIES = ['core_max_items', 'watch_max_items', 'watch_notable_max', 'total_min_items', 'total_max_items'];

function settingsProblem(settings) {
  for (const key of GATE_QUANTITIES) {
    const raw = settings?.[key];
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return `${key} must be a positive integer, got ${JSON.stringify(raw)}`;
    }
  }
  const hosts = String(settings?.discovery_hosts ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (hosts.length === 0) {
    return `discovery_hosts must be a non-empty comma-separated list of host names, got ${JSON.stringify(settings?.discovery_hosts)}`;
  }
  return null;
}

export function registeredOutlet(outlet, sources) {
  const cited = String(outlet ?? '').trim().toLowerCase();
  if (!cited) return false;
  return sources.some((row) => String(row.source ?? '')
    .split(',')
    .map((alt) => alt.trim().toLowerCase())
    .filter(Boolean)
    .some((alt) => {
      const token = alt.split(/\s+/)[0];
      return Boolean(token) && tokenIn(cited, token);
    }));
}

// The language rule applies when the citation names a Chinese-registered source.
// It matches a whole alternative name (or its leading token as a whole word), not a
// substring: a substring test misses a short-form citation such as 'Qwen' for the row
// 'DeepSeek, Qwen release blogs' and trips on an unrelated name such as 'DeepSeekX'.
function zhSourceCited(outlet, config) {
  const cited = String(outlet ?? '').trim().toLowerCase();
  if (!cited) return false;
  return config.sources
    // 'zh', 'zh-CN', 'zh-Hans': the column is a language tag, so a prefix match.
    .filter((s) => String(s.lang ?? '').trim().toLowerCase().startsWith('zh'))
    .some((row) => String(row.source ?? '')
      .split(',')
      .map((alt) => alt.trim().toLowerCase())
      .filter(Boolean)
      .some((alt) => cited === alt || tokenIn(cited, alt.split(/\s+/)[0])));
}

export function check(md, config, plan, opts = {}) {
  const failures = [];
  const warnings = [];
  const s = config.settings;
  const hosts = String(s.discovery_hosts).split(',').map((x) => x.trim()).filter(Boolean);
  md = normalizeNewlines(md);
  const items = parseItems(md);
  const headingRecords = parseHeadingRecords(md);
  const domainHeadings = headingRecords.filter((r) => r.inDomainSection);
  const catalogueByName = new Map(config.domains.map((d) => [d.domain, d]));
  const catalogueByKey = new Map(config.domains.map((d) => [d.key, d]));
  const keyOf = Object.fromEntries(config.domains.map((d) => [d.domain, d.key]));
  const tierOf = Object.fromEntries(config.domains.map((d) => [d.domain, d.tier]));
  const perDomain = {};
  let watchItems = 0;

  for (const it of items) {
    if (!it.src) { failures.push(`line ${it.line}: item has no [src:OUTLET DATE](url)`); continue; }
    const day = it.src.date.slice(0, 10);
    // A plan that carries perDomain knows when each domain was last covered, so the
    // item answers to its own domain window; a domain the plan does not cover falls
    // back to the global window, exactly as before.
    const domainSince = plan.perDomain?.[keyOf[it.domain]]?.since ?? plan.window?.since;
    if (domainSince && day < domainSince.slice(0, 10)) {
      failures.push(`line ${it.line}: published ${day} is before the window`);
    }
    if (plan.window?.until && day > plan.window.until.slice(0, 10)) {
      failures.push(`line ${it.line}: published ${day} is after the window`);
    }
    if (it.prov.length !== 1) failures.push(`line ${it.line}: expected exactly one provenance marker, found ${it.prov.length}`);
    const status = it.flags.filter((f) => f === 'new' || f === 'followup');
    if (status.length !== 1) failures.push(`line ${it.line}: expected exactly one of #new or #followup`);
    else if (it.statusTokens.length > 1) {
      warnings.push(`line ${it.line}: ${it.statusTokens.length} status tokens; the trailing #${status[0]} is read as the flag and the earlier ones as prose`);
    }
    if (isDiscoveryOnly(it.src.url, hosts)) failures.push(`line ${it.line}: discovery-only host ${hostOf(it.src.url)} may not be cited`);
    if (zhSourceCited(it.src.outlet, config) && !it.cjk) {
      failures.push(`line ${it.line}: language rule — Chinese source ${it.src.outlet} produced a Latin-only item`);
    }
    perDomain[it.domain] = (perDomain[it.domain] ?? 0) + 1;
    if (tierOf[it.domain] === 'watch') watchItems += 1;
    if (!tierOf[it.domain]) warnings.push(`line ${it.line}: domain ${it.domain} is not in the catalogue`);
    if (!registeredOutlet(it.src.outlet, config.sources)) {
      warnings.push(`line ${it.line}: outlet ${it.src.outlet} is not in config/sources.md`);
    }
  }

  for (const bad of malformedItemLines(md)) {
    warnings.push(`line ${bad.line}: bullet looks like an item but does not match the item grammar: ${bad.text}`);
  }

  for (const [domain, n] of Object.entries(perDomain)) {
    const ceiling = tierOf[domain] === 'watch' ? Number(s.watch_max_items) : Number(s.core_max_items);
    if (n > ceiling) failures.push(`domain ${domain}: ${n} items exceeds the ceiling of ${ceiling}`);
  }
  if (watchItems > Number(s.watch_notable_max)) {
    failures.push(`watch domains contributed ${watchItems} items, over watch_notable_max ${s.watch_notable_max}`);
  }
  const catalogueSize = config.domains.length;
  const floor = scopedMinItems(s, catalogueSize, plan.perDomain);
  const coveredCount = plan.perDomain && typeof plan.perDomain === 'object' ? Object.keys(plan.perDomain).length : 0;
  if (items.length < floor) {
    failures.push(coveredCount > 0 && coveredCount < catalogueSize
      ? `${items.length} items is below the scoped floor of ${floor} for a run covering ${coveredCount} of ${catalogueSize} domains`
      : `${items.length} items is below total_min_items ${floor}`);
  }
  if (items.length > Number(s.total_max_items)) failures.push(`${items.length} items is above total_max_items ${s.total_max_items}`);

  const keys = new Map();
  const named = new Set();
  for (const it of items) {
    if (!it.src) continue;
    const k = dedupeKey(it.title, it.src.url);
    if (!keys.has(k)) { keys.set(k, it.line); continue; }
    // One violation per story key: a run of items that all collapse into the same story
    // is named once, against the earlier line the group first appeared on.
    if (named.has(k)) continue;
    named.add(k);
    failures.push(`line ${it.line}: duplicate story key ${k} with line ${keys.get(k)}`);
  }

  // Design 4.4: a quiet core domain keeps its heading with an explicit quiet line,
  // so it can never vanish silently. A plan that names the domains a run covered
  // (a focus or catch-up run) requires only those. An empty perDomain object is
  // not a claim of "nothing covered": it is a plan that would otherwise fail open,
  // so it is treated as unscoped and every core domain is required.
  const planned = plan.perDomain && typeof plan.perDomain === 'object' ? Object.keys(plan.perDomain) : [];
  const scoped = planned.length > 0;
  // One predicate for both rules: a domain the plan names is covered, whatever its entry
  // holds, so a malformed entry cannot read as "not covered" and disable a rule.
  const covered = (d) => !scoped || planned.includes(d.key);
  for (const d of config.domains.filter((x) => x.tier === 'core' && covered(x))) {
    if (!domainHeadings.some((r) => r.name === d.domain && isCoreSection(r.section))) {
      failures.push(`core domain ${d.domain} has no section heading; a quiet core domain keeps its heading and says so`);
    }
  }
  // Design 4.4: a domain heading keeps its bilingual label. Only headings that name a
  // catalogue domain inside a domain section are held to it, so a featured deep dive
  // titled after a domain is not failed for having no Chinese label.
  for (const r of domainHeadings) {
    const row = catalogueByName.get(r.name);
    if (row?.label_zh && !r.label.includes(row.label_zh)) {
      failures.push(`bilingual label: heading "${r.label}" is missing ${row.label_zh}`);
    }
  }
  // A heading written with the catalogue key instead of the domain name otherwise
  // surfaces as an unrelated pile of failures (no items, no heading). Name it.
  for (const r of domainHeadings) {
    const byKey = catalogueByKey.get(r.name);
    if (byKey) {
      failures.push(`line ${r.line}: heading "${r.label}" names the catalogue key "${r.name}"; write the domain name "${byKey.domain}" instead`);
    }
  }

  // The label appears twice in a well-formed digest: once in the header and once
  // in the coverage note. Only the coverage note counts here, so a note that
  // drifted from the header is caught rather than masked by the header.
  const note = findSection(md, (title) => /\bcoverage\s+note\b/i.test(title));
  const noteText = note ? note.text : '';
  if (!note) {
    failures.push(`coverage note: no section heading matches "## Coverage note"; headings found: ${sectionHeadings(md).join(' | ') || 'none'}`);
  } else if (plan.label && !noteText.includes(plan.label)) {
    failures.push('coverage note: the window label is not repeated verbatim');
  }
  // A degraded run must not pass silently: when the pool is supplied, the coverage
  // note has to carry the collector notice count it recorded.
  if (opts.pool) {
    const notices = Array.isArray(opts.pool.notices) ? opts.pool.notices : [];
    const reported = reportedNoticeCount(noteText);
    if (notices.length > 0 && reported === null) {
      failures.push(`degraded run: the collector recorded ${notices.length} notice(s), so the coverage note must carry the line "Collector notices: ${notices.length}"`);
    } else if (reported !== null && reported !== notices.length) {
      failures.push(`coverage note: "Collector notices: ${reported}" does not match the pool's ${notices.length} notice(s)`);
    }
  }
  // The quiet line is scoped like the core headings: a run answers for the watch
  // domains it covered, and a weekly run (no perDomain) still answers for all.
  // The quiet line is the recognised watch-domains-quiet section, not the first
  // heading anywhere that happens to contain the word "quiet".
  const quiet = findSection(md, (title) => isWatchNotableSection(title) === false
    && /^watch\s+domains\b/i.test(title.trim()) && /\bquiet\b/i.test(title));
  const quietText = quiet ? quiet.text : '';
  for (const d of config.domains.filter((x) => x.tier === 'watch' && covered(x))) {
    const produced = perDomain[d.domain] ?? 0;
    if (produced === 0 && !quietText.includes(d.domain)) {
      failures.push(`quiet line: watch domain ${d.domain} is absent from both the digest and the quiet line`);
    }
  }
  const htmlPath = opts.htmlPath;
  if (htmlPath && existsSync(htmlPath)) {
    if (externalAssets(readFileSync(htmlPath, 'utf8'))) {
      failures.push('HTML references an external asset, so it would break off-network');
    }
  }
  const featured = /##\s+Featured this week/i.test(md);
  // The contract expects a deep dive to name its primary source, and the rendered card can
  // only draw its headline link, origin pill and dot from what the prose cites. A warning,
  // not a failure: what warrants a deep dive is a judgement, not a regex.
  if (featured) {
    const featuredBody = (findSection(md, (title) => /^featured\b/i.test(title)) ?? { text: '' }).text;
    // The same shape the renderer can actually use: an outlet, a date and an http(s) URL. A
    // date-less or non-http citation passes a looser test while the card still ships with no
    // headline link and no origin pill, which is the case this warning exists to catch.
    if (!SRC.test(featuredBody) && !featuredBody.includes(FEATURED_STANDIN)) {
      warnings.push('the featured deep dive names no usable source: a card can link its headline and show an origin pill only when the prose carries a [src:OUTLET DATE](url) with a date and an http(s) URL');
    }
  }
  const deepDiveProblemMessage = deepDiveProblem(s);
  if (deepDiveProblemMessage) {
    failures.push(deepDiveProblemMessage);
  } else if (s.deep_dive === 'always' && !featured) {
    failures.push('deep_dive is always, but the digest has no "## Featured this week" section');
  } else if (s.deep_dive === 'when-warranted' && !featured && !md.includes(FEATURED_STANDIN)) {
    failures.push(`deep_dive is when-warranted, so a digest with no "## Featured this week" section must carry the line "${FEATURED_STANDIN}"`);
  } else if (s.deep_dive === 'never' && featured) {
    warnings.push('deep_dive is never, but the digest carries a "## Featured this week" section');
  }
  return { failures, warnings };
}

export function parseArgs(argv) {
  const known = new Set(['--plan', '--config', '--html', '--pool']);
  const out = { input: null, plan: null, config: CONFIG_DIR, html: null, pool: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      if (out.input) throw new Error(`unexpected argument: ${a}`);
      out.input = a;
      continue;
    }
    if (!known.has(a)) throw new Error(`unknown flag: ${a}`);
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    // An empty value is a shell variable that expanded to nothing: rejecting it stops
    // '--html ""' from silently turning the self-containment check off.
    if (String(v).trim() === '') throw new Error(`empty value for ${a}`);
    i += 1;
    if (a === '--plan') out.plan = v;
    else if (a === '--config') out.config = v;
    else if (a === '--html') out.html = v;
    else if (a === '--pool') out.pool = v;
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`check-quality: ${err.message}`);
    console.error(USAGE);
    process.exitCode = 2;
    return 2;
  }
  if (!opts.input) {
    console.error('check-quality: missing <input.md>');
    console.error(USAGE);
    process.exitCode = 2;
    return 2;
  }
  let md;
  try {
    md = readFileSync(opts.input, 'utf8');
  } catch (err) {
    console.error(`check-quality: cannot read ${opts.input}: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  if (!opts.plan) {
    console.error('check-quality: missing required --plan');
    console.error(USAGE);
    process.exitCode = 2;
    return 2;
  }
  let plan;
  try {
    plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
  } catch (err) {
    console.error(`check-quality: cannot read plan ${opts.plan}: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  const planIssue = planProblem(plan);
  if (planIssue) {
    console.error(`check-quality: cannot use plan ${opts.plan}: ${planIssue}`);
    process.exitCode = 2;
    return 2;
  }
  // A --html path that does not exist, is not a file, or cannot be read is a typo or a
  // permission problem, not a pass: silently skipping the check would disable the
  // self-containment rule for the whole run. Each case is a named exit 2; a directory
  // used to pass the existence test and die on the read with an EISDIR stack trace.
  if (opts.html) {
    let stat = null;
    try { stat = statSync(opts.html); } catch { stat = null; }
    if (!stat) {
      console.error(`check-quality: --html file not found: ${opts.html}`);
      process.exitCode = 2;
      return 2;
    }
    if (!stat.isFile()) {
      console.error(`check-quality: --html is not a file: ${opts.html}`);
      process.exitCode = 2;
      return 2;
    }
    try {
      readFileSync(opts.html, 'utf8');
    } catch (err) {
      console.error(`check-quality: cannot read --html ${opts.html}: ${err.message}`);
      process.exitCode = 2;
      return 2;
    }
  }
  // The pool is read defensively: a missing, unreadable or malformed file is an input
  // error, never a silently absent check.
  let pool = null;
  if (opts.pool) {
    let raw;
    try {
      raw = readFileSync(opts.pool, 'utf8');
    } catch (err) {
      console.error(`check-quality: cannot read pool ${opts.pool}: ${err.message}`);
      process.exitCode = 2;
      return 2;
    }
    try {
      pool = JSON.parse(raw);
    } catch (err) {
      console.error(`check-quality: cannot parse pool ${opts.pool}: ${err.message}`);
      process.exitCode = 2;
      return 2;
    }
    if (!pool || typeof pool !== 'object' || Array.isArray(pool)) {
      console.error(`check-quality: pool ${opts.pool} is not an object`);
      process.exitCode = 2;
      return 2;
    }
    if (pool.notices !== undefined && !Array.isArray(pool.notices)) {
      console.error(`check-quality: pool ${opts.pool} has a notices field that is not an array`);
      process.exitCode = 2;
      return 2;
    }
  }
  let config;
  try {
    config = readConfig(opts.config);
  } catch (err) {
    console.error(`check-quality: cannot read config ${opts.config}: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  // A missing or unusable budget setting is a configuration error, not a quietly
  // disabled rule: the CLI names the key and exits 2 like the other invalid-setting paths.
  const settingsIssue = settingsProblem(config.settings);
  if (settingsIssue) {
    console.error(`check-quality: ${settingsIssue}`);
    process.exitCode = 2;
    return 2;
  }
  // An unsupported deep_dive value is a configuration error, not a quietly disabled
  // rule: the CLI says so and exits 2 like the other invalid-setting paths.
  const deepDiveIssue = deepDiveProblem(config.settings);
  if (deepDiveIssue) {
    console.error(`check-quality: ${deepDiveIssue}`);
    process.exitCode = 2;
    return 2;
  }
  const { failures, warnings } = check(md, config, plan, { htmlPath: opts.html, pool });
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const f of failures) console.log(`FAIL: ${f}`);
  console.log(failures.length ? `QUALITY: FAIL (${failures.length})` : 'QUALITY: PASS');
  if (failures.length) {
    process.exitCode = 5;
    return 5;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
