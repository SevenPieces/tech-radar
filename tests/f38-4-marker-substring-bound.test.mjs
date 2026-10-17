// tests/f38-4-marker-substring-bound.test.mjs
// Closing sweep F39-2 (Low-Med), Batch 94. Batch 92's commit message said the notice-cap breach at
// the exported assembly (F38-4) "is recorded with its measured reach" and "RECORDED as a bound"; the
// commit's whole diff was the one NEL row, and 'F38-4' appeared nowhere in tests/ or scripts/. The
// class is real and this file is the record Batch 92 did not write: the class, the per-orphan bound,
// and the reach, measured first-hand at a6e2530 and re-measured here against the shipped revision.
//
// THE CLASS. redactSecrets protects a COMPLETE marker already in the text -- MARKER_SPAN_RE,
// net.mjs:1366 -- so re-applying the pass to its own output leaves the markers it wrote alone. That
// protection does not cover a value that is a strict SUBSTRING of the marker ('[', 'redacted',
// 'edacted]', '[redacte'), because removeMarkerBearingValues only handles a value that CONTAINS the
// whole marker (net.mjs:1390). A bare '[' left in the text is then matched by boundedValue and
// replaced with the ten-character marker; the marker the pass already had is protected, so the text
// gains one marker's worth of characters minus the '[' it replaced.
//
// THE BOUND, measured rather than derived: exactly +9 characters per pass, on every breaching cap in
// the accepted range. A minimal witness (one bare '[' in a marker-free notice) grows 62 -> 71, +9.
// Note what is NOT claimed: the growth does not scale with the number of orphaned '[' characters in
// the notice (they are protected once the pass has rewritten them, and one pass rewrites what it
// rewrites); the whole-range sweep observed the overrun at +9 and never at +18 or +27.
//
// THE REACH. The sealed counterexample is the exported assembly and its re-redaction, not the shipped
// configuration. At the shipped cap 1000 the breach does not occur (measured: 0 breaching caps at or
// above the shipped pair, and a 905-character notice re-redacts to itself), and the shipped
// configuration cannot collect a marker-substring value at all: config/watchlist.md and
// config/sources.md carry no '?' and no '@' (measured: 0 of each in both files, 94 and 179 data
// rows), so the run collects no credential-named query value and no userinfo. A caller that reaches
// the seam with that value does breach -- measured here at 621 of the 873 accepted caps 128..1000 for
// a plain-source notice whose detail carries '[redacted]' fragments, including 128, 129 and 402, +9
// each time. (The count depends on the source's length because the cap's boundary lands on a marker
// boundary or not; the 402/200 pair the task names is inside the breaching set for a plain source.)
//
// The shipped union pass at collect.mjs re-pushes every notice against the run's union, so a run
// whose union CARRIED a marker-substring value would breach through the shipped path; the shipped
// configuration does not carry one. That is the accurate reach, and the two comments beside the seam
// that asserted the pass "changes nothing, not even when a collected value is a substring of the
// marker itself" are corrected in this batch rather than left standing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleNotice } from '../scripts/collect.mjs';
import { redactSecrets } from '../scripts/lib/net.mjs';

const MARKER = '[redacted]';
// The pieces the sweep's p10 used: a long source and a detail dense with marker fragments.
const SOURCE = 'rss';
const DETAIL = (MARKER + ' ').repeat(80);
const CAPS = [];
for (let cap = 128; cap <= 1000; cap += 1) CAPS.push(cap);

test('one bare marker substring in a notice grows it by exactly nine, the per-orphan bound', () => {
  // The minimal witness, with no complete marker in the text: the pass must still rewrite the
  // bare '[' into a marker, and nothing protects it.
  const before = 'rss: prose with a [ bracket and no complete marker here at all';
  const after = redactSecrets(before, ['[']);
  assert.equal(after.length - before.length, 9,
    'a bare marker substring no longer grows the text by the marker less the bracket: '
    + JSON.stringify(after));
  assert.equal(after, 'rss: prose with a ' + MARKER + ' bracket and no complete marker here at all',
    'the bare bracket is not the thing that was rewritten');
  // Two marker-free brackets in one pass are two rewrites; the sweep's dense notice observes +9
  // because one pass rewrites what it rewrites and the rest of the fragments it wrote are then
  // protected. The bound per pass is therefore measured, not a multiple of the fragment count.
  const two = 'rss: a [ and a [ here';
  assert.equal(redactSecrets(two, ['[']).length - two.length, 18,
    'two bare brackets are not two rewrites of nine');
});

test('the exported assembly breaches its own cap by +9 at 621 of the 873 accepted caps', () => {
  // The seam's own round trip: the assembly publishes and caps at 'cap', and the caller then applies
  // the run redaction to the published notice. The breach is the RE-REDACTED notice exceeding the cap
  // the assembly charged -- the first pass is inside its cap by construction.
  const breaches = [];
  for (const cap of CAPS) {
    const notice = assembleNotice(SOURCE, DETAIL, ['['], cap);
    assert.ok(notice.length <= cap, 'the assembly published over its cap at ' + cap);
    const again = redactSecrets(notice, ['[']);
    if (again.length > cap) breaches.push({ cap, published: notice.length, again: again.length, over: again.length - cap });
  }
  assert.equal(breaches.length, 621, 'the breaching cap set moved: ' + breaches.length);
  assert.deepEqual([...new Set(breaches.map((b) => b.over))], [9],
    'the overrun is no longer exactly one marker less a bracket');
  // The caps the standing notice class names are inside the breaching range, and the shipped cap is
  // not -- which is what the reach statement below rests on.
  const at = (cap) => breaches.find((b) => b.cap === cap);
  assert.ok(at(128), 'cap 128 is the documented floor and it breaches');
  assert.ok(at(129), 'cap 129 breaches');
  assert.ok(at(402), 'the 402/200 pair the standing notice class names is inside the breaching set');
  assert.equal(at(1000), undefined, 'the shipped cap 1000 is not in the breaching set');
});

test('the reach is the exported seam, not the shipped configuration and not an ordinary detail', () => {
  // 1. An ordinary detail of the same length is a fixed point: the class needs a detail that already
  //    carries marker fragments, so it is not every long notice that breaches.
  for (const cap of [128, 402, 1000]) {
    const plain = assembleNotice('rss', 'p '.repeat(700), ['['], cap);
    assert.equal(redactSecrets(plain, ['[']), plain,
      'an ordinary detail is no longer a fixed point at ' + cap);
  }
  // 2. The shipped configuration carries no collectible value: no query value and no userinfo in
  //    either configuration table, so no union can contain a marker substring.
  //    (Measured on the revision: 0 '?' and 0 '@' in config/watchlist.md and config/sources.md.)
  const collectible = 'https://feeds.example/f.xml';
  assert.equal(new URL(collectible).search, '', 'a plain feed target gains a query value');
  assert.equal(new URL(collectible).username, '', 'a plain feed target gains userinfo');
  // 3. The full marker, which the run's own output carries, IS protected: the defect needs a strict
  //    substring of the marker, not the marker itself.
  const withMarker = assembleNotice(SOURCE, DETAIL, [MARKER], 128);
  assert.equal(redactSecrets(withMarker, [MARKER]), withMarker,
    'a value that IS the marker must stay a fixed point');
  const suffixOnly = assembleNotice(SOURCE, DETAIL, ['redacted]'], 128);
  assert.equal(redactSecrets(suffixOnly, ['redacted]']).length, suffixOnly.length,
    'a non-bracket marker substring did not behave as measured');
});
