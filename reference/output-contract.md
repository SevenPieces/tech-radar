# Output contract

The digest has exactly one shape. `SKILL.md` points here; the authority this document describes is the code —
`parseItems()`, `parseHeadings()` and `sectionText()` in `scripts/check-quality.mjs`, which parse the Markdown,
and `render()` in `scripts/render-html.mjs`, which turns it into the deliverable. Where this prose and those
functions disagree, the functions win.

## The grammar

```text
# Tech Radar — <YYYY-MM-DD>
_<window label from plan> · <n> domains scanned · <m> items_

## Featured this week            (only when the week warrants one)
### <the one thing worth ten minutes>
<200-350 words: what changed, why it matters, what it affects, what to watch next>
(absent: "Nothing this week warranted a deep dive.")

## Core domains
### <Domain> · <中文标签>
- **Headline** — one or two sentences: what changed and why it matters.
  [src:OUTLET <YYYY-MM-DD>](https://primary) [prov:primary] #new
  [alt:OUTLET](https://secondary)

## Watch domains — notable this week
### <Domain> · <中文标签>
- ... (0-2 items)

## Watch domains — quiet
<every watch domain that produced nothing, on one line>

## Coming up
- Unresolved developing stories, each with a horizon.

## Coverage note
<the window label repeated verbatim, what the cap skipped, and the collector notices>

## Sources
```

## What the parser actually requires

The shorthand above draws an item across three lines, and the frozen grammar also permits the one-line form.
**Both forms are accepted**, by the gate and by the renderer:

```text
- **Headline** — body … [src:OUTLET YYYY-MM-DD](https://primary) [prov:marker] #new [alt:OUTLET](https://secondary)
```

```text
- **Headline** — body …
  [src:OUTLET YYYY-MM-DD](https://primary) [prov:marker] #new
  [alt:OUTLET](https://secondary)
```

What is fixed in both forms is the item's **first line**: the bullet, the bold headline, and the space, em dash
(U+2014), space. The item is that line plus every following line that starts with whitespace followed by a
non-whitespace character — an *indented* continuation, trimmed and joined into the body with a single space.
Indentation is what makes a line a continuation: a citation on the next line at column 0 is a separate line and
is not part of the item, so the item keeps no citation and fails as
`item has no [src:OUTLET DATE](url)`. If the em dash moves off the first line, the line is not an item at all
and the digest loses it entirely. The citation, the marker, the flags and the rest of the sentences may live on
the first line or on any continuation.

The renderer joins an indented continuation into the same list item, so a wrapped item renders exactly like a
one-line one. A violation is reported against the item's **first** line: the bullet line, whether the item is
written on one line or wrapped across several, because the parser captures that line before it consumes the
indented continuations.

The shapes the gate matches:

| Element | Pattern | Rule |
|---|---|---|
| Item | `^-\s+\*\*(.+?)\*\*\s+—\s+(…)$` | The item's **first** line: a list line opening with a bold headline, then a **space, em dash (U+2014), space**. A hyphen, an en dash or a missing space leaves the line unparsed, so it counts as no item at all. Every following indented line is joined into this item's body. |
| Citation | `\[src:([^\]]+?)\s+(\d{4}-\d{2}-\d{2}[^\]]*)\]\((https?://(?:[^()\s]|\([^()\s]*\))+)\)` | Outlet, then a space, then a `YYYY-MM-DD` date, then an `http(s)` URL. The outlet is everything before the date. A destination may contain balanced parentheses — `…/wiki/Foo_(bar)` is one URL, not a URL and a stray bracket — and one level of nesting is what the gate and the renderer both read. Exactly one citation is read per item; extra `[src:…]` tokens on the line are ignored, so corroboration uses `[alt:OUTLET](url)`. |
| Provenance | `\[prov:([a-z-]+)\]` | Exactly one per item. Zero or two or more is a gate failure. |
| Status | `#(new\|followup\|developing\|watch)\b` | Exactly one of `#new` or `#followup`, always. `#developing` and `#watch` are optional and additive. |

## Where an item line is meaningful

An **item** is a bullet that sits under a domain heading — a `### ` heading inside `## Core domains` or
`## Watch domains — notable this week`. That is the only place the item grammar, the per-domain ceilings and the
provenance and status rules apply, and the only place an item's domain is read from its heading.

The featured deep dive and `## Coming up` are ordinary prose: their bullets stay plain prose bullets, must not
carry the `**Headline** — ` shape of an item, and need no citation, marker or status flag. A bold headline with
an em dash in those sections would be read as an item belonging to whichever domain heading came last — the trap
the gate scopes against. Keep the two apart: the featured section takes a paragraph plus ordinary bullets, and
`## Coming up` takes one line per unresolved story with its horizon.

## The four provenance markers

Exactly one marker per item — never zero, never two. The gate counts them and fails the item otherwise.

| Marker | Use it when | Discipline |
|---|---|---|
| `[prov:primary]` | The artifact itself was retrieved: a release note, paper, specification, advisory, changelog, commit, or an official lab or vendor post. | The default for machine-readable material, which is what the collector gathers. |
| `[prov:secondary]` | A reputable report *of* the artifact, allowed only when no primary is retrievable — the primary is paywalled, unreadable, or does not exist. | Never a convenience choice. If a primary exists and was merely inconvenient to open, the item waits or is dropped. |
| `[prov:preprint]` | arXiv or an equivalent unreviewed listing. | Never stated as established: write "reports" or "claims", not "proved". |
| `[prov:vendor-claim]` | Vendor or project marketing: a capability claim, a benchmark the vendor ran, a roadmap date. | Reported as a claim and never as a result, whatever the press release says. |

The marker records the class of the page cited, not the reputation of the organisation: a vendor's own
peer-reviewed paper is `[prov:primary]`, a journalist's summary of it is `[prov:secondary]`, and the vendor's
announcement about it is `[prov:vendor-claim]`.

`[src:OUTLET DATE](url)` names the source you are citing and the marker classifies **that** source's page; the
two are independent. An outlet that `config/sources.md` types `secondary` — 机器之心, for instance — does not
force `[prov:secondary]`, and one typed `primary` does not force `[prov:primary]`. Cite the page you actually
read and choose the marker from what it is. `reference/evidence.md` carries the same table plus the per-domain
rule for when a claim may be written as a result.

## Headings

- `## ` opens a section. The seven shipped section headings are as written in the grammar; the gate matches
  `Coverage note` and `quiet` case-insensitively and only ever looks for a `## ` heading.
- `### ` opens a domain, and only inside a domain section (`## Core domains`, `## Watch domains — notable this
  week`). The item's domain is everything before the first `·` in that heading, trimmed. The heading must use the
  catalogue **name** from `config/domains.md`: a heading that names a catalogue **key** (`### ai-llm`) is a
  **failure**, reported as `heading "…" names the catalogue key "…"; write the domain name "…" instead`. A
  heading that contains a catalogue `domain` must also contain that domain's `label_zh`, or the gate fails it as
  a missing bilingual label.
- A heading that is not in the catalogue at all is a **warning**, not a failure, and its items still count: the
  gate reports `domain <name> is not in the catalogue` for each such item, counts it against `core_max_items` (it
  has no tier to look up, so the watch branch never applies) and does not count it as a watch item. Copy the
  `domain` column verbatim into the heading — a paraphrase is not rejected, it is merely unresolvable, and the
  tier, the ceiling, the core-heading and quiet-line rules then resolve against nothing.
- Items are the bullets under a `### ` heading **inside a domain section**; the featured deep dive and
  `## Coming up` are prose even when they carry a `### ` heading or a bold bullet. A bullet written before the
  first `### ` heading of a domain section is not collected at all — no item, no warning, no count — so never
  write one there.

## The three rules the gate enforces across sections

1. **Coverage note repeats the label verbatim.** The section whose `## ` heading contains `coverage note` must
   contain `plan.label` character for character. The header line is *not* what is checked — a label that drifted in
   the header alone is still caught here, because the note must carry it independently.

   **The collector-notice line is part of the note as well.** Whenever the pool carries at least one `notices`
   entry, the note must contain the line `Collector notices: <n>`, where `<n>` is the length of the pool's
   `notices` array — quoted from the pool file the gate is given, never recomputed, rounded or estimated. The
   matching is tolerant of case and of surrounding whitespace and punctuation, but the number must match exactly,
   and the gate compares it against the pool passed with `--pool`: a missing line when the pool has notices, or a
   number that does not match, fails the run. When the pool's `notices` array is empty the line is optional —
   `Collector notices: 0` is allowed and is accurate.
2. **A core domain that produced nothing keeps its heading.** Every core domain in the run's coverage — all core
   domains, or only those named in `plan.perDomain` when that object holds at least one key — must have a `###`
   heading. An absent **or empty** `plan.perDomain` is treated as unscoped, not as "nothing was covered", so
   every core domain is required. State the quiet plainly under that heading; an empty body is acceptable, a
   missing heading is not.
3. **Every quiet watch domain in the run's scope is named on the quiet line.** For each `watch` domain the run
   covered — all of them for a weekly run, or only those named in `plan.perDomain` when that object holds at
   least one key, scoped exactly as rule 2 scopes the core headings — a domain with zero items must have its
   `domain` string in the section whose heading contains `quiet`. Use the English catalogue name
   (`Quantum technologies`), not the key (`quantum`) and not only the Chinese label. A focus run is not failed for
   the watch domains it did not cover.

**The skipped amount is a writer obligation, not a gate check.** The note must quote what the cap removed from the
plan (`plan.skippedMs`, with `plan.declared` as the floor the run asked for and the same pair per domain under
`plan.perDomain`), never recompute it; when `skippedMs` is 0 the note says the cap removed nothing. The gate
verifies neither this amount nor the header counts, so a note that claims nothing was skipped while the plan says
otherwise still passes — it is still false, and the note is the reader's only account of the window.

## The header

```text
# Tech Radar — <YYYY-MM-DD>
_<plan.label> · <n> domains scanned · <m> items_
```

- `plan.label` is the string `update-state.mjs plan` printed. It **already contains** `Covering …` and ends in
  `· cap hit` or `· cap not hit`, so the cap is never written twice. Copy it; do not rebuild it.
- `render-html.mjs` takes the first line beginning `# ` as the document title and the **last** line beginning
  and ending with `_` as the meta line. Both must be present for the HTML header to be right. It is the last one
  because the header block ends where the content begins: any `_…_` line above the datum line — a notice, a
  provenance banner — must not be mistaken for the meta line, and the datum line is the one adjacent to the
  content.
- `<n>` is the number of domains the run scanned, which is the run's **scope**: the keys of `plan.perDomain` —
  every configured domain for a weekly run, only the named ones for a focus run — so the header agrees with the
  scoping the gate applies to the core headings and the quiet line. `<m>` is the number of items shipped. The
  gate verifies neither number; they must still be true, because the header is the reader's only summary.
- The date in the `# ` line is the run date in the configured timezone.

## Featured this week

**What warrants one is a written criterion, not a gate check.** A week warrants a deep dive when at least one of
these holds: something changed **structurally** (a licence, a protocol, a default, an interface, a standard, a
pricing model, an acquisition — not a version bump or a benchmark); **or** several independent sources corroborate
it rather than one vendor or one laboratory; **or** it affects a `core` domain of `config/domains.md`. The body is
200-350 words: what changed, why it matters, what it affects, what to watch next. No gate can judge that choice;
what the gate does enforce is the shape below.

`deep_dive` in `config/settings.md` is one of `always`, `when-warranted` (the shipped value) or `never`, and the
gate applies it in both directions:

| `deep_dive` | `## Featured this week` present | `## Featured this week` absent |
|---|---|---|
| `always` | silent | **failure** — the section is required, and the stand-in line does not satisfy it |
| `when-warranted` | silent | **failure** unless the digest carries the stand-in line; with the line, silent |
| `never` | **warning** — the section is not expected | silent |

**The deep dive is drawn as a story card, so it carries its own source.** The renderer reads the section's
first `[src:OUTLET DATE](url)` becomes the card's linked headline and its origin pill, and its `[prov:…]`
markers become the provenance badges - the first of them also colours the marker dot - exactly as they do on an
ordinary item; all of them are removed from the sentences so a citation never reads as prose. A
`#new` or `#followup` token in the prose becomes the status tag, the last such token on the line being the one that
is read; `#developing` and `#watch` are additive and never become the tag, so a deep dive shows the same status
label an item card shows. A deep dive that carries neither still renders, with a neutral dot, an unlinked
headline and no origin pill — which is why a real deep dive is expected to name its primary source: the card can
only show what the prose cites. The gate does not police this; it is a property of the rendered card, not a rule
the Markdown must satisfy.

The **stand-in line** is the recorded sentence `Nothing this week warranted a deep dive.` A `when-warranted` run
that drops the section must carry it: the section may be omitted, the question may not be dropped silently. When
the section is present the line is not needed, and when `deep_dive` is `never` a featured section is a warning
rather than a failure, so a run never loses its digest over a deep dive it did not need.

## Quantities come from configuration

Never hardcode a number in the digest or in the synthesis. From `config/settings.md`:

- `core_max_items` is the per-domain ceiling in `## Core domains`;
- `watch_max_items` is the per-domain ceiling for a promoted watch domain;
- `watch_notable_max` is the total from watch domains per run;
- `total_min_items` and `total_max_items` are the total budget, and `total_max_items` is the binding ceiling;
- `deep_dive` decides whether a featured section is expected.

**The floor scales to the run's scope; the ceiling does not.** The floor is `total_min_items` scaled by the share
of the catalogue the run covers and rounded up, and it is at least one item per covered domain plus one, so a
multi-domain run cannot ship fewer items than it has sections; the result is then clamped to at least one and at
most `total_min_items`, which is what lets the clamp — not the arithmetic — bind near the top of the range. A
single-domain run is a probe with a floor of one, and the per-domain clause does not apply to it; an unscoped run,
or one covering the whole catalogue, keeps the configured floor. `total_max_items` and every per-domain ceiling
stay global whatever the scope. The gate says which floor it applied: `below the scoped floor of N for a run
covering X of Y domains` for a scoped run, `below total_min_items N` otherwise.

The per-domain ceilings are not targets. The total budget binds, so the synthesis allocates within it.

## A conforming digest

```markdown
# Tech Radar — 2026-09-23
_Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit · 43 domains scanned · 38 items_

## Core domains
### AI / LLM · 人工智能 / 大模型
- **A lab shipped a 300B open-weights model under a permissive licence** — The licence is the change that matters: it removes the commercial gate the previous release carried. [src:Official lab blog 2026-09-20](https://example.org/blog/model) [prov:primary] #new [alt:Independent analysis](https://example.net/a)

### Audio, speech and music technology · 音频、语音与音乐技术
Scanned, nothing notable this week.

## Watch domains — quiet
Photonics and optical interconnects · Quantum technologies · … (scanned, nothing notable)

## Coming up
- The licence text is disputed by two downstream projects; a clarification is expected within two weeks.

## Coverage note
Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit
No domain was clipped by the cap.
Collector notices: 1
github: rate limit reached after 60 requests (set GITHUB_TOKEN to raise the limit)

## Sources
Registry and discovery surfaces are listed in `config/sources.md`; discovery surfaces are never cited.
```

(The AI / LLM item above is written on one line; it would be equally valid spread over indented continuation
lines. Audio, speech and music technology is a core domain that produced nothing, so it keeps its heading and
says so.)

## Run artifacts

Four artifacts sit beside the digest, are overwritten every run, and are not part of the deliverable.

- `.plan.json` — the JSON `update-state.mjs plan` printed, passed to the gate as `--plan`.
- `.pool.json` — the collector's candidate pool, with its `notices`.
- `.items.json` — **the merge input**, a JSON array of the shipped items, one object each:
  `{ title, domain, outlet, primaryUrl, flags, watch }`. `domain` is the catalogue **key** (`ai-llm`), because
  the state stores keys; the English `domain` name from `config/domains.md` is what a `### ` heading carries. The
  merge accepts either and resolves it to the key, and rejects anything that is neither (exit 3), so a name is
  tolerated at this boundary but a typo is not. `flags` is the array of status flags for the item
  and `watch: true` also files it on the watchlist.
- `.research.json` — **the provenance trail for what the research passes found**, a JSON array with one record per
  shipped item: `{ title, domain, primaryUrl, origin, marker, why }`, where `origin` is `pool` for a collector
  candidate or the identifier of the pass that found it by reading, `marker` is the single provenance marker the
  item carries, and `why` is the one-line reason it is in the digest. The pool can only account for what a script
  fetched, so this is the only record of an item found by reading; a later run reads it to tell why an item was
  included rather than reconstructing that from memory.
