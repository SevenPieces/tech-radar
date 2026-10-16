// tests/rd24-cv3-tag-shape.test.mjs
// CV-3 (TR-171): the tag rule's reach. Every alternative of TAG_SHAPE ends with the '>' that
// closes the span, so the rule neutralises exactly the spans that carry one; an opener with no
// '>' of its own is returned byte-identical. That is the measured behaviour these cases pin, so
// the comment beside the rule cannot drift back into claiming a reach it does not have -- and so
// that a later change cannot quietly widen the rule and take the ordinary comparisons with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neutraliseTagSpans, plainText } from '../scripts/lib/net.mjs';
import { neutraliseNoticeText } from '../scripts/collect.mjs';

// The spellings the rule does not reach: an opener cut off before its '>', and a bare name that
// is not in the markup vocabulary. Each is what a server's own message can carry.
const UNREACHED = ['<script', '<img', '<a href=x', 'see <script', '<foo>', 'x <script y'];
// The spellings it is not allowed to start reaching: an ordinary comparison, and an id in angle
// brackets, both of which a legitimate message says.
const COMPARISONS = ['a < b', 'see <id>', 'x <3 y', '<apiVersion>'];

test('CV-3 the tag rule does not reach an opener that carries no >', () => {
  for (const text of UNREACHED) {
    assert.equal(neutraliseTagSpans(text), text,
      'the tag rule rewrote a span with no closing >: ' + JSON.stringify(text));
    assert.equal(neutraliseNoticeText(text), text,
      'the notice push rewrote a span with no closing >: ' + JSON.stringify(text));
  }
});

test('CV-3 an unterminated opener survives plainText, which strips only a closed span', () => {
  for (const text of ['<script', '<img', '<a href=x', 'see <script']) {
    assert.equal(plainText(text, 200), text,
      'plainText rewrote a span with no closing >: ' + JSON.stringify(text));
  }
});

test('CV-3 the ordinary comparisons the rule must keep byte-identical still are', () => {
  for (const text of COMPARISONS) {
    assert.equal(neutraliseTagSpans(text), text,
      'the tag rule reached an ordinary comparison: ' + JSON.stringify(text));
  }
});

test('CV-3 a span that does carry its > is still neutralised', () => {
  for (const [text, expected] of [['<script>', ' script>'], ['<a href=x>', ' a href=x>'],
    ['</a>', ' /a>'], ['<!DOCTYPE html>', ' !DOCTYPE html>']]) {
    assert.equal(neutraliseTagSpans(text), expected,
      'a closed tag span was not neutralised: ' + JSON.stringify(text));
  }
});

// The gap is inert rather than unhandled: the byte a reader receives is text. The renderer
// escapes it on the way out, and a reader draws no markup from an opener that never closes.
test('CV-3 the byte the rule leaves reaches the HTML escaped', async () => {
  const render = await import('../scripts/render-html.mjs');
  const html = render.linkify('<script');
  assert.ok(!html.includes('<script'), 'an unterminated opener reached the HTML unescaped: ' + html);
  assert.ok(html.includes('&lt;script'), 'the unterminated opener was not escaped as text: ' + html);
});
