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
import { readConfig, readSettings } from './lib/mdtable.mjs';
import {
  fetchText, hostOf, isDiscoveryOnly, splitItems, field, atomLink, plainText, redactUrl,
  neutraliseMarkers, neutraliseLinkSeams, noticePreservingRewrites, neutraliseUrl, redactSecrets,
  requestSecrets, requestSecretSets, neutraliseTagSpans, neutraliseEntityTags, repriceShapedError,
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
// published Coverage note, so a notice is published text -- and the text is bounded by the
// configured notice cap so one hostile response cannot become an unbounded notice.
//
// The request's own credential is removed here too, at the one boundary every notice crosses.
// The transport shapers redact the messages they build, but the shapers are not the only
// source of a notice: a JSON parse failure is raised by Node with the head of the body in its
// message, and any fetch implementation can throw whatever it likes, so the guarantee lives at
// the push. The set a notice is redacted against is the run's union over the rows it selected,
// known from configuration before the first request, because the redaction is also part of what
// the cap is priced with: a notice priced against a smaller set than it is published under can
// only be lengthened by the difference, and a lengthened notice loses its tail (TR-168).
const NOTICE_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
// The notice cap has a usable range, not merely a type. Below the floor an assembled notice
// cannot carry its source, the separator and even the shortest diagnosis; above the ceiling the
// value bounds nothing an assembled notice could contain -- every part of one is bounded already
// -- so it states the policy of no cap, and the whole reason the cap exists is that one hostile
// answer must not become an unbounded published note. Both ends are refused as a configuration
// error that names the setting (exit 2) rather than obeyed silently. This floor is the absolute
// one; that the status and the cause survive is the relationship between this cap and
// error_snippet_max_chars, checked in validateSettings (TR-142), because the shaped error text
// the cap has to leave room for is the other setting's bound.
const MIN_NOTICE_CHARS = 128;
const MAX_NOTICE_CHARS = 100000;

// The largest time value a Date can carry, in milliseconds: infrastructure rather than policy,
// like the transport's own capture ceiling, so it is stated here and not in configuration. The
// same bound caps a window: the start is the clock minus a number of weeks, and a cap beyond
// what a Date can represent made the subtraction produce an instant toISOString refuses with the
// runtime's own message ('Invalid time value'), which names no setting at all (TR-143).
const MAX_DATE_MS = 8.64e15;
const MAX_WINDOW_WEEKS = Math.floor(MAX_DATE_MS / (7 * 24 * 3600 * 1000));

// A refusal that names a setting is a configuration error, and it must reach the operator as the
// documented exit 2 wherever it is raised rather than as the code reserved for an unexpected
// failure inside the collector. validateSettings names most of them before the first request, but
// collectAll is a public seam that resolves the two bound settings itself -- the notice cap and
// the room it has to leave for the shaped error text -- so the same mistyped value used to
// surface through main's catch-all as exit 1 whenever the run's selection carried no rows
// (TR-151). The class is how a caller that has no exit code, a direct collectAll caller, can tell
// the two apart as well.
class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
function configError(message) { return new ConfigurationError(message); }

// The notice cap is a quantity like every other one, so it is configuration and never a literal
// here. A caller may pass the settings object it read; a caller that carries none -- a fixture,
// a direct call -- falls back to the settings that ship beside this script, exactly as the
// catalogue reader's chip cap does. Only a key that is genuinely absent falls back: a key that
// is present but unusable is a configuration error that names itself.
const SHIPPED_SETTINGS = join(DEFAULT_CONFIG, 'settings.md');
let shippedNoticeLimit;
function shippedNoticeCap() {
  if (shippedNoticeLimit === undefined) {
    let value = null;
    try { value = Number(readSettings(SHIPPED_SETTINGS).notice_max_chars); } catch { value = null; }
    shippedNoticeLimit = usableNoticeCap(value) ? value : null;
  }
  return shippedNoticeLimit;
}
// A usable cap is an integer inside the range above; anything else is refused, not clamped. The
// range is stated once here so the reader of the settings file, the direct caller and the shipped
// fallback cannot disagree about it.
function usableNoticeCap(value) {
  return Number.isInteger(value) && value >= MIN_NOTICE_CHARS && value <= MAX_NOTICE_CHARS;
}
function outOfRangeCap(raw) {
  return `notice_max_chars is out of range in config/settings.md: ${JSON.stringify(raw)}`
    + ` (an integer between ${MIN_NOTICE_CHARS} and ${MAX_NOTICE_CHARS} is required)`;
}
function windowCapError(raw) {
  return `window_cap_weeks is out of range in config/settings.md: ${JSON.stringify(raw)}`
    + ` (a positive integer of at most ${MAX_WINDOW_WEEKS} weeks is required)`;
}
// The cap and the shaped-error bound are one guarantee, not two settings. A notice is the source
// it names -- the label included, because the label is what the source starts with -- the
// two-character ': ' separator, and the shaped error text. The separator is charged first, so it
// shortens neither half; what the cap has left is split, and the source takes the larger half of
// that split (the label sits inside the source's half, and the label is never the part a long
// target crowds out), while the shaped error text takes the smaller. The shaped text's half is
// what the bound has to carry, or the request, the status and the cause are cut away.
//
// The least cap that carries a snippet bound of N is therefore 2 * N + 2 -- one character less
// than the label-blind number the relation used to state, because the last character the old
// arithmetic reserved for the source is the one the shaped text needs to name its request -- and
// never less than the absolute floor, so the refusal below cannot name a cap its own range check
// refuses. Both settings are named, because either one of them can be the one that is wrong.
//
// What the check buys is bounded by where the two settings are applied, and the two documents
// that state this relation have to say the same thing (TR-167). The shaped text is priced inside
// the shaper, which crosses the notice rewriting before it does so; the source is priced at the
// push, after it has crossed the same rewriting; and both of them are priced after the run's own
// redaction, which is applied to each part before either is bounded (TR-168). What an accepted
// pair therefore admits is the length the notice will carry: a source inside its half, and a
// shaped text inside the snippet bound, each as redacted and rewritten. The shaper's own floors
// are the exception -- a bound too small for its compact form leaves the transport cause whole and
// longer than the bound, and a bound under the HTTP prefix leaves the status and its dangling
// 'for ' (TR-154) -- and the check still does not bound a notice on its own, because a notice is
// assembled from more parts than these two and a part no caller bounded still crosses the push.
const NOTICE_SEPARATOR = ': ';
const NOTICE_SEPARATOR_CHARS = NOTICE_SEPARATOR.length;
function noticeSourceRoom(cap) {
  return Math.ceil((cap - NOTICE_SEPARATOR_CHARS) / 2);
}
function noticeShapedRoom(cap) {
  return cap - NOTICE_SEPARATOR_CHARS - noticeSourceRoom(cap);
}
function leastNoticeCap(snippet) {
  return Math.max(MIN_NOTICE_CHARS, 2 * snippet + 2);
}
function noticeCapRoomError(cap, snippet, room) {
  return 'notice_max_chars leaves no room for error_snippet_max_chars in config/settings.md: '
    + `a ${cap}-character notice leaves ${room} characters for the shaped error text once the `
    + `source's half and the ': ' separator are taken, and error_snippet_max_chars is ${snippet} `
    + `(notice_max_chars must be at least ${leastNoticeCap(snippet)})`;
}
// The check itself, shared by validateSettings (the CLI path, where a mistyped value is a
// configuration error that names the setting and exits 2) and collectAll (a public seam a caller
// can drive without validateSettings, so the floor holds wherever the settings arrive). A value
// that is not a positive number is the key's own validation's business; this owns the
// relationship alone, and it is skipped when the settings carry no snippet bound at all.
function requireNoticeCapRoom(cap, settings) {
  if (settings === null || typeof settings !== 'object') return;
  const raw = settings.error_snippet_max_chars;
  if (raw === undefined || raw === null) return;
  const snippet = Number(raw);
  if (!Number.isFinite(snippet) || snippet <= 0) return;
  const room = noticeShapedRoom(cap);
  if (snippet > room) throw configError(noticeCapRoomError(cap, snippet, room));
}
function noticeLimit(settings) {
  if (settings && Object.prototype.hasOwnProperty.call(settings, 'notice_max_chars')
    && settings.notice_max_chars !== undefined) {
    const n = Number(settings.notice_max_chars);
    if (!usableNoticeCap(n)) throw configError(outOfRangeCap(settings.notice_max_chars));
    return n;
  }
  const shipped = shippedNoticeCap();
  if (shipped) return shipped;
  throw configError('notice_max_chars is missing or invalid in config/settings.md');
}
// A cap that arrives as anything else means a call site forgot to resolve one, and an undefined
// cap silently returns the text unbounded -- the defect this cap closes -- so it is refused. The
// range is checked here too, at the last gate before the slice, so no path can bound a notice
// with a number that cannot carry one.
function requireNoticeLimit(value) {
  if (!usableNoticeCap(value)) {
    throw new Error(`the notice limit in characters must be an integer between ${MIN_NOTICE_CHARS} and ${MAX_NOTICE_CHARS}, got ${JSON.stringify(value)}`);
  }
  return value;
}

// The rewriting every notice crosses at the single push, in one place because three boundaries
// need it: the push applies it to the assembled notice, noticeSource applies it to the source
// before bounding it, and the transport shaper applies it to the shaped text before its length
// is priced against the snippet bound. Bounding a part first and rewriting it afterwards handed
// the rewriting's own output back to the notice: a target that spells a markdown link seam --
// '](' -- is one character longer per seam once the seam is ended, so the source took that room
// from the shaped error text and the cause was cut (TR-162), and the shaped text itself took the
// notice cap's room the same way one layer down, which the push then sliced the cause out of
// (TR-165).
//
// It is a fixed point, not one pass: the rules hand each other shapes, so a second application
// of a single pass is not guaranteed to return what the first produced. Applying this function
// to its own output therefore changes nothing, which is what lets a caller bound a text and a
// later caller rewrite it again and still agree on its length -- the room the first reserved is
// the room the second leaves. net.mjs owns the loop, because the shaper needs the same
// guarantee, and the property is fuzzed in tests/sweep11-independent-regression.test.mjs rather
// than asserted here.
//
// The tag shape is the one class a notice cannot carry: a notice is published verbatim in the
// Coverage note, and a Markdown reader draws a live anchor or fetches a remote image from
// upstream markup that reached the text. It is neutralised here, at the one push every notice
// crosses, whatever built the notice -- a transport shaper, a caller's own wording, or a thrown
// message that quotes a server answer -- because the per-site normalisation above is a property
// of two callers rather than of the boundary. The '<' opens the tag, so replacing exactly it
// ends the markup while the rest of the span stays legible, and only a span the shape rule
// reads is touched: a legitimate server message that says 'a < b' or 'see <id>' is returned
// byte-identical, and so is an unterminated opener ('<script' cut off by a bound), because the
// rule's shape ends at the '>' that closes the span and an opener that has none draws no markup
// in the readers a notice is published to (net.mjs states the same contract, TR-171). The encoded spelling of the same opener is the second half of the class: a
// notice is never decoded, so '&lt;a href=...&gt;' was published as the anchor it spells.
// neutraliseEntityTags refuses that spelling before the literal rule runs, and both rules are
// the ones the candidate normaliser draws too, so the two boundaries cannot drift apart
// (TR-122, TR-123).
export function neutraliseNoticeText(text) {
  const spaced = neutraliseTagSpans(neutraliseEntityTags(
    String(text).replace(NOTICE_CONTROLS, (ch) => (/\s/.test(ch) ? ' ' : '')),
  ));
  // The markdown link seam belongs to this path and not to the neutraliser a candidate field
  // uses: a notice is published verbatim in the Coverage note, while a release body's links are
  // ordinary Markdown that the pool has to keep.
  return noticePreservingRewrites(neutraliseMarkers(spaced));
}

// The source a notice names is bounded, because the assembled notice is capped afterwards: a
// watchlist target or an organisation row's name may be any length, and an unbounded source
// used to fill the cap and cut the status and the cause away. The source's room is the larger half
// of what the cap has after the ': ' separator, and the label -- which sits inside that room, not
// outside it -- is charged against it with its separating space, so the room the shaped error text
// was granted is what the check reserved whatever label the notice carries (TR-162). The name is
// bounded after the notice rewriting, and the rewriting is a fixed point, so the source that
// filling the room produces is returned byte-identical by the push's own pass: no spelling it
// lengthens can take the room back.
function noticeSource(label, name, limit) {
  const room = Math.max(0, noticeSourceRoom(requireNoticeLimit(limit)) - String(label).length - 1);
  const text = neutraliseNoticeText(String(name ?? ''));
  return `${label} ${text.length > room ? text.slice(0, room) : text}`;
}
function sanitizeNotice(text, limit) {
  return neutraliseNoticeText(text).slice(0, requireNoticeLimit(limit));
}
function pushNotice(notices, text, secrets, limit) {
  notices.push(sanitizeNotice(redactSecrets(text, secrets), limit));
}
// A notice is the source it names, the ': ' separator and the detail it carries, and the cap
// is what the three of them have to fit in. The parts are redacted and rewritten apart and only
// then bounded, because the run's own redaction is a change of length like any other and has to
// be part of what the cap is priced against (TR-168). The set the notice is finally published
// under is the run's union, which is wider than the request's own values, so a detail the union
// lengthened after it was priced used to grow an already-bounded source, the slice removed the
// overflow from the tail, and the tail is where the status and the transport cause sit. Two things
// closed that: every redaction pass is now a fixed point (a marker it wrote is a span no later pass
// reads, so no removal can lengthen what a pass published), and a detail whose union redaction
// still leaves it too long for the cap is re-built smaller from the shaped error's own facts -- the
// status or the transport cause and the request -- by the bounded fallback below, never cut. Here
// the source is the part that gives way -- down to the room the redacted detail leaves it, and
// never past its own half, which is the division the cap check reserves -- and the detail is
// dropped only when it does not fit even with no source at all.
//
// The two passes stay the whole line's passes. A rule of either one that read across the
// separator (the tag-span rule's unterminated opener reaching a detail that carries a '>', the
// authorization shape's 'authorization: value') would make the parts compose into something other
// than the whole line's own result, so the composition is checked and the whole line is
// published, bounded by the cap, whenever the check fails: the bytes a notice carries are always
// the bytes one pass over it produces.
// Whether the detail is one of the shaped errors, which carries the facts its text was built
// from, rather than a string the caller built. The two shapes are the shaper's own: an HTTP shape
// has an integer httpStatus, a transport shape has null httpStatus and a cause string.
function shapedDetailOf(detail) {
  if (detail === null || typeof detail !== 'object') return null;
  // Only the two facts BOTH shipped shapers set identify one: shapeHttpError and
  // shapeTransportError each set an integer-or-null httpStatus AND a cause string, and the
  // httpStatus is "HTTP <status>" in the first shape and the fixed cause vocabulary in the second.
  // Anything else is a caller's own object, and the module may not read it as the shaper's own: a
  // forged {httpStatus, message} or {httpStatus, cause: 'x'} is not a shaped error, and a Proxy
  // whose property reads throw is refused rather than thrown out of the assembly (S26-F4).
  let httpStatus;
  let cause;
  try {
    httpStatus = detail.httpStatus;
    cause = detail.cause;
  } catch {
    return null;
  }
  if (typeof cause !== 'string' || cause === '') return null;
  if (Number.isInteger(httpStatus)) return detail;
  if (httpStatus === null) return detail;
  return null;
}

// A notice is bounded inside a budget, and the bytes it publishes are always a slice of the
// whole-line redaction -- never a rebuild from the two separately-redacted parts. Batch 33 bounded
// the fallback's recomposition of 'head' and 'tail', and a value that spans the ': ' seam (a
// credential whose prefix ends the source and whose suffix begins the detail) is removed from the
// whole line and from neither part: the rebuild put it back, and the pool published it. The parts
// are now only what DECIDES where the cut falls; the bytes come from 'whole'.
//
// The cut itself is unchanged from TR-168's design: the reason at the head of the detail is what a
// cap may never take, the SOURCE gives way to it first, and only a detail longer than the cap is
// trimmed, from its tail, because the tail is where the transport cause sits and the head is where
// the reason sits. The documented 'source: detail' shape is preserved with it: the label and the
// separator are the last thing dropped, never the first, so no notice is published as a bare
// detail or with a dangling separator (F26-1).
const NOTICE_SEAM = ' ... ';

// How many leading characters of 'line' are also the leading characters of 'reference'. The
// redaction only removes, and every rule that fired inside the seam is a rule the whole-line pass
// ran too, so the two agree up to the point the whole-line pass started eating and then diverge.
function sharedPrefixLength(line, reference) {
  const max = Math.min(line.length, reference.length);
  let i = 0;
  while (i < max && line[i] === reference[i]) i += 1;
  return i;
}

// The length at which the source gives way: the whole of the source when the whole line fits, or
// the room the detail leaves it -- charged against the source's own half of the cap (TR-162), so
// a long target cannot push the detail past the cap -- and never less than the separator itself,
// because a notice with no separator names no source and the documented shape is 'source: detail'
// (F26-1). The label inside the source is what 'noticeSource' put there, so it is charged against
// the source's room and is truncated with it; 'boundedNotice' passes 'labelLength' so the room is
// sized from the label the notice actually carries. A detail that cannot fit even beside the
// separator is cut by the caller, which is where the reason at its head is kept.
function noticeSourceLength(sourceLength, detailLength, cap, floor) {
  if (sourceLength + NOTICE_SEPARATOR_CHARS + detailLength <= cap) return sourceLength;
  // The source gives way to the detail's room and never takes more than its own half of what the
  // cap has after the separator. It does not give way past 'floor', which is the label the notice
  // has to keep to name a source at all (F26-1): the label is a fixed cost of the documented
  // 'source: detail' shape and the detail is what is cut to pay for it. A detail longer than
  // 'cap - 2' therefore reaches the caller's seam branch, which is where the reason at its head is
  // kept and the tail that carries the transport cause is kept with it.
  const room = Math.min(
    noticeSourceRoom(cap),
    Math.max(floor, cap - NOTICE_SEPARATOR_CHARS - detailLength),
  );
  return Math.max(0, Math.min(sourceLength, room));
}

// The label a source starts with: the notice names its source by it, so it is the room the bound
// above never takes, and the separating space counts with it because the head the notice carries
// already ends with one ('rss ' + ': '). An empty source has no label to keep.
// The room the label is guaranteed, capped so a long single-word source cannot eat the detail's
// room: a notice is 'label name: detail' and the label is the first word, but a source that is one
// very long word (a bare target) has no label to speak of and must not reserve its whole length.
const NOTICE_LABEL_ROOM_CAP = 32;
function noticeLabelRoom(name) {
  const first = String(name ?? '').split(' ')[0];
  return Math.min(first.length, NOTICE_LABEL_ROOM_CAP);
}

// The published bytes of a line whose parts compose to it, from those two parts. This is the
// pre-Batch-33 composition and it is the result only while the whole-line pass agrees with it;
// 'boundedNotice' checks that before it is used, and every other caller works on 'whole' itself.
function composeParts(source, detail, cap, floor) {
  const frontLength = noticeSourceLength(source.length, detail.length, cap, floor);
  // The cap is the last word: a detail longer than 'cap - 2' cannot fit beside the separator, so
  // the line is cut at the cap here and 'boundedNotice' takes the seam branch that keeps both the
  // reason at the detail's head and the cause at its tail.
  return (source.slice(0, frontLength) + NOTICE_SEPARATOR + detail).slice(0, cap);
}

// The published bytes of the fallback: 'whole' is the whole-line redaction, so every slice of it
// is one pass's own output and none of them can carry a value that pass removed. When the parts do
// not compose to it (a rule read across the separator, or a value that spans it), the parts still
// say where the cut belongs -- the source's room, and the detail's whole or its tail -- and those
// positions are applied to 'whole' instead. When they cannot be found in it, the line is bounded
// on its own: the same positions taken from 'whole' direct.
function boundedNotice(whole, head, tail, cap, floor) {
  if (whole.length <= cap) return whole;
  // The fallback decides WHERE the cut belongs, and the bytes come from 'whole'. The parts' own
  // passes are kept only while they agree with the whole-line pass over the region they cover --
  // a rule that read across the ': ' seam, a value that spans it, or a value the whole line removed
  // and a part's own pass left standing (a value below the by-value floor that only the whole-line
  // rule reaches) all break the agreement, and the cut is then taken from 'whole' direct.
  const partsCompose = whole === head + NOTICE_SEPARATOR + tail
    && whole.startsWith(head) && whole.endsWith(tail);
  if (partsCompose) return composeParts(head, tail, cap, floor);
  // An empty source carries no separator: ': ' before a detail with no source on its left is the
  // dangling separator a reader cannot place (F26-1), and there is no source to name.
  if (head === '') return whole.slice(0, cap);
  const at = whole.lastIndexOf(NOTICE_SEPARATOR);
  if (at >= 0 && whole.startsWith(head.slice(0, at)) && whole.slice(at, at + NOTICE_SEPARATOR_CHARS) === NOTICE_SEPARATOR) {
    const source = whole.slice(0, at);
    const detail = whole.slice(at + NOTICE_SEPARATOR_CHARS);
    // The label and the separator are the last thing dropped and the detail's room is what is
    // charged against the cap here: the source is cut to 'cap - 2 - detail.length', never below the
    // label, so the published line still names its source and still leads with the reason.
    const line = composeParts(source, detail, cap, floor);
    if (line.length <= cap) return line;
  }
  // A text with no separator at all -- a caller's own phrase, a message with no source -- has no
  // detail to separate from a source, so there is no separator to keep and the line is bounded
  // around both of its ends.
  const keep = Math.max(0, cap - NOTICE_SEAM.length);
  if (keep <= 0 || cap <= NOTICE_SEAM.length) return whole.slice(0, cap);
  const front = Math.ceil(keep / 2);
  return whole.slice(0, front) + NOTICE_SEAM + whole.slice(whole.length - (keep - front));
}

// Reads the detail's message without trusting the object: a forged shape or a Proxy getter throws
// here rather than out of the assembly. A caller's plain object is read the same way every other
// string is, so a detail that is not an Error still publishes what its message says.
function detailMessageOf(detail) {
  if (detail === null || typeof detail !== 'object') return String(detail ?? '');
  try {
    return String(detail.message ?? '');
  } catch {
    return '';
  }
}

// A notice whose detail is empty carries no reason: it is the bare source and separator F26-1
// forbids, and a caller's object with no readable message is the one way to reach it. The words are
// the module's own -- no byte of the object is read, so nothing a forged shape carries can reach the
// notice here -- and the fallback keeps the cap like every other path.
const NO_DETAIL_REASON = 'a failure with no message';
function withReason(notice, head, tail, cap) {
  if (tail !== '') return notice;
  return (head.slice(0, Math.max(0, cap - NOTICE_SEPARATOR_CHARS - NO_DETAIL_REASON.length))
    + NOTICE_SEPARATOR + NO_DETAIL_REASON).slice(0, cap);
}

// Whether 'text' stands in 'line' as one contiguous run. The rebuild below is accepted only while
// it does, so the assembly can never publish a byte string the whole-line redaction did not
// produce: 'line' is that redaction, and a contiguous run of it is one of the strings one pass
// over the whole line returns. The rule reaches across the ': ' seam, so the rebuild is not
// required to be a prefix -- 'head' may be removed by a rule the parts' own passes never ran.
function containsSubstring(line, text) {
  return text.length > 0 && line.indexOf(text) !== -1;
}

// Whether 'text' can be read as a run of the line: either it stands in the line whole, or the line
// ends with it after a separator, which is how the compact transport form composes ('request
// failed: <cause>' out of a line that carries 'request failed for <url>: <cause>').
function isContiguous(line, text) {
  if (containsSubstring(line, text)) return true;
  const at = line.indexOf(NOTICE_SEPARATOR + text);
  return at >= 0 && at + NOTICE_SEPARATOR_CHARS + text.length === line.length;
}

// The shaped detail's own facts rebuild its text smaller than the cap, and the rebuild is the only
// source of published bytes other than 'whole' itself. It is accepted only when it IS a contiguous
// run of the whole-line redaction -- the shaper prices the text against the request's own set
// while the whole line is redacted against the run's union, which is wider, so a rebuild can put
// back a value the union removed -- and it must fit, carry something, and survive the notice
// rewriting. Otherwise this returns null and the whole line is what is bounded, which keeps the
// reason and never publishes a byte the whole-line pass did not produce. The source is dropped for
// this text, exactly as the pre-Batch-33 assembly dropped it: the status or the cause is what the
// rebuild exists to keep whole, and the cap may not hold both it and a source.
function repricedDetailWithin(whole, detail, secrets, cap, labelRoom) {
  const shaped = shapedDetailOf(detail);
  if (shaped === null) return null;
  // The re-price is bounded by the CAP, which is the bound the shaper's own choice between the
  // full text and its compact form turns on: bounded by anything smaller it chooses the compact
  // form even when the full text fits the notice, and the request is then dropped from a notice
  // that had room for it. Bounded by the cap it keeps the transport cause whole down to the 128
  // floor (the compact form is shorter than the line the notice would otherwise cut, so the cause
  // survives the cut), and the notice is bounded against it below.
  const repriced = repriceShapedError(shaped, secrets, cap);
  if (repriced === shaped) return null;
  let text = '';
  try {
    text = String(repriced.message ?? '');
  } catch {
    return null;
  }
  let priced = neutraliseNoticeText(text);
  if (priced.length === 0) return null;
  // A shaped transport text too long to stand beside the notice's label is rebuilt in the compact
  // form the shaper itself keeps for a bound it cannot fill: the request is dropped and the cause
  // stays whole, so the notice keeps its source AND the transport cause. The compact text is the
  // shaper's own and the cause it carries is a run of the whole-line redaction, which is what the
  // check below is for.
  // A shaped transport text the cap cannot hold beside the notice's label is rebuilt in the
  // compact form the shaper itself keeps for a bound it cannot fill: the request is dropped and
  // the cause stays whole, so the notice keeps its source AND the transport cause. Both forms are
  // runs of the whole-line redaction -- the stored text is the line's own tail and the compact text
  // is composed exactly as the line is -- and the shorter one that still names its source wins,
  // because the label is the part a reader uses to find the row. Only when neither fits beside the
  // label is the shorter one published on its own, which is the shape a cap below the label and the
  // detail together leaves.
  if (shaped.httpStatus === null && priced.length + NOTICE_SEPARATOR_CHARS + labelRoom > cap) {
    const stored = neutraliseNoticeText(String(shaped.message ?? ''));
    const compact = neutraliseNoticeText('request failed: ' + String(repriced.cause ?? ''));
    const candidates = [];
    if (stored.length > 0 && isContiguous(whole, stored)) candidates.push(stored);
    if (compact.length > 0 && isContiguous(whole, compact)) candidates.push(compact);
    const withLabel = candidates.find((f) => f.length + NOTICE_SEPARATOR_CHARS + labelRoom <= cap);
    if (withLabel !== undefined) priced = withLabel;
    else if (candidates.length > 0) priced = candidates.reduce((a, b) => (b.length < a.length ? b : a));
  }
  // The shaper bounds the text it rebuilds; a longer one (a shaper that ignores its bound) is cut
  // at the cap, which is the last gate. Either way it is published only while it is a contiguous
  // run of the whole-line redaction, so the assembly can never publish a byte that pass removed.
  const bounded = priced.length <= cap ? priced : priced.slice(0, cap);
  if (bounded.length === 0) return null;
  return (containsSubstring(whole, bounded) || isContiguous(whole, bounded)) ? bounded : null;
}

export function assembleNotice(source, detail, secrets, limit) {
  const cap = requireNoticeLimit(limit);
  const head0 = String(source ?? '');
  // An empty source publishes no separator: ': ' with nothing on its left is the dangling
  // separator F26-1 filed, and there is no source for it to introduce. Every shipped collector
  // names one, so this is the module surface's own case.
  const join = (text) => (head0 === '' && text.startsWith(NOTICE_SEPARATOR)
    ? text.slice(NOTICE_SEPARATOR_CHARS)
    : text);
  // A collector hands either the shaped Error itself (so the rebuild below can run) or its own
  // phrase; the text is the message in the first case and the string in the second -- String(err)
  // would publish Node's 'Error: ' prefix, which is not what the caller wrote.
  const tail0 = detailMessageOf(detail);
  // The whole line crosses the run's own redaction and the notice rewriting as ONE text, and it is
  // the only text the assembly may publish from: a value that spans the ': ' seam, a rule that
  // reads across it ('authorization: value', an unterminated tag opener reaching the detail's '>')
  // and the redaction of one part against a value the other part carries are all handled here,
  // once, in the order a reader of the line would apply them.
  const whole = neutraliseNoticeText(redactSecrets(head0 + NOTICE_SEPARATOR + tail0, secrets));
  const head = neutraliseNoticeText(redactSecrets(head0, secrets));
  const tail = neutraliseNoticeText(redactSecrets(tail0, secrets));
  if (whole.length <= cap) return join(withReason(whole, head, tail, cap));
  const labelRoom = Math.min(noticeLabelRoom(head0), cap);
  const repriced = repricedDetailWithin(whole, detail, secrets, cap, labelRoom);
  if (repriced !== null) {
    // The source is cut to the room the re-priced detail leaves, never below its label (F26-1), and
    // the whole line is the last word: the detail is already a slice of the whole-line redaction, so
    // the cut can only land inside it and never re-introduce a byte the pass removed.
    // The source is cut to the room the rebuilt detail leaves it, and DROPPED when the whole line
    // cannot fit beside it: the rebuilt text is the shortest honest form of the detail, it is
    // bounded by the cap, and a notice that cut it to make room for a source would lose the
    // transport cause it exists to keep. This is the shape the assembly published before the whole
    // line became the source of bytes, and the whole line still is: the text is published only
    // while it is a contiguous run of that redaction.
    const room = Math.max(0, cap - NOTICE_SEPARATOR_CHARS - repriced.length);
    if (room === 0) return join(repriced.slice(0, cap));
    // The head is a slice of the WHOLE line, never the head's own pass: 'head' is a different
    // text from 'whole' whenever a rule read across the ': ' seam or a value spanned it, and a
    // slice of it can carry a byte the whole-line pass removed (the F27-5 class). 'whole' is
    // always long enough -- it starts with the whole of head0 and the redaction only removes.
    const line = whole.slice(0, Math.min(whole.length, room)) + NOTICE_SEPARATOR + repriced;
    return join(line.length <= cap ? line : repriced.slice(0, cap));
  }
  return join(boundedNotice(whole, head, tail, cap, labelRoom));
}
// The push a notice built as '<source>: <detail>' uses, so the two parts stay apart until the cap
// is applied. A caller that carries one already-assembled string -- a re-redaction pass, a message
// with no source of its own -- keeps pushNotice above.
// A collector that has the shaped error in hand passes the Error itself, not only its message:
// the assembly re-prices from the shaped facts when the cap is tight, and a caller that passes the
// text alone has no facts for that rebuild. Both forms are accepted -- a collector's own phrase is
// a string -- and the two produce the same notice whenever the cap is not the one thing deciding.
function pushNoticeParts(notices, source, detail, secrets, limit) {
  notices.push(assembleNotice(source, detail, secrets, limit));
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

// The notices as they are published: each one redacted against the union above, which the push
// already applied when it priced the notice, so this is the confirmation that the collection has
// no value the run's own output still carries. The pass is a fixed point -- a marker it wrote is a
// span no later pass reads, so re-applying it changes nothing, not even when a collected value is
// a substring of the marker itself -- and the notice keeps the host and the reason it exists, so it
// stays diagnosable. It stays because a caller can reach this module's collectors without
// collectAll, and the source's own rows are then the union the push priced against.
function redactNotices(notices, secrets, limit) {
  const out = [];
  for (const notice of notices) pushNotice(out, notice, secrets, limit);
  return out;
}

// A response that will not parse is shaped here rather than quoted: Node's SyntaxError carries
// the head of the body (or the ten characters around the error position) in its message, and
// which part of a credential that slice holds is the parser's choice, so no by-value redaction
// can identify it. The notice names the endpoint and says the answer was not JSON, which is
// what a reader of a degraded source needs, and the body never reaches the notice at all.
function parseJson(text, url, omitUrl = false) {
  try {
    return JSON.parse(text);
  } catch {
    // A discovered target's URL spells the answer's own name, so that path answers with no
    // request in the message at all and the notice names the organisation row and the ordinal.
    throw new Error(omitUrl ? 'the response was not JSON' : `the response was not JSON (${redactUrl(url)})`);
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
  // Every collector can push a notice, so a run with a row to read requires the notice cap too. A
  // run whose rows were all deselected pushes no notice and requires none -- but a value the file
  // does carry is still validated, wherever it is read, and not only here (TR-151).
  if (rows.length > 0) keys.add('notice_max_chars');
  for (const row of rows) {
    for (const key of SOURCE_SETTINGS[row.kind] ?? []) keys.add(key);
  }
  return keys;
}

// Whether the file actually carries a key. A key that is present is validated wherever it is
// read, whether or not a selected row reads it; a key that is absent is not a configuration
// error, because a configuration that carries only the settings its own rows need stays legal.
function settingPresent(settings, key) {
  return settings !== null && typeof settings === 'object'
    && Object.prototype.hasOwnProperty.call(settings, key)
    && settings[key] !== undefined;
}

function validateSettings(settings, rows, options) {
  const keys = requiredSettingKeys(rows, options);
  for (const key of keys) {
    const n = Number(settings?.[key]);
    if (!Number.isInteger(n) || n <= 0) {
      throw configError(`${key} is missing or invalid in config/settings.md`);
    }
  }
  // A window cap the clock cannot carry is a configuration error that names the setting: the
  // start is the clock minus this many weeks, and an unrepresentable reach-back used to pass
  // here as a legal value and then throw the runtime's own 'Invalid time value' from
  // windowStart, a message that names no setting at all.
  if (keys.has('window_cap_weeks') && Number(settings.window_cap_weeks) > MAX_WINDOW_WEEKS) {
    throw configError(windowCapError(settings.window_cap_weeks));
  }
  // The two bound settings are validated whenever the file carries them, not only when a selected
  // row reads them (TR-151). A run whose rows were all deselected still resolves the notice cap
  // inside collectAll and still checks the room it leaves for the shaped error text, so a
  // mistyped file has to be refused here, by name, rather than surfacing from that seam as the
  // code reserved for an unexpected failure.
  const capPresent = settingPresent(settings, 'notice_max_chars');
  const cap = capPresent ? Number(settings.notice_max_chars) : null;
  // The notice cap is a positive integer like the rest, but it has a usable range as well: a cap
  // too small for the source, the status and the cause, and a cap too large to bound anything,
  // are each refused here -- before the first request -- so the operator reads a configuration
  // error that names the setting instead of a published notice that carries no diagnosis.
  if (capPresent && !usableNoticeCap(cap)) {
    throw configError(outOfRangeCap(settings.notice_max_chars));
  }
  // The snippet bound is the other half of that pair, so it is validated whenever it is present
  // too: its own type first, then the room the cap leaves it below.
  const snippetPresent = settingPresent(settings, 'error_snippet_max_chars');
  if (snippetPresent) {
    const snippet = Number(settings.error_snippet_max_chars);
    if (!Number.isInteger(snippet) || snippet <= 0) {
      throw configError('error_snippet_max_chars is missing or invalid in config/settings.md');
    }
  }
  // ... and the cap is checked against the shaped-error bound it has to carry, not on its own.
  // The two were validated independently, so a cap that was legal by itself still cut the cause
  // away: with the shipped snippet bound the notice read 'request failed for <url>' and ended
  // there. The cap the check uses is the one the run will actually resolve -- the configured
  // value, or the shipped fallback when the file carries no cap row at all -- so a snippet bound
  // too large for that fallback is refused here rather than inside collectAll.
  if (capPresent || snippetPresent) {
    requireNoticeCapRoom(capPresent ? cap : noticeLimit(settings), settings);
  }
  const github = rows.some((r) => r.kind === 'github-repo' || r.kind === 'github-org');
  const reserve = Number(settings?.github_rate_limit_reserve);
  if (github && (!Number.isInteger(reserve) || reserve < 0)) {
    throw configError('github_rate_limit_reserve is missing or invalid in config/settings.md');
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
    throw configError('output_dir is missing or invalid in config/settings.md');
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
    throw configError('request_timeout_ms is missing or invalid in config/settings.md');
  }
  return ms;
}

// The default reach-back is configuration, never a literal: window_cap_weeks is the
// only source of it, so a settings file that omits it is a configuration error
// rather than a silent four weeks.
export function windowStart(settings, now) {
  const weeks = Number(settings.window_cap_weeks);
  if (!Number.isFinite(weeks) || weeks <= 0) {
    throw configError('window_cap_weeks is missing or invalid in config/settings.md');
  }
  // The same named refusal here, so a direct caller that never runs validateSettings reads the
  // setting and not the date conversion's own 'Invalid time value'.
  if (weeks > MAX_WINDOW_WEEKS) throw configError(windowCapError(settings.window_cap_weeks));
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
    pushNoticeParts(acc.notices, name, err, ctx.secrets ?? [], noticeLimit(ctx.settings));
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

// A target a configuration named is configuration text; a target an organisation listing handed
// back is the answer's text, and a notice may quote the first and never the second. For a
// discovered repository the notice names the organisation row, which configuration supplied, and
// the repository's ordinal in that listing, which is arithmetic. The discovered name is never a
// value a notice is redacted against (TR-141): a redaction set is a list of strings the run
// deletes from its own output, so a name taken from an answer would let that answer choose which
// words of the run's notices and published prose survive.
function githubSource(label, t, limit) {
  if (!t.discovered) return noticeSource(label, String(t.target ?? ''), limit);
  return listingSource(label, t.org, t.ordinal, limit);
}
// The source of a notice about one entry of an organisation listing. noticeSource bounds the name
// to half the cap and cuts it from the right, so the position is written first and the
// organisation row's own name is what a short bound shortens: the row is configuration and may be
// any length, while the position is arithmetic and is what makes the notice actionable, so the
// position is the part that must survive the cut (TR-153).
function listingSource(label, org, ordinal, limit) {
  return noticeSource(label, `repository ${ordinal} in ${String(org ?? '')}`, limit);
}
// What one listing's non-conforming entries are reported as. The entries are aggregated into one
// notice carrying their count, because a listing answer may hold any number of them and one
// answer must not decide the volume of the run's published output (TR-152); the run's own noun
// for what it refused is kept, so the notice still says what was skipped.
function skippedListingPhrase(n) {
  return n === 1
    ? `skipped ${n} listing entry name, which is not a repository name`
    : `skipped ${n} listing entry names, which are not repository names`;
}
// What one listing's page did to it, when the answer filled the page that was requested. The page
// size is configuration and the count is arithmetic, so the notice carries no upstream text -- no
// repository name, no URL, no answer field (TR-166). It is the arXiv cap's counterpart in this
// file, which reports the same class of loss for a capped listing instead of looking complete: a
// listing whose answer filled the page may hold more than the page carried, and the run reads only
// that page, so without a word the truncated listing reads exactly like a complete one.
function listingPagePhrase(cap) {
  return `listing page filled at ${cap} repositor${cap === 1 ? 'y' : 'ies'}; entries past the first page were not requested`;
}
// The page size GitHub actually enforces. Its per_page parameter is clamped at this ceiling
// without an error -- a request for 500 is answered with a 100-entry page and status 200 -- so a
// setting above it asks for a page the answer cannot fill. The report above compares against the
// page the run was given rather than against the number it asked for, or a legal
// github_org_repos of 101 or 500 would make a filled page indistinguishable from a short one and
// the silent loss the report exists for would be back (TR-170). The request still carries the
// configured value: asking for more than the ceiling is what the setting says.
const GITHUB_LISTING_PAGE_CEILING = 100;
function listingPageSize(requested) {
  return Math.min(requested, GITHUB_LISTING_PAGE_CEILING);
}
// The shape a repository name has: exactly one slash, an owner that is a GitHub login, and a
// repository name of the characters GitHub allows in one. A listing's name is answer text that
// would otherwise reach the request URL and the run-wide redaction sets, so it is used only when
// it is a repository name and skipped otherwise. The rule is deliberately narrower than the URL
// parser: no query, no userinfo, no second slash, no segment made only of dots (the URL
// serializer normalises such a segment away, so by-value removal could not cover its spelling),
// and not a value that is not a string at all -- String() coerces a number, an array or an object
// into something that reads like a name.
const REPO_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_NAME = /^(?![.]+$)[A-Za-z0-9._-]{1,100}$/;
function repositoryName(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  if (parts.length !== 2) return false;
  return REPO_OWNER.test(parts[0]) && REPO_NAME.test(parts[1]);
}
// The headers the two GitHub-keyed sources send, built in one place: the credential the run
// carries is part of what every notice is redacted against, and the set a notice is priced with
// has to be the set the requests actually send (TR-99), so the header cannot be spelled twice.
function githubHeaders() {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// The entries one listing is allowed to contribute: at most the configured number, most recently
// updated first, exactly as the setting's own note describes. per_page asks the answer for that
// many, but the answer is what decides how many it sends, so the same bound is applied to the
// answer here -- without it one listing sets the number of release requests the run makes and the
// number of failure notices it publishes, which is the amplification the non-conforming aggregate
// closed for its own class only (TR-158). An entry whose date cannot be read is not recency-ranked
// and not dropped: it keeps the answer's order and sorts after every dated entry, so an accepted
// repository is never lost to a missing timestamp.
function takeMostRecent(entries, bound) {
  return entries
    .map((entry, i) => ({ entry, i, at: Number.isFinite(entry.updated) ? entry.updated : null }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return a.i - b.i;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return (b.at - a.at) || (a.i - b.i);
    })
    .slice(0, bound)
    .map((ranked) => ranked.entry);
}
// The cause a notice about a discovered repository carries. The shaped error's own message is
// not used for one: it quotes the request, and the request's URL spells the answer's name in
// the URL serializer's spelling, which by-value removal cannot cover (a dot segment is
// normalised away). The status, or the fixed transport cause, is what the shaper classified,
// and the endpoint is the collector's own noun for the request it made, never the answer's
// text -- so the notice records the source, the status and the cause with no request in it.
function discoveredCause(endpoint, err) {
  if (Number.isInteger(err?.httpStatus)) return `HTTP ${err.httpStatus} for the ${endpoint} request`;
  if (typeof err?.cause === 'string' && err.cause !== '') return `request failed: ${err.cause}`;
  return String(err?.message ?? 'request failed');
}

export async function collectGithub(rows, ctx) {
  const candidates = [];
  const notices = [];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = githubHeaders();
  const s = ctx.settings;
  const limit = noticeLimit(s);
  // The set every notice this source pushes is priced against: the run's configuration-wide
  // union when the caller supplied one, and this source's own rows otherwise (a direct call).
  const union = ctx.secrets ?? rowsSecrets(rows, headers);
  const reserve = Number(s.github_rate_limit_reserve);
  if (!Number.isFinite(reserve) || reserve < 0) {
    throw configError('github_rate_limit_reserve is missing or invalid in config/settings.md');
  }
  // A request whose target came out of the organisation listing is fetched with omitUrl, so any
  // shaped error it raises names no request: the URL would spell the answer's own repository name,
  // and the URL serializer normalises a dot segment away, so by-value removal cannot cover that
  // spelling. Every request whose target came from configuration is fetched unchanged.
  const get = (url, omitUrl = false) => ctx.net.fetchText(
    url, ctx.timeout, headers, s.user_agent, s.error_snippet_max_chars, omitUrl,
  );
  // Probe the budget once, before the block: one free call instead of discovering an
  // exhausted limit once per row, 55 times over.
  let budget;
  const probeUrl = `${GITHUB_API}/rate_limit`;
  try {
    budget = coreBudget(parseJson(await get(probeUrl), probeUrl));
  } catch (err) {
    pushNoticeParts(notices, 'github', `rate limit could not be checked (${err.message}); ${uncheckedPhraseFor(rows)}`, union, limit);
    return { candidates, notices: redactNotices(notices, rowsSecrets(rows, headers), limit) };
  }
  if (budget.remaining === null) {
    pushNoticeParts(notices, 'github', `rate limit could not be checked (the probe reported no core budget); ${uncheckedPhraseFor(rows)}`, union, limit);
    return { candidates, notices: redactNotices(notices, rowsSecrets(rows, headers), limit) };
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
    // The setting bounds both halves of the exchange: the per_page the listing is asked for and
    // the number of entries the run will take from it. It is resolved where the row is read, so a
    // configuration that carries no organisation row is never asked for it, and a value that is
    // present but unusable is refused by name rather than entering the arithmetic.
    const perOrg = Number(s.github_org_repos);
    if (!Number.isInteger(perOrg) || perOrg <= 0) {
      throw configError('github_org_repos is missing or invalid in config/settings.md');
    }
    const page = listingPageSize(perOrg);
    const url = `${GITHUB_API}/orgs/${row.target}/repos`
      + `?per_page=${encodeURIComponent(perOrg)}&sort=updated`;
    try {
      const body = parseJson(await get(url), url);
      if (!Array.isArray(body)) throw new Error('unexpected response shape');
      // A listing entry whose name is not a repository name is answer text the run refuses: it is
      // never put in a URL, never a request target, and never a value a notice is redacted
      // against. The entries of one listing are counted and reported once, after the listing has
      // been read, so the count of notices is the run's own and not the answer's (TR-152); the
      // first refused position is named at every count, not only when there is one, so an operator
      // told that two entries are bad can still find the first of them where it sat (TR-159), and
      // it is named through listingSource, which keeps the position when the organisation row is
      // long enough to fill the bound (TR-153).
      let refused = 0;
      let firstRefused = 0;
      const accepted = [];
      for (let n = 0; n < body.length; n += 1) {
        const repo = body[n];
        if (!repo || !repositoryName(repo.full_name)) {
          refused += 1;
          if (firstRefused === 0) firstRefused = n + 1;
          continue;
        }
        // The listing's own position is the repository's ordinal, and the organisation row is
        // configuration: those two are what a notice about this repository may name. The date is
        // read only to rank the accepted entries; it never reaches a notice.
        accepted.push({ name: repo.full_name, ordinal: n + 1, updated: Date.parse(repo.updated_at) });
      }
      const retained = takeMostRecent(accepted, page);
      for (const entry of retained) {
        targets.push({
          target: entry.name, domain: row.domain, discovered: true, org: row.target, ordinal: entry.ordinal,
        });
      }
      // The loss this listing can actually suffer is the opposite of a drop inside the answer: the
      // request asks for one page and reads it, so the slice above can never be smaller than what
      // the answer sent -- a report of that drop is unreachable with a conformant answer (TR-166).
      // What is silent is the page it filled: a listing that answered with exactly the requested
      // count may hold more than the page carried, and the run neither asks for the next page nor
      // says so, so its output is identical to a listing that really ended there. The report is
      // the run's own arithmetic -- the page it asked for and the count it never requested -- and
      // it is emitted only when the answer filled the page, which is the only case in which an
      // entry can have gone unread. A shorter answer cannot have lost one, so nothing is said.
      // The count compared and named is the page GitHub enforces, not the number requested: above
      // the ceiling the two differ, and comparing against the setting made the report unreachable
      // exactly where the loss is real (TR-170).
      if (body.length >= page) {
        pushNoticeParts(notices, noticeSource('github', row.target, limit), listingPagePhrase(page), union, limit);
      }
      if (refused > 0) {
        pushNoticeParts(notices, listingSource('github', row.target, firstRefused, limit), skippedListingPhrase(refused), union, limit);
      }
    } catch (err) {
      pushNoticeParts(notices, noticeSource('github', row.target, limit), err, union, limit);
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
      const body = parseJson(await get(url, t.discovered), url, t.discovered);
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
      // A discovered repository's notice is built from the classification, never from the
      // shaped message: the message quotes the request, and its URL spells the answer's name.
      const detail = t.discovered ? discoveredCause('releases', err) : err.message;
      pushNoticeParts(notices, githubSource('github', t, limit), detail, union, limit);
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
      const body = parseJson(await get(url, t.discovered), url, t.discovered);
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
      const detail = t.discovered ? discoveredCause('tags', err) : err.message;
      pushNoticeParts(notices, githubSource('github-tags', t, limit), detail, union, limit);
      if (refused(err)) { shortfall.tags = tagFallbacks.length - i - 1; break; }
    }
  }

  if (tagLeads > 0) {
    pushNoticeParts(notices, 'github-tags', `${tagLeads} undated tag ${tagLeads === 1 ? 'lead' : 'leads'} carried `
      + '(the tags API has no date, so they cannot be window-filtered)', union, limit);
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
    pushNotice(notices, budgetNotice(reported, shortfall, Boolean(token)), undefined, limit);
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, headers), limit) };
}

export async function collectArxiv(rows, ctx) {
  const candidates = [];
  const notices = [];
  const limit = noticeLimit(ctx.settings);
  const union = ctx.secrets ?? rowsSecrets(rows, {});
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
        pushNoticeParts(notices, noticeSource('arxiv', row.target, limit), `listing capped at ${cap} ${cap === 1 ? 'entry' : 'entries'}; older items inside the window may be missing`, union, limit);
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
      pushNoticeParts(notices, noticeSource('arxiv', row.target, limit), err, union, limit);
    }
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, {}), limit) };
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
  const limit = noticeLimit(ctx.settings);
  const union = ctx.secrets ?? rowsSecrets(rows, {});
  for (const row of rows) {
    const target = String(row.target ?? '').trim();
    if (!fetchableTarget(target)) {
      pushNoticeParts(notices, noticeSource('rss', redactUrl(target) || '(empty target)', limit), 'unsupported scheme (only http and https are fetched)', union, limit);
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
      pushNoticeParts(notices, noticeSource('rss', redactUrl(target), limit), err, union, limit);
    }
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, {}), limit) };
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
  // The reset is a Unix second count from the answer, and an answer is upstream text: one no
  // Date can hold -- 1e300 seconds, say -- made the conversion throw RangeError, and the probe's
  // own catch then turned a readable allowance into 'rate limit could not be checked'. An
  // out-of-range reset is treated exactly like the non-finite ones: absent.
  const resetMs = reset * 1000;
  const resetInRange = Number.isFinite(reset) && reset > 0
    && Number.isFinite(resetMs) && resetMs <= MAX_DATE_MS;
  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    limit: Number.isFinite(limit) ? limit : null,
    resetAt: resetInRange ? new Date(resetMs).toISOString() : null,
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
  const limit = noticeLimit(ctx.settings);
  const union = ctx.secrets ?? rowsSecrets(rows, {});
  for (const row of rows) {
    const spec = REGISTRY[row.kind];
    if (!spec) { pushNotice(notices, `registry unknown kind ${row.kind}`, undefined, limit); continue; }
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
        pushNoticeParts(notices, noticeSource(row.kind, row.target, limit), 'no release time for the latest version; candidate skipped', union, limit);
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
      pushNoticeParts(notices, noticeSource(row.kind, row.target, limit), err, union, limit);
    }
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, {}), limit) };
}

export async function collectAdvisories(rows, ctx) {
  const candidates = [];
  const notices = [];
  const limit = noticeLimit(ctx.settings);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  // The GHSA header is built once, so the union the notices are priced against cannot drift from
  // the header the requests actually send (TR-99).
  const ghsaHeaders = githubHeaders();
  const union = ctx.secrets ?? rowsSecrets(rows, ghsaHeaders);
  for (const row of rows) {
    try {
      if (row.kind === 'ghsa') {
        const headers = ghsaHeaders;
        const url = `${GITHUB_API}/advisories`
          + `?per_page=${encodeURIComponent(ctx.settings.ghsa_page_size)}`
          + `&published=${(ctx.since ?? '').slice(0, 10)}..${(ctx.until ?? '').slice(0, 10)}`;
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
            pushNoticeParts(notices, row.kind, 'skipped an advisory whose identifier is not a CVE id', union, limit);
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
      pushNoticeParts(notices, row.kind, err, union, limit);
    }
  }
  return { candidates, notices: redactNotices(notices, rowsSecrets(rows, ghsaHeaders), limit) };
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
  // The union every notice is PRICED against, which is not the same question as the union it is
  // finally redacted against: a notice has to be priced with the values it will actually carry,
  // and the run's own union is only complete once every source has run. It is therefore built
  // from configuration before the first request -- every selected row's own request values,
  // through the same requestSecrets the requests use, with the headers that source sends -- which
  // is a superset of what the run goes on to issue (a row the budget refuses issues nothing, and
  // its value is only redacted earlier than the union pass would have redacted it). issuedSecrets
  // stays as the record of what was actually sent, and both passes below stay as the no-ops they
  // have become: a notice priced against a superset cannot be rewritten by a subset of it
  // (TR-168).
  const runSecrets = new Set();
  const baseNet = opts.net ?? { fetchText, hostOf, isDiscoveryOnly };
  const ctx = {
    // Normalised here as well as at parse time, so a direct caller passing an
    // offset-bearing spelling cannot filter differently from its Z spelling.
    since: toIso(opts.since), until: toIso(opts.until), settings: config.settings,
    timeout: resolveTimeout({ timeout: opts.timeout ?? null }, config.settings),
    net: {
      ...baseNet,
      fetchText: async (url, timeout, headers, ...rest) => {
        // A request is issued with omitUrl (the last argument) when its target came out of an
        // answer rather than out of configuration. Such a request carries no request credential
        // of its own: its URL spells the answer's text, so anything a URL reader found in it
        // would be answer text registered as a string the run deletes from every notice and
        // every candidate field. It therefore contributes to neither union (TR-141). The
        // request's own notice still carries the caller's credential list at the push.
        if (rest[2] !== true) {
          const { all, credentials } = requestSecretSets(url, headers);
          for (const secret of all) issuedSecrets.add(secret);
          for (const secret of credentials) issuedCredentialSecrets.add(secret);
        }
        // A shaped failure is priced here against the run-wide union as well as against the
        // request's own values, because that is the set the notice is published under: the shaper
        // bounds the text it builds to error_snippet_max_chars, and a value only another row's
        // request carried used to be removed from it afterwards, lengthening a text that was
        // already priced until the assembled notice had no room for the status and the cause. The
        // re-pricing is a rebuild from the shaped error's own facts (the status or the transport
        // cause, the request), never a re-cut of the text, and a text it cannot bound is left as it
        // was -- the cap assembly below keeps the detail whole whatever arrives (TR-168).
        try {
          return await baseNet.fetchText(url, timeout, headers, ...rest);
        } catch (err) {
          const priced = repriceShapedError(err, runSecrets, rest[1]);
          throw priced === err ? err : priced;
        }
      },
    },
    domains: opts.domains ?? null,
    secrets: runSecrets,
  };
  const rows = (kind) => config.watchlist.filter(
    (r) => r.kind === kind && (!ctx.domains || ctx.domains.includes(r.domain)),
  );
  // Seeded before the first source runs, over exactly the rows this run selected, so a notice is
  // never priced against a smaller set than the one it is published under.
  const credentialedHeaders = githubHeaders();
  for (const row of config.watchlist) {
    if (ctx.domains && !ctx.domains.includes(row.domain)) continue;
    const headers = row.kind === 'ghsa' || row.kind === 'github-repo' || row.kind === 'github-org'
      ? credentialedHeaders : {};
    for (const secret of requestSecrets(row.target, headers)) runSecrets.add(secret);
  }
  // The cap is resolved and checked here as well as in validateSettings: collectAll is a public
  // seam that can be driven without it, and a cap that cannot carry the shaped error text the
  // snippet bound produces has to be refused wherever it arrives, not only through the CLI
  // (TR-142). Only the value the run will actually use is checked.
  requireNoticeCapRoom(noticeLimit(config.settings), config.settings);
  const acc = { candidates: [], notices: [] };
  // The kinds this run knows how to read. A row whose kind is outside this vocabulary cannot be
  // dispatched: it used to be filtered away with no candidate, no notice and no warning, which
  // is the silent skip the module's own rule forbids. It is reported once, naming the kind, and
  // the run degrades visibly instead (TR-144).
  const knownKinds = new Set(Object.keys(SOURCE_SETTINGS));
  for (const row of config.watchlist) {
    if (ctx.domains && !ctx.domains.includes(row.domain)) continue;
    if (knownKinds.has(row.kind)) continue;
    pushNotice(acc.notices, `watchlist: unknown source kind ${JSON.stringify(String(row.kind))}; the row was not read`, undefined, noticeLimit(config.settings));
  }
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
  // row, is redacted once more against every value of every request the run issued. Every notice
  // was already priced against the configuration-wide superset of this set (runSecrets above), and
  // the redaction is a fixed point, so the pass is a confirmation rather than a rewrite: it cannot
  // change a notice the push published, and in particular cannot lengthen one after its cap was
  // applied, which is the seam TR-168 closes.
  const union = [...issuedSecrets];
  const credentialUnion = [...issuedCredentialSecrets];
  const notices = [];
  for (const notice of acc.notices) pushNotice(notices, notice, union, noticeLimit(config.settings));
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

// The one line an operator sees for a degraded run. A transport failure ends in the fixed
// cause the shaper read from curl's exit code, from the signal that ended the tool, or -- when
// curl never started -- from the spawn code, so the line repeats that reason: a broken dependency
// should not require reading the pool to be seen. The vocabulary is the shaper's, never curl's
// own line, so this line cannot carry the redirect host or the proxy name into an operator's
// terminal either. It is a repeat
// and not a promise: a notice that ends in an HTTP status or a JSON-parse failure carries no
// transport reason, and the line then keeps the plain count.
//
// The mapped causes are published as '<phrase> (curl exit N)', so the suffix belongs to their
// alternatives: matching only the bare phrase left every mapped cause unmatched, which dropped
// the reason for six of the nine causes the shaper can build (LV-2).
const TRANSPORT_TAIL = /(?:could not resolve the host|failed to connect|timed out|TLS handshake failed|empty reply|partial transfer) \(curl exit \d+\)$|curl exited with status \d+$|curl could not be started \([^)]+\)$|curl was terminated(?: \([^)]+\))?(?: at the \d+ MiB capture ceiling)?$|curl failed$/;
export function operatorWarning(notices) {
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
    // collectAll is a public seam that resolves the bound settings itself, so a configuration
    // error can be raised after validateSettings has already run -- and it is still a
    // configuration error, the documented exit 2 that names the setting, never the code reserved
    // for an unexpected failure inside the collector (TR-151).
    console.error(`collect: ${err.message}`);
    const code = err instanceof ConfigurationError ? 2 : 1;
    process.exitCode = code;
    return code;
  }
  try {
    writeAtomic(out, `${JSON.stringify(pool, null, 2)}\n`);
  } catch (err) {
    // The pool is the only thing that carries the notices, and the write that just failed is
    // the one that would have published it, so the notices recorded before the failure are
    // printed here -- before the failure is reported -- instead of being lost with the pool
    // (TR-146). The operator line keeps the count contract; each notice follows in full.
    if (pool.notices.length > 0) {
      console.error(operatorWarning(pool.notices));
      for (const notice of pool.notices) console.error(`collect: notice: ${notice}`);
    }
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

