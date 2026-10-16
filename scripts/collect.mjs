#!/usr/bin/env node
// scripts/collect.mjs
// Collector CLI and orchestration for the tech-radar skill.
// Produces the candidate pool of design §4.1 from config/watchlist.md. It never
// ranks or scores: judgement stays with the agent. A failing source becomes a
// notice, never a thrown error and never a silent skip.
import { randomBytes } from 'node:crypto';
import {
  accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig } from './lib/mdtable.mjs';
import {
  fetchText, hostOf, isDiscoveryOnly, splitItems, field, atomLink, plainText, redactUrl,
  neutraliseMarkers, neutraliseLinkSeams, neutraliseUrl, redactSecrets, requestSecrets,
  requestSecretSets, neutraliseTagSpans, neutraliseEntityTags,
} from './lib/net.mjs';

// The collector must work from any working directory, so the default configuration
// is the skill's own config/ beside this script, not a path relative to the caller's
// cwd. --config still overrides it.
const DEFAULT_CONFIG = fileURLToPath(new URL('../config/', import.meta.url));

// One base for every GitHub endpoint the collector uses, the rate-limit probe included.
const GITHUB_API = 'https://api.github.com';

// An upstream body is arbitrary bytes, and Node quotes the offending character in the
// message it raises for a JSON parse failure, so a notice built from that message used to
// carry a raw ESC (or NUL, or BS) into stdout, stderr and the published pool. Every notice
// is normalised at the single push: a whitespace control becomes a space, every other C0,
// C1 and DEL byte is dropped, the marker vocabulary and the markdown link syntax the
// renderers trust are neutralised -- SKILL.md requires the notices to be carried into the
// published Coverage note, so a notice is published text -- and the text is bounded so one
// hostile response cannot become an unbounded notice.
//
// The request's own credential is removed here too, at the one boundary every notice crosses.
// The transport shapers redact the messages they build, but the shapers are not the only
// source of a notice: a JSON parse failure is raised by Node with the head of the body in its
// message, and any fetch implementation can throw whatever it likes, so the guarantee lives at
// the push. A caller that knows the request passes its secret list (requestSecrets); a notice
// that quotes nothing the request sent needs none.
const NOTICE_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const NOTICE_MAX_CHARS = 1000;
function sanitizeNotice(text) {
  // The tag shape is the one class a notice cannot carry: a notice is published verbatim in the
  // Coverage note, and a Markdown reader draws a live anchor or fetches a remote image from
  // upstream markup that reached the text. It is neutralised here, at the one push every notice
  // crosses, whatever built the notice -- a transport shaper, a caller's own wording, or a thrown
  // message that quotes a server answer -- because the per-site normalisation above is a property
  // of two callers rather than of the boundary. The '<' opens the tag, so replacing exactly it
  // ends the markup while the rest of the span stays legible, and only a span the shape rule
  // reads is touched: a legitimate server message that says 'a < b' or 'see <id>' is returned
  // byte-identical. The encoded spelling of the same opener is the second half of the class: a
  // notice is never decoded, so '&lt;a href=...&gt;' was published as the anchor it spells.
  // neutraliseEntityTags refuses that spelling before the literal rule runs, and both rules are
  // the ones the candidate normaliser draws too, so the two boundaries cannot drift apart
  // (TR-122, TR-123).
  const spaced = neutraliseTagSpans(neutraliseEntityTags(
    String(text).replace(NOTICE_CONTROLS, (ch) => (/\s/.test(ch) ? ' ' : '')),
  ));
  // The markdown link seam belongs to this path and not to the neutraliser a candidate field
  // uses: a notice is published verbatim in the Coverage note, while a release body's links are
  // ordinary Markdown that the pool has to keep.
  return neutraliseLinkSeams(neutraliseMarkers(spaced)).slice(0, NOTICE_MAX_CHARS);
}
function pushNotice(notices, text, secrets) {
  notices.push(sanitizeNotice(redactSecrets(text, secrets)));
}

// TR-99: a notice is redacted at the push against the request that produced it, and a shared
// host can echo a value that a different watchlist row sent. The union below is the secrets of
// every row a collector issues requests for, built with the same requestSecrets the per-request
// push uses, so the floor that keeps a harmless word of free text readable still applies. A row
// that never produces a notice of its own still protects its value in a notice another row
// pushes.
function rowsSecrets(rows, headers) {
  const out = new Set();
  for (const row of rows) {
    for (const secret of requestSecrets(row.target, headers)) out.add(secret);
  }
  return [...out];
}

// The notices as they are published: each one redacted against the union above as well as
// against its own request's secrets, which the push already removed. Applying it again is
// idempotent - a value that is gone stays gone - and the notice keeps the host and the reason
// it exists, so it stays diagnosable.
function redactNotices(notices, secrets) {
  const out = [];
  for (const notice of notices) pushNotice(out, notice, secrets);
  return out;
}

// A response that will not parse is shaped here rather than quoted: Node's SyntaxError carries
// the head of the body (or the ten characters around the error position) in its message, and
// which part of a credential that slice holds is the parser's choice, so no by-value redaction
// can identify it. The notice names the endpoint and says the answer was not JSON, which is
// what a reader of a degraded source needs, and the body never reaches the notice at all.
function parseJson(text, url) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`the response was not JSON (${redactUrl(url)})`);
  }
}

// The Go module proxy protocol case-encodes a module path: every uppercase letter is
// written as '!' followed by its lowercase form, so github.com/BurntSushi/toml is
// requested as github.com/!burnt!sushi/toml. Probed live: unescaped 404 "invalid
// escaped module path", escaped 200.
function goModulePath(path) {
  return String(path).replace(/[A-Z]/g, (ch) => `!${ch.toLowerCase()}`);
}

const USAGE = `usage: collect.mjs [options]

  --config <dir>    configuration directory (default: the skill's own config/)
  --since <DATE>    window start, inclusive (default: now - window_cap_weeks)
  --until <DATE>    window end, inclusive (default: now)
  --out <path>      candidate pool JSON (default: $TECH_RADAR_DIR/.pool.json,
                    else <output_dir>/.pool.json from config/settings.md)
  --domain a,b      restrict collection to these domain keys
  --timeout <ms>    per-request timeout (default: request_timeout_ms from
                    config/settings.md)
  --human           print a one-screen summary instead of the JSON
  -h, --help        print this usage and exit

Exit codes: 0 OK, 2 config not found, invalid or empty, 3 the pool came back empty
and at least one notice was recorded, 4 output could not be written. 1 is reserved for an
unexpected failure inside the collector; no shipped source path reaches it.`;

export function parseArgs(argv) {
  const known = new Set(['--config', '--since', '--until', '--out', '--domain', '--human', '--timeout']);
  const out = {
    config: DEFAULT_CONFIG, since: null, until: null, out: null,
    domain: null, human: false, timeout: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!known.has(a)) throw new Error(`unknown flag: ${a}`);
    if (a === '--human') { out.human = true; continue; }
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    i += 1;
    if (a === '--config') {
      // join('', 'domains.md') degrades to a cwd-relative path, so an empty value would
      // silently resolve the configuration against the working directory.
      if (String(v).trim() === '') throw new Error('empty value for --config');
      out.config = v;
    }
    else if (a === '--since' || a === '--until') {
      const at = new Date(v);
      if (Number.isNaN(at.getTime())) throw new Error(`invalid ${a}: ${v}`);
      // Stored normalised: the window is compared as instants, never as raw strings, so
      // an offset-bearing spelling cannot filter differently from its Z spelling.
      out[a === '--since' ? 'since' : 'until'] = at.toISOString();
    }
    else if (a === '--out') {
      if (String(v).trim() === '') throw new Error('invalid --out: expected a path');
      out.out = v;
    }
    else if (a === '--domain') {
      const domains = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (domains.length === 0) throw new Error('invalid --domain: expected at least one domain key');
      out.domain = domains;
    } else if (a === '--timeout') {
      const ms = v.trim() === '' ? NaN : Number(v);
      if (!Number.isFinite(ms) || ms <= 0) throw new Error(`invalid --timeout: ${v}`);
      out.timeout = ms;
    }
  }
  return out;
}

function flag(argv, name) {
  return argv.includes(name);
}

// The numeric settings are validated once, before the first request, against the rows the
// run will actually read. A mistyped row is then a configuration error that names the
// setting (exit 2) instead of a degraded week carrying a script-internal message in the
// notice stream, and a configuration that carries only what its own rows need stays legal.
// update-state.mjs validates its own settings the same way. The reserve may be zero; every
// other quantity must be a positive integer.
const SOURCE_SETTINGS = {
  rss: ['title_max_chars', 'summary_max_chars', 'error_snippet_max_chars'],
  'arxiv-category': ['arxiv_max_results', 'title_max_chars', 'summary_max_chars', 'error_snippet_max_chars'],
  'github-repo': ['github_releases_per_repo', 'github_tags_per_repo', 'title_max_chars', 'summary_max_chars', 'error_snippet_max_chars'],
  'github-org': ['github_org_repos', 'github_releases_per_repo', 'github_tags_per_repo', 'title_max_chars', 'summary_max_chars', 'error_snippet_max_chars'],
  ghsa: ['ghsa_page_size', 'summary_max_chars', 'error_snippet_max_chars'],
  nvd: ['summary_max_chars', 'error_snippet_max_chars'],
  npm: ['error_snippet_max_chars'],
  pypi: ['error_snippet_max_chars'],
  crates: ['error_snippet_max_chars'],
  gomod: ['error_snippet_max_chars'],
};

// The keys this run will read: what main resolves before it dispatches, plus what the
// selected rows' sources read. A configuration that carries only the settings its own rows
// need stays legal.
function requiredSettingKeys(rows, options) {
  const keys = new Set();
  if (!options.since) keys.add('window_cap_weeks');
  if (!options.timeout) keys.add('request_timeout_ms');
  for (const row of rows) {
    for (const key of SOURCE_SETTINGS[row.kind] ?? []) keys.add(key);
  }
  return keys;
}

function validateSettings(settings, rows, options) {
  for (const key of requiredSettingKeys(rows, options)) {
    const n = Number(settings?.[key]);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${key} is missing or invalid in config/settings.md`);
    }
  }
  const github = rows.some((r) => r.kind === 'github-repo' || r.kind === 'github-org');
  const reserve = Number(settings?.github_rate_limit_reserve);
  if (github && (!Number.isInteger(reserve) || reserve < 0)) {
    throw new Error('github_rate_limit_reserve is missing or invalid in config/settings.md');
  }
  return settings;
}

// The pool lands beside the digest. The environment override wins over the
// configured directory; an empty TECH_RADAR_DIR is not a usable directory, hence
// || rather than ??. Resolving this after readConfig is what lets the default come
// from configuration instead of a literal.
export function resolveOut(options, settings) {
  if (options.out) return options.out;
  // The documented precedence: the environment override decides the directory, then
  // output_dir from the configuration. An exported-but-empty variable is not a usable
  // directory, so it falls through, and only then is a missing output_dir the named exit 2
  // that every other missing setting produces (a settings file without the row reached
  // join() as undefined and left main() with an uncaught TypeError and a stack trace).
  const override = String(process.env.TECH_RADAR_DIR ?? '').trim();
  if (override !== '') return join(override, '.pool.json');
  if (settings.output_dir === undefined || String(settings.output_dir).trim() === '') {
    throw new Error('output_dir is missing or invalid in config/settings.md');
  }
  return join(settings.output_dir, '.pool.json');
}

// The per-request timeout is configuration too: an explicit --timeout wins, otherwise
// request_timeout_ms decides, and a settings file that omits it is a configuration
// error rather than a silent twenty seconds.
export function resolveTimeout(options, settings) {
  if (options.timeout) return options.timeout;
  const ms = Number(settings.request_timeout_ms);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error('request_timeout_ms is missing or invalid in config/settings.md');
  }
  return ms;
}

// The default reach-back is configuration, never a literal: window_cap_weeks is the
// only source of it, so a settings file that omits it is a configuration error
// rather than a silent four weeks.
export function windowStart(settings, now) {
  const weeks = Number(settings.window_cap_weeks);
  if (!Number.isFinite(weeks) || weeks <= 0) {
    throw new Error('window_cap_weeks is missing or invalid in config/settings.md');
  }
  return new Date(now.getTime() - weeks * 7 * 24 * 3600 * 1000).toISOString();
}

export function sortCandidates(list) {
  const seen = new Set();
  return list
    .filter((c) => c && c.url && !seen.has(c.url) && seen.add(c.url))
    // Dated candidates first, newest first, undated leads last: String(null) sorts after
    // every ISO date, which used to put the least informative material at the head of the pool.
    .sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return String(b.publishedAt).localeCompare(String(a.publishedAt));
    });
}

async function runSource(name, rows, fn, ctx, acc) {
  if (rows.length === 0) return;
  try {
    const res = await fn(rows, ctx);
    acc.candidates.push(...res.candidates);
    acc.notices.push(...(res.notices ?? []));
  } catch (err) {
    // No request is in scope here: a failure that escapes a whole source is not a request's
    // answer, and the per-request notices the source pushed already carried their own secrets.
    pushNotice(acc.notices, `${name}: ${err.message}`);
  }
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// A 403 or 429 whose answer names the rate limit is the server saying the allowance is spent.
// A repository that is merely forbidden answers with its own message, so the text has to name
// the limit to count. The shaped HTTP error's message names the status and the redacted URL and
// quotes no answer text, so the bounded, tag-stripped snippet on its internal body field is what
// this classification reads; that field is never interpolated into a notice.
function isRateLimitRefusal(err) {
  const status = Number(err?.httpStatus);
  if (status !== 403 && status !== 429) return false;
  return /rate limit/i.test(String(err?.body ?? '')) || /rate limit/i.test(String(err?.message ?? ''));
}

export async function collectGithub(rows, ctx) {
  const candidates = [];
  const notices = [];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const s = ctx.settings;
  const reserve = Number(s.github_rate_limit_reserve);
  if (!Number.isFinite(reserve) || reserve < 0) {
    throw new Error('github_rate_limit_reserve is missing or invalid in config/settings.md');
  }
  const get = (url) => ctx.net.fetchText(url, ctx.timeout, headers, s.user_agent, s.error_snippet_max_chars);
  // The request's own secrets, for the notice boundary: every call in the block can quote the
  // server's answer in a notice, and the header this path sends is never in the URL.
  const secretsFor = (url) => requestSecrets(url, headers);
  // Probe the budget once, before the block: one free call instead of discovering an
  // exhausted limit once per row, 55 times over.
  let budget;
  const probeUrl = `${GITHUB_API}/rate_limit`;
  try {
    budget = coreBudget(parseJson(await get(probeUrl), probeUrl));
  } catch (err) {
    pushNotice(notices, `github: rate limit could not be checked (${err.message}); ${uncheckedPhraseFor(rows)}`, secretsFor(probeUrl));
    return { candidates, notices: redactNotices(notices, rowsSecrets(rows, headers)) };
  }
  if (budget.remaining === null) {
    pushNotice(notices, `github: rate limit could not be checked (the probe reported no core budget); ${uncheckedPhraseFor(rows)}`);
    return { candidates, notices: redactNotices(notices, rowsSecrets(rows, headers)) };
  }
  // The budget is spent in requests, in a fixed order: one listing per organisation,
  // then one releases request per repository, then one tags request for each
  // repository whose releases produced nothing.
  const left = { value: Math.max(0, budget.remaining - reserve) };
  const charged = { count: 0 };
  const spend = () => { if (left.value <= 0) return false; left.value -= 1; charged.count += 1; return true; };
  const shortfall = { repos: 0, orgs: 0, tags: 0 };
  // The probe is advisory and a refusal is the authoritative reading: the allowance is keyed to
  // the address the run leaves from, and on a shared egress the probe can report a full budget
  // while the charged requests are already refused. The first refusal that names the limit
  // therefore ends the block's spending, and the notice below reports the effective allowance it
  // observed (zero) with what went unchecked, instead of the pre-spend figure.
  const refusals = { count: 0 };
  const refused = (err) => {
    if (!isRateLimitRefusal(err)) return false;
    refusals.count += 1;
    left.value = 0;
    return true;
  };

  // Phase 0 -- organisations. /orgs/{org}/releases does not exist (probe 2026-09-23:
  // 404 Not Found where the repo endpoint answers 200), so an organisation is
  // collected through its repositories, most recently updated first and bounded by
  // github_org_repos.
  const targets = [];
  for (const row of rows) {
    if (row.kind === 'github-repo') targets.push({ target: row.target, domain: row.domain });
  }
  for (const row of rows) {
    if (row.kind !== 'github-org') continue;
    if (!spend()) { shortfall.orgs += 1; continue; }
    const url = `${GITHUB_API}/orgs/${row.target}/repos`
      + `?per_page=${encodeURIComponent(s.github_org_repos)}&sort=updated`;
    try {
      const body = parseJson(await get(url), url);
      if (!Array.isArray(body)) throw new Error('unexpected response shape');
      for (const repo of body) if (repo.full_name) targets.push({ target: repo.full_name, domain: row.domain });
    } catch (err) {
      pushNotice(notices, `github ${row.target}: ${err.message}`, secretsFor(url));
      // The refused request is named by this notice and counted as a refusal in the budget
      // notice; every later organisation is counted by the spend() guard above.
      refused(err);
    }
  }

  // Phase 1 -- releases for every repository now known.
  const tagFallbacks = [];
  let tagLeads = 0;
  for (let i = 0; i < targets.length; i += 1) {
    if (!spend()) { shortfall.repos = targets.length - i; break; }
    const t = targets[i];
    const before = candidates.length;
    const url = `${GITHUB_API}/repos/${t.target}/releases`
      + `?per_page=${encodeURIComponent(s.github_releases_per_repo)}`;
    try {
      const body = parseJson(await get(url), url);
      if (!Array.isArray(body)) throw new Error('unexpected response shape');
      for (const rel of body) {
        if (rel.draft || !rel.tag_name || !rel.html_url) continue;
        const publishedAt = toIso(rel.published_at);
        if (ctx.since && publishedAt && publishedAt < ctx.since) continue;
        if (ctx.until && publishedAt && publishedAt > ctx.until) continue;
        candidates.push({
          domain: t.domain,
          kind: 'github-release',
          title: plainText(`${t.target} ${rel.tag_name}`, s.title_max_chars),
          url: neutraliseUrl(rel.html_url),
          publishedAt,
          source: `github:${t.target}`,
          tierHint: 'primary',
          summary: plainText(rel.body ?? '', s.summary_max_chars),
        });
      }
    } catch (err) {
      pushNotice(notices, `github ${t.target}: ${err.message}`, secretsFor(url));
      // The refusal is the settled allowance, so the block stops spending here: the refused
      // repository is named by this notice and by the refusal count, and every repository after
      // it - which the run never asked for - is what the budget notice counts as unchecked.
      if (refused(err)) { shortfall.repos = targets.length - i - 1; break; }
      continue;
    }
    if (candidates.length === before) tagFallbacks.push(t);
  }

  // Phase 2 -- tags for repositories that published no candidate, so a project that
  // tags without publishing Releases still contributes a lead. The tags payload
  // carries no date (probe 2026-09-23: name, commit.sha and archive urls only), so
  // the candidate is undated and the agent dates it from the commit.
  for (let i = 0; i < tagFallbacks.length; i += 1) {
    if (!spend()) { shortfall.tags = tagFallbacks.length - i; break; }
    const t = tagFallbacks[i];
    const url = `${GITHUB_API}/repos/${t.target}/tags`
      + `?per_page=${encodeURIComponent(s.github_tags_per_repo)}`;
    try {
      const body = parseJson(await get(url), url);
      if (!Array.isArray(body)) throw new Error('unexpected response shape');
      for (const tag of body) {
        if (!tag.name || !tag.commit || !tag.commit.sha) continue;
        candidates.push({
          domain: t.domain,
          kind: 'github-tag',
          title: plainText(`${t.target} ${tag.name}`, s.title_max_chars),
          url: neutraliseUrl(`https://github.com/${t.target}/releases/tag/${encodeURIComponent(tag.name)}`),
          publishedAt: null,
          undated: true, // a lead, never a window match: the tags payload has no date
          source: `github-tags:${t.target}`,
          tierHint: 'primary',
          summary: plainText(`Tag ${tag.name} at commit ${tag.commit.sha}; the tags API carries no date`, s.summary_max_chars),
        });
        tagLeads += 1;
      }
    } catch (err) {
      pushNotice(notices, `github-tags ${t.target}: ${err.message}`, secretsFor(url));
      if (refused(err)) { shortfall.tags = tagFallbacks.length - i - 1; break; }
    }
  }

  if (tagLeads > 0) {
    pushNotice(notices, `github-tags: ${tagLeads} undated tag ${tagLeads === 1 ? 'lead' : 'leads'} carried `
      + '(the tags API has no date, so they cannot be window-filtered)');
  }
  if (shortfall.repos || shortfall.orgs || shortfall.tags || refusals.count > 0) {
    // A probe that reports the whole allowance means nothing had been charged before the
    // block, so its "remaining" is a pre-spend snapshot: the notice states the effective
    // allowance instead, which is how a fully spent run stops claiming a full one. A probe
    // that already reports a partial budget keeps its reading.
    //
    // A refusal observed by the block is not a reading at all: it is the server settling the
    // allowance at zero, which is what the notice has to say whatever the probe reported.
    const fresh = budget.limit !== null && budget.remaining === budget.limit;
    const tracked = fresh || refusals.count > 0;
    const reported = tracked ? { ...budget, reserve, spent: charged.count, refused: refusals.count } : budget;
    pushNotice(notices, budgetNotice(reported, shortfall, Boolean(token)));
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, headers)) };
}

export async function collectArxiv(rows, ctx) {
  const candidates = [];
  const notices = [];
  for (const row of rows) {
    const url = 'https://export.arxiv.org/api/query'
      + `?search_query=${encodeURIComponent(`cat:${row.target}`)}`
      + `&sortBy=submittedDate&sortOrder=descending&max_results=${encodeURIComponent(ctx.settings.arxiv_max_results)}`;
    try {
      const xml = await ctx.net.fetchText(url, ctx.timeout, {}, ctx.settings.user_agent, ctx.settings.error_snippet_max_chars);
      const entries = splitItems(xml);
      const cap = Number(ctx.settings.arxiv_max_results);
      // A capped listing is not a complete one: the window cannot be enforced for this
      // source past the cap, so the run says so instead of looking complete.
      if (entries.length >= cap) {
        pushNotice(notices, `arxiv ${row.target}: listing capped at ${cap} entries; older items inside the window may be missing`);
      }
      for (const entry of entries) {
        const link = atomLink(entry);
        if (!link) continue;
        const publishedAt = toIso(field(entry, 'published') || field(entry, 'updated'));
        if (ctx.since && publishedAt && publishedAt < ctx.since) continue;
        if (ctx.until && publishedAt && publishedAt > ctx.until) continue;
        candidates.push({
          domain: row.domain,
          kind: 'arxiv',
          title: plainText(field(entry, 'title'), ctx.settings.title_max_chars),
          url: neutraliseUrl(link),
          publishedAt,
          source: `arxiv:${row.target}`,
          tierHint: 'preprint',
          summary: plainText(field(entry, 'summary'), ctx.settings.summary_max_chars),
        });
      }
    } catch (err) {
      pushNotice(notices, `arxiv ${row.target}: ${err.message}`, requestSecrets(url, {}));
    }
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, {})) };
}

// A watchlist target is configuration, and curl honours whatever it is handed: file://
// answers with a local file at exit 0 and status 200, and a target beginning with '-' is
// read as an option. Only http and https are fetched, so every other row becomes a notice
// instead of a candidate and never reaches the fetcher.
function fetchableTarget(target) {
  const value = String(target ?? '').trim();
  if (value === '' || value.startsWith('-')) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch { return false; }
}

export async function collectFeeds(rows, ctx) {
  const candidates = [];
  const notices = [];
  for (const row of rows) {
    const target = String(row.target ?? '').trim();
    if (!fetchableTarget(target)) {
      pushNotice(notices, `rss ${redactUrl(target) || '(empty target)'}: unsupported scheme (only http and https are fetched)`);
      continue;
    }
    try {
      const xml = await ctx.net.fetchText(target, ctx.timeout, {}, ctx.settings.user_agent, ctx.settings.error_snippet_max_chars);
      for (const item of splitItems(xml)) {
        const url = field(item, 'link') || atomLink(item);
        if (!url) continue;
        const publishedAt = toIso(field(item, 'pubDate') || field(item, 'published') || field(item, 'updated'));
        if (publishedAt && ctx.since && publishedAt < ctx.since) continue;
        if (publishedAt && ctx.until && publishedAt > ctx.until) continue;
        candidates.push({
          domain: row.domain,
          kind: 'feed',
          title: plainText(field(item, 'title'), ctx.settings.title_max_chars),
          url: neutraliseUrl(url),
          publishedAt,
          // The source labels the feed for the reader, so it is built from the same
          // redaction the notice uses: a target carrying userinfo or a credential-named
          // query parameter must not travel into the published pool. It still names the
          // feed's host, so the candidate stays diagnosable.
          source: `rss:${redactUrl(target)}`,
          tierHint: 'primary',
          summary: plainText(field(item, 'description') || field(item, 'summary'), ctx.settings.summary_max_chars),
        });
      }
    } catch (err) {
      pushNotice(notices, `rss ${redactUrl(target)}: ${err.message}`, requestSecrets(target, {}));
    }
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, {})) };
}

export function nvdStamp(iso) {
  return new Date(iso).toISOString().replace(/Z$/, '');
}

// The shape a CVE identifier has: the year, then the sequence number, four digits or
// more (NVD uses four for the classic scheme and seven for the 2024-onward one). The NVD
// answer is upstream text, and the identifier is the one field of an advisory card that is
// interpolated into a URL, so it is checked against this shape before a citation is built
// rather than trusted, encoded or not.
const CVE_ID = /^CVE-\d{4}-\d{4,}$/;

// Every reader answers one question: when was the version we are about to report
// actually released? Never a "last modified" timestamp -- registry bookkeeping
// moves for reasons that have nothing to do with a release (metadata edits,
// deprecations, a dist-tag change) and would date an old release as this week's.
// The probe endpoint reports the budget for the same credentials and is documented
// not to consume it. resources.core is the bucket the release and advisory calls are
// charged against: verified against the x-ratelimit-* headers those calls return
// (same limit, same reset, same used).
export function coreBudget(json) {
  const core = json?.resources?.core ?? json?.rate ?? {};
  const remaining = Number(core.remaining);
  const limit = Number(core.limit);
  const reset = Number(core.reset);
  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    limit: Number.isFinite(limit) ? limit : null,
    resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
  };
}

function uncheckedPhrase(n) {
  return `${n} ${n === 1 ? 'repository' : 'repositories'} not checked`;
}

// The phase-1 shortfall is a run of release listings that were never requested, not whole
// repositories that went unread: a repository whose releases request was skipped is still a
// repository the run reached, and counting its listing as a repository overstated what the
// notice meant.
function skippedReleasesPhrase(n) {
  return `${n} repository release ${n === 1 ? 'listing' : 'listings'} not checked`;
}

// The rows a failed probe leaves unread are not all repositories: an organisation row stands
// for up to github_org_repos repositories, so counting it as one repository understates it.
function uncheckedPhraseFor(rows) {
  const count = (kind) => rows.filter((r) => r.kind === kind).length;
  const parts = [];
  const repos = count('github-repo');
  const orgs = count('github-org');
  if (repos) parts.push(uncheckedPhrase(repos));
  if (orgs) parts.push(`${orgs} ${orgs === 1 ? 'organisation' : 'organisations'} not listed`);
  return parts.join('; ');
}

// One notice replaces the wall of identical 403s. It names the budget, when it comes
// back, how many rows went unchecked, and the remedy that matches the credentials in
// use -- telling a caller who already supplied a token to supply one helps nobody.
export function budgetNotice(budget, shortfall, token) {
  const resets = budget.resetAt ? `, resets ${budget.resetAt}` : '';
  const remedy = token
    ? 'the supplied GITHUB_TOKEN budget is spent as well, so wait for the reset'
    : 'set GITHUB_TOKEN to raise the limit';
  const parts = [];
  if (shortfall.repos) parts.push(skippedReleasesPhrase(shortfall.repos));
  if (shortfall.orgs) parts.push(`${shortfall.orgs} ${shortfall.orgs === 1 ? 'organisation' : 'organisations'} not listed`);
  if (shortfall.tags) parts.push(`${shortfall.tags} tag ${shortfall.tags === 1 ? 'listing' : 'listings'} not checked`);
  // budget.remaining is the value the free probe reported before the block spent anything.
  // A caller that knows the reserve and the spend reports the effective allowance instead,
  // so a fully spent run cannot claim a full one and the reserve is named; a caller that
  // does not keeps the probe's reading.
  const reserve = Number(budget?.reserve);
  const spent = Number(budget?.spent);
  const tracked = Number.isFinite(reserve) || Number.isFinite(spent);
  const arithmetic = tracked
    ? Math.max(0, Number(budget.remaining)
      - (Number.isFinite(reserve) ? reserve : 0)
      - (Number.isFinite(spent) ? spent : 0))
    : budget.remaining;
  // A refusal the block observed is the authoritative reading, and it settles the allowance at
  // zero: the probe described the bucket of the address the run left from, not this run's own
  // allowance, so quoting the probe's arithmetic here would overstate what is left to spend.
  // The count of refusals the probe did not predict is named with it, and the rows the run
  // could not check keep their own count below.
  const refused = Number(budget?.refused);
  const observed = Number.isFinite(refused) && refused > 0;
  const quoted = observed ? 0 : arithmetic;
  const held = tracked && Number.isFinite(reserve) && reserve > 0
    ? `, ${reserve} held in reserve` : '';
  const refusedNote = observed
    ? `, ${refused} refused as rate limited` : '';
  // A run whose whole shortfall is the refusal itself has no separate unchecked count to name:
  // the middle clause is dropped rather than left as an empty one.
  const unchecked = parts.length ? `${parts.join('; ')}; ` : '';
  return `github: rate limit reached (remaining ${quoted} of ${budget.limit}${held}${refusedNote}${resets}); `
    + `${unchecked}${remedy}`;
}

const REGISTRY = {
  npm: {
    // dist-tags.latest names the version; time[<that version>] is that version's own
    // publish timestamp. time.modified is when the packument last changed.
    url: (t) => `https://registry.npmjs.org/${encodeURIComponent(t)}`,
    page: (t) => `https://www.npmjs.com/package/${t}`,
    read: (j) => {
      const version = j['dist-tags']?.latest ?? '';
      return { version, at: version ? j.time?.[version] : undefined };
    },
  },
  pypi: {
    // info.version names the version; urls[] are that version's files, each with the
    // upload time of that file. The release is when its first file appeared: a wheel
    // or sdist added later must not make an older release look newer.
    url: (t) => `https://pypi.org/pypi/${encodeURIComponent(t)}/json`,
    page: (t) => `https://pypi.org/project/${t}/`,
    read: (j) => {
      const times = (j.urls ?? []).map((u) => u.upload_time_iso_8601).filter(Boolean).sort();
      return { version: j.info?.version ?? '', at: times[0] };
    },
  },
  crates: {
    // crate.newest_version names the version; versions[] carries one entry per
    // version with its created_at. Match by num, so the date always belongs to the
    // version in the title: a backport published after the newest version sorts
    // first in versions[] and must not date it. (crate.updated_at is bookkeeping.)
    url: (t) => `https://crates.io/api/v1/crates/${encodeURIComponent(t)}`,
    page: (t) => `https://crates.io/crates/${t}`,
    read: (j) => {
      // No fallback to versions[0]: borrowing another version's date is the defect the
      // comment below forbids. A version missing from versions[] has no release time.
      const version = j.crate?.newest_version ?? '';
      const entry = (j.versions ?? []).find((v) => v.num === version);
      return { version, at: entry?.created_at };
    },
  },
  gomod: {
    // The proxy's @latest response carries exactly two fields: the version and that
    // version's commit time. There is no modification timestamp to confuse it with.
    url: (t) => `https://proxy.golang.org/${goModulePath(t)}/@latest`,
    page: (t) => `https://pkg.go.dev/${t}`,
    read: (j) => ({ version: j.Version ?? '', at: j.Time }),
  },
};

export async function collectRegistries(rows, ctx) {
  const candidates = [];
  const notices = [];
  for (const row of rows) {
    const spec = REGISTRY[row.kind];
    if (!spec) { pushNotice(notices, `registry unknown kind ${row.kind}`); continue; }
    const url = spec.url(row.target);
    try {
      const json = parseJson(await ctx.net.fetchText(url, ctx.timeout, {}, ctx.settings.user_agent, ctx.settings.error_snippet_max_chars), url);
      const { version, at } = spec.read(json);
      const publishedAt = toIso(at);
      // A registry release whose release time cannot be established is a notice, not an
      // undated "release" that passes every window. The version is upstream text and a notice
      // quotes none of it, so the notice names the source, the kind and the cause, and not the
      // version it could not date.
      if (!publishedAt) {
        pushNotice(notices, `${row.kind} ${row.target}: no release time for the latest version; candidate skipped`);
        continue;
      }
      if (ctx.since && publishedAt < ctx.since) continue;
      if (ctx.until && publishedAt && publishedAt > ctx.until) continue;
      candidates.push({
        domain: row.domain,
        kind: 'registry',
        // The version is upstream text, so the title and the summary are normalised and bounded
        // like every other candidate field, and the page URL goes through the URL rule: a
        // registry that answered with the renderer's own vocabulary in its version string must
        // not draw a badge on the card the agent builds from this pool.
        title: plainText(`${row.kind} ${row.target} ${version}`, ctx.settings.title_max_chars),
        url: neutraliseUrl(spec.page(row.target)),
        publishedAt,
        source: `${row.kind}:${row.target}`,
        tierHint: 'primary',
        summary: plainText(`New ${row.kind} release ${version}`, ctx.settings.summary_max_chars),
      });
    } catch (err) {
      pushNotice(notices, `${row.kind} ${row.target}: ${err.message}`, requestSecrets(url, {}));
    }
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, {})) };
}

export async function collectAdvisories(rows, ctx) {
  const candidates = [];
  const notices = [];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  // The GHSA header is built once, so the union the notices are finally redacted against
  // (rowsSecrets, TR-99) cannot drift from the header the requests actually send.
  const ghsaHeaders = { Accept: 'application/vnd.github+json' };
  if (token) ghsaHeaders.Authorization = `Bearer ${token}`;
  for (const row of rows) {
    // The request in flight, for the notice boundary: the GHSA path sends a credential and the
    // NVD path a window, and a failure that quotes the server's answer needs its own request's
    // secrets rather than the other branch's.
    let secrets = [];
    try {
      if (row.kind === 'ghsa') {
        const headers = ghsaHeaders;
        const url = `${GITHUB_API}/advisories`
          + `?per_page=${encodeURIComponent(ctx.settings.ghsa_page_size)}`
          + `&published=${(ctx.since ?? '').slice(0, 10)}..${(ctx.until ?? '').slice(0, 10)}`;
        secrets = requestSecrets(url, headers);
        const body = parseJson(await ctx.net.fetchText(url, ctx.timeout, headers, ctx.settings.user_agent, ctx.settings.error_snippet_max_chars), url);
        for (const a of Array.isArray(body) ? body : []) {
          const publishedAt = toIso(a.published_at);
          if (ctx.since && publishedAt && publishedAt < ctx.since) continue;
          if (ctx.until && publishedAt && publishedAt > ctx.until) continue;
          candidates.push({
            domain: row.domain, kind: 'advisory',
            title: plainText(String(a.ghsa_id || a.summary || ''), ctx.settings.summary_max_chars),
            url: neutraliseUrl(a.html_url), publishedAt, source: 'ghsa', tierHint: 'primary',
            summary: plainText(a.summary ?? '', ctx.settings.summary_max_chars),
          });
        }
      } else if (row.kind === 'nvd') {
        const url = 'https://services.nvd.nist.gov/rest/json/cves/2.0'
          + `?pubStartDate=${encodeURIComponent(nvdStamp(ctx.since))}`
          + `&pubEndDate=${encodeURIComponent(nvdStamp(ctx.until))}`
          + `&cvssV3Severity=${encodeURIComponent(ctx.settings.nvd_severity)}`;
        secrets = requestSecrets(url, {});
        const body = parseJson(await ctx.net.fetchText(url, ctx.timeout, {}, ctx.settings.user_agent, ctx.settings.error_snippet_max_chars), url);
        for (const v of body.vulnerabilities ?? []) {
          const cve = v.cve ?? {};
          const en = (cve.descriptions ?? []).find((d) => d.lang === 'en');
          const publishedAt = toIso(cve.published);
          if (ctx.since && publishedAt && publishedAt < ctx.since) continue;
          if (ctx.until && publishedAt && publishedAt > ctx.until) continue;
          // The identifier is upstream text and the only field interpolated into a URL, so it
          // is required to have the shape of a CVE id before the citation is built. Unchecked,
          // a crafted id ('CVE-2026-0001](https://evil.example/x)') forges the destination the
          // digest renders, an id carrying a space yields a citation the renderer cannot read
          // at all, and an absent id publishes a live link ending in 'undefined'. A row that
          // fails the shape is skipped with a notice the Coverage note carries, never guessed
          // at; the window filters above run first, so only a row that would have shipped is
          // reported.
          const id = String(cve.id ?? '');
          if (!CVE_ID.test(id)) {
            // The identifier is upstream text and a notice quotes none of it: the notice still
            // names the source and the cause a reader needs -- an advisory was skipped because
            // its identifier is not a CVE id -- without republishing the rejected value.
            pushNotice(notices, `${row.kind}: skipped an advisory whose identifier is not a CVE id`, secrets);
            continue;
          }
          candidates.push({
            domain: row.domain, kind: 'advisory',
            title: plainText(id, ctx.settings.summary_max_chars),
            // Encoded even though the shape rule already excludes every character the
            // encoding would change: the citation destination is never built from unencoded
            // upstream text, so relaxing the rule cannot reintroduce the injection.
            url: neutraliseUrl(`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(id)}`),
            publishedAt, source: 'nvd', tierHint: 'primary',
            summary: plainText(en?.value ?? '', ctx.settings.summary_max_chars),
          });
        }
      }
    } catch (err) {
      // The secrets are those of the request this row made; a row that failed before it
      // reached one contributes none.
      pushNotice(notices, `${row.kind}: ${err.message}`, secrets);
    }
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, ghsaHeaders)) };
}

export async function collectAll(config, opts) {
  // TR-99: redaction was per request, so a notice published a value another row sent whenever
  // several rows share a host and its answer echoes the other row's request. Every request the
  // run issues registers its own secrets here as it is issued - a row that pushes no notice of
  // its own still protects its value in a notice another row pushed - and the notices are
  // redacted once more, after every source has run, against that whole union rather than one
  // request's list. The union holds exactly what the per-request pass held (a URL's userinfo, a
  // credential-named query value from three characters up, and a credential header, all through
  // requestSecretSets), so the floor that keeps a harmless word of free text readable still
  // applies.
  //
  // TR-110: a second set holds the credential positions alone. The candidate fields are redacted
  // against that one, never against the whole union: a value that is merely ordinary
  // configuration - the collector's own '?sortOrder=descending', '?max_results=40' - is not a
  // credential and must not be able to rewrite a published word in the pool.
  const issuedSecrets = new Set();
  const issuedCredentialSecrets = new Set();
  const baseNet = opts.net ?? { fetchText, hostOf, isDiscoveryOnly };
  const ctx = {
    // Normalised here as well as at parse time, so a direct caller passing an
    // offset-bearing spelling cannot filter differently from its Z spelling.
    since: toIso(opts.since), until: toIso(opts.until), settings: config.settings,
    timeout: resolveTimeout({ timeout: opts.timeout ?? null }, config.settings),
    net: {
      ...baseNet,
      fetchText: (url, timeout, headers, ...rest) => {
        const { all, credentials } = requestSecretSets(url, headers);
        for (const secret of all) issuedSecrets.add(secret);
        for (const secret of credentials) issuedCredentialSecrets.add(secret);
        return baseNet.fetchText(url, timeout, headers, ...rest);
      },
    },
    domains: opts.domains ?? null,
  };
  const rows = (kind) => config.watchlist.filter(
    (r) => r.kind === kind && (!ctx.domains || ctx.domains.includes(r.domain)),
  );
  const acc = { candidates: [], notices: [] };
  await runSource('github', rows('github-repo').concat(rows('github-org')), collectGithub, ctx, acc);
  await runSource('arxiv', rows('arxiv-category'), collectArxiv, ctx, acc);
  await runSource('feeds', rows('rss'), collectFeeds, ctx, acc);
  await runSource('advisories', rows('ghsa').concat(rows('nvd')), collectAdvisories, ctx, acc);
  await runSource(
    'registries',
    rows('npm').concat(rows('pypi')).concat(rows('crates')).concat(rows('gomod')),
    collectRegistries, ctx, acc,
  );
  const candidates = sortCandidates(acc.candidates).filter(
    (c) => (!ctx.since || !c.publishedAt || c.publishedAt >= ctx.since)
      && (!ctx.until || !c.publishedAt || c.publishedAt <= ctx.until),
  );
  // The union pass TR-99 asks for: every notice the run produced, from every source and every
  // row, is redacted once more against every value of every request the run issued. The
  // per-request redaction stays as it is (and is what makes the notice readable at the point it
  // is built); this pass closes the cross-row echo the per-request pass cannot see.
  const union = [...issuedSecrets];
  const credentialUnion = [...issuedCredentialSecrets];
  const notices = [];
  for (const notice of acc.notices) pushNotice(notices, notice, union);
  // TR-106: the candidate fields, which the notices' redaction never covered, cross the same
  // redaction here. A source that answered 200 and echoed the request's own credential into the
  // text it feeds - an item title, an item summary - published that value in the pool, and the
  // pool is what the digest is written from, so a credential was a field of the published pool.
  // TR-110: the set is the credential positions only. Applying the whole union here reaped
  // ordinary words that merely happened to be a configured request value, so a shipped run
  // published a candidate summary of 'We sort the results in [redacted] order'; a value that is
  // ordinary configuration is not a credential and never rewrites published prose. The
  // per-source pass above stays as it is, and the redaction is skipped entirely when the run
  // issued no credential at all (nothing can have been echoed).
  const redactedCandidates = credentialUnion.length === 0 ? candidates : candidates.map((candidate) => {
    const out = { ...candidate };
    for (const [field, value] of Object.entries(out)) {
      if (typeof value === 'string') out[field] = redactSecrets(value, credentialUnion);
    }
    return out;
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    window: { since: ctx.since, until: ctx.until },
    candidates: redactedCandidates,
    notices,
  };
}

// The single line an operator sees on stderr for a degraded run, and the contract the
// digest's Coverage note has to carry: the same count, written the same way, so the
// two can be compared without interpretation.
export function noticeWarning(count) {
  const noun = count === 1 ? 'source notice' : 'source notices';
  return `collect: ${count} ${noun} (GitHub rate limit and others) — `
    + `the digest's Coverage note must report them; Collector notices: ${count}`;
}

// The one line an operator sees for a degraded run. A transport failure that produced no
// diagnostic of its own -- curl never started, or curl ran and said nothing -- ends in its
// cause, so the line repeats that reason: a broken dependency should not require reading the
// pool to be seen.
const TRANSPORT_TAIL = /(curl exited with status \d+|curl could not be started \([^)]+\))$/;
function operatorWarning(notices) {
  const line = noticeWarning(notices.length);
  for (const notice of notices) {
    const m = TRANSPORT_TAIL.exec(String(notice));
    if (m) return `${line} (${m[0]})`;
  }
  return line;
}

// The file the write lands on, with a symlinked destination followed to its target. A pool
// named through a symlink - a pool kept on another volume behind one - was replaced by the
// rename itself: the link became a regular file holding the new pool while the file it
// pointed at kept the old one, so the operator's pool quietly went stale. Resolving rather
// than refusing keeps the operator's link and publishes the pool where they aimed it.
//
// realpathSync answers for a link whose target is there; a link whose final target is not
// there yet has no real path, so the chain is walked by hand to the name it points at, which
// the write then creates exactly as a plain write to a fresh destination would. A chain that
// never terminates is refused rather than guessed at, and the failure path below unlinks the
// temp, so nothing is left behind. This mirrors the state writer's rule, which resolves its
// destination the same way.
function resolveWriteTarget(out) {
  try { return realpathSync(out); } catch { /* absent, or a link to a path that is not there */ }
  let current = out;
  let stats;
  try { stats = lstatSync(current); } catch { return current; }
  for (let hop = 0; stats.isSymbolicLink(); hop += 1) {
    if (hop >= 32) throw new Error(`${out} is a symlink chain that does not resolve to a file`);
    const target = readlinkSync(current);
    current = isAbsolute(target) ? target : resolve(dirname(current), target);
    try { stats = lstatSync(current); } catch { return current; }
  }
  return current;
}

// The mode the replacement carries. The rename replaces the inode, so an existing
// destination keeps its own permissions only if the temp is born with them: a temp created
// with the process default silently widened a pool the operator had protected - a 0600 pool
// came back 0664. A fresh (absent) destination has no mode to keep, so it is left at the
// mode the create itself gave it - 0666 masked by the process umask - exactly what the
// plain write this replaced produced. The state writer resolves the same way, so the three
// writers agree on the rule and on the refusal below.
function destinationMode(out) {
  try { return statSync(out).mode & 0o777; } catch { return null; }
}

// A replacement is published by a rename, so a refused or interrupted write leaves the
// previous pool intact rather than truncated. The temp name is unique and created
// exclusively, so a pre-planted path is never followed, and it is removed on every failure.
// A destination that exists but is not writable is refused before the rename: the rename
// itself needs only the directory, so without this check a pool the operator had protected
// was silently replaced. The state writer refuses the same way.
function writeAtomic(out, text) {
  // Everything below names the resolved destination: the temp has to be born beside the inode
  // the rename replaces, or a symlinked destination on another volume would fail with EXDEV,
  // and the rename itself has to name that inode.
  const destination = resolveWriteTarget(out);
  const mode = destinationMode(destination);
  const dir = dirname(destination);
  if (dir) mkdirSync(dir, { recursive: true });
  const tmp = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode: mode ?? 0o666 });
    // chmod after the create, because the umask would otherwise clear bits the destination
    // held (a 0664 pool under a 022 umask is the common case). Only a destination that
    // already existed is pinned: a fresh one keeps the create's own 0666 & ~umask.
    if (mode !== null) chmodSync(tmp, mode);
    if (existsSync(destination)) accessSync(destination, constants.W_OK);
    renameSync(tmp, destination);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* the temp was never created */ }
    throw err;
  }
}

export function humanSummary(pool) {
  const counts = new Map();
  for (const c of pool.candidates) counts.set(c.domain, (counts.get(c.domain) ?? 0) + 1);
  const lines = [
    `tech-radar collect  ${pool.generatedAt}`,
    `window: ${pool.window.since} .. ${pool.window.until}`,
    `candidates: ${pool.candidates.length}`,
  ];
  for (const [domain, n] of [...counts].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    lines.push(`  ${domain}: ${n}`);
  }
  lines.push(`notices: ${pool.notices.length}`);
  for (const notice of pool.notices) lines.push(`  - ${notice}`);
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  if (flag(argv, '-h') || flag(argv, '--help')) {
    console.log(USAGE);
    return 0;
  }
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`collect: ${err.message}`);
    console.error(USAGE);
    process.exitCode = 2;
    return 2;
  }
  let config;
  try {
    config = readConfig(options.config);
  } catch (err) {
    console.error(`collect: cannot read config ${options.config}: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  // A mistyped --domain would otherwise read as a quiet week: no candidates, no
  // notices, exit 0. update-state.mjs validates its --domains the same way.
  const unknown = (options.domain ?? []).filter((k) => !config.domains.some((d) => d.key === k));
  if (unknown.length) {
    console.error(`collect: unknown domain key(s): ${unknown.join(', ')}`);
    process.exitCode = 2;
    return 2;
  }
  // Checked against the rows this run will actually read, so a full configuration is not
  // required for a run that touches only some of the sources.
  const selected = config.watchlist.filter((r) => !options.domain || options.domain.includes(r.domain));
  try {
    validateSettings(config.settings, selected, options);
  } catch (err) {
    console.error(`collect: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  const now = new Date();
  let since;
  let timeout;
  try {
    since = options.since ?? windowStart(config.settings, now);
    timeout = resolveTimeout(options, config.settings);
  } catch (err) {
    console.error(`collect: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  const until = options.until ?? now.toISOString();
  // An empty window collects nothing and would read as a quiet week, so it is refused.
  if (new Date(since).getTime() > new Date(until).getTime()) {
    console.error(`collect: --since ${since} is after --until ${until}: the window is empty`);
    process.exitCode = 2;
    return 2;
  }
  let out;
  try {
    out = resolveOut(options, config.settings);
  } catch (err) {
    console.error(`collect: ${err.message}`);
    process.exitCode = 2;
    return 2;
  }
  let pool;
  try {
    pool = await collectAll(config, {
      since, until, timeout, domains: options.domain,
    });
  } catch (err) {
    console.error(`collect: ${err.message}`);
    process.exitCode = 1;
    return 1;
  }
  try {
    writeAtomic(out, `${JSON.stringify(pool, null, 2)}\n`);
  } catch (err) {
    console.error(`collect: cannot write ${out}: ${err.message}`);
    process.exitCode = 4;
    return 4;
  }
  console.log(options.human ? humanSummary(pool) : JSON.stringify(pool, null, 2));
  // A degraded run must be visible to an operator who never passes --human and to an
  // agent that never reads the pool. Stdout stays byte-identical: this one line goes
  // to stderr, and a clean pool writes nothing at all.
  if (pool.notices.length > 0) console.error(operatorWarning(pool.notices));
  if (pool.candidates.length === 0 && pool.notices.length > 0) {
    process.exitCode = 3;
    return 3;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

