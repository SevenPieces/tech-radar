// tests/notice-assembly-properties.test.mjs
// The property suite for the notice assembly: the invariants have to hold over a matrix of the
// collector paths, the accepted notice/snippet pairs and the shapes a detail and a credential can
// take, not only over the cases a regression file named. It exists because this one subsystem
// produced three successive rounds of assembly defects; the regressions were each fixed by a case,
// and a case is what the next one evades.
//
// P1  the published notice contains no value the whole-line redaction removes
// P2  it is within the cap with its status or its transport cause whole
// P3  it is a fixed point of the run's redaction and of the notice rewriting
// P4  it always carries a source and the ': ' separator
// P5  the run's own credential appears in no notice, no pool field and no rendered artifact, in any
//     spelling (plain, percent-encoded, escaped, base64, and the URL serializer's own respelling)
//
// Everything is offline: the collectors run against the documented opts.net seam and the rendered
// artifact is produced by the shipped renderer from the run's own pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleNotice, collectAll, neutraliseNoticeText } from '../scripts/collect.mjs';
import { redactSecrets, requestSecrets, shapeHttpError, shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';
import { render } from '../scripts/render-html.mjs';

const SHIPPED = readSettings(new URL('../config/settings.md', import.meta.url).pathname);
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const pad = (n, ch) => ch.repeat(n);
const settingsAt = (cap, snippet) => ({
  ...SHIPPED, github_rate_limit_reserve: 2, notice_max_chars: cap, error_snippet_max_chars: snippet,
});

// The accepted pairs the settings allow, plus the 128 floor: the range check reserves
// 2 * error_snippet_max_chars + 2, so these are exactly the pairs a run may be configured with.
const PAIRS = [[1000, 200], [402, 200], [128, 63], [128, 1]];

// ---------------------------------------------------------------------------------------
// P1..P4 over the assembly itself: every cap x every detail shape x every secret shape.
// ---------------------------------------------------------------------------------------

const SHORT = 'the response was not JSON (https://registry.example/pkg)';
const LONG = 'the response was not JSON (' + pad(400, 'q') + ')';
const MARKED = 'the service echoed token=ab[redacted]cd back';
const SEAM = 'a: the';
const VERY_LONG_VALUE = pad(300, 'Z');

function detailShapes(source) {
  return [
    ['shaped HTTP', shapeHttpError(503, 'answer body that must never be published', 'https://api.example/' + pad(200, 'u'), 200, {})],
    ['shaped transport', shapeTransportError({ status: 6 }, 'https://api.example/' + pad(200, 'u'), 200, {})],
    ['long non-shaped', LONG],
    ['short non-shaped', SHORT],
    ['empty', ''],
    ['separator-bearing', 'probe: the detail carries its own separator'],
    ['marker-bearing', MARKED],
    ['seam-bearing', SEAM + ' tail'],
    ['huge', pad(2000, 'w')],
  ];
}

function secretShapes(source) {
  return [
    ['none', []],
    ['seam value', [SEAM]],
    ['marker substring', ['redacted']],
    ['value containing the marker', ['ab[redacted]cd']],
    ['very short value', ['ab']],
    ['value longer than the cap', [VERY_LONG_VALUE]],
    ['separator itself', [': ']],
    // The credential as the whole configured target is not a shape a run can produce (a target
    // that IS the credential is a target the collector refuses before any request), so the source
    // case in SOURCES carries the value inside a URL instead.
  ];
}

const SOURCES = [
  'rss https://a.example/feed.xml',
  'rss',
  'pypi pkg-a',
  // A source that carries the credential the run holds: the value is what must not survive, and
  // the label is expected to give way with it (a notice does not have to keep a word its own
  // redaction removed).
  'rss https://a.example/feed.xml?token=' + SEAM,
  '',
];

test('P1/P3/P4 the assembly is a fixed point that carries a source and never a removed value', () => {
  let checked = 0;
  for (const cap of [128, 129, 200, 402, 1000]) {
    for (const source of SOURCES) {
      for (const [shape, detail] of detailShapes(source)) {
        for (const [secretShape, secrets] of secretShapes(source)) {
          checked += 1;
          const notice = assembleNotice(source, detail, secrets, cap);
          const where = cap + '/' + shape + '/' + secretShape + '/' + JSON.stringify(source);
          assert.equal(typeof notice, 'string', 'the notice is not a string at ' + where);
          assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at ' + where);
          // P1: no value the whole-line redaction removes survives.
          const reRedacted = neutraliseNoticeText(redactSecrets(notice, secrets));
          assert.equal(reRedacted, notice,
            'the notice is not a fixed point of the run pass at ' + where + ': ' + JSON.stringify(notice.slice(0, 60)));
          for (const value of secrets) {
            // The ': ' separator is the notice's own delimiter; the ten character marker is the
            // text a pass writes and the input's own marker is a span a pass protects, so a value
            // that is a substring of it proves nothing; and a value below the free-text floor is
            // one the pass does not remove wherever it stands. Everything else is a value the
            // whole-line pass removes, and it must not survive.
            if (value.length < 3 || value === ': ' || value.includes('[redacted]')
              || '[redacted]'.includes(value)) continue;
            assert.ok(!notice.includes(value),
              'the notice carries ' + JSON.stringify(value) + ' at ' + where + ': ' + JSON.stringify(notice.slice(0, 60)));
          }
          // P4: the published form names its source and carries the ': ' separator, with the one
          // documented exception -- a credential whose own value spans the ': ' seam is removed
          // across it, so that notice carries neither the seam nor a word of the value. The
          // dangling separator F26-1 filed is asserted everywhere.
          assert.ok(!notice.startsWith(': '),
            'the notice opens with a dangling separator at ' + where + ': ' + JSON.stringify(notice.slice(0, 40)));
          const seamSecret = secrets.some((v) => v.includes(': '));
          if (source !== '' && detail !== '' && !seamSecret) {
            const label = source.split(' ')[0];
            assert.ok(notice.startsWith(label),
              'the notice does not name its source at ' + where + ': ' + JSON.stringify(notice.slice(0, 40)));
            assert.ok(notice.includes(': '),
              'the notice carries no separator at ' + where + ': ' + JSON.stringify(notice.slice(0, 40)));
          }
        }
      }
    }
  }
  assert.ok(checked >= 1000, 'the matrix ran ' + checked + ' cases');
});

test('P2 a shaped detail keeps its status or its transport cause at every accepted pair', () => {
  for (const [cap, snippet] of PAIRS) {
    const url = 'https://user:PLAINTEXTpw@a.example/feed.xml?token=SECRETVALUE';
    const secrets = requestSecrets(url, {});
    const http = assembleNotice('rss ' + url, shapeHttpError(503, 'body', url, snippet, {}), secrets, cap);
    assert.ok(http.includes('HTTP 503'),
      'the HTTP notice lost the status at ' + cap + '/' + snippet + ': ' + JSON.stringify(http));
    const transport = assembleNotice('rss ' + url, shapeTransportError({ status: 6 }, url, snippet, {}), secrets, cap);
    assert.ok(transport.includes('could not resolve the host'),
      'the transport notice lost the cause at ' + cap + '/' + snippet + ': ' + JSON.stringify(transport));
    for (const notice of [http, transport]) {
      assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at ' + cap + '/' + snippet);
      assert.ok(!notice.includes('PLAINTEXTpw') && !notice.includes('SECRETVALUE'),
        'the notice carries the request credential at ' + cap + '/' + snippet + ': ' + JSON.stringify(notice));
    }
  }
});

// ---------------------------------------------------------------------------------------
// P1..P5 end to end: every collector path, through collectAll, into the pool and the artifact.
// ---------------------------------------------------------------------------------------

// Each row's target carries the run's credential, so the run has a value to protect and the stub
// answers every request with hostile text that echoes it.
const CREDENTIAL = 'not-json-token-value';
const HOSTILE_BODY = 'the service echoed token=' + CREDENTIAL + ' in its answer';

const ROWS = [
  { kind: 'rss', target: 'https://rss.invalid/feed.xml?token=' + CREDENTIAL, domain: 'ai-llm', note: '' },
  { kind: 'pypi', target: 'pkg-beta', domain: 'ai-llm', note: '' },
  { kind: 'npm', target: 'typescript', domain: 'ai-llm', note: '' },
  { kind: 'crates', target: 'tokio', domain: 'ai-llm', note: '' },
  { kind: 'gomod', target: 'k8s.io/client-go', domain: 'ai-llm', note: '' },
  { kind: 'github-repo', target: 'acme/repo', domain: 'ai-llm', note: '' },
  { kind: 'arxiv-category', target: 'cs.AI', domain: 'ai-llm', note: '' },
];

function hostileNet() {
  return {
    fetchText: async (url, timeout, headers, ua, limit, omitUrl) => {
      if (/api\.github\.com/.test(url)) {
        throw shapeHttpError(503, HOSTILE_BODY, url, limit, headers ?? {}, Boolean(omitUrl));
      }
      if (/export\.arxiv\.org/.test(url)) {
        throw shapeTransportError({ status: 6 }, url, limit, headers ?? {}, Boolean(omitUrl));
      }
      // Every registry and feed answers with text that is not JSON and echoes the credential.
      return HOSTILE_BODY;
    },
  };
}

// The credential in every spelling a run may hold or a server may echo.
function credentialSpellings() {
  const out = new Set([CREDENTIAL]);
  out.add(encodeURIComponent(CREDENTIAL));
  out.add(encodeURIComponent(encodeURIComponent(CREDENTIAL)));
  out.add(Buffer.from(CREDENTIAL).toString('base64'));
  out.add(Buffer.from('user:' + CREDENTIAL).toString('base64'));
  return [...out].filter((s) => s.length >= 3);
}

function publishedArtifact(pool) {
  // The shipped renderer over the run's own pool: a digest built from the pool's candidates with
  // the coverage note the gate requires, so every notice and every candidate field crosses the
  // renderer exactly as it would in a real run.
  const lines = [
    '# Technology Radar — 2026-09-23',
    '',
    '## Coverage',
    '',
    'The collector recorded ' + pool.notices.length + ' notice(s). Collector notices: ' + pool.notices.length,
    '',
    '## AI / LLM',
    '',
  ];
  for (const [i, candidate] of pool.candidates.slice(0, 4).entries()) {
    lines.push('### ' + (candidate.title || 'item ' + i));
    lines.push('');
    lines.push((candidate.summary || 'summary') + ' — [' + (candidate.url || 'https://a.example/' + i) + '](' + (candidate.url || 'https://a.example/' + i) + ')');
    lines.push('');
  }
  for (const notice of pool.notices) {
    lines.push('> ' + notice);
    lines.push('');
  }
  return render(lines.join('\n'), {
    title: 'Technology Radar — 2026-09-23',
    domains: [{ domain: 'AI / LLM', short: 'AI' }],
    settings: SHIPPED,
  });
}

test('P5 the run credential reaches no notice, no pool field and no rendered artifact', async () => {
  const spellings = credentialSpellings();
  for (const [cap, snippet] of PAIRS) {
    const pool = await collectAll(
      { settings: settingsAt(cap, snippet), watchlist: ROWS },
      { ...WINDOW, net: hostileNet() },
    );
    assert.ok(pool.notices.length > 0, 'the run published no notice at ' + cap + '/' + snippet);
    const artifact = publishedArtifact(pool);
    const poolText = JSON.stringify(pool);
    for (const spelling of spellings) {
      const where = JSON.stringify(spelling.slice(0, 24));
      for (const notice of pool.notices) {
        assert.ok(!notice.includes(spelling), 'a notice carries ' + where + ' at ' + cap + '/' + snippet);
      }
      assert.ok(!poolText.includes(spelling), 'the pool carries ' + where + ' at ' + cap + '/' + snippet);
      assert.ok(!artifact.includes(spelling), 'the rendered artifact carries ' + where + ' at ' + cap + '/' + snippet);
    }
    // P2 and P4 through the run: every notice is within its cap, is a fixed point, and names a
    // source with a separator.
    for (const notice of pool.notices) {
      assert.ok(notice.length <= cap, 'a notice is ' + notice.length + ' characters at ' + cap + '/' + snippet);
      assert.equal(neutraliseNoticeText(redactSecrets(notice, spellings)), notice,
        'a run notice is not a fixed point at ' + cap + '/' + snippet + ': ' + JSON.stringify(notice.slice(0, 50)));
      const label = notice.split(' ')[0];
      assert.ok(label.length > 0 && notice.includes(': '),
        'a run notice names no source or carries no separator at ' + cap + '/' + snippet + ': ' + JSON.stringify(notice.slice(0, 50)));
    }
  }
});
