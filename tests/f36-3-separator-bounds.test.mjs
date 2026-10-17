// tests/f36-3-separator-bounds.test.mjs
// Closing sweep F36-3 and F36-4 (both Low): the two costs of the widened separator class, RECORDED
// rather than narrowed. Both rows are pinned here so the cost is visible to the next reader instead
// of living only in a sweep report, and the direction is stated with each: widening the class was
// what closed the leak behind U+05C3 and the other colon-shaped spellings, and narrowing it again
// would reopen the publication.
//
// F36-3. A sentence that spells the word 'authorization' immediately before one of the characters a
// SENTENCE uses as punctuation is read as a header NAME, so the rest of its line becomes its value;
// the value is declined (its head is prose), and the declined-value scan then reaps every
// credential-shaped run in that value. That is the whole-value rule's documented prose cost, and it is
// NOT new in kind: the ASCII colon has always done exactly this to the same sentence ('the
// authorization: policy was reviewed against v24.18.0 build abc123xyz' loses its tail at 861aeb0 too,
// measured). What the widening adds is that six more separators trigger it -- the ones a sentence can
// write -- and the sweep measured all six publishing the sentence byte for byte at 861aeb0. The rows
// below pin both, so the record shows the RULE rather than the character.
//
// F36-4. A wider separator can match EARLIER in the text than the previous revision's class did, and
// the value the earlier match reads is line-scoped: a credential standing on the next line therefore
// stops being covered by the inner header's match. The sweep's minimal reproduction is pinned below,
// with the reach it measured: the shape needs a widened separator AND an inner header name whose
// spelling the same class reads AND no separator between the two, and the sweep could not build it
// from any realistic single feed line. It is recorded, not closed: the earlier match's value spans the
// header name that owns the credential, so reconciling the two readings would mean letting an
// accepted value swallow the line after it, and that is the direction that deletes a reader's text --
// which this module's own line rule exists to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentialShapes, redactSecrets } from '../scripts/lib/net.mjs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRED = 'tok_' + '9f3a2c7d1e5b';
const S = (code) => String.fromCharCode(code);

// The six separators the sweep measured reaping a credential-shaped prose run. Each is a character a
// SENTENCE writes: an Armenian full stop, an Ethiopic wordspace, a Hebrew SOF PASUQ, a Mongolian
// colon, a two-dot punctuation and a raised colon.
const SENTENCE_SEPARATORS = [[0x0589, 'U+0589 ARMENIAN FULL STOP'], [0x1361, 'U+1361 ETHIOPIC WORDSPACE'],
  [0x05C3, 'U+05C3 HEBREW PUNCTUATION SOF PASUQ'], [0x1804, 'U+1804 MONGOLIAN COLON'],
  [0x205A, 'U+205A TWO DOT PUNCTUATION'], [0x02F8, 'U+02F8 MODIFIER LETTER RAISED COLON']];

test('F36-3 (recorded bound): a sentence that spells the header name loses its credential-shaped tail', () => {
  const sentence = (separator) => 'the authorization' + separator
    + ' policy was reviewed against v24.18.0 build abc123xyz';
  const reaped = (separator) => 'the authorization' + separator
    + ' policy was reviewed against [redacted] build [redacted]';
  // The ASCII colon is the control: it is not part of the widening, and it has done this since the
  // whole-value rule was written. If this row ever changes, the rule moved and not the class.
  assert.equal(redactSecrets(sentence(':'), []), reaped(':'),
    'the ASCII colon row moved -- this is the rule, not the widening');
  for (const [code, name] of SENTENCE_SEPARATORS) {
    const separator = S(code);
    assert.equal(redactSecrets(sentence(separator), []), reaped(separator),
      name + ' no longer reaps the prose tail: ' + JSON.stringify(redactSecrets(sentence(separator), [])));
    assert.equal(redactCredentialShapes(sentence(separator)), reaped(separator),
      'the two entry points disagree about ' + name);
  }
  // The bound the sweep also measured, and the reason this is a bound rather than a class-wide price:
  // a sentence with no credential-SHAPED run in its tail is byte-identical, so ordinary prose that
  // merely carries the character is untouched.
  for (const [code, name] of SENTENCE_SEPARATORS) {
    const control = 'the authorization' + S(code) + ' policy of RFC 7235 is applied';
    assert.equal(redactSecrets(control, []), control, name + ' reaped prose with no shaped run: '
      + JSON.stringify(redactSecrets(control, [])));
  }
});

test('F36-4 (recorded bound): a wider separator can match earlier and publish a credential the previous revision removed', () => {
  // The sweep's minimal reproduction, verbatim: U+0703 SYRIAC SUPRALINEAR COLON after the outer name,
  // an entity-spelled inner name, U+2236 RATIO as the inner separator, a CR, and the credential.
  // 861aeb0 did not read U+0703, so its first match was the INNER header, whose trailing '\s*'
  // crossed the CR and consumed the credential: it answered 'authorization' + U+0703 + '[redacted]'.
  // The widened class matches the outer header first, its value is line-scoped and ends at the CR, and
  // the credential on the next line is published. Every widened separator reproduces it.
  for (const [code, name] of [[0x0703, 'U+0703'], [0x0589, 'U+0589'], [0x1361, 'U+1361'],
    [0xFE13, 'U+FE13'], [0x05C3, 'U+05C3']]) {
    const text = 'authorization' + S(code) + 'authoriz&#97;tion' + S(0x2236) + CR + CRED;
    assert.equal(redactSecrets(text, []), '[redacted]' + CR + CRED,
      name + ' moved the recorded bound: ' + JSON.stringify(redactSecrets(text, [])));
    assert.equal(redactCredentialShapes(text), '[redacted]' + CR + CRED,
      'the two entry points disagree about ' + name);
  }
  // The reach, measured in three controls. (1) The ASCII separator is NOT a trigger: the previous
  // revision read it too, so its outer match was already the first one and the same next-line
  // credential is published at BOTH revisions (the sweep's p02/p05 and this batch's own probe both
  // measured 'authorization:' + 'authoriz&#97;tion' + U+2236 + CR + CRED as
  // '[redacted]\rtok_...' at 861aeb0 and here). What the widening changed is only WHERE the outer
  // match happens, which is why the row above moved. (2) An ordinary sentence before the widened
  // separator does not build the shape: the value is declined, not accepted, so nothing after the
  // line is touched. (3) An INDENTED continuation is still folded, so the widening does not trade
  // the fold away.
  assert.equal(redactSecrets('authorization' + ':' + 'authoriz&#97;tion' + S(0x2236) + CR + CRED, []),
    '[redacted]' + CR + CRED,
    'the ASCII row moved: it is pre-existing at 861aeb0 and not part of this widening');
  const sentence = 'the authorization' + S(0x0703) + ' policy was reviewed' + CR + CRED;
  assert.equal(redactSecrets(sentence, []), sentence,
    'an ordinary sentence followed by a credential does not build the shape: '
    + JSON.stringify(redactSecrets(sentence, [])));
  const wrapped = 'authorization' + S(0x0703) + 'authoriz&#97;tion' + S(0x2236) + LF + '  ' + CRED;
  assert.equal(redactSecrets(wrapped, []), '[redacted]',
    'an INDENTED continuation is still folded: ' + JSON.stringify(redactSecrets(wrapped, [])));
});
