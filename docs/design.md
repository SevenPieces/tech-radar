# tech-radar — design

Status: current design; this document is the specification that ships.
Date: 2026-09-23, revised 2026-09-24.
Scope: a new, self-contained agent skill, independent of any other skill or digest in both code and state.

**Document discipline.** This document records requirements, decisions, architecture, interfaces and
constraints only: no code, no file-by-file implementation guidance, no test mechanics, no delivery steps, and
no reference to any file that does not ship with it.

**This document ships alone.** It is the only documentation file that is published, so it neither refers to
another document nor repeats anything from one.

**Runtime independence.** The skill is self-contained at runtime: no dependency on another skill, service or
private repository, no shared state, nothing that assumes a particular operator or home directory (decision R4).

## Revision history

| Date | Change |
|---|---|
| 2026-09-23 | Initial design, from requirements elicitation. |
| 2026-09-23 | Review pass: design-only discipline, publication requirement, and every quantity made configuration. |
| 2026-09-23 | Second review pass: publication scope stated, and heritage reuse made explicit. |
| 2026-09-23 | Domain, tier, budget and settings walkthrough completed; every shipped value finalised. |
| 2026-09-23 | Research fan-out widened to 4-8 passes, since the final sweep left each pass owning more domains. |
| 2026-09-24 | Revision: the navigation shortcut became a catalogue column (`short`), with the reader's rules for it; the watchlist counts restated against `config/watchlist.md`; the deliverable description brought up to date (the chip row, the card per domain and per item, the badge rows, focus and print); the completeness-floor sentence corrected, the gate's warnings recorded, the gate section completed with the two failure rules and two warnings it had omitted, the exit-code table brought back in line with the four CLIs, the quiet-line example and its exact-name rule corrected, the `<n>` definition reduced to one, the watchlist's rows described as sitting across the core and watch domains, the catalogue's source-of-truth sentence corrected, and the pool example's notice wording matched to the collector. |
| 2026-09-24 | Trimmed to design only, because this is now the only documentation file that ships: every reference to a non-shipped file, the heritage reuse note, the process content in the validation section and the implementation walkthrough note were removed, and the document discipline was restated as a rule about this file. |
| 2026-10-16 | Revision: the notice rule tightened, so a notice records the degradation — the source, the status and the cause — and never quotes the upstream answer's text; and the settings group that described the response snippet caps now describes the bounds on candidate text and on the shaped error text. |

---

## 1. Purpose and non-goals

**Purpose.** One dated weekly digest of what actually changed across the configured technology domains,
delivered as a self-contained HTML file with its Markdown source and a run-state JSON. The domain set is
data, not code: it is read from `config/domains.md` and may be any size. The digest may be read alone or
forwarded as-is without editing.

**The job it does.** "Nothing important slipped past me." It is an awareness radar, not a decision-support
document.

**Non-goals.**

- No adopt / ignore verdicts as a standing feature. A maturity read appears only where the call is obvious
  and uncontroversial.
- Not a news digest: no funding rounds, personnel changes, market moves, or product marketing as news.
- No per-technology long-term radar history. State is run-oriented, not a knowledge base (decision Q6).
- Not coupled to any other skill or digest: no shared state, no de-duplication against one, no
  cross-references. Overlap with another digest is accepted (decision Q2).
- Not English-only sourcing. Chinese-language primaries are first-class (decision Q12).

---

## 2. Decisions

Taken during requirements elicitation, then amended in review. `R` rows come from the review of this
document; `W` rows come from the domain, tier and settings walkthrough.

| # | Question | Decision |
|---|---|---|
| Q1 | What the digest is for | Personal awareness radar first; must also read well if forwarded |
| Q2 | Relationship to other digests | Fully independent at runtime; overlap accepted, no de-duplication; shared heritage expected |
| Q3 | Cadence and trigger | Weekly plus ad-hoc; one shared state; 4-week catch-up cap |
| Q4a | Ownership of the domain list | Default catalogue in an editable config file |
| Q4b–f | Domains | A configurable catalogue, shipped with a pre-tiered default set |
| Q5 | Item shape | Curated links plus one featured deep dive per run |
| Q6 | What a run leaves on disk | HTML + Markdown source + JSON state |
| Q7 | Effort allocation | Tiered: core weekly, watch only when notable |
| Q8 | Collection strategy | Deterministic collector for the mechanical parts, agent for judgement; no ranking |
| Q9 | Language | English document |
| Q10 | Evidence bar | Practical: primary preferred, reputable secondary allowed when no primary is retrievable |
| Q11 | Size | Budget held in config; shipped defaults are core 2-4 items, watch 0-2, one featured deep dive |
| Q12 | Chinese sources | First-class; a Chinese-source item is written in Chinese |
| Q13 | Architecture | Approach A: the standard skill skeleton with fan-out research |
| Q14 | Run budget | Moderate: a limited number of parallel research passes; the final width and duration are in row W3 |
| D1 | Name, layout, config format, tiers | `tech-radar`; the standard skill layout plus `config/`; Markdown tables for configuration; a core/watch tier per domain |
| D2 | Catch-up cap and window model | Configurable, shipped at 4 weeks; per-domain watermarks |
| D3 | Output contract, gate, HTML | As specified below; the HTML is self-contained, dark themed, collapsible, searchable and print-ready |
| R1 | Document discipline | This document holds design only, and is the only one that ships: no implementation detail, no process, and no reference to a non-shipped file |
| R2 | Publication | Self-contained and independent, with no private or sensitive information |
| R3 | Every quantity | Counts, caps and budgets are configuration, never hardcoded prose or constants |
| R4 | Reuse | Adapt freely from the maintainer's other public skills, by copy; the published skill runs with no sibling present, and the copy diverges freely afterwards |
| W1 | Domain walkthrough | Every domain and tier reviewed and confirmed; the result is the catalogue in section 3.3 |
| W2 | Budget and featured item | Package A: 30-45 items, core 2-4, watch 0-2, watch-notable 8; featured deep dive only when the week warrants one |
| W3 | Run shape | 4-8 research passes, 10-30 minutes; widened from 4-6 after the final sweep grew the catalogue |
| W4 | Collector scope | A curated watchlist of watched GitHub repositories, arXiv categories and package-registry targets, plus advisory and vendor feeds. Its size is not fixed: the binding constraint is that one anonymous run fits inside GitHub's hourly allowance with the reserve held back, so the shipped count is whatever `config/watchlist.md` holds and the arithmetic is measured in `reference/feasibility.md` |
| W5 | Discovery hosts | Hacker News, Lobsters, Reddit, X, Techmeme, Google News, Baidu News, V2EX, 掘金, 知乎, 少数派, Weibo |
| W6 | README scope | Invoke-only: the skill documents no scheduling |
| W7 | Final sweep | Nine domains added — computer vision and perception at core, eight more at watch; section 3.3 is authoritative |

**One refinement to record, because Q9 and Q12 read as a contradiction otherwise.** The document is English.
An item's headline and its summary are written in the language of that item's primary source. Structural
labels and section headings are bilingual. There is no machine translation of item bodies. A Node release
note therefore produces an English item and a 量子位 or MIIT item produces a Chinese one, inside the same
English document.

---

## 3. Architecture

### 3.1 Repository layout

    tech-radar/
      SKILL.md                     the procedure: window rule, workflow, quality gate
      README.md                    what it is, install, usage, sourcing rules, limitations; invoke-only
      LICENSE                      MIT
      .gitignore  .gitattributes   LF normalisation, OS cruft
      config/
        domains.md                 one row per domain: key, name, short chip label, Chinese label, cluster, tier, why
        sources.md                 one row per source: domain key, source, tier, kind, fetchable, note
        watchlist.md               the deterministic collector's targets
        settings.md                one row per setting: window cap, item ceilings, budget, fan-out, hosts
      reference/
        output-contract.md         the exact digest grammar
        state-schema.md            state file format and the window rule
        evidence.md                the evidence bar, provenance markers, per-domain hype rules
        feasibility.md             fetch probes: what is retrievable, what is blocked, probe dates
      scripts/
        collect.mjs                deterministic candidate pool
        update-state.mjs           plan (compute windows) / update (merge items)
        render-html.mjs            Markdown to self-contained HTML
        check-quality.mjs          the gate
      examples/
        sample-digest.md           an illustrative digest, clearly labelled as illustrative
        sample-digest.html         its rendered form
      docs/
        design.md                  this document — design only, and the only file here that ships

No runtime dependencies. Every script uses only the Node standard library, so installation is a clone
rather than an install step.

### 3.2 Configuration is Markdown tables, not YAML

This skill holds a stdlib-only, nothing-to-install property, and Node has no standard-library YAML
parser. The config is therefore one Markdown table per file, parsed by a small reader in the scripts.
Human-editable, diffable, comment-friendly, renders on GitHub, and no dependency enters the repository.

`config/domains.md` — the catalogue. Columns: `key`, `domain`, `short`, `label_zh`, `cluster`, `tier`, `why`.
`short` is the topic-navigation chip label the rendered HTML uses: a couple of words, attribute-safe and
distinct, enforced by the reader. A catalogue without the column falls back to a clause of `domain`.
`key` is the stable identifier used by the state file and the `--domains` flag.

`config/sources.md` — the registry. Columns: `domain`, `source`, `tier`, `kind`, `lang`, `fetchable`, `note`.
`tier` is one of primary, secondary, discovery. `lang` is `en` or `zh`, and the gate uses it to check the
language rule. `kind` is one of release, paper, spec, advisory, registry,
blog, feed, press. `fetchable` is yes, no or feed-only, with the probe date in `note` where it is no.

`config/watchlist.md` — the collector's targets. Columns: `kind`, `target`, `domain`, `note`. `kind` is one
of github-repo, github-org, arxiv-category, npm, pypi, crates, gomod, ghsa, nvd, rss.

`config/settings.md` — the numeric and policy settings. Columns: `key`, `value`, `note`. Every quantity
lives here so that none is hardcoded in a script or asserted in this document: the values are read from the file
and never restated here. The groups it covers:

- the window and retention: the timezone, the catch-up cap, the first-run window, watchlist retention;
- the tier ceilings and the item budget: the per-domain maxima, the watch-notable ceiling, the total range;
- research: the fan-out pass range, and the deep-dive policy;
- policy lists and paths: the discovery-only hosts and the output directory;
- request bounds: the per-request timeout, the caps on candidate text and on the shaped error text, the run-history cap;
- the GitHub budget: the per-source request counts, the advisory reserve, and the documented anonymous hourly
  allowance that the shipped watchlist must fit inside.

The per-domain ceilings are ceilings, not targets: the budget binds, so the synthesis allocates within it. A tier
change is a one-line edit in `config/domains.md`; a policy change is a one-line edit in `config/settings.md`.

### 3.3 Domain catalogue and tiering

The catalogue is configuration, not code. Each domain carries a tier: **core** domains get a real section
every week, **watch** domains are scanned every week and appear only when something notable is flagged.
Neither the number of domains, nor their tiers, nor their cluster grouping is fixed — all three come from
`config/domains.md`. The tables below are the reviewed default catalogue, which `config/domains.md`
mirrors at runtime — any count is derived from the file, never asserted: the maintainer walked every entry on
2026-09-23 and confirmed its tier.

**Cluster: AI and compute**

| key | domain | 中文 | tier |
|---|---|---|---|
| ai-llm | AI / LLM | 人工智能 / 大模型 | core |
| chips-hardware | Chips, hardware and accelerators | 芯片、硬件与加速器 | core |
| photonics | Photonics and optical interconnects | 光子学与光互连 | watch |
| quantum | Quantum technologies | 量子技术 | watch |
| computer-vision | Computer vision and perception | 计算机视觉与感知 | core |
| eda-silicon | EDA and open silicon | EDA 与开源芯片 | watch |
| hpc-scientific | Scientific computing and HPC | 科学计算与高性能计算 | watch |

**Cluster: Software craft**

| key | domain | 中文 | tier |
|---|---|---|---|
| languages-runtimes | Languages and runtimes | 编程语言与运行时 | watch |
| devtools | Developer tools and editors | 开发工具与编辑器 | watch |
| web-platform | Web platform and browsers | Web 平台与浏览器 | watch |
| oss-governance | Open source governance and licensing | 开源治理与许可 | watch |
| graphics-media | Real-time graphics, engines and generative media | 实时图形、引擎与生成式媒体 | core |
| formal-methods | Formal methods and program verification | 形式化方法与程序验证 | watch |

**Cluster: Systems and infrastructure**

| key | domain | 中文 | tier |
|---|---|---|---|
| linux-os | Linux and operating systems | Linux 与操作系统 | watch |
| infra-cloud | Infrastructure, cloud and orchestration | 基础设施、云与编排 | watch |
| data-storage | Data, databases and storage | 数据、数据库与存储 | watch |
| self-hosting | Self-hosting, local-first and privacy tech | 自托管、本地优先与隐私技术 | core |
| networking | Networking and telecom | 网络与电信 | watch |
| smart-home-iot | Smart home and IoT protocols | 智能家居与 IoT 协议 | watch |
| personal-computing | Personal computing and devices | 个人计算与设备 | watch |

**Cluster: Security and trust**

| key | domain | 中文 | tier |
|---|---|---|---|
| security-privacy | Security and privacy | 安全与隐私 | watch |
| tech-policy | Tech policy, standards and regulation | 技术政策、标准与监管 | watch |

**Cluster: Energy and the physical world**

| key | domain | 中文 | tier |
|---|---|---|---|
| energy-power | Energy and power | 能源与电力 | core |
| materials-mfg | Materials and advanced manufacturing | 材料与先进制造 | core |
| built-environment | Built environment and construction technology | 建筑环境与建造技术 | watch |
| climate-earth | Climate and earth observation | 气候与对地观测 | watch |
| ocean-water | Ocean, water and critical resources | 海洋、水与关键资源 | watch |
| power-electronics | Power electronics | 电力电子 | watch |

**Cluster: Machines and industry**

| key | domain | 中文 | tier |
|---|---|---|---|
| robotics | Robotics and autonomy | 机器人与自主系统 | core |
| industrial-ot | Industrial automation and OT | 工业自动化与运营技术 | core |
| transport | Transport and mobility | 交通与出行 | core |
| supply-chain | Supply chains and logistics technology | 供应链与物流技术 | watch |
| simulation-cae | Simulation and computer-aided engineering | 仿真与计算机辅助工程 | watch |

**Cluster: Life and health**

| key | domain | 中文 | tier |
|---|---|---|---|
| biotech-health | Biotech and health | 生物技术与健康 | watch |
| neuro-bci | Neuroscience and brain-computer interfaces | 神经科学与脑机接口 | core |
| wearables-sensors | Wearables, sensors and human augmentation | 可穿戴、传感器与人体增强 | core |

**Cluster: Frontier and society**

| key | domain | 中文 | tier |
|---|---|---|---|
| frontier-science | Frontier science and fundamental research | 前沿科学与基础研究 | watch |
| space-aerospace | Space and aerospace | 航天与航空 | watch |
| defence-dual-use | Defence and dual-use technology | 国防与两用技术 | core |
| fintech-rails | Fintech and payment rails | 金融科技与支付通道 | watch |
| spatial-computing | Spatial computing, AR/VR and displays | 空间计算、AR/VR 与显示 | watch |
| audio-speech | Audio, speech and music technology | 音频、语音与音乐技术 | core |
| hci-research | HCI and interaction research | 人机交互研究 | watch |

**Why watch is not unwatched.** Every run scans every configured domain mechanically through the collector, and each
research pass also reviews its own watch domains' candidates and may promote one under the same evidence
bar; a promotion is what turns a watch domain into a section. A watch domain that is not promoted is named
in a single compact quiet line at the end. The default catalogue ships pre-tiered with a one-line rationale
per domain.

**Accepted limitation, stated in SKILL.md.** A quiet but important item in a watch domain that no feed
carries can be missed. The remedy is one config line moving that domain to core.

### 3.4 Run lifecycle

1. **Resolve** paths and the output directory: `$TECH_RADAR_DIR`, else `./tech-radar/` under the working
   directory.
2. **Plan** the window: `update-state.mjs plan` reads the state and prints, per domain, the `since` value and
   a single human-readable window label. It never prompts.
3. **Collect** deterministically into one candidate pool.
4. **Fan out** the configured number of research passes over the clusters, each receiving its domains, its
   slice of the pool, the ceilings, the evidence bar and the item grammar.
5. **Synthesise**: dedupe by story key, resolve contradictions by showing both, rank, choose a featured deep
   dive if the week warrants one, enforce the ceilings and the budget, write the Markdown.
6. **Gate, render, record**: run the quality gate, render the HTML, merge items into state and advance the
   watermarks of the domains actually covered.
7. **Deliver**: present the HTML and summarise the content in chat, not merely the path.

### 3.5 Window rule

- Weekly run: `since = max(domain.lastCoveredAt, now - 4 weeks)`.
- First ever run: the last 7 days.
- When the cap bites, the header says so and the coverage note states how much was skipped.
- `plan` prints the label used verbatim in the header and the coverage note, so the two can never disagree.

**Entry points and per-domain watermarks.** State records `lastCoveredAt` per domain. A weekly run covers all
domains and advances all watermarks. A catch-up run (`--since <date>`) takes an explicit floor; when it names
no `--domains` it covers every domain and therefore advances every watermark, while a focused catch-up leaves the
others untouched. A focus run (`--domains a,b`) researches those domains and advances only theirs.
A focus run therefore does not consume that domain's week, and a catch-up cannot silently skip coverage that
the next weekly would have provided. There are no gaps and no duplicates across the three entry points.

### 3.6 Deterministic collector

`collect.mjs` is driven by `config/watchlist.md` and gathers only reliably machine-readable material:

- GitHub releases and tags for watched repositories and organisations (keyless; `GITHUB_TOKEN` raises limits);
- arXiv listings for watched categories (cs.AI, cs.LG, cs.DC, cs.PL, cs.CR, quant-ph, eess.SP, cond-mat, …);
- security advisories: GitHub Security Advisories and recent high-severity NVD CVEs;
- package registries: npm, PyPI, crates.io, the Go module proxy, for watched packages;
- vendor, project and standards feeds, where RSS or Atom exists.

The shipped watchlist is a curated starter set: 55 GitHub repositories and organisations spread across the
core and watch domains, 17 arXiv categories, 12 packages across npm, PyPI, crates and the Go module proxy, and the
advisory and vendor feeds — the counts `config/watchlist.md` carries, not targets. It is sized to fit inside
the keyless GitHub rate limit with the reserve held back (row W4); `GITHUB_TOKEN` raises that limit but is not
required, and `reference/feasibility.md` holds the measured arithmetic.

It emits one candidate-pool JSON: an array of candidates, each tagged with a domain key, a source-tier hint
and its raw metadata, plus a `notices` array recording any degradation (rate limits, unreachable sources,
schema surprises). A notice records the degradation — the source, the status and the cause — and never
quotes the upstream answer's text. **It does not rank or score candidates.** Ranking is a heuristic that can
silently bury the quiet but important item, which is the one failure a radar must not have; judgement stays
with the agent.

### 3.7 Research fan-out and synthesis

The clusters are divided among the configured number of research passes, so that each pass owns one or
two clusters. Each pass
receives its domains, its slice of the pool, its caps, the evidence bar and the item grammar, and returns
candidate items with every field filled.

A single synthesis pass then dedupes across passes by story key, shows contradictions side by side, ranks,
selects the featured deep dive, enforces the caps, and writes the Markdown.

**The risk is that a research pass invents.** The mitigation is mechanical rather than exhortative: the
output contract makes a URL and a published time mandatory on every item, and the gate verifies link
presence and shape, domain caps, duplicate keys, provenance markers and language rules. A failing item is
**dropped, not repaired** — a missing item is a smaller failure than a fabricated one.

### 3.8 State

`tech-radar-state.json` beside the digests, and the only memory the skill keeps:

- `version`, `updatedAt`;
- `domains`: per-domain `{ lastCoveredAt, lastRunAt }` watermarks, one for every configured domain;
- `items`: keyed by story key (normalised headline plus primary host), each with `firstSeen`, `lastSeen`,
  `timesSeen`, `domain`, `outlet`, `primaryUrl`, `flags`;
- `watchlist`: unresolved developing stories, kept while they have activity and dropped four weeks after
  `firstSeen`;
- `runs`: a short log of run date, entry point, window and item count.

There is no per-technology radar history and no accumulated knowledge base (decision Q6).

---

## 4. Interfaces

### 4.1 Candidate pool

    {
      "version": 1,
      "generatedAt": "2026-09-23T09:00:00Z",
      "window": { "since": "...", "until": "..." },
      "candidates": [
        {
          "domain": "ai-llm",
          "kind": "github-release",
          "title": "vLLM v0.11.0",
          "url": "https://github.com/vllm-project/vllm/releases/tag/v0.11.0",
          "publishedAt": "2026-09-21T14:02:00Z",
          "source": "github:vllm-project/vllm",
          "tierHint": "primary",
          "summary": "raw upstream text, untrusted, for the agent to read"
        }
      ],
      "notices": [ "github: rate limit reached after 60 requests; 12 repositories not checked" ]
    }

### 4.2 CLI surface and exit codes

`update-state.mjs`

    plan   --state <path> [--domains a,b] [--since ISO] [--config <dir>]
    update --state <path> --items <path> --out <path> --date YYYY-MM-DD [--domains a,b] [--since ISO] [--config <dir>]

`collect.mjs`

    [--config <dir>] [--since <ISO>] [--until <ISO>] [--out <path>] [--human] [--domain a,b] [--timeout <ms>]

`render-html.mjs`

    <input.md> --out <path> [--config <dir>]

`check-quality.mjs`

    <input.md> --plan <plan.json> [--config <dir>] [--html <path>] [--pool <path>]

Every script resolves `config/` from the directory beside itself, so these commands work from any working
directory and `--config` is only an override.

| Exit | Meaning |
|---|---|
| 0 | OK (a non-empty `notices` array means a documented partial result) |
| 1 | Fatal, unexpected: reserved, and no shipped path reaches it in the collector |
| 2 | Config, plan, pool, state or input not found, unreadable, or an empty flag value |
| 3 | The pool came back empty and at least one notice was recorded (collector), or items failed validation (state) |
| 4 | Output could not be written |
| 5 | Quality gate failed (gate only), or self-containment violated (renderer only) |

### 4.3 Output contract

Two files: `tech-radar-YYYY-MM-DD.md` and its `.html`, plus the state JSON. The full grammar lives in
`reference/output-contract.md`; in short:

    # Tech Radar — <YYYY-MM-DD>
    _<plan label> · <n> domains scanned · <m> items_

The plan's label already carries the cap state, so it is not repeated. `<n>` is the number of keys in the plan's
`perDomain` — the run's scope, which equals the configured domains for a weekly run — and `<m>` is the item count.
The renderer takes the **last** leading `_…_` line as the header meta, so a notice line may precede the label.

    ## Featured this week            (only when the week warrants one)
    ### <the one thing worth ten minutes>
    <200-350 words: what changed, why it matters, what it affects, what to watch next>
    (absent: "Nothing this week warranted a deep dive.")

    ## Core domains
    ### AI / LLM · 人工智能 / 大模型
    - **Headline** — one or two sentences: what changed and why it matters.
      [src:OUTLET 2026-09-20](https://primary) [prov:primary] #new

    ## Watch domains — notable this week
    ### Robotics and autonomy · 机器人与自主系统
    - ... (0-2 items)

    ## Watch domains — quiet
    Photonics and optical interconnects · Quantum technologies · Materials and advanced manufacturing · ... (scanned, nothing notable)

    ## Coming up
    - Unresolved developing stories, each with a horizon.

    ## Coverage note
    The window label verbatim, what the cap skipped, and the collector notices.

    ## Sources

Every quantity in the header line comes from the configuration and the run: `<n>` is the run's scope defined
above — the keys of the plan's `perDomain` — and `<window label>` is the label `plan` printed, so the header
can never disagree with the coverage note. Every item carries exactly one provenance marker and exactly one status flag.
Corroborating links appear as `[alt:OUTLET](url)`. Sections whose domains are bilingual keep both labels.
A core domain with nothing to report keeps its heading and says so plainly; watch domains that produced
nothing are collected into the single quiet line. The per-domain ceilings are not targets: the total budget
binds, so the synthesis allocates within it.

### 4.4 The quality gate

`check-quality.mjs` fails the digest when any of the following holds:

- an item lacks a URL or a published date, or its date falls outside **its own domain's** window when the plan
  carries one, and outside the global window otherwise;
- an item lacks exactly one provenance marker;
- an item does not carry exactly one of `#new` or `#followup`;
- an item cites a discovery-only host, the list being held in `config/settings.md`;
- a core domain exceeds `core_max_items`, a watch domain exceeds `watch_max_items`, watch-notable items
  exceed `watch_notable_max`, or the total falls below the run's completeness floor or above `total_max_items`.
  The floor scales with the run's scope — `total_min_items` scaled by the share of the catalogue the run covers,
  rounded up, clamped to at least one and at most `total_min_items`, and for a multi-domain run also at least
  one item per covered domain plus one as far as `total_min_items` allows — while the ceiling stays global. The per-domain ceilings are not targets:
  the budget binds, so the synthesis allocates within it;
- a core domain is absent as a section heading — a quiet core domain keeps its heading with an explicit
  quiet line, so it can never vanish silently;
- two items share a story key;
- a source registered as Chinese produced a Latin-only item, or a section heading is missing its bilingual
  label;
- a domain heading names a catalogue **key** instead of the domain name, which would leave the tier, ceiling
  and quiet-line rules resolving against nothing;
- the coverage note does not contain the header's window label verbatim;
- the quiet line omits a watch domain that produced no item — the line carries each covered watch domain's
  exact catalogue `domain` string, never its `short` chip;
- the HTML references any external asset, so it would break when opened from disk;
- under `deep_dive: when-warranted`, a digest with no featured section lacks the recorded stand-in line
  `Nothing this week warranted a deep dive.`;
- the pool passed as `--pool` recorded notices and the coverage note does not carry `Collector notices: <n>` with
  that count, or carries a different number.

It warns, without failing, when the featured deep dive names no source — a rendered card can link a headline and
show an origin pill only when the prose cites one — and likewise for an outlet absent from the registry, a heading
that names no catalogue domain, more than one status token on an item, a bullet that looks like an item but does
not match the grammar, and a featured section that is present while `deep_dive` is `never`.

---

## 5. Evidence bar

| Marker | Meaning |
|---|---|
| `[prov:primary]` | The artifact itself: release note, paper, specification, advisory, changelog, official lab post |
| `[prov:secondary]` | A reputable report of it, allowed only when no primary is retrievable — paywalled, unreadable, or non-existent |
| `[prov:preprint]` | arXiv or equivalent, unreviewed; never stated as established |
| `[prov:vendor-claim]` | Vendor or project marketing, reported as a claim and not as a result |

Status flags: `#new`, `#followup` (exactly one, always), plus optional `#developing` and `#watch`.

Discovery-only surfaces — Hacker News, Lobsters, Reddit, X, Techmeme, Google News, Baidu News, V2EX, 掘金,
知乎, 少数派, Weibo — are for finding stories and are never the cited source. The list is configuration, so
it can be extended without touching a script or the gate.

The per-domain hype rule lives in `reference/evidence.md`. In quantum, fusion, superconductors, materials,
batteries, robotics demonstrations and AGI claims, a **result** requires independent reproduction or a
shipping product; otherwise it is written as a claim and given the matching marker. Contradictory reports are
shown side by side rather than resolved silently. Nothing is invented, estimated or padded, and a quiet week
is reported as quiet.

---

## 6. Deliverable

- Output to `$TECH_RADAR_DIR`, else `./tech-radar/` under the working directory.
- `tech-radar-YYYY-MM-DD.md` and `tech-radar-YYYY-MM-DD.html` are the deliverable. The HTML is
  self-contained: dark theme; one flat row of shortcut chips taken from the `short` column, the featured
  section included; a collapsible card per domain carrying its tier label and item count; a card per item with
  a provenance marker dot, a headline that links to the cited source, and a badge row (origin pill, provenance
  badge, status tag); the featured deep dive drawn as the same card; a search box that filters the cards and
  opens the sections that still match; a floating back-to-top control; on-brand focus styling; print styles
  that open the cards and hide the chrome; and no external assets of any kind.
- Run artifacts (`.pool.json`, `.items.json`) sit beside them, are not part of the deliverable, and are
  overwritten each run.
- The chat reply summarises the digest's content rather than pointing at a path.

---

## 7. Validation

The skill's behaviour must be demonstrated, not asserted: **no behaviour this document describes is claimed
to work until it has been demonstrated against a failure recorded before it was implemented.**

---

## 8. Risks and accepted limitations

1. **Collector fragility.** GitHub, arXiv and NVD change shape and rate-limit. Mitigated by documented exit
   codes and a `notices` array: the run degrades to agent research and says so, and never fails silently.
2. **Research passes can invent.** Mitigated mechanically by mandatory URL and date fields, the gate, and
   drop-don't-repair.
3. **Volume creep.** Enforced by the gate's ceilings and budget rather than by intention.
4. **Watch domains are scanned, not researched.** A quiet but important item that no feed carries can be
   missed. Documented in the skill; the remedy is one config line.
5. **Hype cannot be detected mechanically.** The gate checks labels, not judgement. The hype rule remains a
   written rule plus the `[prov:vendor-claim]` marker, and it is the weakest mechanical link in the design.
6. **Config drift.** Source fetchability ages. `reference/feasibility.md` records probe dates, and the skill
   directs a re-probe after a source fails twice.
7. **No shared code with anything else.** Independence was chosen, so the renderer and state scripts are
   stand-alone implementations rather than thin wrappers over another tool's.
8. **Long windows thin out.** The gap cap exists precisely because a longer window inside the same item
   budget would skim rather than report.

---

## 9. Scope of this document

Deliberately not specified here, because each is a filled-in artefact or an open implementation choice
rather than a design question:

- the default rows of `config/sources.md` and the evidence behind them;
- the default watched repositories, packages, arXiv categories and feeds in `config/watchlist.md`;
- the stylesheet and the exact markup of the rendered HTML, beyond the shape section 6 describes;
- the wording of `SKILL.md`, which is written against the failures the skill exists to prevent rather than in
  advance.
