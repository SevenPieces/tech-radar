// scripts/lib/net.mjs
// Fetch, charset decoding and feed parsing for the tech-radar skill.
// Zero dependencies. Uses curl through child_process so that HTTP behaviour is the
// same wherever this runs, and so no polyfill or bundled dependency is needed.
import { execFileSync } from 'node:child_process';

export const DEFAULT_UA = 'tech-radar/1.0';

// curl -w appends this after the last byte of the response, so the final line of
// the captured bytes is always the HTTP status and never part of the body. This
// needs no option newer than -w, which every curl in the field has: the earlier
// --fail-with-body approach required curl 7.76 and made an older curl fail every
// transfer on an unknown-option error.
const WRITE_OUT = '\n%{http_code}';

// Pure and offline-testable: it splits the status line off the captured bytes and
// never touches the network. The body keeps its exact bytes, which matters for a
// body that legitimately ends in a newline and for non-UTF-8 charsets. A buffer
// with no readable status line is returned whole, with status 0.
export function splitCurlOutput(buf) {
  const nl = buf.lastIndexOf(0x0a);
  if (nl === -1) return { body: buf, status: 0 };
  const tail = buf.subarray(nl + 1).toString('utf8').trim();
  if (!/^\d{3}$/.test(tail)) return { body: buf, status: 0 };
  return { body: buf.subarray(0, nl), status: Number(tail) };
}

// Every bound in this module is policy and lives in config/settings.md; the transport
// refuses to guess one, so a caller that forgets to carry configuration fails loudly
// instead of returning an unbounded timeout or an unbounded server dump.
function requirePositive(value, what) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${what} must be a positive number, got ${JSON.stringify(value)}`);
  }
  return value;
}

// Two explicit entry points, because the two failure modes carry different facts
// and nothing may be inferred from a field that means something else.

// An HTTP status we obtained ourselves, from a transfer that completed (curl exit
// 0). Pure and offline-testable. The body snippet is bounded and tag-stripped so a
// notice cannot become an unbounded server dump.
export function shapeHttpError(status, body, url, limit) {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  const snippet = plainText(decodeBuffer(source), requirePositive(limit, 'the error snippet limit in characters'));
  const shaped = new Error(`HTTP ${status} for ${url}: ${snippet || 'no response body'}`);
  shaped.url = url;
  shaped.httpStatus = Number(status);
  shaped.body = snippet;
  return shaped;
}

// A child-process failure: curl exited non-zero, so no HTTP exchange completed.
// err.status is curl's *process* exit code and err.stdout may hold a partial body
// plus the write-out status line, so neither is read as an HTTP status; the cause
// is curl's own first stderr line, bounded like every other snippet. Pure and
// offline-testable.
export function shapeTransportError(err, url, limit) {
  const bound = requirePositive(limit, 'the error snippet limit in characters');
  const stderr = String(err?.stderr ?? '').trim();
  const first = stderr.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? '';
  const cause = first.length > bound ? first.slice(0, bound) : first;
  const shaped = new Error(
    `request failed for ${url}: ${cause || err?.message || 'unknown curl failure'}`,
  );
  shaped.url = url;
  shaped.httpStatus = null; // a transport failure has no HTTP status
  shaped.exitStatus = Number.isInteger(err?.status) ? err.status : null;
  shaped.body = '';
  return shaped;
}

export function curlBuffer(url, ms, headers = {}, ua = DEFAULT_UA, snippetLimit) {
  const args = ['-sSL', '--compressed', '--max-time', String(Math.ceil(requirePositive(ms, 'the request timeout in milliseconds') / 1000)), '-A', ua, '-w', WRITE_OUT];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  args.push(url);
  let raw;
  try {
    // stdio is spelled out so curl's own error line is captured instead of being
    // inherited: execFileSync otherwise prints the child's stderr on ours. The 64 MiB
    // ceiling is infrastructure rather than policy -- it bounds one child process's
    // captured output so a hostile or broken response cannot exhaust memory, and a
    // configuration value here would only let a typo take the run down.
    raw = execFileSync('curl', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw shapeTransportError(err, url, snippetLimit);
  }
  const { body, status } = splitCurlOutput(raw);
  // curl completed the exchange (exit 0) and the server answered 4xx/5xx: the only
  // case where a status is ours to report.
  if (status >= 400) throw shapeHttpError(status, body, url, snippetLimit);
  return body;
}

export async function fetchText(url, ms, headers = {}, ua = DEFAULT_UA, snippetLimit) {
  return decodeBuffer(curlBuffer(url, ms, headers, ua, snippetLimit));
}

export function decodeBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('\uFFFD')) return asUtf8;
  const head = asUtf8.slice(0, 300).toLowerCase();
  if (/encoding="(gbk|gb2312|gb18030)"/.test(head)) {
    return new TextDecoder('gbk').decode(buf);
  }
  return new TextDecoder('utf-8').decode(buf);
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// A numeric character reference may name a code point that does not exist
// (above 0x10FFFF) or that is not a Unicode scalar value (a surrogate). Feed
// input is arbitrary network data, so such a reference degrades to U+FFFD
// rather than throwing RangeError out of the collector.
function charOrReplacement(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return '\uFFFD';
  if (n >= 0xd800 && n <= 0xdfff) return '\uFFFD';
  return String.fromCodePoint(n);
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => charOrReplacement(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => charOrReplacement(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

function stripCdata(s) {
  return s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
}

export function field(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decodeEntities(stripCdata(m[1])).trim() : '';
}

export function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick = (pred) => {
    for (const attrs of links) {
      if (!pred(attrs)) continue;
      const href = /href\s*=\s*"([^"]*)"/i.exec(attrs);
      if (href) return decodeEntities(href[1]);
    }
    return '';
  };
  const isAlternate = (attrs) => /rel\s*=\s*"alternate"/i.test(attrs);
  return pick(isAlternate) || pick(() => true);
}

export function splitItems(xml) {
  const out = [];
  const patterns = [/<item\b[^>]*>([\s\S]*?)<\/item>/gi, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi];
  for (const re of patterns) {
    for (const m of xml.matchAll(re)) out.push(m[0]);
  }
  return out;
}

export function plainText(raw, limit) {
  const bound = requirePositive(limit, 'the character limit');
  const text = decodeEntities(String(raw).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text.length > bound ? text.slice(0, bound) : text;
}

export function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

export function isDiscoveryOnly(url, hosts) {
  const host = hostOf(url);
  if (!host) return false;
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}
