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
| github_org_repos | 10 | Repositories taken from one watched organisation, most recently updated first |
| github_tags_per_repo | 5 | Tags requested per repository whose releases produced no candidate |
| arxiv_max_results | 40 | Entries requested per arXiv category listing |
| ghsa_page_size | 50 | Advisories requested per GitHub advisory page |
| nvd_severity | HIGH | CVSS v3 severity filter sent to the NVD API |
| request_timeout_ms | 20000 | Longest a single request may take before curl gives up |
| title_max_chars | 200 | Longest candidate title kept once upstream markup is stripped |
| summary_max_chars | 400 | Longest candidate summary kept once upstream markup is stripped |
| error_snippet_max_chars | 200 | Longest text a notice carries for a failed request: a transport cause shaped from curl's exit code, or the whole shaped HTTP error (status and redacted request); an upstream response body is never quoted. The bound is exact for the transport half too, and the same value also bounds the internal snippet the rate-limit classification reads from that body, so a value no longer than the 'HTTP <status> for ' prefix leaves the shaped text as the status alone and a very small one can hide a rate-limit refusal |
| notice_max_chars | 1000 | Longest a collector notice may be once it is assembled; the source a notice names takes at most half of it, so a long target cannot push the status or the cause past the cap. The accepted range is 128 to 100000: below 128 the source's half leaves no room for the separator and the longest fixed transport cause, and above 100000 the cap bounds nothing an assembled notice could contain, so either end is refused as a named configuration error |
| discovery_hosts | news.ycombinator.com, lobste.rs, reddit.com, x.com, twitter.com, techmeme.com, news.google.com, news.baidu.com, v2ex.com, juejin.cn, zhihu.com, sspai.com, weibo.com | Discovery surfaces; never citable as the source |
| short_max_chars | 18 | Longest navigation chip label kept; a longer one is clipped at a word boundary |
| user_agent | tech-radar/1.0 | Sent on every request so sources can identify the client |
