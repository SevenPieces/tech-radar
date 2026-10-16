# Settings

Every quantity and policy lives here, so no script and no document hardcodes one.

| key | value | note |
|---|---|---|
| timezone | Asia/Shanghai | All window labels and dates are rendered in this zone |
| window_cap_weeks | 4 | A weekly run reaches back at most this far |
| watchlist_retention_weeks | 4 | How long an unresolved developing story stays on the watchlist |
| runs_history_max | 52 | Runs kept in the state file's run log |
| first_run_days | 7 | Window used when a domain has never been covered |
| core_max_items | 4 | Per-domain ceiling; 2-3 is a normal week, and the ceiling is not a target |
| watch_max_items | 2 | Per-domain ceiling for a promoted watch domain |
| watch_notable_max | 8 | Total items from watch domains per run |
| total_min_items | 30 | Below this the gate fails the run |
| total_max_items | 45 | Above this the gate fails the run; this is the ceiling that binds |
| fanout_min_passes | 4 | Fewest research passes |
| fanout_max_passes | 8 | Most research passes; one cluster each with room to spare |
| deep_dive | when-warranted | One of: when-warranted, always, never |
| output_dir | ./tech-radar | Pool and digest directory, resolved against the working directory; the TECH_RADAR_DIR environment variable overrides it |
| github_releases_per_repo | 10 | Releases requested per repository or organisation |
| github_anonymous_hourly_limit | 60 | GitHub's documented anonymous core allowance per hour; the collector discovers the live limit from its own probe at run time rather than trusting this value, which exists so the watchlist budget can be checked in tests |
| github_rate_limit_reserve | 2 | GitHub core requests held back from the releases block, so the advisory block still has budget |
| github_org_repos | 10 | Repositories taken from one watched organisation, most recently updated first. GitHub clamps `per_page` at 100 without an error, so a larger value is answered with a 100-entry page; the page-filled report compares against that ceiling rather than against this value, and a listing that filled the page is reported at the size of the page GitHub enforces |
| github_tags_per_repo | 5 | Tags requested per repository whose releases produced no candidate |
| arxiv_max_results | 40 | Entries requested per arXiv category listing |
| ghsa_page_size | 50 | Advisories requested per GitHub advisory page |
| nvd_severity | HIGH | CVSS v3 severity filter sent to the NVD API |
| request_timeout_ms | 20000 | Longest a single request may take before curl gives up |
| title_max_chars | 200 | Longest candidate title kept once upstream markup is stripped |
| summary_max_chars | 400 | Longest candidate summary kept once upstream markup is stripped |
| error_snippet_max_chars | 200 | Longest text a notice carries for a failed request: a transport cause shaped from curl's exit code, from the signal that ended the tool, or from its spawn code, or the shaped HTTP error (status and redacted request). An upstream response body is never quoted. The transport half gives way with the request first: the redacted request is shortened to the room that is left, then dropped for the compact 'request failed: <cause>', and a value too small even for that carries the cause alone rather than cutting it, so this bound can shorten a transport text but cannot remove its cause. The HTTP half cannot be bounded below the 'HTTP <status> for ' prefix, because the status is the one thing that must never be lost, so a value shorter than that prefix leaves the shaped text as the prefix alone -- the status and a dangling 'for ', naming no request -- and the same value bounds the internal snippet the rate-limit classification reads from that body, where a very small value can hide a rate-limit refusal |
| notice_max_chars | 1000 | Longest a collector notice may be once it is assembled. A notice is the source it names -- the label included, because the label is what the source starts with -- the two-character ': ' separator, and the shaped error text; after the separator the source takes the larger half of what is left, so a long target cannot push the status or the cause past the cap. The accepted range is 128 to 100000, and error_snippet_max_chars narrows it: the shaped error text's half must carry the whole of what that bound produces, and because the label is charged against the source's half rather than against the shaped text's, that room is the same whatever label the notice carries, so this cap must be at least twice error_snippet_max_chars plus two -- 402 with the shipped snippet bound. The check prices the text the shaper will actually produce and the notice the push will publish: the notice rewriting is a fixed point, both the source and the shaped text cross it before this cap and that bound are measured against them, and the run's own redaction is applied to each part before either is bounded -- against the run's whole union wherever it is known, so no later pass can lengthen a detail that was already priced. The source is the part that gives way: it is redacted and bounded first and it yields to the detail's room, so the overflow a redaction of the source can make is charged to the source's half and never to the tail the status and the cause sit in, and the detail is bounded at the length it is published with. A detail the redaction leaves longer than the room this cap gives it is re-built smaller from the shaped error's own facts at the push -- the collector hands the shaped error itself for exactly this -- rather than cut, and the reason the detail leads with is the part of it a cap may never remove; where a detail carries no shaped facts to re-price, the source gives way before the detail is touched, and what is bounded is the whole line with both ends of the detail kept. The snippet bound never cuts the transport cause away, because the shaper drops the request text before the cause. A value below 128, above 100000, or too small for error_snippet_max_chars is refused as a named configuration error |
| discovery_hosts | news.ycombinator.com, lobste.rs, reddit.com, x.com, twitter.com, techmeme.com, news.google.com, news.baidu.com, v2ex.com, juejin.cn, zhihu.com, sspai.com, weibo.com | Discovery surfaces; never citable as the source |
| short_max_chars | 18 | Longest navigation chip label kept; a longer one is clipped at a word boundary |
| user_agent | tech-radar/1.0 | Sent on every request so sources can identify the client |
