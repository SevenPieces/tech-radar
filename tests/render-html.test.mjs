// tests/render-html.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, run, linkify, parseArgs as renderArgs } from '../scripts/render-html.mjs';
import { readDomains } from '../scripts/lib/mdtable.mjs';
import { externalAssets } from '../scripts/lib/assets.mjs';
import { collectFeeds } from '../scripts/collect.mjs';

const config = {
  domains: [
    { key: 'ai-llm', domain: 'AI / LLM', label_zh: '人工智能 / 大模型', cluster: 'AI and compute', tier: 'core' },
    { key: 'quantum', domain: 'Quantum technologies', label_zh: '量子技术', cluster: 'AI and compute', tier: 'watch' },
  ],
};
const md = [
  '# Tech Radar — 2026-09-23',
  '_Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit_',
  '',
  '## Core domains',
  '### AI / LLM · 人工智能 / 大模型',
  '- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
  '',
  '## Watch domains — quiet',
  'Quantum technologies (scanned, nothing notable)',
].join('\n');

test('render produces a complete document with no external assets', () => {
  const html = render(md, config);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /id="q"/, 'the search box');
  assert.match(html, /id="collapse"/, 'collapse all');
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /\burl\(\s*["']?https?:/i);
});

test('render links the cited URL and escapes the headline', () => {
  const html = render(md, config);
  assert.match(html, /href="https:\/\/huggingface\.co\/blog\/x"/);
  assert.match(html, /<span class="badge prov-primary"/, 'the provenance badge');
});

test('render escapes angle brackets in content', () => {
  const html = render(md.replace('A model shipped', 'A <script>alert(1)</script> shipped'), config);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('render labels tiers and keeps the cluster as card data, not as a nav label', () => {
  const html = render(md, config);
  assert.match(html, /data-cluster="AI and compute"/, 'the cluster stays on the card');
  assert.match(html, /class="tier core"/);
});

// Regression test: every h2 opened a <section> but the renderer
// emitted a single </section> at the end, so every section after the first was
// nested inside the previous one and the last one was never closed.
test('every opened section is closed', () => {
  const html = render(md, config);
  const opens = (html.match(/<section\b/g) ?? []).length;
  const closes = (html.match(/<\/section>/g) ?? []).length;
  assert.equal(opens, 2, 'one section per h2');
  assert.equal(closes, opens, 'unbalanced sections: the digest is nested, not sectioned');
  assert.match(html, /<h2>Core domains<\/h2>[\s\S]*?<\/section>[\s\S]*?<section class="sec" id="d-watch-domains-quiet">/);
});

// The chips are shortcuts: a couple of words, with the full bilingual heading on
// hover, because a catalogue heading is far too long to read as a navigation link.
test('topic chips use the short catalogue label and keep the full name on hover', () => {
  const withShort = {
    domains: config.domains.map((d) => ({ ...d, short: d.key === 'ai-llm' ? 'AI / LLM' : 'Quantum' })),
  };
  const twoDomains = md.replace('## Watch domains — quiet',
    '## Watch domains — notable this week\n### Quantum technologies · 量子技术\n- **A qubit milestone** — Why it matters. [src:Hugging Face blog 2026-09-21](https://huggingface.co/blog/z) [prov:primary] #new\n\n## Watch domains — quiet');
  const nav = /<nav class="topics">([\s\S]*?)<\/nav>/.exec(render(twoDomains, withShort))[1];
  assert.match(nav, /title="AI \/ LLM · 人工智能 \/ 大模型">AI \/ LLM</);
  assert.match(nav, /title="Quantum technologies · 量子技术">Quantum</);
  assert.doesNotMatch(nav, />AI \/ LLM · 人工智能 \/ 大模型</, 'the chip is the shortcut, not the heading');
});

// A catalogue that predates the column still has to render a usable shortcut, so the
// fallback is the English name's first clause rather than the whole heading.
test('a catalogue with no short column falls back to the English name before the comma', () => {
  const nav = /<nav class="topics">([\s\S]*?)<\/nav>/.exec(render(md, config))[1];
  assert.match(nav, /href="#d-ai-llm" title="AI \/ LLM · 人工智能 \/ 大模型">AI \/ LLM</);
  const one = { domains: [{ key: 'chips-hardware', domain: 'Chips, hardware and accelerators', label_zh: '芯片、硬件与加速器', cluster: 'AI and compute', tier: 'core' }] };
  const md2 = ['# T', '_meta_', '', '## Core domains', '### Chips, hardware and accelerators · 芯片、硬件与加速器',
    '- **A chip shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/y) [prov:primary] #new', ''].join('\n');
  assert.match(/<nav class="topics">([\s\S]*?)<\/nav>/.exec(render(md2, one))[1], />Chips</);
});

// Found in review, not by this suite: #toTop had no positioning rule at all, so the
// back-to-top control rendered as a stray arrow at the end of the document instead of
// the floating button a reader expects. The chips carry the pill shape for the same
// reason - the navigation should read as one control surface.
test('chips are pills and the back-to-top control is a fixed circle', () => {
  const html = render(md, config);
  assert.match(html, /nav\.topics a\{[^}]*border-radius:999px/);
  assert.match(html, /nav\.topics a:hover\{[^}]*border-color:var\(--acc\)/);
  assert.match(html, /#toTop\{position:fixed;right:22px;bottom:22px[^}]*border-radius:999px/);
  assert.match(html, /<a id="toTop" href="#top"/);
  assert.match(html, /\.controls,nav\.topics,#toTop\{display:none\}/, 'the chrome is hidden in print');
});

// A story card links its headline to the primary source and shows the origin as a link
// pill. A headline with nothing to point at
// stays a span rather than becoming a dead link, and the alternatives are pills too.
test('the headline links to the primary source and the origin is a link pill', () => {
  const html = render(md, config);
  assert.match(html, /<a class="hl" href="https:\/\/huggingface\.co\/blog\/x" target="_blank" rel="noopener">A model shipped<\/a>/);
  assert.match(html, /<a class="badge src" href="https:\/\/huggingface\.co\/blog\/x" target="_blank" rel="noopener">Hugging Face blog 2026-09-20<\/a>/);
  assert.match(html, /\.badge\.src\{background:#132b45;color:#9fd0ff;border-color:#1d4a75\}/);
  assert.match(html, /\.badge\.alt\{background:#1a2230;color:var\(--dim\)\}/);
  assert.match(html, /a\.hl\{color:var\(--fg\)\}a\.hl:hover\{color:var\(--acc\)\}/);

  const withAlt = md.replace('[prov:primary] #new', '[prov:primary] #new [alt:Also covered](https://example.net/a)');
  assert.match(render(withAlt, config), /<a class="badge alt" href="https:\/\/example\.net\/a" target="_blank" rel="noopener">Also covered<\/a>/);

  const noCitation = md.replace(' [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x)', '');
  assert.match(render(noCitation, config), /<span class="hl">A model shipped<\/span>/, 'no citation, no dead link');
});

// Found in review, not by this suite: the card builder wrote the
// citation URL into href="..." unescaped, so a URL containing a double quote closed the
// attribute and injected one of its own into the deliverable. linkify escaped its text
// first and stayed safe; the card builder worked on raw text. Every href it emits is
// escaped now, and the escaped form is the one a browser reads.
test('a citation URL cannot break out of the href attribute', () => {
  const cases = [
    ['https://example.com/a"onmouseover="alert(1)', 'https://example.com/a&quot;onmouseover=&quot;alert(1)'],
    ['https://example.com/a<b>c', 'https://example.com/a&lt;b&gt;c'],
    ["https://example.com/a'onfocus='x", 'https://example.com/a&#39;onfocus=&#39;x'],
    ['https://example.com/a?x=1&y=2', 'https://example.com/a?x=1&amp;y=2'],
  ];
  for (const [url, escaped] of cases) {
    const html = render(md.replace('https://huggingface.co/blog/x', url), config);
    const anchors = [...html.matchAll(/<a class="(?:hl|badge src)"[^>]*>/g)].map((m) => m[0]);
    assert.equal(anchors.length, 2, 'the headline link and the origin pill: ' + url);
    for (const a of anchors) {
      assert.ok(a.includes('href="' + escaped + '"'), 'the escaped URL is what the browser reads: ' + a);
      assert.doesNotMatch(a, /href="[^"]*"[^>]*\son[a-z]+=/i, 'an attribute injected through the URL: ' + a);
    }
    assert.doesNotMatch(html, /<b>c<\/b>/, 'an element injected through the URL');
  }
  assert.match(render(md, config), /href="https:\/\/huggingface\.co\/blog\/x"/, 'an ordinary URL is unchanged');

  // A destination containing whitespace is not a citation at all: no anchor is built from
  // it, the text stays escaped, and the gate rejects an item that has no citation.
  const spaced = render(md.replace('https://huggingface.co/blog/x', 'https://evil.example/a" onmouseover="alert(1)'), config);
  assert.doesNotMatch(spaced, /href="https:\/\/evil\.example/);
  assert.doesNotMatch(spaced, /\son[a-z]+="/, 'no attribute injected by unparsed markup');
  assert.match(spaced, /&quot; onmouseover=&quot;alert\(1\)/, 'the text is escaped, not lost');
});

// Found in review: the destination pattern stopped at the first ')', so a
// Wikipedia-style URL shipped a truncated href and left the rest of the URL in the
// sentence as a stray bracket.
test('a citation URL may contain balanced parentheses', () => {
  const table = [
    ['https://en.example/wiki/Foo_(bar)', 'https://en.example/wiki/Foo_(bar)'],
    ['https://en.example/notes/Foo_(bar)_x?s=1', 'https://en.example/notes/Foo_(bar)_x?s=1'],
  ];
  for (const [url, href] of table) {
    const html = render(md.replace('https://huggingface.co/blog/x', url), config);
    const anchors = [...html.matchAll(/<a class="(?:hl|badge src)"[^>]*>/g)].map((m) => m[0]);
    assert.equal(anchors.length, 2, 'the headline link and the origin pill: ' + url);
    for (const a of anchors) assert.ok(a.includes('href="' + href + '"'), a);
    assert.match(html, /<p class="sum">Why it matters\.<\/p>/, 'no tail left in the sentence: ' + url);
  }
});

// Found in review: two headings that slug to the same anchor produced a
// duplicate id and, because the item counts are keyed by that anchor, the second card's
// count overwrote the first card's badge.
test('two headings that slug alike get distinct anchors and their own counts', () => {
  const doubled = [
    '# T', '_m_', '', '## Core domains',
    '### AI / LLM · 人工智能 / 大模型',
    '- **One** — a. [src:Out 2026-09-20](https://example.com/1) [prov:primary] #new',
    '- **Two** — b. [src:Out 2026-09-20](https://example.com/2) [prov:primary] #new',
    '- **Three** — c. [src:Out 2026-09-20](https://example.com/3) [prov:primary] #new',
    '### AI-LLM · 人工智能 / 大模型',
    '- **Four** — d. [src:Out 2026-09-20](https://example.com/4) [prov:primary] #new',
    '', '## Watch domains — quiet', '',
  ].join('\n');
  const html = render(doubled, config);
  const ids = [...html.matchAll(/<details class="aspect" id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['d-ai-llm', 'd-ai-llm-2'], 'the second card takes a distinct anchor');
  assert.equal(new Set(ids).size, ids.length, 'no duplicate id in the document');
  assert.match(html, /id="d-ai-llm"[\s\S]*?<span class="count">3 items<\/span>/, 'the first card keeps its own count');
  assert.match(html, /id="d-ai-llm-2"[\s\S]*?<span class="count">1 item<\/span>/, 'the second card counts its own items');
});

// Found in review: the count fill ran over the whole assembled document using a delimiter
// that authored prose may legally contain, so an item that spelled its own domain's
// placeholder lost the sentence it wrote and silently gained a count. The fill must use a
// token prose cannot produce, so text the author wrote survives as written.
test('authored prose that spells a count placeholder is rendered verbatim', () => {
  const spelled = md.replace('Why it matters.', 'The lead said %%d-ai-llm%% verbatim.');
  const html = render(spelled, config);
  assert.match(html, /<p class="sum">The lead said %%d-ai-llm%% verbatim\.<\/p>/,
    'the authored sentence survives character for character');
  assert.doesNotMatch(html, /<p class="sum">The lead said \d+ items? verbatim\.<\/p>/,
    'the count fill must never rewrite an authored sentence');
});

// The guard on the other side: a clean digest must still show its real counts, so the fix
// cannot pass the case above by turning counting off.
test('a clean digest still fills in its real item counts', () => {
  const html = render(md, config);
  assert.match(html, /<span class="count">1 item<\/span>/, 'the domain card keeps its real count');
  assert.doesNotMatch(html, /%%/, 'every placeholder the renderer emitted is filled in');
});

// Found in review: the header scan's skip rule was applied to the whole
// document, so a body line that looked like a title or an italic aside disappeared.
test('a body line that looks like a title or an aside is rendered, not dropped', () => {
  const html = render(md.replace('## Watch domains — quiet',
    '## Watch domains — quiet\n_Update: this aside must survive._\n\n# A body line that starts with a hash\nPlain line.'), config);
  assert.match(html, /Update: this aside must survive\./, 'the aside survives');
  assert.match(html, /A body line that starts with a hash/, 'the body line survives');
  assert.match(html, /Plain line\./);
});

// Found in review: the chip was added on the section heading, so a week
// whose featured section carries only the stand-in line offered a jump to nothing.
test('the featured chip appears only when the section carries a deep dive', () => {
  const standin = render(md.replace('## Core domains', '## Featured this week\nNothing this week warranted a deep dive.\n\n## Core domains'), config);
  assert.doesNotMatch(/<nav class="topics">([\s\S]*?)<\/nav>/.exec(standin)[1], /Featured<\/a>/, 'nothing to jump to');
  const card = render(md.replace('## Core domains', '## Featured this week\n### The deep dive\nProse.\n\n## Core domains'), config);
  assert.match(/<nav class="topics">([\s\S]*?)<\/nav>/.exec(card)[1], /Featured<\/a>/, 'a deep dive takes a chip');
});

// Found in review: a bullet the grammar does not describe rendered without
// the dot every other card leads with.
test('a bullet outside the grammar still leads with a marker dot and its badges', () => {
  const odd = md.replace('- **A model shipped** — Why it matters.', '- _an aside bullet the grammar does not describe_');
  const html = render(odd, config);
  assert.match(html, /<li class="story"><div class="hlrow"><span class="prov prov-primary"[^>]*><\/span><span class="hl">/, 'the marker it does carry picks the dot');
  assert.match(html, /<div class="badges"><a class="badge src"/, 'and its badges still render');
  const bare = md.replace('- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
    '- _a bullet with nothing the grammar recognises_');
  assert.match(render(bare, config), /<li class="story"><div class="hlrow"><span class="prov prov-default"[^>]*><\/span><span class="hl">/, 'no marker, neutral dot');
});

// Found in review: the documented "first clause" fallback was a comma-only
// split, so a comma-less name fell back to the whole heading - the thing the column exists
// to avoid.
test('a catalogue with no short column falls back to a clause, not to the whole name', () => {
  const names = [
    ['Chips, hardware and accelerators', 'Chips'],
    ['Photonics and optical interconnects', 'Photonics'],
    ['Neuroscience and brain-computer interfaces', 'Neuroscience'],
    ['AI / LLM', 'AI / LLM'],
    ['Real-time graphics, engines and generative media', 'Real-time graphics'],
  ];
  for (const [domain, want] of names) {
    const one = { domains: [{ key: 'k', domain, short: '', label_zh: '中文', cluster: 'C', tier: 'core' }] };
    const html = render(['# T', '_m_', '', '## Core domains', '### ' + domain + ' · 中文',
      '- **A thing shipped** — Why it matters. [src:Out 2026-09-20](https://example.com/a) [prov:primary] #new',
      '', '## Watch domains — quiet', ''].join('\n'), one);
    const nav = /<nav class="topics">([\s\S]*?)<\/nav>/.exec(html)[1];
    assert.ok(nav.includes('>' + want + '</a>'), domain + ' should chip as ' + want + ', got ' + nav);
    assert.ok(want.length <= 22, want + ' is still a shortcut');
  }
});

// The dark colour scheme makes the user agent draw a white focus ring, which read as a
// box drawn around the search box. Focus is drawn on-brand instead, and keyboard focus
// stays visible on every control.
// A manual check of the deliverable found no chips in the header and a light box around
// every card: a leftover copy of the old print rule sat at top level, so its display:none and
// its light border applied on screen. The byte-identity test cannot see this - both the file
// and a fresh render carried the same bug - so the emitted stylesheet is pinned here.
// A card the reader collapsed must not hide its content on paper. The print rule is one half
// and this handler the other; without it, printing a collapsed digest loses the items.
// A value that is only whitespace is a shell variable that expanded to nothing; the renderer
// used to accept it and write the deliverable to a file literally named ' '.
test('a whitespace-only --out is refused like an empty one', () => {
  for (const v of [' ', '\t', '\n']) {
    assert.throws(() => renderArgs(['d.md', '--out', v]), /empty value for --out/, JSON.stringify(v));
    assert.throws(() => renderArgs(['d.md', '--out', 'ok.html', '--config', v]), /empty value for --config/);
  }
  const dir = scratch();
  const res = run([join(dir, 'd.md'), '--out', ' ', '--config', join(REPO, 'config')], {
    readFile: () => '# T\n_m_\n', readDomains: () => [], writeFile: () => { throw new Error('must not write'); },
    log: () => {}, error: () => {},
  });
  assert.equal(res, 2, 'the CLI exits 2 rather than writing a file named " "');
});

// The reader caps an authored short label at 18 characters; a catalogue without the column
// falls back to a clause of the name, which used to run to 22.
test('the chip fallback keeps every label short too', () => {
  const rows = readDomains(join(REPO, 'config', 'domains.md')).map(({ short, ...rest }) => rest);
  const headings = rows.filter((r) => r.tier === 'core').map((r) => '### ' + r.domain + ' · ' + r.label_zh + '\nScanned, nothing notable.');
  const html = render(['# T', '_m_', '', '## Core domains'].concat(headings, ['', '## Watch domains — quiet', '']).join('\n'), { domains: rows });
  const chips = [.../<nav class="topics">([\s\S]*?)<\/nav>/.exec(html)[1].matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.ok(chips.length >= 10, 'chips: ' + chips.length);
  assert.deepEqual(chips.filter((c) => c.length > 18), [], 'over-long chips: ' + chips.filter((c) => c.length > 18).join(', '));
});

// Opening every card before printing must not leave the reader's collapsed state behind.
test('printing restores the collapse state afterwards', () => {
  const html = render(md, config);
  assert.match(html, /addEventListener\("afterprint", function\(\)\{/, 'an afterprint handler exists');
  assert.match(html, /afterprint[\s\S]*?collapse\.dispatchEvent\(new Event\("change"\)\)/, 'and it re-applies the control');
});

test('the script opens every card before printing', () => {
  const html = render(md, config);
  assert.match(html, /addEventListener\("beforeprint", function\(\)\{/, 'the handler exists');
  assert.match(html, /beforeprint[\s\S]*?querySelectorAll\("details\.aspect"\)/, 'and it targets the domain cards');
  assert.match(html, /beforeprint[\s\S]*?setAttribute\("open", ""\)/, 'opening them');
});

// Removing a marker leaves the space it occupied, which lands before the punctuation the
// author wrote after it: "citations and [prov:primary] ." must not ship as "citations and .".
test('a removed marker does not leave a space before the punctuation', () => {
  const marked = md.replace('Why it matters.', 'See the note [prov:primary] . It matters.');
  const html = render(marked, config);
  const summary = /<p class="sum">([^<]*)<\/p>/.exec(html)[1];
  assert.equal(summary, 'See the note. It matters.', 'the marker is gone and the sentence is tidy');
  assert.doesNotMatch(summary, /\s+[.,;:!?]/, 'no space before punctuation');
  assert.doesNotMatch(summary, /  /, 'no double space');
  const plus = render(md.replace('Why it matters.', 'It cites two [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) and [prov:primary] .'), config);
  assert.doesNotMatch(/<p class="sum">([^<]*)<\/p>/.exec(plus)[1], /\s+[.,;:!?]/, 'the same after a citation');
});

test('print-only rules stay inside the print media block', () => {
  const html = render(md, config);
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  assert.equal((css.match(/@media print/g) ?? []).length, 1, 'exactly one print block');
  const cut = css.indexOf('@media print');
  const screen = css.slice(0, cut);
  const print = css.slice(cut);
  assert.match(print, /\.controls,nav\.topics,#toTop\{display:none\}/, 'the chrome is hidden in print');
  assert.match(print, /details\.aspect:not\(\[open\]\)>\.aspect-body\{display:block\}/, 'a collapsed card prints open');
  assert.doesNotMatch(screen, /nav\.topics\{display:none\}/, 'the navigation is visible on screen');
  assert.doesNotMatch(screen, /#toTop\{display:none\}/, 'the floating button is visible on screen');
  assert.doesNotMatch(screen, /details\.aspect\{border:1px solid #ccc\}/, 'the cards keep their own edge on screen');
  assert.doesNotMatch(screen, /body\{font-size:11pt\}/, 'the screen keeps its own type size');
  assert.equal((css.match(/\{/g) ?? []).length, (css.match(/\}/g) ?? []).length, 'the stylesheet braces balance');
});

test('focus is drawn on-brand rather than as the user agent white box', () => {
  const html = render(md, config);
  assert.match(html, /#q:focus\{outline:none;border-color:var\(--acc\);box-shadow:0 0 0 3px rgba\(77,163,255,\.22\)\}/);
  assert.match(html, /:focus-visible\{outline:2px solid var\(--acc\);outline-offset:2px\}/);
  assert.doesNotMatch(html, /outline:\s*auto/, 'no rule hands focus back to the user agent box');
});

// The document's shape: a section per level-2 heading,
// a collapsible card per domain carrying its item count, and a card per item with its
// citation, provenance and status on their own badge row rather than inline in prose.
test('a domain is a card with a count and an item is a card with its own badge row', () => {
  const html = render(md, config);
  assert.match(html, /<section class="sec" id="d-core-domains"><h2>Core domains<\/h2>/);
  assert.match(html, /<details class="aspect" id="d-ai-llm" data-cluster="AI and compute" open>/);
  assert.match(html, /<summary><span class="ah">AI \/ LLM · 人工智能 \/ 大模型<\/span><span class="badges"><span class="tier core">core<\/span><span class="count">1 item<\/span><\/span><\/summary>/);
  assert.match(html, /<div class="aspect-body">/);
  assert.match(html, /<li class="story"><div class="hlrow"><span class="prov prov-[a-z-]+"[^>]*><\/span><a class="hl" href="https:\/\/huggingface\.co\/blog\/x" target="_blank" rel="noopener">A model shipped<\/a><\/div><p class="sum">Why it matters\.<\/p><div class="badges">/);
  assert.match(html, /<a class="badge src" href="https:\/\/huggingface\.co\/blog\/x" target="_blank" rel="noopener">Hugging Face blog 2026-09-20<\/a>/);
  assert.match(html, /<span class="badge prov-primary">primary<\/span>/);
  assert.match(html, /<span class="tag t-new">new<\/span>/);
  assert.match(html, /<p class="quiet">Quantum technologies \(scanned, nothing notable\)<\/p>/, 'the quiet section is prose, styled as quiet');
  assert.match(html, /document\.querySelectorAll\("details\.aspect"\)/, 'collapse-all drives the domain cards');
  assert.match(html, /document\.querySelectorAll\("\.story"\)/, 'the search box filters the story cards');
  assert.doesNotMatch(html, /%%/, 'the count placeholder is always filled in');
});

// This test used to pin the opposite: an earlier rule required the navigation to be
// grouped by cluster, so the renderer had to stop emitting one flat link list. That
// rule was superseded - the navigation is again one flat row of pills, in document
// order. The cluster survives
// as data-cluster on the card, where it is data rather than a label.
test('the topic navigation is one flat row of pills in document order', () => {
  const twoDomains = md.replace('## Watch domains — quiet',
    '## Watch domains — notable this week\n### Quantum technologies · 量子技术\n- **A qubit milestone** — Why it matters. [src:Hugging Face blog 2026-09-21](https://huggingface.co/blog/z) [prov:primary] #new\n\n## Watch domains — quiet');
  const html = render(twoDomains, config);
  const nav = /<nav class="topics">([\s\S]*?)<\/nav>/.exec(html)[1];
  assert.match(nav, /href="#d-ai-llm"/);
  assert.doesNotMatch(nav, /class="cluster/, 'no cluster label survives in the navigation');
  assert.deepEqual(
    [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]),
    ['d-ai-llm', 'd-quantum-technologies'],
    'chips follow the order the headings appear in',
  );
  assert.match(html, /data-cluster="AI and compute"/, 'the cluster stays on the card as data');
  assert.doesNotMatch(html, /\.cluster-name\{/, 'the cluster label rule is gone from the stylesheet');
});

// Regression test: the old check tested /\burl\(\s*["']?https?:/i
// against the whole document, so ordinary prose that mentions a url(https://...)
// string made the renderer refuse to write and the gate fail, while a <link> in
// prose was flagged too. Only real asset contexts count now.
test('externalAssets flags real asset contexts and nothing else', () => {
  assert.equal(externalAssets('<script src="https://cdn.example.com/a.js"></script>'), true, 'script src');
  assert.equal(externalAssets('<link rel="stylesheet" href="https://cdn.example.com/a.css">'), true, 'link href');
  assert.equal(externalAssets('<img src="https://cdn.example.com/a.png">'), true, 'img src');
  assert.equal(externalAssets('<style>@import "https://cdn.example.com/a.css";</style>'), true, '@import');
  assert.equal(externalAssets('<style>body{background:url(https://cdn.example.com/a.png)}</style>'), true, 'remote url() in CSS');
  assert.equal(externalAssets('<style>body{background:url(data:image/png;base64,AAAA)}</style>'), false, 'a data: URI is self-contained');
  assert.equal(
    externalAssets('<html><body><p>See url(https://example.com/x) for the method.</p>'
      + '<a class="src" href="https://huggingface.co/blog/x">Hugging Face blog</a></body></html>'),
    false,
    'prose and citation links are not assets',
  );
  assert.equal(externalAssets(render(md, config)), false, 'the rendered digest stays self-contained');
});

// Regression test: the predicate used ad-hoc regexes that did not model HTML
// tokenisation ('/' is a valid separator between attributes, a value need not be quoted)
// and knew only src/data/srcset, so a document that fetches remote resources was judged
// self-contained and the gate reported QUALITY: PASS for an artifact that breaks the
// moment it is opened from disk. Each case names the fetch it hides.
test('externalAssets sees the evasions the tokenisation permits', () => {
  const cases = [
    ['/ as the attribute separator', '<img/src="https://cdn.example.com/a.png">'],
    ['an unquoted style attribute', '<div style=background:url(https://cdn.example.com/a.png)>x</div>'],
    ['the video poster attribute', '<video poster="https://cdn.example.com/a.jpg"></video>'],
    ['a link rel=preload', '<link rel="preload" href="https://cdn.example.com/a.js" as="script">'],
    ['a link rel=icon', '<link rel="icon" href="https://cdn.example.com/a.ico">'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://example.com/x">'],
    ['an SVG image href', '<svg><image href="https://cdn.example.com/a.svg"></image></svg>'],
    ['an SVG use href', '<svg><use href="https://cdn.example.com/a.svg#icon"></use></svg>'],
    ['the legacy body background', '<body background="https://cdn.example.com/a.png">x</body>'],
    ['a script with the separator form', '<script/src="https://cdn.example.com/a.js"></script>'],
  ];
  for (const [what, html] of cases) {
    assert.equal(externalAssets(html), true, what + ' must count as an external asset');
  }
  for (const inline of [
    '<img src="data:image/png;base64,AAAA">',
    '<video poster="data:image/jpeg;base64,AAAA"></video>',
    '<link rel="preload" href="data:text/css,a{}" as="style">',
  ]) {
    assert.equal(externalAssets(inline), false, 'a data: URI is still self-contained: ' + inline);
  }
});

// Regression test: the tag tokeniser treated a quoted attribute value as opaque, so markup
// nested in an iframe srcdoc was never scanned; attribute values were compared without
// entity decoding, so an encoded meta refresh hid; the CSS vocabulary knew url() and
// @import but not image-set(); and any non-empty href on use/image counted as remote
// although a bare fragment is in the document. Reachability is a hand-edited or
// third-party HTML passed to --html, the same reachability the earlier evasions were
// filed under.
test('externalAssets sees an srcdoc, an encoded refresh and image-set, and not a bare fragment', () => {
  const evasions = [
    ['iframe srcdoc hiding a remote image', '<iframe srcdoc="<img src=\'https://cdn.example.com/a.png\'>"></iframe>'],
    ['an entity-encoded meta refresh', '<meta http-equiv="&#114;efresh" content="0;url=https://example.com/x">'],
    ['image-set in a style attribute', '<div style="background:image-set(\'https://cdn.example.com/a.png\' 1x)">x</div>'],
    ['image-set in a style element', '<style>body{background-image:image-set("https://cdn.example.com/a.png" 1x)}</style>'],
  ];
  for (const [what, html] of evasions) {
    assert.equal(externalAssets(html), true, what + ' must count as an external asset: ' + html);
  }
  for (const benign of [
    '<svg><use href="#icon"></use></svg>',
    '<svg><image href="#tile"></image></svg>',
  ]) {
    assert.equal(externalAssets(benign), false, 'an in-document fragment fetches nothing: ' + benign);
  }
});

// The same evasions through the CLI's self-containment decision, which is what the gate
// and the renderer both consult.
test('the CLI refuses to write an artifact that hides a remote fetch', () => {
  const writes = [];
  const errors = [];
  const code = run(['digest.md', '--out', 'digest.html'], {
    readFile: () => md,
    readDomains: () => config.domains,
    render: () => '<!doctype html><html><body><img/src="https://cdn.example.com/a.png"></body></html>',
    writeFile: (path, body) => writes.push([path, body]),
    log: () => {},
    error: (m) => errors.push(m),
  });
  assert.equal(code, 5, 'the artifact fetches an asset, so it must not be written');
  assert.deepEqual(writes, [], 'nothing was written');
  assert.match(errors.join('\n'), /external asset/);
});

// Regression test: the marker vocabulary the renderer trusts is legal prose anywhere,
// including text that arrived from an upstream feed through the collector pool. A card
// must not draw an origin pill, a provenance badge or a status tag out of that text.
test('pool text cannot draw the renderer badges it mimics', () => {
  const injected = md.replace(
    '- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
    '- **[prov:vendor-claim] #new [src:Trusted 2026-09-20](https://evil.example/x) [alt:Better](https://evil.example/y)**'
      + ' — Upstream text. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
  );
  const html = render(injected, config);
  assert.doesNotMatch(html, /prov-vendor-claim/, 'a forged provenance badge');
  assert.doesNotMatch(html, /href="https:\/\/evil\.example\/x"/, 'a forged origin pill');
  assert.doesNotMatch(html, /href="https:\/\/evil\.example\/y"/, 'a forged alternative pill');
  assert.equal(html.includes('#new'), false, 'a raw status token is not text a card keeps');
});

// Regression test: the CLI wrote the deliverable before evaluating
// self-containment, so exit 5 left a broken file on disk.
test('the CLI checks self-containment before it writes the file', () => {
  const writes = [];
  const errors = [];
  const code = run(['digest.md', '--out', 'digest.html'], {
    readFile: () => md,
    readDomains: () => config.domains,
    render: () => '<!doctype html><html><head><script src="https://cdn.example.com/a.js"></script></head><body>x</body></html>',
    writeFile: (path, body) => writes.push([path, body]),
    log: () => {},
    error: (m) => errors.push(m),
  });
  assert.equal(code, 5);
  assert.deepEqual(writes, [], 'no deliverable may be left on disk');
  assert.match(errors.join('\n'), /external asset/);
});
// Regression test: design 4.3 draws an item as a headline line with
// the citation on an indented continuation line. The renderer used to turn that
// continuation into its own paragraph, so the citation escaped the list item.
test('render keeps an indented citation continuation inside the same list item', () => {
  const multiline = [
    '# Tech Radar — 2026-09-23',
    '_Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit_',
    '',
    '## Core domains',
    '### AI / LLM · 人工智能 / 大模型',
    '- **A model shipped** — Why it matters.',
    '  [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
  ].join('\n');
  const html = render(multiline, config);
  assert.equal((html.match(/<li class="story">/g) ?? []).length, 1, 'one item, one story card');
  assert.match(
    html,
    /<li class="story"><div class="hlrow"><span class="prov prov-[a-z-]+"[^>]*><\/span><a class="hl" href="https:\/\/huggingface\.co\/blog\/x"[^>]*>A model shipped<\/a><\/div><p class="sum">Why it matters\.<\/p>[\s\S]*?<a class="badge src" href="https:\/\/huggingface\.co\/blog\/x"[^>]*>[\s\S]*?<\/li>/,
    'the citation belongs to the item',
  );
  assert.doesNotMatch(html, /<p>[^<]*\[src:/, 'the continuation is not its own paragraph');
});

test('render still renders the one-line item form', () => {
  const html = render(md, config);
  assert.equal((html.match(/<li class="story">/g) ?? []).length, 1);
  assert.match(html, /<li class="story"><div class="hlrow"><span class="prov prov-[a-z-]+"[^>]*><\/span><a class="hl" href="https:\/\/huggingface\.co\/blog\/x"[^>]*>A model shipped<\/a><\/div>[\s\S]*?<a class="badge src" href="https:\/\/huggingface\.co\/blog\/x"[^>]*>[\s\S]*?<\/li>/);
});
// Regression test: the published HTML showed the raw asterisks of
// every headline, because linkify escaped and linked but never applied the output
// contract's one emphasis marker. The two tests above used to pin that literal
// text; they now pin the <strong> element instead.
test('render turns the headline marker into a strong element', () => {
  const html = render(md, config);
  assert.match(html, /<div class="hlrow"><span class="prov prov-[a-z-]+"[^>]*><\/span><a class="hl" href="https:\/\/huggingface\.co\/blog\/x"[^>]*>A model shipped<\/a><\/div><p class="sum">Why it matters\.<\/p>/);
  const item = /<li class="story">([\s\S]*?)<\/li>/.exec(html)[1];
  assert.doesNotMatch(item, /\*\*/, 'no literal bold markers survive into the deliverable');
  assert.match(html, /<h1>Tech Radar — 2026-09-23<\/h1>/, 'nothing else is emphasised');
});

test('render leaves a lone asterisk that is not the headline marker alone', () => {
  const html = render(md.replace('Why it matters.', 'Why 2 * 3 matters.'), config);
  assert.match(html, /Why 2 \* 3 matters\./);
  assert.match(html, /<li class="story"><div class="hlrow"><span class="prov prov-[a-z-]+"[^>]*><\/span><a class="hl"[^>]*>A model shipped<\/a>/);
});
const REPO = fileURLToPath(new URL('../', import.meta.url));
const scratch = () => mkdtempSync(join(tmpdir(), 'tech-radar-render-'));

// Regression test: the renderer resolved its config against the
// working directory while the other three scripts resolved it next to the script,
// so the documented commands had to carry an exception for it.
test('the renderer resolves its default config next to the script, not the cwd', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  const outPath = join(dir, 'digest.html');
  writeFileSync(mdPath, md);
  const cwd = process.cwd();
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  let code;
  try {
    process.chdir(dir);
    code = run([mdPath, '--out', outPath]);
  } finally {
    process.chdir(cwd);
    console.error = orig;
    process.exitCode = 0;
  }
  assert.equal(code, 0, errors.join('\n'));
  assert.doesNotMatch(errors.join('\n'), /cannot read config/);
  assert.ok(existsSync(outPath), 'the deliverable was written from a foreign working directory');
});

test('the renderer still honours an explicit --config override', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  const outPath = join(dir, 'digest.html');
  writeFileSync(mdPath, md);
  const code = run([mdPath, '--out', outPath, '--config', join(REPO, 'tests', 'fixtures', 'digest', 'config')]);
  assert.equal(code, 0);
  assert.ok(existsSync(outPath));
});
// Regression test: the shipped example carries two leading underscore
// lines - an illustrative disclaimer and the real window line - and the renderer
// took the first, so the disclaimer became the header meta and the window label
// survived only inside the coverage note.
test('render takes the meta line adjacent to the content when the header carries two', () => {
  const two = [
    '# Tech Radar — 2026-09-23',
    '_Illustrative example. The stories and dates below are placeholders and must never be copied into a real digest._',
    '_Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit · 2 domains scanned · 1 item_',
    '',
    '## Core domains',
    '### AI / LLM · 人工智能 / 大模型',
    '- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
  ].join('\n');
  const html = render(two, config);
  assert.match(html, /<p class="meta">Covering 2026-09-16 08:00 to 2026-09-23 08:00 \(Asia\/Shanghai\) · cap not hit/);
  assert.doesNotMatch(html, /<p class="meta">Illustrative/);
  assert.match(html, /<h1>Tech Radar — 2026-09-23<\/h1>/);
});

test('render still takes the only underscore line as meta and the first title line as title', () => {
  const html = render(md, config);
  assert.match(html, /<p class="meta">Covering 2026-09-16 08:00 to 2026-09-23 08:00 \(Asia\/Shanghai\) · cap not hit<\/p>/);
});
// --- the self-containment predicate, linkify and the heading scope ---

test('prose that mentions @import or url() is not an external asset', () => {
  assert.equal(externalAssets('<p>The CSS @import rule pulls a stylesheet in.</p>'), false);
  assert.equal(externalAssets('<p>See url(https://example.com/x) for the method.</p>'), false);
  assert.equal(externalAssets('<style>@import "https://cdn.example.com/a.css";</style>'), true, 'the CSS form still counts');
  assert.equal(externalAssets('<style>body{background:url(https://cdn.example.com/a.png)}</style>'), true);
  assert.equal(externalAssets('<style>@import url(data:text/css,body%7B%7D);</style>'), false, 'an inline data: import is self-contained');
});

test('a digest whose prose mentions @import still renders and stays self-contained', () => {
  const mentioned = md.replace('Why it matters.', 'The CSS @import rule is what changed.');
  const html = render(mentioned, config);
  assert.match(html, /@import rule is what changed/);
  assert.equal(externalAssets(html), false);
});

test('a data: URI and a canonical link are not fetched assets', () => {
  assert.equal(externalAssets('<img src="data:image/png;base64,AAAA">'), false);
  assert.equal(externalAssets('<link rel="stylesheet" href="data:text/css,body%7B%7D">'), false);
  assert.equal(externalAssets('<link rel="canonical" href="https://example.com/digest">'), false);
  assert.equal(externalAssets('<link rel="alternate" href="https://example.com/feed">'), false);
  assert.equal(externalAssets('<script src="data:text/javascript,void 0"></script>'), false);
});

test('a real network asset is still flagged', () => {
  assert.equal(externalAssets('<script src="https://cdn.example.com/a.js"></script>'), true);
  assert.equal(externalAssets('<link rel="stylesheet" href="https://cdn.example.com/a.css">'), true);
  assert.equal(externalAssets('<img src="https://cdn.example.com/a.png">'), true);
  assert.equal(externalAssets('<iframe src="https://example.com/x"></iframe>'), true);
  assert.equal(externalAssets('<img srcset="https://cdn.example.com/a.png 2x">'), true);
  assert.equal(externalAssets('<img srcset="data:image/png;base64,AA 1x, data:image/png;base64,BB 2x">'), false);
});

test('linkify does not rewrite a citation whose URL contains markup-like text', () => {
  const html = linkify('- **Headline** — body [src:Blog 2026-09-20](https://example.com/a#new) [prov:primary] #new');
  assert.match(html, /href="https:\/\/example\.com\/a#new"/);
  assert.match(html, /<strong>Headline<\/strong>/);
  assert.equal((html.match(/class="tag t-new"/g) ?? []).length, 1, 'the status flag comes from the marker, not the URL');

  const brackets = linkify('- **H** — body [src:Blog 2026-09-20](https://example.com/[prov:primary]) [prov:primary] #new');
  assert.match(brackets, /href="https:\/\/example\.com\/\[prov:primary\]"/);
  assert.equal((brackets.match(/class="badge prov-primary"/g) ?? []).length, 1);

  const stars = linkify('- **H** — body [src:Blog 2026-09-20](https://example.com/**a**) [prov:primary] #new');
  assert.match(stars, /href="https:\/\/example\.com\/\*\*a\*\*"/);
  assert.doesNotMatch(stars, /href="[^"]*<strong>/);
  assert.match(stars, /<strong>H<\/strong>/);
});

// The featured deep dive is a story card like any other: a provenance dot, a headline
// linked to the source the prose cites, then the
// prose itself. A week with no deep dive keeps the stand-in line and grows no card.
test('the featured deep dive is a card with a marker dot and a linked headline', () => {
  const withFeatured = (body) => md.replace('## Core domains', '## Featured this week\n' + body + '\n\n## Core domains');

  const cited = render(withFeatured('### The deep dive\nWhy it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary]'), config);
  assert.match(cited, /<ul class="stories"><li class="story featured"><div class="hlrow">/);
  assert.match(cited, /<span class="prov prov-primary" title="Provenance: primary"><\/span>/);
  assert.match(cited, /<a class="hl" href="https:\/\/huggingface\.co\/blog\/x" target="_blank" rel="noopener">The deep dive<\/a>/);
  assert.match(cited, /<p class="sum">Why it matters\.<\/p>\s*<div class="badges"><a class="badge src" href="https:\/\/huggingface\.co\/blog\/x"[^>]*>Hugging Face blog 2026-09-20<\/a><span class="badge prov-primary">primary<\/span><\/div>\s*<\/li><\/ul>/,
    'the prose keeps the sentences and the markers move to the badge row');
  assert.match(cited, /<a href="#d-featured-this-week" title="Featured this week">Featured<\/a>/, 'the featured section takes a navigation chip');
  const tagged = render(withFeatured('### The deep dive\nWhy it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new'), config);
  assert.match(/<li class="story featured">([\s\S]*?)<\/li>/.exec(tagged)[1],
    /<div class="badges">[\s\S]*?<span class="badge prov-primary">primary<\/span><span class="tag t-new">new<\/span><\/div>/,
    'origin, provenance and status: the same three labels an item card carries');
  assert.match(cited, /<a href="#d-featured-this-week" title="Featured this week">Featured<\/a>/, 'the featured section takes a navigation chip');
  assert.match(cited, /<li class="story featured"><div class="hlrow"><span class="prov prov-primary"/);
  assert.doesNotMatch(cited, /li\.story\.featured\{/, 'no featured-only styling: one card shape for both');
  assert.match(cited, /\.prov-primary\{background:#2ea043\}/);

  const bare = render(withFeatured('### The deep dive\nNo citations here at all.'), config);
  assert.match(bare, /<span class="prov prov-default" title="No provenance marker: the deep dive/);
  assert.match(bare, /<span class="hl">The deep dive<\/span>/, 'no citation, no dead link');

  const standin = render(withFeatured('Nothing this week warranted a deep dive.'), config);
  assert.doesNotMatch(standin, /story featured/, 'the stand-in line is prose, not a card');
  assert.match(standin, /<p>Nothing this week warranted a deep dive\.<\/p>/);
});

// The shipped example is the demonstration artifact. If its deep dive cites nothing,
// the rendered card shows no origin pill and no linked headline, and a feature nobody
// can see reads as a feature that does not work. It cites a placeholder on purpose.
test('the shipped example demonstrates the featured card: linked headline and badge row', () => {
  const sample = readFileSync(join(REPO, 'examples', 'sample-digest.md'), 'utf8');
  const html = render(sample, { domains: readDomains(join(REPO, 'config', 'domains.md')) });
  const featured = /<li class="story featured">([\s\S]*?)<\/li>/.exec(html)[1];
  assert.match(featured, /<div class="hlrow"><span class="prov prov-preprint" title="Provenance: preprint"><\/span><a class="hl" href="https:\/\/example\.org\/preprints\/open-weights" target="_blank" rel="noopener">/);
  assert.match(featured, /<div class="badges"><a class="badge src" href="https:\/\/example\.org\/preprints\/open-weights"[^>]*>arXiv cs\.CL listing 2026-09-18<\/a><span class="badge prov-preprint">preprint<\/span><span class="tag t-new">new<\/span><\/div>/,
    'the shipped deep dive demonstrates all three labels');
  assert.match(html, /<a href="#d-featured-this-week" title="Featured this week">Featured<\/a><a href="#d-ai-llm"/, 'the featured chip leads the row');
  assert.doesNotMatch(featured, /\[src:|\[prov:/, 'the markers are moved to the badge row, not left in the sentences');
});

// A digest carries one featured section; a doubled heading must not take the same chip
// twice and point both at the same anchor.
test('a repeated featured section takes one chip, not two', () => {
  const doubled = [
    '# T', '_m_', '', '## Featured this week', '### Deep one',
    'One. [src:Out 2026-09-20](https://example.com/f) [prov:primary] #new',
    '## Featured this week', '### Deep two',
    'Two. [src:Out 2026-09-21](https://example.com/g) [prov:secondary] #new',
    '', '## Core domains', '### AI / LLM · 人工智能 / 大模型',
    '- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
    '', '## Watch domains — quiet', '',
  ].join('\n');
  const html = render(doubled, config);
  const nav = /<nav class="topics">([\s\S]*?)<\/nav>/.exec(html)[1];
  assert.equal((nav.match(/d-featured-this-week/g) ?? []).length, 1, 'one chip per section heading');
  assert.equal((html.match(/<li class="story featured">/g) ?? []).length, 2, 'both deep dives still render');
});

test('a heading outside a domain section gets no navigation entry and no tier badge', () => {
  const withFeatured = md.replace(
    '## Core domains',
    '## Featured this week\n### Why AI / LLM changed everything\nTen minutes of prose.\n\n## Core domains',
  );
  const html = render(withFeatured, config);
  const nav = /<nav class="topics">([\s\S]*?)<\/nav>/.exec(html)[1];
  assert.match(nav, /AI \/ LLM · 人工智能 \/ 大模型/, 'the real domain stays in the nav');
  assert.doesNotMatch(nav, /Why AI/, 'the deep-dive headline is not a topic');
  assert.match(html, /<span class="hl">Why AI \/ LLM changed everything<\/span>/, 'it renders as the deep-dive card headline');
  assert.doesNotMatch(html, /<h3[^>]*>Why AI[^<]*<span class="tier/);
});

test('a CRLF digest renders the same as an LF one', () => {
  const crlf = md.replace(/\n/g, '\r\n');
  const html = render(crlf, config);
  assert.equal((html.match(/<li class="story">/g) ?? []).length, 1);
  assert.match(html, /<li class="story"><div class="hlrow"><span class="prov prov-[a-z-]+"[^>]*><\/span><a class="hl"[^>]*>A model shipped<\/a>/);
  assert.match(html, /<p class="meta">Covering 2026-09-16 08:00/);
});
test('the renderer still writes a digest whose prose mentions @import', () => {
  const dir = scratch();
  const mdPath = join(dir, 'digest.md');
  const outPath = join(dir, 'digest.html');
  writeFileSync(mdPath, md.replace('Why it matters.', 'The CSS @import rule is what changed.'));
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  let code;
  try {
    code = run([mdPath, '--out', outPath, '--config', join(REPO, 'tests', 'fixtures', 'digest', 'config')]);
  } finally {
    console.error = orig;
    process.exitCode = 0;
  }
  assert.equal(code, 0, errors.join('\n'));
  assert.ok(existsSync(outPath), 'the deliverable is written rather than withheld');
});
test('the renderer usage names the script-relative config default', () => {
  const out = [];
  const code = run(['-h'], { log: (m) => out.push(m), error: () => {} });
  assert.equal(code, 0);
  const usage = out.join('\n');
  assert.match(usage, /default: the config\/ directory next[\s\S]*?to this script/);
  assert.doesNotMatch(usage, /default: config\)/);
});

// Regression test: the fix that
// stopped inventing an 'Other' navigation cluster and a fabricated watch tier badge
// for the heading of the featured deep dive landed in the renderer, but
// examples/sample-digest.html was never regenerated, so the shipped artifact still
// demonstrated the old bug. Rendering the shipped Markdown with the shipped renderer
// must reproduce the shipped HTML byte for byte.

// --- the status tag, the artifact's atomicity and the self-containment predicate ---------

// Regression test: the status tag took the last token of any kind while the gate and the
// state merge take the last new|followup token, so a #new item carrying an additive flag was
// published with a "developing" tag that contradicted the digest it renders.
test('the status tag is the last #new or #followup token, in either order', () => {
  const digestWith = (tags) => [
    '# Tech Radar — 2026-09-23',
    '_Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit_',
    '',
    '## Core domains',
    '### AI / LLM · 人工智能 / 大模型',
    '- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] ' + tags,
    '',
    '## Watch domains — quiet',
    'Quantum technologies (scanned, nothing notable)',
  ].join('\n');
  const shown = (tags) => {
    const html = render(digestWith(tags), config);
    return { fresh: /class="tag t-new"/.test(html), developing: /class="tag t-developing"/.test(html) };
  };
  const additiveAfter = shown('#new #developing');
  assert.equal(additiveAfter.fresh, true, 'a #new item keeps its new tag');
  assert.equal(additiveAfter.developing, false, 'an additive flag does not win the tag');
  const additiveBefore = shown('#developing #new');
  assert.equal(additiveBefore.fresh, true, 'the flag resolves the same in either order');
  assert.equal(additiveBefore.developing, false, 'an additive flag does not win the tag');
});

// Regression test: the renderer wrote its deliverable in place, so a failed or interrupted
// write destroyed the previous digest - the atomic temp-then-rename the state writer uses had
// never reached this writer. A replacement is published by a rename, and a refused write
// leaves the previous artifact intact with no temp behind.
test('the renderer replaces its deliverable atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-atomic-render-'));
  const quiet = { log: () => {}, error: () => {} };
  try {
    const input = join(dir, 'digest.md');
    const out = join(dir, 'digest.html');
    writeFileSync(input, md);
    writeFileSync(out, 'the previous deliverable\n');
    const before = statSync(out).ino;
    assert.equal(run([input, '--out', out], quiet), 0, 'the render succeeds');
    assert.notEqual(statSync(out).ino, before,
      'the deliverable is published by a rename, not truncated in place');
    const published = readFileSync(out, 'utf8');
    chmodSync(out, 0o444);
    try {
      const refused = run([input, '--out', out], quiet);
      if (refused !== 0) {
        assert.equal(refused, 4, 'a refused write is the documented output exit');
        assert.equal(readFileSync(out, 'utf8'), published, 'the previous deliverable survives intact');
      }
    } finally {
      chmodSync(out, 0o644);
    }
    const leftovers = readdirSync(dir).filter((name) => name !== 'digest.md' && name !== 'digest.html');
    assert.deepEqual(leftovers, [], 'no temp file is left behind: ' + leftovers.join(', '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// TR-80 regression test: the deliverable writer publishes by renaming, and a rename needs only
// the destination directory - so a digest the operator had protected with a cleared write bit
// was replaced anyway, where the state writer refuses exactly that. The refusal is the
// documented output exit and the previous artifact keeps its bytes.
test('the renderer refuses a write-protected deliverable and leaves it byte-identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-protected-render-'));
  const quiet = { log: () => {}, error: () => {} };
  try {
    const input = join(dir, 'digest.md');
    const out = join(dir, 'digest.html');
    writeFileSync(input, md);
    const published = 'the previous deliverable\n';
    writeFileSync(out, published);
    chmodSync(out, 0o444);
    let refused;
    try {
      refused = run([input, '--out', out], quiet);
    } finally {
      chmodSync(out, 0o644);
    }
    assert.equal(refused, 4, 'a protected deliverable is the documented output exit');
    assert.equal(readFileSync(out, 'utf8'), published, 'the previous deliverable survives byte-identically');
    const leftovers = readdirSync(dir).filter((name) => name !== 'digest.md' && name !== 'digest.html');
    assert.deepEqual(leftovers, [], 'no temp file is left behind: ' + leftovers.join(', '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression test: an absent deliverable is not a protected one. The atomic writer resolved
// a missing destination to 0600, so a first render produced an owner-only digest under the
// usual umask - narrower than the plain write it replaced, and the digest is meant to be
// forwarded and opened. A fresh destination must be born with the mode a plain write would
// give it. The control file is written plainly by this same process, so the assertion holds
// under whatever umask the run inherits rather than pinning one value.
test('the renderer gives a fresh deliverable the mode a plain write would', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-mode-render-fresh-'));
  const quiet = { log: () => {}, error: () => {} };
  try {
    const input = join(dir, 'digest.md');
    const out = join(dir, 'digest.html');
    const control = join(dir, 'control.txt');
    writeFileSync(input, md);
    writeFileSync(control, 'a plain write by this process\n');
    assert.equal(run([input, '--out', out], quiet), 0, 'the render succeeds');
    assert.equal(statSync(out).mode & 0o777, statSync(control).mode & 0o777,
      'a fresh deliverable is created with the process default, not an owner-only 0600: '
      + (statSync(out).mode & 0o777).toString(8));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression test: the atomic deliverable writer created its temp with the process default
// and renamed it over the destination, so an HTML the operator had tightened came back at
// the umask's 0664 - the mode loss the state writer had already been fixed for. A
// replacement must carry the mode of the file it replaces.
test('the renderer keeps the mode of the deliverable it replaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tech-radar-mode-render-'));
  const quiet = { log: () => {}, error: () => {} };
  try {
    const input = join(dir, 'digest.md');
    const out = join(dir, 'digest.html');
    writeFileSync(input, md);
    writeFileSync(out, 'the previous deliverable\n');
    chmodSync(out, 0o600);
    assert.equal(run([input, '--out', out], quiet), 0, 'the render succeeds');
    assert.equal(statSync(out).mode & 0o777, 0o600,
      'the deliverable keeps the mode it was protected with, not the umask: '
      + (statSync(out).mode & 0o777).toString(8));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression test: the tag regex stopped at the first '>', so a quoted attribute value
// containing one hid every attribute after it; the rel list knew only stylesheet, preload and
// icon; and an empty value was read as a URL. Each evasion must be seen, and an empty value
// must not be - an empty URL fetches the document itself.
test('externalAssets sees what a quoted value, a longer rel list and an empty value hide', () => {
  const evasions = [
    ['a quoted value containing ">" before src', '<img alt="x>" src="//evil.example/x.png">'],
    ['a quoted value containing ">" before a script src', '<script data-x="a>b" src="//evil.example/a.js"></script>'],
    ['rel=apple-touch-icon', '<link rel="apple-touch-icon" href="//evil.example/a.png">'],
    ['rel=modulepreload', '<link rel="modulepreload" href="//evil.example/a.js">'],
    ['rel=mask-icon', '<link rel="mask-icon" href="//evil.example/a.svg">'],
    ['rel=manifest', '<link rel="manifest" href="//evil.example/a.webmanifest">'],
  ];
  for (const [what, html] of evasions) {
    assert.equal(externalAssets(html), true, what + ' must count as an external asset: ' + html);
  }
  for (const benign of [
    '<img src="" alt="x">',
    '<img src alt="x">',
    '<link rel="canonical" href="https://h.example/x">',
    '<a class="src" href="https://h.example/x">a citation</a>',
  ]) {
    assert.equal(externalAssets(benign), false, 'an empty value or a citation is not an asset: ' + benign);
  }
});

test('the shipped example renders byte for byte to the shipped artifact', () => {
  const writes = [];
  const errors = [];
  const code = run(
    [join(REPO, 'examples', 'sample-digest.md'), '--out', join(REPO, 'examples', 'sample-digest.html')],
    {
      writeFile: (path, body) => writes.push([path, body]),
      log: () => {},
      error: (m) => errors.push(m),
    },
  );
  assert.equal(code, 0, errors.join('\n'));
  assert.equal(writes.length, 1, 'the shipped example is rendered exactly once');
  const delivered = writes[0][1];
  assert.equal(
    delivered,
    readFileSync(join(REPO, 'examples', 'sample-digest.html'), 'utf8'),
    'examples/sample-digest.html is stale: regenerate it with scripts/render-html.mjs',
  );
  assert.equal(externalAssets(delivered), false, 'the shipped artifact stays self-contained');
});

// TR-37 regression test: the renderer refuses a digest that carries its substitution
// sentinel -- a NUL byte in authored text could rewrite the document -- but the refusal was
// a bare throw that escaped main(). The one input the renderer cannot render therefore
// exited 1 with a raw stack trace, a code the exit table reserves as unreachable for this
// script, while its documented answer for an input it cannot use is exit 2, one named line,
// and no deliverable on disk.
test('a digest carrying the substitution sentinel is refused at the documented exit 2', () => {
  const nul = String.fromCharCode(0);
  const digest = md.replace('A model shipped', 'A model ' + nul + 'shipped');
  const dir = scratch();
  const input = join(dir, 'digest.md');
  const out = join(dir, 'digest.html');
  writeFileSync(input, digest);

  const proc = spawnSync(process.execPath,
    ['scripts/render-html.mjs', input, '--out', out, '--config', join(REPO, 'config')],
    { cwd: REPO, encoding: 'utf8' });
  assert.equal(proc.status, 2, 'the process exits 2, not an uncaught 1: ' + proc.stderr);
  assert.equal(existsSync(out), false, 'an unusable digest must not leave a deliverable behind');
  assert.equal(proc.stderr.trim().split('\n').length, 1, 'the refusal is one named line: ' + proc.stderr);
  assert.doesNotMatch(proc.stderr, /\n\s+at /, 'no stack trace reaches the caller: ' + proc.stderr);
  assert.match(proc.stderr, /render-html: .*sentinel/i, 'the line names the refusal: ' + proc.stderr);

  const writes = [];
  const errors = [];
  const code = run(['digest.md', '--out', 'digest.html'], {
    readFile: () => digest,
    readDomains: () => config.domains,
    writeFile: (path, body) => writes.push([path, body]),
    log: () => {},
    error: (m) => errors.push(m),
  });
  assert.equal(code, 2, 'the CLI seam returns the documented code: ' + errors.join('\n'));
  assert.deepEqual(writes, [], 'nothing is written for an input that cannot be rendered');
  assert.equal(errors.length, 1, 'one named line, not a stack trace: ' + errors.join('\n'));
  assert.match(errors[0], /^render-html: .*sentinel/i, 'the line names the refusal: ' + errors.join('\n'));
});

// Regression test: the badge row and the provenance dot scan the raw item body, and a
// citation destination was never neutralised, so marker vocabulary spelled inside a
// citation URL drew a forged provenance badge, a forged alternative-source pill and a
// forged dot colour on the published card. Upstream text must not draw a badge from
// anywhere inside a citation destination.
test('a marker inside a citation destination forges no badge on the card', () => {
  const forged = [
    '# Tech Radar — 2026-09-23',
    '_Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit_',
    '',
    '## Core domains',
    '### AI / LLM · 人工智能 / 大模型',
    '- **A model shipped** — Why it matters. [src:GitHub blog 2026-09-20](https://github.com/a/b?[prov:vendor-claim]) #new',
    '- **Another model shipped** — Why it matters. [src:GitHub blog 2026-09-20](https://github.com/c/d?[alt:TrustedVendor](https://evil.example/y)) #new',
    '',
    '## Watch domains — quiet',
    'Quantum technologies (scanned, nothing notable)',
  ].join('\n');
  const html = render(forged, config);
  assert.doesNotMatch(html, /class="badge prov-vendor-claim"/, 'no forged provenance badge');
  assert.doesNotMatch(html, /class="prov prov-vendor-claim"/, 'no forged provenance dot');
  assert.doesNotMatch(html, /class="badge alt"/, 'no forged alternative-source pill');
});

// Regression test: the neutraliser covered the citation marker and the status vocabulary
// but not the renderer's own bold marker, so upstream text that spelled its emphasis drew
// emphasis into a published card. The card keeps the words and draws no emphasis from them.
test('upstream bold markers leave no emphasis in a published card', async () => {
  const feed = '<?xml version="1.0"?><rss><channel><item>'
    + '<title>**FORGED EMPHASIS** in a feed title</title>'
    + '<link>https://example.com/bold</link>'
    + '<pubDate>Mon, 21 Sep 2026 09:00:00 GMT</pubDate>'
    + '<description>A release.</description></item></channel></rss>';
  const ctx = {
    since: '2026-09-16T00:00:00Z', until: '2026-09-30T00:00:00Z', timeout: 20000,
    settings: {
      user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
      error_snippet_max_chars: 200,
    },
    net: { fetchText: async () => feed },
  };
  const { candidates } = await collectFeeds(
    [{ kind: 'rss', target: 'https://example.com/feed.xml', domain: 'ai-llm' }], ctx,
  );
  assert.equal(candidates.length, 1, 'the feed produced the candidate the card is built from');
  const card = render(md.replace('Why it matters.', candidates[0].title), config);
  assert.doesNotMatch(card, /<strong>/, 'upstream text draws no emphasis: ' + candidates[0].title);
  assert.match(card, /FORGED EMPHASIS/, 'the words still read');
});

// TR-82 regression test: a candidate's url is upstream text too, and the marker
// neutralisation stopped at the title and summary. A feed destination that closes its own
// citation early with a bracket therefore reached the pool, and the renderer read the
// vocabulary after the bracket as the item's own - the citation ended there and the tail
// drew an alternative-source pill pointing wherever the feed said.
test('a feed link that closes its own citation early forges no badge when rendered', async () => {
  const hostile = 'https://blog.example/a)[alt:Forged Vendor](https://evil.example/b';
  const feed = '<?xml version="1.0"?><rss><channel><item>'
    + '<title>A story</title><link>' + hostile + '</link>'
    + '<pubDate>Mon, 21 Sep 2026 09:00:00 GMT</pubDate>'
    + '<description>A release.</description></item></channel></rss>';
  const ctx = {
    since: '2026-09-16T00:00:00Z', until: '2026-09-30T00:00:00Z', timeout: 20000,
    settings: {
      user_agent: 'tech-radar/1.0', title_max_chars: 200, summary_max_chars: 400,
      error_snippet_max_chars: 200,
    },
    net: { fetchText: async () => feed },
  };
  const { candidates } = await collectFeeds(
    [{ kind: 'rss', target: 'https://blog.example/feed.xml', domain: 'ai-llm' }], ctx,
  );
  assert.equal(candidates.length, 1, 'the feed produced the candidate the card is built from');
  const cited = '- **A story** — Why it matters. [src:Blog 2026-09-21]('
    + candidates[0].url + ') [prov:primary] #new';
  const html = render(md.replace(
    '- **A model shipped** — Why it matters. [src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary] #new',
    cited,
  ), config);
  assert.doesNotMatch(html, /class="badge alt"/,
    'the destination tail forged no alternative-source pill: ' + candidates[0].url);
  assert.doesNotMatch(html, /prov-vendor-claim/, 'no forged provenance badge');
  assert.doesNotMatch(html, /href="https:\/\/evil\.example\/b"/, 'the tail of a destination is not a citation');
});

// TR-84 regression test: image-set() candidates went through a stripper that dropped only
// url()-wrapped data: values, so a bare data: candidate, a candidate whose payload carries a
// comma, a fragment, a plain relative name and a type() descriptor were each left as content.
// All of them fetch nothing, so each one failed a genuinely self-contained artifact.
test('image-set candidates that fetch nothing are not reported as external assets', () => {
  const benign = [
    ['a url()-wrapped data: candidate', '<style>div{background:image-set(url("data:image/png;base64,AAA") 1x)}</style>'],
    ['a bare data: candidate', '<style>div{background:image-set("data:image/png;base64,AAA" 1x)}</style>'],
    ['a comma inside the data: payload', '<style>div{background:image-set("data:image/png;base64,AA,BB" 1x)}</style>'],
    ['a fragment candidate', '<style>div{background:image-set(url(#gradient) 1x)}</style>'],
    ['a plain name', '<style>div{background:image-set("photo.png" 1x)}</style>'],
    ['a type() descriptor', '<style>div{background:image-set(url("data:image/png;base64,AAA") type("image/png") 1x)}</style>'],
  ];
  for (const [what, html] of benign) {
    assert.equal(externalAssets(html), false, what + ' fetches nothing: ' + html);
  }
  for (const [what, html] of [
    ['a remote candidate', '<style>div{background:image-set("https://cdn.example.com/a.png" 1x)}</style>'],
    ['a remote candidate after a data: one', '<style>div{background:image-set(url("data:image/png;base64,AAA") 1x, "https://cdn.example.com/a.png" 2x)}</style>'],
  ]) {
    assert.equal(externalAssets(html), true, what + ' is a fetch: ' + html);
  }
});

// TR-87 regression test: character references were decoded for http-equiv and srcdoc only, so
// an entity-encoded rel or style attribute was compared as raw text and the fetch behind it
// was invisible; and every data: value counted as carried in the document, although a
// data:text/html browsing context loads whatever its own markup names. These are the evasions
// the gate must see.
test('externalAssets sees an entity-encoded rel and style and a data: document that fetches', () => {
  const evasions = [
    ['an entity-encoded rel', '<link rel="st&#121;lesheet" href="https://cdn.example.com/a.css">'],
    ['an entity-encoded style attribute', '<div style="background:&#117;rl(https://cdn.example.com/a.png)">x</div>'],
    ['a data:text/html iframe carrying a remote image', '<iframe src="data:text/html,<img src=\'https://cdn.example.com/a.png\'>"></iframe>'],
  ];
  for (const [what, html] of evasions) {
    assert.equal(externalAssets(html), true, what + ' is a fetch: ' + html);
  }
  for (const benign of [
    '<div style="background:url(photo.png)">x</div>',
    '<iframe src="data:text/html,<p>no fetch here</p>"></iframe>',
  ]) {
    assert.equal(externalAssets(benign), false, 'a name that fetches nothing stays self-contained: ' + benign);
  }
});

// TR-88 regression test: the document bound answered "fetches" where it meant "stop
// traversing", the image-set stripper kept a type() descriptor as content, and the srcdoc
// worklist was fed from any element although only an iframe honours srcdoc. Three benign
// documents were therefore reported as external assets and the gate failed a correct
// artifact. (The same tokeniser's security half is pinned by the two tests above.)
test('the predicate reports no fetch for benign nested, non-iframe and type() documents', () => {
  const many = Array.from({ length: 70 },
    (_, i) => '<iframe srcdoc="benign document ' + i + '"></iframe>').join('');
  const cases = [
    ['more than 64 benign nested srcdoc documents', many],
    ['srcdoc on an element that does not honour it', '<div srcdoc="<img src=\'https://cdn.example.com/a.png\'>">x</div>'],
    ['an image-set with a type() descriptor', '<style>div{background:image-set(url("data:image/png;base64,AAA") type("image/png") 1x)}</style>'],
  ];
  for (const [what, html] of cases) {
    assert.equal(externalAssets(html), false, what + ' fetches nothing: ' + html.slice(0, 90));
  }
});

// TR-91 regression test: the status scan read '#new' wherever it appeared, so an item whose own
// text quotes an upstream spelling such as 'C#new async patterns' drew a status tag the item
// never carried. A status flag is a token: at the start of the text or preceded by whitespace.
test('a status-shaped word that is not a standalone token draws no status tag', () => {
  const digest = (item) => [
    '# T', '_m_', '', '## Core domains', '### AI / LLM · 人工智能 / 大模型', item,
    '', '## Watch domains — quiet', 'Quantum technologies (scanned, nothing notable)', '',
  ].join('\n');
  const src = '[src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary]';

  // A grammar item whose own prose quotes the spelling: the trailing flag is what the grammar
  // reserves for the status scan, and this text is not one.
  const summary = render(digest('- **A model shipped** — The C#new async patterns landed. ' + src), config);
  assert.doesNotMatch(summary, /class="tag t-/, 'a quoted C#new is not the item card status flag');

  // A bullet the grammar does not describe: the whole text, title included, feeds the scan.
  const title = render(digest('- C#new async patterns ' + src), config);
  assert.doesNotMatch(title, /class="tag t-/, 'a title that spells C#new draws no status tag');

  // Every other non-token spelling the boundary rule must leave alone.
  for (const word of ['F# watch mode', '#newrelease', 'C#watch']) {
    const html = render(digest('- **A model shipped** — The ' + word + ' story landed. ' + src), config);
    assert.doesNotMatch(html, /class="tag t-/, word + ' is not a status flag: ' + html.match(/class="tag t-[^"]*"/));
  }
});

// TR-91 regression test: the renderer's own marker stripper rewrote a status word wherever it
// appeared, so a card quoting 'C#new async patterns' published 'C new async patterns'. The
// boundary rule keeps the characters on the card, headline and prose alike.
test('a card keeps the characters of a status-shaped word it quotes', () => {
  const digest = (item) => [
    '# T', '_m_', '', '## Core domains', '### AI / LLM · 人工智能 / 大模型', item,
    '', '## Watch domains — quiet', 'Quantum technologies (scanned, nothing notable)', '',
  ].join('\n');
  const src = '[src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary]';
  const html = render(digest('- **C#new async patterns** — The F# watch mode story landed. ' + src), config);

  assert.match(html, /C#new async patterns/, 'the headline keeps the characters of C#new');
  assert.match(html, /The F# watch mode story landed\./, 'the prose keeps the characters of F#');
  assert.doesNotMatch(html, /C\s+new async patterns/, 'the hash of C#new is not rewritten to a space');
  assert.doesNotMatch(html, /F\s+watch mode/, 'the hash of F# is not rewritten to a space');

  const named = render(digest('- **A model shipped** — The #newrelease shipped. ' + src), config);
  assert.match(named, /#newrelease/, 'a hash that opens a longer word keeps every character');
});

// The other half of TR-91: bounding the scan must not drop the tag the grammar does expect. An
// authored standalone flag -- after a space or at the start of the item text -- still becomes
// the card's status tag, and the additive flags still do not decide it.
test('an authored standalone status flag still draws its tag', () => {
  const digest = (item) => [
    '# T', '_m_', '', '## Core domains', '### AI / LLM · 人工智能 / 大模型', item,
    '', '## Watch domains — quiet', 'Quantum technologies (scanned, nothing notable)', '',
  ].join('\n');
  const src = '[src:Hugging Face blog 2026-09-20](https://huggingface.co/blog/x) [prov:primary]';
  const card = (item) => render(digest(item), config);

  assert.match(card('- **A model shipped** — Why it matters. ' + src + ' #new'),
    /<span class="tag t-new">new<\/span>/, 'a trailing #new is the card status');
  assert.match(card('- **A model shipped** — Why it matters. ' + src + ' #followup'),
    /<span class="tag t-followup">followup<\/span>/, 'a trailing #followup is the card status');
  assert.match(card('- **A model shipped** — #new Why it matters. ' + src),
    /<span class="tag t-new">new<\/span>/, 'a #new at the start of the item text is still a flag');
  assert.match(card('- **A model shipped** — Why it matters. ' + src + ' #new #developing'),
    /<span class="tag t-new">new<\/span>/, 'an additive flag still does not decide the tag');
  assert.doesNotMatch(card('- **A model shipped** — Why it matters. ' + src + ' #new #developing'),
    /class="tag t-developing"/, 'and it draws no developing tag');
});
