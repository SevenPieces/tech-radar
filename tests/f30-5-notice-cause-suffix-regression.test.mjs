// tests/f30-5-notice-cause-suffix-regression.test.mjs
// Independent regression tests for F30-5 (Low), the closing sweep's finding: at the notice cap's
// floor a redaction that LENGTHENS the source -- a one-character userinfo password, collected at
// any length, becomes the ten-character marker -- left a detail that no longer fitted the room the
// source's own cut had left it, and the composition cut that detail at the cap. The cut takes the
// tail, and the tail is where a transport cause sits: the notice kept the phrase and dropped the
// '(curl exit N)' suffix net.mjs publishes beside it (net.mjs's own comment: 'A mapped cause is
// published with its curl exit code beside it'), so the same notice reported the whole cause at a
// larger cap and a truncated one at 128/129, and the operator line -- whose transport vocabulary is
// anchored at the END of the notice -- fell back to the bare count.
//
// Every case drives the public seam: the shipped transport shaper for the detail and the exported
// assembly for the notice. The accepted pairs are found by bisection through collectAll with an
// empty selection, so a fix that moves the boundary is measured against the new one rather than
// against a number copied into this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleNotice, collectAll, operatorWarning } from '../scripts/collect.mjs';
import { shapeTransportError } from '../scripts/lib/net.mjs';
import { readSettings } from '../scripts/lib/mdtable.mjs';

const SHIPPED = readSettings(new URL('../config/settings.md', import.meta.url).pathname);
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const PROBE = { fetchText: async () => { throw new Error('an acceptance probe issues no request'); } };

// The sweep's own fixture, byte for byte: a target long enough to fill the source's half, and a
// one-character value in the run's union that the assembly's redaction rewrites to ten.
const LONG = 'rss https://a.example/x]( ' + 'y'.repeat(60);
const WIDENING = ['a'];
const CAUSES = [[6, 'could not resolve the host'], [7, 'failed to connect'], [28, 'timed out']];

async function pairAccepted(cap, snippet) {
  try {
    await collectAll(
      { settings: { ...SHIPPED, github_rate_limit_reserve: 2, notice_max_chars: cap, error_snippet_max_chars: snippet }, watchlist: [] },
      { ...WINDOW, net: PROBE },
    );
    return true;
  } catch {
    return false;
  }
}

async function largestAcceptedSnippet(cap) {
  if (!(await pairAccepted(cap, 1))) return 0;
  let lo = 1;
  let hi = Math.max(1, cap);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (await pairAccepted(cap, mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// One transport notice at a pair, exactly as a collector builds it: the shaper bounds the detail
// by the snippet setting, the assembly bounds the notice by the notice setting.
function transportNotice(source, cap, snippet, secrets, code = 6) {
  const shaped = shapeTransportError({ status: code }, source.replace(/^[a-z-]+ /, ''), snippet, {}, false);
  return assembleNotice(source, shaped, secrets, cap);
}

// F30-5's own reproduction: the bound the sweep drove the shaper with (the cap itself, which the
// module seam accepts and the shipped configuration refuses) and the lengthening redaction. Before
// the fix the notice read 'rss: request failed for https://[redacted]...: could not resolve the
// host' -- the phrase without its exit code -- at both 128 and 129, while the same fixture kept the
// suffix at 200 and 402.
test('F30-5 the sweep reproduction keeps the whole mapped cause at the 128/129 floor', () => {
  for (const cap of [128, 129]) {
    for (const [code, phrase] of CAUSES) {
      const notice = transportNotice(LONG, cap, cap, WIDENING, code);
      assert.ok(notice.includes(phrase), 'the notice lost the cause phrase at ' + cap + ': ' + JSON.stringify(notice));
      assert.ok(notice.includes(phrase + ' (curl exit ' + code + ')'),
        'the notice lost the exit code beside the cause at ' + cap + ': ' + JSON.stringify(notice));
      assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at ' + cap);
      // The operator line reads the cause back off the END of the notice; a notice whose cause was
      // truncated is a degraded run reported with no reason at all.
      assert.ok(operatorWarning([notice]).endsWith('(' + phrase + ' (curl exit ' + code + '))'),
        'the operator line lost the transport reason at ' + cap + ': ' + operatorWarning([notice]));
    }
  }
});

// The required property, at every accepted pair: a notice that names a mapped transport cause
// carries the WHOLE cause, suffix included, and stays inside the cap. The pair is the largest
// snippet the cap accepts, found through the shipped check, so this is the notice the shipped
// configuration can actually produce.
test('F30-5 an accepted pair publishes the whole mapped cause inside the cap', async () => {
  for (const cap of [128, 129, 130, 402, 1000]) {
    const snippet = await largestAcceptedSnippet(cap);
    assert.ok(snippet > 0, 'no snippet bound was accepted at cap ' + cap);
    for (const [code, phrase] of CAUSES) {
      for (const secrets of [[], WIDENING, ['PLAINTEXTpw']]) {
        const notice = transportNotice(LONG, cap, snippet, secrets, code);
        assert.ok(notice.includes(phrase), 'the notice lost the cause at ' + cap + '/' + snippet + ': ' + JSON.stringify(notice));
        assert.ok(notice.includes(phrase + ' (curl exit ' + code + ')'),
          'the notice lost the exit code at ' + cap + '/' + snippet + ': ' + JSON.stringify(notice));
        assert.ok(notice.length <= cap, 'the notice is ' + notice.length + ' characters at ' + cap + '/' + snippet);
      }
    }
  }
});
