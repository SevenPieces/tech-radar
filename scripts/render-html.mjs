#!/usr/bin/env node
// scripts/render-html.mjs
// Markdown digest -> one self-contained HTML file. Zero dependencies.
// Inline CSS and JS only; the result opens correctly from file:// offline.
import { randomBytes } from 'node:crypto';
import {
  accessSync, chmodSync, constants, existsSync, lstatSync, readFileSync, readlinkSync,
  realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readDomains, readSettings, shortCap } from './lib/mdtable.mjs';
import { externalAssets } from './lib/assets.mjs';
import { INVISIBLE_SEPARATOR } from './lib/net.mjs';

// The configuration ships with the skill, so the default is the config directory
// beside this script, spelled exactly as collect.mjs spells it: the documented
// commands work from any working directory.
const DEFAULT_CONFIG = fileURLToPath(new URL('../config/', import.meta.url));

const USAGE = `usage: render-html.mjs <input.md> --out <path> [--config <dir>]

  <input.md>        the digest Markdown to render
  --out <path>      the HTML file to write
  --config <dir>    configuration directory (default: the config/ directory next
                    to this script)
  -h, --help        print this usage and exit

Exit codes: 0 OK, 2 input or config not found or unreadable, 4 the output could
not be written, 5 the rendered document would reference an external asset.`;

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// One pass over the escaped text. The markup is built by a single replacer because a
// chain of replaces rewrites the markup it just inserted: a citation URL containing
// #new, [prov:x] or **x** came out with a mangled href and malformed HTML.
// A link destination may contain balanced parentheses - Wikipedia-style URLs are the
// common case - and [^)]+ truncated them at the first ')', shipping a wrong href and
// leaving the tail of the destination in the prose. One level of nesting is supported,
// which covers the URLs a digest cites.
const URL_PART = '(?:[^()\\s]|\\([^()\\s]*\\))';
// A status flag is a token: its '#' must not be glued to a word character, so it opens the text
// or follows whitespace or punctuation. Without a boundary a spelling the collector's neutraliser
// deliberately preserves - 'C#new async patterns' - drew a status tag here, so the renderer and
// the neutraliser disagreed about what a flag is. A whitespace-only boundary would go too far the
// other way: the shipped example's legend writes '#new' between backticks to show the tag the
// vocabulary draws, and that tag is part of the frozen artifact. Every flag scan below uses this
// same boundary, and the neutraliser uses it too.
const FLAG_BOUNDARY = '(?<!\\w)#';
const TOKEN = new RegExp('\\[src:([^\\]]+?)\\]\\((https?:\\/\\/' + URL_PART + '+)\\)'
  + '|\\[alt:([^\\]]+?)\\]\\((https?:\\/\\/' + URL_PART + '+)\\)'
  + '|\\[prov:([a-z-]+)\\]|' + FLAG_BOUNDARY + '(new|followup|developing|watch)\\b|\\*\\*([^*\\n]+?)\\*\\*', 'g');

export function linkify(text) {
  return esc(text).replace(TOKEN, (match, srcLabel, srcUrl, altLabel, altUrl, prov, flag, strong) => {
    if (srcLabel !== undefined) return `<a class="badge src" href="${srcUrl}" target="_blank" rel="noopener">${srcLabel}</a>`;
    if (altLabel !== undefined) return `<a class="badge alt" href="${altUrl}" target="_blank" rel="noopener">${altLabel}</a>`;
    if (prov !== undefined) return `<span class="badge prov-${prov}">${prov}</span>`;
    if (flag !== undefined) return `<span class="tag t-${flag}">${flag}</span>`;
    return `<strong>${strong}</strong>`;
  });
}

// A digest written on another platform carries CRLF; left in place it matches no
// heading and no item, so the renderer normalises before it splits.
function normalizeNewlines(md) {
  return String(md ?? '').replace(/\r\n?/g, '\n');
}
// THE INTERNAL CHARACTERS DO NOT REACH THE DELIVERABLE (Batch 104; the final sweep's F44-3). The
// module keeps three characters that are not text: the separator mark U+E001 (the published view of
// a split separator), the scaffold mask U+E000 and the removal sentinel U+FFFF. The pool, the
// candidate, the notice and the assembly are clean by construction, but the renderer is a
// publication point a caller may hand a digest it wrote or quoted from a source that carries one,
// and it copied every non-escaped code point straight into the .html while check-quality accepted
// the digest. They are rendered as the spaces they stand in for here, exactly as
// renderSeparatorMarks renders the mark at every redaction entry point, and a C0 control that is not
// Markdown's own whitespace (tab, LF, CR are kept; U+0000 is refused below) is spaced the same way.
//
// THE CLASS IS THE ONE THE MODULE NORMALISES, NOT THREE CHARACTERS (Batch 105; the closing sweep's
// F45-3). Batch 104 spaced U+E000/U+E001/U+FFFF and C0/DEL and left the position right beside it
// open: C1 controls (U+0080-U+009F, the class CONTROL_CHARACTERS already names) and the invisible
// separator class -- ZWSP, SHY, FEFF, WJ, the bidi and line/paragraph separators, the tag characters
// U+E0000-U+E007F and the variation selectors -- reached the .html byte for byte while the gate
// PASSed (measured). They are spaced here as well, so the deliverable cannot carry a character no
// reader can see or a control a reader cannot render. The price is stated: a digest that writes a
// variation selector beside an emoji keeps the emoji and gets the space in the selector's place; no
// shipped example carries one, and the shipped example still renders byte-identically.
const INTERNAL_DIGEST_CHARS = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2064\u2066-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFF0-\uFFF8\uE000\uE001\uFFFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
// THE CLASS IS THE MODULE'S CLASS, NOT A HAND LIST (Batch 107). The list above is written by hand and
// is not the class the module normalises: the Default_Ignorable members it omits -- U+034F, U+115F,
// U+1160, U+17B4..U+17B5, U+180B..U+180D, U+1BCA0..U+1BCA3, U+1D173..U+1D17A, U+2065 and U+FFA0 --
// were copied into the .html while the quality gate answered PASS, which is the sentence above ('the
// deliverable cannot carry a character no reader can see') being false at 22 assigned members. The
// property below is the module's own (INVISIBLE_SEPARATOR, \p{Default_Ignorable_Code_Point}), the
// one every shape rule reads, so the class is closed whole instead of one character at a time.
const INVISIBLE_DIGEST_CHARS = new RegExp(INVISIBLE_SEPARATOR, 'gu');
function stripInternalChars(md) {
  return String(md ?? '').replace(INTERNAL_DIGEST_CHARS, ' ').replace(INVISIBLE_DIGEST_CHARS, ' ');
}

const CSS = [
  ':root{color-scheme:dark;--bg:#0f1216;--panel:#161b22;--panel2:#1c232c;--fg:#e6edf3;--dim:#9aa7b4;--line:#28313c;--acc:#4da3ff;--new:#2ea043;--follow:#d29922}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,Segoe UI,Roboto,Noto Sans SC,Helvetica,Arial,sans-serif}',
  'a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}',
  'header.top{padding:20px 0 12px;border-bottom:1px solid var(--line);background:var(--panel)}',
  '.wrap{max-width:1100px;margin:0 auto;padding:0 22px}',
  'header.top h1{margin:0 0 6px;font-size:22px}',
  '.meta{color:var(--dim);font-size:13px;margin:0 0 12px}',
  '.controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
  '#q{flex:1;min-width:220px;background:var(--panel2);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:8px 12px;font-size:14px}',
  // color-scheme:dark makes the user agent draw a white focus ring, which reads as a
  // box drawn around the control rather than as focus. Focus is drawn on-brand here:
  // the search box gets a ring, everything keyboard-focusable gets an accent outline.
  '#q:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(77,163,255,.22)}',
  ':focus-visible{outline:2px solid var(--acc);outline-offset:2px}',
  '.tog{color:var(--dim);font-size:13px;display:flex;gap:6px;align-items:center}',
  'nav.topics{display:flex;gap:6px 12px;flex-wrap:wrap;margin-top:12px}',
  'nav.topics a{font-size:13px;padding:4px 9px;border:1px solid var(--line);border-radius:999px;white-space:nowrap;color:var(--dim)}',
  'nav.topics a:hover{color:var(--fg);border-color:var(--acc);text-decoration:none}',
  'html{scroll-behavior:smooth}',
  'main{padding:18px 22px 60px;max-width:1100px;margin:0 auto}',
  'section.sec{margin:0 0 26px}',
  'h2{font-size:19px;margin:22px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}',
  'h3{font-size:16px;margin:18px 0 8px;color:var(--acc)}',
  'details.aspect{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:10px 0}',
  'details.aspect>summary{cursor:pointer;padding:10px 14px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:12px;list-style:none}',
  'details.aspect>summary::-webkit-details-marker{display:none}',
  '.ah{font-size:16px}',
  '.badges{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
  '.count{color:var(--dim);font-weight:400;font-size:13px}',
  '.tier{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--dim);text-transform:uppercase;letter-spacing:.04em}',
  '.aspect-body{padding:2px 14px 12px}',
  'ul.stories{list-style:none;margin:0;padding:0}',
  'li.story{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0}',
  '.hlrow{display:flex;gap:8px;align-items:baseline}',
  '.hl{font-weight:600}',
  '.sum{margin:0 0 7px}',
  'a.hl{color:var(--fg)}a.hl:hover{color:var(--acc)}',
  '.prov{width:9px;height:9px;border-radius:999px;display:inline-block;flex:0 0 auto}',
  '.prov-primary{background:#2ea043}',
  '.prov-secondary{background:#4da3ff}',
  '.prov-preprint{background:#d9a7ff}',
  '.prov-vendor-claim{background:#f0c96b}',
  '.prov-default{background:var(--acc)}',
  // The featured deep dive is a card like any other; the class is an identification
  // hook for the tests, not a style of its own, so the two cannot drift apart.
  '.badge{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--dim)}',
  '.badge.src{background:#132b45;color:#9fd0ff;border-color:#1d4a75}',
  '.badge.alt{background:#1a2230;color:var(--dim)}',
  '.badge.prov-primary{background:#12351d;color:#7ee2a1;border-color:#1d5a30}',
  '.badge.prov-secondary{background:#1a2230;color:#9fb3c8}',
  '.badge.prov-preprint{background:#2b2438;color:#d9a7ff;border-color:#4a3a63}',
  '.badge.prov-vendor-claim{background:#3a2d0d;color:#f0c96b;border-color:#5a4a1d}',
  '.tag{font-size:11px;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}',
  '.t-new{background:#12351d;color:#7ee2a1}',
  '.t-followup{background:#3a2d0d;color:#f0c96b}',
  '.t-developing{background:#3a230d;color:#ffb27a}',
  '.t-watch{background:#132b45;color:#9fd0ff}',
  '.quiet{color:var(--dim);font-style:italic;padding:8px 12px;border-left:3px solid var(--line);background:var(--panel)}',
  'ul.plain{margin:6px 0 6px 18px}',
  '#toTop{position:fixed;right:22px;bottom:22px;z-index:20;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--fg);font-size:18px;line-height:1;box-shadow:0 4px 14px rgba(0,0,0,.35);text-decoration:none}',
  '#toTop:hover{border-color:var(--acc);color:var(--acc);text-decoration:none}',
  'footer{color:var(--dim);border-top:1px solid var(--line);padding:16px 0;margin-top:32px;font-size:13px}',
  '@media print{:root{color-scheme:light;--bg:#fff;--panel:#fff;--panel2:#fafafa;--fg:#111;--dim:#555;--line:#bbb}',
  // A card the reader collapsed must not hide its content on paper; the script opens them
  // before printing and the rule is the belt to that braces.
  '.controls,nav.topics,#toTop{display:none}body{font-size:11pt}details.aspect{border:1px solid #ccc}details.aspect:not([open])>.aspect-body{display:block}li.story{break-inside:avoid}}',
].join('\n');

const JS = [
  '(function(){',
  '  var stories = Array.prototype.slice.call(document.querySelectorAll(".story"));',
  '  var q = document.getElementById("q");',
  '  var collapse = document.getElementById("collapse");',
  '  function apply(){',
  '    var v = (q.value || "").toLowerCase().trim();',
  '    stories.forEach(function(s){ s.style.display = (!v || s.textContent.toLowerCase().indexOf(v) >= 0) ? "" : "none"; });',
  '    Array.prototype.slice.call(document.querySelectorAll("details.aspect")).forEach(function(d){',
  '      var mine = Array.prototype.slice.call(d.querySelectorAll(".story"));',
  '      var shown = mine.length === 0 ? true : mine.some(function(s){ return s.style.display !== "none"; });',
  '      d.style.display = shown ? "" : "none";',
  '      if (v && shown) d.setAttribute("open", "");',
  '    });',
  '  }',
  '  q.addEventListener("input", apply);',
  '  collapse.addEventListener("change", function(){',
  '    Array.prototype.slice.call(document.querySelectorAll("details.aspect")).forEach(function(d){',
  '      if (collapse.checked) d.removeAttribute("open"); else d.setAttribute("open", "");',
  '    });',
  '  });',
  '  window.addEventListener("beforeprint", function(){',
  '    Array.prototype.slice.call(document.querySelectorAll("details.aspect")).forEach(function(d){ d.setAttribute("open", ""); });',
  '  });',
  '  window.addEventListener("afterprint", function(){',
  '    collapse.dispatchEvent(new Event("change"));',
  '  });',
  '})();',
].join('\n');

// A digest carrying the substitution sentinel (U+0000) in authored text is the one input
// this renderer cannot turn into a document. The refusal carries its own type so run() can
// answer it at the documented exit 2 instead of letting it escape main() as exit 1.
class SentinelInDigestError extends Error {}

export function render(md, config) {
  const domainOf = (name) => config.domains.find((d) => d.domain === name);
  // A chip label is a shortcut, so it must stay short. A catalogue without the column
  // falls back to the English name's first clause - cut at a comma, a parenthetical or
  // " and " - because the whole name is a heading, not a shortcut.
  const shortOf = Object.fromEntries(config.domains.map((d) => [d.domain, String(d.short ?? '').trim()]));
  // A chip is a shortcut: the reader caps an authored one, and a catalogue without the
  // column falls back to a clause of the name clipped at a word boundary, so the cap holds
  // wherever the label comes from.
  // The cap is configuration, never a literal here: it travels with the catalogue, and a
  // caller that carries no settings gets it from the settings file the reader resolves.
  const chipCap = shortCap(config);
  const clipChip = (label) => {
    const text = String(label).trim();
    if (text.length <= chipCap) return text;
    const cut = text.slice(0, chipCap);
    const at = cut.lastIndexOf(' ');
    return (at > 0 ? cut.slice(0, at) : cut).trim();
  };
  const chipOf = (row) => clipChip(shortOf[row.domain] || row.domain.split(/,|\s*\(|\s+and\s+/)[0]);
  const digest = stripInternalChars(normalizeNewlines(md));
  // The count and card placeholders are replaced before the document is returned, so the
  // token has to be one no digest can write. A digest is Markdown text, so a control
  // character is the one thing it cannot legitimately contain; a digest that does carry
  // one is refused rather than allowed to rewrite authored prose.
  const SENTINEL = '\u0000';
  if (digest.includes(SENTINEL)) {
    throw new SentinelInDigestError('the digest contains the renderer substitution sentinel (U+0000)');
  }
  const mark = (key) => `${SENTINEL}${key}${SENTINEL}`;
  const lines = digest.split('\n');
  // The header block is the title plus the leading underscore lines. The shipped
  // example carries two of them - an illustrative disclaimer and the real window
  // line - so the meta is the last one, the one adjacent to the content; taking the
  // first turned the disclaimer into the header meta and lost the window label.
  // Only the lines the header scan consumed are skipped later. Skipping every line that
  // merely looks like a title or an italic aside dropped body content: a "_note_" line or
  // a second "# " line anywhere in the document silently disappeared.
  const header = [];
  const headerLines = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.startsWith('# ') || (line.startsWith('_') && line.endsWith('_'))) { header.push(line); headerLines.add(i); continue; }
    break;
  }
  const title = (header.find((l) => l.startsWith('# ')) ?? '# Tech Radar').slice(2).trim();
  const metaLine = [...header].reverse().find((l) => l.startsWith('_') && l.endsWith('_')) ?? '';
  const meta = metaLine.replace(/^_|_$/g, '');
  const out = [];
  const navLinks = [];
  const counts = new Map();
  let openSection = false;
  let openDetails = false;
  let openList = false;
  let domainSection = false;
  let quietSection = false;
  let pending = null;
  let storyMode = false;
  let currentKey = null;
  let featuredSection = false;
  let featuredAnchor = '';   // the section's own id, for the chip the card adds
  let featuredHeading = '';
  let featuredOpen = null;   // the deep-dive card currently being read
  let featuredSeq = 0;
  let featuredChip = false;
  const featuredCards = [];  // closed cards, filled in after the whole document is read
  // Two headings can slug to the same anchor - a repeated section, or "AI / LLM" beside
  // "AI-LLM". A repeated anchor made a duplicate id and, because the item counts are keyed
  // by it, the second card's count overwrote the first card's badge. The first occurrence
  // keeps the plain slug; later ones take a suffix.
  const anchorCounts = new Map();
  const anchor = (label) => {
    const base = `d-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const seen = (anchorCounts.get(base) ?? 0) + 1;
    anchorCounts.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  };

  const ITEM = /^\*\*(.+?)\*\*\s+—\s+([\s\S]*)$/;
  // Two readings of the same text. The link grammar (the one linkify draws with) decides
  // which citations become pills; a slightly more permissive one decides what lies *inside a
  // destination*. A URL's own query string can hold '[prov:vendor-claim]' or a nested
  // '[alt:...](...)', and reading either forged a provenance dot, a provenance badge and an
  // alternative-source pill pointing wherever the destination said. A hostile link can carry
  // a space, which the link grammar rejects, so the permissive reading is what keeps a marker
  // inside such a destination from becoming the item's own marker; the destination itself is
  // still used, untouched, to build the link it belongs to.
  const CITATION_DEST = '(?:[^()\\n]|\\([^()\\n]*\\))+';
  const CITATION_SOURCE = '\\[(src|alt):([^\\]]+?)\\]\\((https?:\\/\\/' + URL_PART + '+)\\)';
  const SPAN_SOURCE = '\\[(src|alt):[^\\]]*\\]\\(' + CITATION_DEST + '\\)';
  const citationSpans = (text) => [...String(text).matchAll(new RegExp(SPAN_SOURCE, 'g'))]
    .map((m) => [m.index, m.index + m[0].length]);
  // The citations the item carries: a citation the link grammar accepts, unless it sits inside
  // a destination of the permissive reading. A nested one is part of the link, not a marker.
  const citationsIn = (text) => {
    const spans = citationSpans(text);
    return [...String(text).matchAll(new RegExp(CITATION_SOURCE, 'g'))]
      .filter((m) => !spans.some(([start, end]) => m.index > start && m.index < end));
  };
  // The form the marker scans read: every citation span removed, read permissively. The
  // published prose is never built from this form - linkify draws the citation itself.
  const withoutMarkerSources = (text) => String(text)
    .replace(new RegExp('\\[src:[^\\]]*\\]\\(' + CITATION_DEST + '\\)', 'g'), ' ')
    .replace(new RegExp('\\[alt:[^\\]]*\\]\\(' + CITATION_DEST + '\\)', 'g'), ' ');
  const withoutCitations = (text) => String(text)
    .replace(new RegExp('\\[src:[^\\]]*\\]\\(' + URL_PART + '+\\)', 'g'), ' ')
    .replace(new RegExp('\\[alt:[^\\]]*\\]\\(' + URL_PART + '+\\)', 'g'), ' ');
  const stripCitations = (text) => withoutCitations(text).replace(/\[prov:[a-z-]+\]/g, ' ');
  // The origin pill repeats the citation's own label and date as the prose grammar writes
  // them: a labelled citation whose label carries no date draws no pill, exactly as before.
  const srcPill = (citations) => {
    for (const c of citations) {
      if (c[1] !== 'src') continue;
      const parts = /^([\s\S]+?)\s+(\d{4}-\d{2}-\d{2}[^\]]*)$/.exec(c[2]);
      if (parts) return { url: c[3], label: `${parts[1]} ${parts[2]}` };
    }
    return null;
  };
  // The summary keeps the prose only; the status scan keeps the flags, because a
  // #new inside a citation URL is part of an href and a #new in prose is not the
  // item's flag - the trailing token is.
  const stripMarkers = (text) => stripCitations(text).replace(new RegExp(FLAG_BOUNDARY + '(?:new|followup|developing|watch)\\b', 'g'), ' ');
  // Removing a marker leaves the space it occupied, which lands before the punctuation the
  // author wrote after it ("citations and ." from "citations and [prov:primary] .").
  const tidyProse = (text) => String(text).replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();

  // Every card leads with a marker dot, the way a briefing story does. The dot is the
  // item's provenance: the same marker that is drawn as a pill on the badge row, so the
  // colour tells a reader at a glance how the item is sourced.
  const dotFor = (text, missing = 'No provenance marker') => {
    const prov = /\[prov:([a-z-]+)\]/.exec(withoutMarkerSources(text));
    return prov
      ? `<span class="prov prov-${esc(prov[1])}" title="Provenance: ${esc(prov[1])}"></span>`
      : `<span class="prov prov-default" title="${esc(missing)}"></span>`;
  };

  // Design 4.3 draws an item as a headline, a summary and a run of trailing markers.
  // The markers become pills on their own row, and the summary keeps prose only - a
  // citation is never part of a sentence.
  const badgeRow = (text) => {
    const bits = [];
    const citations = citationsIn(text);
    // The origin and the alternatives are pills that open the page; only the provenance
    // marker and the status tag are not links, because they name something this document
    // decided, not a page.
    const src = srcPill(citations);
    if (src) bits.push(`<a class="badge src" href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.label)}</a>`);
    const alt = citations.find((c) => c[1] === 'alt');
    if (alt) bits.push(`<a class="badge alt" href="${esc(alt[3])}" target="_blank" rel="noopener">${esc(alt[2])}</a>`);
    // A provenance marker inside a citation destination is part of the link, not the item's
    // own marker: the scan reads the text with every citation removed.
    for (const m of withoutMarkerSources(text).matchAll(/\[prov:([a-z-]+)\]/g)) {
      bits.push(`<span class="badge prov-${esc(m[1])}">${esc(m[1])}</span>`);
    }
    // The status tag is the item's new-or-follow-up state, which the gate and the state
    // merge both read as the last #new|#followup token. An additive flag such as
    // #developing does not decide it, wherever the author wrote it.
    const status = [...stripCitations(text).matchAll(new RegExp(FLAG_BOUNDARY + '(new|followup)\\b', 'g'))];
    if (status.length) {
      const flag = status[status.length - 1][1];
      bits.push(`<span class="tag t-${flag}">${flag}</span>`);
    }
    return bits.length ? `<div class="badges">${bits.join('')}</div>` : '';
  };

  const flush = () => {
    if (pending === null) return;
    const text = pending;
    pending = null;
    if (!storyMode) { out.push(`<li>${linkify(text)}</li>`); return; }
    const m = ITEM.exec(text);
    if (!m) {
      // A bullet the grammar does not describe still renders - the gate warns about it -
      // and it is drawn like every other card: the marker dot, the text without leading
      // asterisks, and whatever badges its markers carry.
      out.push(`<li class="story"><div class="hlrow">${dotFor(text)}<span class="hl">${linkify(stripMarkers(text).replace(/^[*\s]+/, ''))}</span></div>`
        + `${badgeRow(text)}</li>`);
    } else {
      const summary = tidyProse(stripMarkers(m[2]));
      // The headline is the primary link, as it is on a briefing story card; a headline
      // with no citation to point at stays a span rather than a dead link.
      const link = srcPill(citationsIn(m[2]));
      const headline = link
        ? `<a class="hl" href="${esc(link.url)}" target="_blank" rel="noopener">${linkify(stripMarkers(m[1]))}</a>`
        : `<span class="hl">${linkify(stripMarkers(m[1]))}</span>`;
      out.push(`<li class="story"><div class="hlrow">${dotFor(m[2])}${headline}</div>`
        + (summary ? `<p class="sum">${linkify(summary)}</p>` : '')
        + `${badgeRow(m[2])}</li>`);
    }
    if (currentKey !== null) counts.set(currentKey, (counts.get(currentKey) ?? 0) + 1);
  };
  const closeList = () => { flush(); if (openList) { out.push('</ul>'); openList = false; } };
  const closeDetails = () => {
    closeList();
    if (openDetails) { out.push('</div></details>'); openDetails = false; currentKey = null; }
  };
  const closeSection = () => { closeDetails(); if (openSection) { out.push('</section>'); openSection = false; } };
  // The featured deep dive is drawn as a story card like any other: a provenance dot, a
  // linked headline, then the prose under it. The dot
  // and the link are decided by prose that arrives after the heading, so the card
  // carries placeholders that are filled once the whole document has been read.
  const closeFeatured = () => {
    if (featuredOpen === null) return;
    featuredCards.push(featuredOpen);
    out.push(`${mark(`BADGES-${featuredOpen.key}`)}</li></ul>`);
    featuredOpen = null;
  };

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    if (headerLines.has(li)) continue;
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      closeFeatured();
      closeSection();
      const heading = h2[1].trim();
      // The item and domain sections are '## Core domains' and
      // '## Watch domains - notable this week'; the quiet line is prose.
      domainSection = /^core\s+domains\b/i.test(heading)
        || (/^watch\s+domains\b/i.test(heading) && !/\bquiet\b/i.test(heading));
      quietSection = /^watch\s+domains\b/i.test(heading) && /\bquiet\b/i.test(heading);
      featuredSection = /^featured\b/i.test(heading);
      featuredAnchor = anchor(heading);
      featuredHeading = heading;
      out.push(`<section class="sec" id="${featuredAnchor}"><h2>${esc(heading)}</h2>`);
      openSection = true;
      continue;
    }
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      closeDetails();
      closeFeatured();
      const label = h3[1].trim();
      if (featuredSection) {
        // The chip is added when the section actually carries a deep dive: a week with
        // only the stand-in line has nothing to jump to, and a repeated featured section
        // takes one chip rather than two pointing at the same anchor.
        if (!featuredChip) {
          featuredChip = true;
          navLinks.push(`<a href="#${featuredAnchor}" title="${esc(featuredHeading)}">Featured</a>`);
        }
        featuredSeq += 1;
        const key = 'f' + featuredSeq;
        featuredOpen = { key, title: label, prose: [] };
        out.push(`<ul class="stories"><li class="story featured"><div class="hlrow">${mark(`PROV-${key}`)}${mark(`HL-${key}`)}</div>`);
        continue;
      }
      const name = label.split('·')[0].trim();
      const row = domainOf(name);
      if (domainSection) {
        // Every domain is a card, catalogue or not. Only a catalogue domain gets a
        // navigation entry and a tier badge: an invented cluster with a fabricated
        // watch badge for a featured headline is the defect this rule exists for.
        const key = anchor(name);
        // One flat row of chips in document order; only a catalogue domain gets a chip
        // (the cluster is kept as data-cluster on the card, not as a label in the
        // navigation).
        if (row) navLinks.push(`<a href="#${key}" title="${esc(label)}">${esc(chipOf(row))}</a>`);
        counts.set(key, 0);
        const tierBadge = row ? `<span class="tier ${esc(row.tier)}">${esc(row.tier)}</span>` : '';
        out.push(`<details class="aspect" id="${key}"${row ? ` data-cluster="${esc(row.cluster)}"` : ''} open>`
          + `<summary><span class="ah">${esc(label)}</span>`
          + `<span class="badges">${tierBadge}<span class="count">${mark(key)}</span></span></summary>`
          + '<div class="aspect-body">');
        openDetails = true;
        currentKey = key;
      } else {
        // Outside a domain section the heading is prose: no nav, no badge, no list.
        out.push(`<h3>${esc(label)}</h3>`);
      }
      continue;
    }
    if (line.startsWith('- ')) {
      flush();
      if (!openList) { out.push(openDetails ? '<ul class="stories">' : '<ul class="plain">'); openList = true; }
      pending = line.slice(2);
      storyMode = openDetails;
      continue;
    }
    // Design 4.3: an item may run on over indented continuation lines. They are part
    // of the item, not a separate paragraph.
    if (pending !== null && /^[ \t]+\S/.test(line)) {
      pending += ` ${line.trim()}`;
      continue;
    }
    if (line.trim() === '') { flush(); continue; }
    closeList();
    if (featuredOpen !== null) {
      // The prose keeps its sentences; the citations and the provenance marker are drawn
      // once, on the badge row, exactly as they are on an item card.
      featuredOpen.prose.push(line);
      out.push(`<p class="sum">${linkify(tidyProse(stripMarkers(line)))}</p>`);
      continue;
    }
    out.push(quietSection ? `<p class="quiet">${linkify(line)}</p>` : `<p>${linkify(line)}</p>`);
  }
  closeFeatured();
  closeSection();
  let body = out.join('\n');
  // The dot and the headline link of a deep-dive card come from its prose: the first
  // provenance marker names the dot, the first citation becomes the link, and a card
  // with neither keeps a neutral dot and an unlinked headline.
  for (const card of featuredCards) {
    const text = card.prose.join(' ');
    const dot = dotFor(text, 'No provenance marker: the deep dive names its sources in the prose');
    const link = srcPill(citationsIn(text));
    const headline = link
      ? `<a class="hl" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(card.title)}</a>`
      : `<span class="hl">${esc(card.title)}</span>`;
    body = body.replaceAll(mark(`PROV-${card.key}`), dot)
      .replaceAll(mark(`HL-${card.key}`), headline)
      .replaceAll(mark(`BADGES-${card.key}`), badgeRow(text));
  }
  // A card's count is known only after its items are read, so the summary carries a
  // placeholder that is filled in here once every card has been read.
  for (const [key, n] of counts) {
    body = body.replaceAll(mark(key), `${n} item${n === 1 ? '' : 's'}`);
  }
  // A provenance style is emitted only for a provenance value this document actually
  // carries. An artifact then spells the vocabulary of the badges it drew and no other,
  // so text that merely mimics a marker stays inert in the stylesheet as well as in prose.
  const css = CSS.split('\n').filter((rule) => {
    const m = /^\.(?:badge\.)?prov-(primary|secondary|preprint|vendor-claim)\{/.exec(rule);
    return m === null || body.includes(`prov-${m[1]}`);
  }).join('\n');
  const nav = navLinks.join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body id="top">
<header class="top"><div class="wrap"><h1>${esc(title)}</h1><p class="meta">${esc(meta)}</p>
<div class="controls"><input id="q" type="search" placeholder="Search">
<label class="tog"><input type="checkbox" id="collapse"> collapse all</label></div>
<nav class="topics">${nav}</nav></div></header>
<main>
${body}
</main>
<footer class="wrap">Generated by the tech-radar skill. Every item cites a real, date-stamped source.</footer>
<script>
${JS}
</script>
<a id="toTop" href="#top" aria-label="Back to top" title="Back to top">&#8593;</a>
</body>
</html>
`;
}

export function parseArgs(argv) {
  const known = new Set(['--out', '--config']);
  const out = { input: null, out: null, config: DEFAULT_CONFIG };
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
    // A value that is only whitespace is a shell variable that expanded to nothing; writing
    // the deliverable to a file named ' ' is worse than refusing it.
    if (String(v).trim() === '') throw new Error(`empty value for ${a}`);
    i += 1;
    if (a === '--out') out.out = v;
    else if (a === '--config') out.config = v;
  }
  return out;
}

// The file the write lands on, with a symlinked destination followed to its target. The
// rename below replaces an inode, so renaming over the spelling the operator gave replaces the
// link itself: the link becomes a regular file holding the new digest while the file it pointed
// at keeps the old one, and a digest kept on another volume behind a link - or aimed at through
// one - quietly goes stale. Resolving rather than refusing keeps the operator's link and
// publishes the deliverable where they aimed it.
//
// realpathSync answers for a link whose target is there. A link whose final target is not there
// yet has no real path, so the chain is walked by hand to the name it points at, which the write
// then creates exactly as a plain write to a fresh destination would. A chain that never
// terminates is refused rather than guessed at, before any temp file exists, so the failure
// leaves nothing behind. This mirrors the state and collector writers, which resolve the same
// way.
function resolveWriteTarget(out) {
  try { return realpathSync(out); } catch { /* absent, or a link to a path that is not there */ }
  let current = out;
  let stats;
  try { stats = lstatSync(current); } catch { return current; }
  for (let hop = 0; stats.isSymbolicLink(); hop += 1) {
    if (hop >= 32) throw new Error(`${out} is a symlink chain that does not resolve to a file`);
    const target = readlinkSync(current);
    current = isAbsolute(target) ? target : resolve(dirname(current), target);
    try { stats = lstatSync(current); } catch { return current; }
  }
  return current;
}

// The mode the replacement carries. The rename replaces the inode, so an existing
// destination keeps its own permissions only if the temp is born with them: a temp created
// with the process default silently widened a deliverable the operator had protected - a
// 0600 HTML came back 0664. A fresh (absent) destination has no mode to keep, so it is left
// at the mode the create itself gave it - 0666 masked by the process umask - exactly what
// the plain write this replaced produced, so a newly rendered digest is not owner-only.
// The state writer resolves the same way, so the three writers agree on the rule.
function destinationMode(path) {
  try { return statSync(path).mode & 0o777; } catch { return null; }
}

// A replacement is published by a rename, so a refused or interrupted write leaves the
// previous deliverable intact rather than truncated. The temp name is unique and created
// exclusively, so a pre-planted path is never followed, and it is removed on every failure.
// A destination that exists but is not writable is refused before the rename: the rename
// itself needs only the directory, so without this check a read-only deliverable the
// operator protected was silently replaced. The state writer refuses the same way, so the
// three writers really do agree on the rule the comment above claims for them.
function writeAtomic(path, text) {
  // Everything below names the resolved destination, not the spelling the operator gave: the
  // temp has to be born beside the inode the rename replaces, or a symlinked destination on
  // another volume would fail the rename with EXDEV, and the rename itself has to name that
  // inode rather than the link.
  const destination = resolveWriteTarget(path);
  const mode = destinationMode(destination);
  const tmp = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode: mode ?? 0o666 });
    // chmod after the create, because the umask would otherwise clear bits the destination
    // held (a 0664 deliverable under a 022 umask is the common case). Only a destination
    // that already existed is pinned: a fresh deliverable keeps the create's own
    // 0666 & ~umask, so a newly rendered digest is not owner-only.
    if (mode !== null) chmodSync(tmp, mode);
    if (existsSync(destination)) accessSync(destination, constants.W_OK);
    renameSync(tmp, destination);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* the temp was never created */ }
    throw err;
  }
}

// io is a test seam: the CLI is exercised with an injected renderer so that the
// write/no-write decision on a self-containment failure is observable.
export function run(argv, io = {}) {
  const readFile = io.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const readDomainsOf = io.readDomains ?? ((path) => readDomains(path));
  const renderFn = io.render ?? render;
  const writeFile = io.writeFile ?? writeAtomic;
  const log = io.log ?? ((m) => console.log(m));
  const error = io.error ?? ((m) => console.error(m));

  if (argv.includes('-h') || argv.includes('--help')) {
    log(USAGE);
    return 0;
  }
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    error(`render-html: ${err.message}`);
    error(USAGE);
    return 2;
  }
  if (!opts.input || !opts.out) {
    error('render-html: needs <input.md> and --out <path>');
    error(USAGE);
    return 2;
  }
  let md;
  try {
    md = readFile(opts.input);
  } catch (err) {
    error(`render-html: cannot read ${opts.input}: ${err.message}`);
    return 2;
  }
  let domains;
  try {
    domains = readDomainsOf(`${opts.config}/domains.md`);
  } catch (err) {
    error(`render-html: cannot read config ${opts.config}: ${err.message}`);
    return 2;
  }
  // The chip cap travels with the catalogue it clips. A settings file that cannot be read
  // leaves the reader's own resolution, so the renderer still has a configured cap.
  let shortMax = null;
  try { shortMax = readSettings(`${opts.config}/settings.md`).short_max_chars; } catch { shortMax = null; }
  let html;
  try {
    html = renderFn(md, { domains, short_max_chars: shortMax });
  } catch (err) {
    // An unusable input takes the documented exit 2 with one named line and no output
    // file; anything else is unexpected and still propagates.
    if (!(err instanceof SentinelInDigestError)) throw err;
    error(`render-html: ${err.message}`);
    return 2;
  }
  // Checked before the write: a self-containment failure must not leave a
  // deliverable on disk that breaks when it is opened from file://.
  if (externalAssets(html)) {
    error('render-html: the rendered document references an external asset');
    return 5;
  }
  try {
    writeFile(opts.out, html);
  } catch (err) {
    error(`render-html: cannot write ${opts.out}: ${err.message}`);
    return 4;
  }
  log(opts.out);
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const code = run(argv);
  if (code) process.exitCode = code;
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
