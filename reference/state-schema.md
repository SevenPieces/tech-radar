# State schema

`tech-radar-state.json` sits beside the digests and is the only memory the skill keeps between runs. It is
written by `scripts/update-state.mjs` and read by nothing else. The shape below is exactly what `emptyState()`
and `mergeRun()` produce.

## Shape

```json
{
  "version": 1,
  "updatedAt": "2026-09-23T01:00:00.000Z",
  "domains": {
    "ai-llm": { "lastCoveredAt": "2026-09-23T01:00:00.000Z", "lastRunAt": "2026-09-23T01:00:00.000Z" },
    "quantum": { "lastCoveredAt": null, "lastRunAt": null }
  },
  "items": {
    "3f2a91c07d4b": {
      "key": "3f2a91c07d4b",
      "title": "vLLM v0.11.0 released",
      "domain": "ai-llm",
      "outlet": "GitHub",
      "primaryUrl": "https://github.com/vllm-project/vllm/releases/tag/v0.11.0",
      "firstSeen": "2026-09-16T01:00:00.000Z",
      "lastSeen": "2026-09-23T01:00:00.000Z",
      "timesSeen": 2,
      "flags": ["new"]
    }
  },
  "watchlist": [
    {
      "key": "3f2a91c07d4b",
      "title": "vLLM v0.11.0 released",
      "firstSeen": "2026-09-16T01:00:00.000Z",
      "lastSeen": "2026-09-23T01:00:00.000Z",
      "timesSeen": 2
    }
  ],
  "runs": [
    {
      "date": "2026-09-23",
      "entry": "weekly",
      "window": { "since": "2026-09-16T01:00:00.000Z", "until": "2026-09-23T01:00:00.000Z" },
      "domains": ["ai-llm", "quantum"],
      "items": 38
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `version` | Always `1`. Every merge writes it. |
| `updatedAt` | ISO instant of the last merge; `null` in a state that has never been merged. |
| `domains` | One entry per key in `config/domains.md`. A missing state file is loaded as an empty state carrying every key, so `plan` reads that map without writing anything; the file — and with it the map — is first **persisted by the first `update`**, which also advances the watermarks of the domains the run covered. `lastCoveredAt` is the watermark the window rule reads; `lastRunAt` records the last run that touched the domain. Both are ISO instants or `null`. |
| `items` | Sighting history keyed by the 12-hex story key, never by title. |
| `watchlist` | Unresolved developing stories, each with the same key and its own counters. |
| `runs` | The run log, appended and sliced to `runs_history_max` (oldest entries fall off the front). A missing or non-positive `runs_history_max` is a configuration error that fails the merge (exit 2) rather than silently disabling the cap. |

An `items` entry carries `firstSeen` (preserved across sightings), `lastSeen` (rewritten every merge),
`timesSeen` (incremented every merge), `domain`, `outlet`, `primaryUrl` and `flags` (the flags array from the
curated item, defaulting to `[]`). The `title` is stored as given, not normalised — normalisation happens only
to compute the key.

`domain` is the catalogue **key** (`ai-llm`), never the English `domain` name (`AI / LLM`): keys are the state's
representation, and the English name exists to build a `### ` heading. The boundary is `resolveDomainKey()`,
which accepts either a key or the English name and stores the key; anything else throws and the CLI exits 3, so a
typo fails the run instead of entering the state as an unrecognised domain. The input contract for `.items.json`
is in `reference/output-contract.md`.

Why an item was included is deliberately **not** state: it belongs to the run, in `.research.json`
(`reference/output-contract.md` §Run artifacts), which is rewritten each run rather than accumulating.

## The window rule

`update-state.mjs plan` prints, and mutates nothing:

```json
{
  "since": "2026-09-16T01:00:00.000Z",
  "until": "2026-09-23T01:00:00.000Z",
  "window": { "since": "2026-09-16T01:00:00.000Z", "until": "2026-09-23T01:00:00.000Z" },
  "declared": "2026-09-16T01:00:00.000Z",
  "skippedMs": 0,
  "capped": false,
  "perDomain": {
    "ai-llm": { "since": "…", "until": "…", "declared": "…", "skippedMs": 0 }
  },
  "label": "Covering 2026-09-16 09:00 to 2026-09-23 09:00 (Asia/Shanghai) · cap not hit"
}
```

Per domain, in this order:

1. **Declared start** — the domain's own `lastCoveredAt` if it has one; otherwise the `--since` floor when the run
   passes one; otherwise `now` minus `first_run_days` from `config/settings.md`.
2. **The cap binds.** The declared start is raised to `now` minus `window_cap_weeks` when it is older, and the
   plan records both sides: `perDomain[key].declared` is what the domain asked for, `perDomain[key].skippedMs` is
   how much the cap removed from it (`0` when it was not clipped), `skippedMs` at the top level is the largest clip
   in the run, and `capped` is exactly `skippedMs > 0`. A start sitting exactly on the cap is **not** clipped, so
   nothing was dropped and the run is not capped.
3. **The run window** is the earliest resulting start across the planned domains, to `now`; `declared` at the top
   level is the earliest declared start, before any clamping.

`skippedMs` is what the Coverage note quotes: it is the only record of how much time the cap removed, so the note
states what was skipped instead of recomputing it from dates. A run with `capped: false` has `skippedMs: 0` and
says the cap removed nothing.

**`--since` is a widening bound, never a narrowing one.** With a watermark the start is the earlier of the
watermark and the floor, so a catch-up can pull a start back but can never skip ahead of what a domain has already
covered; with no watermark the floor replaces the `first_run_days` reach, which on a fresh state file is every
domain. The chosen start is then clamped by the cap exactly as any other start is, so a catch-up cannot claim
coverage the cap forbids. Domain keys in `--domains` are validated against the catalogue: an unknown
key is a typo and exits 2 rather than producing an empty plan.

`label` is built with `Intl` in the configured timezone as
`Covering YYYY-MM-DD HH:mm to YYYY-MM-DD HH:mm (<timezone>) · cap hit|not hit`, while `since` and `until` are
ISO UTC. The label is what the digest header and the Coverage note repeat verbatim.

## The story key

```text
key = sha256( normalizeTitle(title) + "|" + hostOf(primaryUrl) ).slice(0, 12)
```

`normalizeTitle` lowercases the headline and replaces every run of characters outside `[a-z0-9\u4e00-\u9fff]`
with a single space, then trims — so punctuation, spacing and case changes to a headline do not create a second
story, and a CJK headline keeps its characters. `hostOf` reduces the URL to its host with a leading `www.`
stripped. The key is 12 lowercase hex characters.

A key already present in `items` means the story was seen before: the merge returns `status: "followup"` and
increments `timesSeen`. A key not present returns `status: "new"`. That result — not the model's memory — is
what decides `#new` versus `#followup` in the digest.

## Watermarks: weekly, catch-up and focus

- **Weekly** (`update` with no `--domains`): covers every configured domain, advances every watermark, and is
  logged with `entry: "weekly"`.
- **Focus** (`update --domains a,b`): covers and advances only the named domains, and the run is logged with
  `entry: "focus"`. A focus run therefore does not consume a domain's week.
- **Catch-up** (`update --since <ISO>`): takes the explicit floor for the window; whether it advances one
  watermark or all of them is decided **only** by whether `--domains` was also passed, and its run log entry is
  `focus` when it was and `weekly` when it was not. A catch-up run that covers every domain therefore advances
  every watermark, which is correct only when it really did cover them.

The run log records the window the run actually had: `window` is filled in from the same `planWindows` call
only when `--since` was passed, and is `null` otherwise. Nothing in the state can claim coverage a run did not
have.

**A run is recorded once.** Before merging, `update` compares the `--date` and the covered domain set against
`runs`; an exact match is refused with exit 2 and nothing is merged. That catches a repeated delivery of one run
while still letting a focus run, or the same domains on another date, through. If you need to re-merge after a
failed attempt, change the date or narrow the run with `--domains` — do not edit the state by hand.

## Retention

Retention is measured against the same cap, so nothing inside a possible window is ever lost:

- **Items** are deleted after a merge when `now - lastSeen` exceeds `window_cap_weeks`. A story sighted this week
  survives; a story unseen for longer than the cap cannot fall inside any future window and is forgotten.
- **Watchlist entries** are dropped when `now - lastSeen` exceeds `window_cap_weeks` **or** when
  `now - firstSeen` exceeds `watchlist_retention_weeks` — whichever comes first, because both bounds must hold
  for an entry to survive. With the shipped values (4 weeks each) they coincide; change either in
  `config/settings.md` and the tighter bound governs. An item can leave `items` and the watchlist by different
  paths, because the watchlist also ages from `firstSeen`.

## CLI

```sh
update-state.mjs plan   --state <path> [--domains a,b] [--since ISO] [--config <dir>]
update-state.mjs update --state <path> --items <path> --out <path> --date YYYY-MM-DD
                        [--domains a,b] [--since ISO] [--config <dir>]
```

- `--state` defaults to `tech-radar-state.json` in the working directory; pass the resolved digest directory
  explicitly. A missing state file is a first run, not an error.
- `--items` is a JSON **array** of curated items: `{ title, domain, outlet, primaryUrl, flags?, watch? }`,
  where `domain` is the catalogue key (an English `domain` name is accepted at the boundary and resolved to its
  key). Extra fields are ignored by the merge and do not enter the state. `watch: true` puts the story on the
  watchlist as well as in `items`.
- `update` prints `{ "updated": "<path>", "results": [ { "key": "…", "status": "new" | "followup" } ] }`.
- `--config <dir>` overrides the configuration directory; the default is the `config/` directory beside the
  script, so these commands work from any working directory.
- Exit codes: `0` OK; `2` usage error, unknown flag, invalid `--since`, unknown domain key, an unreadable config,
  state or items file, or a run that is already recorded for that date and domain set; `3` the items file is not an
  array, or an item failed validation (its `domain` is neither a catalogue key nor a catalogue name); `4` the
  output could not be written. The usage also documents `1` as fatal, but the CLI as built never returns it —
  every handled failure is 2, 3 or 4.
