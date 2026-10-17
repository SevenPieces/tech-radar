// tests/f35-c-linear-authorization-scan.test.mjs
// Final verification F35-C (Low, a performance regression the verification measured). The
// authorization pass iterates once per credential-header line, and every one of its three keyword
// matchers used to be re-run from the resume point on every iteration. A matcher with no match left
// in the remainder scans that whole remainder before it answers null, so a spelling the text never
// carries made the pass quadratic in the number of header lines: the verification measured 8,000
// declined header rows at 3,040.8 ms against 1.7 ms at ded9b8c, and the same measurement on accepted
// header rows is quadratic at both of those revisions. Batch 82 advances each matcher instead of
// restarting it.
//
// The assertion below is NOT wall-clock. Time is the thing the fix improves, but a time bound is
// flaky on a loaded machine and it measures the machine as much as the rule. What the rule actually
// does is ask the regular-expression engine to scan characters, so this test counts them: every
// RegExp.prototype.exec call is wrapped for the duration of one synchronous call, and the distance
// the engine was asked to cover -- the match's index minus the lastIndex it started from, or the
// whole remaining subject when a global matcher answers null -- is summed. The count is
// deterministic: it is a function of the matches the engine returns, not of how fast it returns
// them. A sticky matcher tries exactly one position, so its null costs nothing.
//
// Measured with that instrument (both entry points agree; the credential is gone either way):
//   2,000 declined rows: 233,344,332 scanned characters before Batch 82 (ratio 4020.96 of the
//     text's length), 1,316,330 after (ratio 22.68)
//   2,000 accepted rows: 128,600,000 before (ratio 2009.38), 660,000 after (ratio 10.31)
// The old shape's ratio grows with the input -- 2020.95, 4020.96, 8020.96 for 1,000 / 2,000 / 4,000
// declined rows -- which is the quadratic; the new shape's ratio is constant at 22.68, which is what
// linear in the number of header lines means. The bound below is 50, so the shipped pass sits 2.2x
// under it and the quadratic sits 80x over it at 2,000 rows, and the gap widens with the input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const LF = String.fromCharCode(10);
const CRED = 'tok_' + '9f3a2c7d1e5b';
const ROWS = 2000;
// The ratio of scanned characters to the text's own length that the shipped pass is allowed. It is
// a property of the rule rather than of the input: the pass reads each line once, so the ratio does
// not move with the row count (22.68 for declined rows at 1,000, 2,000 and 4,000 alike).
const MAX_SCAN_RATIO = 50;

// The characters every RegExp.prototype.exec call in one synchronous redaction was asked to cover.
function redactAndCountScanned(text) {
  const originalExec = RegExp.prototype.exec;
  let scanned = 0;
  RegExp.prototype.exec = function countingExec(subject) {
    const s = typeof subject === 'string' ? subject : String(subject);
    const from = this.lastIndex >>> 0;
    const match = originalExec.call(this, s);
    if (match !== null) scanned += match.index - from;
    // A sticky matcher tries the one position it is anchored to, so a null scans nothing beyond it.
    else if (!this.sticky) scanned += s.length - from;
    return match;
  };
  try {
    return { out: redactSecrets(text, []), scanned };
  } finally {
    RegExp.prototype.exec = originalExec;
  }
}

function declinedText(rows) {
  return ('authorization: see the notes' + LF).repeat(rows) + 'authorization: ' + CRED + LF;
}

function acceptedText(rows) {
  return ('authorization: ' + CRED + LF).repeat(rows);
}

test('F35-C: the declined-header shape is scanned linearly in the number of header lines', () => {
  const text = declinedText(ROWS);
  const { out, scanned } = redactAndCountScanned(text);
  // The pass still reaches the end of the text: this is the Batch 74/77 property the cost fix must
  // not trade away, and it is why the pass is exercised at all.
  assert.equal(out.includes(CRED), false, 'the credential after the declined rows was published');
  assert.equal(redactCredentialShapes(text), out, 'the two entry points disagree');
  assert.ok(scanned <= MAX_SCAN_RATIO * text.length,
    'the declined shape scanned ' + scanned + ' characters over a ' + text.length + '-character text ('
    + (scanned / text.length).toFixed(2) + 'x, the bound is ' + MAX_SCAN_RATIO + 'x), which is the '
    + 'quadratic the three restarted matchers made');
});

test('F35-C: the accepted-header shape is scanned linearly in the number of header lines', () => {
  const text = acceptedText(ROWS);
  const { out, scanned } = redactAndCountScanned(text);
  assert.equal(out.includes(CRED), false, 'an accepted header line published its credential');
  assert.equal(redactCredentialShapes(text), out, 'the two entry points disagree');
  assert.ok(scanned <= MAX_SCAN_RATIO * text.length,
    'the accepted shape scanned ' + scanned + ' characters over a ' + text.length + '-character text ('
    + (scanned / text.length).toFixed(2) + 'x, the bound is ' + MAX_SCAN_RATIO + 'x)');
});

test('F35-C: the cost is linear at four times the input, on both shapes', () => {
  // The instrument above is a ratio, so the test that the pass is not quadratic is the test that the
  // ratio does NOT grow with the input: four times the rows must not cost more per character. The
  // old shape's ratio quadrupled (2,000.95 -> 8,020.96 for four times the declined rows).
  for (const text of [declinedText(ROWS), acceptedText(ROWS), declinedText(4 * ROWS), acceptedText(4 * ROWS)]) {
    const { scanned } = redactAndCountScanned(text);
    assert.ok(scanned <= MAX_SCAN_RATIO * text.length,
      'the per-character scan cost grew with the input: ' + scanned + ' over ' + text.length);
  }
});

// THE ASSERTION THAT DISCRIMINATES (Batch 85; closing sweep F36-5, test integrity). This case used
// to assert only that a text carrying NO keyword at all is cheap, and the sweep measured that the
// assertion passes on the reverted mutant: with no keyword anywhere, 'earliestAfter(-1, 0)' answers
// null and the pass ends after a SINGLE round of three execs, so the restarted (861aeb0) and the
// advanced (35f0761) forms are indistinguishable on that input. A text with no header line cannot
// exercise the pass at all. The prose text is still read here -- ordinary prose must stay byte for
// byte -- but the COST is now asserted on the input that makes the pass iterate without either of the
// two spellings it never carries ever matching: a row that names the header and carries no value the
// reader can start. Every row is read, the resume point advances on the unreadable-value exit, and a
// restarted matcher has to scan the whole remainder once per row -- which the bound below refuses.
test('F35-C: ordinary prose is left alone, and a header row with no readable value is scanned linearly', () => {
  const lines = ('the run covered 43 domains and merged 0 items' + LF).repeat(ROWS);
  const prose = redactAndCountScanned(lines);
  assert.equal(prose.out, lines, 'ordinary prose was rewritten');
  assert.ok(prose.scanned <= MAX_SCAN_RATIO * lines.length,
    'a text with no header line scanned ' + prose.scanned + ' over ' + lines.length);
  // A spelling the text never carries is the case that made the restarted matchers quadratic: the
  // two matchers that cannot match were asked to scan the whole remainder again on every iteration.
  const text = ('authorization:' + LF).repeat(ROWS);
  const { out, scanned } = redactAndCountScanned(text);
  assert.equal(out, text, 'a header row with no readable value was rewritten');
  assert.ok(scanned <= MAX_SCAN_RATIO * text.length,
    'the unreadable-value shape scanned ' + scanned + ' characters over a ' + text.length
    + '-character text (' + (scanned / text.length).toFixed(2) + 'x, the bound is ' + MAX_SCAN_RATIO
    + 'x), which is the quadratic the three restarted matchers made');
});
