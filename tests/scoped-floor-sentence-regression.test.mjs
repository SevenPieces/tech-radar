// tests/scoped-floor-sentence-regression.test.mjs
// Closing sweep F30-4 and the FINAL30 verification's section 7(iii) (Low, documentation): Batch 55's
// new sentence in SKILL.md section 5 stated the completeness floor as an unconditional constraint -
// 'a digest must meet total_min_items however many core domains came back quiet' - which is not the
// gate's rule for a scoped run. check-quality.mjs scores the floor with
// scopedMinItems(settings, catalogueSize, plan.perDomain), so a --domain-scoped run covering 14 of
// the 43 shipped domains has a floor of 15, one covering two domains a floor of 3, and a
// single-domain run a floor of 1. Measured (the sweep's own probe): 29 items with a 14-domain plan
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

test('F30-4 the gate floor is the scope-scaled number the sentence states', () => {
  assert.equal(scopedMinItems(config.settings, CATALOGUE, wholeCatalogue.perDomain), 30,
    'the whole-catalogue floor is not total_min_items');
  assert.equal(scopedMinItems(config.settings, CATALOGUE, scopedTo14.perDomain), 15,
    'the 14-of-43 floor is not fifteen (ceil(30 x 14 / 43))');
  assert.equal(scopedMinItems(config.settings, CATALOGUE, { [config.domains[0].key]: { ...WINDOW } }), 1,
    'a single-domain run is not a probe with a floor of one');
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
  assert.match(skill, /covering fourteen of those domains must reach \*\*fifteen\*\* \(ceil\(30 × 14 ÷ 43\)\)/,
    'the sentence does not carry the worked example the gate reproduces');
});
