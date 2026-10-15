// scripts/lib/assets.mjs
// Self-containment predicate for the tech-radar skill: does this HTML fetch
// anything when it is opened from disk? Zero dependencies, and deliberately
// independent of both the renderer and the gate, so either can be run alone.
//
// A citation link (a href) is content, not an asset; prose that merely writes
// "url(https://...)" or "@import" is prose; a data: URI is self-contained. What
// counts is an element that loads a network resource, a stylesheet or an icon, a
// meta refresh, a CSS @import, or a remote url() - and both CSS forms count only
// inside CSS, never in the document at large.
//
// The document is tokenised rather than pattern-matched: a tag is its name plus an
// attribute list, the list is split on whitespace or '/', and a value may be quoted or
// bare. A document that hides a fetch behind a separator or an unquoted value is the
// evasion this tokenisation exists to see.
import { decodeEntities } from './net.mjs';

const REMOTE_URL = /\burl\(\s*["']?(?:https?:)?\/\//i;

// Attribute: a name, then an optional '=' and a double-quoted, single-quoted or bare
// value. Worth a full tokeniser because '/' separates attributes just as whitespace does.
const ATTR = /([^\s/=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;

// A tag: a name, then everything up to the first '>' that closes it. A quoted value may
// contain a '>' of its own, so a quoted run is consumed as a unit; an unquoted value ends at
// the first '>', exactly as a browser ends the tag.
const TAG = /<([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;

// A tag whose attribute loads a network resource: the element name decides which
// attributes are resource references.
const RESOURCE_ATTRS = {
  img: ['src', 'srcset'],
  input: ['src', 'srcset'],
  script: ['src'],
  iframe: ['src'],
  embed: ['src'],
  track: ['src'],
  source: ['src', 'srcset'],
  audio: ['src'],
  video: ['src', 'poster'],
  object: ['data'],
  image: ['href', 'xlink:href'],
  use: ['href', 'xlink:href'],
  body: ['background'],
  table: ['background'],
};

// A link fetches only when its rel names something the browser pulls in. canonical,
// alternate and preconnect name relationships, not resources, so they stay content. An
// installed-page icon and a preloaded module are fetches like any other.
const LINK_RELS = new Set(['stylesheet', 'preload', 'modulepreload', 'icon',
  'apple-touch-icon', 'mask-icon', 'manifest']);

function attrsOf(region) {
  const out = {};
  for (const m of String(region).matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    // The first spelling wins, as it does in a browser.
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

// A data: URI is carried inside the document, so it fetches nothing.
function isInline(value) {
  return /^data:/i.test(value);
}

// A fragment-only reference names a place in this document, so it fetches nothing: an SVG
// <use href="#icon"> draws a symbol the document already carries, and a bare src="" fetches
// the document itself. The earlier rule treated any non-empty value as remote, so it flagged
// every in-document reference and missed the empty one it meant to allow.
function isInDocument(value) {
  return value === '' || value.startsWith('#') || isInline(value);
}

function srcsetIsInline(value) {
  // A data: URI carries the same comma that separates srcset candidates, so drop the
  // data: URIs and their descriptors before deciding whether anything is left.
  const rest = value.replace(/data:[^\s]*/gi, '').replace(/\b\d+(?:\.\d+)?[wx]\b/gi, '');
  return rest.split(',').every((part) => {
    const candidate = part.trim();
    return candidate === '' || candidate.startsWith('#');
  });
}

// image-set() names candidate images the browser may fetch. A data: candidate is carried
// in the document, and the descriptors (1x, 2x) name no resource, so what is left after
// those are removed decides it.
function imageSetFetches(args) {
  const rest = String(args)
    .replace(/url\(\s*["']?data:[^)]*\)/gi, ' ')
    .replace(/["']?data:[^\s'"),]*["']?/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?[wx]\b/gi, ' ')
    .replace(/[,\s()"']+/g, '');
  return rest !== '';
}

function cssFetches(css) {
  if (REMOTE_URL.test(css)) return true;
  // @import fetches unless the target it names is itself inline.
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
    if (!isInline(m[1])) return true;
  }
  for (const m of css.matchAll(/image-set\s*\(([^)]*)\)/gi)) {
    if (imageSetFetches(m[1])) return true;
  }
  return false;
}

// The target a meta refresh navigates to, if it names one at all: a bare delay fetches
// nothing, while a url= target is a fetch the moment the document is opened.
function refreshTarget(value) {
  const m = /url\s*=\s*["']?([^"'\s;]+)/i.exec(value);
  return m ? m[1] : null;
}

// The most nested documents one call will follow. An iframe srcdoc carries markup of its
// own, so a document can name another document; the scan follows them iteratively rather
// than recursively (a hostile input can nest deeply, and a stack overflow is not a verdict)
// and refuses a nest deeper than this rather than traversing it without a bound.
const MAX_NESTED_DOCUMENTS = 64;

// One document's own fetches. A document named by an iframe srcdoc is not scanned here: it
// is pushed onto the worklist, which is what bounds how many documents one call follows.
function documentFetches(text, nested) {
  for (const tag of text.matchAll(TAG)) {
    const name = tag[1].toLowerCase();
    const attrs = attrsOf(tag[2]);

    const resourceAttrs = RESOURCE_ATTRS[name];
    if (resourceAttrs) {
      for (const attr of resourceAttrs) {
        const value = attrs[attr];
        // An absent attribute, an empty one and a fragment-only one name no resource: a bare
        // src="" and a "#icon" fetch nothing this document does not already carry.
        if (value === undefined) continue;
        if (attr === 'srcset') { if (!srcsetIsInline(value)) return true; }
        else if (!isInDocument(value)) return true;
      }
    }

    if (name === 'link' && relOf(attrs).some((rel) => LINK_RELS.has(rel))) {
      const href = attrs.href;
      if (href !== undefined && !isInDocument(href)) return true;
    }

    // The http-equiv value is compared decoded: a character reference around the word
    // 'refresh' ('&#114;efresh') is the same declaration to a browser, so it is the same
    // fetch here.
    if (name === 'meta' && decodeEntities(attrs['http-equiv'] ?? '').toLowerCase() === 'refresh') {
      const target = refreshTarget(attrs.content ?? '');
      if (target !== null && !isInDocument(target)) return true;
    }

    // An srcdoc attribute carries a whole document as its value. A quoted attribute value is
    // opaque to the tag tokeniser, so without this the markup inside it is never scanned.
    if (attrs.srcdoc !== undefined && attrs.srcdoc !== '') nested.push(decodeEntities(attrs.srcdoc));

    // CSS forms count inside CSS only: a style element or a style attribute.
    if (attrs.style !== undefined && cssFetches(attrs.style)) return true;
  }

  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (cssFetches(m[1])) return true;
  }
  return false;
}

export function externalAssets(html) {
  const pending = [String(html)];
  const seen = new Set();
  while (pending.length > 0) {
    const text = pending.shift();
    // A document that names itself (or repeats) is scanned once: the worklist must terminate.
    if (seen.has(text)) continue;
    seen.add(text);
    if (seen.size > MAX_NESTED_DOCUMENTS) return true;
    if (documentFetches(text, pending)) return true;
  }
  return false;
}

function relOf(attrs) {
  return String(attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}
