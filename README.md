# tech-radar

## What it is

An agent skill that writes one **weekly technology digest**: what changed across a configured catalogue of
technology domains, with every item dated and traceable to a real source. A run produces three files - a
self-contained HTML deliverable, its Markdown source, and the JSON state that lets the next run size its
window and tag `#new` against `#followup`. The catalogue is tiered: the core domains are covered every week,
and the watch domains are reported only on a week that has something notable to say.

## What a run produces

| Output | Purpose |
|---|---|
| `tech-radar-YYYY-MM-DD.html` | The deliverable: one self-contained file with inline CSS and JS, a working search box and a collapse control; it opens from `file://` with no network access |
| `tech-radar-YYYY-MM-DD.md` | The editable source of the same digest, written in the grammar of `reference/output-contract.md` |
| `tech-radar-state.json` | Run state: per-domain watermarks, story history and the watchlist, so the next run can compute its window and decide `#new` or `#followup` |

They land in `$TECH_RADAR_DIR` when that variable is set, and otherwise in the `output_dir` from
`config/settings.md` (shipped as `./tech-radar`, resolved against the working directory). Four run artifacts sit beside
them, are overwritten on every run, and are not part of the deliverable: `.pool.json` (the collected candidate
pool), `.items.json` (the items that shipped), `.plan.json` (the window plan the gate is checked against) and
`.research.json` (the provenance trail for what the research passes found).

## Requirements

- **Node 18 or newer.** Every script runs under Node.js and uses only the standard library: no dependencies,
  no `package.json`, no build step, nothing to install.
- **The `curl` binary on `PATH`.** The collector fetches over HTTP by shelling out to `curl`; it is the only
  external program the skill runs.
- A skill-capable agent harness (DeepSeek Harness, Claude Code, ...) with web search and fetch available.
- Network access for the collector and for the research passes.
- `GITHUB_TOKEN` is optional and only raises the GitHub API rate limit. The anonymous budget is measured,
  not assumed: 60 core requests per hour, and the shipped watchlist's floor is 56 of them - 55 repositories
  plus the advisory list - against the 58 that are spendable once the configured `github_rate_limit_reserve`
  of 2 is held back, leaving two requests of headroom. **The tags phase is separate and comes out of what the
  floor leaves.** Whenever a repository's releases produce no in-window candidate the collector also asks for
  that repository's tags - one request each, up to 55 more - so a quiet week wants 111 GitHub requests in all:
  55 releases, the advisory listing and 55 tag listings. Of those the hour charges 59 - the 55 releases, the
  advisory and 3 of the tag listings - and the other 52 tag listings go unchecked, which forces a rate-limit
  notice into the coverage note. The collector probes that budget on every run and, when a run runs short,
  records a notice that reports `remaining N of M`; those notices belong in the digest's coverage note. A
  second full run inside the same hour loses the GitHub tail, and the collector degrades those sources to
  notices instead of failing. Every other source needs no token. See Token safety.

## Token safety

The collector runs without a credential; a `GITHUB_TOKEN` only raises the GitHub API limit, and a normal weekly cadence does not need one. If you add a token, treat it as a secret and give it as little power as the job needs.

**Create the least powerful token that works.**

- Preferred: a **fine-grained token** with **Public repositories (read-only)** and no other permissions, with an expiry (90 days is sensible). GitHub requires an expiry for fine-grained tokens and makes the repository selection explicit, so neither can be forgotten.
- Equivalent and simpler: a **classic token with no scopes selected**. It can read public data and nothing else. Set an expiry anyway — a classic token without one lives until you revoke it.
- Never grant `repo`, `public_repo`, `workflow`, `admin:*` or organisation access. `public_repo` sounds like read access and is not: it grants write to every public repository you can push to. This skill only issues GETs to public endpoints — `/rate_limit`, a repository's releases and tags, an organisation's repositories, and the advisory list.

**Store it where it cannot be published.**

- Keep it in the environment the skill runs in: your harness's environment file, your shell profile for the session, or a credential manager fetched per run (for example `GITHUB_TOKEN=$(gh auth token)` with the GitHub CLI).
- Make any file that holds it owner-only (`chmod 600`) and never commit it. This repository is published whole.
- Never paste a token into an agent session: transcripts are written to disk and may be indexed later.

**Know the residual.** The collector hands the credential to `curl` as a request header, which places it in that process's command line while a request is in flight. Command lines are readable by other local accounts unless the system sets `hidepid`; environment variables are owner-only, which is why the token is read from the environment rather than from an argument. The collector writes that header into no artifact of its own: the pool, the digest and everything else it produces are built from the URLs it requested and what the servers answered, and the credential is never one of those fields. What does get published is the servers' text: a failed source becomes a notice, a notice quotes the answer the server gave, and a degraded run's coverage note is required to carry those notices into the digest (the gate fails a run that omits the `Collector notices: <n>` line). Every notice is scrubbed at the single point it is pushed - the request's own values and the credential shapes the collector recognises are removed - but a server's echo in a spelling it does not recognise would still be published, so read a notice as a diagnostic of a degraded source, not as proof that no credential is in it. On a single-user machine that is a small, transient exposure; on a shared host, run the skill in a container or a dedicated account, or use no token at all.

**Rotate.** Revoke and reissue if the token is ever exposed — a transcript, a screenshot, a shared shell, a backup.

## Install

Clone the repository into your harness's skills directory, keeping the directory name equal to the `name:` in
`SKILL.md`'s frontmatter (`tech-radar`):

```sh
git clone <repo-url> ~/.dsh/skills/tech-radar
# Claude Code
git clone <repo-url> ~/.claude/skills/tech-radar
```

## Usage

Ask for it in plain language. The window is computed from the state, never asked for.

- **A weekly run** - "what changed in tech this week", "run the tech radar". Each domain starts at its own
  watermark, or `first_run_days` back when it has never been covered.
- **A catch-up run after missed weeks** - "catch me up on the last month". The window widens only as far as
  `window_cap_weeks` allows, and the coverage note states what the cap skipped.
- **A focus run on named domains** - "just AI and quantum this week". Only the named domains are researched,
  and only their watermarks advance.

The run steps in `SKILL.md` are driven by scripts: `update-state.mjs plan` prints the window JSON, `collect.mjs` builds the
candidate pool, the research passes fan out across the clusters, the digest is written against
`reference/output-contract.md`, and `render-html.mjs` plus `check-quality.mjs` produce and gate the
deliverable. Exit 0 from the gate is the only shipping state, and the run is merged into the state only after
the gate passes. Five weeks of silence is a catch-up the plan resolves and caps, not a prompt.

## Configuration

Four Markdown tables under `config/` hold all of it, and every quantity the skill uses lives there rather than
in a script:

- `config/domains.md` - the catalogue: key, English domain, `short` (the topic-navigation chip label), `label_zh`, cluster, tier (`core` or `watch`) and why each domain is carried.
- `config/settings.md` - every quantity and policy: the window cap, the first-run reach, the per-domain ceilings, the watch-notable and total budgets, the fan-out width, the timezone, the discovery-host list, the navigation-chip cap (`short_max_chars`) and the output directory.
- `config/sources.md` - the source registry: which outlets are read, their evidence tier, their language and what automated fetch has actually achieved.
- `config/watchlist.md` - the collector's only input: the repositories, categories, packages, advisories and feeds that are scanned, each mapped to a domain.

## Sourcing rules

- **Exactly one provenance marker per item.** `[prov:primary]` when the artifact itself was retrieved (a
  release, paper, specification, advisory, changelog or official post); `[prov:secondary]` for a reputable
  report of it, only when no primary is retrievable; `[prov:preprint]` for arXiv or equivalent unreviewed
  work, never stated as established; `[prov:vendor-claim]` for vendor or project marketing, reported as a
  claim and not as a result.
- **A dated citation on every item**, out to the primary source, with an optional `[alt:OUTLET](url)` for
  corroboration. An item that cannot be dated is dropped, never approximated.
- **Discovery-only surfaces are for finding stories, never for citing them.** Hacker News, Lobsters, Reddit,
  X, Techmeme, Google News, Baidu News, V2EX, 掘金, 知乎, 少数派 and Weibo are the `discovery_hosts` list in
  `config/settings.md`, and the gate blocks a citation whose host is one of them.
- **The per-domain hype rule decides when a claim may be written as a result.** In the domains it names -
  Quantum technologies, Energy and power, Materials and advanced manufacturing, Frontier science and
  fundamental research, Neuroscience and brain-computer interfaces, Wearables, sensors and human
  augmentation, Robotics and autonomy, Defence and dual-use technology, and Space and aerospace - plus a
  frontier-capability claim in AI / LLM, a result needs independent reproduction, a shipping product or
  official documentation before it is reported as one.
- **Nothing is invented, estimated or padded.** A quiet week is reported as quiet: a quiet core domain keeps
  its heading and says so, every quiet watch domain is named on the quiet line, and a failing item is dropped
  rather than repaired.

`reference/evidence.md` is the detail behind all five; the mechanical parts are enforced by
`scripts/check-quality.mjs`.

## Repository layout

```
SKILL.md                       the skill itself: the procedure the agent follows, start here
README.md                      this file
LICENSE                        MIT, "The tech-radar authors"
.gitignore, .gitattributes     repository hygiene
config/domains.md              the domain catalogue: key, domain, short, label_zh, cluster, tier
config/settings.md             every quantity and policy
config/sources.md              the source registry: tier, language, fetchability
config/watchlist.md            the collector's targets
scripts/lib/mdtable.mjs        Markdown-table configuration reader
scripts/lib/net.mjs            HTTP via curl, charset decoding, feed and entity parsing
scripts/lib/assets.mjs         the self-containment predicate for the rendered HTML
scripts/collect.mjs            the candidate pool from feeds, GitHub, arXiv, advisories and registries
scripts/update-state.mjs       plan computes per-domain windows; update merges a run into the state
scripts/check-quality.mjs      the gate: caps, provenance, hosts, dedupe, language, label, quiet line
scripts/render-html.mjs        Markdown digest to one self-contained HTML file
tests/*.test.mjs               fixture tests for every module and script, run with node --test
tests/fixtures/**              the config and digest fixtures those tests read
tests/lib/**                   the shipping-set walker the publication guards share
reference/output-contract.md   the exact digest grammar
reference/state-schema.md      the state file format and the window rule
reference/evidence.md          the evidence bar, provenance markers and per-domain hype rules
reference/feasibility.md       the probe record: what is retrievable and what is blocked
examples/                      an illustrative digest, its HTML and the plan it is verified against
docs/design.md                 the spec: requirements, decisions, architecture, interfaces and constraints
                               — the only file under docs/ that ships with the skill
examples/sample-digest.md      an illustrative digest, clearly labelled
examples/sample-digest.html    the same example, rendered
examples/sample-plan.json      the synthetic window the example's dates sit inside
```

## Limitations

- **Watch domains are scanned, not researched.** A quiet watch domain means it produced nothing that cleared
  the evidence bar, not that nothing happened in it.
- **A quiet-but-important item that no feed carries can be missed.** The collector reads a configured
  watchlist; it is not a crawl of the whole field.
- **The gap cap is four weeks by default.** After a longer absence the run is a partial catch-up, and the
  coverage note says how much was skipped.
- **Blocked sources stay unverified.** An outlet that automated fetch cannot read - paywalled, client-rendered
  or returning a navigation shell - is cited link-only with the date and a corroborating link, and is never
  written up as though it had been read.
- A `GITHUB_TOKEN` is optional and carries a small, documented exposure; see Token safety for the minimal scopes and the residual risk.

## License

MIT - see [LICENSE](LICENSE).
