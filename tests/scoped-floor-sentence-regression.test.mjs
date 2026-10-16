// tests/scoped-floor-sentence-regression.test.mjs
// Closing sweep F30-4 and the FINAL30 verification's section 7(iii) (Low, documentation): Batch 55's
// new sentence in SKILL.md section 5 stated the completeness floor as an unconditional constraint -
// 'a digest must meet total_min_items however many core domains came back quiet' - which is not the
// gate's rule for a scoped run. check-quality.mjs scores the floor with
// scopedMinItems(settings, catalogueSize, plan.perDomain, catalogueKeys), so a --domain-scoped run
// covering 14 of the 43 shipped domains has a floor of 15, one covering two domains a floor of 3, and
// a single-domain run a floor of 1. The 14-of-43 floor is 15 because of the one-per-covered-domain
// clause, not because of the scaled share: ceil(30 x 14 / 43) is 10 (closing sweep F31-9 measured
// that on the shipped settings the scaled share is at most the clamp for every N, for 2 <= N <= 29 the
// floor is exactly N + 1, and from N = 30 the clamp holds it at 30, so the corrected sentence names
// the clause that carries its number).
// Measured (the sweep's own probe): 29 items with a 14-domain plan
// produces NO floor failure, while the same 29 items against a whole-catalogue plan fails with
// '29 items is below total_min_items 30'.
//
// The sentence is now stated so that it is true for both a whole-catalogue and a scoped run, with
// the arithmetic, and this file drives the SHIPPED GATE to check it: the numbers the sentence names
// (thirty on the whole catalogue, fifteen for fourteen of the forty-three domains, one for a
// single-domain run) are asserted against scopedMinItems and against check(), and SKILL.md is
// asserted to carry the scoped wording rather than the old flat claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../scripts/lib/mdtable.mjs';
import { check, scopedMinItems } from '../scripts/check-quality.mjs';

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url));
const SKILL = fileURLToPath(new URL('../SKILL.md', import.meta.url));
const config = readConfig(CONFIG_DIR);
const CATALOGUE = config.domains.length;
const WINDOW = { since: '2026-09-16T00:00:00Z', until: '2026-09-23T00:00:00Z' };
const LABEL = 'Covering 2026-09-16 08:00 to 2026-09-23 08:00 (Asia/Shanghai) · cap not hit';

// A 29-item digest. It is deliberately not a rule-conformant digest: the floor is what this file
// measures, so only the floor's own failure text is asserted and every other rule is ignored.
function digestWith(items) {
  const lines = [
    '# Tech Radar — 2026-09-23',
    '_' + LABEL + ' · ' + CATALOGUE + ' domains scanned · ' + items + ' items_',
    '',
    'Nothing this week warranted a deep dive.',
    '',
    '## Core domains',
    '### ' + config.domains[0].domain + ' · ' + config.domains[0].label_zh,
  ];
  for (let i = 0; i < items; i += 1) {
    lines.push('- **Story ' + i + '** — Why it matters. '
      + '[src:arXiv 2026-09-20](https://arxiv.org/abs/' + i + ') [prov:primary] #new');
  }
  lines.push('', '## Coverage note', LABEL);
  return lines.join('\n');
}

// The plan's perDomain keys are the domains the run covers; the shipped settings read
// total_min_items 30 and the shipped catalogue is 43 domains.
const wholeCatalogue = {
  window: WINDOW,
  label: LABEL,
  perDomain: Object.fromEntries(config.domains.map((d) => [d.key, { ...WINDOW }])),
};
const scopedTo14 = {
  window: WINDOW,
  label: LABEL,
  perDomain: Object.fromEntries(config.domains.slice(0, 14).map((d) => [d.key, { ...WINDOW }])),
};

test('F30-4 the shipped catalogue and settings are the ones the sentence arithmetic names', () => {
  assert.equal(Number(config.settings.total_min_items), 30, 'the shipped floor moved');
  assert.equal(CATALOGUE, 43, 'the shipped catalogue size moved');
  assert.equal(Object.keys(wholeCatalogue.perDomain).length, 43);
  assert.equal(Object.keys(scopedTo14.perDomain).length, 14);
});

const CATALOGUE_KEYS = config.domains.map((d) => d.key);
const floorOf = (n) => scopedMinItems(config.settings, CATALOGUE,
  Object.fromEntries(CATALOGUE_KEYS.slice(0, n).map((k) => [k, { ...WINDOW }])), CATALOGUE_KEYS);

test('F30-4 the gate floor is the number the sentence states', () => {
  assert.equal(scopedMinItems(config.settings, CATALOGUE, wholeCatalogue.perDomain, CATALOGUE_KEYS), 30,
    'the whole-catalogue floor is not total_min_items');
  assert.equal(scopedMinItems(config.settings, CATALOGUE, scopedTo14.perDomain, CATALOGUE_KEYS), 15,
    'the 14-of-43 floor is not fifteen');
  assert.equal(scopedMinItems(config.settings, CATALOGUE, { [config.domains[0].key]: { ...WINDOW } }, CATALOGUE_KEYS), 1,
    'a single-domain run is not a probe with a floor of one');
  // Closing sweep F31-9 corrected this test's own expectation. The old assertion message read
  // 'the 14-of-43 floor is not fifteen (ceil(30 x 14 / 43))', and that parenthetical is false
  // arithmetic: Math.ceil(30 * 14 / 43) is 10. Fifteen is the covered+1 clause
  // (Math.max(scaled, covered + 1) at check-quality.mjs), which is what the corrected sentence
  // says. The floor value itself is unchanged and still measured above.
  assert.equal(Math.ceil((30 * 14) / CATALOGUE), 10, 'the scaled share of a 14-domain run moved');
  assert.equal(floorOf(14), 15, 'the 14-of-43 floor is not the covered+1 clause');
});

test('F31-9 the scaled share never binds on the shipped settings and the clamp bounds it', () => {
  // The corrected sentence claims two things about the shipped arithmetic, both measured here:
  // the scaled share never exceeds the clamp for any N, and for a multi-domain run it is the
  // covered+1 clause (or the clamp) that sets the floor. This is the inequality the false
  // parenthetical hid.
  for (let n = 1; n <= CATALOGUE; n += 1) {
    const scaled = Math.ceil((30 * n) / CATALOGUE);
    assert.ok(scaled <= 30, 'the scaled share exceeds the clamp at N = ' + n + ': ' + scaled);
    assert.ok(scaled <= n + 1 || scaled >= 30,
      'the scaled share is strictly above covered+1 and below the clamp at N = ' + n + ': ' + scaled);
    if (n >= 2 && n <= 29) {
      assert.equal(floorOf(n), n + 1, 'the floor at N = ' + n + ' is not the covered+1 clause');
    }
  }
  // From N = 30 the clamp is what holds the floor: covered + 1 is 31 there and the clamp is 30.
  assert.equal(floorOf(29), 30, 'the covered+1 clause does not reach the clamp at N = 29');
  assert.equal(floorOf(30), 30, 'the clamp does not hold the floor at N = 30');
  assert.equal(floorOf(42), 30, 'the clamp does not hold the floor at N = 42');
});

test('F30-4 29 items pass the floor on a fourteen-domain run and fail it on the whole catalogue', () => {
  const digest = digestWith(29);
  const whole = check(digest, config, wholeCatalogue).failures;
  assert.ok(whole.includes('29 items is below total_min_items ' + 30),
    'the whole-catalogue run did not fail the floor: ' + JSON.stringify(whole));
  const scoped = check(digest, config, scopedTo14).failures;
  assert.equal(scoped.filter((f) => /below (total_min_items|the scoped floor)/.test(f)).length, 0,
    'the scoped run was failed on the floor for the domains it never took on: ' + JSON.stringify(scoped));
});

test('F30-4 the gate reports the scoped floor as the scoped number, not as total_min_items', () => {
  // Two items is under the 14-of-43 floor of 15 and over nothing else, so the message names the
  // scoped floor and the coverage that produced it.
  const failures = check(digestWith(2), config, scopedTo14).failures;
  assert.ok(failures.some((f) => /^2 items is below the scoped floor of 15 for a run covering 14 of 43 domains$/.test(f)),
    'the scoped floor message is not the one the sentence describes: ' + JSON.stringify(failures));
});

test('F30-4 SKILL.md states the scoped rule and its arithmetic rather than the flat claim', () => {
  const skill = readFileSync(SKILL, 'utf8');
  assert.ok(!/a digest must meet `total_min_items` however many core domains came back quiet/.test(skill),
    'the flat, false claim is still in SKILL.md');
  assert.match(skill, /a digest must meet its run's completeness floor however/,
    'the corrected sentence is not in SKILL.md');
  assert.match(skill, /`ceil\(total_min_items × covered domains ÷ catalogue domains\)`/,
    'the sentence does not carry the arithmetic');
  assert.match(skill, /covering fourteen of those domains must reach \*\*fifteen\*\* — the scaled\nshare alone is ceil\(30 × 14 ÷ 43\) = 10, and it is the one-per-covered-domain-plus-one clause that carries it to 15/,
    'the sentence does not carry the worked example the gate reproduces');
  assert.ok(!/must reach \*\*fifteen\*\* \(ceil\(30 × 14 ÷ 43\)\)/.test(skill),
    'the false parenthetical (ceil(30 × 14 ÷ 43) stated as fifteen) is still in SKILL.md');
});
