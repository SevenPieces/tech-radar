# Accepted limits — tech-radar

This file records the behaviour this skill **accepts rather than fixes**, with the reach measured for
each entry, so a later review — human or agent — treats them as settled decisions instead of new
findings. Read it before treating a notice or redaction observation as new.

**The rule for re-opening an entry.** A limit may be re-opened only by evidence that its recorded
reach is *understated* (for example, a spelling that reaches the shipped pool where the entry says
"notice seam only"). When that happens, correct the entry and its evidence — do not re-file the class.
Changing any accepted behaviour must change its entry here and its pin in `tests/accepted-limits.test.mjs`
in the same change.

The contract these limits qualify is stated in `docs/design.md` §3.6: **the run's own credentials are
never published** — the by-value pass removes them before any notice or candidate field is published —
while text an upstream answer supplies is cleaned on a **best-effort** basis, and the entries below are
the accepted exceptions to that best effort.

Each entry states the reach that was measured, and its executable evidence is its pin in
`tests/accepted-limits.test.mjs`. The measurement detail behind the pins belonged to the review's own
working material, which was never shipped and is no longer kept; the pins are what a later reader can
re-run.

## Decisions taken

| Date | Item | Decision |
|---|---|---|
| 2026-10-20 | A-37 / D-24 ordinary word gap | Accept as recorded. |
| 2026-10-20 | A-54 >64-run splits | Accept as recorded. |
| 2026-10-20 | A-6 all-alphabetic credentials | Accept as recorded. |
| 2026-10-20 | TR-383 curated-body over-reap | Accept as recorded. |
| 2026-10-20 | A-60 three-quote spelling | Accept and pin. |
| 2026-10-20 | A-61 two jam spellings | Accept and pin. |
| 2026-10-20 | A-59 orphan closing quote, A-62 undecoded entity | Accept both. |
| 2026-10-20 | D-13 the rule's prose cost | Accept as documented behaviour. |
| 2026-10-20 | D-12 the walker's two answers | Keep the current mixed rule. |
| 2026-10-20 | D-1 … D-8 design items | Record as accepted/deferred; no code change. |
| 2026-10-20 | Contract wording | Best-effort for upstream credential-shaped text; hard for the run's own credentials. |
| 2026-10-20 | Redaction reimplementation | Not authorised: the current rule plus this register is the accepted end state. |

## The accepted limits

### A-37 / D-24 — a credential split by an ordinary space or line end can publish in the keyless pool

**Behaviour.** The notice/redaction rule joins a split credential only across *split evidence*: control
bytes, invisible separators and entity spellings of them. An ordinary word gap (space, LF, CR, NEL, LS,
PS) is a real word boundary and ends the join, so a credential whose characters have a visible space
between them publishes the part after the gap — for example a Basic payload split after its first
group publishes the rest of the base64, and deleting the visible space reconstructs it.

**Reach.** The shipped keyless candidate pool and the digest it feeds, and the notice surface. It is
**not** the run's own credentials: the by-value pass removes those first, and the shipped configuration
carries no query parameter or userinfo on any row.

**Why accepted.** Closing it means treating an ordinary gap as split evidence, which reaps ordinary
prose — "a Bearer token1 is required" becomes "a [redacted] required" — at a measured cost of 28–45
corpus lines and roughly 2.4× the pressure-line false positives.

**Pin.** `A-37 / D-24 accepted:` in `tests/accepted-limits.test.mjs`.

### A-54 — a value split into more than 64 separator runs can publish on the notice and assembly seam

**Behaviour.** The authorization and Bearer joins stop at a bounded number of separator runs; a value
whose first digit sits past that bound, split one character per run, publishes whole. Digit-bearing
values below the bound are removed.

**Reach.** The notice and the assembled line at caps 402 and 1000. The real keyless pool is not
affected for split evidence, because the collector's own normalisation spans the separator mark.

**Pin.** `A-54 accepted:`.

### A-6 — an all-alphabetic credential publishes

**Behaviour.** The shape test treats a credential as needing a digit, a capital or a non-alphanumeric
mark. A value that is a single all-lower-case word is therefore published, unsplit and split.

**Reach.** All surfaces.

**Why accepted.** Dropping the digit requirement redacts ordinary all-letter words throughout published
prose.

**Pin.** `A-6 accepted:`.

### TR-383 — a curated-shape body split across split evidence reaps the following word

**Behaviour.** When a curated credential shape (`ghp_`, `github_pat_`, …) is split inside its body, the
join extends far enough to swallow the ordinary word after it: "a commit carried ghp_<36><separator>fix
landed" publishes "a commit carried [redacted] landed".

**Reach.** Over-removal only; no credential is published. 0 shipped corpus lines move.

**Pin.** `TR-383 accepted:`.

### A-60 — a three-quote spelling publishes the whole credential

**Behaviour.** A quoted Basic credential introduced by a run of three or more quotes is read by neither
the separated view nor the join, and publishes whole. One, two and the escaped/doubled forms are read.

**Reach.** Candidate, notice, neutralised notice, assembly at every accepted cap, and both real pool
fields. It needs an upstream answer that jams three or more quotes before a base64 payload.

**Pin.** `A-60 accepted:`.

### A-61 — two constructed quote-jam spellings publish whole

**Behaviour.** `release: Basic \" \"<base64>\" and prose` (a second quote where the payload must
start) publishes the payload, and so does a single quote wrapping an escaped double pair.

**Reach.** Candidate, notice, assembly; the same contrived spellings as A-60.

**Pin.** `A-61 accepted:`.

### A-59 — an orphan closing quote stands after a removed payload

**Behaviour.** When an unquoted payload is followed by a closing quote, the payload is removed and the
quote is left published ("Basic [redacted]\""). Reaping the quote would delete the closing quote of an
enclosing quotation ("… said \"Authorization: Basic <payload>\"").

**Reach.** Cosmetic; no credential is published.

**Pin.** `A-59 accepted:`.

### A-62 — an undecoded entity in an upstream summary

**Behaviour.** An entity reference outside the separator vocabulary (for example `&mdash;`) is left as
text in a candidate field.

**Reach.** Cosmetic; no credential is published.

**Pin.** `A-62 accepted:`.

### D-13 — the rule's prose cost

**Behaviour.** A published sentence that literally spells a credential-header name loses its tail:
"Authorization: Basic abcdefgh and then prose" becomes "[redacted]", and "authorization: token rotation
is scheduled" becomes "[redacted]". This is the price of consuming a credential header's whole value
instead of guessing where it ends.

**Reach.** Notices and candidate prose; no credential is published by the rule that causes it.

**Pin.** `D-13 accepted:`.

### D-12 — the publication walk's two answers

**Behaviour.** A git-less tree and a git-answered tree can disagree about a file whose name looks like a
run artifact. The current rule keeps the mixed answer: a lock or a temp is dropped by the fallback only
when it can be shown not to be tracked, while a fixed run-artifact name is dropped by name.

**Reach.** The suite's publication guard only; the walker is imported by tests, never by a run.

**Pin.** The fixtures in `tests/hygiene.test.mjs`.

## Deferred design items (no code change)

These are design calls, not defects; they stay open for a future decision:

1. The quality gate's failure list (design §4.4) omits "a deep dive with no featured section".
2. The "200–350 words" deep-dive quantity is prose, while the design's own rule says every quantity is configuration.
3. The GitHub token is visible in the process table while a request is in flight (documented in the README).
4. The watchlist is sized against the GitHub request floor, not the tags phase.
5. The settings-group list does not name `notice_max_chars`.
6. The collector creates its destination directory while the other writers do not.
7. The lock record stores a hostname only it reads.
8. A credential embedded in a path segment can be published.

## What is not in this file

Nothing else is accepted. A behaviour not listed above is a defect: fix it, or - if fixing it costs more
than the behaviour is worth - measure its reach, record it here with a pin, and only then treat it as
settled. An entry never becomes permanent by age; it is re-opened by the rule stated at the top.
