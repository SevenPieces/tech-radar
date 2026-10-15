# Evidence bar

Every item in the digest is an assertion the reader is expected to act on, so every item carries a date, a
citation, exactly one provenance marker and exactly one status flag. This document is the rule set
`SKILL.md` points at; the mechanical parts of it are enforced by `scripts/check-quality.mjs`, and the
judgement parts are the agent's responsibility. Nothing is invented, estimated or padded, and a quiet week is
reported as quiet.

## The four provenance markers

Exactly one marker per item — never zero, never two. The gate counts them and fails the item otherwise.

| Marker | Use it when | Discipline |
|---|---|---|
| `[prov:primary]` | The artifact itself was retrieved: a release note, paper, specification, advisory, changelog, commit, or an official lab or vendor post. | This is the default for machine-readable material, which is what the collector gathers. |
| `[prov:secondary]` | A reputable report *of* the artifact, allowed only when no primary is retrievable — the primary is paywalled, unreadable, or does not exist. | Never a convenience choice. If a primary exists and was merely inconvenient to open, the item waits or is dropped. |
| `[prov:preprint]` | arXiv or an equivalent unreviewed listing. | Never stated as established. Write "reports", "claims", "preprint" — not "researchers proved" or "has been shown". |
| `[prov:vendor-claim]` | Vendor or project marketing: a capability claim, a benchmark the vendor ran, a roadmap date. | Reported as a claim and never as a result, whatever the wording of the press release. |

The marker records the class of the page cited, not the reputation of the organisation. A vendor's own
peer-reviewed paper is `[prov:primary]`; a journalist's summary of that paper is `[prov:secondary]`; the
vendor's announcement about it is `[prov:vendor-claim]`.

**`[src:OUTLET DATE](url)` names the source you are citing; the marker classifies that source's page.** The two
are independent. The `tier` column of `config/sources.md` is the evidence class of the page cited, not of the
organisation, and it does not dictate the marker: an outlet typed `secondary` — 机器之心, for instance — does not
force `[prov:secondary]`, and one typed `primary` does not force `[prov:primary]`. A request for "a story whose
primary source is <outlet>" therefore means the cited source is that outlet; the marker still describes what the
cited page is.

## Status flags

Exactly one of `#new` or `#followup` on every item, decided by the state file rather than by memory: a story
key already present in `items` is a follow-up, a key that is not is new. `#developing` and `#watch` are
optional and additive — `#developing` for a story still moving, `#watch` for a story carried on the watchlist.
The gate fails an item with zero or with two of `#new` and `#followup`.

## Discovery-only surfaces

Some surfaces are where a story is *found*, never where it is *read*. They may seed a lead; they may never be
the cited source, and the gate blocks a citation whose host is one of them (host equality or any subdomain,
with a leading `www.` stripped).

The list is configuration: `discovery_hosts` in `config/settings.md`. The shipped value is
`news.ycombinator.com, lobste.rs, reddit.com, x.com, twitter.com, techmeme.com, news.google.com,
news.baidu.com, v2ex.com, juejin.cn, zhihu.com, sspai.com, weibo.com`. The `every` / `discovery` row of
`config/sources.md` names the same surfaces and marks the Chinese-language ones — Baidu News, V2EX, 掘金,
知乎, 少数派, Weibo. Extend the list in `config/settings.md` when a new aggregator appears; no script or
gate needs editing, which is the point of keeping it in configuration.

Citing a discovery surface is the failure seen most often in practice: a Hacker News thread is a
pointer to the project's release page, and the release page is the citation.

## The per-domain hype rule

A **result** requires independent reproduction or a shipping product before it is reported as more than a
claim. In the domains below, a demonstration, a simulation, a preprint, a milestone slide or a single
laboratory measurement is written as a claim with the matching marker — never as an achievement the state of
the art has reached.

| Domain key | Domain | What a "result" needs before it is reported as one |
|---|---|---|
| `quantum` | Quantum technologies | Error-corrected logical qubits with published fidelities, or an independently reproduced advantage claim — not a qubit-count headline or a vendor roadmap. |
| `energy-power` | Energy and power | Batteries, grid storage and fusion are judged here: a shipping product, a certified cell or system, or a replication by an independent laboratory. A lab coin cell, a pilot line and a net-energy-gain announcement are claims until then. |
| `materials-mfg` | Materials and advanced manufacturing | Superconductors are judged here: independent replication of the measured property, or a qualified part in production — not a single-sample measurement or a press release about a press release. |
| `frontier-science` | Frontier science and fundamental research | Peer-reviewed publication plus independent replication where the claim is extraordinary; a preprint is `[prov:preprint]` and is written as one. |
| `neuro-bci` | Neuroscience and brain-computer interfaces | Peer-reviewed results from a named cohort, or a device with regulatory clearance — not a demo video, a thread count, or a "first ever" claim from the company building it. |
| `wearables-sensors` | Wearables, sensors and human augmentation | A cleared or certified device, or an independently validated measurement study — not a prototype or a vendor accuracy figure. |
| `robotics` | Robotics and autonomy | Reproduction outside the lab that built it, or a deployed unit doing the task commercially — not a curated demonstration video or a teleoperated run presented as autonomy. |
| `defence-dual-use` | Defence and dual-use technology | Official programme documentation or an independent assessment — not a manufacturer's claim, and never a capability asserted from imagery alone. |
| `space-aerospace` | Space and aerospace | A flown mission milestone or an operator-confirmed result — not a contract award, a rendering, or a funding round reported as a capability. |

The middle column is the exact `domain` value in `config/domains.md`, and it is what goes into the `### `
heading. Copy it verbatim: a heading built from a paraphrase is a heading the gate reads as a domain it does not
know, so the tier, the ceiling, the core-heading and quiet-line rules all resolve against nothing.

Design §5 additionally names **AGI claims**: a frontier-capability claim in `ai-llm` is written as a claim
with `[prov:vendor-claim]` until it is independently reproduced.

## Contradictions

When two sources disagree — a CVE filed under two different vendors, two laboratories reporting incompatible
measurements, a vendor and an independent test disagreeing — **show both and resolve neither**. Put both
citations on the item, each with its own outlet and date, and say plainly that they disagree. Do not pick a
winner, do not average, do not omit the weaker source, and do not soften both into a claim that satisfies
nobody. A visible contradiction is information; a resolved one is usually an invention.

## Drop, don't repair

A failing item is dropped, not repaired. If the source cannot be fetched, if the date cannot be established,
if the only write-up available is a paywalled headline, if the item needs two provenance markers to be honest
— drop it and say the domain was quiet. A missing item is a smaller failure than a fabricated one, and the
quality gate is written on that assumption: it verifies shape, not truth, so anything you keep must be
defensible by you.

## Dating and link-only sources

- Every shipped item carries `[src:OUTLET YYYY-MM-DD](https://primary)` and the date must fall inside the
  planned window. If you cannot date it, you cannot ship it, and an approximated date is an invented one.
- A primary that cannot be fetched — paywalled, client-rendered, or returning a navigation shell instead of
  content — is cited **link-only**: the outlet and the date you can defend, plus `[alt:OUTLET](url)` to a
  fetchable outlet that corroborates it. It is never written up as though it had been read.
- A source whose `fetchable` value in `config/sources.md` is `no` or `feed-only` behaves the same way:
  headline, link and date, or corroboration, or nothing at all.
- `config/sources.md`'s `fetchable` column is a record of a past probe, not a guarantee. A source that fails
  twice is re-probed before the next run, and the probe evidence belongs in `reference/feasibility.md`.

### When the unfetchable source is also a Chinese-language source

The language rule and the link-only rule collide here: a `lang: zh` source's item stays Chinese, and a link-only
source must not be written up as read. The worked order is:

1. **The item's language follows the source you actually read.** Cite that source as `[src:OUTLET DATE](url)` and
   take the marker from what its page is. The gate keys its language check off the `[src:]` outlet, so this is also
   the arrangement that passes it.
2. **The unfetchable source appears as `[alt:OUTLET](url)`** with its own date, and the prose says what it
   contributes and that it was not fetched — "reported by 机器之心, which is client-rendered and was not fetched".
3. **If the unfetchable source is the only source, the item is still Chinese.** Cite it as
   `[src:机器之心 YYYY-MM-DD](url)` — the gate sees a `lang: zh` outlet and requires Chinese prose, which the item
   already has — and state in the prose what is verified (the outlet, the date, the headline as published) and
   what is not (the body, the figures, the quotes).
4. **Never drop the item only because the source could not be fetched, and never imply it was read.** The item
   carries exactly one `[prov:…]` marker, because the gate counts markers per item; the unread source's status
   belongs in prose beside its `[alt:]` link, never as a second marker.
