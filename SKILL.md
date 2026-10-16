---
name: tech-radar
description: Use when asked for a weekly technology digest, a technology catch-up, or what changed across technology domains; produces a dated HTML and Markdown digest with verified sources, tiered core and watch domains, and new-versus-follow-up tracking.
whenToUse: Any request for a periodic technology digest or catch-up across domains, including a run for a specific window or a focus run on named domains. Not for single-topic research, for news briefings, or for release notes of one project.
---

# Tech Radar

## What this produces

Three files, written to `$TECH_RADAR_DIR` when that variable is set and otherwise to the `output_dir` in
`config/settings.md` (shipped as `./tech-radar`, resolved against the working directory): the deliverable
`tech-radar-YYYY-MM-DD.html`, its Markdown source `tech-radar-YYYY-MM-DD.md`, and `tech-radar-state.json`,
the run state and the only memory this skill keeps between runs. The run artifacts — `.plan.json`, `.pool.json`,
`.items.json` and `.research.json` — sit beside them, are overwritten on every run, and are not part of the
deliverable. The HTML is a single self-contained file that opens from `file://` with no network access.

## Read first

- Read `config/domains.md` before you plan coverage: it is the catalogue — key, English domain, `short` (the topic-navigation chip label), `label_zh`,
  cluster, `tier` (`core` is covered every week, `watch` only on a notable week) and why each is carried.
- Read `config/settings.md` before you compute or enforce any quantity: the window cap, the first-run reach,
  the per-domain ceilings, the watch-notable and total budgets, the fan-out width, the timezone, the output
  directory and the discovery-host list all live there and nowhere else.
- Read `config/sources.md` before you accept an outlet: it records the evidence `tier` of the page cited, the
  source `lang`, and what automated fetch has actually achieved (`fetchable`).
- Read `config/watchlist.md` before you collect: it is the collector's only input, and it, not the model, decides
  which repositories, categories, packages, advisories and feeds are scanned.
- Read `reference/output-contract.md` before you write a single item line: it is the digest grammar the gate parses.
- Read `reference/evidence.md` before you mark a claim or state a result: it holds the markers, the discovery-only
  hosts, the per-domain hype rule and the contradiction rule.
- Read `reference/state-schema.md` before you plan a window or merge a run: it is the exact shape of the state,
  the story key and the retention rule.

## The window rule

The window is computed from the state, never negotiated with the user. `plan` prints it as JSON, mutates
nothing, and treats a missing state file as a first run rather than an error. **You choose the form; `plan`
computes the floor.** The user never supplies a window and you never invent one — you only translate what the
request says into one of these three forms:

| The request says | Run | The floor becomes |
|---|---|---|
| the periodic run — "this week's digest", "what changed lately" | plain `plan` | each domain's own `lastCoveredAt`, or `first_run_days` back for a domain never covered |
| a gap the user names — "it has been five weeks", "since June", "I missed a month" | `plan --since <date>` | the named gap becomes a floor: the earlier of it and a domain's watermark wins, so it can pull a start back but never forward, and a domain never covered uses the gap instead of the `first_run_days` reach |
| named domains — "just AI and quantum" | add `--domains a,b` | only those domains are planned, and only their watermarks advance on the merge |

```sh
node scripts/update-state.mjs plan --state "$DIR/tech-radar-state.json"
# a focus run plans only the named domains, and only their watermarks will advance
node scripts/update-state.mjs plan --state "$DIR/tech-radar-state.json" --domains ai-llm,quantum
# a catch-up run takes an explicit floor, still clamped by window_cap_weeks
node scripts/update-state.mjs plan --state "$DIR/tech-radar-state.json" --since 2026-08-26
```

Take `plan.since`, `plan.until`, `plan.perDomain` and `plan.label` from that JSON. Each domain starts at its
own `lastCoveredAt`, or `first_run_days` back when it has never been covered. **`--since` is a widening bound**:
with a watermark the earlier of the watermark and the floor wins, so it can pull a start back but never forward;
with no watermark the floor replaces the `first_run_days` reach. Every start is then clamped to
`window_cap_weeks`. The cap is reported in `plan.capped` and inside `plan.label`, which
already ends in `· cap hit` or `· cap not hit`; the label is repeated verbatim in the digest header and again in
the Coverage note. **The window is never a question the agent asks the user**: five weeks of silence is a
catch-up the plan resolves and caps, not a prompt and not a five-week digest with no accounting.

**Precedence when both apply.** If the state file is missing *and* the user names a gap, **the named gap wins**:
on a fresh state file no domain has a watermark, so `--since` sets every start, and the cap still clamps it: a
five-week gap becomes four weeks with `capped: true` and `· cap hit`, not seven days and not five weeks. Running the plain form on a
fresh state file instead yields `first_run_days` and silently hides the rest of the gap, which is the failure this
rule exists to prevent. The two readings give different windows, different labels and different coverage notes,
and they are not interchangeable. They do share one property: a first run can never emit `#followup`, because with
no prior items in the state every story key is new — so the flags are never how you tell the two apart. The
window and the label are.

At the end of the run, merge what shipped:

```sh
node scripts/update-state.mjs update --state "$DIR/tech-radar-state.json" \
  --items "$DIR/.items.json" --out "$DIR/tech-radar-state.json" --date 2026-09-23
# add --domains a,b for a focus run; add --since <ISO> to record a catch-up window
```

`--state` defaults to `tech-radar-state.json` relative to the working directory, so always pass the resolved
path. `update` writes the merged state, prints `{ updated, results }` where each result is `new` or `followup`,
advances the watermarks of the domains the run covered, and logs the run. It refuses (exit 2, nothing merged) a
run whose date and covered domain set are already in the run log — that is a re-delivery of the same run, not a
new one; use a different `--date`, or `--domains` for a focus run. It also refuses (exit 2, nothing merged) while
another update holds the state's or the output's lock — `<state>.lock` or `<out>.lock`, since `update` locks both
the state it reads and the destination it writes — naming the lock it could not take; a lock whose holder is gone
is reclaimed, but a file at a lock path that is not a holder record written by `update-state.mjs` is refused
rather than removed. `reference/state-schema.md` has the exact shape.

## Run steps

### 1. Resolve

Resolve `DIR` — `$TECH_RADAR_DIR` if set, otherwise the `output_dir` from `config/settings.md` (shipped as
`./tech-radar`, resolved against the working directory) — and read the four configuration tables before anything
else. **The commands work from any working directory**: each of the four CLIs — `collect.mjs`, `update-state.mjs`,
`check-quality.mjs` and `render-html.mjs` — resolves its configuration from the `config/` directory beside the
script, not from a path relative to your cwd, and `--config <dir>` is only an override for a non-default
configuration directory. Nothing in this procedure depends on where you stand except `DIR`, which is why you
resolve it once and pass it to every command. Every quantity comes from configuration: the window cap, the ceilings, the budget, the
fan-out width, the timezone and the output directory from `config/settings.md`; the domains, tiers, clusters and
bilingual labels from `config/domains.md`. A hardcoded count anywhere is a defect.

### 2. Plan

Pick the form from the table in **The window rule** — plain for the periodic run, `--since <date>` when the
request names a gap, plus `--domains a,b` for a focus run — and keep its JSON at `$DIR/.plan.json`. That file is
the only source of the window, the label and the per-domain starts, and the quality gate is later given the same
file so the header, the coverage note and the gate can never disagree.

**Plan and collect the same domains.** A run whose collection is scoped with `--domain` has to be planned with the
same `--domains` set, because the gate takes the run's scope from the plan's `perDomain` keys and not from the
collector: a plan wider than the collection fails a focused digest that is entirely correct.

### 3. Collect

```sh
node scripts/collect.mjs --since "<plan.since>" --until "<plan.until>" --out "$DIR/.pool.json"
# add --domain a,b to restrict collection to the keys a focus run covers
```

**The collector creates its destination; the other writers do not.** `--out` may name a path whose directory tree
does not exist yet: the collector makes it, so `--out <new>/deep/.pool.json` succeeds. `render-html` and
`update-state` refuse a missing directory with exit `4`. The three writers disagree, and only the collector creates
what it is given.

**A symlinked destination is resolved to the file it names.** A `--out` or `--state` that is a symlink is
followed to its target: the write lands on that file rather than replacing the link, and `update-state` takes its
lock on the resolved file (`<target>.lock`), so naming a link and naming its target contend for one lock.

The collector does not rank or score: judgement stays with you. It never throws on a failing source — a source
that fails becomes one `notices` entry and the rest of the pool is still written — so read the notices and carry
them into the Coverage note. **When a run is degraded the collector prints a one-line warning to stderr and still
exits `0`** — the empty-pool case below is the exception — because that is a fact to report in the digest, not an
error to fix, and the run continues with the pool it has. The warning line itself carries the very
`Collector notices: <n>` phrase the Coverage note has to carry, in the position it is printed: the phrase is
written first, and the mapped transport cause the line may repeat in parentheses follows it — so the two can be
compared without interpretation.
Its exits are `0` a pool was written, notices included; `2` the config is missing or
invalid; `3` the pool came back empty **and** at least one notice was recorded, meaning every source failed or
returned nothing usable (an empty but clean pool is still `0`); and `4` the pool could not be written — the one exit that saves the run's notices only on stderr: the write that failed is the one that would have published them, so the collector prints the run's `Collector notices: <n>` line and every notice it recorded to stderr before it names the failed destination, which is what the operator and the digest then have to work from. Those notices still reach neither the pool file nor the Coverage note a later read builds, and a pool already at the destination is left exactly as it was, so the `Collector notices: <n>` such a read finds there is an earlier run's. **An exit `4` publishes nothing of this run: fix the destination and collect again to write a pool that carries it.** The usage reserves `1` for an unexpected failure inside the collector, and no shipped source path reaches it,
because each one is isolated and degrades to a notice. On `3`,
research from what you have and say so in the digest; do not silently thin it. A source that fails twice should
be re-probed before the next run, because `fetchable` in `config/sources.md` is a record of a past probe rather
than a guarantee.

**Know a notice's boundary.** A notice describes the degradation it records — the source, the status and the
cause — and never quotes the upstream answer's text: an HTTP failure is reported as
`HTTP <status> for <redacted url>` with no excerpt of the response body, and a skipped advisory identifier or
an unreadable release version is described, never reproduced. The URL a notice names keeps its scheme, host and
path and loses its userinfo and its whole query string, so a secret embedded in a path survives that rule and
reaches the notice and the candidate's published `source`; the path is what keeps the notice diagnosable, so read
a notice as a diagnostic of a degraded source, not as proof that no secret is in it. The scrubbing of the
request's own values stays as defence in depth for the collector's own wording and the request's own values: at the
single point every notice is pushed, the request's userinfo password is removed whatever its length while a
username of under eight characters is not, the value of a parameter whose name is credential-shaped (a name
carrying a stem such as `token`, `key`, `secret` or `auth`, however it is spelled) from three characters up, a
credential header goes whole, and the credential shapes the collector recognises go too — nothing else the request
put in its URL is removed.

**Two configured bounds decide how long a notice may be.** `error_snippet_max_chars` bounds the failure text one request contributes — the shaped transport cause, or the shaped HTTP error (status and redacted request) — and the same value bounds the internal snippet the rate-limit classification reads, which is never notice text. `notice_max_chars` bounds the assembled notice whatever it carries, source included, and it splits what it has after the `': '` separator between the source the notice names — the label included, because the label is what the source starts with — and the shaped error text: the source takes the larger half, so a long target cannot push the status and the cause past the cap. The snippet bound is applied where the transport shapes the failure, the notice cap at the single push, so both hold at once and neither relaxes the other: a published notice is never longer than `notice_max_chars`, and the shaped transport failure gives way to the snippet bound alone — the request text shortened first, then dropped for the compact `request failed: <cause>`, while the cause is never cut: the shaper prices the cause against the bound before it can be shortened, and the push applies the run's own redaction and the cap against the same set, and a detail the redaction leaves too long for the cap is re-built smaller from the shaped error's own facts -- the status or the cause and the request -- rather than cut; the source gives way, to nothing if that is what it takes, and neither the redaction nor the cap ever removes the status prefix or the transport cause. The cap is checked against that bound before the first request, and the room the check reserves for the shaped error text is the other half of that split — the same room whatever label the notice carries, because the label is charged against the source's half and not against the shaped text's — so the least cap that accepts a bound of N is 2N + 2, 402 with the shipped snippet bound. What that check buys is the room the shaped text is *measured against*, and the two measurements happen where the text is shaped: the notice rewriting is a fixed point, applying it to its own output changes nothing, and every text that can reach the assembled notice has already crossed it — the source before it is bounded, and the shaped request and cause inside the shaper before their length is priced — so the source cannot hand the room back on the push's pass and the shaped text is priced at the length it survives with. The run's own redaction is part of that pricing, not a later edit to it: the shaper prices the detail at `error_snippet_max_chars` against the request's own values, and at the one seam that knows the run's union -- the transport seam in `collectAll` -- a shaped failure is re-built from those same facts against that fuller set, so the detail is bounded at the length it is published with; the source is redacted and bounded at the push, and it is the source that gives way to the detail's room, down to nothing if that is what the room takes; a detail whose facts cannot shrink it is bounded around its own reason and its own cause, never in the middle of the reason, and always as a slice of the line one pass over the whole notice produces -- the redacted source and detail are never put back together -- while the label the source starts with is the room the source keeps, so the published form names its source and carries the ': ' separator whatever the detail costs. No redaction can lengthen a text a pass published: a marker is a span no pass reads, so the published notice is a fixed point of the redaction as well as of the rewriting, and no code path charges a redaction's growth to the status or the cause. The notice rewriting is therefore never what cuts a notice, nor is the redaction; the cap is. The check itself bounds the shaped text alone: every other part of a notice — an operator-facing phrase, a message a caller built — crosses the push without a caller having priced it, and the cap is what bounds those. The shaped HTTP error has its own floor: its `HTTP <status> for ` prefix is never cut, because the status is the one thing that must never be lost, so a bound shorter than the prefix leaves the shaped text as the prefix alone — the status and a dangling `for `, naming no request — and the transport cause is the other floor, so a bound shorter than either leaves text longer than `error_snippet_max_chars`.

**The transport follows the environment.** `curl` is given no proxy option, so the run honours whatever `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` the environment sets, and a proxy stands between the collector and every source, able to observe or replace any answer. A transport failure names the request's own redacted target and a cause read from `curl`'s exit code, from the signal that ended it, or from its spawn code — a fixed phrase and the exit status, as in `could not resolve the host (curl exit 6)`, or `curl exited with status <n>` for any other code; `curl was terminated (SIGKILL)`, naming the signal, for a child the system ended without an exit status of its own; and `curl could not be started (ENOENT)`, naming the spawn code, for one that never started at all — never a diagnostic line the tool printed. Each `curl` is given 64 MiB to answer into, and an answer larger than that is cut off at the capture ceiling: that outcome is named as what became of the tool — `curl was terminated (SIGTERM) at the 64 MiB capture ceiling` — rather than as a `curl` that could not be started, because the tool ran and it was its answer that overflowed. `curl`'s line can name the host a redirect chose or the proxy the environment supplied, text the request never sent and the scrubbing above cannot remove, so the fixed cause is what keeps that name out of the notice, the pool, the coverage note and the operator line.

**The GitHub budget is the one notice with a documented remedy.** The collector discovers the live limit at run
time by probing `/rate_limit`, which GitHub documents as not consuming the core budget, so the probe is **free**
and is not part of any floor. What is charged is: one releases request per watched repository, one request per
`ghsa` advisory row (NVD rows are not GitHub requests), and, for each watched organisation, one listing request
plus up to `github_org_repos` release requests (GitHub clamps `per_page` at 100 without an error, so a larger `github_org_repos` is answered with a 100-entry page, and the page-filled report names the size of the page the answer filled rather than the size that was asked for) — the shipped watchlist is 55 repositories and 1 advisory row with
no organisation rows, so its floor is **56 of the 60 requests per hour** that `github_anonymous_hourly_limit`
records. `github_rate_limit_reserve` (2) is held back before the floor is spent, leaving 58 available and 2 spare,
and the config test in `tests/config.test.mjs` asserts that the floor still fits inside the allowance minus the
reserve — so a watchlist that outgrows the anonymous budget fails the suite rather than a run. Tag requests are
opportunistic and come out of whatever is left after the floor. A second run inside the same hour therefore finds
the budget nearly spent: the GitHub rows it cannot afford are skipped, the pool comes back without them, and a
single notice names the remaining budget, when it resets, how many rows went unchecked, and the remedy —
`set GITHUB_TOKEN to raise the limit`, or, when a token is already supplied and its budget is spent too, to wait
for the reset. Setting `GITHUB_TOKEN` in the environment (the collector also reads `GH_TOKEN`) makes the probe
report the authenticated limit instead of the anonymous one, and the settings value is never consulted at run
time. **Never record a token
value anywhere in this repository and never write one into a file here**: the token is read from the environment
only, and this repository is published whole.

**The probe is advisory, and a refusal is the authoritative reading.** The probe reports the budget for the
address the run leaves from, which on a shared egress is not this run's own allowance: it can report a fresh
limit while the charged requests are already being refused, and a full run then meets `HTTP 403` (or `429`)
bodies reading `API rate limit exceeded` instead of candidates. Do not read a healthy probe as proof the run
will be served — the first refused response is the fact that settles the matter, and the notice is what names
it. When the run stops with rows in hand, the budget notice reports the effective allowance — what the probe
reported less the reserve and the requests this run had already spent — rather than the pre-spend figure, along
with the reset time and what went unchecked; when a request is refused, that refusal makes its own notice
naming the repository or organisation and the status it answered.

### 4. Fan out

Divide the clusters of `config/domains.md` between `fanout_min_passes` and `fanout_max_passes` research
**passes** (read from `config/settings.md`), one or two clusters each, so that every core domain is researched and
every watch domain is at least scanned. A *pass* is one slice of the research: its clusters, its slice of the
pool, the ceilings, the evidence bar and the item grammar, with every field of an item filled.

**The width bounds passes, not agents.** When delegation is unavailable — a run explicitly forbidden to dispatch
subagents, or a harness with no subagent tool — execute the passes **inline, sequentially, in this session**, at
the same width. The coverage requirement is unchanged either way: every core domain researched, every watch domain
at least scanned, each quiet domain answered by its own pass rather than merged into one sweep. Never widen a
pass, never drop coverage and never change the evidence bar because delegation is unavailable; only the mechanism
changes. A pass may not invent: a field without a fetched source stays empty and the item is dropped.

### 5. Synthesise

Dedupe across passes by story key; resolve contradictions by showing both (see `reference/evidence.md`); rank
within the budget; select a featured deep dive only when the week warrants one — the criterion is in **The
evidence bar**; enforce the per-domain ceilings and the total budget from `config/settings.md`. **The total
budget is the constraint the allocation has to satisfy: a digest must meet its run's completeness floor however
many core domains came back quiet.** The floor is `total_min_items` scaled to the share of the catalogue the run
covers — `ceil(total_min_items × covered domains ÷ catalogue domains)`, clamped to between one and
`total_min_items`, and for a multi-domain run also at least one item per covered domain plus one (the rule and
its message are stated in full under **The completeness floor scales to the run's scope** below). On the shipped
settings and catalogue (`total_min_items 30`, 43 domains) an unscoped whole-catalogue run must reach **thirty**
(43 × 30 ÷ 43), a `--domain`-scoped run covering fourteen of those domains must reach **fifteen** — the scaled
share alone is ceil(30 × 14 ÷ 43) = 10, and it is the one-per-covered-domain-plus-one clause that carries it to 15
— and a single-domain run must reach **one** — so the same 29-item digest passes the floor on a fourteen-domain run
and fails it on a whole-catalogue one. The per-domain ceilings are ceilings and never targets, so when quiet domains
thin the total, take more from the domains that do have material — up to `core_max_items` each and
`watch_notable_max` across the watch domains — until the digest clears the floor; only then does the ceiling
bind. An allocation of two or three items per core, in particular, is a normal week only while the core domains
are mostly productive: on an unscoped run with seven of the fourteen core domains quiet it yields fewer than
thirty items and the gate fails the run, while four per core on the same pool passes. If the floor cannot be
reached even at the ceilings, the pool is the problem, not the allocation: say so in the Coverage note and
re-collect. Write
`tech-radar-YYYY-MM-DD.md` strictly in the grammar of `reference/output-contract.md` — every item either on one
line or on a headline line followed by indented continuation lines, with the headline and em dash on the item
line; a dated citation, exactly one provenance marker, exactly one of `#new` or `#followup`, a quiet core domain
that keeps its heading and says so, and one quiet line naming every watch domain that produced nothing. The
header's `<n> domains scanned` counts the domains in the run's scope — the keys of `plan.perDomain` — and `<m>`
counts the shipped items, so the header agrees with the scoping the gate applies. The Coverage note carries
that label verbatim **and states what the cap skipped, quoted from the plan rather than recomputed**:
`plan.skippedMs` is the time the cap removed (`0` when nothing was clipped), `plan.declared` is the floor the run
asked for, and `plan.perDomain[key]` carries the same `declared` and `skippedMs` pair per domain — so a capped run
can say which domains lost time and how much, and an uncapped run says plainly that nothing was skipped. The note
also carries the collector-notice count in the fixed line **`Collector notices: <n>`** — `<n>` is the number of
entries in the pool's `notices` array, quoted from `$DIR/.pool.json` and never recomputed or estimated. That line
is **required whenever the collector recorded at least one notice** (a rate limit, an unreachable feed, a schema
surprise — anything) and may be omitted only when the array is empty; the gate is handed the same pool and fails a
run that omits the line or states a number that does not match. The full notice texts belong on the lines after
it, so a reader can see what was degraded as well as how much.

Then write two run artifacts beside the digest. `$DIR/.items.json` is the merge input: one object per shipped
item carrying `title`, `domain` (**the catalogue key** — `ai-llm`, not `AI / LLM`), `outlet`, `primaryUrl`,
`flags` and `watch`. `$DIR/.research.json` is the provenance trail for what the research passes found: one record
per item giving where it came from (the pool, or the pass that found it by reading), the URL it was read from, the
marker, and the one-line reason it is in the digest. A collector candidate is not the same thing as a researched
item: the pool can only account for what a script fetched, so without this file an item found by reading leaves
nothing but its digest line and no later run can tell why it was included.

### 6. Gate and render

```sh
node scripts/render-html.mjs "$DIR/tech-radar-YYYY-MM-DD.md" --out "$DIR/tech-radar-YYYY-MM-DD.html"
node scripts/check-quality.mjs "$DIR/tech-radar-YYYY-MM-DD.md" --plan "$DIR/.plan.json" \
  --pool "$DIR/.pool.json" --html "$DIR/tech-radar-YYYY-MM-DD.html"
```

`--pool` is the pool the collector wrote, and it is what lets the gate check the `Collector notices: <n>` line
against the notices the run actually recorded. Every script finds its own configuration wherever you are, so none
of these commands needs `--config`. The gate
prints one line per violation and then `QUALITY: PASS` or `QUALITY: FAIL (n)`. Exit 5 means the digest
does not ship: fix the digest, never the gate, and run it again. Warnings do not fail the run but they are read —
an outlet the gate does not recognise is a source to register in `config/sources.md` or to stop citing. Only
after a pass, merge the run with the `update` command so the watermarks advance and the items enter the state.

### 7. Deliver

Present the HTML and summarise the digest's content in chat — what changed, in which domains, and which domains
were quiet — not merely the path. State the window and whether the cap was hit, and report the collector notices.

## The evidence bar

- **Exactly one provenance marker on every item**: `[prov:primary]` when the artifact itself was retrieved (a
  release, paper, specification, advisory, changelog or official post); `[prov:secondary]` for a reputable report
  of it, only when no primary is retrievable because it is paywalled, unreadable or does not exist;
  `[prov:preprint]` for arXiv or equivalent unreviewed work, never stated as established; `[prov:vendor-claim]`
  for vendor or project marketing, reported as a claim and not as a result.
- **`[src:OUTLET DATE](url)` names the source you are citing; the marker classifies that source's page.** The two
  are independent. An outlet the registry types `secondary` — 机器之心, for instance — does not force
  `[prov:secondary]`, and an outlet typed `primary` does not force `[prov:primary]`: cite the page you actually
  read and choose the marker from what *that page* is. A news outlet's own reporting is `[prov:secondary]`; the
  artifact itself — its release note, paper, specification, advisory or official post — is `[prov:primary]` even
  when the organisation behind it is a vendor. So "a story whose primary source is <outlet>" means the cited
  source is that outlet, not that the marker has to read `[prov:primary]`.
- **A dated citation on the item's own line**: `[src:OUTLET YYYY-MM-DD](https://primary)`, out to the primary
  source, plus an optional `[alt:OUTLET](https://secondary)` for corroboration. If you cannot date it, you cannot
  ship it.
- **Discovery-only hosts are for finding stories, never for citing them**: the list is `discovery_hosts` in
  `config/settings.md` (Hacker News, Lobsters, Reddit, X, Techmeme, Google News, Baidu News, V2EX, 掘金, 知乎,
  少数派, Weibo). The gate blocks a citation whose host is one of them.
- **The per-domain hype rule of `reference/evidence.md` decides when a claim may be written as a result.** In the
  listed domains a result requires independent reproduction or a shipping product; until then it is written as a
  claim and given the matching marker.
- **A week warrants a deep dive when at least one of these holds**: something changed *structurally* — a licence,
  a protocol, a default, an interface, a standard, a pricing model, an acquisition — rather than a version bump or
  a benchmark; **or** several independent sources corroborate the change rather than one vendor or one laboratory;
  **or** it affects a domain the reader works in, which is the `core` tier of `config/domains.md`. If none holds,
  write no featured section and carry the stand-in line `Nothing this week warranted a deep dive.` —
  `deep_dive: when-warranted` is a licence to omit the section, not to drop the question silently, and a quiet
  week is reported as quiet (see **Quality gate**).
- **A failing item is dropped, not repaired.** A missing item is a smaller failure than a fabricated one: never
  pad a quiet domain to look complete, and never drop one silently either.

## Language rules

The document is English — headings, coverage note and the connective prose. An item's headline and summary are
written in the language of its primary source, so a Chinese primary yields a Chinese item and it is reported as
first-class, not as a translation. Structural labels stay bilingual: every domain heading carries the `label_zh`
from `config/domains.md` (`### AI / LLM · 人工智能 / 大模型`), and the gate fails a heading that drops it. Never
machine-translate an item to make the digest look uniform, and never leave a translation in by accident: a source
registered `lang: zh` in `config/sources.md` whose item prose carries no Chinese text fails the gate, so keep both
the headline and the summary in the source's language rather than one of them.

**When the source you could not fetch is also a `lang: zh` source, the two rules collide** — its item stays
Chinese, yet a link-only source must not be written up as read. Resolve it in this order:

1. The item's language follows **the source you actually read**. Cite that source as `[src:OUTLET DATE](url)` and
   choose the marker from what its page is.
2. The unfetchable source goes in as `[alt:OUTLET](url)` with its own date, and the prose says what it contributes
   and that it was not fetched — for example, "reported by 机器之心, which is client-rendered and was not fetched".
3. If the unfetchable source is the **only** source, the item is still Chinese: cite it as
   `[src:机器之心 YYYY-MM-DD](url)`, which keeps the gate's language rule satisfied, and say in the prose what is
   verified (the outlet, the date, the headline as published) and what is not (the body, the figures, the quotes).
4. Never drop the item merely because the source could not be fetched, and never write it up as though it had
   been read.

The item still carries exactly one `[prov:…]` marker: the gate counts markers per item, so the unread source's
status is stated in prose beside its `[alt:]` link, never as a second marker.

## Quality gate

```sh
node scripts/check-quality.mjs "$DIR/tech-radar-YYYY-MM-DD.md" --plan "$DIR/.plan.json" \
  --html "$DIR/tech-radar-YYYY-MM-DD.html"
```

Exit 0 is the only shipping state. The gate fails the run when an item lacks a citation or a date, or dates
outside the window; when an item does not carry exactly one provenance marker or exactly one of `#new` and
`#followup`; when an item cites a discovery-only host; when a domain exceeds `core_max_items` or
`watch_max_items`, or when watch items exceed `watch_notable_max`; when the total falls below the run's
completeness floor or above `total_max_items`; when a core domain is missing its heading; when two items share a story
key; when a Chinese-registered source produces a Latin-only item or a domain heading is missing its bilingual
label; when the Coverage note does not contain the header's window label verbatim; when a watch domain that
produced nothing is absent from the quiet line; or when the HTML references an external asset.

**The featured section follows `deep_dive`.** `always` requires a `## Featured this week` section in every digest,
and its absence fails the run. `when-warranted` leaves the choice to the week — but a digest that carries no
featured section must carry the recorded stand-in line `Nothing this week warranted a deep dive.`, and omitting
both the section and the line fails. `never` treats a featured section as a warning, never a failure. What
*warrants* a deep dive stays a written criterion rather than a gate check: the gate can see that the section or
the stand-in line is there, not that the choice was a good one.

**The completeness floor scales to the run's scope while the ceiling stays global.** The floor is `total_min_items`
scaled by the share of the catalogue the run covers, rounded up, and for a multi-domain run also at least one item
per covered domain plus one — the greater of the scaled share and `covered + 1`, clamped to at least one and at
most `total_min_items`: a single-domain run is a probe with a floor of one, a scoped run is not failed for the
domains it never took on, an unscoped or whole-catalogue run keeps the configured floor, and near the top of the
range the clamp is what holds the floor at `total_min_items`. The per-covered-domain clause is what keeps the floor
proportional at the top of the range, where the scaled share alone would. On the shipped settings the scaled share
never exceeds the clamp — `ceil(30 × N ÷ 43)` is at most 30 for every N — so it never sets the floor on its own: a
multi-domain run's floor is `covered + 1` until that clause reaches the clamp, and from there the clamp holds it at
`total_min_items`. An unrecognised `plan.perDomain` key is counted by neither: the gate names it and scores the
floor and the scoped rules from the catalogue domains the plan actually covers. `total_max_items` never scales. The two cases read
differently in the output — `below the scoped floor of N for a run covering X of Y domains` when the run has a
scope, and the original `below total_min_items N` when it does not — so the message tells you which floor you
missed. **A failing gate means the digest does not ship** — re-cut the items, the caps, the quiet line or the
coverage note until it passes. Exit 2 means the Markdown, the plan, the config or the `--html` file could not be read: that is a path
bug, not a quality judgement.

## Common mistakes

One line each, written against the failures the skill exists to prevent:

- **An item with no publication date, or an invented one.** Every item carries a dated `[src:…]` citation and the
  gate fails any item whose date falls outside the planned window.
- **No provenance class per item**, so a fetched primary reads exactly like the model's memory. Exactly one of the
  four markers on every item, and the gate counts them.
- **No `#new` versus `#followup`**, because the run kept no state. Plan before researching and merge after
  shipping; the state's `timesSeen` decides the status, and the gate requires exactly one of the two flags.
- **A vendor claim, a preprint or a paywalled headline presented as content.** Mark it, write it as a claim, or
  drop it; the per-domain hype rule is not optional in the domains it names.
- **Quiet domains padded to look complete, or dropped silently.** A core domain keeps its heading and says it was
  quiet; every watch domain that produced nothing is named on the quiet line, and the gate checks both.
- **An item count that is a function of how the model felt.** The ceilings and the total budget come from
  `config/settings.md`, and the gate fails a run that leaves the budget.
- **An allocation that meets `core_max_items` per domain but misses the run's completeness floor.** On a week
  when several core domains are quiet, two or three items per productive core leaves an unscoped digest under
  `total_min_items` and the gate fails it: the floor — thirty on the whole catalogue, or the scope-scaled share
  of it on a `--domain`-scoped run (fifteen for fourteen of the forty-three domains) — is what the allocation
  has to satisfy, so take more from the domains that have material.
- **Five weeks of silence turned into a five-week digest with no cap and no accounting.** The plan computes and
  caps the window, and the Coverage note states what the cap skipped.
- **A format invented or negotiated with the reader** because no standing format existed. `reference/output-contract.md`
  is the format; there is nothing to negotiate, and the chat reply summarises content rather than asking for a shape.
- **An aggregator or search page used as the source** because it was where the story was seen. Discovery surfaces
  are never citable, and the gate blocks them by host.
- **A Chinese primary silently translated, or left in English by accident.** The item's language follows its primary
  source, the structural labels stay bilingual, and the gate fails a Chinese source that produced Latin-only prose.
- **The wrong artifact produced from whichever skill happens to be installed** — a daily news briefing with aspects
  and a 24-hour window. This skill's frontmatter states when it applies: a periodic technology digest or catch-up
  across domains, not single-topic research, not a news briefing, not one project's release notes.
