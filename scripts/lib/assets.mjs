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

// Every attribute value is compared decoded: a character reference around a word the
// browser matches ('st&#121;lesheet', 'url(&#104;ttps://...') is the same value to the
// browser, so it is the same value here. Decoding exactly once matters - srcdoc carries a
// whole document, and decoding it twice would read '&amp;lt;img&amp;gt;', which a browser
// renders as text, as markup that fetches.
function attrsOf(region) {
  const out = {};
  for (const m of String(region).matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    // The first spelling wins, as it does in a browser.
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
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

// A data: reference whose media type is a document - text/html, application/xhtml+xml or
// image/svg+xml - is not simply "carried in the document": an iframe src or an object data
// opens it as a browsing context of its own, and whatever its markup loads is fetched. The
// payload is decoded (percent-escapes, or a base64 body) and scanned like an srcdoc, where
// a data: image, font or stylesheet is still only bytes the artifact already holds.
const DOCUMENT_DATA = /^data:(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)\s*(?:[;,]|$)/i;

function dataDocument(value) {
  if (!DOCUMENT_DATA.test(value)) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  const body = value.slice(comma + 1);
  try {
    return /;base64/i.test(value.slice(0, comma))
      ? Buffer.from(body, 'base64').toString('utf8')
      : decodeURIComponent(body);
  } catch {
    // A payload that will not decode is bytes, not a document; the resource decision for
    // the reference itself already saw it as an in-document data: URI.
    return null;
  }
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

// Whether a CSS reference is fetched when the artifact is opened from disk. A remote URL
// carries a scheme or a scheme-relative '//' authority; a data: payload, a fragment and a
// relative name are all inside the artifact the reader already has.
function isRemoteReference(value) {
  const url = String(value).trim();
  if (url === '' || url.startsWith('#') || isInline(url)) return false;
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url);
}

// The argument list of every image-set() call. A nested url() or type() carries a ')' of
// its own, so the list is sliced with balanced parentheses and quotes: stopping at the
// first ')' leaves a half-read candidate - 'url("data:image/png;base64,AA' - that then
// reads as a fetch the artifact does not make.
function imageSetArgs(css) {
  const out = [];
  for (const m of css.matchAll(/image-set\s*\(/gi)) {
    const open = m.index + m[0].length;
    let depth = 1;
    let quote = '';
    let end = css.length;
    for (let i = open; i < css.length; i += 1) {
      const ch = css[i];
      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')' && (depth -= 1) === 0) { end = i; break; }
    }
    out.push(css.slice(open, end));
  }
  return out;
}

// image-set() names candidate images the browser may fetch. A type('image/png') descriptor
// names no resource, the 1x/2x descriptors name no resource, and a candidate that is a
// data: payload, a fragment or a relative name is in the document already; what is left
// that is actually remote decides it.
function imageSetFetches(args) {
  const text = String(args).replace(/\btype\s*\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, ' ');
  const candidates = [];
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi)) {
    candidates.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  // A bare quoted string is a candidate too: image-set("photo.png" 1x) names one without
  // url(). A quoted string inside type() was removed above, so it is not read as one.
  for (const m of text.replace(/url\([^)]*\)/gi, ' ').matchAll(/"([^"]*)"|'([^']*)'/g)) {
    candidates.push(m[1] ?? m[2] ?? '');
  }
  return candidates.some((candidate) => isRemoteReference(candidate));
}

// A CSS comment is not CSS: a candidate named inside one is never fetched, so the comment
// regions are removed before any CSS vocabulary is looked for. The scan is string-aware,
// because '/*' inside a quoted string opens no comment for a browser: a plain replace would
// swallow the rest of the stylesheet and hide a fetch that really happens.
function stripCssComments(css) {
  const text = String(css);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, Math.min(j + 1, text.length));
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ' ';
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

// The CSS text is read exactly as attrsOf decoded it. A style attribute value has had the HTML
// parser's one character-reference pass by then, and CSS applies no HTML character-reference
// pass of its own: a doubly encoded 'url(&amp;#104;ttps://...)' reaches the CSS parser as the
// literal text 'url(&#104;ttps://...)' - a relative name, not a remote one - so a second decode
// here would invent a fetch the browser never makes and refuse a self-contained artifact.
function cssFetches(css) {
  const text = stripCssComments(css);
  if (REMOTE_URL.test(text)) return true;
  // @import fetches unless the target it names is itself inline.
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
    if (!isInline(m[1])) return true;
  }
  for (const args of imageSetArgs(text)) {
    if (imageSetFetches(args)) return true;
  }
  return false;
}

// The target a meta refresh navigates to, if it names one at all: a bare delay fetches
// nothing, while a url= target is a fetch the moment the document is opened.
function refreshTarget(value) {
  const m = /url\s*=\s*["']?([^"'\s;]+)/i.exec(value);
  return m ? m[1] : null;
}

// The deepest nested document one call will follow. An iframe srcdoc carries markup of
// its own, so a document can name another document; the scan follows them iteratively
// rather than recursively (a hostile input can nest deeply, and a stack overflow is not a
// verdict) and refuses a nest deeper than this rather than traversing it without a bound.
// The bound is a depth, not a count of documents: a document with a thousand sibling
// iframes is ordinary markup and is judged on what it actually names, while a nest this
// deep is not markup anyone writes by hand.
const MAX_NESTED_DEPTH = 64;

// The elements whose srcdoc attribute a browser honours. On any other element srcdoc is an
// attribute like another and its value is text, so reading it as a document invents a
// fetch the browser never makes.
const SRCDOC_ELEMENTS = new Set(['iframe']);

// One document's own fetches. A document named by an iframe srcdoc, or carried as a data:
// document, is not scanned here: it is pushed onto the worklist, which is what bounds the
// traversal.
function documentFetches(text, nested, depth) {
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
        else {
          // A data: document is carried in the artifact, but the browsing context it opens
          // loads whatever its own markup names.
          const nestedDocument = dataDocument(value);
          if (nestedDocument !== null) nested.push({ text: nestedDocument, depth: depth + 1 });
        }
      }
    }

    if (name === 'link' && relOf(attrs).some((rel) => LINK_RELS.has(rel))) {
      const href = attrs.href;
      if (href !== undefined && !isInDocument(href)) return true;
    }

    // The http-equiv value is compared decoded (attrsOf decodes every value once): a
    // character reference around the word 'refresh' ('&#114;efresh') is the same declaration
    // to a browser, so it is the same fetch here.
    if (name === 'meta' && (attrs['http-equiv'] ?? '').toLowerCase() === 'refresh') {
      const target = refreshTarget(attrs.content ?? '');
      if (target !== null && !isInDocument(target)) return true;
    }

    // An srcdoc attribute carries a whole document as its value. A quoted attribute value is
    // opaque to the tag tokeniser, so without this the markup inside it is never scanned. A
    // browser honours the attribute on an iframe only, and the value is already decoded
    // once by attrsOf.
    if (SRCDOC_ELEMENTS.has(name) && attrs.srcdoc) {
      nested.push({ text: attrs.srcdoc, depth: depth + 1 });
    }

    // CSS forms count inside CSS only: a style element or a style attribute.
    if (attrs.style !== undefined && cssFetches(attrs.style)) return true;
  }

  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (cssFetches(m[1])) return true;
  }
  return false;
}

export function externalAssets(html) {
  const pending = [{ text: String(html), depth: 0 }];
  const seen = new Set();
  while (pending.length > 0) {
    const { text, depth } = pending.shift();
    // A nest deeper than the bound is refused rather than traversed: the verdict is the
    // conservative one, because a document this deeply nested is not markup a reader
    // opens, and one call must terminate whatever it is handed.
    if (depth > MAX_NESTED_DEPTH) return true;
    // A document that names itself (or repeats) is scanned once: the worklist must terminate.
    if (seen.has(text)) continue;
    seen.add(text);
    if (documentFetches(text, pending, depth)) return true;
  }
  return false;
}

function relOf(attrs) {
  return String(attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}
