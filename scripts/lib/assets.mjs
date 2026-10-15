// scripts/lib/assets.mjs
// Self-containment predicate for the tech-radar skill: does this HTML fetch
// anything when it is opened from disk? Zero dependencies, and deliberately
// independent of both the renderer and the gate, so either can be run alone.
//
// A citation link (a href) is content, not an asset; prose that merely writes
// "url(https://...)" or "@import" is prose; a data: URI is self-contained. What
// counts is an element that loads a network resource, a CSS @import, or a remote
// url() - and both CSS forms count only inside CSS, never in the document at large.
const EMBEDDED = ['script', 'img', 'iframe', 'video', 'audio', 'source', 'embed', 'object', 'track', 'input'];
const REMOTE_URL = /\burl\(\s*["']?(?:https?:)?\/\//i;

function attrValue(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? '').trim();
}

function relOf(attrs) {
  const m = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').toLowerCase() : '';
}

// A data: URI is carried inside the document, so it fetches nothing.
function isInline(value) {
  return /^data:/i.test(value);
}

function srcsetIsInline(value) {
  // A data: URI carries the same comma that separates srcset candidates, so drop the
  // data: URIs and their descriptors before deciding whether anything is left.
  const rest = value.replace(/data:[^\s]*/gi, '').replace(/\b\d+(?:\.\d+)?[wx]\b/gi, '');
  return rest.split(',').every((part) => part.trim() === '');
}

function cssFetches(css) {
  if (REMOTE_URL.test(css)) return true;
  // @import fetches unless the target it names is itself inline.
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
    if (!isInline(m[1])) return true;
  }
  return false;
}

export function externalAssets(html) {
  const text = String(html);
  // Elements that embed a resource. A data: URI on one of them is self-contained.
  for (const m of text.matchAll(/<(script|img|iframe|video|audio|source|embed|object|track|input)\b([^>]*)>/gi)) {
    const attrs = m[2];
    for (const name of ['src', 'data']) {
      const value = attrValue(attrs, name);
      if (value !== null && !isInline(value)) return true;
    }
    const srcset = attrValue(attrs, 'srcset');
    if (srcset !== null && !srcsetIsInline(srcset)) return true;
  }
  // A stylesheet link is fetched. Other relations - canonical, alternate, preconnect,
  // icon - are not a fetched asset, so a canonical link to the published URL is fine.
  for (const m of text.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (!relOf(attrs).split(/\s+/).includes('stylesheet')) continue;
    const href = attrValue(attrs, 'href');
    if (href !== null && !isInline(href)) return true;
  }
  // CSS forms count inside CSS only: a style element or a style attribute.
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (cssFetches(m[1])) return true;
  }
  for (const m of text.matchAll(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    if (cssFetches(m[2] ?? m[3] ?? '')) return true;
  }
  return false;
}
